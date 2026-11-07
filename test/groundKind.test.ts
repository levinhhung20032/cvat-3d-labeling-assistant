import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUND, egoGround, GROUND_KINDS, groundSnapBy } from '../src/shared/ground';

const empty = { u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0), n: 0 };

describe('nguồn mặt đường theo từng frame', () => {
  it('có đúng 4 nguồn: đo, ego z=0, Patchwork++, box ID nhỏ', () => {
    expect([...GROUND_KINDS]).toEqual(['measured', 'ego', 'pw', 'nbr']);
  });

  it('ego z=0: đáy box (z tâm 1,0, cao 1,6 → đáy 0,2) hạ 0,2 m xuống z = 0', () => {
    const g = egoGround(1.0, 1.6);
    expect(g.confident).toBe(true);
    expect(g.warn).toBe(false);
    expect(g.dz).toBeCloseTo(-0.2, 6);
    expect(g.groundW).toBeCloseTo(-1.0, 6);
  });

  it('ego z=0: box đã bị dời lên 0,3 m (at.cw) thì dz tính từ vị trí mới, đáy vẫn rơi đúng z = 0', () => {
    const z = 1.0, sz = 1.6, cw = 0.3;
    const g = egoGround(z, sz, { cu: 0, cv: 0, cw });
    expect(z + cw + g.dz - sz / 2).toBeCloseTo(0, 6);
  });

  it('groundSnapBy("ego") không cần point cloud và không phụ thuộc tầm đo', () => {
    const g = groundSnapBy('ego', empty, 4, 1.8, 1.5, { cu: 0, cv: 0, cw: 0, range: 999 }, 0.75);
    expect(g?.dz).toBeCloseTo(0, 6);
  });

  it('đo riêng / Patchwork++ ngoài bán kính đo mặt đường thì không có kết quả', () => {
    const at = { cu: 0, cv: 0, cw: 0, range: DEFAULT_GROUND.maxRange + 1 };
    expect(groundSnapBy('measured', empty, 4, 1.8, 1.5, at, 0)).toBeNull();
    expect(groundSnapBy('pw', empty, 4, 1.8, 1.5, at, 0)).toBeNull();
  });

  it('không có điểm: Patchwork++ không dựng được mặt đường', () => {
    expect(groundSnapBy('pw', empty, 4, 1.8, 1.5, { cu: 0, cv: 0, cw: 0, range: 10 }, 0)).toBeNull();
  });
});
