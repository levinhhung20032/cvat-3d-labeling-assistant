import { DEFAULT_COLORS, type ColorSettings } from '../shared/colors';

/** Trạng thái màu hiển thị đang dùng, không phụ thuộc storage (render.ts import file này nên chạy được trong test). colorStore.ts nạp / ghi cục bộ. */
let cur: ColorSettings = { ...DEFAULT_COLORS };
let override: ColorSettings | null = null; // chỉ dùng khi vẽ khung xem trước của tab Màu sắc
const listeners = new Set<() => void>();

export const currentColors = (): ColorSettings => cur;
export const setColors = (c: ColorSettings) => { cur = c; listeners.forEach((l) => l()); };
export const subscribeColors = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };

/** Màu đang dùng để vẽ (khung xem trước có thể tạm thay bằng màu nháp). */
export const getColors = (): ColorSettings => override ?? cur;

/** Chạy `fn` (vẽ đồng bộ) với màu nháp thay cho màu đã lưu, rồi trả lại. */
export function withColors<T>(c: ColorSettings, fn: () => T): T {
  const prev = override;
  override = c;
  try { return fn(); } finally { override = prev; }
}
