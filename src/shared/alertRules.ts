/**
 * Rule cảnh báo (tab Threshold). Mỗi lỗi được định nghĩa bằng các rule: chọn ĐỐI TƯỢNG (tất cả / class của job / class · attribute = giá trị /
 * một object), THUỘC TÍNH đo được, QUY TẮC xét (>, >=, <, <=, =, !=) và NGƯỠNG. Rule đúng thì báo lỗi của mục chứa nó. Không có rule thì không báo.
 * Không có con số nào được kèm sẵn: người dùng tự nhập.
 * Nhiều rule cùng thuộc tính đo và cùng chiều (>/>= hoặc </<=) cùng khớp một box: chỉ rule cụ thể nhất có hiệu lực (xem `effectiveRules`).
 */
export const BIG = 1e6;

export type Op = '>' | '>=' | '<' | '<=' | '=' | '!=';
export const ALL_OPS: Op[] = ['>', '>=', '<', '<=', '=', '!='];
export const OVER_OPS: Op[] = ['>', '>='];
export const UNDER_OPS: Op[] = ['<', '<='];

export type TargetKind = 'all' | 'class' | 'attr' | 'object';
/** attr: object thuộc class `name` có attribute `attr` = `value` (ở đúng frame đang xét nếu attribute đổi theo frame). */
export type Target = { t: 'all' } | { t: 'class'; name: string } | { t: 'attr'; name: string; attr: string; value: string } | { t: 'object'; job: number; num: number };

/** Mã mục lỗi (khoá nội bộ). Ký hiệu hiển thị chỉnh được (symbols.ts): M hiện là Y, F hiện là P. */
export type SectionCode = 'S' | 'K' | 'Z' | 'H' | 'D' | 'O' | 'T' | 'M' | 'F' | 'G' | 'X';

export type MetricId =
  | 'sizeDev' | 'length' | 'width' | 'height' | 'z' | 'yawJump' | 'distance'
  | 'iou' | 'holdFrames' | 'motionDev' | 'ptsInside' | 'ptsOutside' | 'floatGap' | 'sinkGap' | 'outsideGap';

export interface MetricDef {
  id: MetricId;
  section: SectionCode;
  label: string;
  unit: string;
  ops: Op[];
  targets: TargetKind[];
  min: number;
  max: number;
  step: number;
  int?: boolean;
  /** Đo trên từng box (tính trong trackIssues); còn lại là số liệu của các bước tính riêng, rule chỉ đặt ngưỡng cho bước đó. */
  box?: boolean;
  help?: string;
}

const BOX: TargetKind[] = ['all', 'class', 'attr', 'object'];
const AC: TargetKind[] = ['all', 'class'];
const A: TargetKind[] = ['all'];

export const METRICS: MetricDef[] = [
  { id: 'sizeDev', section: 'S', label: 'Size không đồng bộ giữa các frame (dung sai)', unit: 'm', ops: OVER_OPS, targets: BOX, min: 0, max: BIG, step: 0.005, box: true, help: 'Chỉ xét object có Dynamic size TẮT: frame có dài, rộng hoặc cao khác kích thước chung của object (trung vị các frame) quá ngưỡng thì báo. Ngưỡng là dung sai, ví dụ 0.01 m.' },
  { id: 'length', section: 'K', label: 'Dài (L)', unit: 'm', ops: ALL_OPS, targets: BOX, min: 0, max: BIG, step: 0.05, box: true },
  { id: 'width', section: 'K', label: 'Rộng (W)', unit: 'm', ops: ALL_OPS, targets: BOX, min: 0, max: BIG, step: 0.05, box: true },
  { id: 'height', section: 'K', label: 'Cao (H)', unit: 'm', ops: ALL_OPS, targets: BOX, min: 0, max: BIG, step: 0.05, box: true },
  { id: 'z', section: 'Z', label: 'z của tâm box', unit: 'm', ops: ALL_OPS, targets: BOX, min: -BIG, max: BIG, step: 0.1, box: true },
  { id: 'yawJump', section: 'H', label: 'Yaw đổi so với frame trước', unit: '°', ops: ALL_OPS, targets: BOX, min: 0, max: BIG, step: 1, box: true },
  { id: 'distance', section: 'D', label: 'Khoảng cách 3D tới gốc toạ độ', unit: 'm', ops: ALL_OPS, targets: BOX, min: 0, max: BIG, step: 1, box: true },
  { id: 'iou', section: 'O', label: 'IoU hình chiếu từ trên của hai box', unit: '', ops: OVER_OPS, targets: AC, min: 0, max: 1, step: 0.05, help: '0 = báo mọi cặp có phần giao. Cặp khác nhóm lấy mức chặt hơn.' },
  { id: 'holdFrames', section: 'T', label: 'Số frame liên tiếp box giữ nguyên toạ độ ego', unit: 'frame', ops: OVER_OPS, targets: A, min: 2, max: BIG, step: 1, int: true },
  { id: 'motionDev', section: 'M', label: 'Lệch vị trí so với dự đoán từ các frame trước', unit: 'm', ops: OVER_OPS, targets: AC, min: 0.05, max: BIG, step: 0.05 },
  { id: 'ptsInside', section: 'F', label: 'Số điểm trong box', unit: 'điểm', ops: UNDER_OPS, targets: A, min: 0, max: 1000, step: 1, int: true, help: 'Ít điểm: báo khi số điểm trong box thấp hơn ngưỡng.' },
  { id: 'ptsOutside', section: 'F', label: 'Số điểm sát ngoài box (báo lệch)', unit: 'điểm', ops: OVER_OPS, targets: A, min: 1, max: BIG, step: 1, int: true },
  { id: 'floatGap', section: 'G', label: 'Đáy box CAO hơn mặt đường', unit: 'm', ops: OVER_OPS, targets: A, min: 0, max: BIG, step: 0.01 },
  { id: 'sinkGap', section: 'G', label: 'Đáy box THẤP hơn mặt đường', unit: 'm', ops: OVER_OPS, targets: A, min: 0, max: BIG, step: 0.01 },
  { id: 'outsideGap', section: 'X', label: 'Số frame outside liên tục rồi có box lại', unit: 'frame', ops: OVER_OPS, targets: A, min: 2, max: BIG, step: 1, int: true },
];
export const METRIC_BY_ID = new Map(METRICS.map((m) => [m.id, m]));
export const metricsOf = (s: SectionCode) => METRICS.filter((m) => m.section === s);

/** value = null: rule mới thêm, chưa nhập ngưỡng, chưa có hiệu lực. */
export interface Rule { id: string; metric: MetricId; target: Target; op: Op; value: number | null }

const norm = (s: string) => s.trim().toLowerCase();
export const sameClass = (a: string, b: string) => norm(a) === norm(b);

/** attrs: giá trị hiệu lực của các attribute của object ở frame đang xét, khoá = tên attribute viết thường. */
export interface RuleCtx { job: number; label: string; num?: number; attrs?: Readonly<Record<string, string>> }
export function targetMatches(t: Target, c: RuleCtx): boolean {
  if (t.t === 'all') return true;
  if (t.t === 'class') return sameClass(t.name, c.label);
  if (t.t === 'attr') { const v = c.attrs?.[norm(t.attr)]; return sameClass(t.name, c.label) && v !== undefined && norm(v) === norm(t.value); }
  return t.job === c.job && t.num === c.num;
}

/** Độ cụ thể của đối tượng rule: tất cả object < class < attribute < một object. */
export const TARGET_LEVEL: Record<TargetKind, number> = { all: 0, class: 1, attr: 2, object: 3 };
const dirOf = (op: Op) => (op === '>' || op === '>=' ? 'over' : op === '<' || op === '<=' ? 'under' : op);

/**
 * Các rule có hiệu lực cho một box (đã có ngưỡng, đối tượng khớp). Rule cùng thuộc tính đo và cùng chiều được gom một nhóm; trong nhóm chỉ
 * giữ rule cụ thể nhất: một object > attribute > class > tất cả object. Box khớp rule attribute của từ hai attribute khác nhau trở lên
 * (vd. age = child và pose = sitting) thì không biết theo attribute nào: bỏ cấp attribute, xét từ class.
 */
export function effectiveRules(rules: readonly Rule[], ctx: RuleCtx): Rule[] {
  const groups = new Map<string, Rule[]>();
  for (const r of rules) {
    if (r.value === null || !targetMatches(r.target, ctx)) continue;
    const k = `${r.metric}|${dirOf(r.op)}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: Rule[] = [];
  for (const g of groups.values()) {
    const attrs = new Set(g.flatMap((r) => (r.target.t === 'attr' ? [norm(r.target.attr)] : [])));
    const pool = attrs.size > 1 ? g.filter((r) => r.target.t !== 'attr') : g;
    const top = Math.max(-1, ...pool.map((r) => TARGET_LEVEL[r.target.t]));
    out.push(...pool.filter((r) => TARGET_LEVEL[r.target.t] === top));
  }
  return out;
}

/** Tên ngắn của đối tượng rule (hiện trong thông báo lỗi). */
export function targetText(t: Target): string {
  if (t.t === 'all') return 'tất cả';
  if (t.t === 'class') return t.name;
  if (t.t === 'attr') return `${t.name} · ${t.attr} = ${t.value}`;
  return `#${t.num}`;
}

/** So sánh có dung sai nhỏ (số thực). '=' và '!=' dung sai 1e-4. */
export function cmp(v: number, op: Op, x: number): boolean {
  switch (op) {
    case '>': return v - x > 1e-9;
    case '>=': return v - x >= -1e-9;
    case '<': return x - v > 1e-9;
    case '<=': return x - v >= -1e-9;
    case '=': return Math.abs(v - x) <= 1e-4;
    default: return Math.abs(v - x) > 1e-4;
  }
}

const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(1) : n.toFixed(2));
/** Các rule trên số đo của MỘT box đang đúng: [{ mã mục lỗi, thông báo }]. */
export function ruleHits(rules: readonly Rule[], ctx: RuleCtx, values: Partial<Record<MetricId, number>>): { code: SectionCode; message: string }[] {
  const out: { code: SectionCode; message: string }[] = [];
  for (const r of effectiveRules(rules, ctx)) {
    const v = values[r.metric];
    const m = METRIC_BY_ID.get(r.metric);
    if (v === undefined || !m || !m.box || r.value === null) continue;
    if (cmp(v, r.op, r.value)) out.push({ code: m.section, message: `${m.label} = ${fmt(v)}${m.unit ? ' ' + m.unit : ''} (rule ${targetText(r.target)}: ${r.op} ${r.value}${m.unit ? ' ' + m.unit : ''})` });
  }
  return out;
}

/** Rule hợp lệ? (metric có thật, quy tắc và đối tượng được phép cho metric đó, ngưỡng trong khoảng). */
export function validRule(r: unknown): r is Rule {
  if (!r || typeof r !== 'object') return false;
  const x = r as Partial<Rule>;
  const m = typeof x.metric === 'string' ? METRIC_BY_ID.get(x.metric) : undefined;
  if (!m || typeof x.id !== 'string' || !x.id || !x.op || !m.ops.includes(x.op)) return false;
  const t = x.target as Target | undefined;
  if (!t || typeof t !== 'object' || !m.targets.includes(t.t)) return false;
  if ((t.t === 'class' || t.t === 'attr') && (typeof t.name !== 'string' || !t.name.trim())) return false;
  if (t.t === 'attr' && (typeof t.attr !== 'string' || !t.attr.trim() || typeof t.value !== 'string')) return false;
  if (t.t === 'object' && !(Number.isInteger(t.job) && Number.isInteger(t.num) && t.num >= 1)) return false;
  if (x.value === null) return true;
  return typeof x.value === 'number' && Number.isFinite(x.value) && x.value >= m.min && x.value <= m.max && (!m.int || Number.isInteger(x.value));
}
/** Đọc danh sách rule đã lưu: bỏ rule hỏng, id trùng. */
export function parseRules(raw: unknown): Rule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Rule[] = [];
  for (const r of raw) if (validRule(r) && !seen.has(r.id)) { seen.add(r.id); out.push({ id: r.id, metric: r.metric, target: cleanTarget(r.target), op: r.op, value: r.value }); }
  return out;
}
/** Chỉ giữ các trường của đúng loại đối tượng (trường lạ trong file nạp vào bị bỏ). */
function cleanTarget(t: Target): Target {
  if (t.t === 'all') return { t: 'all' };
  if (t.t === 'class') return { t: 'class', name: t.name };
  if (t.t === 'attr') return { t: 'attr', name: t.name, attr: t.attr, value: t.value };
  return { t: 'object', job: t.job, num: t.num };
}
export const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
