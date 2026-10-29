import { describe, expect, it } from 'vitest';
import { dropSupported, findDrift, type DriftFrame } from '../src/shared/drift';
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
/** Track có toạ độ ego cho trước theo frame (null: vắng mặt, không có shape). */
const egoTrack = (coord: (f: number) => [number, number] | null, frames = Array.from({ length: N }, (_, f) => f)): CvatTrack =>
  track(1, frames.flatMap((f) => {
    const p = coord(f);
    return p ? [{ ...shape(f, false), points: serializeCuboid({ x: p[0], y: p[1], z: 0.8, rx: 0, ry: 0, yaw: 0, sx: 4.4, sy: 1.8, sz: 1.6 }, Array(16).fill(0)) }] : [];
  }));
/** Vật đứng yên (hoặc chạy) theo thế giới, box bám đúng: toạ độ ego đổi theo xe. */
const mk = (world: (f: number) => [number, number]) => egoTrack((f) => toEgo(world(f), f));
const statics = [[10, 8], [25, -6], [40, 12], [18, -15], [33, 5], [50, -9]] as [number, number][];
const scene = (extra: CvatTrack[]) => [...statics.map((p) => mk(() => p)), ...extra];
const frames = Array.from({ length: N }, (_, f) => f);
const NUM = statics.length + 1; // số thứ tự của object thêm vào cảnh

describe('cảnh báo trôi box (toạ độ ego không đổi trong khi xe chạy)', () => {
  it('box bám đúng vật (đứng yên hoặc đang chạy theo thế giới) thì không bị báo', () => {
    expect(findDrift(scene([mk(() => [22, 4])]), frames).size).toBe(0);
    expect(findDrift(scene([mk((f) => [20 + f * 0.8, -3])]), frames).size).toBe(0);
  });

  it('box giữ nguyên toạ độ ego từ frame 10 trong khi xe chạy: báo từ frame 11 (frame 10 là điểm neo), kèm quãng xe đã đi', () => {
    const [x0, y0] = toEgo([22, 4], 10);
    const held = egoTrack((f) => (f < 10 ? toEgo([22, 4], f) : [x0, y0]));
    const r = findDrift(scene([held]), frames);
    const info = r.get(NUM)!;
    expect(info.frames.map((x) => x.f)).toEqual(Array.from({ length: 19 }, (_, i) => 11 + i));
    expect(info.frames[0]!.dist).toBeGreaterThan(0.5);
    expect(info.frames[18]!.dist).toBeGreaterThan(15);
    expect(info.frames[18]!.dist).toBeLessThan(25);
    expect(r.size).toBe(1); // các vật bám đúng không bị báo
  });

  it('chỉ một bước đứng yên (2 frame trùng toạ độ) chưa đủ minHold nên không báo; hai bước liền thì báo', () => {
    const one = egoTrack((f) => (f === 11 ? toEgo([22, 4], 10) : toEgo([22, 4], f)));
    expect(findDrift(scene([one]), frames).size).toBe(0);
    const two = egoTrack((f) => (f === 11 || f === 12 ? toEgo([22, 4], 10) : toEgo([22, 4], f)));
    expect(findDrift(scene([two]), frames).get(NUM)!.frames.map((x) => x.f)).toEqual([11, 12]);
  });

  it('xe đứng yên (mọi toạ độ ego không đổi) thì box giữ nguyên toạ độ là đúng, không báo', () => {
    const still = [...statics.map((p) => egoTrack(() => p)), egoTrack(() => [22, 4])];
    expect(findDrift(still, frames).size).toBe(0);
  });

  it('khoảng vắng mặt cắt chuỗi: mỗi đoạn tính riêng, frame vắng không bị báo', () => {
    const [x0, y0] = toEgo([22, 4], 10), [x1, y1] = toEgo([22, 4], 16);
    const gap = egoTrack((f) => (f === 15 ? null : f < 10 ? toEgo([22, 4], f) : f < 16 ? [x0, y0] : [x1, y1]));
    const fs = findDrift(scene([gap]), frames).get(NUM)!.frames.map((x) => x.f);
    expect(fs).toEqual([11, 12, 13, 14, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29]);
  });

  it('quá ít object nhích để tin xe đang chạy (dưới minMovers) thì không báo; danh sách frame không liền nhau không nối chuỗi', () => {
    const [x0, y0] = toEgo([22, 4], 10);
    const held = egoTrack((f) => (f < 10 ? toEgo([22, 4], f) : [x0, y0]));
    expect(findDrift([...statics.slice(0, 2).map((p) => mk(() => p)), held], frames).size).toBe(0);
    expect(findDrift(scene([held]), frames.filter((f) => f % 2 === 0)).size).toBe(0);
  });
});

describe('trùng khớp hoàn toàn mới là trôi', () => {
  it('toạ độ x, y giống nhau nhưng z hoặc yaw đổi thì không phải box bị giữ: không báo', () => {
    const base = (f: number) => (f < 10 ? toEgo([22, 4], f) : toEgo([22, 4], 10));
    const mkc = (z: (f: number) => number, yaw: (f: number) => number) => track(1, frames.map((f) => {
      const [x, y] = base(f);
      return { ...shape(f, false), points: serializeCuboid({ x, y, z: z(f), rx: 0, ry: 0, yaw: yaw(f), sx: 4.4, sy: 1.8, sz: 1.6 }, Array(16).fill(0)) };
    }));
    expect(findDrift(scene([mkc((f) => 0.8 + f * 0.02, () => 0)]), frames).size).toBe(0);
    expect(findDrift(scene([mkc(() => 0.8, (f) => f * 0.05)]), frames).size).toBe(0);
    expect(findDrift(scene([mkc(() => 0.8, () => 0)]), frames).size).toBe(1); // giữ nguyên hoàn toàn thì báo
  });
});

describe('bỏ cảnh báo khi box vẫn bám vật (vật chạy cùng vận tốc với xe)', () => {
  const run = (from: number, n: number): DriftFrame[] => Array.from({ length: n }, (_, i) => ({ f: from + 1 + i, dist: i + 1, from }));
  const counts = (m: Record<number, number>) => (f: number) => m[f];
  it('các frame đầu còn đủ điểm thì bỏ; từ frame đầu tiên thiếu điểm trở đi vẫn báo (kể cả khi sau đó có điểm lại do vật khác lọt vào box)', () => {
    const r = dropSupported(run(50, 4), counts({ 50: 16, 51: 21, 52: 21, 53: 7, 54: 40 }));
    expect(r.map((x) => x.f)).toEqual([53, 54]);
  });
  it('frame neo ít điểm (vật xa / thưa) hoặc chưa tính điểm thì không đủ cơ sở: giữ nguyên', () => {
    expect(dropSupported(run(50, 3), counts({ 50: 3, 51: 20, 52: 20, 53: 20 })).length).toBe(3);
    expect(dropSupported(run(50, 3), counts({})).length).toBe(3);
    expect(dropSupported(run(50, 3), counts({ 50: 16, 52: 20, 53: 20 })).length).toBe(3); // frame đầu chưa có số điểm
  });
  it('mỗi chuỗi tính riêng theo frame neo của nó; số điểm phải đạt cả mức tối thiểu lẫn một nửa số điểm ở neo', () => {
    const f = [...run(10, 2), ...run(30, 2)];
    const r = dropSupported(f, counts({ 10: 100, 11: 30, 12: 60, 30: 8, 31: 7, 32: 7 }));
    expect(r.map((x) => x.f)).toEqual([11, 12]); // chuỗi 1: frame 11 có 30 < 50% của 100 nên giữ cả chuỗi; chuỗi 2: neo 8 điểm, cần ≥ 6, cả hai frame có 7 nên bỏ hết
  });
});
