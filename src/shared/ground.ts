import type { LocalPoints } from './fit';
import { PW_GROUND, PW_OTHER, PW_REFLECT } from './patchwork';

/**
 * Mặt đường dưới MỘT object tại ĐÚNG frame đang xét (không dùng mặt đường toàn map, không dự đoán từ frame khác).
 *
 * Số liệu một job thật (2150 cặp object × frame, 2026-10-28): cách cũ (một mặt phẳng "đồng thuận lớn nhất" trên vành 2–7 m) hay bám
 * nhầm lớp cao hơn (vỉa hè, thân xe bên cạnh) và có lỗi thô tới ~1 m; nhãn đã qua QC ở tầm gần nằm cao hơn TÂM lớp mặt đường
 * ~6–7 cm, lớp mặt đường dày ~5 cm. Vì vậy:
 * - mỗi cung quanh box lấy LỚP THẤP NHẤT CÓ MẬT ĐỘ (không lấy đồng thuận) → bỏ được vỉa hè, cây, thân xe ở trên;
 * - bằng chứng tiếp xúc trong chân box (mặt đất lọt dưới gầm, bánh xe, chân người) quyết định tầng khi có nhiều tầng;
 * - "mặt đường" = MẶT TRÊN của lớp điểm mặt đường (box đặt lên trên lớp, không ăn điểm mặt đường);
 * - mỗi phép đo có độ bất định σ; chỉ cảnh báo khi lệch vượt ngưỡng quy ước VÀ vượt 2,5σ.
 */
export interface GroundConfig {
  maxRange: number; // m: chỉ đo mặt đường cho object cách ego (gốc toạ độ) không quá mức này; xa hơn → không đo (null)
  maxShift: number; // m: lệch quá mức này coi là đo sai, không gợi ý
  band: [number, number]; // m: chỉ xét điểm có w trong [đáy − band[0], đáy + band[1]] (đáy = đáy box hiện tại)
  innerRing: number; // m: bỏ dải sát mép box (lẫn điểm của chính vật)
  nearRing: number; // m: vòng sát quanh box (ưu tiên)
  farRing: number; // m: cung nào thưa thì mở rộng tới mức này
  sectors: number; // số cung quanh box
  minSectorPts: number; // vòng sát có ít hơn ngần này điểm thì cung đó mở rộng tới farRing
  denseWin: number; // m: cửa sổ tìm mép dưới dày đặc của lớp
  layerDepth: number; // m: lớp mặt đường = các điểm trong ngần này tính từ mép dưới
  minDense: number; // số điểm tối thiểu trong cửa sổ dày đặc
  minDenseFrac: number; // … và tỉ lệ tối thiểu so với số điểm của cung
  contactBand: number; // m: bằng chứng tiếp xúc trong chân box lấy điểm có w trong đáy ± mức này
  contactMin: number;
  planeTol: number; // m: cung cách mặt phẳng không quá mức này thì nằm trên mặt (kiểm "mặt liền")
  layerJoin: number; // m: hai cung chênh nhau không quá mức này thì cùng một tầng
  contactMatch: number; // m: tầng khớp bằng chứng tiếp xúc nếu chênh không quá mức này
  corroborate: number; // m: tầng và bằng chứng tiếp xúc chênh không quá mức này thì coi là xác nhận lẫn nhau
  maxSlopeDeg: number; // dốc lớn hơn mức này thì không tin mặt phẳng nghiêng, dùng mặt ngang
  steepWarnDeg: number; // dốc lớn hơn mức này thì báo "đáy chỉ chạm một phía" (box nằm ngang trên mặt dốc; G có thể nghiêng box)
  floatTol: number; // m: đáy box được CAO hơn mặt đường tới mức này mà không bị báo (quy ước dự án)
  sinkTol: number; // m: đáy box được THẤP hơn mặt đường tới mức này mà không bị báo
  sigmaK: number; // chỉ báo khi lệch > sigmaK · σ
  sigmaFloor: number; // m: σ tối thiểu (độ nhám mặt đường, nhiễu lidar)
  sigmaPerMeter: number; // m/m: σ tăng theo khoảng cách tới xe (lidar thưa, xe chồm làm mặt đường ở xa lên xuống)
  sigmaAmbiguous: number; // m: cộng vào σ khi có hai tầng (vỉa) mà không có bằng chứng tiếp xúc để chọn
  recheckTol: number; // m: tự dời box chỉ khi đo lại tại vị trí mới vẫn ra cùng mặt đường (chênh không quá mức này)
  pw: number; // Patchwork++ (thử nghiệm): 0 tắt · 1 bỏ điểm không phải mặt đất / phản chiếu khỏi các cung · 2 như 1 + chọn tầng theo mặt đất Patchwork++
  pwMatch: number; // m: chọn tầng theo Patchwork++ khi tầng lệch mặt đất của nó không quá mức này
  pwLift: number; // m: mức 3 — mặt đường = mặt phẳng tâm lớp của Patchwork++ + mức này (quy ước "mặt trên lớp điểm")
  pwSigma: number; // m: mức 3 — sai số mô hình cộng vào độ bất định
  pwMaxRms: number; // m: mức 3 — phần dư tối đa của mặt phẳng fit từ các ô để coi là đủ tin (confident)
  pwRadius: number; // m: mức 3 — lấy các ô mặt đất có tâm cách tâm box không quá mức này
  pwFarRadius: number; // m: mức 4 — lấy các điểm mặt đất (nhãn Patchwork++) cách tâm box không quá mức này (bỏ vùng quanh chân box)
  pwMinPts: number; // mức 4 — số điểm mặt đất tối thiểu để fit mặt đường
  pwPitch: boolean; // mức 4 — bù độ nghiêng của xe giữa các frame khi gộp điểm (theo mặt đường gần xe của từng frame)
  pwNearSlack: number; // m: mức 4 — chỉ gộp từ các frame mà object ở tầm ≤ tầm gần nhất + mức này (≥ 12 m); 0 = gộp mọi frame
  pwPool: number; // mức 4 — gộp thêm điểm mặt đất của ±pwPool frame lân cận (bù chuyển động xe); 0 = không gộp
  pwConsSpan: number; // mức 4 — nhất quán theo thời gian: so với các frame kề trong ± ngần này frame của cùng object (0 = tắt)
  pwConsTol: number; // m: độ lệch cho phép so với trung vị mặt đường của các frame kề
  pwConsSlope: number; // m / m: cộng thêm theo độ đổi khoảng cách tới ego giữa hai frame (mặt đường dốc: cùng một điểm ở tầm khác nhau có z khác nhau)
  pwAgree: number; // m: mức 4 — cách đo cũ (dù chưa chắc) có giá trị mà chênh mặt phẳng Patchwork++ quá mức này thì hai nguồn mâu thuẫn: không coi là đủ tin
}

// floatTol / sinkTol: chủ dự án chưa có quy ước bằng số (2026-10-28); mặc định chọn từ số liệu một job thật (xem đầu file). Trên job đó:
// báo 11,7% cặp object × frame (cách cũ 28,7%), tầm < 15 m 26,7%; floatTol 0,15 thì tầm < 15 m còn ~18%.
export const DEFAULT_GROUND: GroundConfig = {
  maxRange: 80, // chủ dự án 2026-10-28: chỉ dự đoán mặt đường trong bán kính 80 m tính từ ego (khớp ngưỡng tầm xa của QC)
  maxShift: 1.0, band: [1.0, 0.5], innerRing: 0.15, nearRing: 1.2, farRing: 2.5, sectors: 8, minSectorPts: 5,
  denseWin: 0.04, layerDepth: 0.06, minDense: 3, minDenseFrac: 0.08, contactBand: 0.3, contactMin: 4,
  planeTol: 0.03, layerJoin: 0.05, contactMatch: 0.08, corroborate: 0.04, maxSlopeDeg: 8, steepWarnDeg: 5,
  floatTol: 0.10, sinkTol: 0.05, sigmaK: 2.5, sigmaFloor: 0.015, sigmaPerMeter: 0.0015, sigmaAmbiguous: 0.05,
  recheckTol: 0.05, pw: 0, pwMatch: 0.1, pwLift: 0.02, pwSigma: 0.02, pwMaxRms: 0.06, pwRadius: 8, pwFarRadius: 10, pwMinPts: 40, pwAgree: 0.15, pwPool: 4, pwPitch: true, pwNearSlack: 5, pwConsSpan: 2, pwConsTol: 0.15, pwConsSlope: 0.05,
};

/** Mức mặt đường của một cung quanh box (toạ độ như điểm đầu vào: u theo yaw, gốc ở tâm box). */
export interface GroundSector { u: number; v: number; w: number; n: number; used: boolean }

export interface GroundResult {
  groundW: number; // độ cao mặt đường (mặt trên của lớp điểm) so với TÂM box hiện tại (m)
  dz: number; // phải dời box theo z bao nhiêu để đáy nằm trên mặt đường (âm = hạ xuống: box đang cao hơn mặt đường)
  sigma: number; // m: độ bất định của dz
  rms: number; // m: phần dư của các cung đã dùng so với mặt phẳng (dải bỏ qua khi đếm điểm của vật: fit.ts)
  warn: boolean; // lệch vượt ngưỡng quy ước (floatTol / sinkTol) VÀ vượt sigmaK · σ, và phép đo đủ tin cậy
  confident: boolean; // đủ căn cứ để tự dời box: ≥ 2 cung cùng tầng hoặc được bằng chứng tiếp xúc xác nhận, và không mơ hồ
  ambiguous: boolean; // có hai tầng (vỉa hè?) mà không có bằng chứng tiếp xúc trong chân box để chọn
  inconsistent?: boolean; // mức 4: bị loại vì lệch quá so với mặt đường các frame kề của cùng object (enforceConsistency)
  pw: 'off' | 'filter' | 'tier' | 'road' | 'pts'; // Patchwork++ đã dùng thế nào: không / lọc điểm / chọn tầng
  nSectors: number; // số cung dùng để khớp
  contactW: number | null; // mặt trên lớp tiếp xúc trong chân box (w), nếu thấy
  marks: GroundSector[]; // mọi cung đo được (để vẽ), đánh dấu cung đã dùng
  n: number; // số điểm mặt đường đã dùng
  flat: boolean; // dốc < 3°
  method: 'plane';
  slopeDeg: number;
  steep: boolean; // dốc lớn: đáy box (phẳng) chỉ chạm một phía
  plane: { a: number; b: number; c: number }; // mặt đường w = a·u + b·v + c trong hệ toạ độ của box (u theo yaw), gốc ở vị trí đo `at`
  dzTilt: number; // độ dời z nếu box được NGHIÊNG song song mặt đường (tâm đáy chạm mặt dốc)
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

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/**
 * Lớp mặt đường trong một tập độ cao: tìm MÉP DƯỚI dày đặc (≥ minDense điểm trong `win`; điểm nhiễu lẻ tẻ bên dưới bị bỏ qua),
 * rồi lấy các điểm trong `depth` tính từ mép đó: h = tâm lớp (trung vị), top = mặt trên lớp (phân vị 90%). null nếu không có lớp nào.
 */
export function lowestLayer(ws: number[], minDense: number, win: number, depth: number): { h: number; top: number; n: number } | null {
  if (ws.length < minDense) return null;
  const s = [...ws].sort((a, b) => a - b);
  let j = 0;
  for (let i = 0; i < s.length; i++) {
    while (j < s.length && s[j]! <= s[i]! + win) j++;
    if (j - i >= minDense) {
      const lay = s.filter((w) => w >= s[i]! && w <= s[i]! + depth);
      return { h: median(lay), top: lay[Math.floor(0.9 * (lay.length - 1))]!, n: lay.length };
    }
  }
  return null;
}

/**
 * Mặt đường dưới object tại frame đang xét. `at`: vị trí đặt thử (dời / đổi cỡ box rồi đo lại tại chỗ mới), `range`: khoảng cách
 * object tới xe (m) để tính độ bất định. Trả null khi object xa ego quá maxRange, không có lớp mặt đường nào quanh / dưới object,
 * hoặc lệch quá maxShift.
 */
/** Một phép đo mặt đường của object ở một frame: z tâm box, tầm tới ego, kết quả; `ref` (tuỳ chọn) là kết quả dùng làm mốc cho frame kề. */
export interface ConsistencyItem { f: number; z: number; range: number; g: GroundResult | null; ref?: GroundResult | null }

/**
 * Kiểm tra nhất quán theo thời gian cho các kết quả từ Patchwork++ (pw = 'pts'): mặt đường dưới cùng một object ở các frame kề nhau
 * (± pwConsSpan) đổi chậm — xe chạy chậm, đường không nhảy — nên kết quả lệch so với các frame kề (chỉ tính frame kề đủ tin) quá
 * pwConsTol + pwConsSlope · (độ đổi tầm) ở quá nửa số mốc bị coi là không đủ tin (confident = false, warn = false, inconsistent = true). Độ cao tuyệt đối
 * = z tâm box + groundW (toạ độ ego có gốc trên mặt đường). Không có frame kề đủ tin nào thì giữ nguyên. Kết quả cùng thứ tự với `items`.
 */
export function enforceConsistency(items: ConsistencyItem[], cfg: GroundConfig = DEFAULT_GROUND): (GroundResult | null)[] {
  if (cfg.pwConsSpan <= 0) return items.map((it) => it.g);
  const byFrame = new Map<number, ConsistencyItem>();
  for (const it of items) byFrame.set(it.f, it);
  return items.map((it) => {
    const g = it.g;
    if (!g || g.pw !== 'pts') return g;
    const refs: { z: number; dr: number }[] = [];
    for (let d = -cfg.pwConsSpan; d <= cfg.pwConsSpan; d++) {
      if (d === 0) continue;
      const o = byFrame.get(it.f + d);
      const r = o && (o.ref ?? o.g);
      if (o && r && r.confident) refs.push({ z: o.z + r.groundW, dr: Math.abs(o.range - it.range) });
    }
    if (!refs.length) return g;
    // Đồng thuận: khớp (trong ngưỡng riêng của từng mốc) với ít nhất một nửa số mốc. Không dùng trung vị vì ở frame biên chỉ có 2 mốc, trung bình
    // của một mốc đúng và một mốc lệch làm sai cả frame tốt.
    const agree = refs.filter((r) => Math.abs(it.z + g.groundW - r.z) <= cfg.pwConsTol + cfg.pwConsSlope * r.dr).length;
    return agree >= refs.length / 2 ? g : { ...g, confident: false, warn: false, inconsistent: true };
  });
}

/**
 * Mức 4: mặt đường fit từ chính các ĐIỂM mà Patchwork++ gán là mặt đất (nhãn từng điểm), trong bán kính pwFarRadius quanh tâm box (bỏ vùng
 * chân box + 0,5 m: ở đó là vật), loại dần điểm lệch > 6 cm khỏi mặt phẳng. Hệ toạ độ như groundSnap (đã dời `at`). null: không có nhãn /
 * quá ít điểm. Dốc vượt maxSlopeDeg thì dùng mặt ngang (trung vị).
 */
export function pwGroundPlane(
  p: LocalPoints, sx: number, sy: number, at: { cu: number; cv: number; cw: number } = { cu: 0, cv: 0, cw: 0 }, cfg: GroundConfig = DEFAULT_GROUND,
): { a: number; b: number; c: number; rms: number; n: number } | null {
  if (!p.g && !p.pool) return null;
  const hu = sx / 2 + 0.5, hv = sy / 2 + 0.5, r2 = cfg.pwFarRadius * cfg.pwFarRadius;
  let pts: [number, number, number][] = [];
  // quan sát gần hơn hẳn ở frame khác (pool.ownOk = false): bỏ điểm xa, thưa của chính frame này
  for (let i = 0; p.g && p.pool?.ownOk !== false && i < p.n; i++) {
    if (p.g[i] !== PW_GROUND) continue;
    const u = p.u[i]! - at.cu, v = p.v[i]! - at.cv, w = p.w[i]! - at.cw;
    if (Math.abs(u) <= hu && Math.abs(v) <= hv) continue;
    if (u * u + v * v > r2) continue;
    pts.push([u, v, w]);
  }
  if (p.pool) {
    // điểm mặt đất gộp từ frame lân cận (đã là nhãn mặt đất): cùng bộ lọc vùng quanh chân box và bán kính
    for (let i = 0; i < p.pool.n; i++) {
      const u = p.pool.u[i]! - at.cu, v = p.pool.v[i]! - at.cv, w = p.pool.w[i]! - at.cw;
      if (Math.abs(u) <= hu && Math.abs(v) <= hv) continue;
      if (u * u + v * v > r2) continue;
      pts.push([u, v, w]);
    }
  }
  if (pts.length < cfg.pwMinPts) return null;
  let pl = fitPlane(pts);
  for (let it = 0; it < 3 && pl; it++) {
    const f = pl;
    const keep = pts.filter(([u, v, w]) => Math.abs(w - (f.a * u + f.b * v + f.c)) <= 0.06);
    if (keep.length === pts.length || keep.length < cfg.pwMinPts) break;
    pts = keep;
    pl = fitPlane(pts);
  }
  if (!pl || Math.hypot(pl.a, pl.b) > Math.tan((cfg.maxSlopeDeg * Math.PI) / 180)) pl = { a: 0, b: 0, c: median(pts.map((q) => q[2])) };
  const f = pl;
  const rms = Math.sqrt(pts.reduce((s, [u, v, w]) => s + (w - (f.a * u + f.b * v + f.c)) ** 2, 0) / pts.length);
  return { ...pl, rms, n: pts.length };
}

/**
 * Mặt đường dưới object tại frame đang xét. Mức 4 (Patchwork++): đường rõ (cách đo cũ đo chắc) giữ nguyên kết quả cũ; còn lại (xa, thưa, bị
 * che) dùng mặt phẳng fit từ các điểm mặt đất do Patchwork++ gán nhãn (pwGroundPlane).
 */
export function groundSnap(
  p: LocalPoints, sx: number, sy: number, sz: number,
  at: { cu: number; cv: number; cw: number; range?: number } = { cu: 0, cv: 0, cw: 0 }, cfg: GroundConfig = DEFAULT_GROUND,
): GroundResult | null {
  const old = groundSnapCore(p, sx, sy, sz, at, cfg);
  if (cfg.pw !== 4 || (old && old.confident) || (at.range !== undefined && at.range > cfg.maxRange)) return old;
  return pwResult(p, sx, sy, sz, at, cfg, old) ?? old;
}

/** Mặt đường từ các điểm Patchwork++ gán nhãn mặt đất quanh box (mức 4). `old`: kết quả cách đo cũ (nếu có) để đối chiếu; null nếu không đủ điểm. */
function pwResult(
  p: LocalPoints, sx: number, sy: number, sz: number, at: { cu: number; cv: number; cw: number; range?: number }, cfg: GroundConfig, old: GroundResult | null,
): GroundResult | null {
  const pl = pwGroundPlane(p, sx, sy, at, cfg);
  if (!pl) return null;
  const surface: Plane = { a: pl.a, b: pl.b, c: pl.c + cfg.pwLift };
  const dz = surface.c - -sz / 2;
  if (Math.abs(dz) > cfg.maxShift) return null;
  const sigma = Math.hypot(pl.rms * 0.5, cfg.sigmaFloor, cfg.pwSigma) + cfg.sigmaPerMeter * (at.range ?? 0);
  const conflict = !!old && Math.abs(old.groundW - (surface.c + at.cw)) > cfg.pwAgree; // cách cũ có số liệu độc lập nhưng không khớp
  const confident = pl.rms <= cfg.pwMaxRms && !conflict;
  const slope = (Math.atan(Math.hypot(surface.a, surface.b)) * 180) / Math.PI;
  const exceeds = dz < 0 ? -dz > cfg.floatTol : dz > cfg.sinkTol;
  return {
    groundW: surface.c + at.cw, dz, sigma, rms: pl.rms, warn: confident && exceeds && Math.abs(dz) > cfg.sigmaK * sigma, confident, ambiguous: false,
    pw: 'pts', nSectors: 0, contactW: old?.contactW ?? null, marks: [], n: pl.n, flat: slope < 3, method: 'plane', slopeDeg: slope,
    steep: slope > cfg.steepWarnDeg, plane: surface, dzTilt: surface.c + (sz / 2) * Math.hypot(1, surface.a, surface.b),
  };
}

/** Ba nguồn mặt đường chọn được cho từng frame: đo riêng quanh object, mặt đường ego (z = 0), mặt đường Patchwork++. */
export type GroundKind = 'measured' | 'ego' | 'pw';
export const GROUND_KINDS: readonly GroundKind[] = ['measured', 'ego', 'pw'];

/** Mặt đường ego: mặt phẳng Oxy (z = 0 thế giới), ngang trong hệ box (hệ box chỉ xoay theo yaw). `z`: z tâm box ở frame này. Luôn chắc chắn, không bao giờ cảnh báo. */
export function egoGround(z: number, sz: number, at: { cu: number; cv: number; cw: number } = { cu: 0, cv: 0, cw: 0 }): GroundResult {
  const c = -z - at.cw;
  const dz = c + sz / 2;
  return {
    groundW: -z, dz, sigma: 0, rms: 0, warn: false, confident: true, ambiguous: false, pw: 'off', nSectors: 0, contactW: null, marks: [], n: 0, flat: true, method: 'plane',
    slopeDeg: 0, steep: false, plane: { a: 0, b: 0, c }, dzTilt: c + sz / 2,
  };
}

/**
 * Mặt đường của MỘT nguồn (dùng cho Ground snap / lock khi frame chỉ chọn đúng 1 nguồn): 'measured' = cách đo cũ, không trộn Patchwork++;
 * 'pw' = chỉ mặt phẳng từ điểm Patchwork++ (cần nhãn mặt đất trong `p`); 'ego' = z = 0. `z`: z tâm box (cần cho 'ego').
 */
export function groundSnapBy(
  kind: GroundKind, p: LocalPoints, sx: number, sy: number, sz: number, at: { cu: number; cv: number; cw: number; range?: number }, z: number, cfg: GroundConfig = DEFAULT_GROUND,
): GroundResult | null {
  if (kind === 'ego') return egoGround(z, sz, at);
  if (at.range !== undefined && at.range > cfg.maxRange) return null;
  if (kind === 'pw') return pwResult(p, sx, sy, sz, at, cfg, null);
  return groundSnapCore(p, sx, sy, sz, at, { ...cfg, pw: 0 });
}

function groundSnapCore(
  p: LocalPoints, sx: number, sy: number, sz: number,
  at: { cu: number; cv: number; cw: number; range?: number } = { cu: 0, cv: 0, cw: 0 }, cfg: GroundConfig = DEFAULT_GROUND,
): GroundResult | null {
  if (at.range !== undefined && at.range > cfg.maxRange) return null; // ngoài bán kính đo mặt đường quanh ego
  const hu = sx / 2, hv = sy / 2, hw = sz / 2, bottom = -hw;
  const pwOn = (cfg.pw === 1 || cfg.pw === 2) && !!p.g; // chỉ lọc ở vòng quanh box; điểm trong chân box (bằng chứng tiếp xúc) giữ nguyên
  const pwW = pwOn && p.pwW !== null && p.pwW !== undefined ? p.pwW - at.cw : null;
  let pwTier = false;
  const near: [number, number, number][][] = Array.from({ length: cfg.sectors }, () => []);
  const far: [number, number, number][][] = Array.from({ length: cfg.sectors }, () => []);
  const inside: number[] = [];
  const step = (2 * Math.PI) / cfg.sectors;
  for (let i = 0; i < p.n; i++) {
    const u = p.u[i]! - at.cu, v = p.v[i]! - at.cv, w = p.w[i]! - at.cw;
    if (w < bottom - cfg.band[0] || w > bottom + cfg.band[1]) continue;
    const du = Math.abs(u) - hu, dv = Math.abs(v) - hv;
    if (du <= 0 && dv <= 0) { if (Math.abs(w - bottom) <= cfg.contactBand) inside.push(w); continue; }
    if (pwOn && (p.g![i] === PW_OTHER || p.g![i] === PW_REFLECT)) continue; // Patchwork++: không phải mặt đất (thân xe, cây, tường…)
    const d = Math.hypot(Math.max(du, 0), Math.max(dv, 0));
    if (d < cfg.innerRing || d > cfg.farRing) continue;
    const k = ((Math.round(Math.atan2(v / Math.max(hv, 0.3), u / Math.max(hu, 0.3)) / step) % cfg.sectors) + cfg.sectors) % cfg.sectors;
    (d <= cfg.nearRing ? near : far)[k]!.push([u, v, w]);
  }

  // Mức mặt đường của từng cung: lớp thấp nhất có mật độ (vỉa hè / cây / thân xe nằm trên lớp này nên bị bỏ).
  const secs: (GroundSector & { lay: [number, number, number][] })[] = [];
  for (let k = 0; k < cfg.sectors; k++) {
    const pts = near[k]!.length >= cfg.minSectorPts ? near[k]! : near[k]!.concat(far[k]!);
    const L = lowestLayer(pts.map((q) => q[2]), Math.max(cfg.minDense, Math.round(cfg.minDenseFrac * pts.length)), cfg.denseWin, cfg.layerDepth);
    if (!L) continue;
    const lay = pts.filter((q) => q[2] >= L.h - cfg.denseWin && q[2] <= L.top + 1e-9);
    if (!lay.length) continue;
    secs.push({ u: lay.reduce((s, q) => s + q[0], 0) / lay.length, v: lay.reduce((s, q) => s + q[1], 0) / lay.length, w: L.h, n: lay.length, used: false, lay });
  }
  const contact = lowestLayer(inside, cfg.contactMin, cfg.denseWin, cfg.layerDepth);
  if (cfg.pw === 3 && p.pwRoad) {
    // Mức 3: mặt đường = mặt phẳng fit từ các ô mặt đất Patchwork++ quanh box (kể cả khi vật che mặt đường dưới nó / điểm thưa ở xa).
    const r = p.pwRoad;
    const surface: Plane = { a: r.a, b: r.b, c: r.c + r.a * at.cu + r.b * at.cv - at.cw + cfg.pwLift };
    const dz = surface.c - bottom;
    if (Math.abs(dz) <= cfg.maxShift) {
      const sigma = Math.hypot(r.rms, cfg.sigmaFloor, cfg.pwSigma) * (r.n >= 3 ? 1 : 2) + cfg.sigmaPerMeter * (at.range ?? 0);
      const confident = r.n >= 3 && r.rms <= cfg.pwMaxRms;
      const exceedsPw = dz < 0 ? -dz > cfg.floatTol : dz > cfg.sinkTol;
      const slope = (Math.atan(Math.hypot(surface.a, surface.b)) * 180) / Math.PI;
      return {
        groundW: surface.c + at.cw, dz, sigma, rms: r.rms, warn: confident && exceedsPw && Math.abs(dz) > cfg.sigmaK * sigma, confident, ambiguous: false,
        pw: 'road', nSectors: r.n, contactW: contact ? contact.top + at.cw : null, marks: [], n: r.n, flat: slope < 3, method: 'plane', slopeDeg: slope,
        steep: slope > cfg.steepWarnDeg, plane: surface, dzTilt: surface.c + hw * Math.hypot(1, surface.a, surface.b),
      };
    }
  }
  // Lớp tiếp xúc dưới gầm là mặt đất hoặc gầm / bánh xe — luôn ở bằng hoặc TRÊN mặt đất. Cung nào cao hơn nó quá contactMatch thì không
  // phải mặt đường (thường là thân xe đỗ sát bên làm điểm mặt đường thưa đi; một job thật: lỗi thô "chìm ~80 cm" đến từ đây).
  if (contact) for (let k = secs.length - 1; k >= 0; k--) if (secs[k]!.w > contact.h + cfg.contactMatch) secs.splice(k, 1);
  if (!secs.length && !contact) return null;

  // Chọn mặt đường, hai trường hợp:
  // 1. MẶT LIỀN: một mặt phẳng (ngang hoặc dốc) khớp mọi cung trong planeTol, cho phép lệch 1 cung, và có ≥ 4 cung → dùng mặt đó.
  // 2. NHIỀU TẦNG (bậc vỉa, bãi cỏ…): không dùng mặt nghiêng — bậc vỉa nhìn từ 8 cung rất giống một dốc nhẹ và mặt nghiêng qua cả hai
  //    tầng cho độ cao lưng chừng. Gom cung theo độ cao thành tầng; có lớp tiếp xúc dưới gầm thì chọn tầng gần nó nhất (xe có thể đỗ
  //    trên vỉa hè), không có thì tầng THẤP nhất có ≥ 2 cung (mặt đường là lớp thấp nhất); còn tầng cao hơn có ≥ 2 cung mà không có
  //    lớp tiếp xúc để phân xử → mơ hồ.
  const tanMax = Math.tan((cfg.maxSlopeDeg * Math.PI) / 180);
  const resOf = (pl: Plane, s: (typeof secs)[number]) => s.w - (pl.a * s.u + pl.b * s.v + pl.c);
  const spread = (ss: typeof secs) => ss.length >= 3
    && Math.max(...ss.map((s) => s.u)) - Math.min(...ss.map((s) => s.u)) > 1 && Math.max(...ss.map((s) => s.v)) - Math.min(...ss.map((s) => s.v)) > 0.8;
  const fitSecs = (ss: typeof secs): Plane => {
    const f = spread(ss) ? fitPlane(ss.map((s) => [s.u, s.v, s.w])) : null;
    return f && Math.hypot(f.a, f.b) <= tanMax ? f : { a: 0, b: 0, c: median(ss.map((s) => s.w)) };
  };
  let chosen: typeof secs = [];
  let alt: typeof secs = []; // tầng còn lại khi mơ hồ
  if (secs.length >= 3) {
    let bestPl: Plane | null = null, bestInl = 0;
    for (let i = 0; i < secs.length; i++) for (let j = i + 1; j < secs.length; j++) for (let k = j + 1; k < secs.length; k++) {
      const f = fitPlane([secs[i]!, secs[j]!, secs[k]!].map((s) => [s.u, s.v, s.w] as [number, number, number]));
      if (!f || Math.hypot(f.a, f.b) > tanMax) continue;
      const inl = secs.filter((s) => Math.abs(resOf(f, s)) <= cfg.planeTol).length;
      if (inl > bestInl) { bestInl = inl; bestPl = f; }
    }
    // ≥ 4 cung trên mặt: 3 cung dựng mặt phẳng nên luôn tự khớp, phải có thêm ít nhất 1 cung độc lập xác nhận (một job thật: thiếu điều
    // kiện này thì 3–4 cung ở các tầng khác nhau vẫn thành "mặt liền" nghiêng và cho lỗi thô tới ~90 cm).
    if (bestPl && bestInl >= Math.max(4, secs.length - 1)) chosen = secs.filter((s) => Math.abs(resOf(bestPl!, s)) <= cfg.planeTol);
  }
  if (!chosen.length && secs.length) {
    const layers: (typeof secs)[] = [];
    for (const s of [...secs].sort((a, b) => a.w - b.w)) {
      const last = layers[layers.length - 1];
      if (last && s.w - last[last.length - 1]!.w <= cfg.layerJoin) last.push(s); else layers.push([s]);
    }
    const levelOf = (ly: typeof secs) => median(ly.map((s) => s.w));
    if (contact) {
      const near = layers.reduce((b, ly) => (Math.abs(levelOf(ly) - contact.h) < Math.abs(levelOf(b) - contact.h) ? ly : b));
      if (Math.abs(levelOf(near) - contact.h) <= cfg.contactMatch) chosen = near;
    }
    if (!chosen.length && !contact && cfg.pw === 2 && pwW !== null) {
      // Không có lớp tiếp xúc để chọn tầng: lấy tầng gần mặt đất Patchwork++ nhất (nếu đủ gần) thay vì để mơ hồ.
      const nearest = layers.reduce((b, ly) => (Math.abs(levelOf(ly) - pwW) < Math.abs(levelOf(b) - pwW) ? ly : b));
      if (Math.abs(levelOf(nearest) - pwW) <= cfg.pwMatch) { chosen = nearest; pwTier = true; }
    }
    if (!chosen.length) {
      chosen = layers.find((ly) => ly.length >= 2) ?? layers.reduce((b, ly) => (ly.length > b.length ? ly : b));
      // Tầng cao hơn có ≥ 2 cung: có thể là vỉa hè (đúng là chọn tầng thấp) hoặc tầng thấp là hố / rãnh rộng (thì tầng cao mới đúng);
      // từ các cung không phân biệt được → mơ hồ: không tự dời box, chỉ báo khi lệch quá ngưỡng theo cả hai cách hiểu.
      if (!contact) alt = layers.find((ly) => ly !== chosen && ly.length >= 2 && levelOf(ly) > levelOf(chosen)) ?? [];
    }
  }
  for (const s of chosen) s.used = true;
  const ambiguous = alt.length > 0;
  const pl: Plane = chosen.length ? fitSecs(chosen) : { a: 0, b: 0, c: contact!.h };
  // Mặt đường = mặt trên của lớp: nâng mặt phẳng tâm lớp lên bằng nửa trên bề dày lớp. Bề dày đo theo phần dư so với MẶT PHẲNG
  // (không theo độ cao thô: trên mặt dốc, độ cao trong một cung trải ra vì chính độ dốc chứ không phải vì lớp dày).
  const halfThick = (rs: number[]) => { const s = [...rs].sort((a, b) => a - b); return s[Math.floor(0.9 * (s.length - 1))]! - median(s); };
  const lift = chosen.length
    ? median(chosen.map((s) => halfThick(s.lay.map((q) => q[2] - (pl.a * q[0] + pl.b * q[1] + pl.c)))))
    : contact!.top - contact!.h;
  const surface: Plane = { a: pl.a, b: pl.b, c: pl.c + lift };
  // Đáy box (nằm ngang) so với mặt đường TẠI TÂM chân box = độ cao trung bình dưới box, như cách nhãn đã qua QC được đặt. Không đẩy
  // theo góc cao nhất: trên dốc 5° với xe dài 4,8 m, luật "không góc nào chìm" báo "chìm" ~16 cm dù đáy đặt đúng; mặt phẳng nghiêng sai
  // thì tới ~80 cm (một job thật). Muốn box ôm mặt dốc thì Ground snap nghiêng box (dzTilt, roll / pitch).
  const target = surface.c;
  const dz = target - bottom;
  if (Math.abs(dz) > cfg.maxShift) return null;

  const corroborated = !!contact && chosen.length > 0 && Math.abs(pl.c - contact.h) <= cfg.corroborate;
  const res = chosen.map((s) => s.w - (pl.a * s.u + pl.b * s.v + pl.c));
  const rms = res.length ? Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length) : 0;
  const nS = chosen.length;
  let sigma = Math.hypot(rms, cfg.sigmaFloor) * (nS >= 4 ? 1 : nS === 3 ? 1.3 : nS === 2 ? 1.8 : nS === 1 ? 3 : 2);
  if (corroborated) sigma *= 0.8;
  sigma += cfg.sigmaPerMeter * (at.range ?? 0) + (ambiguous ? cfg.sigmaAmbiguous : 0);
  const confident = (nS >= 2 || corroborated) && !ambiguous;
  const exceeds = (d: number) => (d < 0 ? -d > cfg.floatTol : d > cfg.sinkTol); // vượt ngưỡng quy ước (đáy cao hơn mặt đường → d âm)
  // Mơ hồ (hai tầng): chỉ báo khi box lệch quá ngưỡng theo CẢ hai cách hiểu (đứng trên mặt đường hay trên vỉa hè).
  const altOk = !ambiguous || (() => { const d = median(alt.map((s) => s.w)) + lift - bottom; return Math.sign(d) === Math.sign(dz) && exceeds(d); })();
  const warn = (nS >= 2 || corroborated) && exceeds(dz) && altOk && Math.abs(dz) > cfg.sigmaK * sigma;
  const slopeDeg = (Math.atan(Math.hypot(surface.a, surface.b)) * 180) / Math.PI;
  return {
    groundW: target + at.cw, dz, sigma, rms, warn, confident, ambiguous, nSectors: nS, pw: pwTier ? 'tier' : pwOn ? 'filter' : 'off',
    contactW: contact ? contact.top + at.cw : null,
    marks: secs.map(({ lay: _lay, ...s }) => ({ ...s, u: s.u + at.cu, v: s.v + at.cv, w: s.w + lift + at.cw })),
    n: chosen.reduce((s, x) => s + x.n, 0) + (contact?.n ?? 0),
    flat: slopeDeg < 3, method: 'plane', slopeDeg, steep: slopeDeg > cfg.steepWarnDeg,
    plane: surface, dzTilt: surface.c + hw * Math.hypot(1, surface.a, surface.b), // tâm đáy nằm trên mặt dốc khi box nghiêng song song
  };
}

/**
 * Trước khi TỰ dời box theo phép đo `first` (đo tại `at`): đo lại tại vị trí sau khi dời. Phép đo phụ thuộc đáy box (dải tìm, lớp
 * tiếp xúc trong chân box) nên dời đi có thể đổi căn cứ; hai lần phải cùng một mặt đường (độ cao tại tâm chân box chênh không quá
 * recheckTol) và lần sau vẫn đủ căn cứ, không thì không dời (ý tưởng "đo lại theo footprint cuối cùng" của một tool tham khảo).
 */
export function confirmSnap(
  p: LocalPoints, sx: number, sy: number, sz: number, at: { cu: number; cv: number; cw: number; range?: number }, first: GroundResult,
  cfg: GroundConfig = DEFAULT_GROUND,
): boolean {
  if (!first.confident) return false;
  const second = groundSnap(p, sx, sy, sz, { ...at, cw: at.cw + first.dz }, cfg);
  return !!second && second.confident && Math.abs(second.groundW - first.groundW) <= cfg.recheckTol;
}
