import { describe, expect, it } from 'vitest';
import { buildXlsx } from '../src/shared/xlsx';
import { parseQcMatrix } from '../src/shared/qcimport';

describe('đọc sheet Matrix của file QC', () => {
  const rows = [
    ['Ký hiệu: S = Scale không đồng bộ | K = Kích thước ngoài ngưỡng'],
    ['Màu ô: …'],
    ['Track ID', 'Class', 'Tổng số issue', 0, 1, 2],
    [1, 'vehicles', 3, '', 'K', 'SK'],
    [2, 'pedestrian', 0, '', '', ''],
    [3, 'two-wheels', 1, 'O', '', ''],
  ];
  it('lấy flag theo (ID, frame, loại), tách ô nhiều ký hiệu', () => {
    const r = parseQcMatrix(buildXlsx(rows, 'Matrix'));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tracks).toBe(3);
    expect(r.flags).toEqual([
      { num: 1, frame: 1, kind: 'K' }, { num: 1, frame: 2, kind: 'S' }, { num: 1, frame: 2, kind: 'K' }, { num: 3, frame: 0, kind: 'O' },
    ]);
  });
  it('báo lỗi rõ khi thiếu sheet Matrix hoặc không phải xlsx', () => {
    const noSheet = parseQcMatrix(buildXlsx(rows, 'Other'));
    expect(noSheet.ok).toBe(false);
    expect(parseQcMatrix(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });
});
