import { useSyncExternalStore } from 'react';
import { kv } from './storage';
import { flagKey, type FlagMark, type QcFlag, type QcImport } from '../shared/qcimport';

/** Flag nhập từ file QC (theo job) và đánh dấu ignore / fixed của từng flag. Lưu cục bộ trong extension, không gửi đi đâu. */
const IMP_KEY = 'cvla-qcimp';
const MARK_KEY = 'cvla-qcmarks';

const readJson = <T,>(key: string, fallback: T, ok: (v: unknown) => boolean): T => {
  try { const v = JSON.parse(kv.get(key) ?? 'null') as unknown; return ok(v) ? (v as T) : fallback; } catch { return fallback; }
};
const isObj = (v: unknown) => !!v && typeof v === 'object' && !Array.isArray(v);

let imports: Record<string, QcImport> = readJson(IMP_KEY, {}, isObj);
let marks: Record<string, FlagMark> = readJson(MARK_KEY, {}, isObj);
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const save = () => {
  try { kv.set(IMP_KEY, JSON.stringify(imports)); kv.set(MARK_KEY, JSON.stringify(marks)); } catch { /* bỏ qua */ }
};

export const useQcImports = () => useSyncExternalStore(subscribe, () => imports);
export const useFlagMarks = () => useSyncExternalStore(subscribe, () => marks);

export const qcFlagStore = {
  setImport(jobId: number, imp: QcImport) { imports = { ...imports, [String(jobId)]: imp }; save(); emit(); },
  clearImport(jobId: number) {
    const { [String(jobId)]: _, ...rest } = imports;
    imports = rest;
    const prefix = `${jobId}:`;
    marks = Object.fromEntries(Object.entries(marks).filter(([k]) => !k.startsWith(prefix)));
    save(); emit();
  },
  /** mark = null: bỏ đánh dấu. */
  mark(jobId: number, flags: QcFlag[], mark: FlagMark | null) {
    const next = { ...marks };
    for (const f of flags) { const k = flagKey(jobId, f); if (mark) next[k] = mark; else delete next[k]; }
    marks = next;
    save(); emit();
  },
};
