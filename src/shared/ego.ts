import { stateAt } from './interp';
import type { EgoMotion, EgoStep } from './egoCore';
import type { CvatTrack } from './types';

export { getEgo, setEgo, toFrame, transform } from './egoCore';
export type { EgoMotion, EgoStep } from './egoCore';

const MIN_INLIERS = 4;
const MIN_RATIO = 0.4;
const INLIER_DIST = 0.7; // m
const ITERATIONS = 600;

/** RANSAC 2 điểm trên các cặp (vị trí ở f−1, vị trí ở f) của mọi object có keyframe ở cả hai frame; bộ sinh số giả ngẫu nhiên cố định cho kết quả lặp lại được. */
export function estimateEgo(tracks: CvatTrack[], start: number, stop: number): EgoMotion {
  const steps = new Map<number, EgoStep>();
  let seed = 12345;
  const rnd = () => { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  for (let f = start + 1; f <= stop; f++) {
    const P: [number, number, number, number][] = [];
    for (const t of tracks) {
      const a = stateAt(t, f - 1), b = stateAt(t, f);
      if (a.status === 'key' && b.status === 'key' && a.cuboid && b.cuboid) P.push([a.cuboid.x, a.cuboid.y, b.cuboid.x, b.cuboid.y]);
    }
    if (P.length < MIN_INLIERS) continue;
    let best: EgoStep | null = null;
    for (let it = 0; it < ITERATIONS; it++) {
      const i = Math.floor(rnd() * P.length), j = Math.floor(rnd() * P.length);
      if (i === j) continue;
      const [ax, ay, bx, by] = P[i]!, [cx, cy, dx, dy] = P[j]!;
      // hai điểm tĩnh phải giữ nguyên khoảng cách sau phép biến đổi cứng
      if (Math.abs(Math.hypot(cx - ax, cy - ay) - Math.hypot(dx - bx, dy - by)) > 0.5) continue;
      const theta = Math.atan2(dy - by, dx - bx) - Math.atan2(cy - ay, cx - ax);
      const c = Math.cos(theta), s = Math.sin(theta);
      const tx = bx - (c * ax - s * ay), ty = by - (s * ax + c * ay);
      let n = 0;
      for (const [px, py, qx, qy] of P) if (Math.hypot(c * px - s * py + tx - qx, s * px + c * py + ty - qy) < INLIER_DIST) n++;
      if (!best || n > best.inliers) best = { c, s, tx, ty, theta, inliers: n, pairs: P.length };
    }
    if (best && best.inliers >= MIN_INLIERS && best.inliers / best.pairs >= MIN_RATIO) steps.set(f, best);
  }
  return { start, steps };
}
