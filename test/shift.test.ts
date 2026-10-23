import { describe, expect, it } from 'vitest';
import { computeKpi, kpiText, outsideFrames, shiftName, uniqueShiftName, type Shift, type ShiftTrackRec } from '../src/shared/shift';
import { shape, track } from './fixtures';

describe('tên ca', () => {
  it('sáng 21/10 → Oct21AM; chiều → PM; không đệm số 0', () => {
    expect(shiftName(new Date(2026, 9, 21, 8, 30))).toBe('Oct21AM');
    expect(shiftName(new Date(2026, 9, 21, 12, 0))).toBe('Oct21PM');
    expect(shiftName(new Date(2026, 9, 21, 23, 59))).toBe('Oct21PM');
    expect(shiftName(new Date(2026, 0, 5, 0, 5))).toBe('Jan5AM');
    expect(shiftName(new Date(2026, 11, 31, 11, 59))).toBe('Dec31AM');
  });
  it('trùng tên thì thêm hậu tố', () => {
    expect(uniqueShiftName('Oct21AM', [])).toBe('Oct21AM');
    expect(uniqueShiftName('Oct21AM', ['Oct21AM'])).toBe('Oct21AM#2');
    expect(uniqueShiftName('Oct21AM', ['Oct21AM', 'Oct21AM#2'])).toBe('Oct21AM#3');
  });
});

describe('outsideFrames', () => {
  it('đếm frame outside theo cách CVAT hiển thị', () => {
    const t = track(1, [shape(0), shape(3, true), shape(6)]);
    expect(outsideFrames(t, 0, 9)).toEqual([3, 4, 5]);
  });
});

const rec = (num: number, over: Partial<ShiftTrackRec> = {}): ShiftTrackRec => ({
  num, id: 100 + num, label: 'vehicles', added: 0, removed: 0, modified: 0, baked: 0, outsideFilled: 0, outsideBefore: [], outsideAfter: [], ...over,
});
const base = (): Shift => ({ name: 'Oct21AM', start: '2026-10-21T01:00:00.000Z', end: '2026-10-21T03:30:00.000Z', uploads: [], accepted: 0, ignored: 0, edits: 0, touched: [] });

describe('KPI ca', () => {
  it('ca rỗng', () => {
    const k = computeKpi(base());
    expect(k.totals.objects).toBe(0);
    expect(k.durationMin).toBe(150);
    expect(kpiText(k)).toContain('Oct21AM');
  });
  it('object đã tác động, frame outside mới / đưa trở lại, keyframe', () => {
    const s = base();
    s.uploads.push({
      time: '2026-10-21T02:00:00.000Z', jobId: 9999,
      tracks: [
        rec(5, { added: 2, baked: 10, outsideBefore: [3, 4], outsideAfter: [3, 4, 5, 6, 7] }),
        rec(9, { modified: 3, label: 'pedestrian', outsideBefore: [8], outsideAfter: [] }),
      ],
    });
    const k = computeKpi(s);
    expect(k.totals.objects).toBe(2);
    expect(k.byLabel).toEqual({ vehicles: 1, pedestrian: 1 });
    expect(k.totals.outsideNow).toBe(5);
    expect(k.totals.outsideNew).toBe(3);
    expect(k.totals.outsideRestored).toBe(1);
    expect(k.totals.added).toBe(2);
    expect(k.totals.baked).toBe(10);
    expect(k.totals.modified).toBe(3);
  });
  it('nhiều lần upload cùng object: cộng dồn đếm, outside lấy đầu → cuối', () => {
    const s = base();
    s.uploads.push(
      { time: 't1', jobId: 1, tracks: [rec(5, { added: 1, outsideBefore: [], outsideAfter: [3] })] },
      { time: 't2', jobId: 1, tracks: [rec(5, { added: 2, outsideBefore: [3], outsideAfter: [3, 4] })] },
    );
    const k = computeKpi(s);
    expect(k.objects).toHaveLength(1);
    expect(k.objects[0]).toMatchObject({ uploads: 2, added: 3, outsideNow: 2, outsideNew: 2 });
    expect(k.uploads).toBe(2);
  });
  it('object sửa mà chưa upload nằm ở mục chưa upload', () => {
    const s = base();
    s.touched = ['9999:5', '9999:7'];
    s.uploads.push({ time: 't', jobId: 9999, tracks: [rec(5)] });
    const k = computeKpi(s);
    expect(k.pending).toEqual(['9999:7']);
    expect(kpiText(k)).toContain('CHƯA upload: 7');
  });
  it('ca đang chạy: thời lượng tính tới hiện tại', () => {
    const s = { ...base(), end: null };
    expect(computeKpi(s, new Date('2026-10-21T01:45:00.000Z')).durationMin).toBe(45);
  });
});
