import { useSyncExternalStore } from 'react';
import { kv, whenStorageReady } from './storage';

/**
 * Object đã từng xem trong Batch Review, theo job (lưu theo máy chủ): ID database của track, để bảng object gạch chân các ID đã xem.
 * Object mới trong nháp (chưa có ID database) không ghi. Chỉ lưu ID, không lưu dữ liệu nhãn.
 */
const keyOf = (jobId: number) => `cvla-seen:${jobId}`;
const MAX_IDS = 5000;
const cache = new Map<number, ReadonlySet<number>>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
whenStorageReady(() => { cache.clear(); emit(); });

function read(jobId: number): ReadonlySet<number> {
  const hit = cache.get(jobId);
  if (hit) return hit;
  let ids = new Set<number>();
  try {
    const v = JSON.parse(kv.get(keyOf(jobId)) ?? '[]') as unknown;
    if (Array.isArray(v)) ids = new Set(v.filter((x): x is number => Number.isInteger(x) && x > 0));
  } catch { /* bỏ qua */ }
  cache.set(jobId, ids);
  return ids;
}
const write = (jobId: number, ids: Set<number>) => {
  cache.set(jobId, ids);
  try { if (ids.size) kv.set(keyOf(jobId), JSON.stringify([...ids].slice(-MAX_IDS))); else kv.remove(keyOf(jobId)); } catch { /* bỏ qua */ }
  emit();
};

export const seenStore = {
  add(jobId: number, id: number) {
    if (!(id > 0) || read(jobId).has(id)) return;
    write(jobId, new Set([...read(jobId), id]));
  },
  clear(jobId: number) { write(jobId, new Set()); },
};
export const useSeen = (jobId: number) => useSyncExternalStore(subscribe, () => read(jobId));
