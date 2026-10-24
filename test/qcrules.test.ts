import { describe, expect, it } from 'vitest';
import { classKey, trackIssues } from '../src/shared/qcrules';
import { serializeCuboid, type Cuboid } from '../src/shared/cuboid';
import { shape, track } from './fixtures';

const cub = (o: Partial<Cuboid> = {}): Cuboid => ({ x: 10, y: 0, z: 0, rx: 0, ry: 0, yaw: 0, sx: 4.5, sy: 1.9, sz: 1.6, ...o });
const tr = (frames: Cuboid[]) => track(1, frames.map((c, f) => ({ ...shape(f, false), points: serializeCuboid(c, Array(16).fill(0)) })));
const kinds = (m: Map<number, { kind: string }[]>, f: number) => (m.get(f) ?? []).map((i) => i.kind);

describe('luật QC (S K Z H D)', () => {
  it('nhận nhóm nhãn', () => {
    expect(classKey('vehicles')).toBe('vehicle'); expect(classKey('Two-wheels')).toBe('two_wheel'); expect(classKey('pedestrian')).toBe('pedestrian');
    expect(classKey('animal')).toBeNull();
  });
  it('K: kích thước ngoài ngưỡng, kèm gợi ý bus/truck khi xe quá dài', () => {
    const m = trackIssues(tr([cub(), cub({ sx: 6.5 })]), 'vehicles', [0, 1]);
    expect(kinds(m, 0)).toEqual([]);
    expect(kinds(m, 1)).toContain('K');
    expect(m.get(1)![0]!.message).toContain('bus/truck');
  });
  it('S: xe có kích thước lệch so với kích thước hay gặp nhất; người thì không xét', () => {
    const t = tr([cub(), cub(), cub({ sx: 4.6 })]);
    expect(kinds(trackIssues(t, 'vehicles', [0, 1, 2]), 2)).toEqual(['S']);
    expect(kinds(trackIssues(tr([cub({ sx: 0.8, sy: 0.8, sz: 1.7 }), cub({ sx: 0.9, sy: 0.8, sz: 1.7 })]), 'pedestrian', [0, 1]), 1)).toEqual([]);
  });
  it('Z và D: z ngoài [-3, 3], quá xa > 100 m', () => {
    const m = trackIssues(tr([cub({ z: 3.5 }), cub({ x: 101 })]), 'vehicles', [0, 1]);
    expect(kinds(m, 0)).toEqual(['Z']);
    expect(kinds(m, 1)).toEqual(['D']);
    expect(kinds(trackIssues(tr([cub({ x: 99 })]), 'animal', [0]), 0)).toEqual([]);
  });
  it('H: đổi hướng quá 75° giữa hai frame liền nhau, tính cả khi vượt mốc ±180°', () => {
    const d = (deg: number) => (deg * Math.PI) / 180;
    expect(kinds(trackIssues(tr([cub({ yaw: 0 }), cub({ yaw: d(80) })]), 'vehicles', [0, 1]), 1)).toEqual(['H']);
    expect(kinds(trackIssues(tr([cub({ yaw: 0 }), cub({ yaw: d(70) })]), 'vehicles', [0, 1]), 1)).toEqual([]);
    expect(kinds(trackIssues(tr([cub({ yaw: d(170) }), cub({ yaw: d(-170) })]), 'vehicles', [0, 1]), 1)).toEqual([]); // chỉ lệch 20°
  });
});
