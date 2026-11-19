import { useSyncExternalStore } from 'react';
import { parseSymbols, symbolOf, validSymbol, SYMBOL_DEFAULTS, type SymbolKind, type SymbolMap } from '../shared/symbols';
import { kv, whenStorageReady } from './storage';

/** Ký hiệu lỗi do người dùng đặt (tab Threshold), lưu cục bộ trong extension. */
const KEY = 'cvla-symbols';
const read = (): SymbolMap => { try { return parseSymbols(JSON.parse(kv.get(KEY) ?? 'null')); } catch { return {}; } };
let map: SymbolMap = read();
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
const save = () => { try { if (Object.keys(map).length) kv.set(KEY, JSON.stringify(map)); else kv.remove(KEY); } catch { /* bỏ qua */ } emit(); };

/** Ký hiệu hiện ra của một loại lỗi (mã nội bộ S K Z H D O T M P). */
export const sym = (kind: string): string => symbolOf(map, kind);
/** Như `sym` nhưng loại lỗi chưa có mã (NULL: trôi box, đáy lơ lửng / chìm, outside liên tục) hiện bằng chữ thay vì để trống. */
const NULL_NAMES: Record<string, string> = { G: 'đáy lơ lửng / chìm' };
export const symLabel = (kind: string): string => sym(kind) || NULL_NAMES[kind] || kind;

export const symbolStore = {
  /** Trả false nếu ký hiệu không hợp lệ (1–3 ký tự, không trùng loại khác). */
  set(kind: SymbolKind, value: string): boolean {
    const v = value.trim();
    if (!validSymbol(map, kind, v)) return false;
    const next = { ...map };
    if (v === SYMBOL_DEFAULTS[kind]) delete next[kind]; else next[kind] = v;
    map = next;
    save();
    return true;
  },
  all(): SymbolMap { return { ...map }; },
  /** Thay toàn bộ (nạp setting); giá trị hỏng / trùng bị bỏ. */
  replace(m: unknown) { map = parseSymbols(m); save(); },
  reset(kind?: SymbolKind) { if (kind) { const n = { ...map }; delete n[kind]; map = n; } else map = {}; save(); },
};

/** Vẽ lại khi ký hiệu đổi. */
export const useSymbols = () => useSyncExternalStore(subscribe, () => map);

whenStorageReady(() => { map = read(); emit(); });
