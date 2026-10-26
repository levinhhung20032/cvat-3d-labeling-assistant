import { tiltTooLarge } from '../shared/cuboid';
import { checkOutsideKeyframes } from '../shared/rules';
import { UPLOAD_BATCH, covers, sameTrack } from '../shared/upload';
import type { UploadPayload } from '../shared/plan';
import type { CvatAnnotations, CvatTrack } from '../shared/types';

export interface UploadReq {
  real: boolean; // false = chạy thử: kiểm tra mọi thứ nhưng KHÔNG gửi
  changed: CvatTrack[];
  created?: CvatTrack[]; // object MỚI do tool tạo (không có id): gửi bằng action=create, sau các lệnh update
  expected: CvatTrack[]; // baseline của đúng các track trong `changed`
  baselineIds: number[]; // mọi ID track lúc đọc
  stopFrame: number;
}

export type Stage = 'read' | 'conflict' | 'rules' | 'dry-run' | 'write' | 'verify' | 'done';

export interface UploadResult {
  ok: boolean;
  stage: Stage;
  sent: boolean;
  message: string;
  conflicts: number[]; // ID track bị xung đột
  batches: number;
  createdIds?: number[]; // ID database của các object tool vừa tạo (để ghi vào sổ object do tool tạo)
  deletedIds?: number[];
}

export interface DeleteReq {
  real: boolean;
  ids: number[]; // ID database cần xóa
  madeIds: number[]; // sổ các ID do tool tạo (chỉ những ID này được xóa)
  baselineIds: number[]; // mọi ID lúc đọc
}

export interface LogEntry {
  time: string;
  jobId: number;
  ids: number[];
  pre: CvatTrack[]; // trạng thái trên server ngay trước khi ghi
  post: CvatTrack[]; // dữ liệu đã gửi
  verified: boolean;
  reverted: boolean;
}

export interface UploadDeps {
  read: () => Promise<CvatAnnotations>;
  /** Chỉ được gọi khi req.real; luôn là PATCH action=update. */
  write: (payload: UploadPayload, action?: 'update' | 'create') => Promise<unknown>;
  /** Chỉ cho track do tool tạo (kiểm tra lại ở CvatClient.deleteOwn). */
  deleteOwn?: (tracks: CvatTrack[], allowed: ReadonlySet<number>) => Promise<unknown>;
  loadLog: () => Promise<LogEntry[]>;
  saveLog: (list: LogEntry[]) => Promise<void>;
  jobId: number;
  now?: () => Date;
}

const fail = (stage: Stage, message: string, conflicts: number[] = []): UploadResult =>
  ({ ok: false, stage, sent: false, message, conflicts, batches: 0 });

const byId = (a: CvatAnnotations) => new Map(a.tracks.map((t) => [t.id, t]));

/** Upload theo đúng thứ tự: đọc → không có ID biến mất → không xung đột → luật → (log) → ghi theo lô → đọc lại so khớp. */
export async function runUpload(deps: UploadDeps, req: UploadReq): Promise<UploadResult> {
  let server: CvatAnnotations;
  try { server = await deps.read(); } catch (e) { return fail('read', `Không đọc được annotation: ${String(e)}`); }
  const sById = byId(server);

  // 1. Không ID nào được biến mất so với lúc đọc (luật 1).
  const vanished = req.baselineIds.filter((id) => !sById.has(id));
  if (vanished.length) return fail('conflict', `Trên server đã mất ID: ${vanished.join(', ')}. Dừng — tải lại dữ liệu.`, vanished);

  // 2. Các track định ghi phải còn đúng như lúc đọc (không ai sửa xen vào).
  if (req.changed.length !== req.expected.length) return fail('rules', 'Dữ liệu gửi không khớp danh sách baseline.');
  const conflicts: number[] = [];
  req.expected.forEach((exp) => {
    const cur = sById.get(exp.id);
    if (!cur || !sameTrack(cur, exp)) conflicts.push(exp.id!);
  });
  if (conflicts.length) {
    return fail('conflict', `Track đã bị đổi trên server kể từ lúc đọc: ${conflicts.join(', ')}. Tải lại dữ liệu rồi làm lại, hoặc bỏ nháp các track đó.`, conflicts);
  }

  // 3. Luật bất biến trên đúng dữ liệu sắp gửi.
  const ids = req.changed.map((t) => t.id);
  if (ids.some((id) => typeof id !== 'number')) return fail('rules', 'Có track cần cập nhật mà không có ID.');
  const created = req.created ?? [];
  if (created.some((t) => typeof t.id === 'number')) return fail('rules', 'Object mới không được mang sẵn ID.');
  if (new Set(ids).size !== ids.length) return fail('rules', 'Có ID track trùng nhau trong dữ liệu gửi.');
  const v = checkOutsideKeyframes({ ...server, tracks: [...req.changed, ...created] }, req.stopFrame);
  if (v.length) return fail('rules', `Còn frame outside thiếu keyframe: ${v.map((x) => x.message).join('; ')}`);
  // Roll / pitch được phép (box nghiêng theo mặt đường) nhưng không quá ±30° và phải là số hợp lệ.
  const tilted = [...req.changed, ...created].filter((t) => t.shapes.some((s) => !s.outside && (tiltTooLarge(s.points) || s.points.some((n) => !Number.isFinite(n))))).map((t) => t.id);
  if (tilted.length) return fail('rules', `roll/pitch (rx/ry) vượt ±30° hoặc không hợp lệ ở track: ${tilted.join(', ')}.`);

  const batches: CvatTrack[][] = [];
  for (let i = 0; i < req.changed.length; i += UPLOAD_BATCH) batches.push(req.changed.slice(i, i + UPLOAD_BATCH));
  const createBatches: CvatTrack[][] = [];
  for (let i = 0; i < created.length; i += UPLOAD_BATCH) createBatches.push(created.slice(i, i + UPLOAD_BATCH));

  if (!req.real) {
    return { ok: true, stage: 'dry-run', sent: false, message: `Chạy thử: không xung đột, luật đạt. Sẽ cập nhật ${req.changed.length} track (${batches.length} lô, action=update) và tạo ${created.length} object mới (${createBatches.length} lô, action=create). Chưa gửi gì.`, conflicts: [], batches: batches.length + createBatches.length };
  }

  // 4. Nhật ký cục bộ (trạng thái trước / dữ liệu gửi) — trước khi ghi.
  const entry: LogEntry = {
    time: (deps.now?.() ?? new Date()).toISOString(), jobId: deps.jobId, ids: ids as number[],
    pre: req.expected, post: req.changed, verified: false, reverted: false,
  };
  const log = await deps.loadLog();
  await deps.saveLog([...log, entry].slice(-5));

  // 5. Ghi theo lô.
  let sentBatches = 0;
  try {
    for (const batch of batches) {
      await deps.write({ version: server.version, tags: [], shapes: [], tracks: batch });
      sentBatches++;
    }
    for (const batch of createBatches) {
      await deps.write({ version: server.version, tags: [], shapes: [], tracks: batch }, 'create');
      sentBatches++;
    }
  } catch (e) {
    return { ok: false, stage: 'write', sent: sentBatches > 0, message: `Lỗi khi gửi lô ${sentBatches + 1}/${batches.length + createBatches.length}: ${String(e)}. ${sentBatches} lô đã gửi; xem nhật ký để hoàn nguyên, và đọc lại danh sách object trước khi làm tiếp.`, conflicts: [], batches: sentBatches };
  }

  // 6. Đọc lại và so khớp.
  const after = await deps.read();
  const aById = byId(after);
  const bad: number[] = [];
  for (const t of req.changed) { const s = aById.get(t.id); if (!s || !covers(s, t)) bad.push(t.id!); }
  const changedSet = new Set(ids);
  const untouchedBad = after.tracks.filter((t) => !changedSet.has(t.id) && sById.get(t.id) && !sameTrack(t, sById.get(t.id)!)).map((t) => t.id!);
  const lostIds = req.baselineIds.filter((id) => !aById.has(id));
  // Object mới: là các track xuất hiện thêm so với lần đọc đầu, theo thứ tự id tăng dần; phải đúng số lượng và đúng nội dung.
  const fresh = after.tracks.filter((t) => typeof t.id === 'number' && !sById.has(t.id)).sort((a, b) => a.id! - b.id!);
  const createdBad = fresh.length !== created.length || created.some((c, i) => !fresh[i] || !covers(fresh[i]!, c));
  const createdIds = createdBad ? [] : fresh.map((t) => t.id!);
  entry.verified = !bad.length && !untouchedBad.length && !lostIds.length && !createdBad;
  const l2 = await deps.loadLog();
  await deps.saveLog([...l2.slice(0, -1), entry]);
  if (!entry.verified) {
    return { ok: false, stage: 'verify', sent: true, message: `ĐÃ GỬI nhưng đọc lại không khớp (track: ${[...bad, ...untouchedBad].join(', ') || '—'}; ID mất: ${lostIds.join(', ') || '—'}; object mới: ${createdBad ? `mong ${created.length}, thấy ${fresh.length} hoặc nội dung lệch` : 'khớp'}). Dùng "Hoàn nguyên" rồi báo lại.`, conflicts: bad, batches: sentBatches, createdIds: fresh.map((t) => t.id!) };
  }
  return { ok: true, stage: 'done', sent: true, message: `Đã ghi ${req.changed.length} track${created.length ? ` và tạo ${created.length} object mới` : ''}, đọc lại khớp 100%. Tải lại tab CVAT (F5) trước khi làm tiếp; đừng bấm Save trong CVAT trước khi tải lại.`, conflicts: [], batches: sentBatches, createdIds };
}

/** Hoàn nguyên lần upload gần nhất: ghi lại đúng trạng thái trước đó của các track đã đổi (chỉ khi server vẫn như ngay sau lần ghi). */
export async function runRevert(deps: UploadDeps, real: boolean): Promise<UploadResult> {
  const log = await deps.loadLog();
  const entry = log[log.length - 1];
  if (!entry || entry.reverted) return fail('read', 'Không có lần upload nào để hoàn nguyên.');
  let server: CvatAnnotations;
  try { server = await deps.read(); } catch (e) { return fail('read', `Không đọc được annotation: ${String(e)}`); }
  const sById = byId(server);
  const conflicts = entry.post.filter((t) => { const s = sById.get(t.id); return !s || !covers(s, t); }).map((t) => t.id!);
  if (conflicts.length) return fail('conflict', `Các track này đã khác sau lần upload (có thể đã bị sửa tiếp): ${conflicts.join(', ')}. Không tự hoàn nguyên.`, conflicts);
  const batches: CvatTrack[][] = [];
  for (let i = 0; i < entry.pre.length; i += UPLOAD_BATCH) batches.push(entry.pre.slice(i, i + UPLOAD_BATCH));
  if (!real) return { ok: true, stage: 'dry-run', sent: false, message: `Chạy thử hoàn nguyên: sẽ ghi lại ${entry.pre.length} track (${batches.length} lô). Chưa gửi gì.`, conflicts: [], batches: batches.length };
  let n = 0;
  try {
    for (const b of batches) { await deps.write({ version: server.version, tags: [], shapes: [], tracks: b }); n++; }
  } catch (e) { return { ok: false, stage: 'write', sent: n > 0, message: `Lỗi khi hoàn nguyên lô ${n + 1}/${batches.length}: ${String(e)}`, conflicts: [], batches: n }; }
  const after = await deps.read();
  const aById = byId(after);
  const bad = entry.pre.filter((t) => { const s = aById.get(t.id); return !s || !covers(s, t); }).map((t) => t.id!);
  entry.reverted = bad.length === 0;
  await deps.saveLog([...log.slice(0, -1), entry]);
  if (bad.length) return { ok: false, stage: 'verify', sent: true, message: `Đã hoàn nguyên nhưng đọc lại chưa khớp ở track: ${bad.join(', ')}.`, conflicts: bad, batches: n };
  return { ok: true, stage: 'done', sent: true, message: `Đã hoàn nguyên ${entry.pre.length} track về trạng thái trước lần upload và đọc lại khớp. Tải lại tab CVAT (F5).`, conflicts: [], batches: n };
}

/**
 * Xóa object do CHÍNH TOOL tạo (chủ dự án duyệt 2026-10-26). Thứ tự bảo vệ: mọi ID định xóa phải nằm trong sổ object do tool tạo
 * (madeIds) → đọc server: các ID phải còn đó và mọi ID lúc đọc phải còn → lưu nhật ký (nội dung trước khi xóa) → xóa → đọc lại:
 * đúng các ID đó biến mất, mọi track khác giữ nguyên từng giá trị. Object có sẵn trên server không bao giờ qua được bước đầu.
 */
export async function runDelete(deps: UploadDeps, req: DeleteReq): Promise<UploadResult> {
  if (!deps.deleteOwn) return fail('rules', 'Chức năng xóa chưa được bật.');
  const ids = [...new Set(req.ids)];
  if (!ids.length) return fail('rules', 'Không có object nào để xóa.');
  const made = new Set(req.madeIds);
  const notMade = ids.filter((id) => !made.has(id));
  if (notMade.length) return fail('rules', `Từ chối: ID ${notMade.join(', ')} không phải object do tool tạo. Object có sẵn trên server không bao giờ xóa được.`);
  let server: CvatAnnotations;
  try { server = await deps.read(); } catch (e) { return fail('read', `Không đọc được annotation: ${String(e)}`); }
  const sById = byId(server);
  const vanished = req.baselineIds.filter((id) => !sById.has(id));
  if (vanished.length) return fail('conflict', `Trên server đã mất ID: ${vanished.join(', ')}. Dừng — tải lại dữ liệu.`, vanished);
  const missing = ids.filter((id) => !sById.has(id));
  if (missing.length) return fail('conflict', `ID ${missing.join(', ')} không còn trên server (đã bị xóa?). Tải lại dữ liệu.`, missing);
  const victims = ids.map((id) => sById.get(id)!);
  if (!req.real) return { ok: true, stage: 'dry-run', sent: false, message: `Chạy thử: sẽ xóa ${ids.length} object do tool tạo (ID database ${ids.join(', ')}); không đụng tới track nào khác. Chưa gửi gì.`, conflicts: [], batches: 1 };

  const entry: LogEntry = { time: (deps.now?.() ?? new Date()).toISOString(), jobId: deps.jobId, ids, pre: victims, post: [], verified: false, reverted: false };
  const log = await deps.loadLog();
  await deps.saveLog([...log, entry].slice(-5));
  try { await deps.deleteOwn(victims, made); } catch (e) { return { ok: false, stage: 'write', sent: false, message: `Lỗi khi xóa: ${String(e)}. Đọc lại danh sách object trước khi làm tiếp.`, conflicts: [], batches: 0 }; }

  const after = await deps.read();
  const aById = byId(after);
  const stillThere = ids.filter((id) => aById.has(id));
  const others = server.tracks.filter((t) => !ids.includes(t.id!));
  const changedOthers = others.filter((t) => { const a = aById.get(t.id); return !a || !sameTrack(a, t); }).map((t) => t.id!);
  entry.verified = !stillThere.length && !changedOthers.length;
  const l2 = await deps.loadLog();
  await deps.saveLog([...l2.slice(0, -1), entry]);
  if (!entry.verified) {
    return { ok: false, stage: 'verify', sent: true, message: `ĐÃ GỬI nhưng đọc lại không như mong đợi (còn lại: ${stillThere.join(', ') || '—'}; track khác bị đổi: ${changedOthers.join(', ') || '—'}). Báo lại, đừng tiếp tục.`, conflicts: changedOthers, batches: 1, deletedIds: ids.filter((i) => !aById.has(i)) };
  }
  return { ok: true, stage: 'done', sent: true, message: `Đã xóa ${ids.length} object do tool tạo; mọi track khác giữ nguyên. Tải lại tab CVAT (F5) trước khi làm tiếp.`, conflicts: [], batches: 1, deletedIds: ids };
}
