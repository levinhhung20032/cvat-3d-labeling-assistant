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
import { DEFAULT_PATCHWORK } from './patchwork';

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
  field('G.pw', 'G', 'Patchwork++ (thử nghiệm): 0 tắt · 1 lọc điểm · 2 lọc + chọn tầng · 3 mặt đường từ ô mặt đất · 4 đường rõ giữ cách cũ, còn lại fit từ điểm mặt đất', { min: 0, max: 4, step: 1, int: true, help: 'Phân tách mặt đất bằng Patchwork++ trên cả frame. 3: mặt đường = mặt phẳng fit từ các ô mặt đất quanh box (ô chứa chính vật thể bị bỏ, nên dùng được cả khi mặt đường dưới vật bị che hoặc điểm thưa ở xa); không có ô nào thì dùng cách đo cũ. 4: đường rõ (cách cũ đo chắc) giữ nguyên kết quả cũ; ca xa / thưa / bị che fit mặt đường từ các điểm Patchwork++ gán là mặt đất trong bán kính G.pwFarRadius. 1: các cung quanh box bỏ điểm không phải mặt đất (làm ít ca snap được hơn). 2: như 1 + chọn tầng theo Patchwork++. Đổi mục này làm tính lại số liệu nền.' }, () => DEFAULT_GROUND.pw, (v) => { DEFAULT_GROUND.pw = v; }),
  field('G.pwLift', 'G', 'Patchwork++ mức 3: nâng mặt đường lên (mặt trên lớp điểm)', { unit: 'm', min: 0, max: 0.2, step: 0.005 }, () => DEFAULT_GROUND.pwLift, (v) => { DEFAULT_GROUND.pwLift = v; }),
  field('G.pwSigma', 'G', 'Patchwork++ mức 3: sai số mô hình cộng vào độ bất định', { unit: 'm', min: 0, max: 0.3, step: 0.005 }, () => DEFAULT_GROUND.pwSigma, (v) => { DEFAULT_GROUND.pwSigma = v; }),
  field('G.pwMaxRms', 'G', 'Patchwork++ mức 3: coi là đủ tin khi phần dư ≤', { unit: 'm', min: 0.005, max: 0.3, step: 0.005 }, () => DEFAULT_GROUND.pwMaxRms, (v) => { DEFAULT_GROUND.pwMaxRms = v; }),
  field('G.pwRadius', 'G', 'Patchwork++ mức 3: lấy các ô mặt đất trong bán kính', { unit: 'm', min: 2, max: 40, step: 1 }, () => DEFAULT_GROUND.pwRadius, (v) => { DEFAULT_GROUND.pwRadius = v; }),
  field('G.pwFarRadius', 'G', 'Patchwork++ mức 4: lấy điểm mặt đất trong bán kính', { unit: 'm', min: 3, max: 16, step: 1, help: 'Mức 4 chỉ dùng khi cách đo cũ không đo chắc (xa, thưa, bị che): fit mặt đường từ các điểm Patchwork++ gán là mặt đất quanh box (bỏ vùng quanh chân box).' }, () => DEFAULT_GROUND.pwFarRadius, (v) => { DEFAULT_GROUND.pwFarRadius = v; }),
  field('G.pwMinPts', 'G', 'Patchwork++ mức 4: số điểm mặt đất tối thiểu', { unit: 'điểm', min: 10, max: 1000, step: 5, int: true }, () => DEFAULT_GROUND.pwMinPts, (v) => { DEFAULT_GROUND.pwMinPts = v; }),
  field('G.pwPool', 'G', 'Patchwork++ mức 4: gộp điểm mặt đất của ± ngần này frame lân cận (0 = không gộp)', { unit: 'frame', min: 0, max: 5, step: 1, int: true, help: 'Xe chạy nên vật ở xa ở frame này thường được thấy gần hơn (nhiều điểm hơn) ở frame sau. Điểm mặt đất của các frame lân cận quanh vị trí object được đưa về frame này bằng chuyển động xe ước lượng từ các box (cần đủ box liên tiếp giữa các frame). Trái quy ước "không dự đoán từ frame khác" của CLAUDE.md, chỉ dùng trong giai đoạn thử nghiệm.' }, () => DEFAULT_GROUND.pwPool, (v) => { DEFAULT_GROUND.pwPool = v; }),
  field('G.pwConsSpan', 'G', 'Patchwork++ mức 4: kiểm tra nhất quán với ± ngần này frame kề của object (0 = tắt)', { unit: 'frame', min: 0, max: 6, step: 1, int: true, help: 'Mặt đường dưới cùng một object ở các frame kề nhau đổi chậm. Kết quả Patchwork++ lệch trung vị mặt đường các frame kề (đủ tin) quá ngưỡng dưới đây thì không đủ tin: không tự snap, không báo G.' }, () => DEFAULT_GROUND.pwConsSpan, (v) => { DEFAULT_GROUND.pwConsSpan = v; }),
  field('G.pwConsTol', 'G', 'Patchwork++ mức 4: nhất quán — lệch cho phép so với các frame kề', { unit: 'm', min: 0.02, max: 1, step: 0.01 }, () => DEFAULT_GROUND.pwConsTol, (v) => { DEFAULT_GROUND.pwConsTol = v; }),
  field('G.pwConsSlope', 'G', 'Patchwork++ mức 4: nhất quán — cộng thêm cho mỗi mét đổi tầm giữa hai frame', { unit: 'm/m', min: 0, max: 0.3, step: 0.005 }, () => DEFAULT_GROUND.pwConsSlope, (v) => { DEFAULT_GROUND.pwConsSlope = v; }),
  field('G.pwAgree', 'G', 'Patchwork++ mức 4: không đủ tin khi lệch cách đo cũ (chưa chắc) quá', { unit: 'm', min: 0.02, max: 1, step: 0.01, help: 'Cách đo cũ dù chưa đủ chắc để snap vẫn có thể cho một mức mặt đường (vd. từ 1 cung). Nếu mặt phẳng Patchwork++ chênh mức đó hơn ngần này thì hai nguồn mâu thuẫn: kết quả không được coi là đủ tin (không tự snap, không báo G).' }, () => DEFAULT_GROUND.pwAgree, (v) => { DEFAULT_GROUND.pwAgree = v; }),
  field('G.pwPriorMargin', 'G', 'Patchwork++: mặt đường nằm trong ±(mức này + độ dốc × tầm) quanh z = 0', { unit: 'm', min: 0.1, max: 3, step: 0.05, help: 'Gốc toạ độ nằm trên mặt đường dưới lidar (đã hiệu chỉnh) nên mặt đường ở tầm r chỉ có thể ở |z| ≤ mức này + độ dốc · r. Điểm ngoài khoảng đó (phản chiếu sâu dưới đường, thân xe / nhà phía trên) không được dùng để dựng mặt đất.' }, () => DEFAULT_PATCHWORK.priorMargin, (v) => { DEFAULT_PATCHWORK.priorMargin = v; }),
  field('G.pwPriorSlope', 'G', 'Patchwork++: độ dốc tối đa của mặt đường (m / m)', { unit: 'm/m', min: 0.01, max: 0.3, step: 0.005 }, () => DEFAULT_PATCHWORK.priorSlope, (v) => { DEFAULT_PATCHWORK.priorSlope = v; }),
  field('G.pwMatch', 'G', '… chọn tầng khi lệch mặt đất Patchwork++ không quá', { unit: 'm', min: 0.01, max: 0.5, step: 0.01 }, () => DEFAULT_GROUND.pwMatch, (v) => { DEFAULT_GROUND.pwMatch = v; }),
  field('G.pwH', 'G', 'Patchwork++: chiều cao lidar so với mặt đường', { unit: 'm', min: 0.5, max: 4, step: 0.05, help: 'Gốc toạ độ nằm trên mặt đường dưới lidar; Patchwork++ cần gốc ở lidar nên dời z lên mức này. Chỉ cần gần đúng (tự cập nhật từ vành gần xe nhất).' }, () => DEFAULT_PATCHWORK.sensorHeight, (v) => { DEFAULT_PATCHWORK.sensorHeight = v; }),
  field('G.pwLearn', 'G', 'Patchwork++: học ngưỡng cao / phẳng qua các frame (1 bật, 0 tắt)', { min: 0, max: 1, step: 1, int: true }, () => (DEFAULT_PATCHWORK.adaptive ? 1 : 0), (v) => { DEFAULT_PATCHWORK.adaptive = v >= 1; }),
  field('G.pwDist', 'G', 'Patchwork++: điểm cách mặt phẳng ô không quá mức này là mặt đất', { unit: 'm', min: 0.02, max: 0.5, step: 0.005 }, () => DEFAULT_PATCHWORK.thDist, (v) => { DEFAULT_PATCHWORK.thDist = v; }),
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
