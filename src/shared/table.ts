import { missingOutsideKeyframes } from './rules';
import { stateAt } from './interp';
import { motionJump } from './motion';
import { trackIssues } from './qcrules';
import type { CvatAnnotations, CvatLabel } from './types';

export interface ObjectRow {
  num: number; // ID hiển thị như giao diện CVAT: thứ tự trong mảng tracks + 1 (đã xác minh trên job 9999)
  id: number;
  labelId: number;
  label: string;
  assigned: number; // frame có box
  outside: number; // frame outside
  missing: number; // frame outside thiếu keyframe
  first: number | null;
  last: number | null;
  keyframes: number;
  jumps: number; // số frame bị cảnh báo "đi xa bất thường" (không tính frame đã bỏ qua)
  made: 'draft' | 'server' | null; // do tool tạo: 'draft' = mới tạo trong nháp (chưa upload), 'server' = đã upload, có trong sổ của tool
  issuesByKind: Record<string, number>; // số frame vi phạm theo mã (S K Z H D, cộng T trôi box ở App)
  issues: number; // số (frame, loại) vi phạm luật QC S/K/Z/H/D (không tính cái đã bỏ qua)
}

export function buildRows(
  ann: CvatAnnotations, labels: CvatLabel[], start: number, stop: number,
  isIgnored: (num: number, frame: number) => boolean = () => false,
  isIssueIgnored: (num: number, frame: number, kind: string) => boolean = () => false,
  madeIds: ReadonlySet<number> = new Set(),
): ObjectRow[] {
  const names = new Map(labels.map((l) => [l.id, l.name]));
  const rows: ObjectRow[] = [];
  for (const [index, t] of ann.tracks.entries()) {
    let assigned = 0, outside = 0, jumps = 0, first: number | null = null, last: number | null = null;
    const labelName = names.get(t.label_id) ?? '';
    for (let f = start; f <= stop; f++) {
      const s = stateAt(t, f);
      if (s.cuboid && !isIgnored(index + 1, f) && motionJump(t, f, labelName)) jumps++;
      if (s.cuboid) { assigned++; first ??= f; last = f; }
      else if (s.status === 'outside' || s.status === 'outside-key') outside++;
    }
    let issues = 0;
    const issuesByKind: Record<string, number> = {};
    for (const [f, list] of trackIssues(t, labelName, Array.from({ length: stop - start + 1 }, (_, i) => start + i))) {
      for (const i of list) if (!isIssueIgnored(index + 1, f, i.kind)) { issues++; issuesByKind[i.kind] = (issuesByKind[i.kind] ?? 0) + 1; }
    }
    rows.push({
      num: index + 1, id: t.id ?? 0, made: typeof t.id !== 'number' ? 'draft' : madeIds.has(t.id) ? 'server' : null, labelId: t.label_id, label: names.get(t.label_id) ?? `#${t.label_id}`,
      assigned, outside, missing: missingOutsideKeyframes(t, stop).length, first, last,
      keyframes: t.shapes.length, jumps, issues, issuesByKind,
    });
  }
  return rows.sort((a, b) => a.num - b.num);
}

export const windowCount = (start: number, stop: number, step = 5) => Math.max(1, Math.ceil((stop - start) / step));
/** Cửa sổ k = frame start+5k … start+5k+5, cắt ở frame cuối. */
export const windowFrames = (k: number, start: number, stop: number, step = 5, size = 6): number[] => {
  const out: number[] = [];
  for (let f = start + k * step; f < start + k * step + size && f <= stop; f++) out.push(f);
  return out;
};

/**
 * Phân trang danh sách frame cần xem. Chế độ liên tục: mỗi trang `size` frame, hai trang kề nhau chung 1 frame
 * (`overlap` = 1, như cửa sổ 6 frame bước 5). Chế độ chỉ-keyframe: không chung frame (`overlap` = 0).
 */
export const pageStep = (size: number, overlap: number) => Math.max(1, size - overlap);
export const pageCount = (total: number, size: number, overlap: number) =>
  Math.max(1, Math.ceil((overlap ? total - 1 : total) / pageStep(size, overlap)));
export const pageFrames = (list: number[], k: number, size: number, overlap: number): number[] => {
  const a = k * pageStep(size, overlap);
  return list.slice(a, a + size);
};
/** Trang chứa frame f (frame không có trong danh sách → trang của frame gần nhất phía trước). */
export const pageOf = (list: number[], f: number, size: number, overlap: number): number => {
  let i = 0;
  for (let j = 0; j < list.length; j++) if (list[j]! <= f) i = j;
  return Math.floor(i / pageStep(size, overlap));
};
