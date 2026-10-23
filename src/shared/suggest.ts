import type { LocalBox } from './edit';
import { DEFAULT_FIT, type FitConfig, type LocalPoints } from './fit';

export interface Suggestion {
  box: LocalBox; // box đề xuất trong hệ tọa độ của box hiện tại
  message: string;
}

/** Nhãn có kích thước cố định (tắt dynamic size): chỉ dời box, không đổi kích thước. Khớp theo tên nhãn thật, không phân biệt hoa thường. */
export const FIXED_SIZE_LABELS = ['vehicle', 'vehicles', 'obstacle'];
export const isFixedSize = (label: string) => FIXED_SIZE_LABELS.includes(label.trim().toLowerCase());

function pct(a: number[], q: number): number {
  const s = Float64Array.from(a).sort();
  return s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]!;
}

const fmt = (m: number) => `${Math.abs(m).toFixed(2)} m`;

/**
 * Gợi ý sửa box cho cụm điểm lidar quanh nó (không cộng biên).
 * - Nhãn kích thước cố định: dời box tối thiểu để bao cụm điểm (không đổi kích thước).
 * - Nhãn dynamic size: đặt lại tâm và kích thước theo phạm vi cụm (phân vị 3–97% để bỏ nhiễu);
 *   phía trên chỉ nới thêm khi điểm vượt nóc. Đáy giữ nguyên (mặt đường).
 * Trả null khi quá ít điểm hoặc thay đổi không đáng kể. Chỉ là đề xuất — người dùng chấp nhận mới áp.
 */
export function suggestBox(
  p: LocalPoints, sx: number, sy: number, sz: number, fixedSize: boolean, cfg: FitConfig = DEFAULT_FIT,
): Suggestion | null {
  const hu = sx / 2, hv = sy / 2, hw = sz / 2;
  const us: number[] = [], vs: number[] = [], ws: number[] = [];
  for (let i = 0; i < p.n; i++) {
    const u = p.u[i]!, v = p.v[i]!, w = p.w[i]!;
    if (w < -hw + cfg.groundClear) continue; // mặt đường
    if (Math.abs(u) > hu + cfg.margin || Math.abs(v) > hv + cfg.margin || w > hw + cfg.margin) continue;
    us.push(u); vs.push(v); ws.push(w);
  }
  if (us.length < cfg.minShell) return null;
  const uLo = pct(us, 0.03), uHi = pct(us, 0.97), vLo = pct(vs, 0.03), vHi = pct(vs, 0.97), wHi = pct(ws, 0.97);

  const box: LocalBox = { cu: 0, cv: 0, cw: 0, dyaw: 0, sx, sy, sz };
  const parts: string[] = [];
  if (fixedSize) {
    const shift = (lo: number, hi: number, h: number, size: number) =>
      hi - lo > size ? (hi + lo) / 2 : hi > h ? hi - h : lo < -h ? lo + h : 0;
    box.cu = shift(uLo, uHi, hu, sx);
    box.cv = shift(vLo, vHi, hv, sy);
    if (Math.abs(box.cu) >= 0.05) parts.push(`dời ${fmt(box.cu)} về phía ${box.cu > 0 ? 'trước' : 'sau'}`);
    if (Math.abs(box.cv) >= 0.05) parts.push(`dời ${fmt(box.cv)} sang ${box.cv > 0 ? 'trái' : 'phải'}`);
  } else {
    const newU = Math.max(0.3, uHi - uLo), newV = Math.max(0.3, vHi - vLo);
    box.cu = (uHi + uLo) / 2; box.cv = (vHi + vLo) / 2;
    box.sx = newU; box.sy = newV;
    if (wHi > hw + 0.05) { box.sz = sz + (wHi - hw); box.cw = (wHi - hw) / 2; }
    if (Math.abs(newU - sx) >= 0.05) parts.push(`dài ${sx.toFixed(2)} → ${newU.toFixed(2)} m`);
    if (Math.abs(newV - sy) >= 0.05) parts.push(`rộng ${sy.toFixed(2)} → ${newV.toFixed(2)} m`);
    if (box.sz !== sz) parts.push(`cao ${sz.toFixed(2)} → ${box.sz.toFixed(2)} m`);
    if (Math.abs(box.cu) >= 0.05 || Math.abs(box.cv) >= 0.05) parts.push(`tâm dời (${box.cu.toFixed(2)}, ${box.cv.toFixed(2)}) m`);
  }
  if (!parts.length) return null;
  return { box, message: `gợi ý: ${parts.join(', ')}` };
}
