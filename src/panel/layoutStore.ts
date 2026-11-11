import { useSyncExternalStore } from 'react';
import { kv, whenStorageReady } from './storage';

/** Cách xếp các frame của Batch Review (chỉ là tuỳ chọn hiển thị, lưu cục bộ): 'h' = các frame nằm NGANG (mỗi frame một cột, 3 view xếp dọc), 'v' = các frame nằm DỌC (mỗi frame một hàng, 3 view xếp ngang). */
export type FrameLayout = 'h' | 'v';
const KEY = 'cvla-frame-layout';
const read = (): FrameLayout => { try { return kv.get(KEY) === 'v' ? 'v' : 'h'; } catch { return 'h'; } };
let cur: FrameLayout = read();
const ls = new Set<() => void>();
const set = (v: FrameLayout) => { cur = v; ls.forEach((l) => l()); };
whenStorageReady(() => set(read()));

export const layoutStore = {
  get: () => cur,
  save(v: FrameLayout) { try { kv.set(KEY, v); } catch { /* bỏ qua */ } set(v); },
};
export const useFrameLayout = (): FrameLayout => useSyncExternalStore((cb) => { ls.add(cb); return () => { ls.delete(cb); }; }, () => cur);
