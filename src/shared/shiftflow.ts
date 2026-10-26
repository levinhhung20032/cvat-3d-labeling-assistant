import { slotAt, type Schedule, type SlotInfo } from './schedule';
import { uniqueShiftName, type Shift } from './shift';

/** Trạng thái ca: ca đang chạy và lịch sử. Hàm thuần (không đụng bộ nhớ) để kiểm thử logic vào / ra ca tự động. */
export interface ShiftState { active: Shift | null; history: Shift[] }
export const MAX_HISTORY = 60;

const baseName = (n: string) => n.replace(/#\d+$/, '');

export const newShift = (st: ShiftState, info: SlotInfo, now: Date): Shift => ({
  name: uniqueShiftName(info.name, [...st.history.map((h) => h.name), ...(st.active ? [st.active.name] : [])]),
  slot: info.slot,
  start: (info.start ?? now).toISOString(), end: null, endAt: info.end?.toISOString(),
  uploads: [], accepted: 0, ignored: 0, edits: 0, touched: [],
});

/** Đóng ca đang chạy: ca sáng / chiều hết đúng giờ theo lịch (nếu đã qua), OT hết ở thao tác cuối. */
export function closeActive(st: ShiftState, now: Date): ShiftState {
  const a = st.active;
  if (!a) return st;
  const end = a.endAt && new Date(a.endAt) <= now ? a.endAt : a.slot === 'OT' ? (a.lastActivity ?? a.start) : (a.lastActivity ?? now.toISOString());
  return { active: null, history: [{ ...a, end }, ...st.history].slice(0, MAX_HISTORY) };
}

/**
 * Tự vào / ra ca theo lịch: sang ca khác thì đóng ca cũ; đang trong ca sáng / chiều mà chưa có ca thì tự mở.
 * OT không tự mở khi chưa có thao tác nào (mở lúc có thao tác đầu tiên, xem `recordActivity`).
 */
export function syncShifts(st: ShiftState, now: Date, sch: Schedule): ShiftState {
  const info = slotAt(now, sch);
  let next = st;
  if (next.active && baseName(next.active.name) !== info.name) next = closeActive(next, now);
  if (!next.active && info.slot !== 'OT') next = { ...next, active: newShift(next, info, now) };
  return next;
}

/** Ghi một hoạt động vào ca hiện tại (tự mở ca OT nếu đang ngoài giờ) và cập nhật mốc thao tác cuối. */
export function recordActivity(st: ShiftState, now: Date, sch: Schedule, fn: (s: Shift) => Shift): ShiftState {
  let next = syncShifts(st, now, sch);
  if (!next.active) next = { ...next, active: newShift(next, slotAt(now, sch), now) };
  return { ...next, active: { ...fn(next.active!), lastActivity: now.toISOString() } };
}
