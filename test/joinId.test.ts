import { describe, expect, it } from 'vitest';
import { joinTracks } from '../src/shared/joinId';
import { stateAt } from '../src/shared/interp';
import type { CvatTrack } from '../src/shared/types';

const shape = (frame: number, x: number, outside = false) => ({ type: 'cuboid', frame, outside, points: [x, 0, 0, 0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0, 0] });
const mk = (frame: number, shapes: ReturnType<typeof shape>[]): CvatTrack => ({ label_id: 1, frame, shapes });

describe('joinTracks', () => {
  it('chép box của B vào A, outside toàn bộ B', () => {
    const A = mk(0, [shape(0, 0), shape(10, 10), shape(11, 10, true)]);
    const B = mk(10, [shape(10, 11), shape(15, 16)]);
    const r = joinTracks(A, B, 20)!;
    expect(r.from).toBe(10);
    expect(r.a.shapes.map((s) => [s.frame, s.outside])).toEqual([[0, false], [10, false], [15, false]]);
    expect(r.a.shapes[1]!.points[0]).toBe(11);
    expect(stateAt(r.a, 20).cuboid).not.toBeNull();
    for (let f = 10; f <= 20; f++) expect(stateAt(r.b, f).cuboid).toBeNull();
    expect(stateAt(r.a, 12).cuboid).not.toBeNull();
  });
  it('B không có box → null', () => {
    expect(joinTracks(mk(0, [shape(0, 0)]), mk(0, [shape(0, 0, true)]), 5)).toBeNull();
  });
});
