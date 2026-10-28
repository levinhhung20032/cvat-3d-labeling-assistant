import { useSyncExternalStore } from 'react';
import { kv, whenStorageReady } from './storage';

/**
 * Sổ ghi các object (track) do CHÍNH TOOL tạo ra, theo job: ID database của chúng. Chỉ những ID trong sổ này mới được phép xóa
 * bằng tool; object có sẵn trên server (không có trong sổ) không bao giờ xóa được. Lưu cục bộ trong extension.
 */
const keyOf = (jobId: number) => `cvla-made:${jobId}`;
const cache = new Map<number, number[]>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const EMPTY: number[] = [];
whenStorageReady(() => { cache.clear(); emit(); }); // bỏ mọi giá trị đọc trước khi kho sẵn sàng (sổ này quyết định quyền xóa)

function read(jobId: number): number[] {
  const hit = cache.get(jobId);
  if (hit) return hit;
  let ids: number[] = EMPTY;
  try {
    const v = JSON.parse(kv.get(keyOf(jobId)) ?? '[]') as unknown;
    if (Array.isArray(v)) ids = v.filter((x): x is number => Number.isInteger(x));
  } catch { /* bỏ qua */ }
  cache.set(jobId, ids);
  return ids;
}
const write = (jobId: number, ids: number[]) => {
  cache.set(jobId, ids);
  try { kv.set(keyOf(jobId), JSON.stringify(ids)); } catch { /* bỏ qua */ }
  emit();
};

export const madeStore = {
  ids: (jobId: number) => read(jobId),
  add(jobId: number, ids: number[]) { write(jobId, [...new Set([...read(jobId), ...ids])]); },
  remove(jobId: number, ids: number[]) { const s = new Set(ids); write(jobId, read(jobId).filter((i) => !s.has(i))); },
};
export const useMadeIds = (jobId: number) => useSyncExternalStore(subscribe, () => read(jobId));
