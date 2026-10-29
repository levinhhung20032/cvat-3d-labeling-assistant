/**
 * Chuyển động của xe (ego) giữa hai frame liền nhau, ước lượng từ chính các box đã gán (không cần dữ liệu GPS / IMU; xem ego.ts).
 * Toạ độ nhãn theo ego, nên vật đứng yên "chạy" ngược lại khi xe chạy VÀ xoay khi xe đổi hướng: job 9999 xe đi ~9 m/frame, mỗi frame
 * xoay tới ±3°. Mỗi bước là phép biến đổi cứng 2D: điểm ở frame f−1 → toạ độ ở frame f, p' = R(θ)·p + t.
 * Tệp này không import gì để cả nội suy (interp.ts) lẫn cảnh báo (motion.ts) dùng chung mà không vòng import.
 */
export interface EgoStep { c: number; s: number; tx: number; ty: number; theta: number; inliers: number; pairs: number }
export interface EgoMotion { start: number; steps: Map<number, EgoStep> } // khoá = frame f (bước f−1 → f)

/**
 * Đưa điểm (và hướng) từ toạ độ frame g sang toạ độ frame f, g < f hoặc g > f (đi ngược bằng phép nghịch đảo);
 * null nếu thiếu một bước ego giữa hai frame.
 */
export function transform(ego: EgoMotion, x: number, y: number, yaw: number, g: number, f: number): { x: number; y: number; yaw: number } | null {
  let px = x, py = y, a = yaw;
  if (g <= f) {
    for (let k = g + 1; k <= f; k++) {
      const st = ego.steps.get(k);
      if (!st) return null;
      [px, py] = [st.c * px - st.s * py + st.tx, st.s * px + st.c * py + st.ty];
      a += st.theta;
    }
  } else {
    for (let k = g; k > f; k--) {
      const st = ego.steps.get(k);
      if (!st) return null;
      const dx = px - st.tx, dy = py - st.ty;
      [px, py] = [st.c * dx + st.s * dy, -st.s * dx + st.c * dy];
      a -= st.theta;
    }
  }
  return { x: px, y: py, yaw: a };
}
export const toFrame = (ego: EgoMotion, x: number, y: number, g: number, f: number) => {
  const r = transform(ego, x, y, 0, g, f);
  return r && { x: r.x, y: r.y };
};

let current: EgoMotion | null = null;
/** Ego của job đang mở (đặt một lần khi nạp job); null = chưa có, nội suy và cảnh báo dùng cách cũ trong hệ ego. */
export const setEgo = (e: EgoMotion | null) => { current = e; };
export const getEgo = () => current;
