/**
 * Phép quay 3D nhỏ gọn cho box nghiêng theo mặt đường. Quy ước góc của CVAT 3D (three.js, thứ tự Euler XYZ):
 * R = Rx(rx) · Ry(ry) · Rz(yaw) — Rz (yaw) áp trước, rồi Ry, rồi Rx, đều quanh trục thế giới.
 * CHƯA đối chiếu được với dữ liệu thật có rx/ry ≠ 0 (job hiện tại toàn 0); kiểm tra bằng mắt trên CVAT sau khi thử.
 */
export type Mat3 = [number, number, number, number, number, number, number, number, number]; // hàng ưu tiên
export type Vec3 = [number, number, number];

export const rotX = (a: number): Mat3 => { const c = Math.cos(a), s = Math.sin(a); return [1, 0, 0, 0, c, -s, 0, s, c]; };
export const rotY = (a: number): Mat3 => { const c = Math.cos(a), s = Math.sin(a); return [c, 0, s, 0, 1, 0, -s, 0, c]; };
export const rotZ = (a: number): Mat3 => { const c = Math.cos(a), s = Math.sin(a); return [c, -s, 0, s, c, 0, 0, 0, 1]; };

export function mul(a: Mat3, b: Mat3): Mat3 {
  const o = new Array<number>(9).fill(0) as Mat3;
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[r * 3 + c] = a[r * 3]! * b[c]! + a[r * 3 + 1]! * b[3 + c]! + a[r * 3 + 2]! * b[6 + c]!;
  return o;
}
export const apply = (m: Mat3, v: Vec3): Vec3 => [
  m[0] * v[0] + m[1] * v[1] + m[2] * v[2], m[3] * v[0] + m[4] * v[1] + m[5] * v[2], m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
];

export const transpose = (m: Mat3): Mat3 => [m[0], m[3], m[6], m[1], m[4], m[7], m[2], m[5], m[8]];

/** R = Rx · Ry · Rz (thứ tự Euler XYZ của three.js). */
export const fromEuler = (rx: number, ry: number, rz: number): Mat3 => mul(rotX(rx), mul(rotY(ry), rotZ(rz)));

/** Tách (rx, ry, rz) từ R theo thứ tự XYZ (giống three.js `Euler.setFromRotationMatrix`). */
export function toEuler(m: Mat3): { rx: number; ry: number; rz: number } {
  const ry = Math.asin(Math.max(-1, Math.min(1, m[2])));
  if (Math.abs(m[2]) < 0.9999999) return { rx: Math.atan2(-m[5], m[8]), ry, rz: Math.atan2(-m[1], m[0]) };
  return { rx: Math.atan2(m[7], m[4]), ry, rz: 0 };
}

export const wrapPi = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
