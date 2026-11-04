import { useSyncExternalStore } from 'react';
import { kv, whenStorageReady } from './storage';
export { deletableIds } from '../shared/lockIds';

/**
 * Khóa danh sách ID gốc (chủ dự án yêu cầu 2026-11-04), theo job: ảnh chụp các ID database có trên server lúc bấm khóa.
 * ID trong danh sách khóa không bao giờ xóa được bằng tool (chỉ chỉnh sửa). Khi đã khóa, object có trên server nhưng KHÔNG nằm trong
 * danh sách (vẽ tay trên CVAT sau khi khóa) cũng được coi là object ngoài và được phép xóa, giống object do tool tạo.
 * Chưa khóa → hành vi cũ: chỉ object trong sổ do tool tạo mới xóa được.
 */
const keyOf = (jobId: number) => `cvla-lock:${jobId}`;
const cache = new Map<number, number[] | null>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
whenStorageReady(() => { cache.clear(); emit(); });

function read(jobId: number): number[] | null {
  if (cache.has(jobId)) return cache.get(jobId)!;
  let ids: number[] | null = null;
  try {
    const raw = kv.get(keyOf(jobId));
    const v = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(v)) ids = v.filter((x): x is number => Number.isInteger(x));
  } catch { /* bỏ qua */ }
  cache.set(jobId, ids);
  return ids;
}
const write = (jobId: number, ids: number[] | null) => {
  cache.set(jobId, ids);
  try { if (ids) kv.set(keyOf(jobId), JSON.stringify(ids)); else kv.remove(keyOf(jobId)); } catch { /* bỏ qua */ }
  emit();
};

export const lockStore = {
  ids: (jobId: number) => read(jobId),
  lock(jobId: number, ids: number[]) { write(jobId, [...new Set(ids)].sort((a, b) => a - b)); },
  unlock(jobId: number) { write(jobId, null); },
};
export const useLockedIds = (jobId: number) => useSyncExternalStore(subscribe, () => read(jobId));
