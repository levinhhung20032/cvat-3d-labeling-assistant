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
    expect(a.detail).toContain('Patchwork++');
  });
  it('dzCm liệt kê từng nguồn đo được', () => {
    const a = adviseGround({ measured: res(-0.65), pw: null, ego: egoGround(0.75, 1.5) }, agree);
    expect(a.dzCm.measured).toBe(10);
    expect(a.dzCm.pw).toBeUndefined();
    expect(a.dzCm.ego).toBe(0);
  });
});
