import { checkOutsideKeyframes } from './rules';
import type { CvatAnnotations, CvatJob, CvatLabel, Violation } from './types';

export interface TrackSample {
  id?: number;
  label_id: number;
  frame: number;
  shapeCount: number;
  firstShapes: unknown[]; // 3 shape đầu, nguyên văn
  pointsLengths: number[]; // độ dài `points` của các shape mẫu
  keys: string[]; // tên trường cấp track
  shapeKeys: string[]; // tên trường cấp shape
}

export interface Summary {
  job: { id: number; task_id: number; start_frame: number; stop_frame: number; dimension?: string };
  version: number;
  trackCount: number;
  shapeCount: number;
  tagCount: number;
  perLabel: { labelId: number; name: string; tracks: number }[];
  sample: TrackSample | null;
  outsideViolations: Violation[];
}

export function summarize(
  job: CvatJob,
  labels: CvatLabel[],
  ann: CvatAnnotations,
): Summary {
  const names = new Map(labels.map((l) => [l.id, l.name]));
  const counts = new Map<number, number>();
  for (const t of ann.tracks) counts.set(t.label_id, (counts.get(t.label_id) ?? 0) + 1);
  const first = ann.tracks[0];
  const sample: TrackSample | null = first
    ? {
        id: first.id,
        label_id: first.label_id,
        frame: first.frame,
        shapeCount: first.shapes.length,
        firstShapes: first.shapes.slice(0, 3),
        pointsLengths: first.shapes.slice(0, 3).map((s) => s.points.length),
        keys: Object.keys(first),
        shapeKeys: Object.keys(first.shapes[0] ?? {}),
      }
    : null;
  return {
    job: {
      id: job.id,
      task_id: job.task_id,
      start_frame: job.start_frame,
      stop_frame: job.stop_frame,
      dimension: job.dimension,
    },
    version: ann.version,
    trackCount: ann.tracks.length,
    shapeCount: ann.shapes.length,
    tagCount: ann.tags.length,
    perLabel: [...counts].map(([labelId, tracks]) => ({
      labelId,
      name: names.get(labelId) ?? `#${labelId}`,
      tracks,
    })),
    sample,
    outsideViolations: checkOutsideKeyframes(ann, job.stop_frame),
  };
}
