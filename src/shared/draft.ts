import type { CvatAnnotations, CvatTrack } from './types';

/**
 * Bản nháp chưa upload, lưu cục bộ để F5 / đóng tab không mất công sửa. Chỉ lưu các track đã sửa
 * (không lưu cả job) cùng `version` của annotation lúc sửa, để biết bản nháp còn khớp với CVAT hay không.
 */
export interface SavedDraft {
  v: 1;
  jobId: number;
  version: number; // version annotation của CVAT lúc tạo nháp
  savedAt: string; // ISO
  edited: string[]; // khóa "<số thứ tự>:<frame>" các frame đã sửa
  tracks: Record<string, CvatTrack>; // theo chỉ số track (0-based dạng chuỗi)
}

export const draftKey = (jobId: number) => `cvla-draft:${jobId}`;

/** Dựng bản nháp từ trạng thái hiện tại; null nếu chưa sửa gì. */
export function buildDraft(jobId: number, baseline: CvatAnnotations, work: CvatAnnotations, edited: ReadonlySet<string>, now = new Date()): SavedDraft | null {
  if (!edited.size) return null;
  const idx = new Set([...edited].map((k) => Number(k.split(':')[0]) - 1));
  const tracks: Record<string, CvatTrack> = {};
  for (const i of idx) {
    const t = work.tracks[i];
    if (t && t !== baseline.tracks[i]) tracks[String(i)] = t;
  }
  if (!Object.keys(tracks).length) return null;
  return { v: 1, jobId, version: baseline.version, savedAt: now.toISOString(), edited: [...edited], tracks };
}

export type DraftCheck =
  | { ok: true; draft: SavedDraft; trackCount: number }
  | { ok: false; reason: 'none' | 'invalid' | 'other-job' | 'server-changed'; message: string };

/** Đọc bản nháp đã lưu và kiểm tra còn dùng được với baseline hiện tại không. */
export function checkDraft(raw: string | null, jobId: number, baseline: CvatAnnotations): DraftCheck {
  if (!raw) return { ok: false, reason: 'none', message: '' };
  let d: SavedDraft;
  try { d = JSON.parse(raw) as SavedDraft; } catch { return { ok: false, reason: 'invalid', message: 'Bản nháp lưu bị hỏng, đã bỏ qua.' }; }
  if (!d || d.v !== 1 || typeof d.version !== 'number' || !d.tracks || !Array.isArray(d.edited)) {
    return { ok: false, reason: 'invalid', message: 'Bản nháp lưu không đúng định dạng, đã bỏ qua.' };
  }
  if (d.jobId !== jobId) return { ok: false, reason: 'other-job', message: 'Bản nháp thuộc job khác.' };
  if (d.version !== baseline.version) {
    return { ok: false, reason: 'server-changed', message: `Bản nháp cũ (CVAT version ${d.version}) không còn khớp dữ liệu hiện tại trên CVAT (version ${baseline.version}); không áp dụng để tránh ghi đè thay đổi mới.` };
  }
  return { ok: true, draft: d, trackCount: Object.keys(d.tracks).length };
}

/** Áp bản nháp lên baseline. Track nào không khớp ID với baseline thì bỏ qua (và bỏ khóa edited của nó). */
export function applyDraft(d: SavedDraft, baseline: CvatAnnotations): { work: CvatAnnotations; edited: Set<string>; skipped: number[] } {
  const tracks = baseline.tracks.slice();
  const ok = new Set<number>(), skipped: number[] = [];
  for (const [k, t] of Object.entries(d.tracks)) {
    const i = Number(k);
    const base = baseline.tracks[i];
    if (!base || base.id === undefined || t.id !== base.id) { skipped.push(i + 1); continue; }
    tracks[i] = t;
    ok.add(i + 1);
  }
  const edited = new Set(d.edited.filter((key) => ok.has(Number(key.split(':')[0]))));
  return { work: { ...baseline, tracks }, edited, skipped };
}
