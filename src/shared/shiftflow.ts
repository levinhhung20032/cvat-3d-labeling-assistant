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

/** Dấu ca đã xoá khỏi lịch sử (`removedKey`), để gộp với bản của phiên khác không làm ca đó hiện lại. */
export const MAX_REMOVED = 200;
/** Dấu xoá: tên + giờ bắt đầu (ca mới cùng tên ở lần sau không bị lọc nhầm). */
export const removedKey = (s: Pick<Shift, 'name' | 'start'>) => `${s.name}|${s.start}`;
const later = (x?: string | null, y?: string | null) => (!x ? y ?? undefined : !y ? x : x > y ? x : y);
const upKey = (u: { time: string; jobId: number }) => `${u.time}|${u.jobId}`;

/** Gộp hai bản của CÙNG một ca (cùng tên): hợp các lần upload và object đã sửa, bộ đếm lấy lớn hơn, đã kết thúc ở bản nào thì là đã kết thúc. */
export function mergeShift(a: Shift, b: Shift): Shift {
  const ups = new Map(a.uploads.map((u) => [upKey(u), u]));
  for (const u of b.uploads) if (!ups.has(upKey(u))) ups.set(upKey(u), u);
  return {
    ...a,
    start: a.start < b.start ? a.start : b.start,
    end: a.end && b.end ? later(a.end, b.end)! : a.end ?? b.end,
    lastActivity: later(a.lastActivity, b.lastActivity),
    uploads: [...ups.values()].sort((x, y) => (x.time < y.time ? -1 : x.time > y.time ? 1 : 0)),
    accepted: Math.max(a.accepted, b.accepted), ignored: Math.max(a.ignored, b.ignored), edits: Math.max(a.edits, b.edits),
    touched: [...new Set([...a.touched, ...b.touched])],
    ...(a.assign || b.assign ? { assign: { ...b.assign, ...a.assign } } : {}),
  };
}

/**
 * Gộp trạng thái ca của hai phiên tool (vd hai tab CVAT, hoặc bản đang mở và bản vừa ghi xuống kho): không phiên nào ghi đè mất
 * upload / ca của phiên kia. `removed`: dấu (`removedKey`) các ca đã bị xoá khỏi lịch sử (không đưa lại). Ca đang chạy = ca chưa kết thúc mới nhất;
 * ca chưa kết thúc cũ hơn (phiên kia chưa kịp chuyển ca) đưa vào lịch sử, kết thúc ở giờ hết ca theo lịch hoặc thao tác cuối.
 */
export function mergeShiftState(a: ShiftState, b: ShiftState, removed: readonly string[] = []): ShiftState {
  const gone = new Set(removed);
  const byName = new Map<string, Shift>();
  for (const s of [a.active, ...a.history, b.active, ...b.history]) {
    if (!s || gone.has(removedKey(s))) continue;
    const prev = byName.get(s.name);
    byName.set(s.name, prev ? mergeShift(prev, s) : s);
  }
  const all = [...byName.values()].sort((x, y) => (x.start < y.start ? 1 : x.start > y.start ? -1 : 0)); // mới nhất trước
  const active = all.find((s) => !s.end) ?? null;
  const history = all.filter((s) => s !== active).map((s) => (s.end ? s : { ...s, end: s.endAt ?? s.lastActivity ?? s.start }));
  return { active, history: history.slice(0, MAX_HISTORY) };
}
