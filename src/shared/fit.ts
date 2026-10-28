import { DEFAULT_GROUND, groundSnap } from './ground';

/** Điểm trong hệ tọa độ của box: u dọc hướng box, v sang trái, w lên; gốc = tâm box. */
export interface LocalPoints { u: Float32Array; v: Float32Array; w: Float32Array; n: number }

/** Mặt đường đo được dưới object (hệ box: w = a·u + b·v + c là mặt trên lớp điểm mặt đường) và bề dày dải bỏ qua phía trên nó. */
export interface FitGround { a: number; b: number; c: number; clear: number }

/**
 * Chỉ dùng mặt đường đo được khi phép đo đủ căn cứ; dải bỏ qua = max(groundClear, 3 × phần dư của phép khớp). Không có thì null
 * (đếm điểm như cũ: bỏ lớp groundClear tính từ đáy box).
 */
export function fitGroundOf(
  g: { confident: boolean; plane: { a: number; b: number; c: number }; rms: number } | null | undefined, cfg: FitConfig = DEFAULT_FIT,
): FitGround | null {
  return g?.confident ? { a: g.plane.a, b: g.plane.b, c: g.plane.c, clear: Math.max(cfg.groundClear, 3 * g.rms) } : null;
}

/**
 * Độ cao thấp nhất (w) của một điểm để được tính là của vật tại (u, v). Có mặt đường đo được: trên mặt đường + dải bỏ qua, nhưng
 * không thấp hơn đáy box — box chìm thì bỏ được lớp mặt đường nằm trong box, box lơ lửng thì không cắt mất bánh xe / chân. Không có:
 * cách đáy box groundClear như cũ (box chìm sâu hơn mức này thì mặt đường bị đếm nhầm là điểm của vật).
 */
export const objectFloor = (hw: number, cfg: FitConfig, ground: FitGround | null) => (u: number, v: number) =>
  ground ? Math.max(ground.a * u + ground.b * v + ground.c + ground.clear, -hw) : -hw + cfg.groundClear;

export interface FitConfig {
  margin: number; // m: vùng quanh box được xét để tìm điểm nằm ngoài
  minShell: number; // số điểm ngoài tối thiểu mới cảnh báo
  ratio: number; // tỉ lệ điểm ngoài / (trong + ngoài) vượt ngưỡng mới cảnh báo
  minInside: number; // guideline: box tối thiểu 6 điểm
  groundClear: number; // m: bỏ lớp điểm sát đáy box (mặt đường, bánh xe)
}

export const DEFAULT_FIT: FitConfig = { margin: 0.6, minShell: 12, ratio: 0.2, minInside: 6, groundClear: 0.2 };

export type Side = 'trước' | 'sau' | 'trái' | 'phải' | 'trên';

export interface FitReport {
  level: 'ok' | 'sparse' | 'misfit';
  inside: number;
  outside: number; // điểm nằm sát ngoài box (đã bỏ mặt đường)
  ratio: number;
  side: Side | null; // phía có nhiều điểm lọt ra ngoài nhất
  overshoot: number; // m: điểm lọt ra ngoài trung bình ở phía đó
  message: string;
}

/**
 * Như fitReport nhưng nhận thẳng point cloud (xyz xen kẽ, hệ ego) và box; chỉ gom điểm quanh box nên không cấp phát theo cả frame.
 * Dùng khi cần kiểm hàng loạt (mọi object × mọi frame). Gom cả vành mặt đường quanh box để đo mặt đường riêng của object (dải bỏ qua).
 */
export function fitReportAt(
  xyz: Float32Array, count: number, c: { x: number; y: number; z: number; yaw: number; sx: number; sy: number; sz: number }, cfg: FitConfig = DEFAULT_FIT,
): FitReport {
  const ring = Math.max(cfg.margin, DEFAULT_GROUND.farRing + 0.1);
  const hu = c.sx / 2 + ring, hv = c.sy / 2 + ring, hw = c.sz / 2;
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw), r = Math.hypot(hu, hv);
  const us: number[] = [], vs: number[] = [], ws: number[] = [];
  for (let i = 0; i < count; i++) {
    const dx = xyz[i * 3]! - c.x;
    if (dx > r || dx < -r) continue;
    const dy = xyz[i * 3 + 1]! - c.y;
    if (dy > r || dy < -r) continue;
    const dz = xyz[i * 3 + 2]! - c.z;
    if (dz > hw + Math.max(cfg.margin, DEFAULT_GROUND.band[1]) || dz < -hw - DEFAULT_GROUND.band[0]) continue;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    if (u > hu || u < -hu || v > hv || v < -hv) continue;
    us.push(u); vs.push(v); ws.push(dz);
  }
  const local = { u: Float32Array.from(us), v: Float32Array.from(vs), w: Float32Array.from(ws), n: us.length };
  const ground = groundSnap(local, c.sx, c.sy, c.sz, { cu: 0, cv: 0, cw: 0, range: Math.hypot(c.x, c.y) });
  return fitReport(local, c.sx, c.sy, c.sz, cfg, fitGroundOf(ground, cfg));
}

/**
 * Kiểm tra box có bao đúng cụm điểm không. Không dùng "tâm cụm lệch tâm box" vì lidar thường chỉ thấy
 * một phía của vật (che khuất) nên tâm cụm lệch là bình thường; thay vào đó đếm điểm nằm NGOÀI box
 * ngay sát mặt box (box thiếu / dời sai) so với điểm nằm trong.
 */
export function fitReport(
  p: LocalPoints, sx: number, sy: number, sz: number, cfg: FitConfig = DEFAULT_FIT, ground: FitGround | null = null,
): FitReport {
  const hu = sx / 2, hv = sy / 2, hw = sz / 2;
  const floor = objectFloor(hw, cfg, ground);
  let inside = 0, outside = 0;
  const cnt: Record<Side, number> = { trước: 0, sau: 0, trái: 0, phải: 0, trên: 0 };
  const sum: Record<Side, number> = { trước: 0, sau: 0, trái: 0, phải: 0, trên: 0 };
  for (let i = 0; i < p.n; i++) {
    const u = p.u[i]!, v = p.v[i]!, w = p.w[i]!;
    if (w < floor(u, v)) continue; // mặt đường / đáy
    if (Math.abs(u) > hu + cfg.margin || Math.abs(v) > hv + cfg.margin || w > hw + cfg.margin) continue;
    const exU = Math.abs(u) - hu, exV = Math.abs(v) - hv, exW = w - hw;
    if (exU <= 0 && exV <= 0 && exW <= 0) { inside++; continue; }
    outside++;
    // phía vượt nhiều nhất
    let side: Side, ex: number;
    if (exU >= exV && exU >= exW) { side = u > 0 ? 'trước' : 'sau'; ex = exU; }
    else if (exV >= exW) { side = v > 0 ? 'trái' : 'phải'; ex = exV; }
    else { side = 'trên'; ex = exW; }
    cnt[side]++; sum[side] += ex;
  }
  const total = inside + outside;
  const ratio = total ? outside / total : 0;
  let side: Side | null = null;
  for (const s of Object.keys(cnt) as Side[]) if (cnt[s] > (side ? cnt[side] : 0)) side = s;
  const overshoot = side ? sum[side] / cnt[side] : 0;
  const base = { inside, outside, ratio, side, overshoot };
  if (outside >= cfg.minShell && ratio > cfg.ratio) {
    return { ...base, level: 'misfit', message: `lệch: ${outside} điểm nằm ngoài box, nhiều nhất phía ${side} (~${overshoot.toFixed(2)} m)` };
  }
  if (inside < cfg.minInside) {
    return { ...base, level: 'sparse', message: `chỉ ${inside} điểm trong box (< ${cfg.minInside})` };
  }
  return { ...base, level: 'ok', message: '' };
}
