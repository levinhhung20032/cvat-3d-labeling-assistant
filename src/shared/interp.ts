import { parseCuboid, type Cuboid } from './cuboid';
import { getEgo, transform } from './egoCore';
import type { CvatShape, CvatTrack } from './types';

export type Status = 'key' | 'interp' | 'hold' | 'outside-key' | 'outside' | 'none';

export interface FrameState {
  status: Status;
  cuboid: Cuboid | null; // null khi outside hoặc chưa có
}

const sortedCache = new WeakMap<CvatTrack, CvatShape[]>();
export function sortedShapes(t: CvatTrack): CvatShape[] {
  let s = sortedCache.get(t);
  if (!s) {
    s = [...t.shapes].sort((a, b) => a.frame - b.frame);
    sortedCache.set(t, s);
  }
  return s;
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** Nội suy góc theo đường NGẮN nhất (yaw 3,1 → −3,1 rad đi qua ±π, không quay vòng ngược qua 0). */
const lerpAngle = (a: number, b: number, t: number) => a + (((b - a + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI) * t;

/**
 * Trạng thái track tại frame f, theo cách CVAT hiển thị: nội suy tuyến tính giữa hai keyframe
 * không-outside (yaw đi theo cung ngắn nhất); nếu keyframe kế tiếp là outside thì giữ nguyên giá trị; shape outside kéo dài tới shape kế.
 */
export function stateAt(track: CvatTrack, f: number): FrameState {
  const shapes = sortedShapes(track);
  let lo = 0;
  let hi = shapes.length - 1;
  let idx = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (shapes[mid]!.frame <= f) { idx = mid; lo = mid + 1; } else hi = mid - 1;
  }
  if (idx < 0) return { status: 'none', cuboid: null };
  const s = shapes[idx]!;
  if (s.outside) return { status: s.frame === f ? 'outside-key' : 'outside', cuboid: null };
  const a = parseCuboid(s.points);
  if (s.frame === f) return { status: 'key', cuboid: a };
  const next = shapes[idx + 1];
  if (!next || next.outside) return { status: 'hold', cuboid: a };
  const b = parseCuboid(next.points);
  const t = (f - s.frame) / (next.frame - s.frame);
  // Có chuyển động của xe (ego): nội suy theo MẶT ĐẤT rồi đưa về toạ độ frame f, thay vì tuyến tính trong hệ ego (xe đổi tốc độ / xoay thì
  // vật đứng yên không đi đường thẳng trong hệ ego). một job thật, bỏ một frame rồi dự đoán lại: sai số trung vị 0,27 / 1,02 / 1,87 m (tuyến tính,
  // cách 1 / 2 / 3 frame) giảm còn 0,10 / 0,14 / 0,14 m. Thiếu bước ego nào giữa hai keyframe thì nội suy tuyến tính như cũ.
  const ego = getEgo();
  if (ego) {
    const pa = transform(ego, a.x, a.y, a.yaw, s.frame, f), pb = transform(ego, b.x, b.y, b.yaw, next.frame, f);
    if (pa && pb) {
      return {
        status: 'interp',
        cuboid: {
          x: lerp(pa.x, pb.x, t), y: lerp(pa.y, pb.y, t), z: lerp(a.z, b.z, t),
          rx: lerp(a.rx, b.rx, t), ry: lerp(a.ry, b.ry, t), yaw: lerpAngle(pa.yaw, pb.yaw, t),
          sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t), sz: lerp(a.sz, b.sz, t),
        },
      };
    }
  }
  return {
    status: 'interp',
    cuboid: {
      x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t),
      rx: lerp(a.rx, b.rx, t), ry: lerp(a.ry, b.ry, t), yaw: lerpAngle(a.yaw, b.yaw, t),
      sx: lerp(a.sx, b.sx, t), sy: lerp(a.sy, b.sy, t), sz: lerp(a.sz, b.sz, t),
    },
  };
}

/** Cuboid dùng để căn tâm ô: của frame nếu có, không thì box gần nhất trước, rồi sau. */
export function referenceCuboid(track: CvatTrack, f: number, stop: number): Cuboid | null {
  for (let d = 0; d <= stop; d++) {
    const before = f - d >= 0 ? stateAt(track, f - d).cuboid : null;
    if (before) return before;
    const after = f + d <= stop ? stateAt(track, f + d).cuboid : null;
    if (after) return after;
  }
  return null;
}
