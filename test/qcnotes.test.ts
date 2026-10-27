import { describe, expect, it } from 'vitest';
import { notesToRows } from '../src/shared/qc';
import { parseNotesXlsx, planNotesImport } from '../src/shared/qcnotes';
import { buildXlsx } from '../src/shared/xlsx';

describe('QC note import', () => {
  it("xuất rồi nhập lại: giữ đúng ID, frame, note (kể cả tiếng Việt, ký tự XML, dấu xuống dòng) · tên sheet khác vẫn đọc được (lấy sheet đầu); cột đảo thứ tự; dòng sai bị bỏ qua; trùng thì dòng sau thắng", () => {
    {
    const notes = [{ num: 1, frame: 3, note: 'lệch yaw & "xa" <5°>' }, { num: 12, frame: 0, note: 'thiếu KF' }, { num: 12, frame: 40, note: 'dòng 1\ndòng 2' }];
    const r = parseNotesXlsx(buildXlsx(notesToRows(notes), 'QC'));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.notes).toEqual(notes); expect(r.skipped).toBe(0); }
  }
    {
    const rows = [['note', 'frame', 'ID'], ['a', 5, 2], ['b', 5, 2], ['', 6, 2], ['c', 'x', 3], ['d', 7, 0], ['e', 8, 4]];
    const r = parseNotesXlsx(buildXlsx(rows, 'Sheet1'));
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.notes).toEqual([{ num: 2, frame: 5, note: 'b' }, { num: 4, frame: 8, note: 'e' }]); expect(r.skipped).toBe(3); }
  }
  });
  it("file đối chiếu QC (không có cột ID, frame, note) hoặc không phải xlsx: báo lỗi rõ · kế hoạch nhập: mới / giống / trùng khác nội dung", () => {
    {
    const matrix = buildXlsx([['Track ID', 'Class', 'n', 0, 1], [1, 'vehicles', 0, 'K', '']], 'Matrix');
    const r = parseNotesXlsx(matrix);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.message).toContain('QC comparison');
    expect(parseNotesXlsx(new Uint8Array([1, 2, 3])).ok).toBe(false);
  }
    {
    const cur = [{ num: 1, frame: 1, note: 'x' }, { num: 2, frame: 2, note: 'y' }];
    const inc = [{ num: 1, frame: 1, note: 'x' }, { num: 2, frame: 2, note: 'Y2' }, { num: 3, frame: 3, note: 'z' }];
    const p = planNotesImport(cur, inc);
    expect(p.same).toHaveLength(1);
    expect(p.added).toEqual([{ num: 3, frame: 3, note: 'z' }]);
    expect(p.conflicts).toEqual([{ num: 2, frame: 2, current: 'y', incoming: 'Y2' }]);
  }
  });
});
