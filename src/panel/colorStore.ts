import { useSyncExternalStore } from 'react';
import { DEFAULT_COLORS, isHex, parseColors, type ColorSettings } from '../shared/colors';
import { kv, whenStorageReady } from './storage';
import { currentColors, setColors, subscribeColors } from './colorState';

export { getColors, withColors } from './colorState';

/** Màu hiển thị do người dùng chọn ở tab Màu sắc, lưu cục bộ trong extension. Chỉ đổi khi bấm Lưu. */
const KEY = 'cvla-colors';
const read = (): ColorSettings => {
  try {
    const raw = kv.get(KEY);
    if (raw !== null) return parseColors(JSON.parse(raw));
    // Chưa từng lưu màu: lấy màu point cũ trong cvla-prefs (trước đây chỉnh ở nhóm Hiển thị).
    const old = (JSON.parse(kv.get('cvla-prefs') ?? '{}') as { ptColor?: unknown }).ptColor;
    return isHex(old) ? { ...DEFAULT_COLORS, point: old.toLowerCase() } : { ...DEFAULT_COLORS };
  } catch { return { ...DEFAULT_COLORS }; }
};
setColors(read());

export const colorStore = {
  get: (): ColorSettings => currentColors(),
  save(c: ColorSettings) {
    const next = parseColors(c);
    try { kv.set(KEY, JSON.stringify(next)); } catch { /* bỏ qua */ }
    setColors(next);
  },
  reset() {
    try { kv.remove(KEY); } catch { /* bỏ qua */ }
    setColors({ ...DEFAULT_COLORS });
  },
};

/** Vẽ lại khi màu đã lưu đổi. */
export const useColors = () => useSyncExternalStore(subscribeColors, currentColors);

whenStorageReady(() => setColors(read()));
