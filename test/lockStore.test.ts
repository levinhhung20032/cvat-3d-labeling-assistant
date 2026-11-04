import { describe, expect, it } from 'vitest';
import { deletableIds } from '../src/shared/lockIds';

describe('khóa danh sách ID gốc', () => {
  it('chưa khóa: chỉ object do tool tạo xóa được', () => {
    const r = deletableIds([7], null, [1, 2, 7, 9]);
    expect([...r.all]).toEqual([7]);
    expect(r.external.size).toBe(0);
  });
  it('đã khóa: ID trong list không xóa được; ID ngoài list (vẽ trên CVAT) và do tool tạo thì xóa được', () => {
    const r = deletableIds([7], [1, 2], [1, 2, 7, 9]);
    expect([...r.all].sort()).toEqual([7, 9]);
    expect([...r.external]).toEqual([9]);
  });
  it('ID khóa không bao giờ lọt vào tập xóa được, kể cả khi có trong sổ do tool tạo', () => {
    expect(deletableIds([1], [1, 2], [1, 2]).all.has(1)).toBe(false);
  });
});
