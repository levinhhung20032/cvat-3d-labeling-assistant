import { describe, expect, it } from 'vitest';
import { isFixedSize, suggestBox } from '../src/shared/suggest';
import type { LocalPoints } from '../src/shared/fit';

const pts = (list: [number, number, number][]): LocalPoints => ({
  u: Float32Array.from(list.map((p) => p[0])),
  v: Float32Array.from(list.map((p) => p[1])),
  w: Float32Array.from(list.map((p) => p[2])),
  n: list.length,
});
const grid = (u0: number, u1: number, v0: number, v1: number, w = 0): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let u = u0; u <= u1 + 1e-9; u += 0.15) for (let v = v0; v <= v1 + 1e-9; v += 0.15) out.push([u, v, w]);
  return out;
};
// box 4 x 2 x 1.5 → hu=2, hv=1, hw=0.75

describe('isFixedSize', () => {
  it('theo tên nhãn thật, không phân biệt hoa thường', () => {
    expect(isFixedSize('vehicles')).toBe(true);
    expect(isFixedSize('Obstacle')).toBe(true);
    expect(isFixedSize('pedestrian')).toBe(false);
    expect(isFixedSize('two-wheels')).toBe(false);
  });
});

describe('suggestBox — nhãn kích thước cố định', () => {
  it("cụm điểm lệch về phía trước: dời box, không đổi kích thước · lệch sang phải: dời sang phải (v âm)", () => {
    {
    const s = suggestBox(pts(grid(-0.9, 2.7, -0.8, 0.8)), 4, 2, 1.5, true)!;
    expect(s).not.toBeNull();
    expect(s.box.sx).toBe(4);
    expect(s.box.sy).toBe(2);
    expect(s.box.cu).toBeGreaterThan(0.5);
    expect(s.box.cu).toBeLessThan(0.8);
    expect(Math.abs(s.box.cv)).toBeLessThan(0.05);
    expect(s.message).toMatch(/trước/);
  }
    {
    const s = suggestBox(pts(grid(-1.5, 1.5, -1.6, -0.2)), 4, 2, 1.5, true)!;
    expect(s.box.cv).toBeLessThan(-0.2);
    expect(s.message).toMatch(/phải/);
  }
  });
  it("cụm nằm gọn trong box: không có gợi ý · quá ít điểm: không gợi ý", () => {
    {
    expect(suggestBox(pts(grid(-1.5, 1.5, -0.8, 0.8)), 4, 2, 1.5, true)).toBeNull();
  }
    {
    expect(suggestBox(pts([[0, 0, 0], [1, 0, 0]]), 4, 2, 1.5, true)).toBeNull();
  }
  });
  it('điểm mặt đường sát đáy bị bỏ qua', () => {
    const ground = grid(-3, 3, -1.5, 1.5, -0.7);
    const body = grid(-1.5, 1.5, -0.8, 0.8);
    expect(suggestBox(pts([...ground, ...body]), 4, 2, 1.5, true)).toBeNull();
  });
});

describe('suggestBox — nhãn dynamic size', () => {
  it("đặt lại tâm và kích thước theo cụm · điểm vượt nóc: nới lên trên, đáy giữ nguyên", () => {
    {
    const s = suggestBox(pts(grid(-0.5, 1.9, -0.5, 0.5)), 4, 2, 1.5, false)!;
    expect(s.box.sx).toBeGreaterThan(2.2);
    expect(s.box.sx).toBeLessThan(2.6);
    expect(s.box.sy).toBeGreaterThan(0.8);
    expect(s.box.sy).toBeLessThan(1.1);
    expect(s.box.cu).toBeGreaterThan(0.4);
    expect(s.message).toMatch(/dài/);
  }
    {
    const body = grid(-1, 1, -0.5, 0.5, 0);
    const top = grid(-1, 1, -0.5, 0.5, 1.2);
    const s = suggestBox(pts([...body, ...top, ...top]), 2.2, 1.2, 1.5, false)!;
    expect(s.box.sz).toBeGreaterThan(1.5);
    expect(s.box.cw - s.box.sz / 2).toBeCloseTo(-1.5 / 2, 1); // mặt đáy không đổi
  }
  });
});
