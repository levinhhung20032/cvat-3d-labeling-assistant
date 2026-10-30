import { describe, expect, it } from 'vitest';
import { DEFAULT_SCHEDULE, endWarning, minutesLeft, normalizeSchedule, slotAt } from '../src/shared/schedule';

const t = (h: number, m = 0, s = 0, day = 27) => new Date(2026, 9, day, h, m, s);

describe('ca tự động theo lịch', () => {
  it("ca sáng 8:30–12:30, ca chiều 13:30–17:30, phần còn lại là OT · tên ca theo ngày; OT trước giờ vào ca sáng thuộc OT của ngày hôm trước", () => {
    {
    expect(slotAt(t(8, 29, 59)).slot).toBe('OT');
    expect(slotAt(t(8, 30)).slot).toBe('AM');
    expect(slotAt(t(12, 29, 59)).slot).toBe('AM');
    expect(slotAt(t(12, 30)).slot).toBe('OT'); // nghỉ trưa
    expect(slotAt(t(13, 29)).slot).toBe('OT');
    expect(slotAt(t(13, 30)).slot).toBe('PM');
    expect(slotAt(t(17, 29, 59)).slot).toBe('PM');
    expect(slotAt(t(17, 30)).slot).toBe('OT');
    expect(slotAt(t(23, 0)).slot).toBe('OT');
  }
    {
    expect(slotAt(t(9)).name).toBe('Oct27AM');
    expect(slotAt(t(14)).name).toBe('Oct27PM');
    expect(slotAt(t(18)).name).toBe('Oct27OT');
    expect(slotAt(t(2, 0, 0, 28)).name).toBe('Oct27OT');
    expect(slotAt(t(8, 0, 0, 28)).name).toBe('Oct27OT');
  }
  });
  it('giờ bắt đầu / kết thúc theo lịch của ca sáng và chiều, OT không có', () => {
    const am = slotAt(t(10));
    expect(am.start!.getHours() * 60 + am.start!.getMinutes()).toBe(8 * 60 + 30);
    expect(am.end!.getHours() * 60 + am.end!.getMinutes()).toBe(12 * 60 + 30);
    const ot = slotAt(t(19));
    expect(ot.start).toBeNull(); expect(ot.end).toBeNull();
  });
});

describe('cảnh báo gần hết ca', () => {
  it("còn 15 phút trở xuống thì cảnh báo; trước đó và sau khi hết ca thì không · OT không cảnh báo; số phút còn lại của ca", () => {
    {
    expect(endWarning(t(12, 14, 59))).toBeNull();
    expect(endWarning(t(12, 15))!.minutesLeft).toBe(15);
    expect(endWarning(t(12, 29, 30))!.minutesLeft).toBe(1);
    expect(endWarning(t(12, 30))).toBeNull();
    expect(endWarning(t(17, 20))!.slot).toBe('PM');
    expect(endWarning(t(17, 15))!.minutesLeft).toBe(15);
  }
    {
    expect(endWarning(t(19))).toBeNull();
    expect(minutesLeft(t(11, 0))).toBe(90);
    expect(minutesLeft(t(19))).toBeNull();
  }
  });
  it('đổi số phút cảnh báo trong lịch', () => {
    expect(endWarning(t(12, 5), { ...DEFAULT_SCHEDULE, warnMin: 30 })).not.toBeNull();
    expect(endWarning(t(12, 5), { ...DEFAULT_SCHEDULE, warnMin: 15 })).toBeNull();
  });
});

describe('lịch hợp lệ', () => {
  it('giờ sai hoặc không tăng dần thì dùng mặc định, giữ số phút cảnh báo hợp lệ', () => {
    expect(normalizeSchedule({ amStart: '13:00', amEnd: '12:00' })).toEqual(DEFAULT_SCHEDULE);
    expect(normalizeSchedule({ amStart: 'abc' })).toEqual(DEFAULT_SCHEDULE);
    expect(normalizeSchedule({ amStart: '09:00', warnMin: 10 })).toMatchObject({ amStart: '09:00', warnMin: 10 });
    expect(normalizeSchedule({ warnMin: 9999 }).warnMin).toBe(120);
  });
});

describe('chỉ tiêu KPI mỗi ca', () => {
  it('mặc định 500 frame; số sai / ngoài khoảng thì về mặc định hoặc kẹp lại; lịch cũ chưa có chỉ tiêu nhận mặc định', () => {
    expect(DEFAULT_SCHEDULE.kpiTarget).toBe(500);
    expect(normalizeSchedule({ amStart: '08:30' }).kpiTarget).toBe(500);
    expect(normalizeSchedule({ kpiTarget: Number.NaN }).kpiTarget).toBe(500);
    expect(normalizeSchedule({ kpiTarget: 0 }).kpiTarget).toBe(1);
    expect(normalizeSchedule({ kpiTarget: 650.4 }).kpiTarget).toBe(650);
    expect(normalizeSchedule({ amStart: 'abc', kpiTarget: 700 }).kpiTarget).toBe(700); // lịch sai về mặc định nhưng giữ chỉ tiêu
  });
});
