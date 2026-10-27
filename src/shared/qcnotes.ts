import { QC_MAX_LEN, qcKey, type QcNote } from './qc';
import { readSheetGrid } from './qcimport';

/**
 * QC note import: nhập lại file ghi chú QC do chính tool xuất (xlsx 3 cột ID, frame, note), để chuyển ghi chú giữa các máy mà
 * không cần mạng. Khác với QC comparison (đối chiếu file báo cáo QC, sheet Matrix). File chỉ được đọc trong trình duyệt.
 */
export type NotesParse = { ok: true; notes: QcNote[]; skipped: number; sheet: string } | { ok: false; message: string };

const norm = (s: string | undefined) => (s ?? '').trim().toLowerCase();

export function parseNotesXlsx(bytes: Uint8Array): NotesParse {
  const r = readSheetGrid(bytes, ['QC', 'Notes', 'Note']);
  if (!r.ok) return r;
  const h = r.grid.findIndex((row) => row && row.some((c) => norm(c) === 'id') && row.some((c) => norm(c) === 'frame') && row.some((c) => norm(c) === 'note'));
  if (h < 0) return { ok: false, message: 'Không thấy dòng tiêu đề "ID, frame, note". Đây có phải file ghi chú QC do tool xuất không? (file đối chiếu QC dùng mục "QC comparison")' };
  const head = r.grid[h]!;
  const col = (name: string) => head.findIndex((c) => norm(c) === name);
  const cId = col('id'), cFrame = col('frame'), cNote = col('note');
  const map = new Map<string, QcNote>();
  let skipped = 0;
  for (const row of r.grid.slice(h + 1)) {
    if (!row) continue;
    const num = Number((row[cId] ?? '').trim()), frame = Number((row[cFrame] ?? '').trim());
    const note = (row[cNote] ?? '').trim().slice(0, QC_MAX_LEN);
    if (!(row[cId] ?? '').trim() && !(row[cFrame] ?? '').trim() && !note) continue; // dòng trống
    if (!Number.isInteger(num) || num < 1 || !Number.isInteger(frame) || frame < 0 || !note) { skipped++; continue; }
    map.set(qcKey(0, num, frame), { num, frame, note }); // trùng (ID, frame) trong file: dòng sau thắng
  }
  if (!map.size) return { ok: false, message: skipped ? `Không có ghi chú hợp lệ (bỏ qua ${skipped} dòng sai định dạng).` : 'File không có ghi chú nào.' };
  return { ok: true, notes: [...map.values()].sort((a, b) => a.num - b.num || a.frame - b.frame), skipped, sheet: r.sheet };
}

export interface NotesPlan { added: QcNote[]; same: QcNote[]; conflicts: { num: number; frame: number; current: string; incoming: string }[] }

/** So ghi chú trong file với ghi chú hiện có của job: mới / giống hệt / trùng (ID, frame) nhưng khác nội dung. */
export function planNotesImport(current: QcNote[], incoming: QcNote[]): NotesPlan {
  const cur = new Map(current.map((n) => [`${n.num}:${n.frame}`, n.note]));
  const plan: NotesPlan = { added: [], same: [], conflicts: [] };
  for (const n of incoming) {
    const c = cur.get(`${n.num}:${n.frame}`);
    if (c === undefined) plan.added.push(n);
    else if (c === n.note) plan.same.push(n);
    else plan.conflicts.push({ num: n.num, frame: n.frame, current: c, incoming: n.note });
  }
  return plan;
}
