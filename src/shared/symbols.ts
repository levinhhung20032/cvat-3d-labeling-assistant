/**
 * Ký hiệu hiển thị của các loại lỗi (chỉnh được ở tab Threshold). Mã nội bộ (khoá bỏ qua, so với file QC…) không đổi; chỉ chữ hiện ra đổi.
 * M = "đi xa bất thường" hiện là Y; P = ít điểm trong box; X (outside liên tục) hiện chữ T.
 * Trôi box (T, hiện mã Dr) có ký hiệu Dr. Đáy lơ lửng / chìm (G) mặc định CHƯA có ký hiệu (NULL = rỗng, chỉ cảnh báo bằng chữ); người dùng có thể điền 1–3 ký tự khi cần, để trống là NULL.
 */
export const SYMBOL_KINDS = ['S', 'K', 'Z', 'Z1', 'H', 'D', 'O', 'M', 'P', 'T', 'G', 'X'] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];
export const SYMBOL_DEFAULTS: Record<SymbolKind, string> = { S: 'S', K: 'K', Z: 'Z', Z1: 'Z1', H: 'H', D: 'D', O: 'O', M: 'Y', P: 'P', T: 'Dr', G: '' , X: 'T' };
/** Loại lỗi được phép để trống (NULL = chưa có ký hiệu). */
export const NULLABLE_KINDS: readonly SymbolKind[] = ['G'];

export type SymbolMap = Partial<Record<SymbolKind, string>>;
export const symbolOf = (m: SymbolMap, kind: string): string => (m as Record<string, string | undefined>)[kind] ?? (SYMBOL_DEFAULTS as Record<string, string>)[kind] ?? kind;

/** Hợp lệ: 1–3 ký tự (hoặc để trống với loại lỗi cho phép NULL) không khoảng trắng / '|' và không trùng ký hiệu đang dùng của loại lỗi khác. */
export function validSymbol(m: SymbolMap, kind: SymbolKind, value: string): boolean {
  if (value === '') return NULLABLE_KINDS.includes(kind); // NULL
  if (!/^[^\s|]{1,3}$/u.test(value)) return false;
  return SYMBOL_KINDS.every((k) => k === kind || symbolOf(m, k) !== value);
}

/** Đọc dữ liệu lưu: bỏ khoá lạ / giá trị sai / trùng. */
export function parseSymbols(raw: unknown): SymbolMap {
  const out: SymbolMap = {};
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return out;
  for (const k of SYMBOL_KINDS) {
    const v = (raw as Record<string, unknown>)[k];
    if (typeof v === 'string' && v !== SYMBOL_DEFAULTS[k] && validSymbol(out, k, v)) out[k] = v;
  }
  return out;
}
