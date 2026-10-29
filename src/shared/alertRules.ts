/**
 * Rule cảnh báo (tab Threshold). Mỗi lỗi được định nghĩa bằng các rule: chọn ĐỐI TƯỢNG (tất cả / class của job / một object),
 * THUỘC TÍNH đo được, QUY TẮC xét (>, >=, <, <=, =, !=) và NGƯỠNG. Rule đúng thì báo lỗi của mục chứa nó. Không có rule thì không báo.
 * Không có con số nào được kèm sẵn: người dùng tự nhập.
 */
export const BIG = 1e6;

export type Op = '>' | '>=' | '<' | '<=' | '=' | '!=';
export const ALL_OPS: Op[] = ['>', '>=', '<', '<=', '=', '!='];
export const OVER_OPS: Op[] = ['>', '>='];
export const UNDER_OPS: Op[] = ['<', '<='];

export type TargetKind = 'all' | 'class' | 'object';
export type Target = { t: 'all' } | { t: 'class'; name: string } | { t: 'object'; job: number; num: number };

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

const ALL3: TargetKind[] = ['all', 'class', 'object'];
const AC: TargetKind[] = ['all', 'class'];
const A: TargetKind[] = ['all'];

export const METRICS: MetricDef[] = [
  { id: 'sizeDev', section: 'S', label: 'Lệch kích thước so với kích thước chuẩn của object', unit: 'm', ops: ALL_OPS, targets: ALL3, min: 0, max: BIG, step: 0.005, box: true, help: 'Lớn nhất trong 3 trục (dài, rộng, cao) so với trung vị của object. Chỉ xét object có Dynamic size TẮT.' },
  { id: 'length', section: 'K', label: 'Dài (L)', unit: 'm', ops: ALL_OPS, targets: ALL3, min: 0, max: BIG, step: 0.05, box: true },
  { id: 'width', section: 'K', label: 'Rộng (W)', unit: 'm', ops: ALL_OPS, targets: ALL3, min: 0, max: BIG, step: 0.05, box: true },
  { id: 'height', section: 'K', label: 'Cao (H)', unit: 'm', ops: ALL_OPS, targets: ALL3, min: 0, max: BIG, step: 0.05, box: true },
  { id: 'z', section: 'Z', label: 'z của tâm box', unit: 'm', ops: ALL_OPS, targets: ALL3, min: -BIG, max: BIG, step: 0.1, box: true },
  { id: 'yawJump', section: 'H', label: 'Yaw đổi so với frame trước', unit: '°', ops: ALL_OPS, targets: ALL3, min: 0, max: BIG, step: 1, box: true },
  { id: 'distance', section: 'D', label: 'Khoảng cách 3D tới gốc toạ độ', unit: 'm', ops: ALL_OPS, targets: ALL3, min: 0, max: BIG, step: 1, box: true },
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

export interface RuleCtx { job: number; label: string; num?: number }
export function targetMatches(t: Target, c: RuleCtx): boolean {
  if (t.t === 'all') return true;
  if (t.t === 'class') return sameClass(t.name, c.label);
  return t.job === c.job && t.num === c.num;
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
  for (const r of rules) {
    if (r.value === null) continue;
    const v = values[r.metric];
    const m = METRIC_BY_ID.get(r.metric);
    if (v === undefined || !m || !m.box || !targetMatches(r.target, ctx)) continue;
    if (cmp(v, r.op, r.value)) out.push({ code: m.section, message: `${m.label} = ${fmt(v)}${m.unit ? ' ' + m.unit : ''} (rule: ${r.op} ${r.value}${m.unit ? ' ' + m.unit : ''})` });
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
  if (t.t === 'class' && (typeof t.name !== 'string' || !t.name.trim())) return false;
  if (t.t === 'object' && !(Number.isInteger(t.job) && Number.isInteger(t.num) && t.num >= 1)) return false;
  if (x.value === null) return true;
  return typeof x.value === 'number' && Number.isFinite(x.value) && x.value >= m.min && x.value <= m.max && (!m.int || Number.isInteger(x.value));
}
/** Đọc danh sách rule đã lưu: bỏ rule hỏng, id trùng. */
export function parseRules(raw: unknown): Rule[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: Rule[] = [];
  for (const r of raw) if (validRule(r) && !seen.has(r.id)) { seen.add(r.id); out.push({ id: r.id, metric: r.metric, target: { ...r.target }, op: r.op, value: r.value }); }
  return out;
}
export const newRuleId = () => `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
