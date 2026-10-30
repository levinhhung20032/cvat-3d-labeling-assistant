import { kv, onExternalChange, whenStorageReady } from './storage';
import { useSyncExternalStore } from 'react';
import type { Shift, ShiftUpload } from '../shared/shift';
import { DEFAULT_SCHEDULE, normalizeSchedule, type Schedule } from '../shared/schedule';
import { MAX_REMOVED, mergeShiftState, removedKey, recordActivity, syncShifts } from '../shared/shiftflow';
import { creditAll, firstDays, retainShifts, type IdCredit } from '../shared/kpiCredit';

/** Ca làm việc và danh sách "bỏ qua gợi ý", lưu cục bộ trong trình duyệt (localStorage của extension, không rời máy). */
// removed: dấu (removedKey) các ca đã xoá khỏi lịch sử; idDays: ngày đầu tiên làm từng ID (KPI rework), giữ cả khi ca cũ bị cắt khỏi lịch sử
interface State { active: Shift | null; history: Shift[]; removed?: string[]; idDays?: Record<string, string> }
const KEY = 'cvla-shifts';

const parse = (raw: string | null): State | null => {
  try {
    const o = JSON.parse(raw ?? 'null') as State | null;
    if (o && Array.isArray(o.history)) {
      const idDays = o.idDays && typeof o.idDays === 'object' && !Array.isArray(o.idDays) ? o.idDays : {};
      return { active: o.active ?? null, history: o.history, removed: Array.isArray(o.removed) ? o.removed : [], idDays };
    }
  } catch { /* bỏ qua */ }
  return null;
};
const load = (): State => parse(kv.get(KEY)) ?? { active: null, history: [], removed: [], idDays: {} };
/** Gộp hai bản (của phiên này và của kho / phiên khác): không bản nào làm mất upload hay ca của bản kia. */
const merge = (a: State, b: State): State => {
  const removed = [...new Set([...(a.removed ?? []), ...(b.removed ?? [])])].slice(-MAX_REMOVED);
  const idDays = { ...(b.idDays ?? {}) };
  for (const [k, d] of Object.entries(a.idDays ?? {})) if (!idDays[k] || d < idDays[k]!) idDays[k] = d;
  return { ...mergeShiftState(a, b, removed), removed, idDays };
};
const MAX_ID_DAYS = 20000; // sổ ngày đầu: giữ ngần này ID gần nhất (~45 byte mỗi ID)
/**
 * Bổ sung sổ ngày đầu từ các ca hiện có (TRƯỚC khi cắt, nên ID của ca bị bỏ vẫn nằm trong sổ để nhận ra rework), rồi chỉ giữ ca của
 * hôm nay và 3 ngày đi làm gần nhất trước đó.
 */
const withDays = (st: State): State => {
  let idDays = firstDays([...(st.active ? [st.active] : []), ...st.history], schedule, st.idDays ?? {});
  const ids = Object.entries(idDays);
  if (ids.length > MAX_ID_DAYS) idDays = Object.fromEntries(ids.sort((a, b) => (a[1] < b[1] ? 1 : a[1] > b[1] ? -1 : 0)).slice(0, MAX_ID_DAYS));
  const history = retainShifts(st.history, new Date(), schedule);
  return { ...st, history, idDays };
};

let state: State = load();
let written: string | null = kv.get(KEY); // bản phiên này ghi / đọc gần nhất: kho khác bản này nghĩa là phiên khác vừa ghi
const listeners = new Set<() => void>();
const commit = (next: State) => {
  // Hai tab CVAT (hoặc phiên cũ chưa đóng) cùng ghi một khóa: gộp với bản đang có trong kho trước khi ghi, thay vì ghi đè.
  const disk = kv.get(KEY);
  const other = disk !== written ? parse(disk) : null;
  state = withDays(other ? merge(next, other) : next);
  try { written = JSON.stringify(state); kv.set(KEY, written); } catch { /* bỏ qua */ }
  listeners.forEach((l) => l());
};
// Phiên khác vừa ghi: gộp vào trạng thái đang hiện (ghi xuống ở lần ghi kế tiếp).
onExternalChange(KEY, () => {
  const other = parse(kv.get(KEY));
  if (!other) return;
  state = merge(state, other);
  written = kv.get(KEY);
  listeners.forEach((l) => l());
});
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const snapshot = () => state;
export const useShifts = () => useSyncExternalStore(subscribe, snapshot);

/** Ghi một hoạt động vào ca hiện tại (tự mở ca OT nếu đang ngoài giờ), cập nhật mốc thao tác cuối. */
const withActive = (fn: (s: Shift) => Shift) => commit(recordActivity(state, new Date(), schedule, fn));

// ---------- lịch ca tự động ----------
const SCHEDULE_KEY = 'cvla-schedule';
const loadSchedule = (): Schedule => { try { return normalizeSchedule(JSON.parse(kv.get(SCHEDULE_KEY) ?? 'null') as Partial<Schedule> | null); } catch { return DEFAULT_SCHEDULE; } };
let schedule: Schedule = loadSchedule();
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
  /** Dồn KPI của các ID mà ca `name` (OT) sở hữu: ID → ca nhận (null = giữ ở ca này). Ghi đè phân bổ cũ của các ID được nêu. */
  assign(name: string, mapping: Record<string, string | null>) {
    const fix = (x: Shift): Shift => {
      if (x.name !== name) return x;
      const next = { ...(x.assign ?? {}) };
      for (const [k, to] of Object.entries(mapping)) { if (to && to !== name) next[k] = to; else delete next[k]; }
      return { ...x, assign: next };
    };
    commit({ ...state, active: state.active ? fix(state.active) : null, history: state.history.map(fix) });
  },
  /** Bỏ mọi phân bổ của ca `name`: KPI về lại ca đó. */
  unassign(name: string) {
    const fix = (x: Shift): Shift => (x.name === name ? { ...x, assign: {} } : x);
    commit({ ...state, active: state.active ? fix(state.active) : null, history: state.history.map(fix) });
  },
  remove(name: string) { commit({ ...state, history: state.history.filter((h) => h.name !== name), removed: [...(state.removed ?? []), ...state.history.filter((h) => h.name === name).map(removedKey)] }); },
};

// ---------- bỏ qua gợi ý ----------
const IGN_KEY = 'cvla-ignore';
const loadIgnored = (): Set<string> => {
  try { return new Set<string>(JSON.parse(kv.get(IGN_KEY) ?? '[]') as string[]); } catch { return new Set<string>(); }
};
let ignored: Set<string> = loadIgnored();
const ignListeners = new Set<() => void>();
// Chế độ nhúng: module có thể được nạp TRƯỚC khi kho extension sẵn sàng (content script gộp một file) → nạp lại khi sẵn sàng,
// không thì lần ghi đầu tiên sẽ ghi đè dữ liệu thật bằng trạng thái rỗng.
whenStorageReady(() => {
  schedule = loadSchedule();
  state = withDays(load()); // bỏ ca cũ hơn 3 ngày đi làm ngay khi nạp (ghi xuống ở lần ghi kế tiếp)
  written = kv.get(KEY);
  ignored = loadIgnored();
  listeners.forEach((l) => l());
  schedListeners.forEach((l) => l());
  ignListeners.forEach((l) => l());
});
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

// ---------- KPI ghi cho từng ca (gộp theo ngày, rework, dồn OT) ----------
let creditCache: { st: State; sch: Schedule; v: IdCredit[] } | null = null;
/** KPI theo ID của mọi ca (tính lại khi ca hoặc lịch đổi). */
export function getCredits(): IdCredit[] {
  if (creditCache && creditCache.st === state && creditCache.sch === schedule) return creditCache.v;
  const all = [...(state.active ? [state.active] : []), ...state.history];
  const v = creditAll(all, firstDays(all, schedule, state.idDays ?? {}), schedule);
  creditCache = { st: state, sch: schedule, v };
  return v;
}
export const useCredits = () => { useShifts(); useSchedule(); return getCredits(); };
