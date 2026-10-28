import { describe, expect, it } from 'vitest';
import { clampPan, NO_PAN, panBy, panOffset, pointVisible, type Scene } from '../src/panel/render';

const scene: Scene = { zClip: 5, slab: 2.5, colorHalf: 5 };
const grid: [number, number, number][] = [];
for (let u = -9; u <= 9; u += 1) for (let v = -9; v <= 9; v += 1) for (let w = -9; w <= 9; w += 1) grid.push([u, v, w]);

describe('zoom không làm tập điểm đổi ngoài ý muốn', () => {
  for (const view of ['top', 'side', 'front'] as const) {
    it(`view ${view}: vùng nhìn nhỏ nằm trọn trong vùng nhìn lớn (zoom ra chỉ thêm điểm ở rìa, không bớt điểm nào)`, () => {
      const inner = grid.filter(([u, v, w]) => pointVisible(view, u, v, w, 2.5, scene));
      const outer = grid.filter(([u, v, w]) => pointVisible(view, u, v, w, 10, scene));
      expect(inner.length).toBeGreaterThan(0);
      for (const p of inner) expect(outer).toContainEqual(p);
    });
    it(`view ${view}: mọi điểm thấy ở một khung nhìn đều có tọa độ nằm trong khung đó (không thêm điểm lạ ở giữa)`, () => {
      for (const half of [2, 4, 7]) {
        for (const [u, v, w] of grid.filter(([a, b, c]) => pointVisible(view, a, b, c, half, scene))) {
          const [sx, sy] = view === 'top' ? [v, u] : view === 'side' ? [u, w] : [v, w];
          expect(Math.abs(sx)).toBeLessThanOrEqual(half);
          expect(Math.abs(sy)).toBeLessThanOrEqual(half);
        }
      }
    });
  }
  it('ngưỡng trục còn lại cố định: cùng một điểm ở rìa trục bề dày được vẽ ở mọi mức zoom', () => {
    // điểm (u=1, v=2.4, w=0): trong lát cắt của view Bên (slab 2.5) — phải thấy ở zoom 2 m lẫn 9 m
    for (const half of [2.5, 4, 9]) expect(pointVisible('side', 1, 2.4, 0, half, scene)).toBe(true);
    // điểm ngoài lát cắt (v = 3) không bao giờ xuất hiện, dù zoom ra rất xa
    for (const half of [2.5, 4, 9]) expect(pointVisible('side', 1, 3, 0, half, scene)).toBe(false);
    // view Trên: điểm cao hơn zClip (w = 6) không bao giờ xuất hiện
    for (const half of [2.5, 4, 9]) expect(pointVisible('top', 1, 1, 6, half, scene)).toBe(false);
  });
});

describe('dời khung nhìn (giữ chuột phải kéo)', () => {
  for (const view of ['top', 'side', 'front'] as const) {
    it(`view ${view}: kéo chuột bao nhiêu thì hình đi theo chuột bấy nhiêu`, () => {
      const k = 20, p = panBy(view, panBy(view, NO_PAN, 1.5, -0.5), 0.5, 0.25);
      const [ox, oy] = panOffset(view, p, k);
      expect(ox).toBeCloseTo(2 * k);
      expect(oy).toBeCloseTo(-0.25 * k);
    });
  }
  it('chỉ dời hai trục lên màn hình; lát cắt theo trục còn lại vẫn tính quanh box', () => {
    const pan = { u: 3, v: 0, w: 0 };
    expect(pointVisible('side', 4, 0, 0, 2, scene)).toBe(false);
    expect(pointVisible('side', 4, 0, 0, 2, scene, pan)).toBe(true);
    // view Trước: trục u là bề dày lát cắt, dời u không làm điểm xa box lọt vào lát
    expect(pointVisible('front', 4, 0, 0, 2, scene, pan)).toBe(false);
  });
  it('không dời ra ngoài vùng điểm đã lọc', () => {
    expect(clampPan({ u: 9, v: -9, w: 1 }, 4)).toEqual({ u: 4, v: -4, w: 1 });
    expect(clampPan({ u: 9, v: -9, w: 1 }, 0)).toEqual({ u: 0, v: 0, w: 0 });
  });
});
