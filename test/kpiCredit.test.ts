import { describe, expect, it } from 'vitest';
import { allocTargets, creditAll, creditOf, firstDays, idKeyOf, retainShifts, suggestAlloc, workDay } from '../src/shared/kpiCredit';
import { DEFAULT_SCHEDULE } from '../src/shared/schedule';
import type { Shift, ShiftTrackRec } from '../src/shared/shift';

const sch = DEFAULT_SCHEDULE;
const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).toISOString(); // giờ máy, tháng 10
const rec = (id: number, span: number, over: Partial<ShiftTrackRec> = {}): ShiftTrackRec => ({
  num: id, id, label: 'vehicles', added: 0, removed: 0, modified: 0, baked: 0, outsideFilled: 0, outsideBefore: [], outsideAfter: [],
  firstSeen: 100 - span, stop: 99, outsideKeys: [], ...over,
});
const shift = (name: string, slot: 'AM' | 'PM' | 'OT', start: string, ups: [string, ShiftTrackRec[]][], over: Partial<Shift> = {}): Shift => ({
  name, slot, start, end: null, accepted: 0, ignored: 0, edits: 0, touched: [],
  uploads: ups.map(([time, tracks]) => ({ time, jobId: 7, tracks })), ...over,
});
const key = (id: number) => idKeyOf(undefined, 7, { id, num: id });

describe('ngày làm việc của ca', () => {
  it('OT sau nửa đêm (trước giờ vào ca sáng) thuộc ngày hôm trước; ca sáng / chiều theo ngày bắt đầu', () => {
    expect(workDay({ start: at(30, 9), slot: 'AM' }, sch)).toBe('2026-10-30');
    expect(workDay({ start: at(31, 1), slot: 'OT' }, sch)).toBe('2026-10-30');
    expect(workDay({ start: at(30, 19), slot: 'OT' }, sch)).toBe('2026-10-30');
  });
});

describe('KPI theo ID: một ngày tính một lần, ca đầu tiên sở hữu, ngày sau là rework', () => {
  const am = shift('Oct30AM', 'AM', at(30, 8, 30), [[at(30, 9), [rec(1, 100)]], [at(30, 10), [rec(2, 40)]]]);
  const pm = shift('Oct30PM', 'PM', at(30, 13, 30), [[at(30, 14), [rec(1, 100), rec(3, 10)]]]); // ID 1 làm lại cùng ngày
  const next = shift('Oct31AM', 'AM', at(31, 8, 30), [[at(31, 9), [rec(2, 40)]]]); // ID 2 sửa lại ngày sau
  const all = [am, pm, next];
  const credits = creditAll(all, firstDays(all, sch), sch);
  it('cùng ngày: ID 1 chỉ tính cho ca sáng (ca đầu tiên), ca chiều không tính lặp', () => {
    expect(creditOf(credits, 'Oct30AM')).toMatchObject({ kpi: 140, rework: 0 });
    expect(creditOf(credits, 'Oct30PM')).toMatchObject({ kpi: 10, rework: 0 });
  });
  it('ngày sau: sửa lại ID 2 là rework, vẫn tính vào KPI (hiện riêng phần rework)', () => {
    expect(creditOf(credits, 'Oct31AM')).toMatchObject({ kpi: 40, rework: 40 });
  });
  it('sổ ngày đầu giữ được ID của ca đã bị cắt khỏi lịch sử', () => {
    const c = creditAll([next], { [key(2)]: '2026-10-30' }, sch);
    expect(creditOf(c, 'Oct31AM')).toMatchObject({ kpi: 40, rework: 40 });
  });
});

describe('dồn KPI ca OT', () => {
  const ot = shift('Oct30OT', 'OT', at(30, 18), [[at(30, 18, 5), [rec(11, 300)]], [at(30, 18, 30), [rec(12, 250)]], [at(30, 19), [rec(13, 100)]]]);
  const am = shift('Oct30AM', 'AM', at(30, 8, 30), [[at(30, 9), [rec(1, 200)]]]);
  it('ID dồn sang ca khác (kể cả ca chưa mở) thì ca đó nhận toàn bộ KPI của ID', () => {
    const moved = { ...ot, assign: { [key(11)]: 'Oct31AM', [key(12)]: 'Oct31AM' } };
    const c = creditAll([am, moved], {}, sch);
    expect(creditOf(c, 'Oct31AM')).toMatchObject({ kpi: 550, fromOthers: 2 });
    expect(creditOf(c, 'Oct30OT').kpi).toBe(100);
  });
  it('gợi ý chia: đủ chỉ tiêu một ca thì sang ca sau, không cắt đôi ID; không chia thì dồn hết vào một ca', () => {
    const items = creditOf(creditAll([ot], {}, sch), 'Oct30OT').ids;
    const targets = [{ name: 'Oct31AM', current: 0 }, { name: 'Oct31PM', current: 200 }];
    expect(suggestAlloc(items, targets, 500, true)).toEqual({ [key(11)]: 'Oct31AM', [key(12)]: 'Oct31AM', [key(13)]: 'Oct31PM' });
    expect(suggestAlloc(items, [{ name: 'Oct31AM', current: 450 }], 500, true)).toEqual({ [key(11)]: 'Oct31AM', [key(12)]: null, [key(13)]: null });
    expect(suggestAlloc(items, targets, 500, false)).toEqual({ [key(11)]: 'Oct31AM', [key(12)]: 'Oct31AM', [key(13)]: 'Oct31AM' });
  });
  it('ca nhận được: ca sáng / chiều đã có (7 ngày gần nhất) và ca sắp tới tới hết 3 ngày sau, không có OT', () => {
    const t = allocTargets([am, ot], new Date(2026, 9, 30, 20, 0), sch);
    expect(t.map((x) => `${x.name}${x.future ? '*' : ''}`)).toEqual(['Oct30AM', 'Oct31AM*', 'Oct31PM*', 'Nov1AM*', 'Nov1PM*', 'Nov2AM*', 'Nov2PM*']);
  });
});

describe('chỉ giữ hôm nay + 3 ngày đi làm gần nhất', () => {
  const worked = (name: string, d: number, slot: 'AM' | 'PM' | 'OT' = 'AM', over: Partial<Shift> = {}) => shift(name, slot, at(d, slot === 'PM' ? 13 : slot === 'OT' ? 19 : 8, 30), [[at(d, slot === 'PM' ? 14 : 9), [rec(d, 10)]]], over);
  const idle = (name: string, d: number) => shift(name, 'AM', at(d, 8, 30), []);
  it('ngày không đi làm không được đếm; ca cũ hơn 3 ngày đi làm bị bỏ', () => {
    // làm 20, 21, 23, 26, 27 (22, 24, 25 nghỉ: chỉ có ca trống), hôm nay 28
    const all = [worked('Oct20AM', 20), worked('Oct21AM', 21), idle('Oct22AM', 22), worked('Oct23AM', 23), worked('Oct23PM', 23, 'PM'), idle('Oct24AM', 24), idle('Oct25AM', 25), worked('Oct26AM', 26), worked('Oct27AM', 27), worked('Oct28AM', 28)];
    const kept = retainShifts(all, new Date(2026, 9, 28, 15), sch).map((s) => s.name);
    expect(kept).toEqual(['Oct23AM', 'Oct23PM', 'Oct24AM', 'Oct25AM', 'Oct26AM', 'Oct27AM', 'Oct28AM']);
  });
  it('chưa đủ 3 ngày đi làm thì giữ hết · ca OT đã dồn KPI sang ca còn giữ thì giữ lại · sáng sớm (trước ca sáng) vẫn là ngày hôm trước', () => {
    const few = [worked('Oct26AM', 26), worked('Oct27AM', 27)];
    expect(retainShifts(few, new Date(2026, 9, 28, 9), sch)).toHaveLength(2);
    const ot = worked('Oct20OT', 20, 'OT', { assign: { [key(20)]: 'Oct27AM' } });
    const all = [ot, worked('Oct21AM', 21), worked('Oct25AM', 25), worked('Oct26AM', 26), worked('Oct27AM', 27)];
    expect(retainShifts(all, new Date(2026, 9, 28, 9), sch).map((s) => s.name)).toEqual(['Oct20OT', 'Oct25AM', 'Oct26AM', 'Oct27AM']);
    // 02:00 ngày 28 vẫn thuộc ngày 27: ngày 27 là "hôm nay" nên 3 ngày đi làm trước đó là 25, 26 và 21
    expect(retainShifts(all, new Date(2026, 9, 28, 2), sch).map((s) => s.name)).toEqual(['Oct20OT', 'Oct21AM', 'Oct25AM', 'Oct26AM', 'Oct27AM']);
  });
});

import { fmtIdRanges, fmtJobIds } from '../src/shared/kpiCredit';
describe('hiển thị ID đã làm', () => {
  it('gộp dải liên tiếp', () => {
    expect(fmtIdRanges([5, 1, 2, 3, 7, 8, 3])).toBe('1-3,5,7-8');
    expect(fmtIdRanges([])).toBe('');
  });
  it('theo job', () => {
    expect(fmtJobIds([{ jobId: 12, num: 2 }, { jobId: 9, num: 1 }, { jobId: 12, num: 1 }])).toBe('Job 9 / ID 1; Job 12 / ID 1-2');
  });
});
