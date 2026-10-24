import { parseCuboid, type Cuboid } from './cuboid';
import { sortedShapes } from './interp';
import type { CvatTrack } from './types';

const EPS = 1e-6;
export const sameSize = (a: Pick<Cuboid, 'sx' | 'sy' | 'sz'>, b: Pick<Cuboid, 'sx' | 'sy' | 'sz'>) =>
  Math.abs(a.sx - b.sx) < EPS && Math.abs(a.sy - b.sy) < EPS && Math.abs(a.sz - b.sz) < EPS;

/**
 * Dynamic size TẮT: kích thước của object là một giá trị chung. Đặt kích thước `size` cho mọi keyframe có box
 * của track (keyframe outside giữ nguyên). Chỉ đổi 3 số kích thước, không đổi vị trí / góc / ID.
 * Trả track mới và danh sách frame bị đổi.
 */
export function propagateSize(track: CvatTrack, size: Pick<Cuboid, 'sx' | 'sy' | 'sz'>): { track: CvatTrack; frames: number[] } {
  const frames: number[] = [];
  const shapes = sortedShapes(track).map((s) => {
    if (s.outside) return s;
    if (sameSize(parseCuboid(s.points), size)) return s;
    const points = s.points.slice();
    points[6] = size.sx; points[7] = size.sy; points[8] = size.sz;
    frames.push(s.frame);
    return { ...s, points };
  });
  return { track: frames.length ? { ...track, shapes } : track, frames };
}
