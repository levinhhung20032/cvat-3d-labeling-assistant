import { useEffect, useState } from 'react';
import { normalizeKeymap, type Keymap } from '../shared/keymap';

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
  try { return normalizeKeymap(JSON.parse(localStorage.getItem(KEY) ?? 'null')); } catch { return normalizeKeymap(null); }
};
export const saveKeymapPref = (m: Keymap) => { try { localStorage.setItem(KEY, JSON.stringify(m)); } catch { /* bỏ qua */ } };

/** Khi đang bấm phím để gán, tạm tắt bắt phím toàn cục. */
let capturing = false;
export const setCapturing = (v: boolean) => { capturing = v; };
export const isCapturing = () => capturing;

export function useKeymap(): [Keymap, (m: Keymap) => void] {
  const [map, setMap] = useState<Keymap>(loadKeymapPref);
  useEffect(() => { saveKeymapPref(map); }, [map]);
  return [map, setMap];
}
