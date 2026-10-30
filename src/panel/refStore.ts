import { useSyncExternalStore } from 'react';
import { parseRefState, REF_OFF, type RefState } from '../shared/reflect';
import { kv, whenStorageReady } from './storage';

/**
 * Reflection mode theo từng object (job + số thứ tự object, như công tắc Dynamic size riêng), lưu cục bộ theo máy chủ.
 * Chỉ lưu công tắc, cách chọn mặt phản chiếu và độ cao tự chỉnh; không lưu dữ liệu nhãn hay điểm.
 */
const keyOf = (jobId: number, num: number) => `cvla-ref:${jobId}:${num}`;
const cache = new Map<string, RefState>();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
whenStorageReady(() => { cache.clear(); emit(); });

function read(jobId: number, num: number): RefState {
  const k = keyOf(jobId, num);
  const hit = cache.get(k);
  if (hit) return hit;
  let s = REF_OFF;
  try { const raw = kv.get(k); if (raw) s = parseRefState(JSON.parse(raw)); } catch { /* hỏng: tắt */ }
  cache.set(k, s);
  return s;
}

export const refStore = {
  get: read,
  set(jobId: number, num: number, patch: Partial<RefState>) {
    const s = { ...read(jobId, num), ...patch };
    const k = keyOf(jobId, num);
    cache.set(k, s);
    try {
      if (!s.on && s.mode === 'bottom' && s.dh === 0 && !s.dismissed) kv.remove(k); else kv.set(k, JSON.stringify(s));
    } catch { /* bỏ qua */ }
    emit();
  },
};
export const useRefState = (jobId: number, num: number | null) =>
  useSyncExternalStore(subscribe, () => (num === null ? REF_OFF : read(jobId, num)));
