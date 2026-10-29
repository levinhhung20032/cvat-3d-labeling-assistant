import { useSyncExternalStore } from 'react';
import type { ClassSize } from '../shared/qcrules';
import { applyPersisted, cloneClassSize, DIMS, setObjectOverrides, toPersisted, validRange } from '../shared/thresholds';
import { kv, whenStorageReady } from './storage';

/**
 * Ngưỡng cảnh báo chỉnh tay (tab Threshold). Ngưỡng chung (khoảng kích thước theo class, z, đổi hướng…) lưu một bản dùng cho mọi job;
 * ngưỡng kích thước RIÊNG của từng object lưu theo job (và theo máy chủ). Chỉ lưu giá trị khác mặc định, cục bộ trong extension.
 * Mỗi lần đổi, `version` tăng để các nơi tính cảnh báo (bảng object, Batch Review…) tính lại.
 */
const KEY = 'cvla-thresholds';
const objKey = (jobId: number) => `cvla-throbj:${jobId}`;

let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** Số phiên bản ngưỡng: đưa vào phụ thuộc của mọi phép tính dùng ngưỡng. */
export const useThresholdVersion = () => useSyncExternalStore(subscribe, () => version);

let objs = new Map<number, ClassSize>();
let curJob = 0;

function persist() {
  try {
    const p = toPersisted();
    if (!Object.keys(p.n).length && !Object.keys(p.size).length && !p.sync) kv.remove(KEY);
    else kv.set(KEY, JSON.stringify(p));
  } catch { /* bỏ qua */ }
}
function persistObjs() {
  try {
    if (!curJob) return;
    if (!objs.size) kv.remove(objKey(curJob));
    else kv.set(objKey(curJob), JSON.stringify(Object.fromEntries(objs)));
  } catch { /* bỏ qua */ }
}
function readObjs(jobId: number): Map<number, ClassSize> {
  const out = new Map<number, ClassSize>();
  try {
    const o = JSON.parse(kv.get(objKey(jobId)) ?? 'null') as Record<string, Partial<ClassSize>> | null;
    if (o && typeof o === 'object') {
      for (const [k, s] of Object.entries(o)) {
        const num = Number(k);
        if (!Number.isInteger(num) || num < 1 || !s) continue;
        const ok = DIMS.every((d) => Array.isArray(s[d]) && validRange(s[d]![0], s[d]![1]));
        if (ok) out.set(num, cloneClassSize(s as ClassSize));
      }
    }
  } catch { /* bỏ qua */ }
  return out;
}

export const thresholdStore = {
  /** Nạp ngưỡng chung đã lưu (gọi khi kho sẵn sàng). */
  load() {
    try { applyPersisted(JSON.parse(kv.get(KEY) ?? 'null')); } catch { applyPersisted(null); }
    bump();
  },
  /** Gọi sau mỗi lần sửa ngưỡng chung (đã ghi vào cấu hình): lưu và báo các nơi tính lại. */
  changed() { persist(); bump(); },
  /** Chuyển sang job khác: nạp ngưỡng riêng theo object của job đó. */
  setJob(jobId: number) {
    if (jobId === curJob) return;
    curJob = jobId;
    objs = readObjs(jobId);
    setObjectOverrides(objs);
    bump();
  },
  objects: (): ReadonlyMap<number, ClassSize> => objs,
  /** Đặt (hoặc bỏ, với null) ngưỡng kích thước riêng của object `num` ở job hiện tại. */
  setObject(num: number, size: ClassSize | null) {
    const next = new Map(objs);
    if (size) next.set(num, cloneClassSize(size)); else next.delete(num);
    objs = next;
    setObjectOverrides(objs);
    persistObjs();
    bump();
  },
};

whenStorageReady(() => thresholdStore.load());
