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

describe('vùng quanh ego và dấu ego', () => {
  it('ego nằm đúng chỗ và hướng trước của ego quay theo yaw của box', async () => {
    const { egoInView, egoMarker, gatherEgoArea } = await import('../src/shared/view3d');
    const e = egoInView(C); // box tại (10, 5), yaw 90°
    // ego ở gốc: lùi 10 theo x, 5 theo y; hệ view: u theo +y ego, v theo −x ego
    expect(e.x).toBeCloseTo(-5); expect(e.y).toBeCloseTo(10); expect(e.z).toBeCloseTo(-1);
    expect(e.heading).toBeCloseTo(-Math.PI / 2);
    expect(e.dist).toBeCloseTo(Math.hypot(10, 5));
    const m = egoMarker(C);
    expect(m.icon[0]).toBeCloseTo(-5); expect(m.icon[1]).toBeCloseTo(10); expect(m.icon[2]).toBeCloseTo(-1 + 1.8);
    expect(m.ahead[0]).toBeCloseTo(-5 + 1.5 * Math.cos(-Math.PI / 2)); expect(m.ahead[1]).toBeCloseTo(10 + 1.5 * Math.sin(-Math.PI / 2));
    expect(m.lines.length % 6).toBe(0);
    // vùng quanh ego: lấy điểm gần gốc, bỏ điểm đã nằm trong vùng quanh box, bỏ điểm xa
    const xyz = Float32Array.from([1, 0, 0, 0, 2, 0.5, 20, 20, 0, 10, 5, 1]);
    const g = gatherEgoArea(xyz, 4, C, 3, 3);
    expect(g.n).toBe(2);
    expect(gatherEgoArea(xyz, 4, C, 0, 3).n).toBe(0);
  });
});

describe('góc quay so với ego và box gần ego', () => {
  it('yaw của box là góc lệch so với hướng trước của ego, chuẩn hoá về (−180, 180]', async () => {
    const { yawVsEgoDeg } = await import('../src/shared/view3d');
    expect(yawVsEgoDeg(0)).toBeCloseTo(0);
    expect(yawVsEgoDeg(Math.PI / 2)).toBeCloseTo(90);
    expect(yawVsEgoDeg(Math.PI)).toBeCloseTo(180);
    expect(yawVsEgoDeg(-Math.PI * 1.5)).toBeCloseTo(90);
    expect(yawVsEgoDeg(3 * Math.PI / 2)).toBeCloseTo(-90);
  });
  it('boxInView có thể ép lấy box ở xa (box gần ego nhưng xa box đang chọn)', () => {
    const far: Cuboid = { ...C, x: 100, y: 100 };
    expect(boxInView(C, far, 10)).toBeNull();
    expect(boxInView(C, far, 10, true)).not.toBeNull();
  });
});
