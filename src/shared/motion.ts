import { getEgo, toFrame } from './egoCore';
import { stateAt } from './interp';
import type { CvatTrack } from './types';

export interface MotionConfig {
  /** Ngưỡng sai lệch tối thiểu (m) so với vị trí dự đoán, theo tên nhãn (chữ thường). */
  base: Record<string, number>;
  defaultBase: number;
  /** Ngưỡng lệch ĐỘ CAO (z tâm box, m/frame) so với dự đoán, theo tên nhãn (chữ thường); mặc định rất lớn = không báo (cần rule `motionDz`). */
  zBase: Record<string, number>;
  zDefault: number;
  /** Cho phép sai lệch thêm theo tỉ lệ so với quãng đường dự kiến (vận tốc tương đối thay đổi dần). */
  rel: number;
  history: number; // số bước (frame có box) liền trước dùng để ước lượng vận tốc
  lookback: number; // tìm lùi tối đa bấy nhiêu frame
}

export const DEFAULT_MOTION: MotionConfig = {
  base: { vehicles: 1.0, vehicle: 1.0, 'two-wheels': 0.8, pedestrian: 0.6, animal: 0.8, obstacle: 0.5 },
  defaultBase: 1.0,
  zBase: {},
  zDefault: 1e6,
  rel: 0.35,
  history: 3,
  lookback: 8,
};

export interface MotionWarning {
  residual: number; // m: khoảng lệch (ngang) so với vị trí dự đoán
  threshold: number; // m
  horizontal: boolean; // đi xa bất thường (ngang)
  vertical: boolean; // đổi độ cao bất thường (z tâm box lệch so với dự đoán)
  dz: number; // m: z thực tế trừ z dự đoán (có dấu)
  step: number; // m/frame: bước thực tế
  typical: number; // m/frame: bước thường thấy ở các frame trước
  frames: number; // số frame trước dùng để dự đoán
  pred: { x: number; y: number; z: number }; // vị trí dự đoán
  message: string;
}

/**
 * Cảnh báo vật "đi xa bất thường": so vị trí ở frame f với vị trí DỰ ĐOÁN từ chuyển động (vận tốc không đổi)
 * của vài frame có box ngay trước đó. Tọa độ theo ego nên vật đứng yên cũng "trôi" theo tốc độ xe; vì vậy
 * so với vận tốc tương đối của chính các frame trước chứ không dùng ngưỡng tuyệt đối. Frame đầu của track
 * hoặc ít hơn 2 frame lịch sử thì không xét. Nếu giữa có khoảng outside (gap > 1) ngưỡng nới theo gap.
 * Chỉ báo khi vật đi XA HƠN thường lệ (bước thực tế > bước thường thấy); box đứng yên / chậm lại bất thường
 * là một vấn đề khác nên không báo ở đây.
 * Ngoài ra báo "đổi độ cao bất thường" khi z của tâm box lệch quá ngưỡng `zBase` (m / frame) so với z dự đoán cũng bằng vận tốc đều.
 */
export function motionJump(track: CvatTrack, f: number, label: string, cfg: MotionConfig = DEFAULT_MOTION): MotionWarning | null {
  const cur = stateAt(track, f).cuboid;
  if (!cur) return null;
  const hist: { g: number; x: number; y: number; z: number }[] = [];
  for (let g = f - 1; g >= Math.max(0, f - cfg.lookback) && hist.length < cfg.history + 1; g--) {
    const c = stateAt(track, g).cuboid;
    if (c) hist.push({ g, x: c.x, y: c.y, z: c.z });
  }
  if (hist.length < 2) return null;
  hist.reverse();
  const first = hist[0]!, last = hist[hist.length - 1]!;
  const span = last.g - first.g;
  const vx = (last.x - first.x) / span, vy = (last.y - first.y) / span, vz = (last.z - first.z) / span;
  const gap = f - last.g;
  let pred = { x: last.x + vx * gap, y: last.y + vy * gap, z: last.z + vz * gap };
  let typical = Math.hypot(vx, vy);
  let ref = { x: last.x, y: last.y }; // vị trí frame cuối lịch sử, đưa về cùng hệ với frame f để đo "bước thực tế"
  // Có chuyển động của xe (ego) cho các frame liên quan: dự đoán theo vận tốc so với MẶT ĐẤT rồi đưa về toạ độ frame f
  // (vật đứng yên không bị báo khi xe tăng / giảm tốc hay đổi hướng). Thiếu ego ở frame nào thì dùng cách cũ trong hệ ego.
  const ego = getEgo();
  if (ego) {
    const a0 = toFrame(ego, first.x, first.y, first.g, last.g);
    const lastToF = toFrame(ego, last.x, last.y, last.g, f);
    if (a0 && lastToF) {
      const wvx = (last.x - a0.x) / span, wvy = (last.y - a0.y) / span; // vận tốc theo toạ độ frame cuối lịch sử
      const moved = toFrame(ego, last.x + wvx * gap, last.y + wvy * gap, last.g, f);
      if (moved) {
        pred = { x: moved.x, y: moved.y, z: pred.z };
        typical = Math.hypot(wvx, wvy);
        ref = lastToF;
      }
    }
  }
  const residual = Math.hypot(cur.x - pred.x, cur.y - pred.y);
  const key = label.trim().toLowerCase();
  const base = cfg.base[key] ?? cfg.defaultBase;
  const threshold = Math.max(base, cfg.rel * typical) * gap;
  const step = Math.hypot(cur.x - ref.x, cur.y - ref.y) / gap;
  const horizontal = residual > threshold && step > typical;
  const dz = cur.z - pred.z;
  const zThreshold = (cfg.zBase[key] ?? cfg.zDefault) * gap;
  const vertical = Math.abs(dz) > zThreshold;
  if (!horizontal && !vertical) return null;
  const parts: string[] = [];
  if (horizontal) parts.push(`đi xa bất thường: lệch ${residual.toFixed(2)} m so với vị trí dự đoán từ ${hist.length} frame trước (bước ${step.toFixed(2)} m/frame, thường ~${typical.toFixed(2)})`);
  if (vertical) parts.push(`đổi độ cao bất thường: z lệch ${dz >= 0 ? '+' : '−'}${Math.abs(dz).toFixed(2)} m so với dự đoán từ ${hist.length} frame trước (> ${zThreshold.toFixed(2)} m)`);
  return { residual, threshold, step, typical, frames: hist.length, pred, horizontal, vertical, dz, message: parts.join('; ') };
}
