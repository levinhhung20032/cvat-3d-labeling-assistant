import { describe, expect, it } from 'vitest';
import { findOverlaps, groupPairs, intersectionArea, footprint, overlapIou, allowedIou } from '../src/shared/overlap';
import { propagateSize, sameSize } from '../src/shared/dynsize';
import { serializeCuboid, type Cuboid } from '../src/shared/cuboid';
import { shape, track } from './fixtures';
import type { CvatTrack } from '../src/shared/types';

const cub = (x: number, y: number, o: Partial<Cuboid> = {}): Cuboid => ({ x, y, z: 0, rx: 0, ry: 0, yaw: 0, sx: 4, sy: 2, sz: 1.5, ...o });
const tr = (frames: [number, Cuboid, boolean?][]): CvatTrack =>
  track(1, frames.map(([f, c, out]) => ({ ...shape(f, !!out), points: serializeCuboid(c, Array(16).fill(0)) })));

describe('chồng lấn', () => {
  it('diện tích giao hình chữ nhật', () => {
    expect(intersectionArea(footprint(cub(0, 0)), footprint(cub(2, 0)))).toBeCloseTo(4); // chung nửa chiều dài: 2 × 2
    expect(intersectionArea(footprint(cub(0, 0)), footprint(cub(10, 0)))).toBe(0);
  });
  it('xoay 90° vẫn đúng', () => {
    expect(intersectionArea(footprint(cub(0, 0)), footprint(cub(0, 0, { yaw: Math.PI / 2 })))).toBeCloseTo(4); // 2×2 ở giữa
  });
  it('IoU và diện tích giao, cần chồng chiều cao', () => {
    const r = overlapIou(cub(0, 0), cub(0, 0, { sx: 1, sy: 1 }));
    expect(r.iou).toBeCloseTo(1 / 8); expect(r.inter).toBeCloseTo(1);
    expect(overlapIou(cub(0, 0), cub(0, 0, { z: 5 })).iou).toBe(0);
  });
  it('tìm cặp giữa các ID khác nhau, bỏ qua frame outside và box chỉ chạm nhau', () => {
    const a = tr([[0, cub(0, 0)], [1, cub(0, 0)]]);
    const b = tr([[0, cub(1, 0, { sx: 2 })], [1, cub(1, 0, { sx: 2 }), true]]);
    const c = tr([[0, cub(4, 0)], [1, cub(4, 0)]]); // chỉ chạm cạnh a (giao diện tích 0)
    const items = findOverlaps([a, b, c], [0, 1], ['vehicles', 'vehicles', 'vehicles']);
    expect(items.map((i) => [i.a, i.b, i.frame])).toEqual([[1, 2, 0]]);
    expect(groupPairs(items)).toEqual([{ a: 1, b: 2, frames: [0], max: items[0]!.ratio }]);
  });
  it('ngưỡng theo nhóm: xe không cho chồng, người / xe máy cho tới IoU 0.5', () => {
    expect(allowedIou('vehicles')).toBe(0); expect(allowedIou('Two-wheels')).toBe(0.5); expect(allowedIou('pedestrian')).toBe(0.5);
    const a = tr([[0, cub(0, 0)]]);
    const b = tr([[0, cub(3.5, 0)]]); // giao 1 m² → IoU 1/15
    expect(findOverlaps([a, b], [0], ['vehicles', 'vehicles']).length).toBe(1);
    expect(findOverlaps([a, b], [0], ['pedestrian', 'pedestrian'])).toEqual([]);
    expect(findOverlaps([a, b], [0], ['pedestrian', 'vehicles']).length).toBe(1); // khác nhóm: lấy mức chặt hơn
  });
  it('phần giao dưới 0.001 m² thì bỏ qua', () => {
    const a = tr([[0, cub(0, 0)]]);
    const b = tr([[0, cub(3.9995, 0)]]); // giao 0.0005 × 2 = 0.001 → vừa đủ không tính khi nhỏ hơn
    expect(findOverlaps([a, b], [0], ['vehicles', 'vehicles'], { ...{ allowed: { vehicle: 0 }, defaultAllowed: 0, minZ: 0.01 }, minArea: 0.002 })).toEqual([]);
  });
});

describe('dynamic size tắt', () => {
  it('áp kích thước mới cho mọi keyframe có box, giữ nguyên vị trí và keyframe outside', () => {
    const t = tr([[0, cub(0, 0)], [3, cub(1, 1), true], [5, cub(2, 2)]]);
    const r = propagateSize(t, { sx: 5, sy: 2.2, sz: 1.8 });
    expect(r.frames).toEqual([0, 5]);
    expect(r.track.shapes.find((s) => s.frame === 5)!.points.slice(0, 9)).toEqual([2, 2, 0, 0, 0, 0, 5, 2.2, 1.8]);
    expect(r.track.shapes.find((s) => s.frame === 3)!.points[6]).toBe(4);
    expect(r.track.id).toBe(t.id);
  });
  it('không đổi gì khi cùng kích thước', () => {
    const t = tr([[0, cub(0, 0)]]);
    expect(propagateSize(t, { sx: 4, sy: 2, sz: 1.5 }).track).toBe(t);
    expect(sameSize({ sx: 1, sy: 2, sz: 3 }, { sx: 1, sy: 2, sz: 3 })).toBe(true);
  });
});
