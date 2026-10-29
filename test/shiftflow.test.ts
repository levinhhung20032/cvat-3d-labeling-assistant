import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULE } from '../src/shared/schedule';
import { mergeShiftState, recordActivity, syncShifts, type ShiftState } from '../src/shared/shiftflow';
import type { Shift } from '../src/shared/shift';

const t = (h: number, m = 0, day = 27) => new Date(2026, 9, day, h, m, 0, 0);
const S = DEFAULT_SCHEDULE;
const empty: ShiftState = { active: null, history: [] };
const edit = (s: Shift): Shift => ({ ...s, edits: s.edits + 1 });

describe('vào / ra ca tự động', () => {
  it('trong giờ ca sáng tự mở ca, bắt đầu đúng 8:30 theo lịch dù mở tool lúc 9:10', () => {
    const st = syncShifts(empty, t(9, 10), S);
    expect(st.active!.name).toBe('Oct27AM');
    expect(st.active!.slot).toBe('AM');
    expect(new Date(st.active!.start).getHours() * 60 + new Date(st.active!.start).getMinutes()).toBe(8 * 60 + 30);
    expect(syncShifts(st, t(9, 40), S)).toBe(st); // không đổi gì
  });
  it('hết ca sáng thì ca sáng được đóng đúng 12:30, nghỉ trưa chưa mở ca nào', () => {
    let st = syncShifts(empty, t(10), S);
    st = syncShifts(st, t(12, 45), S);
    expect(st.active).toBeNull();
    expect(st.history[0]!.name).toBe('Oct27AM');
    const end = new Date(st.history[0]!.end!);
    expect(end.getHours() * 60 + end.getMinutes()).toBe(12 * 60 + 30);
  });
  it('13:30 tự mở ca chiều; 17:30 đóng và không tự mở OT khi chưa làm gì', () => {
    let st = syncShifts(empty, t(13, 31), S);
    expect(st.active!.name).toBe('Oct27PM');
    st = syncShifts(st, t(17, 35), S);
    expect(st.active).toBeNull();
    expect(st.history.map((h) => h.name)).toEqual(['Oct27PM']);
  });
  it('có thao tác ngoài giờ thì mở OT; OT kết thúc ở thao tác cuối chứ không phải lúc đóng', () => {
    let st = recordActivity(empty, t(18, 0), S, edit);
    expect(st.active!.name).toBe('Oct27OT');
    expect(st.active!.slot).toBe('OT');
    expect(st.active!.edits).toBe(1);
    st = recordActivity(st, t(19, 20), S, edit);
    expect(st.active!.edits).toBe(2);
    st = syncShifts(st, t(8, 31, 28), S); // sáng hôm sau vào ca
    expect(st.history[0]!.name).toBe('Oct27OT');
    const end = new Date(st.history[0]!.end!);
    expect(end.getHours() * 60 + end.getMinutes()).toBe(19 * 60 + 20);
    expect(st.active!.name).toBe('Oct28AM');
  });
  it('thao tác trong giờ ca thì ghi vào ca đó, không tạo OT', () => {
    const st = recordActivity(syncShifts(empty, t(9), S), t(9, 5), S, edit);
    expect(st.active!.name).toBe('Oct27AM');
    expect(st.active!.edits).toBe(1);
    expect(st.history).toEqual([]);
  });
  it('OT buổi nghỉ trưa và OT buổi tối cùng ngày có tên khác nhau (hậu tố #2)', () => {
    let st = recordActivity(empty, t(12, 40), S, edit);
    expect(st.active!.name).toBe('Oct27OT');
    st = syncShifts(st, t(13, 31), S);
    st = syncShifts(st, t(17, 40), S);
    st = recordActivity(st, t(18, 0), S, edit);
    expect(st.active!.name).toBe('Oct27OT#2');
    expect(st.history.map((h) => h.name)).toEqual(['Oct27PM', 'Oct27OT']);
  });
});

describe('gộp ca giữa hai phiên tool (KPI không bị ghi đè)', () => {
  const sh = (name: string, start: string, over: Partial<Shift> = {}): Shift => ({ name, start, end: null, uploads: [], accepted: 0, ignored: 0, edits: 0, touched: [], ...over });
  const up = (time: string, jobId = 1) => ({ time, jobId, tracks: [] });
  it('cùng ca ở hai phiên: hợp các lần upload và object đã sửa, bộ đếm lấy lớn hơn', () => {
    const a: ShiftState = { active: sh('Oct30AM', '2026-10-30T01:30:00Z', { uploads: [up('t1'), up('t2')], edits: 5, touched: ['1:2'] }), history: [] };
    const b: ShiftState = { active: sh('Oct30AM', '2026-10-30T01:30:00Z', { uploads: [up('t1'), up('t3')], edits: 2, touched: ['1:4'] }), history: [] };
    const m = mergeShiftState(a, b);
    expect(m.active!.uploads.map((u) => u.time)).toEqual(['t1', 't2', 't3']);
    expect(m.active!.edits).toBe(5);
    expect(m.active!.touched.sort()).toEqual(['1:2', '1:4']);
    expect(m.history).toEqual([]);
  });
  it('phiên cũ chưa chuyển ca: ca cũ vào lịch sử (đã kết thúc), ca mới là ca đang chạy · lịch sử hai bên được giữ · ca đã xoá không quay lại', () => {
    const old = sh('Oct29PM', '2026-10-29T06:30:00Z', { endAt: '2026-10-29T10:30:00Z', uploads: [up('p1')] });
    const a: ShiftState = { active: old, history: [sh('Oct28AM', '2026-10-28T01:30:00Z', { end: '2026-10-28T05:30:00Z' })] };
    const b: ShiftState = { active: sh('Oct30AM', '2026-10-30T01:30:00Z'), history: [{ ...old, end: '2026-10-29T10:30:00Z' }, sh('Oct27AM', '2026-10-27T01:30:00Z', { end: 'x' })] };
    const m = mergeShiftState(a, b, ['Oct27AM|2026-10-27T01:30:00Z', 'Oct30AM|2026-10-01T00:00:00Z']); // dấu xoá của ca khác cùng tên không lọc nhầm
    expect(m.active!.name).toBe('Oct30AM');
    expect(m.history.map((s) => s.name)).toEqual(['Oct29PM', 'Oct28AM']);
    expect(m.history[0]!.end).toBe('2026-10-29T10:30:00Z');
    expect(m.history[0]!.uploads).toHaveLength(1);
  });
});
