/**
 * Ký hiệu hiển thị của các loại lỗi (chỉnh được ở tab Threshold). Mã nội bộ (khoá bỏ qua, so với file QC…) không đổi; chỉ chữ hiện ra đổi.
 * M = "đi xa bất thường" hiện là Y; P = ít điểm trong box; W (hiện chữ T) = outside ở giữa: frame ít điểm nằm giữa hai frame không ít điểm.
 * Trôi box (T), đáy lơ lửng / chìm (G), outside liên tục (X) mặc định CHƯA có ký hiệu (NULL = rỗng, chỉ cảnh báo bằng chữ); người dùng có thể điền 1–3 ký tự khi cần, để trống là NULL.
 */
export const SYMBOL_KINDS = ['S', 'K', 'Z', 'H', 'D', 'O', 'W', 'M', 'P', 'T', 'G', 'X'] as const;
export type SymbolKind = (typeof SYMBOL_KINDS)[number];
export const SYMBOL_DEFAULTS: Record<SymbolKind, string> = { S: 'S', K: 'K', Z: 'Z', H: 'H', D: 'D', O: 'O', W: 'T', M: 'Y', P: 'P', T: '', G: '', X: '' };
/** Loại lỗi được phép để trống (NULL = chưa có ký hiệu). */
export const NULLABLE_KINDS: readonly SymbolKind[] = ['T', 'G', 'X'];

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
