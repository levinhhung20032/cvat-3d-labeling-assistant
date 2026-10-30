import { DEFAULT_DRIFT } from './drift';
import { DEFAULT_FIT } from './fit';
import { DEFAULT_GROUND } from './ground';
import { DEFAULT_MOTION } from './motion';
import { allowedKey, DEFAULT_OVERLAP } from './overlap';
import { RULESET } from './qcrules';
import { BIG, type Rule, type SectionCode } from './alertRules';
import type { SymbolKind } from './symbols';
import { splitConfig } from './splitId';
import { DEFAULT_REFLECT } from './reflect';

/**
 * Ngưỡng cảnh báo chỉnh tay (tab Threshold). Mọi luật đọc ngưỡng từ các cấu hình mặc định (`DEFAULT_QC_RULES`, `DEFAULT_FIT`…),
 * nên chỉnh ở đây = ghi thẳng vào các cấu hình đó (ngoài giá trị gốc được chụp lúc nạp module để "đặt lại"). Dữ liệu lưu chỉ gồm các
 * giá trị KHÁC mặc định. Giá trị lưu hỏng / ngoài khoảng cho phép bị bỏ, dùng mặc định.
 */
export type SectionId = SectionCode;
export const SECTIONS: { id: SectionId; title: string; about: string; code?: SymbolKind }[] = [
  { id: 'S', code: 'S', title: 'Scale không đồng bộ', about: 'Size không đồng bộ: object TẮT Dynamic size phải cùng một kích thước ở mọi frame. Frame có dài, rộng hoặc cao khác kích thước chung của object (trung vị các frame) quá dung sai thì báo. Rule: chọn đối tượng và dung sai.' },
  { id: 'K', code: 'K', title: 'Kích thước ngoài ngưỡng', about: 'Dài × rộng × cao của box. Rule đặt cho tất cả, một class, class · attribute = giá trị (vd. Vehicle · type = truck) hoặc một object: ví dụ Dài > ngưỡng thì báo.' },
  { id: 'Z', code: 'Z', title: 'Độ cao tâm box', about: 'z của tâm box (m, gốc ở mặt đất dưới xe).' },
  { id: 'H', code: 'H', title: 'Đổi hướng đột ngột', about: 'Yaw đổi giữa hai frame liền nhau.' },
  { id: 'D', code: 'D', title: 'Quá xa', about: 'Khoảng cách 3D từ tâm box tới gốc toạ độ.' },
  { id: 'O', code: 'O', title: 'Chồng lấn', about: 'Hai box có phần giao nhìn từ trên: báo khi IoU vượt ngưỡng của class (0 = báo mọi cặp có phần giao). Tham số: phần giao nhỏ hơn mức tối thiểu thì bỏ qua.' },
  { id: 'T', code: 'T', title: 'Trôi box', about: 'Box giữ nguyên toạ độ ego trong khi xe chạy (box đi theo xe). Rule: giữ nguyên từ ngần này frame thì báo.' },
  { id: 'M', code: 'M', title: 'Đi xa bất thường', about: 'Vị trí lệch so với dự đoán từ chuyển động các frame trước. Rule theo class hoặc tất cả.' },
  { id: 'F', code: 'P', title: 'Lệch / ít điểm', about: 'Box lệch khỏi cụm điểm (nhiều điểm sát ngoài box) hoặc có ít điểm bên trong. Đổi mục này làm tính lại số liệu nền của mọi frame.' },
  { id: 'G', title: 'Đáy lơ lửng / chìm', about: 'Đáy box so với mặt đường đo riêng cho từng object. Đổi mục này làm tính lại số liệu nền của mọi frame.' },
  { id: 'X', title: 'Outside liên tục (tách ID)', about: 'Outside liên tục từ ngần này frame rồi có box lại thì gợi ý tách ID.' },
];

export { BIG };

export interface Field {
  key: string;
  section: SectionId;
  label: string;
  unit?: string;
  min: number;
  max: number;
  step: number;
  int?: boolean;
  help?: string;
  def: number; // giá trị mặc định (chụp lúc nạp module)
  get: () => number;
  set: (v: number) => void;
}
const field = (key: string, section: SectionId, label: string, o: { unit?: string; min: number; max: number; step: number; int?: boolean; help?: string }, get: () => number, set: (v: number) => void): Field =>
  ({ key, section, label, ...o, def: get(), get, set });

export const FIELDS: Field[] = [
  field('O.area', 'O', 'Phần giao tối thiểu', { unit: 'm²', min: 0, max: BIG, step: 0.001, help: 'Phần giao nhỏ hơn mức này thì bỏ qua' }, () => DEFAULT_OVERLAP.minArea, (v) => { DEFAULT_OVERLAP.minArea = v; }),
  field('T.hold', 'T', 'Coi là "không đổi" khi lệch tối đa', { unit: 'm', min: 0, max: 0.5, step: 0.001, help: 'x, y, z giữa hai frame liền nhau; trôi thật thường trùng khớp hoàn toàn' }, () => DEFAULT_DRIFT.holdTol, (v) => { DEFAULT_DRIFT.holdTol = v; }),
  field('T.yaw', 'T', 'Yaw coi là "không đổi" khi lệch tối đa', { unit: 'rad', min: 0, max: 0.5, step: 0.005 }, () => DEFAULT_DRIFT.holdYaw, (v) => { DEFAULT_DRIFT.holdYaw = v; }),
  field('T.ego', 'T', 'Xe coi là đang chạy khi bước ≥', { unit: 'm/frame', min: 0, max: 20, step: 0.05, help: 'Bước trung vị của các object đang nhích giữa hai frame' }, () => DEFAULT_DRIFT.egoMin, (v) => { DEFAULT_DRIFT.egoMin = v; }),
  field('T.movers', 'T', 'Số object đang nhích tối thiểu', { min: 1, max: 50, step: 1, int: true, help: 'Ít hơn thì không đủ cơ sở để tin xe đang chạy' }, () => DEFAULT_DRIFT.minMovers, (v) => { DEFAULT_DRIFT.minMovers = v; }),
  field('T.supMin', 'T', 'Bỏ báo khi trong box còn ≥', { unit: 'điểm', min: 1, max: 1000, step: 1, int: true, help: 'Box còn đủ điểm (và đủ tỉ lệ so với frame neo) = vật chạy cùng vận tốc với xe' }, () => DEFAULT_DRIFT.supportMin, (v) => { DEFAULT_DRIFT.supportMin = v; }),
  field('T.supRatio', 'T', '… và ≥ tỉ lệ điểm ở frame neo', { min: 0, max: 1, step: 0.05 }, () => DEFAULT_DRIFT.supportRatio, (v) => { DEFAULT_DRIFT.supportRatio = v; }),
  field('M.rel', 'M', 'Cho phép thêm theo quãng đường dự kiến', { unit: '×', min: 0, max: 3, step: 0.05, help: 'Tỉ lệ so với quãng đường dự kiến (vận tốc tương đối đổi dần)' }, () => DEFAULT_MOTION.rel, (v) => { DEFAULT_MOTION.rel = v; }),
  field('F.margin', 'F', 'Vùng xét quanh box', { unit: 'm', min: 0.1, max: 3, step: 0.05 }, () => DEFAULT_FIT.margin, (v) => { DEFAULT_FIT.margin = v; }),
  field('F.ratio', 'F', 'Tỉ lệ điểm ngoài / (trong + ngoài) tối thiểu', { min: 0, max: 1, step: 0.05 }, () => DEFAULT_FIT.ratio, (v) => { DEFAULT_FIT.ratio = v; }),
  field('F.clear', 'F', 'Bỏ lớp điểm sát đáy box (khi chưa đo được mặt đường)', { unit: 'm', min: 0, max: 1, step: 0.01 }, () => DEFAULT_FIT.groundClear, (v) => { DEFAULT_FIT.groundClear = v; }),
  field('G.sigma', 'G', 'Chỉ báo khi lệch > k × độ bất định', { unit: 'k', min: 0, max: 10, step: 0.1 }, () => DEFAULT_GROUND.sigmaK, (v) => { DEFAULT_GROUND.sigmaK = v; }),
  field('G.refBelow', 'G', 'Gợi ý bật ref mode khi dưới mặt đường (trong chân box) có từ', { unit: 'điểm', min: 1, max: 10000, step: 1, int: true, help: 'Điểm nằm dưới mặt đường trong phạm vi chân box, sâu tới một chiều cao box: nhiều thì có thể là ảnh phản chiếu của vật' }, () => DEFAULT_REFLECT.minBelow, (v) => { DEFAULT_REFLECT.minBelow = v; }),
  field('G.refClear', 'G', '… bỏ lớp sát mặt đường dày', { unit: 'm', min: 0, max: 1, step: 0.01 }, () => DEFAULT_REFLECT.clear, (v) => { DEFAULT_REFLECT.clear = v; }),
  field('G.range', 'G', 'Chỉ đo mặt đường trong bán kính', { unit: 'm', min: 5, max: 300, step: 5 }, () => DEFAULT_GROUND.maxRange, (v) => { DEFAULT_GROUND.maxRange = v; }),
];
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
export const fieldsOf = (s: SectionId) => FIELDS.filter((f) => f.section === s);

/** Hợp lệ: số hữu hạn trong khoảng, số nguyên nếu `int`. */
export const validValue = (f: Field, v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max && (!f.int || Number.isInteger(v));

export function setValue(key: string, v: number): boolean {
  const f = BY_KEY.get(key);
  if (!f || !validValue(f, v)) return false;
  f.set(v);
  return true;
}
export const isChanged = (f: Field) => f.get() !== f.def;
/** Tham số kỹ thuật của mục đã đổi so với mặc định trong code (rule tính riêng, xem `rulesIn`). */
export const sectionChanged = (s: SectionId) => fieldsOf(s).some(isChanged);

export function resetSection(s: SectionId) {
  for (const f of fieldsOf(s)) f.set(f.def);
}
export const resetAll = () => { for (const s of SECTIONS) resetSection(s.id); };

/** Dữ liệu lưu của tham số kỹ thuật: chỉ giá trị khác mặc định. (Rule lưu riêng, xem thresholdStore.) */
export interface Persisted { n: Record<string, number> }
export function toPersisted(): Persisted {
  const n: Record<string, number> = {};
  for (const f of FIELDS) if (isChanged(f)) n[f.key] = f.get();
  return { n };
}
/** Áp dữ liệu đã lưu (hỏng thì bỏ từng phần); trước đó đặt lại mặc định. */
export function applyPersisted(raw: unknown): void {
  resetAll();
  if (!raw || typeof raw !== 'object') return;
  const p = raw as Partial<Persisted>;
  if (p.n && typeof p.n === 'object') for (const [k, v] of Object.entries(p.n)) setValue(k, v as number);
}

/** Mã của cấu hình ảnh hưởng tới số liệu nền (lệch / ít điểm / mặt đường): đổi thì kết quả đã tính không còn dùng. */
export const backgroundConfigKey = () => JSON.stringify([DEFAULT_GROUND, DEFAULT_FIT]);

// ---- Rule → cấu hình của từng bước tính ----
const upInt = (op: string, v: number) => (op === '>' ? Math.floor(v) + 1 : Math.ceil(v)); // ">= v" → v ; "> v" → số nguyên kế tiếp
const downInt = (op: string, v: number) => (op === '<=' ? Math.floor(v) + 1 : Math.ceil(v)); // "< v" → v ; "<= v" → v + 1

/**
 * Đặt cấu hình các bước tính (IoU, đi xa, trôi box, lệch / ít điểm, mặt đường, tách ID) theo danh sách rule: trước hết đưa về trạng thái
 * KHÔNG CẢNH BÁO (không có rule = không báo), rồi áp từng rule có ngưỡng. Nhiều rule cùng loại: lấy mức chặt nhất; rule theo class ưu tiên
 * hơn rule "tất cả" cho class đó. Các rule đo trên từng box (K, Z, H, D, S) được `trackIssues` đọc trực tiếp từ RULESET, không qua đây.
 */
export function compileRules(rules: readonly Rule[]): void {
  DEFAULT_OVERLAP.allowed = {};
  DEFAULT_OVERLAP.defaultAllowed = 1;
  DEFAULT_MOTION.base = {};
  DEFAULT_MOTION.defaultBase = BIG;
  DEFAULT_DRIFT.minHold = BIG;
  DEFAULT_FIT.minShell = BIG;
  DEFAULT_FIT.minInside = 0;
  DEFAULT_GROUND.floatTol = BIG;
  DEFAULT_GROUND.sinkTol = BIG;
  splitConfig.minFrames = BIG;
  const live = rules.filter((r) => r.value !== null) as (Rule & { value: number })[];
  const strict = (cur: number, v: number) => Math.min(cur, v);
  // Đối tượng "tất cả" trước, class sau (class ghi đè).
  for (const pass of ['all', 'class'] as const) {
    for (const r of live) {
      if (r.target.t !== pass) continue;
      if (r.metric === 'iou') {
        if (r.target.t === 'all') { DEFAULT_OVERLAP.defaultAllowed = strict(DEFAULT_OVERLAP.defaultAllowed, r.value); }
        else { const k = classKeyOf(r.target.name); DEFAULT_OVERLAP.allowed[k] = strict(DEFAULT_OVERLAP.allowed[k] ?? 1, r.value); }
      } else if (r.metric === 'motionDev') {
        if (r.target.t === 'all') DEFAULT_MOTION.defaultBase = strict(DEFAULT_MOTION.defaultBase, r.value);
        else { const k = r.target.name.trim().toLowerCase(); DEFAULT_MOTION.base[k] = strict(DEFAULT_MOTION.base[k] ?? BIG, r.value); }
      }
    }
  }
  for (const r of live) {
    if (r.target.t !== 'all') continue;
    if (r.metric === 'holdFrames') DEFAULT_DRIFT.minHold = strict(DEFAULT_DRIFT.minHold, upInt(r.op, r.value));
    else if (r.metric === 'ptsOutside') DEFAULT_FIT.minShell = strict(DEFAULT_FIT.minShell, upInt(r.op, r.value));
    else if (r.metric === 'ptsInside') DEFAULT_FIT.minInside = Math.max(DEFAULT_FIT.minInside, downInt(r.op, r.value));
    else if (r.metric === 'floatGap') DEFAULT_GROUND.floatTol = strict(DEFAULT_GROUND.floatTol, r.value);
    else if (r.metric === 'sinkGap') DEFAULT_GROUND.sinkTol = strict(DEFAULT_GROUND.sinkTol, r.value);
    else if (r.metric === 'outsideGap') splitConfig.minFrames = strict(splitConfig.minFrames, Math.max(2, upInt(r.op, r.value)));
  }
  // Mức "tất cả" của IoU / đi xa áp cho mọi nhóm chưa có rule riêng: nhóm đã có rule riêng thì giữ rule riêng (đặt ở vòng class).
}

const classKeyOf = (name: string) => allowedKey(name);

/** Rule hiện hành (do thresholdStore đặt). `trackIssues` đọc RULESET để xét K Z H D S theo rule. */
export function installRules(rules: readonly Rule[], job: number): void {
  RULESET.rules = [...rules];
  RULESET.job = job;
  compileRules(rules);
}
// Mặc định lúc nạp module: có bộ rule (rỗng) nên không cảnh báo gì cho tới khi người dùng thêm rule.
installRules([], 0);
