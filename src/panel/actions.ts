import { kv } from './storage';
import { useEffect, useState, useSyncExternalStore } from 'react';
import { normalizeKeymap, prettyCombo, type Keymap } from '../shared/keymap';

/** Bus nhỏ: App bắt phím theo keymap rồi phát action; các màn hình đăng ký xử lý. */
type Handler = (id: string) => void;
const handlers = new Set<Handler>();
export const onAction = (h: Handler) => {
  handlers.add(h);
  return () => { handlers.delete(h); };
};
export const emitAction = (id: string) => handlers.forEach((h) => h(id));

// --- keymap lưu cục bộ (chỉ là tiện ích của người dùng) ---
const KEY = 'cvla-keymap';
export const loadKeymapPref = (): Keymap => {
  try { return normalizeKeymap(JSON.parse(kv.get(KEY) ?? 'null')); } catch { return normalizeKeymap(null); }
};
export const saveKeymapPref = (m: Keymap) => { try { kv.set(KEY, JSON.stringify(m)); } catch { /* bỏ qua */ } };

/** Khi đang bấm phím để gán, tạm tắt bắt phím toàn cục. */
let capturing = false;
export const setCapturing = (v: boolean) => { capturing = v; };
export const isCapturing = () => capturing;

// Keymap hiện hành cho các màn hình chỉ cần đọc (tooltip của nút); App giữ bản gốc qua useKeymap.
let current: Keymap | null = null;
const keySubs = new Set<() => void>();
const subscribeKeys = (f: () => void) => { keySubs.add(f); return () => { keySubs.delete(f); }; };
const currentKeymap = () => (current ??= loadKeymapPref());

// App giữ keymap (useKeymap); màn hình khác (menu chuột phải ở Batch Review) đổi phím qua applyKeymap.
let externalSet: ((m: Keymap) => void) | null = null;
export const applyKeymap = (m: Keymap): boolean => { if (!externalSet) return false; externalSet(m); return true; };
/** Keymap hiện hành, tự vẽ lại khi đổi. */
export const useCurrentKeymap = (): Keymap => useSyncExternalStore(subscribeKeys, currentKeymap);

export function useKeymap(): [Keymap, (m: Keymap) => void] {
  const [map, setMap] = useState<Keymap>(loadKeymapPref);
  useEffect(() => { saveKeymapPref(map); current = map; keySubs.forEach((f) => f()); }, [map]);
  useEffect(() => { externalSet = setMap; return () => { if (externalSet === setMap) externalSet = null; }; }, [setMap]);
  return [map, setMap];
}

/** Phím đang gán cho thao tác, dễ đọc ("Ctrl+O / K"); chưa gán → null. */
export function useKeyOf(): (id: string) => string | null {
  const map = useSyncExternalStore(subscribeKeys, currentKeymap);
  return (id) => ((map[id] ?? []).length ? map[id]!.map(prettyCombo).join(' / ') : null);
}

/** Tooltip của nút: mô tả chức năng + phím tắt đang gán. Tên nút không ghi phím. */
// Tooltip → mã thao tác: menu chuột phải tìm thao tác của nút từ chính tooltip của nó (mọi nút dùng hint() đều gán phím được).
const titleIds = new Map<string, string>();
export const actionOfTitle = (title: string): string | null => titleIds.get(title) ?? null;
export function useKeyHint(): (id: string, tip: string) => string {
  const keyOf = useKeyOf();
  return (id, tip) => {
    const s = `${tip}\nPhím tắt: ${keyOf(id) ?? 'chưa gán (chuột phải vào nút hoặc dùng tab Phím tắt để gán)'}`;
    if (titleIds.size > 5000) titleIds.clear(); // hint() chạy lại ở mỗi lần vẽ nên bản ghi tự dựng lại
    titleIds.set(s, id);
    return s;
  };
}
