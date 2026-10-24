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

describe('groundSnap trên mặt đường dốc', () => {
  const big = (f: (u: number, v: number) => number): [number, number, number][] => {
    const out: [number, number, number][] = [];
    for (let u = -5.4; u <= 5.4; u += 0.25) for (let v = -4.4; v <= 4.4; v += 0.25) {
      if (Math.abs(u) <= 2.1 && Math.abs(v) <= 1.1) continue;
      out.push([u, v, f(u, v)]);
    }
    return out;
  };
  const t10 = Math.tan((10 * Math.PI) / 180);
  it('mặt phẳng ngang: khớp mặt phẳng, kết quả như phương pháp cũ', () => {
    const r = groundSnap(pts(big(() => -1.0)), 4, 2, 1.5)!;
    expect(r.method).toBe('plane');
    expect(r.dz).toBeCloseTo(-0.25, 2);
    expect(r.flat).toBe(true);
    expect(r.steep).toBe(false);
  });
  it('dốc 10° dọc theo xe: đo đúng độ dốc, đáy chạm phía cao nhưng góc nào cũng chỉ chìm ≤ 5 cm', () => {
    const r = groundSnap(pts(big((u) => -1.0 + t10 * u)), 4, 2, 1.5)!;
    expect(r.method).toBe('plane');
    expect(r.slopeDeg).toBeCloseTo(10, 0);
    expect(r.steep).toBe(true);
    expect(r.flat).toBe(false);
    const highCorner = -1.0 + t10 * 2;
    expect(r.groundW).toBeCloseTo(highCorner - 0.05, 2);
    expect(r.dz).toBeCloseTo(r.groundW + 0.75, 5);
  });
  it('dốc 4° sang bên: độ cao tại chân box, không bị kéo xuống bởi điểm phía thấp', () => {
    const t4 = Math.tan((4 * Math.PI) / 180);
    const r = groundSnap(pts(big((_u, v) => -0.9 + t4 * v)), 4, 2, 1.5)!;
    expect(r.slopeDeg).toBeCloseTo(4, 0);
    expect(r.groundW).toBeGreaterThan(-0.9 - 0.01); // quanh tâm mặt đường ở -0.9, góc cao hơn một chút
    expect(r.groundW).toBeLessThan(-0.9 + t4 * 1 + 0.001);
  });
  it('vỉa hè cao 20 cm ở một bên và cột đứng không làm lệch mặt phẳng', () => {
    const list = big((_u, v) => (v > 2.5 ? -0.8 : -1.0));
    for (let w = -1.0; w < 0.4; w += 0.1) list.push([3, -2.7, w]); // cột
    const r = groundSnap(pts(list), 4, 2, 1.5)!;
    expect(r.method).toBe('plane');
    expect(r.dz).toBeCloseTo(-0.25, 1);
  });
  it('ít ô mặt đường: quay về mặt phẳng ngang', () => {
    const sparse: [number, number, number][] = Array.from({ length: 30 }, (_, i) => [3 + (i % 5) * 0.01, 0.1 + (i % 3) * 0.01, -1.0]);
    const r = groundSnap(pts(sparse), 4, 2, 1.5)!;
    expect(r.method).toBe('level');
  });
});

import { tiltFromPlane } from '../src/shared/ground';
import { apply, fromEuler } from '../src/shared/rot';

describe('tiltFromPlane', () => {
  it('mặt ngang → không nghiêng', () => {
    const t = tiltFromPlane(0, 0, 1.2);
    expect(t.rx).toBeCloseTo(0, 9);
    expect(t.ry).toBeCloseTo(0, 9);
  });
  it('trục lên của box sau khi nghiêng trùng pháp tuyến mặt đường, với mọi yaw', () => {
    for (const yaw of [0, 0.7, -2.2, Math.PI / 2]) {
      const a = 0.15, b = -0.08;
      const { rx, ry } = tiltFromPlane(a, b, yaw);
      const up = apply(fromEuler(rx, ry, yaw), [0, 0, 1]);
      // pháp tuyến mặt w = a·u + b·v + c trong hệ thế giới
      const gx = a * Math.cos(yaw) - b * Math.sin(yaw), gy = a * Math.sin(yaw) + b * Math.cos(yaw), n = Math.hypot(gx, gy, 1);
      expect(up[0]).toBeCloseTo(-gx / n, 9);
      expect(up[1]).toBeCloseTo(-gy / n, 9);
      expect(up[2]).toBeCloseTo(1 / n, 9);
    }
  });
  it('dốc dọc xe 10° (đầu xe lên cao) → pitch xấp xỉ -10° khi yaw = 0 (ry âm = mũi nâng)', () => {
    const t = tiltFromPlane(Math.tan((10 * Math.PI) / 180), 0, 0);
    expect((t.ry * 180) / Math.PI).toBeCloseTo(-10, 3);
    expect(t.rx).toBeCloseTo(0, 9);
  });
  it('groundSnap trả mặt phẳng và độ dời khi nghiêng', () => {
    const t10 = Math.tan((10 * Math.PI) / 180);
    const list: [number, number, number][] = [];
    for (let u = -5.4; u <= 5.4; u += 0.25) for (let v = -4.4; v <= 4.4; v += 0.25) if (!(Math.abs(u) <= 2.1 && Math.abs(v) <= 1.1)) list.push([u, v, -1.0 + t10 * u]);
    const r = groundSnap(pts(list), 4, 2, 1.5)!;
    expect(r.plane!.a).toBeCloseTo(t10, 2);
    expect(r.dzTilt!).toBeCloseTo(-1.0 + 0.75 * Math.hypot(1, t10), 2);
  });
});
