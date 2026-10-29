import type { DynRule } from './dynrule';
import { parseRules, type Rule } from './alertRules';
import { parseSymbols, type SymbolMap } from './symbols';

/**
 * File `setting.json` RIÊNG của người dùng (xuất / nạp ở tab Threshold; KHÔNG nằm trong repo, đã ignore, không công khai): tham số kỹ thuật,
 * rule cảnh báo, ký hiệu lỗi và Dynamic size theo tên class. Extension không đóng gói con số nào: không có rule thì không cảnh báo.
 * Tên class chỉ là khoá tra cứu, chỉ dùng khi job có nhãn trùng tên (không phân biệt hoa thường); không giả định job có class nào.
 * File không có toạ độ, kích thước object hay dữ liệu nhãn.
 */
export interface DynSettings { classes: Record<string, boolean>; attrRules: Record<string, DynRule> }
export interface SettingsFile { version: 2; params: Record<string, number>; rules: Rule[]; symbols: SymbolMap; dynamicSize: DynSettings }

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Đọc setting, bỏ từng phần hỏng. Không bao giờ ném lỗi. */
export function parseSettings(raw: unknown): SettingsFile {
  const out: SettingsFile = { version: 2, params: {}, rules: [], symbols: {}, dynamicSize: { classes: {}, attrRules: {} } };
  if (!isObj(raw)) return out;
  if (isObj(raw.params)) for (const [k, v] of Object.entries(raw.params)) if (typeof v === 'number' && Number.isFinite(v)) out.params[k] = v;
  out.rules = parseRules(raw.rules);
  out.symbols = parseSymbols(raw.symbols);
  const d = raw.dynamicSize;
  if (isObj(d)) {
    if (isObj(d.classes)) for (const [k, v] of Object.entries(d.classes)) if (typeof v === 'boolean' && k.trim()) out.dynamicSize.classes[k] = v;
    if (isObj(d.attrRules)) for (const [k, v] of Object.entries(d.attrRules)) if ((v === 'dyn' || v === 'static') && k.includes('|')) out.dynamicSize.attrRules[k] = v;
  }
  return out;
}

/** Không có setting đóng gói sẵn: Dynamic size mặc định bật cho mọi class, luật attribute rỗng. */
export const BUNDLED: SettingsFile = parseSettings(null);

const norm = (s: string) => s.trim().toLowerCase();
/** Dynamic size mặc định của một class của job: theo file setting nếu có tên trùng, không thì bật. */
export function dynDefaultFor(label: string, s: DynSettings = BUNDLED.dynamicSize): boolean {
  const n = norm(label);
  for (const [k, v] of Object.entries(s.classes)) if (norm(k) === n) return v;
  return true;
}
/** Luật attribute mặc định (bản sao). */
export const defaultAttrRules = (): Record<string, DynRule> => ({ ...BUNDLED.dynamicSize.attrRules });

/** Trộn cấu hình Dynamic size của job hiện tại vào setting nền: chỉ các class của job (và luật của chúng) bị ghi đè, phần còn lại giữ. */
export function mergeDynSettings(base: DynSettings, jobLabels: string[], classOn: Record<string, boolean>, rules: Record<string, DynRule>): DynSettings {
  const names = new Set(jobLabels.map(norm));
  const classes: Record<string, boolean> = {};
  for (const [k, v] of Object.entries(base.classes)) if (!names.has(norm(k))) classes[k] = v;
  for (const l of jobLabels) classes[l] = classOn[l] ?? dynDefaultFor(l, base);
  const attrRules: Record<string, DynRule> = {};
  for (const [k, v] of Object.entries(base.attrRules)) if (!names.has(norm(k.split('|')[0] ?? ''))) attrRules[k] = v;
  for (const [k, v] of Object.entries(rules)) if (names.has(norm(k.split('|')[0] ?? ''))) attrRules[k] = v;
  return { classes, attrRules };
}

/** Phần của setting áp cho job: class (tên khớp nhãn của job) và luật attribute của các nhãn đó. */
export function dynForJob(s: DynSettings, jobLabels: string[]): { classes: Record<string, boolean>; attrRules: Record<string, DynRule> } {
  const classes: Record<string, boolean> = {};
  const attrRules: Record<string, DynRule> = {};
  for (const l of jobLabels) {
    for (const [k, v] of Object.entries(s.classes)) if (norm(k) === norm(l)) classes[l] = v;
    for (const [k, v] of Object.entries(s.attrRules)) if (norm(k.split('|')[0] ?? '') === norm(l)) attrRules[`${l}|${k.slice(k.indexOf('|') + 1)}`] = v;
  }
  return { classes, attrRules };
}
