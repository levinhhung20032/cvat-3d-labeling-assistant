import { MONTHS } from './shift';

/**
 * Lịch ca tự động (không chấm công): ca sáng, ca chiều; mọi thời điểm còn lại (sau ca chiều, trước ca sáng, nghỉ trưa) tính là OT.
 * Giờ theo giờ máy của người dùng. Cảnh báo khi còn `warnMin` phút là hết ca sáng / chiều.
 */
export interface Schedule {
  amStart: string; amEnd: string; // "HH:MM"
  pmStart: string; pmEnd: string;
  warnMin: number;
  kpiTarget: number; // chỉ tiêu KPI (frame) của mỗi ca sáng / chiều; OT không có chỉ tiêu
}
export const DEFAULT_SCHEDULE: Schedule = { amStart: '08:30', amEnd: '12:30', pmStart: '13:30', pmEnd: '17:30', warnMin: 15, kpiTarget: 500 };

export type Slot = 'AM' | 'PM' | 'OT';
export interface SlotInfo {
  slot: Slot;
  name: string; // ví dụ Oct27AM, Oct27PM, Oct27OT
  start: Date | null; // đầu ca theo lịch (null với OT: OT bắt đầu từ thao tác đầu tiên)
  end: Date | null; // hết ca theo lịch (null với OT)
}

const parse = (hhmm: string): number => {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm.trim());
  const h = m ? Number(m[1]) : NaN, mi = m ? Number(m[2]) : NaN;
  return Number.isInteger(h) && Number.isInteger(mi) && h >= 0 && h < 24 && mi >= 0 && mi < 60 ? h * 60 + mi : NaN;
};
/** Lịch hợp lệ: bốn mốc tăng dần trong một ngày. Sai thì dùng lịch mặc định. */
export function normalizeSchedule(s: Partial<Schedule> | null | undefined): Schedule {
  const v: Schedule = { ...DEFAULT_SCHEDULE, ...(s ?? {}) };
  const t = [parse(v.amStart), parse(v.amEnd), parse(v.pmStart), parse(v.pmEnd)];
  const ok = t.every((x) => Number.isFinite(x)) && t[0]! < t[1]! && t[1]! <= t[2]! && t[2]! < t[3]!;
  const warn = Number.isFinite(v.warnMin) ? Math.min(120, Math.max(1, Math.round(v.warnMin))) : DEFAULT_SCHEDULE.warnMin;
  const target = Number.isFinite(v.kpiTarget) ? Math.min(100000, Math.max(1, Math.round(v.kpiTarget))) : DEFAULT_SCHEDULE.kpiTarget;
  return ok ? { ...v, warnMin: warn, kpiTarget: target } : { ...DEFAULT_SCHEDULE, warnMin: warn, kpiTarget: target };
}

const at = (d: Date, minutes: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate(), Math.floor(minutes / 60), minutes % 60, 0, 0);
const nameOf = (d: Date, slot: Slot) => `${MONTHS[d.getMonth()]}${d.getDate()}${slot}`;

/** Ca của thời điểm `now`. OT của buổi sáng sớm (trước giờ vào ca sáng) thuộc OT của ngày hôm trước. */
export function slotAt(now: Date, sch: Schedule = DEFAULT_SCHEDULE): SlotInfo {
  const s = normalizeSchedule(sch);
  const m = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
  const amS = parse(s.amStart), amE = parse(s.amEnd), pmS = parse(s.pmStart), pmE = parse(s.pmEnd);
  if (m >= amS && m < amE) return { slot: 'AM', name: nameOf(now, 'AM'), start: at(now, amS), end: at(now, amE) };
  if (m >= pmS && m < pmE) return { slot: 'PM', name: nameOf(now, 'PM'), start: at(now, pmS), end: at(now, pmE) };
  const day = m < amS ? new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1) : now;
  return { slot: 'OT', name: nameOf(day, 'OT'), start: null, end: null };
}

export interface ShiftWarning { minutesLeft: number; slot: Slot; name: string; endsAt: Date }

/** Còn ≤ warnMin phút là hết ca sáng / chiều thì trả thông tin cảnh báo; ngoài ra (và OT) trả null. */
export function endWarning(now: Date, sch: Schedule = DEFAULT_SCHEDULE): ShiftWarning | null {
  const s = normalizeSchedule(sch);
  const info = slotAt(now, s);
  if (!info.end || info.slot === 'OT') return null;
  const left = Math.ceil((info.end.getTime() - now.getTime()) / 60000);
  return left >= 0 && left <= s.warnMin ? { minutesLeft: left, slot: info.slot, name: info.name, endsAt: info.end } : null;
}

/** Số phút còn lại của ca sáng / chiều (null với OT). */
export function minutesLeft(now: Date, sch: Schedule = DEFAULT_SCHEDULE): number | null {
  const info = slotAt(now, sch);
  return info.end ? Math.max(0, Math.ceil((info.end.getTime() - now.getTime()) / 60000)) : null;
}

export const SLOT_LABEL: Record<Slot, string> = { AM: 'ca sáng', PM: 'ca chiều', OT: 'OT' };
