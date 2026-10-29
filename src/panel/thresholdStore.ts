import { useSyncExternalStore } from 'react';
import { newRuleId, parseRules, type Rule } from '../shared/alertRules';
import { applyPersisted, installRules, toPersisted } from '../shared/thresholds';
import { kv, whenStorageReady } from './storage';

/**
 * Rule cảnh báo và tham số kỹ thuật (tab Threshold), lưu cục bộ trong extension (không rời máy, không có con số nào kèm sẵn).
 * Rule gồm cả rule theo object (gắn với job), nên lưu chung một danh sách. Mỗi lần đổi, `version` tăng để các nơi tính cảnh báo
 * (bảng object, Batch Review, QC…) tính lại, và cấu hình các bước tính được biên dịch lại từ rule.
 */
const KEY = 'cvla-thresholds';
const RULES_KEY = 'cvla-rules';

let version = 0;
const listeners = new Set<() => void>();
const bump = () => { version++; listeners.forEach((l) => l()); };
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** Số phiên bản ngưỡng: đưa vào phụ thuộc của mọi phép tính dùng ngưỡng. */
export const useThresholdVersion = () => useSyncExternalStore(subscribe, () => version);

let rules: Rule[] = [];
let curJob = 0;
const listRules = () => rules;
/** Danh sách rule (đổi tham chiếu mỗi lần thay đổi) để vẽ lại giao diện. */
export const useRules = () => useSyncExternalStore(subscribe, listRules);

function persist() {
  try {
    const p = toPersisted();
    if (!Object.keys(p.n).length) kv.remove(KEY); else kv.set(KEY, JSON.stringify(p));
    if (!rules.length) kv.remove(RULES_KEY); else kv.set(RULES_KEY, JSON.stringify(rules));
  } catch { /* bỏ qua */ }
}
const apply = () => { installRules(rules, curJob); };

export const thresholdStore = {
  /** Nạp tham số và rule đã lưu (gọi khi kho sẵn sàng). */
  load() {
    try { applyPersisted(JSON.parse(kv.get(KEY) ?? 'null')); } catch { applyPersisted(null); }
    try { rules = parseRules(JSON.parse(kv.get(RULES_KEY) ?? 'null')); } catch { rules = []; }
    apply();
    bump();
  },
  /** Gọi sau mỗi lần sửa tham số kỹ thuật (đã ghi vào cấu hình): lưu và báo các nơi tính lại. */
  changed() { persist(); apply(); bump(); },
  /** Chuyển sang job khác: rule theo object chỉ có hiệu lực ở job của nó. */
  setJob(jobId: number) {
    if (jobId === curJob) return;
    curJob = jobId;
    apply();
    bump();
  },
  jobId: () => curJob,
  rules: (): readonly Rule[] => rules,
  /** Thay toàn bộ rule (nạp setting). Rule hỏng bị bỏ. */
  setRules(next: unknown) { rules = parseRules(next); persist(); apply(); bump(); },
  /** Thêm rule; `base` cho biết mục / thuộc tính, ngưỡng để trống (chưa có hiệu lực). */
  addRule(base: Omit<Rule, 'id' | 'value'> & { value?: number | null }) {
    rules = [...rules, { ...base, id: newRuleId(), value: base.value ?? null }];
    persist(); apply(); bump();
  },
  /** Sửa rule; bản sửa không hợp lệ thì bỏ, trả false. */
  updateRule(id: string, patch: Partial<Omit<Rule, 'id'>>): boolean {
    const cur = rules.find((r) => r.id === id);
    if (!cur) return false;
    const next = { ...cur, ...patch };
    if (parseRules([next]).length !== 1) return false;
    rules = rules.map((r) => (r.id === id ? next : r));
    persist(); apply(); bump();
    return true;
  },
  removeRule(id: string) { rules = rules.filter((r) => r.id !== id); persist(); apply(); bump(); },
};

whenStorageReady(() => thresholdStore.load());
