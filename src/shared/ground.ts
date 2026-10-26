import type { LocalPoints } from './fit';

export interface GroundConfig {
  maxShift: number; // m: không tự dời quá mức này
  tolerance: number; // m: lệch nhỏ hơn mức này coi như đã đúng mặt đất
  // --- mặt đường dốc: khớp mặt phẳng nghiêng từ vùng lân cận ---
  ringTiers: number[]; // m: bán kính vùng lấy mặt đường tính từ mép box, thử từ gần tới xa (gần nhất trước; mở rộng khi chưa đủ dữ kiện)
  maxNearest: number; // m: ô mặt đường gần nhất phải cách mép box không quá mức này, nếu không coi là không có mặt đường gần object
  minExtent: number; // m: các ô mặt đường dùng để khớp phải trải rộng ít nhất mức này theo cả hai trục (tránh ngoại suy từ một vệt hẹp)
  cell: number; // m: kích thước ô lưới; mỗi ô lấy điểm thấp (mặt đường), điểm cao (vật thể) bị bỏ
  planeTol: number; // m: điểm ô cách mặt phẳng quá mức này là ngoại lai (vỉa hè, cột, người…)
  minCells: number; // số ô mặt đường tối thiểu để tin mặt phẳng
  maxSlopeDeg: number; // dốc lớn hơn mức này coi là không tin cậy → không gợi ý
  maxSink: number; // m: góc đáy box được chìm vào mặt dốc tối đa
  steepWarnDeg: number; // dốc lớn hơn mức này thì cảnh báo "đáy chỉ chạm một phía"
}

export const DEFAULT_GROUND: GroundConfig = { maxShift: 1.0, tolerance: 0.03,
  ringTiers: [3, 6, 10], maxNearest: 4, minExtent: 1.5, cell: 0.5, planeTol: 0.1, minCells: 6, maxSlopeDeg: 25, maxSink: 0.05, steepWarnDeg: 8,
};

export interface GroundResult {
  groundW: number; // độ cao mặt đất so với TÂM box hiện tại (m)
  dz: number; // phải dời box theo z bao nhiêu để đáy chạm mặt đất (âm = hạ xuống)
  n: number; // số điểm dùng để đo
  flat: boolean; // mặt đất đo được khá phẳng (độ trải thấp)
  method?: 'plane'; // khớp mặt phẳng từ mặt đường quanh / gần object
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
 * Ground snap theo mặt đường quanh object (có thể DỐC). Chỉ dùng điểm mặt đường Ở GẦN object, không dùng mặt phẳng của ego hay
 * giả định mặt đất ngang: lấy các ô mặt đường (ô lưới, mỗi ô lấy điểm thấp, bỏ phần trong hình chiếu của box), thử vành đai 3 m quanh
 * box, chưa đủ dữ kiện thì mở rộng dần (6 m, 10 m — luôn ưu tiên các ô gần box nhất) rồi khớp mặt phẳng bằng RANSAC. Đủ dữ kiện =
 * ô gần nhất cách box ≤ `maxNearest`, đủ `minCells` ô, các ô trải rộng ≥ `minExtent` theo cả hai trục, và ≥ 50% ô nằm trên mặt phẳng.
 * Box vẫn nằm ngang (không đổi góc): đáy đặt ở độ cao trung bình 4 góc nhưng không để góc nào chìm quá `maxSink`.
 * KHÔNG đủ dữ kiện (hoặc dốc quá `maxSlopeDeg`, hoặc phải dời quá `maxShift`) → null, tức là không gợi ý gì.
 */
export function groundSnap(
  p: LocalPoints, sx: number, sy: number, sz: number,
  at: { cu: number; cv: number; cw: number } = { cu: 0, cv: 0, cw: 0 }, cfg: GroundConfig = DEFAULT_GROUND,
): GroundResult | null {
  const hu = sx / 2, hv = sy / 2, hw = sz / 2;
  const R = Math.max(...cfg.ringTiers), cs = cfg.cell;
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
  // điểm mặt đường của từng ô (điểm thấp, giữ đúng toạ độ (u, v) của nó để không lệch trên dốc) kèm khoảng cách tới mép box
  const road: { pt: [number, number, number]; d: number }[] = [];
  for (const c of cells.values()) {
    if (c.length < 2) continue;
    c.sort((x, y) => x[2] - y[2]);
    const pt = c[Math.floor(0.15 * (c.length - 1))]!;
    road.push({ pt, d: Math.hypot(Math.max(Math.abs(pt[0]) - hu, 0), Math.max(Math.abs(pt[1]) - hv, 0)) });
  }
  road.sort((x, y) => x.d - y.d);
  if (!road.length || road[0]!.d > cfg.maxNearest) return null; // không có mặt đường gần object

  for (const ring of [...cfg.ringTiers].sort((x, y) => x - y)) {
    const pts = road.filter((r) => r.d <= ring).map((r) => r.pt);
    if (pts.length < cfg.minCells) continue; // chưa đủ dữ kiện ở bán kính này → mở rộng
    const us = pts.map((q) => q[0]), vs = pts.map((q) => q[1]);
    if (Math.max(...us) - Math.min(...us) < cfg.minExtent || Math.max(...vs) - Math.min(...vs) < cfg.minExtent) continue;
    const fit = ransacPlane(pts, cfg.planeTol, cfg.maxSlopeDeg);
    if (!fit || fit.inliers < Math.max(cfg.minCells, 0.5 * pts.length)) continue;
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
  return null; // hết các bán kính mà vẫn chưa đủ dữ kiện → không gợi ý
}
