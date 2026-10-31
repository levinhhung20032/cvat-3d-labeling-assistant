import { describe, expect, it } from 'vitest';
import { reflectionPlane } from '../src/shared/reflect';

const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
/** Xe 4 × 1,8 × 1,5 (đáy ở w = −0,75): vỏ ngoài lấy mẫu + ảnh phản chiếu qua mặt w = h0 (thưa hơn). */
function car(h0: number | null, seed = 1) {
  const r = rng(seed);
  const u: number[] = [], v: number[] = [], w: number[] = [];
  for (let i = 0; i < 1500; i++) {
    const side = r();
    const pu = side < 0.4 ? (r() < 0.5 ? -2 : 2) * 0.98 : (r() - 0.5) * 3.9;
    const pv = side >= 0.4 && side < 0.8 ? (r() < 0.5 ? -0.88 : 0.88) : (r() - 0.5) * 1.75;
    const pw = -0.55 + r() * (0.7 + 0.5 * Math.cos(pu)); // nóc thấp dần về hai đầu
    u.push(pu); v.push(pv); w.push(pw);
    if (h0 !== null && r() < 0.5) { u.push(pu + (r() - 0.5) * 0.04); v.push(pv); w.push(2 * h0 - pw + (r() - 0.5) * 0.04); }
  }
  for (let i = 0; i < 400; i++) { u.push((r() - 0.5) * 4); v.push((r() - 0.5) * 1.8); w.push((h0 ?? -0.75) + (r() - 0.5) * 0.03); } // mặt đường dưới gầm
  return { u: Float32Array.from(u), v: Float32Array.from(v), w: Float32Array.from(w), n: u.length };
}

describe('mặt đường suy ra từ ảnh phản chiếu', () => {
  it('tìm đúng mặt gương (sai số ≤ 3 cm) và mặt gương lệch xa thì mức trùng giảm', () => {
    for (const h0 of [-0.75, -0.8, -0.68]) {
      const f = reflectionPlane(car(h0), 4, 1.8, 1.5)!;
      expect(f.valid).toBe(true);
      expect(Math.abs(f.h - h0)).toBeLessThanOrEqual(0.03);
      expect(f.scoreAt(h0 + 0.2)).toBeLessThan(0.7 * f.best);
    }
  });
  it('không có ảnh phản chiếu → không dùng làm mốc', () => {
    const f = reflectionPlane(car(null), 4, 1.8, 1.5);
    expect(!f || !f.valid).toBe(true);
  });
  it('đỉnh bẹt (tường thẳng đứng): h là tâm cao nguyên, sai số ≤ 3 cm', () => {
    const r = rng(7), u: number[] = [], v: number[] = [], w: number[] = [], h0 = -0.78;
    for (let i = 0; i < 2000; i++) {
      const pu = (r() < 0.5 ? -1 : 1) * 1.98, pv = (r() - 0.5) * 1.7, pw = -0.55 + r() * 1.2;
      u.push(pu); v.push(pv); w.push(pw);
      if (r() < 0.6) { u.push(pu); v.push(pv); w.push(2 * h0 - pw); }
    }
    const f = reflectionPlane({ u: Float32Array.from(u), v: Float32Array.from(v), w: Float32Array.from(w), n: u.length }, 4, 1.8, 1.5);
    expect(f).not.toBeNull();
    expect(Math.abs(f!.h - h0)).toBeLessThanOrEqual(0.03);
  });
});
