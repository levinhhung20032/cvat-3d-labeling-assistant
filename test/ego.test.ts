import { beforeEach, describe, expect, it } from 'vitest';
import { estimateEgo, setEgo, toFrame } from '../src/shared/ego';
import { motionJump } from '../src/shared/motion';
import { stateAt } from '../src/shared/interp';
import { shape, track } from './fixtures';
import type { CvatTrack } from '../src/shared/types';

// Xe chạy với tốc độ và góc xoay thay đổi; vật đứng yên ở nhiều vị trí (tọa độ thế giới cố định).
const worldPts = [[30, 5], [45, -8], [60, 12], [20, -15], [70, 0], [35, 20], [55, -20], [25, 3]];
const egoPose = [{ x: 0, y: 0, a: 0 }, { x: 9, y: 0, a: 0 }, { x: 18, y: 0, a: 0 }, { x: 24, y: 0.5, a: 0.15 }, { x: 29, y: 1.5, a: 0.3 }];
const toEgo = (w: number[], p: { x: number; y: number; a: number }) => {
  const dx = w[0]! - p.x, dy = w[1]! - p.y, c = Math.cos(-p.a), s = Math.sin(-p.a);
  return [c * dx - s * dy, s * dx + c * dy];
};
const at = (f: number, x: number, y: number) => {
  const s = shape(f);
  s.points[0] = x; s.points[1] = y; s.points[2] = 0.8; s.points[6] = 4; s.points[7] = 1.8; s.points[8] = 1.6;
  return s;
};
const staticTrack = (w: number[]): CvatTrack => track(1, egoPose.map((p, f) => { const [x, y] = toEgo(w, p); return at(f, x!, y!); }));

describe('chuyển động của xe (ego)', () => {
  beforeEach(() => setEgo(null));
  it('ước lượng được xoay và tịnh tiến từ các vật đứng yên', () => {
    const ego = estimateEgo(worldPts.map(staticTrack), 0, 4);
    expect(ego.steps.size).toBe(4);
    // điểm thế giới → ego frame 0 → bước ego tới frame 4 phải khớp ego frame 4
    const w = worldPts[2]!;
    const p0 = toEgo(w, egoPose[0]!), p4 = toEgo(w, egoPose[4]!);
    const q = toFrame(ego, p0[0]!, p0[1]!, 0, 4)!;
    expect(Math.hypot(q.x - p4[0]!, q.y - p4[1]!)).toBeLessThan(0.05);
  });
  it('vật đứng yên không bị báo đi xa khi xe tăng tốc / xoay (cách cũ trong hệ ego thì báo)', () => {
    const tracks = worldPts.map(staticTrack);
    const t = tracks[2]!;
    const flags = () => tracks.flatMap((x) => [2, 3, 4].map((f) => motionJump(x, f, 'vehicle'))).filter((m) => m !== null).length;
    expect(flags()).toBeGreaterThan(0); // hệ ego thuần: xe xoay + đổi tốc độ làm vật đứng yên bị báo
    setEgo(estimateEgo(tracks, 0, 4));
    expect(flags()).toBe(0);
    expect([3, 4].map((f) => motionJump(t, f, 'vehicle'))).toEqual([null, null]);
  });
  it('vật nhảy thật so với mặt đất vẫn bị báo khi có ego', () => {
    const tracks = worldPts.map(staticTrack);
    const jumpy = track(2, egoPose.map((p, f) => { const [x, y] = toEgo([40 + (f === 4 ? 12 : 0), 3], p); return at(f, x!, y!); }));
    setEgo(estimateEgo([...tracks, jumpy], 0, 4));
    expect(motionJump(jumpy, 4, 'vehicle')).not.toBeNull();
  });
  it('thiếu dữ liệu ego thì dùng cách cũ, không ném lỗi', () => {
    const ego = estimateEgo([staticTrack(worldPts[0]!)], 0, 4); // 1 object: không đủ điểm ước lượng
    expect(ego.steps.size).toBe(0);
    setEgo(ego);
    expect(() => motionJump(staticTrack(worldPts[0]!), 3, 'vehicle')).not.toThrow();
  });
  it('nội suy theo mặt đất: vật đứng yên giữa hai keyframe xa nhau khớp vị trí thật, tuyến tính trong hệ ego thì lệch', () => {
    const tracks = worldPts.map(staticTrack);
    const w = worldPts[2]!;
    const sparse = track(9, [0, 4].map((f) => { const [x, y] = toEgo(w, egoPose[f]!); return at(f, x!, y!); }));
    const truth = toEgo(w, egoPose[2]!);
    const err = () => { const c = stateAt(sparse, 2).cuboid!; return Math.hypot(c.x - truth[0]!, c.y - truth[1]!); };
    const linear = err();
    expect(linear).toBeGreaterThan(1);
    setEgo(estimateEgo(tracks, 0, 4));
    expect(err()).toBeLessThan(0.1);
    expect(stateAt(sparse, 0).status).toBe('key'); // keyframe giữ nguyên
    setEgo(null);
    expect(err()).toBeCloseTo(linear, 9); // không có ego: đúng cách cũ
  });
  it('thiếu một bước ego giữa hai keyframe thì nội suy tuyến tính như cũ', () => {
    setEgo({ start: 0, steps: new Map() });
    const sparse = track(9, [0, 4].map((f) => at(f, f * 10, 0)));
    expect(stateAt(sparse, 2).cuboid!.x).toBeCloseTo(20, 9);
  });
});
