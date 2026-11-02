export interface ActionDef { id: string; label: string; defaults: string[] }

export const ACTIONS: ActionDef[] = [
  { id: 'window.toggle', label: 'Thu nhỏ / mở lại cửa sổ tool (dùng được cả khi đang ở trang CVAT)', defaults: ['`'] },
  { id: 'win.prev', label: 'Cửa sổ frame trước', defaults: ['ArrowLeft'] },
  { id: 'win.next', label: 'Cửa sổ frame sau', defaults: ['ArrowRight'] },
  { id: 'win.first', label: 'Về cửa sổ đầu tiên (|◀)', defaults: [] },
  { id: 'win.last', label: 'Tới cửa sổ cuối cùng (▶|)', defaults: [] },
  { id: 'win.fromStart', label: '⟲ từ đầu: cửa sổ hiện quay về đầu job', defaults: [] },
  { id: 'obj.prev', label: 'Object trước (ID − 1), cửa sổ về frame đầu job', defaults: ['ArrowUp'] },
  { id: 'obj.next', label: 'Object sau (ID + 1), cửa sổ về frame đầu job', defaults: ['ArrowDown'] },
  { id: 'obj.back', label: '↶ Về object xem trước đó (đúng cửa sổ đang xem lúc rời đi)', defaults: [] },
  { id: 'sel.prev', label: 'Chọn cột frame bên trái', defaults: [','] },
  { id: 'sel.next', label: 'Chọn cột frame bên phải', defaults: ['.'] },
  { id: 'dyn.ownReset', label: '↺ theo class: bỏ công tắc Dynamic size riêng của object, quay về theo attribute / class', defaults: [] },
  { id: 'size.unify', label: 'Đồng bộ size: áp kích thước frame đang chọn cho mọi keyframe (khi Dynamic size tắt)', defaults: [] },
  { id: 'kf.toggle', label: 'Khoá / mở khoá keyframe (frame đang trỏ chuột, không trỏ thì frame đang chọn)', defaults: ['k'] },
  { id: 'kf.unlockInner', label: 'Mở khoá keyframe ở giữa Phạm vi (giữ hai đầu mút, hoàn tác được)', defaults: ['alt+k'] },
  { id: 'outside.from', label: '① Gắn keyframe outside / đưa trở lại (frame đang trỏ chuột, không trỏ thì frame đang chọn)', defaults: ['o'] },
  { id: 'outside.window', label: '② Current window: outside cho mọi frame có box trong cửa sổ đang hiển thị', defaults: ['ctrl+o'] },
  { id: 'outside.pick', label: '③ Select range: bấm tiêu đề hai cột để đặt outside cho cả khoảng (bấm lại để hủy)', defaults: ['ctrl+alt+o'] },
  { id: 'suggest.accept', label: 'Chấp nhận gợi ý sửa box (frame đang trỏ chuột; không trỏ vào frame nào thì cả cửa sổ)', defaults: ['a'] },
  { id: 'suggest.ignore', label: 'Bỏ qua gợi ý (frame đang trỏ chuột; không trỏ vào frame nào thì cả cửa sổ)', defaults: ['i'] },
  { id: 'ground.snap', label: 'Ground snap: đáy box chạm mặt đường (frame đang trỏ chuột; không trỏ vào frame nào thì cả cửa sổ)', defaults: ['g'] },
  { id: 'focus.cvat', label: 'Focus: thu nhỏ tool và zoom cận cảnh object trong CVAT', defaults: ['f'] },
  { id: 'zoom.in', label: 'Phóng to', defaults: ['+', '='] },
  { id: 'zoom.out', label: 'Thu nhỏ', defaults: ['-'] },
  { id: 'zoom.reset', label: 'Zoom về vừa object', defaults: ['0'] },
  { id: 'view.center', label: '⌖ Về giữa: đưa khung nhìn (đã dời bằng chuột phải) về giữa box', defaults: [] },
  { id: 'table.nextFlag', label: 'Bảng object: nhảy tới object có flag tiếp theo (chọn và cuộn tới dòng đó)', defaults: ['n'] },
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

/** Tổ hợp phím mà trình duyệt hoặc CVAT đã dùng: gán được nhưng phải cảnh báo. `window.toggle` là phím duy nhất còn chạy ngoài tool. */
export const RESERVED_COMBOS: Record<string, string> = {
  'ctrl+w': 'trình duyệt: đóng tab', 'ctrl+t': 'trình duyệt: mở tab', 'ctrl+n': 'trình duyệt: cửa sổ mới', 'ctrl+r': 'trình duyệt: tải lại',
  'ctrl+l': 'trình duyệt: thanh địa chỉ', 'ctrl+f': 'trình duyệt: tìm kiếm', 'ctrl+p': 'trình duyệt: in', 'ctrl+s': 'trình duyệt / CVAT: lưu',
  'F5': 'trình duyệt: tải lại', 'F11': 'trình duyệt: toàn màn hình', 'F12': 'trình duyệt: DevTools', 'alt+F4': 'đóng cửa sổ',
  'n': 'CVAT: vẽ object mới', 'd': 'CVAT: frame trước', 'Space': 'CVAT: phát', 'ctrl+shift+s': 'CVAT: lưu',
};

export interface ComboConflict { action: string | null; reserved: string | null }

/** Phím `combo` định gán cho `id` đang vướng thao tác nào của tool, hoặc phím có sẵn của trình duyệt / CVAT. */
export function conflictOf(map: Keymap, id: string, combo: string): ComboConflict {
  const owner = actionFor(map, combo);
  return { action: owner && owner !== id ? owner : null, reserved: RESERVED_COMBOS[combo] ?? null };
}

/** Các tổ hợp đang gán cho từ 2 thao tác trở lên (dữ liệu lưu cũ hoặc sửa tay) → [combo, [action…]]. */
export function duplicateCombos(map: Keymap): [string, string[]][] {
  const by = new Map<string, string[]>();
  for (const [id, combos] of Object.entries(map)) for (const c of combos) by.set(c, [...(by.get(c) ?? []), id]);
  return [...by].filter(([, ids]) => ids.length > 1);
}
