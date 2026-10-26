import { validateUpload } from './rules';
import type { CvatAnnotations, CvatTrack, Violation } from './types';

export type WriteAction = 'create' | 'update' | 'delete';

export interface UploadPayload {
  version: number;
  tags: unknown[];
  shapes: unknown[];
  tracks: CvatTrack[];
}

export interface UploadPlan {
  update: UploadPayload | null; // track sẵn có đã đổi
  create: UploadPayload | null; // track mới (không có id)
}

export class RuleViolationError extends Error {
  constructor(public violations: Violation[]) {
    super(`Chặn upload: ${violations.map((v) => v.message).join('; ')}`);
  }
}

/** Dựng payload từ diff baseline ↔ working. Không bao giờ sinh delete. */
export function planUpload(
  baseline: CvatAnnotations,
  working: CvatAnnotations,
  stopFrame: number,
): UploadPlan {
  const violations = validateUpload(baseline, working, stopFrame);
  if (violations.length) throw new RuleViolationError(violations);

  const before = new Map(baseline.tracks.map((t) => [t.id, JSON.stringify(t)]));
  const changed: CvatTrack[] = [];
  const created: CvatTrack[] = [];
  for (const t of working.tracks) {
    if (typeof t.id !== 'number') created.push(t);
    else if (before.get(t.id) !== JSON.stringify(t)) changed.push(t);
  }
  const wrap = (tracks: CvatTrack[]): UploadPayload | null =>
    tracks.length ? { version: baseline.version, tags: [], shapes: [], tracks } : null;
  return { update: wrap(changed), create: wrap(created) };
}
