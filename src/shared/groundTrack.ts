import type { GroundResult } from './ground';

/**
 * Mặt đường dưới MỘT vật thể theo thời gian: độ cao mặt đường dưới object đổi chậm giữa các frame liền nhau (xe chạy trên đường), nên một
 * phép đo lẻ loi (che khuất, nhiễu, cụm điểm của vật khác) khác hẳn các frame lân cận là đo sai. Từ các phép đo của các frame lân cận
 * dự đoán mặt đường (hồi quy tuyến tính bền theo frame); phép đo lệch dự đoán quá `tol` thì bị thay bằng dự đoán, frame không đo được
 * thì lấy dự đoán nếu đủ frame lân cận nhất quán. Không đủ dữ kiện → giữ phép đo gốc (hoặc không có gì).
 */
export interface GroundFrameIn {
  f: number;
  z: number; // tâm box (z tuyệt đối)
  sz: number; // chiều cao box
  raw: GroundResult | null; // phép đo của chính frame này (groundSnap)
  footLowW?: number; // độ cao thấp nhất đáng tin của điểm trong chân box (w, tâm box = 0; footprintLow) để kiểm chứng kết quả "chìm"
}
/** Chìm bao nhiêu thì còn bị điểm thật trong chân box bác bỏ: có điểm thấp hơn mặt đường này quá mức đó. */
const FOOT_CONTRADICT = 0.08;
export interface RefineConfig {
  window: number; // chỉ dùng frame lân cận trong ±window frame
  minNeighbors: number; // số frame lân cận tối thiểu để dám bác bỏ phép đo của frame này
  tol: number; // m: phép đo lệch dự đoán quá mức này là ngoại lai
  minPred: number; // số frame lân cận tối thiểu để dự đoán khi frame này không đo được
  maxPairSpread: number; // m: khi chỉ có 2 frame lân cận, hai giá trị không được lệch nhau quá mức này
  maxShift: number; // m: không gợi ý dời quá mức này
}
export const DEFAULT_REFINE: RefineConfig = { window: 6, minNeighbors: 3, tol: 0.1, minPred: 2, maxPairSpread: 0.15, maxShift: 1.0 };

const median = (v: number[]) => {
  const s = [...v].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2;
};

/** Dự đoán độ cao mặt đường tại frame `at` từ các điểm (frame, gz): hồi quy bền Theil–Sen khi ≥ 3 điểm. */
export function predictGround(pts: { f: number; gz: number }[], at: number, cfg: RefineConfig = DEFAULT_REFINE): number | null {
  if (pts.length >= 3) {
    const slopes: number[] = [];
    for (let i = 0; i < pts.length; i++) for (let j = i + 1; j < pts.length; j++) if (pts[j]!.f !== pts[i]!.f) slopes.push((pts[j]!.gz - pts[i]!.gz) / (pts[j]!.f - pts[i]!.f));
    const slope = slopes.length ? Math.max(-0.1, Math.min(0.1, median(slopes))) : 0; // mặt đường không dốc quá ~10 cm / frame
    const b = median(pts.map((p) => p.gz - slope * p.f));
    return slope * at + b;
  }
  if (pts.length === 2 && cfg.minPred <= 2 && Math.abs(pts[0]!.gz - pts[1]!.gz) <= cfg.maxPairSpread) return (pts[0]!.gz + pts[1]!.gz) / 2;
  return null;
}

/** Kết quả cuối cùng cho từng frame (null = không gợi ý). `source` cho biết dùng phép đo hay dự đoán theo frame khác. */
export function refineGround(frames: GroundFrameIn[], cfg: RefineConfig = DEFAULT_REFINE): Map<number, GroundResult | null> {
  const abs = new Map<number, number>(); // gz tuyệt đối của các phép đo hợp lệ
  for (const x of frames) if (x.raw) abs.set(x.f, x.z + x.raw.groundW);
  const out = new Map<number, GroundResult | null>();
  for (const x of frames) {
    const neighbors = [...abs].filter(([g]) => g !== x.f && Math.abs(g - x.f) <= cfg.window).map(([f, gz]) => ({ f, gz }));
    const own = abs.get(x.f);
    const pred = neighbors.length >= (own === undefined ? cfg.minPred : cfg.minNeighbors) ? predictGround(neighbors, x.f, cfg) : null;
    let gz: number | null = null, source: 'measured' | 'predicted' = 'measured';
    if (own !== undefined) {
      // Phép đo cục bộ đáng tin (mặt đường sát chân vật, khớp mặt phẳng tốt) thì giữ: mặt đường của từng vật thể có thể đổi đột ngột (vỉa, dốc, ổ gà), dự đoán theo frame không đại diện được.
      if (!x.raw?.reliable && pred !== null && Math.abs(own - pred) > cfg.tol) { gz = pred; source = 'predicted'; } else gz = own;
    } else if (pred !== null) { gz = pred; source = 'predicted'; }
    if (gz === null) { out.set(x.f, null); continue; }
    const groundW = gz - x.z, dz = groundW + x.sz / 2;
    if (Math.abs(dz) > cfg.maxShift) { out.set(x.f, null); continue; }
    // Báo "chìm" mà lại có điểm thật nằm dưới mặt đường đó trong chân box → mặt đường sai, không gợi ý.
    if (dz > 0 && x.footLowW !== undefined && x.footLowW < groundW - FOOT_CONTRADICT) { out.set(x.f, null); continue; }
    out.set(x.f, source === 'measured' && x.raw ? { ...x.raw, source } : {
      groundW, dz, n: 0, flat: true, method: 'plane', slopeDeg: x.raw?.slopeDeg, source,
    });
  }
  return out;
}
