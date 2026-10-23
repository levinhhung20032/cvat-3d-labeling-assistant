export interface ActionDef { id: string; label: string; defaults: string[] }

export const ACTIONS: ActionDef[] = [
  { id: 'window.toggle', label: 'Thu nhỏ / mở lại cửa sổ tool (dùng được cả khi đang ở trang CVAT)', defaults: ['`'] },
  { id: 'win.prev', label: 'Cửa sổ frame trước', defaults: ['ArrowLeft'] },
  { id: 'win.next', label: 'Cửa sổ frame sau', defaults: ['ArrowRight'] },
  { id: 'obj.prev', label: 'Object trước (ID − 1)', defaults: ['ArrowUp'] },
  { id: 'obj.next', label: 'Object sau (ID + 1)', defaults: ['ArrowDown'] },
  { id: 'sel.prev', label: 'Chọn cột frame bên trái', defaults: [','] },
  { id: 'sel.next', label: 'Chọn cột frame bên phải', defaults: ['.'] },
  { id: 'kf.toggle', label: 'Khoá / mở khoá keyframe (frame đang trỏ chuột)', defaults: ['k'] },
  { id: 'outside.from', label: 'Gắn keyframe outside / đưa trở lại (frame đang trỏ chuột)', defaults: ['o'] },
  { id: 'suggest.accept', label: 'Chấp nhận gợi ý sửa box (frame đang trỏ chuột; không trỏ vào frame nào thì cả cửa sổ)', defaults: ['a'] },
  { id: 'suggest.ignore', label: 'Bỏ qua gợi ý (frame đang trỏ chuột; không trỏ vào frame nào thì cả cửa sổ)', defaults: ['i'] },
  { id: 'ground.snap', label: 'Ground snap: đáy box chạm mặt đường (frame đang trỏ chuột; không trỏ vào frame nào thì cả cửa sổ)', defaults: ['g'] },
  { id: 'focus.cvat', label: 'Focus: thu nhỏ tool và zoom cận cảnh object trong CVAT', defaults: ['f'] },
  { id: 'zoom.in', label: 'Phóng to', defaults: ['+', '='] },
  { id: 'zoom.out', label: 'Thu nhỏ', defaults: ['-'] },
  { id: 'zoom.reset', label: 'Zoom về vừa object', defaults: ['0'] },
  { id: 'undo', label: 'Hoàn tác', defaults: ['ctrl+z'] },
  { id: 'redo', label: 'Làm lại', defaults: ['ctrl+y', 'ctrl+shift+z'] },
];

export type Keymap = Record<string, string[]>;

export const defaultKeymap = (): Keymap => Object.fromEntries(ACTIONS.map((a) => [a.id, [...a.defaults]]));

const MODIFIER_KEYS = new Set(['Control', 'Shift', 'Alt', 'Meta', 'AltGraph', 'CapsLock']);

/**
 * Chuẩn hóa một phím bấm thành chuỗi, ví dụ "ctrl+z", "shift+k", "ArrowLeft", "+".
 * Trả null nếu chỉ là phím bổ trợ. Shift chỉ được ghi khi phím là chữ cái, số hoặc phím điều hướng.
 */
export function comboOf(e: { key: string; ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }): string | null {
  if (MODIFIER_KEYS.has(e.key)) return null;
  const single = e.key.length === 1;
  const key = single ? e.key.toLowerCase() : e.key;
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('ctrl');
  if (e.metaKey) parts.push('meta');
  if (e.altKey) parts.push('alt');
  const symbol = single && !/[a-z0-9]/i.test(e.key);
  if (e.shiftKey && !symbol) parts.push('shift');
  parts.push(key === ' ' ? 'Space' : key);
  return parts.join('+');
}

export function actionFor(map: Keymap, combo: string): string | null {
  for (const [id, combos] of Object.entries(map)) if (combos.includes(combo)) return id;
  return null;
}

/** Gán `combo` cho `id`; nếu phím đang dùng cho action khác thì gỡ khỏi action đó. Trả action bị lấy phím. */
export function assign(map: Keymap, id: string, combo: string): { map: Keymap; stolenFrom: string | null } {
  const stolenFrom = actionFor(map, combo);
  const next: Keymap = {};
  for (const [k, v] of Object.entries(map)) next[k] = v.filter((c) => c !== combo);
  next[id] = [...(next[id] ?? []), combo];
  return { map: next, stolenFrom: stolenFrom && stolenFrom !== id ? stolenFrom : null };
}

export const unassign = (map: Keymap, id: string, combo: string): Keymap => ({ ...map, [id]: (map[id] ?? []).filter((c) => c !== combo) });

/** Hiển thị dễ đọc, ví dụ "Ctrl+Z", "←". */
export function prettyCombo(combo: string): string {
  const arrows: Record<string, string> = { ArrowLeft: '←', ArrowRight: '→', ArrowUp: '↑', ArrowDown: '↓' };
  return combo.split(/\+(?=.)/).map((p) => arrows[p] ?? (p.length === 1 ? p.toUpperCase() : p[0]!.toUpperCase() + p.slice(1))).join('+');
}

/** Đọc từ dữ liệu lưu: giữ action đã biết, action thiếu lấy mặc định. */
export function normalizeKeymap(raw: unknown): Keymap {
  const base = defaultKeymap();
  if (!raw || typeof raw !== 'object') return base;
  for (const a of ACTIONS) {
    const v = (raw as Record<string, unknown>)[a.id];
    if (Array.isArray(v) && v.every((x) => typeof x === 'string')) base[a.id] = v as string[];
  }
  return base;
}
