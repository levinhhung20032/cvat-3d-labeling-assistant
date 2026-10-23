import type { LocalPoints } from './fit';

export interface GroundConfig {
  ring: number; // m: bề rộng vành đai quanh chân box dùng để đo mặt đất
  below: number; // m: lấy điểm thấp hơn đáy box tới mức này
  above: number; // m: và cao hơn đáy box tới mức này
  minPoints: number;
  quantile: number; // phân vị thấp của độ cao điểm vùng đáy = mặt đất (bỏ nhiễu dưới đáy)
  maxShift: number; // m: không tự dời quá mức này
  tolerance: number; // m: lệch nhỏ hơn mức này coi như đã đúng mặt đất
}

export const DEFAULT_GROUND: GroundConfig = { ring: 1.5, below: 1.0, above: 0.8, minPoints: 20, quantile: 0.2, maxShift: 1.0, tolerance: 0.03 };

export interface GroundResult {
  groundW: number; // độ cao mặt đất so với TÂM box hiện tại (m)
  dz: number; // phải dời box theo z bao nhiêu để đáy chạm mặt đất (âm = hạ xuống)
  n: number; // số điểm dùng để đo
  flat: boolean; // mặt đất đo được khá phẳng (độ trải thấp)
}

/**
 * Ground snap: ước lượng mặt đường dưới chân box rồi tính độ dời z để đáy box chạm mặt đường.
 * Ưu tiên điểm ở vành đai quanh chân box (không dính điểm của chính vật); thiếu thì dùng cả vùng dưới chân box.
 * `at` là vị trí đặt box thử (so với tâm hiện tại) — dùng khi vừa kéo box sang chỗ khác.
 * Trả null nếu không đủ điểm hoặc phải dời quá `maxShift`.
 */
export function groundSnap(
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
  return { groundW: groundW + at.cw, dz, n: pool.length, flat: at_(0.8) - at_(0.1) < 0.4 };
}
