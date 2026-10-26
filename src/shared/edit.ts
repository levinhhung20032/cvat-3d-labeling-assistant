import { clampTilt, serializeCuboid, type Cuboid } from './cuboid';
import { apply, fromEuler, mul, rotX, rotY, rotZ, toEuler, transpose, type Mat3, type Vec3 } from './rot';
import { sortedShapes } from './interp';
import type { CvatShape, CvatTrack } from './types';

export type View = 'top' | 'side' | 'front';
export type Axis = 'u' | 'v' | 'w'; // u: dọc hướng box, v: sang trái, w: lên

/** Hộp trong hệ tọa độ của box lúc bắt đầu kéo (gốc = tâm box ban đầu, trục u theo yaw ban đầu). */
export interface LocalBox {
  cu: number; cv: number; cw: number; // tâm
  dyaw: number; // xoay thêm quanh trục z
  sx: number; sy: number; sz: number;
  // Xoay thêm quanh trục RIÊNG của box (rad): droll quanh trục dọc (u), dpitch quanh trục ngang (v). Mặc định 0.
  droll?: number; dpitch?: number;
  color?: string; // chỉ để vẽ box phụ (gợi ý vật chưa gán nhãn…) bằng màu riêng
}

export const identityBox = (c: Cuboid): LocalBox => ({ cu: 0, cv: 0, cw: 0, dyaw: 0, sx: c.sx, sy: c.sy, sz: c.sz });

/** Box `other` trong hệ tọa độ của box `base` (để vẽ box của object khác lên ô của object đang xem). */
export function localBoxOf(base: Cuboid, other: Cuboid): LocalBox {
  const dx = other.x - base.x, dy = other.y - base.y, cos = Math.cos(base.yaw), sin = Math.sin(base.yaw);
  return { cu: dx * cos + dy * sin, cv: -dx * sin + dy * cos, cw: other.z - base.z, dyaw: other.yaw - base.yaw, sx: other.sx, sy: other.sy, sz: other.sz };
}

const hasTiltDelta = (b: LocalBox) => (b.droll ?? 0) !== 0 || (b.dpitch ?? 0) !== 0;

export function applyLocalBox(base: Cuboid, b: LocalBox): Cuboid {
  const cos = Math.cos(base.yaw), sin = Math.sin(base.yaw);
  let { rx, ry } = base, yaw = base.yaw + b.dyaw;
  if (hasTiltDelta(b)) {
    // Xoay quanh trục riêng của box rồi tách lại thành (rx, ry, yaw) theo quy ước Euler XYZ của CVAT.
    const r = mul(mul(fromEuler(base.rx, base.ry, yaw), rotX(b.droll ?? 0)), rotY(b.dpitch ?? 0));
    const e = toEuler(r);
    rx = e.rx; ry = e.ry; yaw = e.rz;
  }
  return {
    x: base.x + b.cu * cos - b.cv * sin,
    y: base.y + b.cu * sin + b.cv * cos,
    z: base.z + b.cw,
    rx: clampTilt(rx), ry: clampTilt(ry), // roll / pitch được giữ (kẹp ±30°); yaw là góc chính
    yaw,
    sx: b.sx, sy: b.sy, sz: b.sz,
  };
}

/** Điểm p (toạ độ riêng của box, gốc ở tâm box) trong hệ toạ độ "chỉ theo yaw ban đầu" của ô, có tính box nghiêng. */
export function cornerOffset(base: Pick<Cuboid, 'rx' | 'ry' | 'yaw'>, b: LocalBox, p: Vec3): Vec3 {
  const r = mul(mul(fromEuler(base.rx, base.ry, base.yaw + b.dyaw), rotX(b.droll ?? 0)), rotY(b.dpitch ?? 0));
  return apply(rotZ(-base.yaw), apply(r, p));
}
/**
 * Khung nhìn căn theo box: ma trận đổi toạ độ từ hệ "chỉ theo yaw" (hệ của localize) sang hệ trục riêng của box lúc bắt đầu,
 * để cả 3 view nhìn vuông góc với các mặt box và box không bao giờ bị thấy nghiêng (mặt đường mới là thứ nghiêng).
 * null nếu box không nghiêng (hai hệ trùng nhau).
 */
export function viewFrame(c: Pick<Cuboid, 'rx' | 'ry' | 'yaw'>): Mat3 | null {
  if (!c.rx && !c.ry) return null;
  return mul(transpose(fromEuler(c.rx, c.ry, c.yaw)), rotZ(c.yaw));
}
/** Điểm p (toạ độ riêng của box đang kéo) trong KHUNG NHÌN căn theo box ban đầu (gốc ở tâm box, chưa cộng tâm). */
export function cornerInView(base: Pick<Cuboid, 'rx' | 'ry' | 'yaw'>, b: LocalBox, p: Vec3): Vec3 {
  const r = mul(mul(fromEuler(base.rx, base.ry, base.yaw + b.dyaw), rotX(b.droll ?? 0)), rotY(b.dpitch ?? 0));
  return apply(transpose(fromEuler(base.rx, base.ry, base.yaw)), apply(r, p));
}
export const isTilted = (base: Pick<Cuboid, 'rx' | 'ry'>, b: LocalBox) => base.rx !== 0 || base.ry !== 0 || hasTiltDelta(b);

const AXES: Record<View, [Axis, Axis]> = { top: ['u', 'v'], side: ['u', 'w'], front: ['v', 'w'] };
const CENTER = { u: 'cu', v: 'cv', w: 'cw' } as const;
const SIZE = { u: 'sx', v: 'sy', w: 'sz' } as const;
const MIN_SIZE = 0.05;
export const HANDLE_OFFSET = 0.4; // mét, từ mặt trước tới tay nắm xoay (ngắn)
export const HANDLE_MIN_PX = 12; // nhưng luôn cách mặt trước ít nhất ngần này px để không dính tay nắm cạnh
/** Khoảng cách (m) từ mặt trước tới tay nắm xoay ở tỉ lệ k px/m. */
export const handleOffset = (k: number) => Math.max(HANDLE_OFFSET, HANDLE_MIN_PX / k);

/** Độ dời (mét) theo trục object ứng với dịch chuyển màn hình (dx, dy px); k = px/mét. */
export function axisDelta(view: View, axis: Axis, dx: number, dy: number, k: number): number {
  if (view === 'top') return axis === 'u' ? -dy / k : axis === 'v' ? -dx / k : 0;
  if (view === 'side') return axis === 'u' ? dx / k : axis === 'w' ? -dy / k : 0;
  return axis === 'v' ? dx / k : axis === 'w' ? -dy / k : 0;
}

/** Kéo một GÓC: đổi cả hai cạnh cùng lúc (hai cạnh đối diện đứng yên). */
export function dragCorner(view: View, b: LocalBox, h: [Axis, 1 | -1], v: [Axis, 1 | -1], dx: number, dy: number, k: number): LocalBox {
  return dragEdge(view, dragEdge(view, b, h[0], h[1], dx, dy, k), v[0], v[1], dx, dy, k);
}

export function dragMove(view: View, b: LocalBox, dx: number, dy: number, k: number): LocalBox {
  const r = { ...b };
  for (const a of AXES[view]) r[CENTER[a]] += axisDelta(view, a, dx, dy, k);
  return r;
}

/** Kéo một cạnh: chỉ cạnh đó dịch chuyển, cạnh đối diện đứng yên. sign = +1 cho cạnh ở phía trục dương. */
export function dragEdge(view: View, b: LocalBox, axis: Axis, sign: 1 | -1, dx: number, dy: number, k: number): LocalBox {
  const r = { ...b };
  const size = Math.max(MIN_SIZE, b[SIZE[axis]] + sign * axisDelta(view, axis, dx, dy, k));
  r[CENTER[axis]] += (sign * (size - b[SIZE[axis]])) / 2;
  r[SIZE[axis]] = size;
  return r;
}

/**
 * Xoay quanh trục khác trên view Bên (pitch, quanh trục ngang) hoặc view Trước (roll, quanh trục dọc): góc con trỏ quanh tâm ô
 * so với lúc bắt đầu kéo. View Trên không có phép xoay này (trả nguyên box).
 */
export function dragTilt(view: View, b: LocalBox, p0x: number, p0y: number, px: number, py: number): LocalBox {
  if (view === 'top' || Math.hypot(p0x, p0y) < 4 || Math.hypot(px, py) < 4) return b;
  let d = Math.atan2(-py, px) - Math.atan2(-p0y, p0x); // ngược chiều kim đồng hồ trên màn hình = dương
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  // Quay quanh +v (view Bên): dương = đầu xe chúi xuống nên đổi dấu; quanh +u (view Trước): dương = phía +v nâng lên.
  return view === 'side' ? { ...b, dpitch: -d } : { ...b, droll: d };
}

/** Xoay yaw trên hình chiếu từ trên: (px, py) so với tâm ô, hướng box quay về phía con trỏ. */
export function dragRotate(b: LocalBox, px: number, py: number): LocalBox {
  return { ...b, dyaw: Math.atan2(-px, -py) };
}

/**
 * Xoay tương đối: góc con trỏ quanh tâm ô (px, py tính từ tâm) so với lúc bắt đầu kéo, nên không bị nhảy.
 * Dùng cho tay nắm đỏ và cho chế độ giữ Alt. Nếu điểm bắt đầu quá sát tâm thì góc không xác định → không xoay.
 */
export function dragRotateRel(b: LocalBox, p0x: number, p0y: number, px: number, py: number): LocalBox {
  if (Math.hypot(p0x, p0y) < 4 || Math.hypot(px, py) < 4) return b;
  let d = Math.atan2(-px, -py) - Math.atan2(-p0x, -p0y);
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d <= -Math.PI) d += 2 * Math.PI;
  return { ...b, dyaw: d };
}

/** Xoay theo độ dời ngang (dùng ở view Bên / Trước, nơi không đọc được góc yaw từ con trỏ): kéo sang trái = +yaw. */
export const YAW_PER_PX = (0.5 * Math.PI) / 180;
export function dragYawByX(b: LocalBox, dx: number): LocalBox {
  return { ...b, dyaw: -dx * YAW_PER_PX };
}

export type Hit =
  | { mode: 'rotate' }
  | { mode: 'edge'; axis: Axis; sign: 1 | -1 }
  | { mode: 'corner'; h: [Axis, 1 | -1]; v: [Axis, 1 | -1]; diag: 'nwse' | 'nesw' } // góc: kéo cùng lúc cạnh dọc và cạnh ngang
  | { mode: 'move' }
  | null;

const EDGES: Record<View, { left: [Axis, 1 | -1]; right: [Axis, 1 | -1]; top: [Axis, 1 | -1]; bottom: [Axis, 1 | -1] }> = {
  top: { left: ['v', 1], right: ['v', -1], top: ['u', 1], bottom: ['u', -1] },
  side: { left: ['u', -1], right: ['u', 1], top: ['w', 1], bottom: ['w', -1] },
  front: { left: ['v', -1], right: ['v', 1], top: ['w', 1], bottom: ['w', -1] },
};

/** Hộp (dyaw = 0) trên màn hình ô: left/right/top/bottom theo px. */
export function screenRect(view: View, b: LocalBox, size: number, half: number) {
  const k = size / (2 * half), c = size / 2;
  const hu = b.sx / 2, hv = b.sy / 2, hw = b.sz / 2;
  if (view === 'top') return { left: c - (b.cv + hv) * k, right: c - (b.cv - hv) * k, top: c - (b.cu + hu) * k, bottom: c - (b.cu - hu) * k };
  if (view === 'side') return { left: c + (b.cu - hu) * k, right: c + (b.cu + hu) * k, top: c - (b.cw + hw) * k, bottom: c - (b.cw - hw) * k };
  return { left: c + (b.cv - hv) * k, right: c + (b.cv + hv) * k, top: c - (b.cw + hw) * k, bottom: c - (b.cw - hw) * k };
}

export function hitTest(view: View, b: LocalBox, px: number, py: number, size: number, half: number, tol = 4): Hit {
  const k = size / (2 * half), c = size / 2;
  if (view === 'top') {
    const tx = c - b.cv * k, ty = c - (b.cu + b.sx / 2 + handleOffset(k)) * k; // đầu mũi tên
    if (Math.hypot(px - tx, py - ty) <= 6) return { mode: 'rotate' };
  }
  const r = screenRect(view, b, size, half);
  const inX = px >= r.left - tol && px <= r.right + tol;
  const inY = py >= r.top - tol && py <= r.bottom + tol;
  if (!inX || !inY) return null;
  // Gần một GÓC (cả hai cạnh dọc và ngang cùng trong tầm) → kéo cùng lúc hai cạnh.
  const ct = Math.min(tol * 2, Math.min(r.right - r.left, r.bottom - r.top) / 4); // vùng góc nhỏ lại khi box bé trên màn hình
  const nearL = Math.abs(px - r.left) <= ct, nearR = Math.abs(px - r.right) <= ct;
  const nearT = Math.abs(py - r.top) <= ct, nearB = Math.abs(py - r.bottom) <= ct;
  if ((nearL || nearR) && (nearT || nearB)) {
    const h = nearL && (!nearR || Math.abs(px - r.left) <= Math.abs(px - r.right)) ? EDGES[view].left : EDGES[view].right;
    const v = nearT && (!nearB || Math.abs(py - r.top) <= Math.abs(py - r.bottom)) ? EDGES[view].top : EDGES[view].bottom;
    const left = h === EDGES[view].left, top = v === EDGES[view].top;
    return { mode: 'corner', h, v, diag: left === top ? 'nwse' : 'nesw' };
  }
  const cand: { d: number; e: [Axis, 1 | -1] }[] = [
    { d: Math.abs(px - r.left), e: EDGES[view].left },
    { d: Math.abs(px - r.right), e: EDGES[view].right },
    { d: Math.abs(py - r.top), e: EDGES[view].top },
    { d: Math.abs(py - r.bottom), e: EDGES[view].bottom },
  ].filter((x) => x.d <= tol);
  if (cand.length) {
    const best = cand.reduce((a, x) => (x.d < a.d ? x : a));
    return { mode: 'edge', axis: best.e[0], sign: best.e[1] };
  }
  return { mode: 'move' };
}

/** Đặt/ghi đè keyframe tại `frame` với cuboid mới; mọi chỉnh sửa đều thành keyframe. Không đổi ID track. */
export function upsertKeyframe(track: CvatTrack, frame: number, cub: Cuboid, outside = false): CvatTrack {
  const shapes = sortedShapes(track);
  const existing = shapes.find((s) => s.frame === frame);
  const prev = [...shapes].reverse().find((s) => s.frame < frame) ?? shapes[0]!;
  const tpl = existing ?? prev;
  const points = serializeCuboid(cub, tpl.points);
  let shape: CvatShape;
  if (existing) shape = { ...existing, points, outside };
  else {
    const { id: _id, ...rest } = structuredClone(tpl);
    shape = { ...rest, type: 'cuboid', frame, outside, rotation: 0, points };
  }
  const next = shapes.filter((s) => s.frame !== frame).concat(shape).sort((a, b) => a.frame - b.frame);
  return { ...track, frame: Math.min(track.frame, frame), shapes: next };
}
