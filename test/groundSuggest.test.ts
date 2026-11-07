import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUND, egoGround, type GroundResult } from '../src/shared/ground';
import { adviseGround } from '../src/shared/groundSuggest';

const res = (groundW: number, over: Partial<GroundResult> = {}): GroundResult => ({ ...egoGround(0.75, 1.5), groundW, dz: groundW + 0.75, ...over });
const agree = DEFAULT_GROUND.pwAgree;

describe('gợi ý nguồn mặt đường', () => {
  it('đo riêng đủ tin thì gợi ý đo riêng', () => {
    const a = adviseGround({ measured: res(-0.75), pw: null, ego: egoGround(0.75, 1.5) }, agree);
    expect(a.kind).toBe('measured');
    expect(a.conflict).toBe(false);
  });
  it('đo riêng không chắc, Patchwork++ đủ tin thì gợi ý Patchwork++', () => {
    const a = adviseGround({ measured: res(-0.75, { confident: false }), pw: res(-0.7, { pw: 'pts' }), ego: egoGround(0.75, 1.5) }, agree);
    expect(a.kind).toBe('pw');
  });
  it('mơ hồ hoặc bị loại vì không nhất quán thì không dùng', () => {
    expect(adviseGround({ measured: res(-0.75, { ambiguous: true }), pw: res(-0.7), ego: egoGround(0.75, 1.5) }, agree).kind).toBe('pw');
    expect(adviseGround({ measured: null, pw: res(-0.7, { inconsistent: true }), ego: egoGround(0.75, 1.5) }, agree).kind).toBe('ego');
  });
  it('không nguồn đo nào đủ tin thì chỉ còn ego z=0', () => {
    expect(adviseGround({ measured: null, pw: null, ego: egoGround(0.75, 1.5) }, agree).kind).toBe('ego');
  });
  it('đo riêng và Patchwork++ cùng đủ tin nhưng lệch nhau nhiều: vẫn đo riêng, đánh dấu conflict', () => {
    const a = adviseGround({ measured: res(-0.75), pw: res(-0.75 - (agree + 0.3)), ego: egoGround(0.75, 1.5) }, agree);
    expect(a.kind).toBe('measured');
    expect(a.conflict).toBe(true);
    expect(a.detail).toContain('patchwork++');
  });
  it('dzCm liệt kê từng nguồn đo được', () => {
    const a = adviseGround({ measured: res(-0.65), pw: null, ego: egoGround(0.75, 1.5) }, agree);
    expect(a.dzCm.measured).toBe(10);
    expect(a.dzCm.pw).toBeUndefined();
    expect(a.dzCm.ego).toBe(0);
  });
});

import { levelGround, neighborGroundZ } from '../src/shared/ground';
import { resizeKeyframes } from '../src/shared/edit';
import { serializeCuboid } from '../src/shared/cuboid';

describe('mặt đường theo box ID nhỏ', () => {
  it('chỉ lấy box trong 5 m, trung bình theo khoảng cách', () => {
    const self = { x: 0, y: 0 };
    expect(neighborGroundZ(self, [{ x: 20, y: 0, z: 1, sz: 1 }])).toBeNull();
    expect(neighborGroundZ(self, [{ x: 3, y: 0, z: 0.9, sz: 1.5 }])).toBeCloseTo(0.15, 6);
    const z = neighborGroundZ(self, [{ x: 1, y: 0, z: 1, sz: 2 }, { x: 4, y: 0, z: 1.2, sz: 2 }, { x: 9, y: 0, z: 5, sz: 2 }])!;
    expect(z).toBeGreaterThan(0); expect(z).toBeLessThan(0.2);
  });
  it('levelGround: dz đưa đáy chạm mặt đường', () => {
    const g = levelGround(0.1, 0.85, 1.5); // đáy hiện ở 0.1 → dz = 0
    expect(g.dz).toBeCloseTo(0, 9);
    expect(levelGround(0.3, 0.85, 1.5).dz).toBeCloseTo(0.2, 9);
  });
  it('gợi ý ưu tiên box ID nhỏ, vẫn không đụng hành vi cũ khi không có', () => {
    const nb = levelGround(0.1, 0.85, 1.5);
    expect(adviseGround({ nbr: nb, measured: res(-0.75), pw: null, ego: egoGround(0.75, 1.5) }, agree).kind).toBe('nbr');
    expect(adviseGround({ nbr: null, measured: res(-0.75), pw: null, ego: egoGround(0.75, 1.5) }, agree).kind).toBe('measured');
  });
});

describe('Ctrl+đổi kích thước', () => {
  it('chỉ keyframe từ fromFrame trở đi, theo trục riêng', () => {
    const mk = (frame: number, x: number, yaw: number) => ({ type: 'cuboid', frame, outside: false, points: serializeCuboid({ x, y: 0, z: 0, rx: 0, ry: 0, yaw, sx: 4, sy: 2, sz: 1.5 }, new Array(16).fill(0)) });
    const t = { shapes: [mk(0, 0, 0), mk(5, 10, Math.PI / 2), mk(9, 20, 0)] } as never;
    const r = resizeKeyframes(t, { cu: 0.5, cv: 0, cw: 0, dyaw: 0, sx: 5, sy: 2, sz: 1.5 }, 5);
    expect(r.frames).toEqual([5, 9]);
  });
});
