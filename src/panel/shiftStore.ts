import { kv } from './storage';
import { useSyncExternalStore } from 'react';
import { shiftName, uniqueShiftName, type Shift, type ShiftUpload } from '../shared/shift';

/** Ca làm việc và danh sách "bỏ qua gợi ý", lưu cục bộ trong trình duyệt (localStorage của extension, không rời máy). */
interface State { active: Shift | null; history: Shift[] }
const KEY = 'cvla-shifts';
const MAX_HISTORY = 60;

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

const withActive = (fn: (s: Shift) => Shift) => {
  if (state.active) commit({ ...state, active: fn(state.active) });
};

export const shiftStore = {
  /** Vào ca: tên tự đặt theo ngày và buổi (sáng AM / chiều PM) lúc vào ca. */
  start(now = new Date()): Shift | null {
    if (state.active) return null;
    const name = uniqueShiftName(shiftName(now), state.history.map((h) => h.name));
    const s: Shift = { name, start: now.toISOString(), end: null, uploads: [], accepted: 0, ignored: 0, edits: 0, touched: [] };
    commit({ ...state, active: s });
    return s;
  },
  /** Ra ca: chốt ca, đưa vào lịch sử. */
  end(now = new Date()): Shift | null {
    const a = state.active;
    if (!a) return null;
    const done: Shift = { ...a, end: now.toISOString() };
    commit({ active: null, history: [done, ...state.history].slice(0, MAX_HISTORY) });
    return done;
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
