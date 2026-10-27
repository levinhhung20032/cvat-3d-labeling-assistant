import { describe, expect, it } from 'vitest';
import { findOverlaps, groupPairs, intersectionArea, footprint, overlapIou, allowedIou } from '../src/shared/overlap';
import { detectAnchors, propagateEdit, propagateSize, sameSize } from '../src/shared/dynsize';
import { parseCuboid } from '../src/shared/cuboid';
import { serializeCuboid, type Cuboid } from '../src/shared/cuboid';
import { shape, track } from './fixtures';
import type { CvatTrack } from '../src/shared/types';

const cub = (x: number, y: number, o: Partial<Cuboid> = {}): Cuboid => ({ x, y, z: 0, rx: 0, ry: 0, yaw: 0, sx: 4, sy: 2, sz: 1.5, ...o });
const tr = (frames: [number, Cuboid, boolean?][]): CvatTrack =>
  track(1, frames.map(([f, c, out]) => ({ ...shape(f, !!out), points: serializeCuboid(c, Array(16).fill(0)) })));

describe('chồng lấn', () => {
  it("diện tích giao hình chữ nhật · xoay 90° vẫn đúng", () => {
    {
    expect(intersectionArea(footprint(cub(0, 0)), footprint(cub(2, 0)))).toBeCloseTo(4); // chung nửa chiều dài: 2 × 2
    expect(intersectionArea(footprint(cub(0, 0)), footprint(cub(10, 0)))).toBe(0);
  }
    {
    expect(intersectionArea(footprint(cub(0, 0)), footprint(cub(0, 0, { yaw: Math.PI / 2 })))).toBeCloseTo(4); // 2×2 ở giữa
  }
  });
  it("IoU và diện tích giao, cần chồng chiều cao · tìm cặp giữa các ID khác nhau, bỏ qua frame outside và box chỉ chạm nhau", () => {
    {
    const r = overlapIou(cub(0, 0), cub(0, 0, { sx: 1, sy: 1 }));
    expect(r.iou).toBeCloseTo(1 / 8); expect(r.inter).toBeCloseTo(1);
    expect(overlapIou(cub(0, 0), cub(0, 0, { z: 5 })).iou).toBe(1); // mặc định như tool QC: không xét chiều cao
    expect(overlapIou(cub(0, 0), cub(0, 0, { z: 5 }), { allowed: {}, defaultAllowed: 0, minArea: 0.001, minZ: 0.01 }).iou).toBe(0);
  }
    {
    const a = tr([[0, cub(0, 0)], [1, cub(0, 0)]]);
    const b = tr([[0, cub(1, 0, { sx: 2 })], [1, cub(1, 0, { sx: 2 }), true]]);
    const c = tr([[0, cub(4, 0)], [1, cub(4, 0)]]); // chỉ chạm cạnh a (giao diện tích 0)
    const items = findOverlaps([a, b, c], [0, 1], ['vehicles', 'vehicles', 'vehicles']);
    expect(items.map((i) => [i.a, i.b, i.frame])).toEqual([[1, 2, 0]]);
    expect(groupPairs(items)).toEqual([{ a: 1, b: 2, frames: [0], max: items[0]!.ratio }]);
  }
  });
  it("ngưỡng theo nhóm: xe không cho chồng, người / xe máy cho tới IoU 0.5 · phần giao dưới 0.001 m² thì bỏ qua", () => {
    {
    expect(allowedIou('vehicles')).toBe(0); expect(allowedIou('Two-wheels')).toBe(0.5); expect(allowedIou('pedestrian')).toBe(0.5);
    const a = tr([[0, cub(0, 0)]]);
    const b = tr([[0, cub(3.5, 0)]]); // giao 1 m² → IoU 1/15
    expect(findOverlaps([a, b], [0], ['vehicles', 'vehicles']).length).toBe(1);
    expect(findOverlaps([a, b], [0], ['pedestrian', 'pedestrian'])).toEqual([]);
    expect(findOverlaps([a, b], [0], ['pedestrian', 'vehicles']).length).toBe(1); // khác nhóm: lấy mức chặt hơn
  }
    {
    const a = tr([[0, cub(0, 0)]]);
    const b = tr([[0, cub(3.9995, 0)]]); // giao 0.0005 × 2 = 0.001 → vừa đủ không tính khi nhỏ hơn
    expect(findOverlaps([a, b], [0], ['vehicles', 'vehicles'], { ...{ allowed: { vehicle: 0 }, defaultAllowed: 0, minZ: 0.01 }, minArea: 0.002 })).toEqual([]);
  }
  });
});

describe('dynamic size tắt', () => {
  it("áp kích thước mới cho mọi keyframe có box, giữ nguyên vị trí và keyframe outside · không đổi gì khi cùng kích thước", () => {
    {
    const t = tr([[0, cub(0, 0)], [3, cub(1, 1), true], [5, cub(2, 2)]]);
    const r = propagateSize(t, { sx: 5, sy: 2.2, sz: 1.8 });
    expect(r.frames).toEqual([0, 5]);
    expect(r.track.shapes.find((s) => s.frame === 5)!.points.slice(0, 9)).toEqual([2, 2, 0, 0, 0, 0, 5, 2.2, 1.8]);
    expect(r.track.shapes.find((s) => s.frame === 3)!.points[6]).toBe(4);
    expect(r.track.id).toBe(t.id);
  }
    {
    const t = tr([[0, cub(0, 0)]]);
    expect(propagateSize(t, { sx: 4, sy: 2, sz: 1.5 }).track).toBe(t);
    expect(sameSize({ sx: 1, sy: 2, sz: 3 }, { sx: 1, sy: 2, sz: 3 })).toBe(true);
  }
  });
});

describe('dynamic size tắt: đồng bộ thông minh theo mặt đứng yên', () => {
  const b = (o: Partial<Cuboid> = {}): Cuboid => ({ x: 0, y: 0, z: 0.75, rx: 0, ry: 0, yaw: 0, sx: 4, sy: 2, sz: 1.5, ...o });
  it("kéo cạnh trên xuống: nhận ra đáy đứng yên · mọi keyframe: đáy giữ nguyên, nóc hạ xuống (không căn theo tâm)", () => {
    {
    expect(detectAnchors(b(), b({ sz: 1.0, z: 0.5 })).z).toBe('neg');
    expect(detectAnchors(b(), b({ sz: 1.0, z: 1.0 })).z).toBe('pos'); // kéo cạnh dưới lên: nóc đứng yên
    expect(detectAnchors(b(), b({ sz: 1.0, z: 0.75 })).z).toBe('center');
    expect(detectAnchors(b(), b({ sz: 1.0, z: 3 })).z).toBe('center'); // vừa dời vừa đổi cỡ: không suy ra được
    expect(detectAnchors(b(), b()).z).toBeNull();
  }
    {
    const t = tr([[0, b()], [5, b({ x: 5, z: 0.8 })], [9, b({ x: 9, z: 0.7 })]]);
    const r = propagateEdit(t, b(), b({ sz: 1.0, z: 0.5 }));
    const s5 = parseCuboid(r.track.shapes.find((s) => s.frame === 5)!.points);
    expect(s5.sz).toBeCloseTo(1.0); expect(s5.z - s5.sz / 2).toBeCloseTo(0.05); // đáy cũ 0,8 − 0,75 = 0,05
    const s9 = parseCuboid(r.track.shapes.find((s) => s.frame === 9)!.points);
    expect(s9.z - s9.sz / 2).toBeCloseTo(-0.05);
    expect(s5.x).toBe(5); // không đụng vị trí ngang
  }
  });
  it("trục dọc xe theo hướng riêng của từng keyframe (yaw 90°) · đổi đối xứng quanh tâm: giữ nguyên tâm của các keyframe khác (như propagateSize)", () => {
    {
    const t = tr([[0, b()], [5, b({ yaw: Math.PI / 2, x: 10 })]]);
    // kéo mũi xe lùi 0,5 m ở frame 0: đuôi (âm) đứng yên ⇒ tâm dời -0,25 theo trục dọc
    const r = propagateEdit(t, b(), b({ sx: 3.5, x: -0.25 }));
    const s5 = parseCuboid(r.track.shapes.find((s) => s.frame === 5)!.points);
    expect(s5.sx).toBeCloseTo(3.5);
    expect(s5.x).toBeCloseTo(10, 6);
    expect(s5.y).toBeCloseTo(-0.25, 6); // trục dọc của box yaw 90° nằm theo +y, dời -0,25 theo nó
  }
    {
    const t = tr([[0, b()], [5, b({ x: 5, z: 0.8 })]]);
    const r = propagateEdit(t, b(), b({ sz: 1.0 }));
    const s5 = parseCuboid(r.track.shapes.find((s) => s.frame === 5)!.points);
    expect(s5.z).toBeCloseTo(0.8); expect(s5.sz).toBeCloseTo(1.0);
  }
  });
  it('không đụng keyframe outside và keyframe đã cùng kích thước', () => {
    const t = tr([[0, b({ sz: 1.0, z: 0.5 })], [3, b({ x: 3 }), true], [5, b({ sz: 1.0, z: 0.5, x: 5 })]]); // frame 0 là frame vừa sửa
    const r = propagateEdit(t, b(), b({ sz: 1.0, z: 0.5 }));
    expect(r.frames).toEqual([]);
  });
});
