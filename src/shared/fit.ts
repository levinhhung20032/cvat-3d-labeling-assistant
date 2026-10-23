/** Điểm trong hệ tọa độ của box: u dọc hướng box, v sang trái, w lên; gốc = tâm box. */
export interface LocalPoints { u: Float32Array; v: Float32Array; w: Float32Array; n: number }

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
 * Kiểm tra box có bao đúng cụm điểm không. Không dùng "tâm cụm lệch tâm box" vì lidar thường chỉ thấy
 * một phía của vật (che khuất) nên tâm cụm lệch là bình thường; thay vào đó đếm điểm nằm NGOÀI box
 * ngay sát mặt box (box thiếu / dời sai) so với điểm nằm trong.
 */
export function fitReport(
  p: LocalPoints, sx: number, sy: number, sz: number, cfg: FitConfig = DEFAULT_FIT,
): FitReport {
  const hu = sx / 2, hv = sy / 2, hw = sz / 2;
  let inside = 0, outside = 0;
  const cnt: Record<Side, number> = { trước: 0, sau: 0, trái: 0, phải: 0, trên: 0 };
  const sum: Record<Side, number> = { trước: 0, sau: 0, trái: 0, phải: 0, trên: 0 };
  for (let i = 0; i < p.n; i++) {
    const u = p.u[i]!, v = p.v[i]!, w = p.w[i]!;
    if (w < -hw + cfg.groundClear) continue; // mặt đường / đáy
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
