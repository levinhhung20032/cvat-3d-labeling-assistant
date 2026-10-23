// Bố cục `points` cuboid 3D đã xác minh trên job thật (CVAT 2.77.1): 16 số
// [x, y, z, rx, ry, rz(yaw), sx, sy, sz, 7 số đệm = 0]. Chiều: sx dài, sy rộng, sz cao (theo mẫu xe 4.82×1.97×1.56).
export interface Cuboid {
  x: number; y: number; z: number;
  rx: number; ry: number; yaw: number;
  sx: number; sy: number; sz: number;
}

export const POINTS_LENGTH = 16;

export function parseCuboid(points: readonly number[]): Cuboid {
  if (points.length !== POINTS_LENGTH) throw new Error(`points có ${points.length} số, cần ${POINTS_LENGTH}`);
  const [x, y, z, rx, ry, yaw, sx, sy, sz] = points as [number, number, number, number, number, number, number, number, number];
  return { x, y, z, rx, ry, yaw, sx, sy, sz };
}

/** Ghi lại cuboid; luôn ép rx = ry = 0 (7-DoF). `base` giữ nguyên phần đệm. */
export function serializeCuboid(c: Cuboid, base: readonly number[]): number[] {
  const out = [...base];
  out[0] = c.x; out[1] = c.y; out[2] = c.z;
  out[3] = 0; out[4] = 0; out[5] = c.yaw;
  out[6] = c.sx; out[7] = c.sy; out[8] = c.sz;
  return out;
}

export const hasTilt = (points: readonly number[]) => points[3] !== 0 || points[4] !== 0;

/** Góc phương vị so với xe: atan2(y, x), độ. 0 = trước, +90 = trái. */
export const azimuthDeg = (c: Pick<Cuboid, 'x' | 'y'>) => (Math.atan2(c.y, c.x) * 180) / Math.PI;
