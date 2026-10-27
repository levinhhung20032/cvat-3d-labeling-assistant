import { describe, expect, it } from 'vitest';
import { rankCameras, angDiff } from '../src/shared/cameras';
import { referenceCuboid, stateAt } from '../src/shared/interp';
import { buildRows, windowCount, windowFrames } from '../src/shared/table';
import { ann, shape, track } from './fixtures';
import type { CvatShape } from '../src/shared/types';

const at = (frame: number, x: number, outside = false): CvatShape => {
  const s = shape(frame, outside);
  s.points[0] = x; s.points[6] = 4; s.points[7] = 2; s.points[8] = 1.5;
  return s;
};

describe('stateAt (nội suy kiểu CVAT)', () => {
  const t = track(1, [at(0, 0), at(10, 10), at(12, 0, true), at(15, 3)]);
  it('trước keyframe đầu: none', () => expect(stateAt(t, -1).status).toBe('none'));
  it('đúng keyframe: key', () => expect(stateAt(t, 10)).toMatchObject({ status: 'key' }));
  it("giữa hai keyframe box: nội suy tuyến tính · keyframe kế là outside: giữ nguyên giá trị", () => {
    {
    const s = stateAt(t, 5);
    expect(s.status).toBe('interp');
    expect(s.cuboid!.x).toBeCloseTo(5);
  }
    {
    const s = stateAt(t, 11);
    expect(s.status).toBe('hold');
    expect(s.cuboid!.x).toBe(10);
  }
  });
  it('outside kéo dài tới shape kế tiếp', () => {
    expect(stateAt(t, 12).status).toBe('outside-key');
    expect(stateAt(t, 13).status).toBe('outside');
    expect(stateAt(t, 13).cuboid).toBeNull();
    expect(stateAt(t, 15).status).toBe('key');
  });
  it('sau keyframe cuối: giữ nguyên', () => expect(stateAt(t, 20).status).toBe('hold'));
  it('referenceCuboid lấy box gần nhất khi outside', () => {
    expect(referenceCuboid(t, 13, 20)!.x).toBe(10); // 12,14 đều outside; gần nhất là frame 11 (hold)
    expect(referenceCuboid(t, 13, 20)).not.toBeNull();
  });
});

describe('bảng object & cửa sổ', () => {
  it("đếm gán / outside / thiếu keyframe · cửa sổ trượt bước 5, cắt ở frame cuối", () => {
    {
    const t = track(7, [at(0, 0), at(3, 0, true)]);
    const [r] = buildRows(ann(t), [], 0, 9);
    expect(r).toMatchObject({ id: 7, assigned: 3, outside: 7, missing: 6, first: 0, last: 2 });
  }
    {
    expect(windowFrames(0, 0, 59)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(windowFrames(1, 0, 59)).toEqual([5, 6, 7, 8, 9, 10]);
    expect(windowFrames(11, 0, 59)).toEqual([55, 56, 57, 58, 59]);
    expect(windowCount(0, 59)).toBe(12);
  }
  });
});

describe('camera', () => {
  it("angDiff qua ±180° · vật phía trước → image_1; trái → camera trái; phía sau → image_0", () => {
    {
    expect(angDiff(170, -170)).toBe(20);
    expect(angDiff(0, 0)).toBe(0);
  }
    {
    expect(rankCameras(5)[0]!.index).toBe(1);
    expect(rankCameras(100)[0]!.index).toBe(3);
    expect(rankCameras(179)[0]!.index).toBe(0);
  }
  });
  it('ưu tiên góc rộng khi nằm trong vùng nhìn', () => {
    expect(rankCameras(40)[0]!.index).toBe(2);
  });
});

describe('nội suy yaw theo cung ngắn', () => {
  const yawAt = (frame: number, yaw: number): CvatShape => { const s = at(frame, 0); s.points[5] = yaw; return s; };
  it("3,1 → −3,1 rad (cùng hướng, qua ±π) không quay vòng · góc gần nhau vẫn nội suy bình thường", () => {
    {
    const t = track(1, [yawAt(0, 3.1), yawAt(5, -3.1)]);
    const d = (f: number) => Math.abs(stateAt(t, f).cuboid!.yaw - 3.1);
    for (let f = 1; f < 5; f++) expect(d(f)).toBeLessThan(0.1); // chỉ lệch ~0,083 rad tổng cộng, không phải ~6,2 rad
  }
    {
    const t = track(1, [yawAt(0, 0.2), yawAt(4, 1.0)]);
    expect(stateAt(t, 2).cuboid!.yaw).toBeCloseTo(0.6);
  }
  });
});
