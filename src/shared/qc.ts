/**
 * Ghi chú QC theo từng cặp (ID object, frame). ID là số thứ tự hiển thị của object (trùng với ID trong giao diện CVAT).
 * Chỉ lưu cục bộ; người QA/QC được phép xuất Excel gồm đúng 3 cột ID, frame, note (không kèm toạ độ hay dữ liệu point cloud).
 */
export interface QcNote { num: number; frame: number; note: string }

export const QC_MAX_LEN = 500;
export const qcKey = (jobId: number, num: number, frame: number) => `${jobId}:${num}:${frame}`;

export function parseQc(raw: string | null): Record<string, string> {
  try {
    const o = JSON.parse(raw ?? '{}') as unknown;
    if (!o || typeof o !== 'object' || Array.isArray(o)) return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(o)) if (typeof v === 'string' && v.trim() && /^\d+:\d+:\d+$/.test(k)) out[k] = v.slice(0, QC_MAX_LEN);
    return out;
  } catch { return {}; }
}

/** Ghi chú của một job, sắp theo ID rồi frame. */
export function notesOfJob(all: Record<string, string>, jobId: number): QcNote[] {
  const out: QcNote[] = [];
  for (const [k, note] of Object.entries(all)) {
    const [j, n, f] = k.split(':').map(Number);
    if (j === jobId && note.trim()) out.push({ num: n!, frame: f!, note });
  }
  return out.sort((a, b) => a.num - b.num || a.frame - b.frame);
}

export const QC_HEADER = ['ID', 'frame', 'note'];
export const notesToRows = (notes: QcNote[]): (string | number)[][] => [QC_HEADER, ...notes.map((n) => [n.num, n.frame, n.note])];
