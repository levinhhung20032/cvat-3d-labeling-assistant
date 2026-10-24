import { useSyncExternalStore } from 'react';
import { kv } from './storage';
import { parseQc, qcKey, QC_MAX_LEN } from '../shared/qc';

/** Ghi chú QC theo (job, ID, frame) và công tắc QC mode, lưu cục bộ trong extension (không rời máy trừ khi bấm xuất Excel). */
const NOTES_KEY = 'cvla-qc';
const MODE_KEY = 'cvla-qc-mode';

let notes: Record<string, string> = parseQc(kv.get(NOTES_KEY));
let mode = kv.get(MODE_KEY) === '1';
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

export const useQcNotes = () => useSyncExternalStore(subscribe, () => notes);
export const useQcMode = () => useSyncExternalStore(subscribe, () => mode);

export const qcStore = {
  setMode(on: boolean) {
    mode = on;
    try { kv.set(MODE_KEY, on ? '1' : '0'); } catch { /* bỏ qua */ }
    emit();
  },
  /** Ghi chú rỗng = xóa ghi chú. */
  set(jobId: number, num: number, frame: number, text: string) {
    const key = qcKey(jobId, num, frame);
    const next = { ...notes };
    const t = text.slice(0, QC_MAX_LEN);
    if (t.trim()) next[key] = t; else delete next[key];
    notes = next;
    try { kv.set(NOTES_KEY, JSON.stringify(next)); } catch { /* bỏ qua */ }
    emit();
  },
};
