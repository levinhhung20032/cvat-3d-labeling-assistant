import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { buildXlsx } from '../src/shared/xlsx';
import { notesOfJob, notesToRows, parseQc, qcKey } from '../src/shared/qc';

describe('ghi chú QC', () => {
  it('lọc theo job, sắp theo ID rồi frame, bỏ ghi chú rỗng', () => {
    const all = { [qcKey(7, 3, 10)]: 'lệch yaw', [qcKey(7, 1, 5)]: 'thiếu KF', [qcKey(8, 1, 1)]: 'job khác', [qcKey(7, 1, 2)]: '  ' };
    expect(notesOfJob(all, 7)).toEqual([{ num: 1, frame: 5, note: 'thiếu KF' }, { num: 3, frame: 10, note: 'lệch yaw' }]);
  });
  it('đọc dữ liệu lưu hỏng thì trả rỗng, bỏ khóa sai', () => {
    expect(parseQc('{oops')).toEqual({});
    expect(parseQc('[1]')).toEqual({});
    expect(parseQc(JSON.stringify({ '7:1:2': 'ok', bad: 'x', '7:1:3': 5 }))).toEqual({ '7:1:2': 'ok' });
  });
  it('xuất đúng 3 cột ID, frame, note', () => {
    expect(notesToRows([{ num: 2, frame: 4, note: 'x' }])).toEqual([['ID', 'frame', 'note'], [2, 4, 'x']]);
  });
});

describe('xlsx', () => {
  const read = (u8: Uint8Array) => Object.fromEntries(Object.entries(unzipSync(u8)).map(([k, v]) => [k, strFromU8(v)]));
  it('là gói zip hợp lệ có đủ phần bắt buộc', () => {
    const f = read(buildXlsx([['ID', 'frame', 'note'], [1, 2, 'a']]));
    expect(Object.keys(f).sort()).toEqual([
      '[Content_Types].xml', '_rels/.rels', 'xl/_rels/workbook.xml.rels', 'xl/styles.xml', 'xl/workbook.xml', 'xl/worksheets/sheet1.xml',
    ]);
    expect(f['xl/worksheets/sheet1.xml']).toContain('<c r="A2"><v>1</v></c>');
    expect(f['xl/worksheets/sheet1.xml']).toContain('<c r="C1" t="inlineStr" s="1">');
  });
  it('escape ký tự XML, bỏ ký tự điều khiển, giữ tiếng Việt', () => {
    const f = read(buildXlsx([['ID', 'frame', 'note'], [1, 2, 'a<b & "c" \u0001 lệch']]));
    expect(f['xl/worksheets/sheet1.xml']).toContain('a&lt;b &amp; &quot;c&quot;  lệch');
  });
});
