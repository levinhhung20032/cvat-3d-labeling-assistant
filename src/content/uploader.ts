import { checkOutsideKeyframes } from '../shared/rules';
import { UPLOAD_BATCH, covers, sameTrack } from '../shared/upload';
import type { UploadPayload } from '../shared/plan';
import type { CvatAnnotations, CvatTrack } from '../shared/types';

export interface UploadReq {
  real: boolean; // false = chạy thử: kiểm tra mọi thứ nhưng KHÔNG gửi
  changed: CvatTrack[];
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
  write: (payload: UploadPayload) => Promise<unknown>;
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
  if (ids.some((id) => typeof id !== 'number')) return fail('rules', 'Có track không có ID — chưa hỗ trợ tạo track mới.');
  if (new Set(ids).size !== ids.length) return fail('rules', 'Có ID track trùng nhau trong dữ liệu gửi.');
  const v = checkOutsideKeyframes({ ...server, tracks: req.changed }, req.stopFrame);
  if (v.length) return fail('rules', `Còn frame outside thiếu keyframe: ${v.map((x) => x.message).join('; ')}`);
  const tilted = req.changed.filter((t) => t.shapes.some((s) => s.points[3] !== 0 || s.points[4] !== 0)).map((t) => t.id);
  if (tilted.length) return fail('rules', `rx/ry khác 0 ở track: ${tilted.join(', ')} (box chỉ được xoay yaw).`);

  const batches: CvatTrack[][] = [];
  for (let i = 0; i < req.changed.length; i += UPLOAD_BATCH) batches.push(req.changed.slice(i, i + UPLOAD_BATCH));

  if (!req.real) {
    return { ok: true, stage: 'dry-run', sent: false, message: `Chạy thử: không xung đột, luật đạt. Sẽ gửi ${req.changed.length} track trong ${batches.length} lô (PATCH action=update). Chưa gửi gì.`, conflicts: [], batches: batches.length };
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
  } catch (e) {
    return { ok: false, stage: 'write', sent: sentBatches > 0, message: `Lỗi khi gửi lô ${sentBatches + 1}/${batches.length}: ${String(e)}. ${sentBatches} lô đã gửi; xem nhật ký để hoàn nguyên.`, conflicts: [], batches: sentBatches };
  }

  // 6. Đọc lại và so khớp.
  const after = await deps.read();
  const aById = byId(after);
  const bad: number[] = [];
  for (const t of req.changed) { const s = aById.get(t.id); if (!s || !covers(s, t)) bad.push(t.id!); }
  const changedSet = new Set(ids);
  const untouchedBad = after.tracks.filter((t) => !changedSet.has(t.id) && sById.get(t.id) && !sameTrack(t, sById.get(t.id)!)).map((t) => t.id!);
  const lostIds = req.baselineIds.filter((id) => !aById.has(id));
  entry.verified = !bad.length && !untouchedBad.length && !lostIds.length;
  const l2 = await deps.loadLog();
  await deps.saveLog([...l2.slice(0, -1), entry]);
  if (!entry.verified) {
    return { ok: false, stage: 'verify', sent: true, message: `ĐÃ GỬI nhưng đọc lại không khớp (track: ${[...bad, ...untouchedBad].join(', ') || '—'}; ID mất: ${lostIds.join(', ') || '—'}). Dùng "Hoàn nguyên" rồi báo lại.`, conflicts: bad, batches: sentBatches };
  }
  return { ok: true, stage: 'done', sent: true, message: `Đã ghi ${req.changed.length} track và đọc lại khớp 100%. Tải lại tab CVAT (F5) trước khi làm tiếp; đừng bấm Save trong CVAT trước khi tải lại.`, conflicts: [], batches: sentBatches };
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
