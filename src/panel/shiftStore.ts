import { kv } from './storage';
import { useSyncExternalStore } from 'react';
import type { Shift, ShiftUpload } from '../shared/shift';
import { DEFAULT_SCHEDULE, normalizeSchedule, type Schedule } from '../shared/schedule';
import { recordActivity, syncShifts } from '../shared/shiftflow';

/** Ca làm việc và danh sách "bỏ qua gợi ý", lưu cục bộ trong trình duyệt (localStorage của extension, không rời máy). */
interface State { active: Shift | null; history: Shift[] }
const KEY = 'cvla-shifts';

const load = (): State => {
  try {
    const raw = JSON.parse(kv.get(KEY) ?? 'null') as State | null;
    if (raw && Array.isArray(raw.history)) return { active: raw.active ?? null, history: raw.history };
  } catch { /* bỏ qua */ }
  return { active: null, history: [] };
};

let state: State = load();
const listeners = new Set<() => void>();
const commit = (next: State) => {
  state = next;
  try { kv.set(KEY, JSON.stringify(next)); } catch { /* bỏ qua */ }
  listeners.forEach((l) => l());
};
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const snapshot = () => state;
export const useShifts = () => useSyncExternalStore(subscribe, snapshot);

/** Ghi một hoạt động vào ca hiện tại (tự mở ca OT nếu đang ngoài giờ), cập nhật mốc thao tác cuối. */
const withActive = (fn: (s: Shift) => Shift) => commit(recordActivity(state, new Date(), schedule, fn));

// ---------- lịch ca tự động ----------
const SCHEDULE_KEY = 'cvla-schedule';
let schedule: Schedule = (() => { try { return normalizeSchedule(JSON.parse(kv.get(SCHEDULE_KEY) ?? 'null') as Partial<Schedule> | null); } catch { return DEFAULT_SCHEDULE; } })();
const schedListeners = new Set<() => void>();
const schedSubscribe = (cb: () => void) => { schedListeners.add(cb); return () => { schedListeners.delete(cb); }; };
export const useSchedule = () => useSyncExternalStore(schedSubscribe, () => schedule);
export const getSchedule = () => schedule;
export function setSchedule(next: Partial<Schedule>) {
  schedule = normalizeSchedule({ ...schedule, ...next });
  try { kv.set(SCHEDULE_KEY, JSON.stringify(schedule)); } catch { /* bỏ qua */ }
  schedListeners.forEach((l) => l());
}

export const shiftStore = {
  /** Tự vào / ra ca theo lịch (gọi định kỳ và trước mỗi lần ghi nhận hoạt động). */
  sync(now = new Date()): void {
    const next = syncShifts(state, now, schedule);
    if (next !== state) commit(next);
  },
  edit(jobId: number, num: number) {
    withActive((s) => ({ ...s, edits: s.edits + 1, touched: s.touched.includes(`${jobId}:${num}`) ? s.touched : [...s.touched, `${jobId}:${num}`] }));
  },
  accepted(jobId: number, num: number) {
    withActive((s) => ({ ...s, accepted: s.accepted + 1, touched: s.touched.includes(`${jobId}:${num}`) ? s.touched : [...s.touched, `${jobId}:${num}`] }));
  },
  ignored() { withActive((s) => ({ ...s, ignored: s.ignored + 1 })); },
  upload(u: ShiftUpload) { withActive((s) => ({ ...s, uploads: [...s.uploads, u] })); },
  remove(name: string) { commit({ ...state, history: state.history.filter((h) => h.name !== name) }); },
};

// ---------- bỏ qua gợi ý ----------
const IGN_KEY = 'cvla-ignore';
let ignored: Set<string> = (() => {
  try { return new Set<string>(JSON.parse(kv.get(IGN_KEY) ?? '[]') as string[]); } catch { return new Set<string>(); }
})();
const ignListeners = new Set<() => void>();
const ignSubscribe = (cb: () => void) => { ignListeners.add(cb); return () => { ignListeners.delete(cb); }; };
const ignSnapshot = () => ignored;
export const useIgnored = () => useSyncExternalStore(ignSubscribe, ignSnapshot);
export const ignoreKey = (jobId: number, num: number, frame: number) => `${jobId}:${num}:${frame}`;
/** Khóa bỏ qua cảnh báo "đi xa bất thường" (tách với bỏ qua gợi ý sửa box). */
/** Khóa bỏ qua gợi ý attribute: tĩnh → cả track (frame = null); đổi theo frame → từng frame. */
export const attrKey = (jobId: number, num: number, specId: number, frame: number | null) => `a:${jobId}:${num}:${specId}:${frame ?? 't'}`;
/** Khóa bỏ qua cảnh báo chồng lấn của một cặp object (a < b; áp cho mọi frame). */
export const overlapKey = (jobId: number, a: number, b: number) => `o:${jobId}:${Math.min(a, b)}:${Math.max(a, b)}`;
/** Khóa bỏ qua một cảnh báo luật QC (S/K/Z/H/D) ở một frame. */
export const issueKey = (jobId: number, num: number, frame: number, kind: string) => `q:${jobId}:${num}:${frame}:${kind}`;
export const motionKey = (jobId: number, num: number, frame: number) => `m:${jobId}:${num}:${frame}`;
export const ignoreStore = {
  set(keys: string[], on: boolean) {
    const next = new Set(ignored);
    for (const k of keys) { if (on) next.add(k); else next.delete(k); }
    ignored = next;
    try { kv.set(IGN_KEY, JSON.stringify([...next].slice(-5000))); } catch { /* bỏ qua */ }
    ignListeners.forEach((l) => l());
  },
};
