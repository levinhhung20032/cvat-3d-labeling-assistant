import { useSyncExternalStore } from 'react';
import { kv } from './storage';
import { isFixedSize } from '../shared/suggest';

/**
 * Dynamic size theo CLASS của job: lấy danh sách class từ chính job (lần đầu mở job), mặc định tắt cho Vehicle / Obstacle,
 * bật cho các class còn lại; sau đó người dùng chỉnh ở tab "Dynamic size". Lưu cục bộ theo job.
 */
const keyOf = (jobId: number) => `cvla-dynclass:${jobId}`;
const cache = new Map<number, Record<string, boolean>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

function read(jobId: number): Record<string, boolean> | null {
  const hit = cache.get(jobId);
  if (hit) return hit;
  try {
    const v = JSON.parse(kv.get(keyOf(jobId)) ?? 'null') as unknown;
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      const m = Object.fromEntries(Object.entries(v as Record<string, unknown>).filter(([, x]) => typeof x === 'boolean')) as Record<string, boolean>;
      cache.set(jobId, m);
      return m;
    }
  } catch { /* bỏ qua */ }
  return null;
}
const write = (jobId: number, m: Record<string, boolean>) => {
  cache.set(jobId, m);
  try { kv.set(keyOf(jobId), JSON.stringify(m)); } catch { /* bỏ qua */ }
  emit();
};

export const defaultDyn = (label: string) => !isFixedSize(label);
const EMPTY: Record<string, boolean> = {};

export const dynClassStore = {
  /** Lấy class của job một lần (lần đầu mở job); các lần sau chỉ bổ sung class mới xuất hiện. */
  ensure(jobId: number, names: string[]) {
    const cur = read(jobId);
    const next = { ...(cur ?? {}) };
    let changed = !cur;
    for (const n of names) if (!(n in next)) { next[n] = defaultDyn(n); changed = true; }
    if (changed) write(jobId, next);
  },
  set(jobId: number, name: string, on: boolean) { write(jobId, { ...(read(jobId) ?? {}), [name]: on }); },
  reset(jobId: number, names: string[]) { write(jobId, Object.fromEntries(names.map((n) => [n, defaultDyn(n)]))); },
};

export const useDynClasses = (jobId: number) => useSyncExternalStore(subscribe, () => read(jobId) ?? EMPTY);
