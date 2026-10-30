import { describe, expect, it } from 'vitest';
import { mirrorBox, mirroredPoints, parseRefState, pointsBelow, refPlane, REF_OFF } from '../src/shared/reflect';
import type { LocalBox } from '../src/shared/edit';

const box: LocalBox = { cu: 0, cv: 0, cw: 0, dyaw: 0, sx: 4, sy: 2, sz: 1.6 }; // đáy ở w = -0.8
const pts = (list: [number, number, number][]) => ({
  u: Float32Array.from(list.map((p) => p[0])), v: Float32Array.from(list.map((p) => p[1])), w: Float32Array.from(list.map((p) => p[2])), n: list.length,
});

describe('reflection mode', () => {
  it('mặt phản chiếu: mặt dưới box, mặt đường (không có thì z = 0 ego), custom đi theo đáy box', () => {
    expect(refPlane(box, { mode: 'bottom', dh: 0.3 }, -1, -0.9)).toEqual({ w: -0.8, src: 'bottom' });
    expect(refPlane(box, { mode: 'road', dh: 0 }, -0.85, -0.9)).toEqual({ w: -0.85, src: 'road' });
    expect(refPlane(box, { mode: 'road', dh: 0 }, null, -0.9)).toEqual({ w: -0.9, src: 'ego' });
    expect(refPlane(box, { mode: 'road', dh: 0 }, null, null).src).toBe('bottom');
    expect(refPlane({ ...box, cw: 1 }, { mode: 'custom', dh: -0.1 }, null, null).w).toBeCloseTo(0.1);
  });

  it('box ảo đối xứng qua mặt phản chiếu, cùng kích thước', () => {
    expect(mirrorBox(box, -0.8)).toEqual({ ...box, cw: -1.6 });
  });

  it('chỉ lấy điểm trong box ảo rồi lật lại vào box chính', () => {
    const p = pts([[1, 0.5, -1.2], [0, 0, -2.3], [3, 0, -1.2], [0, 0, 0.2], [0, 0.9, -0.81]]);
    const m = mirroredPoints(p, box, -0.8);
    expect(m.n).toBe(3); // (3, 0) ngoài chân box; điểm phía trên mặt phản chiếu không nằm trong box ảo
    expect([...m.w].map((w) => Math.round(w * 100) / 100)).toEqual([-0.4, 0.7, -0.79]);
    expect(m.u[0]).toBeCloseTo(1);
  });

  it('box xoay (dyaw): chân box xét theo hướng box', () => {
    const r: LocalBox = { ...box, dyaw: Math.PI / 2 }; // dài 4 m nằm theo trục v
    expect(mirroredPoints(pts([[0, 1.8, -1.2]]), r, -0.8).n).toBe(1);
    expect(mirroredPoints(pts([[1.8, 0, -1.2]]), r, -0.8).n).toBe(0);
  });

  it('đếm điểm dưới mặt đường trong chân box (bỏ lớp sát mặt đường, sâu tới một chiều cao box)', () => {
    const p = pts([[0, 0, -0.9], [0, 0, -1.2], [1, 0.5, -2.0], [0, 0, -3], [5, 0, -1.5]]);
    expect(pointsBelow(p, box, -0.8, null, { minBelow: 1, clear: 0.15 })).toBe(2);
    expect(pointsBelow(p, box, null, -0.8, { minBelow: 1, clear: 0 })).toBe(3);
  });

  it('đọc trạng thái lưu: trường hỏng về mặc định, dh kẹp ±5 m', () => {
    expect(parseRefState(null)).toEqual(REF_OFF);
    expect(parseRefState({ on: true, mode: 'road', dh: 9, dismissed: 1 })).toEqual({ on: true, mode: 'road', dh: 5, dismissed: false });
    expect(parseRefState({ mode: 'x', dh: 'a' })).toEqual(REF_OFF);
  });
});
