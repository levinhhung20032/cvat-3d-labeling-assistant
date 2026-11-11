import { describe, expect, it } from 'vitest';
import { boxEdges, boxInView, gatherAround, lookAt, mul, orbitMatrix, perspective, projectPoint, defaultOrbit } from '../src/shared/view3d';
import type { Cuboid } from '../src/shared/cuboid';

const C: Cuboid = { x: 10, y: 5, z: 1, rx: 0, ry: 0, yaw: Math.PI / 2, sx: 4, sy: 2, sz: 1.5 };

describe('view 3D', () => {
  it('gom điểm trong bán kính, đổi sang hệ box, đánh dấu điểm trong box', () => {
    // box quay 90°: trục u của box trỏ theo +y của ego
    const xyz = Float32Array.from([
      10, 6.5, 1, // trước box 1.5 m → u = 1.5, trong box (nửa dài 2)
      10, 5, 1.9, // cao hơn tâm 0.9 > nửa cao 0.75 → ngoài box
      10, 30, 1, // xa 25 m → bị loại với bán kính 10
      16, 5, 1, // v = -6 → trong bán kính, ngoài box
    ]);
    const g = gatherAround(xyz, 4, C, 10);
    expect(g.n).toBe(3);
    expect(g.pos[0]).toBeCloseTo(1.5); expect(g.pos[1]).toBeCloseTo(0, 5);
    expect([...g.inBox]).toEqual([1, 0, 0]);
  });
  it('giới hạn số điểm', () => {
    const xyz = new Float32Array(30 * 3);
    for (let i = 0; i < 30; i++) { xyz[i * 3] = 10; xyz[i * 3 + 1] = 5; xyz[i * 3 + 2] = 1; }
    expect(gatherAround(xyz, 30, C, 5, 10).n).toBe(10);
  });
  it('box của object khác: chỉ lấy trong tầm, yaw tương đối', () => {
    const near: Cuboid = { ...C, x: 10, y: 8, yaw: Math.PI / 2 + 0.5 };
    const b = boxInView(C, near, 10)!;
    expect(b.cu).toBeCloseTo(3); expect(b.cv).toBeCloseTo(0, 5); expect(b.yaw).toBeCloseTo(0.5);
    expect(boxInView(C, { ...C, x: 100 }, 10)).toBeNull();
  });
  it('box có 14 đoạn', () => {
    const e = boxEdges({ cu: 0, cv: 0, cw: 0, yaw: 0, sx: 4, sy: 2, sz: 1 });
    expect(e.length).toBe(14 * 6);
    expect(Math.max(...e)).toBeCloseTo(2);
  });
  it('chiếu: gốc nằm giữa màn hình', () => {
    const m = orbitMatrix(defaultOrbit(10), 1.5, 10);
    const p = projectPoint(m, 0, 0, 0, 600, 400)!;
    expect(p[0]).toBeCloseTo(300, 3); expect(p[1]).toBeCloseTo(200, 3);
    expect(projectPoint(mul(perspective(1, 1, 0.1, 100), lookAt([0, 0, 5], [0, 0, 0], [0, 1, 0])), 0, 0, 10, 100, 100)).toBeNull(); // sau camera
  });
});
