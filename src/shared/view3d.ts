import type { Cuboid } from './cuboid';

/**
 * View 3D (cửa sổ phụ): toán thuần, không đụng DOM / WebGL nên kiểm thử được.
 * Hệ toạ độ của view: gốc = tâm box đang chọn, u theo hướng box (yaw), v sang trái, w lên (mét).
 */

export interface Gathered { pos: Float32Array; inBox: Uint8Array; n: number }

/** Điểm trong bán kính `radius` quanh tâm box `c`, đổi sang hệ của view; `inBox` = 1 khi điểm nằm trong box. Quá `maxPts` thì lấy cách đều. */
export function gatherAround(xyz: Float32Array, count: number, c: Cuboid, radius: number, maxPts = 250000): Gathered {
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw), r2 = radius * radius;
  const hu = c.sx / 2, hv = c.sy / 2, hw = c.sz / 2;
  const pos = new Float32Array(Math.min(count, maxPts) * 3), inBox = new Uint8Array(Math.min(count, maxPts));
  let n = 0;
  for (let i = 0; i < count; i++) {
    const dx = xyz[i * 3]! - c.x;
    if (dx > radius || dx < -radius) continue;
    const dy = xyz[i * 3 + 1]! - c.y;
    if (dy > radius || dy < -radius) continue;
    const dz = xyz[i * 3 + 2]! - c.z;
    if (dz > radius || dz < -radius) continue;
    if (dx * dx + dy * dy + dz * dz > r2) continue;
    if (n >= maxPts) break;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    pos[n * 3] = u; pos[n * 3 + 1] = v; pos[n * 3 + 2] = dz;
    inBox[n] = Math.abs(u) <= hu && Math.abs(v) <= hv && Math.abs(dz) <= hw ? 1 : 0;
    n++;
  }
  return { pos: pos.subarray(0, n * 3), inBox: inBox.subarray(0, n), n };
}

/**
 * Thêm vùng nhỏ quanh ego (gốc hệ ego, `egoRadius` m) vào view; điểm đã nằm trong vùng quanh box (`boxRadius`) bị bỏ để không trùng.
 * Trả điểm đã đổi sang hệ của view tâm `c` (như gatherAround).
 */
export function gatherEgoArea(xyz: Float32Array, count: number, c: Cuboid, egoRadius: number, boxRadius: number, maxPts = 120000): Gathered {
  if (egoRadius <= 0) return { pos: new Float32Array(0), inBox: new Uint8Array(0), n: 0 };
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw), e2 = egoRadius * egoRadius, b2 = boxRadius * boxRadius;
  const pos = new Float32Array(Math.min(count, maxPts) * 3), inBox = new Uint8Array(Math.min(count, maxPts));
  let n = 0;
  for (let i = 0; i < count; i++) {
    const x = xyz[i * 3]!, y = xyz[i * 3 + 1]!, z = xyz[i * 3 + 2]!;
    if (x > egoRadius || x < -egoRadius || y > egoRadius || y < -egoRadius || z > egoRadius || z < -egoRadius) continue;
    if (x * x + y * y + z * z > e2) continue;
    const dx = x - c.x, dy = y - c.y, dz = z - c.z;
    if (dx * dx + dy * dy + dz * dz <= b2) continue; // đã có ở vùng quanh box
    if (n >= maxPts) break;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    pos[n * 3] = u; pos[n * 3 + 1] = v; pos[n * 3 + 2] = dz;
    inBox[n] = Math.abs(u) <= c.sx / 2 && Math.abs(v) <= c.sy / 2 && Math.abs(dz) <= c.sz / 2 ? 1 : 0;
    n++;
  }
  return { pos: pos.subarray(0, n * 3), inBox: inBox.subarray(0, n), n };
}

/** Vị trí ego (gốc hệ ego, mặt đất dưới xe) và hướng trước của nó (Ox) viết trong hệ của view tâm `c`. */
export function egoInView(c: Cuboid): { x: number; y: number; z: number; heading: number; dist: number } {
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
  return { x: -(c.x * cos + c.y * sin), y: -(-c.x * sin + c.y * cos), z: -c.z, heading: -c.yaw, dist: Math.hypot(c.x, c.y) };
}

/**
 * Dấu ego: vòng tròn trên mặt đất, cọc thẳng đứng lên tới biểu tượng nổi (vẽ bằng 2D ở View3D) và đường nối từ tâm box tới ego.
 * Mỗi đỉnh 6 số (x, y, z, r, g, b), cặp đỉnh = một đoạn. `icon` = vị trí biểu tượng nổi, `ahead` = điểm phía trước nó 1.5 m (theo hướng
 * trước của ego) để xoay biểu tượng theo hướng nhìn.
 */
export const EGO_ICON_HEIGHT = 1.8;
export function egoMarker(c: Cuboid): { lines: Float32Array; icon: [number, number, number]; ahead: [number, number, number]; dist: number } {
  const e = egoInView(c);
  const ch = Math.cos(e.heading), sh = Math.sin(e.heading);
  const at = (a: number, b: number, h = 0): [number, number, number] => [e.x + a * ch - b * sh, e.y + a * sh + b * ch, e.z + h];
  const out: number[] = [];
  const seg = (p: number[], q: number[], col: number[]) => out.push(...p, ...col, ...q, ...col);
  const RED = [1, 0.25, 0.25], WHITE = [0.95, 0.95, 0.95], GRAY = [0.55, 0.6, 0.68];
  const N = 28;
  for (let i = 0; i < N; i++) {
    const a = (i / N) * 2 * Math.PI, b = ((i + 1) / N) * 2 * Math.PI;
    seg(at(Math.cos(a), Math.sin(a)), at(Math.cos(b), Math.sin(b)), WHITE);
  }
  seg(at(0, 0), at(0, 0, EGO_ICON_HEIGHT), RED); // cọc
  seg([0, 0, 0], at(0, 0), GRAY); // box → ego
  return { lines: Float32Array.from(out), icon: at(0, 0, EGO_ICON_HEIGHT), ahead: at(1.5, 0, EGO_ICON_HEIGHT), dist: e.dist };
}

/** Góc quay (độ, trong (−180, 180]) của box so với hướng trước của ego: yaw của box trong hệ ego chính là góc lệch so với ego. */
export function yawVsEgoDeg(yaw: number): number {
  let d = (yaw * 180) / Math.PI;
  while (d > 180) d -= 360;
  while (d <= -180) d += 360;
  return d;
}

export interface Box3 { cu: number; cv: number; cw: number; yaw: number; sx: number; sy: number; sz: number }

/** Box `o` (hệ ego) viết trong hệ của view tâm `c`; null nếu tâm của nó xa hơn `radius` + nửa đường chéo (trừ khi `always`). */
export function boxInView(c: Cuboid, o: Cuboid, radius: number, always = false): Box3 | null {
  const dx = o.x - c.x, dy = o.y - c.y, dz = o.z - c.z;
  const reach = radius + Math.hypot(o.sx, o.sy, o.sz) / 2;
  if (!always && dx * dx + dy * dy + dz * dz > reach * reach) return null;
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
  return { cu: dx * cos + dy * sin, cv: -dx * sin + dy * cos, cw: dz, yaw: o.yaw - c.yaw, sx: o.sx, sy: o.sy, sz: o.sz };
}

/** 14 đoạn: 12 cạnh của box + 2 đường chéo của mặt trước (+u) để thấy hướng. Mỗi đoạn 2 đỉnh × 3 số. */
export function boxEdges(b: Box3): Float32Array {
  const cos = Math.cos(b.yaw), sin = Math.sin(b.yaw);
  const corner = (sa: number, sb: number, sc: number): [number, number, number] => {
    const a = (sa * b.sx) / 2, bb = (sb * b.sy) / 2;
    return [b.cu + a * cos - bb * sin, b.cv + a * sin + bb * cos, b.cw + (sc * b.sz) / 2];
  };
  const k: [number, number, number][] = [];
  for (const sc of [-1, 1]) for (const sb of [-1, 1]) for (const sa of [-1, 1]) k.push(corner(sa, sb, sc));
  // chỉ số đỉnh: bit0 = u, bit1 = v, bit2 = w
  const edges: [number, number][] = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7], [1, 6], [3, 4]];
  const out = new Float32Array(edges.length * 6);
  edges.forEach(([i, j], e) => { out.set(k[i]!, e * 6); out.set(k[j]!, e * 6 + 3); });
  return out;
}

// ---- Ma trận 4×4 (cột trước, như WebGL) ----
export type Mat4 = Float32Array;
export function perspective(fovy: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovy / 2), m = new Float32Array(16);
  m[0] = f / aspect; m[5] = f; m[10] = (far + near) / (near - far); m[11] = -1; m[14] = (2 * far * near) / (near - far);
  return m;
}
export function lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Mat4 {
  const sub = (a: number[], b: number[]) => [a[0]! - b[0]!, a[1]! - b[1]!, a[2]! - b[2]!];
  const norm = (a: number[]) => { const l = Math.hypot(a[0]!, a[1]!, a[2]!) || 1; return [a[0]! / l, a[1]! / l, a[2]! / l]; };
  const cross = (a: number[], b: number[]) => [a[1]! * b[2]! - a[2]! * b[1]!, a[2]! * b[0]! - a[0]! * b[2]!, a[0]! * b[1]! - a[1]! * b[0]!];
  const dot = (a: number[], b: number[]) => a[0]! * b[0]! + a[1]! * b[1]! + a[2]! * b[2]!;
  const z = norm(sub(eye, target)), x = norm(cross(up, z)), y = cross(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]!; m[4] = x[1]!; m[8] = x[2]!; m[12] = -dot(x, eye);
  m[1] = y[0]!; m[5] = y[1]!; m[9] = y[2]!; m[13] = -dot(y, eye);
  m[2] = z[0]!; m[6] = z[1]!; m[10] = z[2]!; m[14] = -dot(z, eye);
  m[15] = 1;
  return m;
}
export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Float32Array(16);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}
/** Chiếu một điểm lên màn hình w × h (px); null khi nằm sau camera. */
export function projectPoint(m: Mat4, x: number, y: number, z: number, w: number, h: number): [number, number] | null {
  const cx = m[0]! * x + m[4]! * y + m[8]! * z + m[12]!, cy = m[1]! * x + m[5]! * y + m[9]! * z + m[13]!;
  const cw = m[3]! * x + m[7]! * y + m[11]! * z + m[15]!;
  if (cw <= 1e-6) return null;
  return [((cx / cw) * 0.5 + 0.5) * w, (1 - (cy / cw * 0.5 + 0.5)) * h];
}

/** Camera quay quanh gốc: azimuth (quanh trục w), elevation (so với mặt ngang), khoảng cách. */
export interface Orbit { az: number; el: number; dist: number }
export const ORBIT_EL_MAX = (89 * Math.PI) / 180;
export function orbitMatrix(o: Orbit, aspect: number, radius: number): Mat4 {
  const eye: [number, number, number] = [o.dist * Math.cos(o.el) * Math.cos(o.az), o.dist * Math.cos(o.el) * Math.sin(o.az), o.dist * Math.sin(o.el)];
  return mul(perspective((50 * Math.PI) / 180, aspect, 0.1, o.dist + radius * 3), lookAt(eye, [0, 0, 0], [0, 0, 1]));
}
export const defaultOrbit = (radius: number): Orbit => ({ az: (-140 * Math.PI) / 180, el: (30 * Math.PI) / 180, dist: Math.max(6, radius * 1.4) });

/** Màu theo độ cao (cùng thang xanh → xanh lá → cam như các view 2D); t ∈ [0, 1]. */
export function heightColor(t: number): [number, number, number] {
  const h = (220 - Math.min(1, Math.max(0, t)) * 200) / 60, s = 0.8, l = 0.55;
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs((h % 2) - 1));
  const [r, g, b] = h < 1 ? [c, x, 0] : h < 2 ? [x, c, 0] : h < 3 ? [0, c, x] : h < 4 ? [0, x, c] : h < 5 ? [x, 0, c] : [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}
