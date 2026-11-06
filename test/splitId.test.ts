import { describe, expect, it } from 'vitest';
import { findLateStart, findLongOutsideGaps, outsideBeforeAppear, splitTrack } from '../src/shared/splitId';
import { stateAt } from '../src/shared/interp';
import { missingOutsideKeyframes } from '../src/shared/rules';
import { serializeCuboid } from '../src/shared/cuboid';
import { shape, track } from './fixtures';

const box = (f: number, outside = false) => ({
  ...shape(f, outside),
  points: serializeCuboid({ x: f, y: 0, z: 0.8, rx: 0, ry: 0, yaw: 0, sx: 4.4, sy: 1.8, sz: 1.6 }, Array(16).fill(0)),
});
const STOP = 14;

describe('tách ID khi outside dài', () => {
  // có box 0–3, outside 4–9 (6 frame), có box lại từ 10 (keyframe 10 và 12)
  const t = () => track(5, [box(0), box(3), box(4, true), box(10), box(12)]);

  it("tìm đoạn outside ≥ 6 frame nằm giữa hai đoạn có box · đoạn 5 frame, đoạn ở đầu và đoạn kéo tới cuối job không tính", () => {
    expect(findLongOutsideGaps(t(), 0, STOP)).toEqual([{ from: 4, to: 9, resume: 10, len: 6 }]);
    expect(findLongOutsideGaps(track(5, [box(0), box(3, true), box(8)]), 0, STOP)).toEqual([]); // 3..7 = 5 frame
    expect(findLongOutsideGaps(track(5, [box(0), box(3), box(4, true)]), 0, STOP)).toEqual([]); // outside tới cuối: không có phần sau
    expect(findLongOutsideGaps(track(5, [box(0, true), box(8)]), 0, STOP)).toEqual([]); // outside từ đầu track
  });

  it("tách: ID cũ giữ phần trước rồi outside có keyframe tới cuối job · object mới (chưa có id) giữ phần sau, không dính id của shape", () => {
    const r = splitTrack(t(), 10, STOP)!;
    expect(r).not.toBeNull();
    expect(r.oldTrack.id).toBe(5);
    expect(r.newTrack.id).toBeUndefined();
    expect(r.newTrack.frame).toBe(10);
    expect(r.newTrack.shapes.map((s) => s.frame)).toEqual([10, 12]);
    expect(r.newTrack.shapes.every((s) => s.id === undefined)).toBe(true);
    // track cũ: có box tới frame 3, outside từ 4 tới hết job, mọi frame outside đều có keyframe (luật 2)
    for (let f = 0; f <= 3; f++) expect(stateAt(r.oldTrack, f).cuboid).not.toBeNull();
    for (let f = 4; f <= STOP; f++) expect(stateAt(r.oldTrack, f).cuboid).toBeNull();
    expect(r.oldTrack.shapes.filter((s) => s.frame >= 10).every((s) => s.outside)).toBe(true);
    expect(r.oldTrack.shapes.filter((s) => s.frame >= 10).length).toBe(STOP - 10 + 1);
    expect(missingOutsideKeyframes(r.oldTrack, STOP).filter((f) => f >= 10)).toEqual([]);
    expect(r.frames).toEqual([10, 11, 12, 13, 14]);
    // phần sau giữ nguyên vị trí ở track mới
    expect(stateAt(r.newTrack, 10).cuboid!.x).toBeCloseTo(10, 6);
    expect(stateAt(r.newTrack, 12).cuboid!.x).toBeCloseTo(12, 6);
  });

  it("không tách được khi frame không phải keyframe có box ngay sau đoạn outside · không sửa track gốc", () => {
    const orig = t();
    const snapshot = structuredClone(orig);
    expect(splitTrack(orig, 11, STOP)).toBeNull(); // 11 không phải keyframe
    expect(splitTrack(orig, 4, STOP)).toBeNull(); // 4 là keyframe outside
    expect(splitTrack(orig, 0, STOP)).toBeNull(); // không có phần trước
    splitTrack(orig, 10, STOP);
    expect(orig).toEqual(snapshot);
  });
});

describe('ID xuất hiện giữa chừng', () => {
  it('giữ ID · chỉ thêm keyframe outside trước frame xuất hiện', () => {
    const t = track(5, [box(3), box(6), box(8, true)]);
    const r = outsideBeforeAppear(t, 0, STOP)!;
    expect(r.track.id).toBe(5);
    expect(r.frames).toEqual([0, 1, 2]);
    expect(r.track.shapes.map((s) => [s.frame, s.outside])).toEqual([[0, true], [1, true], [2, true], [3, false], [6, false], [8, true]]);
    expect(stateAt(r.track, 6).cuboid?.x).toBe(6);
    expect(findLateStart(t, 0, STOP)).toEqual({ first: 3 });
    expect(outsideBeforeAppear(track(5, [box(0), box(4)]), 0, STOP)).toBeNull();
    // đã có keyframe outside từ frame đầu job (dạng sau khi chuyển ID) → không báo xuất hiện muộn
    expect(findLateStart(track(5, [box(0, true), box(1, true), box(2, true), box(3)]), 0, STOP)).toBeNull();
    expect(outsideBeforeAppear(track(5, [box(0, true), box(3)]), 0, STOP)).toBeNull();
  });
});

describe('xoay tất cả keyframe', () => {
  it('cộng cùng độ xoay yaw cho mọi keyframe có box · outside không đổi · giữ ID', async () => {
    const { rotateAllKeyframes } = await import('../src/shared/edit');
    const { parseCuboid } = await import('../src/shared/cuboid');
    const t = track(7, [box(0), box(3), box(5, true)]);
    const r = rotateAllKeyframes(t, 0.5);
    expect(r.track.id).toBe(7);
    expect(r.frames).toEqual([0, 3]);
    expect(parseCuboid(r.track.shapes[0]!.points).yaw).toBeCloseTo(0.5);
    expect(parseCuboid(r.track.shapes[1]!.points).yaw).toBeCloseTo(0.5);
    expect(r.track.shapes[2]!.outside).toBe(true);
    const later = rotateAllKeyframes(t, 0.5, 0, 0, 3); // chỉ từ frame 3 trở đi
    expect(later.frames).toEqual([3]);
    expect(parseCuboid(later.track.shapes[0]!.points).yaw).toBeCloseTo(0);
  });
});
