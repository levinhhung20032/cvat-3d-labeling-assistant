import { describe, expect, it } from 'vitest';
import { estimateEgo, findDrift } from '../src/shared/drift';
import { serializeCuboid } from '../src/shared/cuboid';
import { shape, track } from './fixtures';
import type { CvatTrack } from '../src/shared/types';

const N = 30;
/** Thế giới: xe ego chạy 1 m/frame và quay 0.01 rad/frame; toạ độ trong frame là theo ego. */
const egoAt = (f: number) => ({ x: f * 1.0, y: f * 0.05, yaw: f * 0.01 });
const toEgo = (P: [number, number], f: number): [number, number] => {
  const e = egoAt(f), dx = P[0] - e.x, dy = P[1] - e.y, c = Math.cos(-e.yaw), s = Math.sin(-e.yaw);
  return [dx * c - dy * s, dx * s + dy * c];
};
const mk = (world: (f: number) => [number, number], frames = Array.from({ length: N }, (_, f) => f)): CvatTrack =>
  track(1, frames.map((f) => {
    const [x, y] = toEgo(world(f), f);
    return { ...shape(f, false), points: serializeCuboid({ x, y, z: 0.8, rx: 0, ry: 0, yaw: 0, sx: 4.4, sy: 1.8, sz: 1.6 }, Array(16).fill(0)) };
  }));
const statics = [[10, 8], [25, -6], [40, 12], [18, -15], [33, 5], [50, -9]] as [number, number][];
const scene = (extra: CvatTrack[]) => [...statics.map((p) => mk(() => p)), ...extra];
const frames = Array.from({ length: N }, (_, f) => f);

describe('chuyển động ego', () => {
  it("khôi phục phép biến đổi cứng từ các vật đứng yên, bỏ qua vật chuyển động · quá ít vật thì không ước lượng", () => {
    {
    const a = [...statics.map((p) => toEgo(p, 4)), toEgo([30, 30], 4)];
    const b = [...statics.map((p) => toEgo(p, 5)), toEgo([34, 35], 5)]; // vật cuối chuyển động
    const t = estimateEgo(a, b)!;
    expect(t).not.toBeNull();
    expect(t.th).toBeCloseTo(-0.01, 4);
    const [x, y] = [a[0]![0] * Math.cos(t.th) - a[0]![1] * Math.sin(t.th) + t.tx, a[0]![0] * Math.sin(t.th) + a[0]![1] * Math.cos(t.th) + t.ty];
    expect(x).toBeCloseTo(b[0]![0], 3); expect(y).toBeCloseTo(b[0]![1], 3);
  }
    {
    expect(estimateEgo([[1, 2], [10, 5]], [[0, 2], [9, 5]])).toBeNull();
  }
  });
});

describe('cảnh báo trôi box', () => {
  it("vật đứng yên đúng chỗ (có xe chạy) không bị báo; vật đang chạy cũng không · vật đứng yên mà box nhích dần thì bị báo ở các frame lệch quá ngưỡng, kèm đúng số thứ tự object", () => {
    {
    const moving = mk((f) => [20 + f * 0.8, -3]);
    expect(findDrift(scene([moving]), frames).size).toBe(0);
  }
    {
    const drifting = mk((f) => [22 + f * 0.05, 4]); // nhích 5 cm/frame ≈ 1,45 m sau 29 frame
    const r = findDrift(scene([drifting]), frames);
    const info = r.get(statics.length + 1)!;
    expect(info).toBeDefined();
    const fs = info.frames.map((x) => x.f);
    expect(fs).toContain(29); // neo = vị trí 5 frame đầu; cuối track đã lệch ~1,35 m
    expect(fs).not.toContain(0); expect(fs).not.toContain(5); // các frame đầu và gần neo không bị báo
    expect(r.size).toBe(1);
  }
  });
  it("vật đứng yên rồi bắt đầu chạy thật (lệch tới departDist) thì không báo trôi · vật chuyển động ngay từ 5 frame đầu không xét", () => {
    {
    const departs = mk((f) => [22 + (f >= 10 ? (f - 10) * 0.5 : 0), 4]); // đứng 10 frame rồi chạy 0,5 m/frame
    expect(findDrift(scene([departs]), frames).size).toBe(0);
  }
    {
    const movingFirst = mk((f) => [22 + f * 0.3, 4]);
    expect(findDrift(scene([movingFirst]), frames).size).toBe(0);
  }
  });
  it("box đứng yên nhưng nhảy một nhịp 0,6 m thì bị báo từ lúc nhảy · object quá ngắn (dưới decideFrames) không xét", () => {
    {
    const jump = mk((f) => [22 + (f >= 20 ? 0.6 : 0), 4]);
    const info = findDrift(scene([jump]), frames).get(statics.length + 1)!;
    expect(info.frames.map((x) => x.f)).toEqual(Array.from({ length: 10 }, (_, i) => 20 + i));
  }
    {
    const short = mk((f) => [22 + f * 0.05, 4], [0, 1, 2, 3]);
    expect(findDrift(scene([short]), frames).size).toBe(0);
  }
  });
});
