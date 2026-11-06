import { describe, expect, it } from 'vitest';
import { middleSparse } from '../src/shared/midOutside';

const range = (a: number, b: number) => Array.from({ length: b - a + 1 }, (_, i) => a + i);
describe('outside ở giữa', () => {
  it('chỉ báo frame ít điểm nằm giữa hai frame không ít điểm', () => {
    const bad = new Set([7, 8, 12, 13, 14, 22, 23]);
    // 7-8 ở đầu, 22-23 ở cuối: bỏ; 12-14 ở giữa: báo
    expect(middleSparse(range(7, 23), (f) => bad.has(f))).toEqual([12, 13, 14]);
  });
  it('không có frame nào ổn hoặc không có ít điểm → rỗng', () => {
    expect(middleSparse(range(0, 5), () => true)).toEqual([]);
    expect(middleSparse(range(0, 5), () => false)).toEqual([]);
    expect(middleSparse([], () => true)).toEqual([]);
  });
});
