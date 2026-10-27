import { describe, expect, it } from 'vitest';
import { motionJump } from '../src/shared/motion';
import { buildRows } from '../src/shared/table';
import { ann, shape, track } from './fixtures';
import type { CvatShape } from '../src/shared/types';

const at = (frame: number, x: number, y = 0, outside = false): CvatShape => {
  const s = shape(frame, outside);
  s.points[0] = x; s.points[1] = y; s.points[6] = 4; s.points[7] = 2; s.points[8] = 1.5;
  return s;
};
/** track có keyframe ở mọi frame với vị trí x theo hàm */
const line = (n: number, f: (i: number) => number) => track(1, Array.from({ length: n }, (_, i) => at(i, f(i))));

describe('motionJump', () => {
  it("chuyển động đều: không cảnh báo · đứng yên nhưng ego chạy nhanh (trôi 2 m/frame): không cảnh báo", () => {
    {
    const t = line(12, (i) => 10 + i * 0.5);
    for (let f = 0; f < 12; f++) expect(motionJump(t, f, 'vehicles')).toBeNull();
  }
    {
    const t = line(12, (i) => 40 - i * 2);
    for (let f = 0; f < 12; f++) expect(motionJump(t, f, 'vehicles')).toBeNull();
  }
  });
  it("bỗng nhảy xa 4 m so với dự đoán: cảnh báo ở đúng frame đó · nhảy rồi tiếp tục đều: các frame sau chỉ lệch trong vài frame đầu rồi hết cảnh báo", () => {
    {
    const t = line(12, (i) => (i < 6 ? 10 + i * 0.5 : 10 + i * 0.5 + 4));
    expect(motionJump(t, 5, 'vehicles')).toBeNull();
    const w = motionJump(t, 6, 'vehicles')!;
    expect(w).not.toBeNull();
    expect(w.residual).toBeCloseTo(4, 1);
    expect(w.message).toMatch(/đi xa bất thường/);
    expect(w.pred.x).toBeCloseTo(13, 1);
  }
    {
    const t = line(14, (i) => (i < 6 ? 10 + i * 0.5 : 10 + i * 0.5 + 4));
    expect(motionJump(t, 6, 'vehicles')).not.toBeNull();
    expect(motionJump(t, 12, 'vehicles')).toBeNull();
  }
  });
  it("ngưỡng theo nhãn: 0,8 m là bình thường với xe nhưng quá xa với người đi bộ · lệch ngang cũng tính", () => {
    {
    const t = line(10, (i) => (i < 5 ? 10 : 10.9));
    expect(motionJump(t, 5, 'vehicles')).toBeNull();
    expect(motionJump(t, 5, 'pedestrian')).not.toBeNull();
  }
    {
    const s = Array.from({ length: 10 }, (_, i) => at(i, 10 + i * 0.5, i < 5 ? 0 : 3));
    expect(motionJump(track(1, s), 5, 'vehicles')!.residual).toBeGreaterThan(2.5);
  }
  });
  it("ít lịch sử (đầu track) hoặc frame không có box: bỏ qua · sau đoạn outside ngắn: ngưỡng nới theo số frame vắng mặt", () => {
    {
    const t = line(8, (i) => i * 10);
    expect(motionJump(t, 0, 'vehicles')).toBeNull();
    expect(motionJump(t, 1, 'vehicles')).toBeNull();
    const out = track(1, [at(0, 0), at(1, 1), at(2, 2, 0, true)]);
    expect(motionJump(out, 3, 'vehicles')).toBeNull();
  }
    {
    const t = track(1, [at(0, 0), at(1, 1), at(2, 2), at(3, 0, 0, true), at(4, 0, 0, true), at(5, 5.5)]);
    expect(motionJump(t, 5, 'vehicles')).toBeNull(); // dự đoán 3 frame * 1 m = 5 → lệch 0,5
  }
  });
  it('frame nội suy giữa hai keyframe bị lệch xa cũng bị bắt ở chỗ đổi bước', () => {
    const t = track(1, [at(0, 0), at(1, 1), at(2, 2), at(3, 3), at(9, 40)]); // keyframe sai ở frame 9
    expect(motionJump(t, 4, 'vehicles')).not.toBeNull(); // bước nội suy 6,2 m/frame so với 1 m/frame trước đó
  });
});

describe('cột cảnh báo nhảy trong bảng object', () => {
  it('đếm số frame bị cảnh báo, bỏ qua frame đã ignore', () => {
    const t = line(12, (i) => (i < 6 ? 10 + i * 0.5 : 10 + i * 0.5 + 4));
    const a = ann(t);
    const labels = [{ id: 1, name: 'vehicles' }];
    expect(buildRows(a, labels, 0, 11)[0]!.jumps).toBeGreaterThanOrEqual(1);
    const all = buildRows(a, labels, 0, 11)[0]!.jumps;
    const ignored = buildRows(a, labels, 0, 11, (num, f) => f === 6)[0]!.jumps;
    expect(ignored).toBe(all - 1);
  });
});

describe('không báo trường hợp đứng yên / chậm lại', () => {
  it("vật đang chạy 1 m/frame rồi box đứng yên: không phải \"đi xa\" · chậm lại bất ngờ (bước 0,6 so với 1,0): không báo", () => {
    {
    const t = line(10, (i) => (i < 5 ? 10 + i : 14));
    expect(motionJump(t, 5, 'vehicles')).toBeNull();
    expect(motionJump(t, 6, 'vehicles')).toBeNull();
  }
    {
    const t = line(10, (i) => (i < 5 ? 10 + i : 14 + (i - 4) * 0.6));
    expect(motionJump(t, 5, 'vehicles')).toBeNull();
  }
  });
});
