import { describe, expect, it } from 'vitest';
import { groundSnap } from '../src/shared/ground';
import type { LocalPoints } from '../src/shared/fit';

const pts = (list: [number, number, number][]): LocalPoints => ({
  u: Float32Array.from(list.map((p) => p[0])),
  v: Float32Array.from(list.map((p) => p[1])),
  w: Float32Array.from(list.map((p) => p[2])),
  n: list.length,
});
/** lưới điểm mặt đất ở độ cao w, rải quanh box 4 x 2 (bỏ phần dưới chân box nếu skipFoot) */
const plane = (w: number, skipFoot = true, slope = 0): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let u = -3.4; u <= 3.4; u += 0.3) for (let v = -2.4; v <= 2.4; v += 0.3) {
    if (skipFoot && Math.abs(u) <= 2 && Math.abs(v) <= 1) continue;
    out.push([u, v, w + slope * u]);
  }
  return out;
};
// box 4 x 2 x 1.5 → hu=2, hv=1, hw=0.75, đáy ở w = -0.75

describe('groundSnap', () => {
  it('box lơ lửng 0,25 m: phải hạ xuống 0,25', () => {
    const r = groundSnap(pts(plane(-1.0)), 4, 2, 1.5)!;
    expect(r).not.toBeNull();
    expect(r.dz).toBeCloseTo(-0.25, 2);
    expect(r.groundW).toBeCloseTo(-1.0, 2);
    expect(r.flat).toBe(true);
  });
  it('box chìm 0,2 m: phải nâng lên 0,2', () => {
    expect(groundSnap(pts(plane(-0.55)), 4, 2, 1.5)!.dz).toBeCloseTo(0.2, 2);
  });
  it('đã chạm đất: dz ≈ 0', () => {
    expect(Math.abs(groundSnap(pts(plane(-0.75)), 4, 2, 1.5)!.dz)).toBeLessThan(0.01);
  });
  it('điểm của chính vật (thân xe) không làm lệch kết quả', () => {
    const body: [number, number, number][] = [];
    for (let u = -1.8; u <= 1.8; u += 0.3) for (let v = -0.9; v <= 0.9; v += 0.3) for (const w of [-0.4, 0, 0.5]) body.push([u, v, w]);
    expect(groundSnap(pts([...plane(-1.0), ...body]), 4, 2, 1.5)!.dz).toBeCloseTo(-0.25, 2);
  });
  it('vài điểm nhiễu thấp hơn mặt đất không phá kết quả', () => {
    const noise: [number, number, number][] = [[2.5, 0.2, -1.6], [2.8, 0.5, -1.7], [-2.6, 0.1, -1.55]];
    expect(groundSnap(pts([...plane(-1.0), ...noise]), 4, 2, 1.5)!.dz).toBeCloseTo(-0.25, 1);
  });
  it('chỉ có điểm dưới chân box vẫn đo được (dự phòng)', () => {
    const foot: [number, number, number][] = [];
    for (let u = -1.8; u <= 1.8; u += 0.2) for (let v = -0.9; v <= 0.9; v += 0.2) foot.push([u, v, -0.95]);
    expect(groundSnap(pts(foot), 4, 2, 1.5)!.dz).toBeCloseTo(-0.2, 2);
  });
  it('quá ít điểm hoặc phải dời quá xa: null', () => {
    expect(groundSnap(pts([[3, 0, -1], [3, 1, -1]]), 4, 2, 1.5)).toBeNull();
    expect(groundSnap(pts(plane(-2.2)), 4, 2, 1.5)).toBeNull(); // dời 1,45 m > 1 m
  });
  it('mặt dốc: độ trải lớn → flat=false', () => {
    expect(groundSnap(pts(plane(-1.0, true, 0.2)), 4, 2, 1.5)!.flat).toBe(false);
  });
  it('vị trí đặt thử: dời box sang chỗ mặt đất cao hơn thì đo lại theo chỗ mới', () => {
    // mặt đất dốc lên theo u; đặt box ở u = +1 thì mặt đất ở đó cao hơn 0,2
    const list = plane(-1.0, false, 0.2);
    const a = groundSnap(pts(list), 4, 2, 1.5)!;
    const b = groundSnap(pts(list), 4, 2, 1.5, { cu: 1, cv: 0, cw: 0 })!;
    expect(b.dz).toBeGreaterThan(a.dz);
  });
});
