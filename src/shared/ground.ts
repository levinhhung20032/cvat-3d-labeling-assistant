import type { LocalPoints } from './fit';

export interface GroundConfig {
  ring: number; // m: bề rộng vành đai quanh chân box dùng để đo mặt đất
  below: number; // m: lấy điểm thấp hơn đáy box tới mức này
  above: number; // m: và cao hơn đáy box tới mức này
  minPoints: number;
  quantile: number; // phân vị thấp của độ cao điểm vùng đáy = mặt đất (bỏ nhiễu dưới đáy)
  maxShift: number; // m: không tự dời quá mức này
  tolerance: number; // m: lệch nhỏ hơn mức này coi như đã đúng mặt đất
  // --- mặt đường dốc: khớp mặt phẳng nghiêng từ vùng lân cận ---
  planeRing: number; // m: bán kính vùng lân cận (tính từ mép box) dùng để khớp mặt phẳng
  cell: number; // m: kích thước ô lưới; mỗi ô lấy điểm thấp (mặt đường), điểm cao (vật thể) bị bỏ
  planeTol: number; // m: điểm ô cách mặt phẳng quá mức này là ngoại lai (vỉa hè, cột, người…)
  minCells: number; // số ô mặt đường tối thiểu để tin mặt phẳng
  maxSlopeDeg: number; // dốc lớn hơn mức này coi là không tin cậy → quay về mặt phẳng ngang
  maxSink: number; // m: góc đáy box được chìm vào mặt dốc tối đa
  steepWarnDeg: number; // dốc lớn hơn mức này thì cảnh báo "đáy chỉ chạm một phía"
}

export const DEFAULT_GROUND: GroundConfig = { ring: 1.5, below: 1.0, above: 0.8, minPoints: 20, quantile: 0.2, maxShift: 1.0, tolerance: 0.03,
  planeRing: 3.0, cell: 0.5, planeTol: 0.1, minCells: 6, maxSlopeDeg: 25, maxSink: 0.05, steepWarnDeg: 8,
};

export interface GroundResult {
  groundW: number; // độ cao mặt đất so với TÂM box hiện tại (m)
  dz: number; // phải dời box theo z bao nhiêu để đáy chạm mặt đất (âm = hạ xuống)
  n: number; // số điểm dùng để đo
  flat: boolean; // mặt đất đo được khá phẳng (độ trải thấp)
  method?: 'plane' | 'level'; // plane: khớp mặt phẳng nghiêng; level: mặt phẳng ngang (dự phòng)
  slopeDeg?: number; // độ dốc mặt đường đo được (chỉ khi method = plane)
  steep?: boolean; // dốc lớn: đáy box (phẳng) chỉ chạm một phía
  plane?: { a: number; b: number; c: number }; // mặt đường w = a·u + b·v + c trong hệ toạ độ của box (u theo yaw)
  dzTilt?: number; // độ dời z nếu box được NGHIÊNG song song mặt đường (tâm đáy chạm mặt dốc)
}

/**
 * Roll / pitch (rx, ry) để mặt đáy box song song mặt đường w = a·u + b·v + c (u theo yaw của box), theo quy ước Euler XYZ
 * của CVAT: trục lên của box = R·ez = (sin ry, −cos ry·sin rx, cos ry·cos rx) phải trùng pháp tuyến mặt đường.
 */
export function tiltFromPlane(a: number, b: number, yaw: number): { rx: number; ry: number } {
  const gx = a * Math.cos(yaw) - b * Math.sin(yaw), gy = a * Math.sin(yaw) + b * Math.cos(yaw); // độ dốc theo trục thế giới
  const n = Math.hypot(gx, gy, 1);
  const nx = -gx / n, ny = -gy / n, nz = 1 / n;
  return { rx: Math.atan2(-ny, nz), ry: Math.asin(Math.max(-1, Math.min(1, nx))) };
}

/**
 * Ground snap: ước lượng mặt đường dưới chân box rồi tính độ dời z để đáy box chạm mặt đường.
 * Ưu tiên điểm ở vành đai quanh chân box (không dính điểm của chính vật); thiếu thì dùng cả vùng dưới chân box.
 * `at` là vị trí đặt box thử (so với tâm hiện tại) — dùng khi vừa kéo box sang chỗ khác.
 * Trả null nếu không đủ điểm hoặc phải dời quá `maxShift`.
 */
export function groundSnapLevel(
  p: LocalPoints, sx: number, sy: number, sz: number,
  at: { cu: number; cv: number; cw: number } = { cu: 0, cv: 0, cw: 0 }, cfg: GroundConfig = DEFAULT_GROUND,
): GroundResult | null {
  const hu = sx / 2, hv = sy / 2, hw = sz / 2;
  const ringW: number[] = [], footW: number[] = [];
  for (let i = 0; i < p.n; i++) {
    const u = p.u[i]! - at.cu, v = p.v[i]! - at.cv, w = p.w[i]! - at.cw; // so với tâm box thử
    if (w < -hw - cfg.below || w > -hw + cfg.above) continue;
    const du = Math.abs(u), dv = Math.abs(v);
    if (du > hu + cfg.ring || dv > hv + cfg.ring) continue;
    (du <= hu && dv <= hv ? footW : ringW).push(w);
  }
  let pool = ringW;
  if (pool.length < cfg.minPoints) pool = [...ringW, ...footW];
  if (pool.length < cfg.minPoints) return null;
  const s = Float64Array.from(pool).sort();
  const at_ = (q: number) => s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
  const groundW = at_(cfg.quantile);
  const dz = groundW + hw; // đáy hiện ở -hw
  if (Math.abs(dz) > cfg.maxShift) return null;
  return { groundW: groundW + at.cw, dz, n: pool.length, flat: at_(0.8) - at_(0.1) < 0.4, method: 'level' };
}

interface Plane { a: number; b: number; c: number } // w = a·u + b·v + c

/** Bình phương tối thiểu mặt phẳng w = a·u + b·v + c (giải hệ 3×3 bằng quy tắc Cramer). null nếu suy biến. */
function fitPlane(pts: [number, number, number][]): Plane | null {
  let suu = 0, suv = 0, svv = 0, su = 0, sv = 0, n = 0, suw = 0, svw = 0, sw = 0;
  for (const [u, v, w] of pts) { suu += u * u; suv += u * v; svv += v * v; su += u; sv += v; n++; suw += u * w; svw += v * w; sw += w; }
  const det3 = (m: number[]) => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  const A = [suu, suv, su, suv, svv, sv, su, sv, n];
  const d = det3(A);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-9) return null;
  const col = (k: number, r: number[]) => A.map((x, i) => (i % 3 === k ? r[(i / 3) | 0]! : x));
  const r = [suw, svw, sw];
  return { a: det3(col(0, r)) / d, b: det3(col(1, r)) / d, c: det3(col(2, r)) / d };
}

/** RANSAC (bộ sinh số giả ngẫu nhiên cố định → kết quả lặp lại được) rồi khớp lại trên tập nội điểm. */
function ransacPlane(pts: [number, number, number][], tol: number, maxSlopeDeg: number): { plane: Plane; inliers: number } | null {
  if (pts.length < 3) return null;
  let seed = 12345;
  const rnd = (m: number) => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed % m; };
  const maxG = Math.tan((maxSlopeDeg * Math.PI) / 180);
  let best: Plane | null = null, bestN = 0;
  for (let it = 0; it < 80; it++) {
    const s = [pts[rnd(pts.length)]!, pts[rnd(pts.length)]!, pts[rnd(pts.length)]!];
    const pl = fitPlane(s);
    if (!pl || Math.hypot(pl.a, pl.b) > maxG) continue;
    let n = 0;
    for (const [u, v, w] of pts) if (Math.abs(w - (pl.a * u + pl.b * v + pl.c)) <= tol) n++;
    if (n > bestN) { best = pl; bestN = n; }
  }
  if (!best) return null;
  let cur: Plane = best;
  const inliersOf = (pl: Plane) => pts.filter(([u, v, w]) => Math.abs(w - (pl.a * u + pl.b * v + pl.c)) <= tol);
  for (let k = 0; k < 2; k++) {
    const inl = inliersOf(cur);
    const refit = inl.length >= 3 ? fitPlane(inl) : null;
    if (!refit || Math.hypot(refit.a, refit.b) > maxG) break;
    cur = refit;
  }
  return { plane: cur, inliers: inliersOf(cur).length };
}

/**
 * Ground snap theo mặt đường có thể DỐC: lấy điểm mặt đường ở vùng lân cận box (lưới ô, mỗi ô lấy điểm thấp, bỏ phần
 * trong hình chiếu của box), khớp mặt phẳng nghiêng bằng RANSAC, đo độ cao mặt đường ở 4 góc đáy box. Box vẫn nằm ngang
 * (không đổi góc), nên đáy đặt ở độ cao trung bình của 4 góc nhưng không để góc nào chìm quá `maxSink`.
 * Không đủ ô / mặt phẳng không tin cậy / dốc quá `maxSlopeDeg` → quay về `groundSnapLevel` (mặt phẳng ngang).
 */
export function groundSnap(
  p: LocalPoints, sx: number, sy: number, sz: number,
  at: { cu: number; cv: number; cw: number } = { cu: 0, cv: 0, cw: 0 }, cfg: GroundConfig = DEFAULT_GROUND,
): GroundResult | null {
  const level = groundSnapLevel(p, sx, sy, sz, at, cfg);
  const hu = sx / 2, hv = sy / 2, hw = sz / 2;
  const R = cfg.planeRing, cs = cfg.cell;
  const cells = new Map<string, [number, number, number][]>();
  for (let i = 0; i < p.n; i++) {
    const u = p.u[i]! - at.cu, v = p.v[i]! - at.cv, w = p.w[i]! - at.cw;
    if (Math.abs(u) > hu + R || Math.abs(v) > hv + R) continue;
    if (Math.abs(u) <= hu + 0.15 && Math.abs(v) <= hv + 0.15) continue; // chân box: lẫn điểm của chính vật
    if (w < -hw - 1.5 || w > -hw + 1.2) continue;
    const key = `${Math.floor(u / cs)}:${Math.floor(v / cs)}`;
    const c = cells.get(key) ?? [];
    c.push([u, v, w]);
    cells.set(key, c);
  }
  const pts: [number, number, number][] = [];
  for (const c of cells.values()) {
    if (c.length < 2) continue;
    c.sort((x, y) => x[2] - y[2]);
    pts.push(c[Math.floor(0.15 * (c.length - 1))]!); // điểm thấp của ô, giữ đúng tọa độ (u, v) của nó để không lệch trên dốc
  }
  if (pts.length < cfg.minCells) return level ? { ...level, method: 'level' } : null;
  const fit = ransacPlane(pts, cfg.planeTol, cfg.maxSlopeDeg);
  if (!fit || fit.inliers < Math.max(cfg.minCells, 0.5 * pts.length)) return level ? { ...level, method: 'level' } : null;
  const { a, b, c } = fit.plane;
  const corners = [[hu, hv], [hu, -hv], [-hu, hv], [-hu, -hv]].map(([u, v]) => a * u! + b * v! + c);
  const mean = corners.reduce((x, y) => x + y, 0) / 4;
  const target = Math.max(mean, Math.max(...corners) - cfg.maxSink);
  const dz = target + hw;
  if (Math.abs(dz) > cfg.maxShift) return null;
  const slopeDeg = (Math.atan(Math.hypot(a, b)) * 180) / Math.PI;
  return {
    groundW: target + at.cw, dz, n: fit.inliers, flat: slopeDeg < 3, method: 'plane', slopeDeg, steep: slopeDeg > cfg.steepWarnDeg,
    plane: { a, b, c }, dzTilt: c + hw * Math.hypot(1, a, b), // tâm đáy nằm trên mặt dốc khi box nghiêng song song
  };
}
