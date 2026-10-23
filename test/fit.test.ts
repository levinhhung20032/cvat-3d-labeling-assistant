import { describe, expect, it } from 'vitest';
import { fitReport, type LocalPoints } from '../src/shared/fit';

const pts = (list: [number, number, number][]): LocalPoints => ({
  u: Float32Array.from(list.map((p) => p[0])),
  v: Float32Array.from(list.map((p) => p[1])),
  w: Float32Array.from(list.map((p) => p[2])),
  n: list.length,
});
// box 4 x 2 x 1.5 → hu=2, hv=1, hw=0.75
const list = (n: number, f: (i: number) => [number, number, number]) => Array.from({ length: n }, (_, i) => f(i));
const cloud = (n: number, f: (i: number) => [number, number, number]) => pts(list(n, f));

describe('fitReport', () => {
  it('cụm điểm nằm gọn trong box: ok', () => {
    const r = fitReport(cloud(60, (i) => [-1.5 + (i % 10) * 0.3, -0.8 + (i % 6) * 0.3, -0.4 + (i % 5) * 0.2]), 4, 2, 1.5);
    expect(r.level).toBe('ok');
    expect(r.inside).toBe(60);
  });
  it('nhiều điểm lọt ra phía trước: misfit, phía "trước"', () => {
    const inside = Array.from({ length: 30 }, (_, i): [number, number, number] => [-1 + (i % 6) * 0.3, -0.5 + (i % 5) * 0.25, 0]);
    const front = Array.from({ length: 30 }, (_, i): [number, number, number] => [2.2 + (i % 4) * 0.1, -0.5 + (i % 5) * 0.25, 0]);
    const r = fitReport(pts([...inside, ...front]), 4, 2, 1.5);
    expect(r.level).toBe('misfit');
    expect(r.side).toBe('trước');
    expect(r.overshoot).toBeGreaterThan(0.1);
    expect(r.message).toMatch(/trước/);
  });
  it('ít điểm trong box: sparse (guideline < 6 điểm)', () => {
    const r = fitReport(pts([[0, 0, 0], [0.5, 0, 0], [0, 0.5, 0]]), 4, 2, 1.5);
    expect(r.level).toBe('sparse');
  });
  it('bỏ qua điểm mặt đường sát đáy box', () => {
    const ground = list(200, (i) => [-3 + (i % 20) * 0.3, -1.8 + Math.floor(i / 20) * 0.35, -0.7]);
    const body = list(40, (i) => [-1 + (i % 8) * 0.25, -0.6 + (i % 5) * 0.3, 0.1]);
    expect(fitReport(pts([...ground, ...body]), 4, 2, 1.5).level).toBe('ok');
  });
  it('vài điểm rời rạc ngoài box không đủ ngưỡng: ok', () => {
    const body = list(80, (i) => [-1.5 + (i % 10) * 0.3, -0.8 + (i % 8) * 0.2, 0]);
    const stray = list(5, () => [2.3, 0, 0]);
    expect(fitReport(pts([...body, ...stray]), 4, 2, 1.5).level).toBe('ok');
  });
});

