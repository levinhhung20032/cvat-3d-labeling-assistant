/**
 * Độ cao đáy box so với các box xung quanh (lỗi Z1). Đáy = z − cao/2. Lấy trung vị đáy của các box khác trong bán kính (mặt phẳng ngang)
 * cùng frame; trung vị nên vài box cũng lỗi không kéo lệch mốc. Ít hơn `minBoxes` box xung quanh thì không đủ cơ sở (null).
 */
export interface SurroundConfig { radius: number; minBoxes: number }
export const DEFAULT_SURROUND: SurroundConfig = { radius: 10, minBoxes: 2 };

export interface BoxLite { x: number; y: number; z: number; sz: number }

export function surroundBottom(self: Pick<BoxLite, 'x' | 'y'>, others: readonly BoxLite[], cfg: SurroundConfig = DEFAULT_SURROUND): { bottom: number; n: number } | null {
  const bs: number[] = [];
  for (const o of others) if (Math.hypot(o.x - self.x, o.y - self.y) <= cfg.radius) bs.push(o.z - o.sz / 2);
  if (bs.length < cfg.minBoxes || !bs.length) return null;
  bs.sort((a, b) => a - b);
  const m = bs.length >> 1;
  return { bottom: bs.length % 2 ? bs[m]! : (bs[m - 1]! + bs[m]!) / 2, n: bs.length };
}
