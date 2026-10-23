import type { CvatAnnotations, CvatTrack, Violation } from './types';

/** Các frame outside thiếu keyframe của một track (trong REST, mỗi shape của track là một keyframe). */
export function missingOutsideKeyframes(track: CvatTrack, stopFrame: number): number[] {
  const shapes = [...track.shapes].sort((a, b) => a.frame - b.frame);
  const missing: number[] = [];
  shapes.forEach((s, i) => {
    if (!s.outside) return;
    const next = shapes[i + 1];
    const end = next ? next.frame - 1 : stopFrame; // frame cuối cần phủ
    for (let f = s.frame + 1; f <= end; f++) missing.push(f);
  });
  return missing;
}

export function checkOutsideKeyframes(
  annotations: CvatAnnotations,
  stopFrame: number,
): Violation[] {
  const out: Violation[] = [];
  for (const t of annotations.tracks) {
    const frames = missingOutsideKeyframes(t, stopFrame);
    if (frames.length) {
      out.push({
        rule: 'outside-missing-keyframe',
        trackId: t.id,
        frames,
        message: `Track ${t.id}: ${frames.length} frame outside thiếu keyframe`,
      });
    }
  }
  return out;
}

/** ID có trong baseline mà working không còn → chặn upload. */
export function checkIdsNotRemoved(
  baselineIds: readonly number[],
  workingIds: readonly number[],
): Violation[] {
  const have = new Set(workingIds);
  return baselineIds
    .filter((id) => !have.has(id))
    .map((id) => ({
      rule: 'id-removed' as const,
      trackId: id,
      message: `Track ${id} biến mất so với baseline`,
    }));
}

export function trackIds(a: CvatAnnotations): number[] {
  return a.tracks.map((t) => t.id).filter((id): id is number => typeof id === 'number');
}

/** Toàn bộ kiểm tra bất biến chạy trước upload. Rỗng = được phép. */
export function validateUpload(
  baseline: CvatAnnotations,
  working: CvatAnnotations,
  stopFrame: number,
): Violation[] {
  return [
    ...checkIdsNotRemoved(trackIds(baseline), trackIds(working)),
    ...checkOutsideKeyframes(working, stopFrame),
  ];
}
