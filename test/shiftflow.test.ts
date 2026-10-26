import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULE } from '../src/shared/schedule';
import { recordActivity, syncShifts, type ShiftState } from '../src/shared/shiftflow';
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
