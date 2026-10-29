import { DEFAULT_DRIFT } from './drift';
import { DEFAULT_FIT } from './fit';
import { DEFAULT_GROUND } from './ground';
import { DEFAULT_MOTION } from './motion';
import { DEFAULT_OVERLAP } from './overlap';
import { DEFAULT_QC_RULES, SIZE_OVERRIDES, type ClassKey, type ClassSize } from './qcrules';
import { splitConfig } from './splitId';

/**
 * Ngưỡng cảnh báo chỉnh tay (tab Threshold). Mọi luật đọc ngưỡng từ các cấu hình mặc định (`DEFAULT_QC_RULES`, `DEFAULT_FIT`…),
 * nên chỉnh ở đây = ghi thẳng vào các cấu hình đó (ngoài giá trị gốc được chụp lúc nạp module để "đặt lại"). Dữ liệu lưu chỉ gồm các
 * giá trị KHÁC mặc định. Giá trị lưu hỏng / ngoài khoảng cho phép bị bỏ, dùng mặc định.
 */
export type SectionId = 'S' | 'K' | 'Z' | 'H' | 'D' | 'O' | 'T' | 'M' | 'F' | 'G' | 'X';
export const SECTIONS: { id: SectionId; title: string; about: string }[] = [
  { id: 'S', title: 'S · Scale không đồng bộ', about: 'Mọi box của một object (nhóm được chọn) phải cùng kích thước; mốc là trung vị của object. Báo khi một trục lệch mốc quá dung sai.' },
  { id: 'K', title: 'K · Kích thước ngoài ngưỡng', about: 'Dài × rộng × cao (m) phải nằm trong khoảng cho từng class. Chỉnh theo class (áp cho mọi object của class), hoặc đặt ngưỡng riêng cho một object.' },
  { id: 'Z', title: 'Z · Độ cao tâm box', about: 'z của tâm box (m, gốc ở mặt đất dưới xe) phải nằm trong [thấp nhất, cao nhất].' },
  { id: 'H', title: 'H · Đổi hướng đột ngột', about: 'Yaw đổi giữa hai frame liền nhau quá ngưỡng thì báo (chỉ cho class có luật: Vehicle, Two-wheels, Pedestrian).' },
  { id: 'D', title: 'D · Quá xa', about: 'Khoảng cách 3D từ tâm box tới gốc toạ độ vượt ngưỡng thì báo.' },
  { id: 'O', title: 'O · Chồng lấn', about: 'Hai box có phần giao nhìn từ trên: báo khi IoU vượt mức cho phép của class (0 = báo mọi cặp có phần giao) và phần giao đủ lớn.' },
  { id: 'T', title: 'T · Trôi box', about: 'Box giữ nguyên toạ độ ego trong khi xe chạy (box đi theo xe). Ngưỡng nhận biết "không đổi", "xe đang chạy" và khi nào bỏ báo vì box còn bám vật.' },
  { id: 'M', title: 'Đi xa bất thường', about: 'Vị trí lệch so với dự đoán từ chuyển động các frame trước quá ngưỡng của class (m).' },
  { id: 'F', title: 'Lệch / ít điểm', about: 'Box lệch khỏi cụm điểm (điểm lọt sát ngoài box) hoặc có ít điểm bên trong. Đổi mục này làm tính lại số liệu nền của mọi frame.' },
  { id: 'G', title: 'Đáy lơ lửng / chìm', about: 'Đáy box so với mặt đường đo riêng cho từng object. Đổi mục này làm tính lại số liệu nền của mọi frame.' },
  { id: 'X', title: 'Outside liên tục (tách ID)', about: 'Outside liên tục từ ngần này frame rồi có box lại thì gợi ý tách ID.' },
];

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

export type OverlapClass = 'vehicle' | 'two_wheel' | 'pedestrian' | 'animal' | 'obstacle';
export const OVERLAP_CLASSES: { id: OverlapClass; name: string }[] = [
  { id: 'vehicle', name: 'Vehicle' }, { id: 'two_wheel', name: 'Two-wheels' }, { id: 'pedestrian', name: 'Pedestrian' }, { id: 'animal', name: 'Animal' }, { id: 'obstacle', name: 'Obstacle' },
];
/** Tên nhãn (chữ thường) dùng trong cấu hình "đi xa bất thường" cho từng nhóm. */
const MOTION_KEYS: Record<OverlapClass, string[]> = {
  vehicle: ['vehicles', 'vehicle'], two_wheel: ['two-wheels'], pedestrian: ['pedestrian'], animal: ['animal'], obstacle: ['obstacle'],
};

export const CLASS_KEYS: ClassKey[] = ['vehicle', 'two_wheel', 'pedestrian'];
export const CLASS_NAMES: Record<ClassKey, string> = { vehicle: 'Vehicle', two_wheel: 'Two-wheels', pedestrian: 'Pedestrian' };
export const DIMS = ['length', 'width', 'height'] as const;
export type Dim = (typeof DIMS)[number];
export const DIM_NAMES: Record<Dim, string> = { length: 'Dài', width: 'Rộng', height: 'Cao' };

export const FIELDS: Field[] = [
  field('S.tol', 'S', 'Dung sai kích thước', { unit: 'm', min: 0, max: 1, step: 0.005, help: 'Một trục lệch trung vị của object quá mức này thì báo S' }, () => DEFAULT_QC_RULES.scaleSyncTol, (v) => { DEFAULT_QC_RULES.scaleSyncTol = v; }),
  field('K.eps', 'K', 'Sai số cho phép ngoài khoảng', { unit: 'm', min: 0, max: 0.5, step: 0.001, help: 'Kích thước vượt khoảng của class tới mức này vẫn chưa báo K' }, () => DEFAULT_QC_RULES.sizeEps, (v) => { DEFAULT_QC_RULES.sizeEps = v; }),
  field('Z.min', 'Z', 'z thấp nhất', { unit: 'm', min: -50, max: 50, step: 0.1 }, () => DEFAULT_QC_RULES.zMin, (v) => { DEFAULT_QC_RULES.zMin = v; }),
  field('Z.max', 'Z', 'z cao nhất', { unit: 'm', min: -50, max: 50, step: 0.1 }, () => DEFAULT_QC_RULES.zMax, (v) => { DEFAULT_QC_RULES.zMax = v; }),
  field('H.deg', 'H', 'Đổi hướng tối đa giữa hai frame', { unit: '°', min: 1, max: 180, step: 1 }, () => DEFAULT_QC_RULES.maxRotationJumpDeg, (v) => { DEFAULT_QC_RULES.maxRotationJumpDeg = v; }),
  field('D.max', 'D', 'Khoảng cách tối đa tới gốc', { unit: 'm', min: 1, max: 1000, step: 1 }, () => DEFAULT_QC_RULES.maxDistance, (v) => { DEFAULT_QC_RULES.maxDistance = v; }),
  field('O.area', 'O', 'Phần giao tối thiểu', { unit: 'm²', min: 0, max: 10, step: 0.001, help: 'Phần giao nhỏ hơn mức này thì bỏ qua' }, () => DEFAULT_OVERLAP.minArea, (v) => { DEFAULT_OVERLAP.minArea = v; }),
  ...OVERLAP_CLASSES.map((c) => field(`O.${c.id}`, 'O', `IoU cho phép · ${c.name}`, { min: 0, max: 1, step: 0.05, help: '0 = báo mọi cặp có phần giao' }, () => DEFAULT_OVERLAP.allowed[c.id] ?? DEFAULT_OVERLAP.defaultAllowed, (v) => { DEFAULT_OVERLAP.allowed[c.id] = v; })),
  field('T.hold', 'T', 'Coi là "không đổi" khi lệch tối đa', { unit: 'm', min: 0, max: 0.5, step: 0.001, help: 'x, y, z giữa hai frame liền nhau; trôi thật thường trùng khớp hoàn toàn' }, () => DEFAULT_DRIFT.holdTol, (v) => { DEFAULT_DRIFT.holdTol = v; }),
  field('T.yaw', 'T', 'Yaw coi là "không đổi" khi lệch tối đa', { unit: 'rad', min: 0, max: 0.5, step: 0.005 }, () => DEFAULT_DRIFT.holdYaw, (v) => { DEFAULT_DRIFT.holdYaw = v; }),
  field('T.ego', 'T', 'Xe coi là đang chạy khi bước ≥', { unit: 'm/frame', min: 0, max: 20, step: 0.05, help: 'Bước trung vị của các object đang nhích giữa hai frame' }, () => DEFAULT_DRIFT.egoMin, (v) => { DEFAULT_DRIFT.egoMin = v; }),
  field('T.movers', 'T', 'Số object đang nhích tối thiểu', { min: 1, max: 50, step: 1, int: true, help: 'Ít hơn thì không đủ cơ sở để tin xe đang chạy' }, () => DEFAULT_DRIFT.minMovers, (v) => { DEFAULT_DRIFT.minMovers = v; }),
  field('T.minHold', 'T', 'Số frame liên tiếp tối thiểu (kể cả frame neo)', { unit: 'frame', min: 2, max: 60, step: 1, int: true }, () => DEFAULT_DRIFT.minHold, (v) => { DEFAULT_DRIFT.minHold = v; }),
  field('T.supMin', 'T', 'Bỏ báo khi trong box còn ≥', { unit: 'điểm', min: 1, max: 1000, step: 1, int: true, help: 'Box còn đủ điểm (và đủ tỉ lệ so với frame neo) = vật chạy cùng vận tốc với xe' }, () => DEFAULT_DRIFT.supportMin, (v) => { DEFAULT_DRIFT.supportMin = v; }),
  field('T.supRatio', 'T', '… và ≥ tỉ lệ điểm ở frame neo', { min: 0, max: 1, step: 0.05 }, () => DEFAULT_DRIFT.supportRatio, (v) => { DEFAULT_DRIFT.supportRatio = v; }),
  ...OVERLAP_CLASSES.map((c) => field(`M.${c.id}`, 'M', `Ngưỡng lệch · ${c.name}`, { unit: 'm', min: 0.05, max: 20, step: 0.05 }, () => DEFAULT_MOTION.base[MOTION_KEYS[c.id][0]!] ?? DEFAULT_MOTION.defaultBase, (v) => { for (const k of MOTION_KEYS[c.id]) DEFAULT_MOTION.base[k] = v; })),
  field('M.rel', 'M', 'Cho phép thêm theo quãng đường dự kiến', { unit: '×', min: 0, max: 3, step: 0.05, help: 'Tỉ lệ so với quãng đường dự kiến (vận tốc tương đối đổi dần)' }, () => DEFAULT_MOTION.rel, (v) => { DEFAULT_MOTION.rel = v; }),
  field('F.margin', 'F', 'Vùng xét quanh box', { unit: 'm', min: 0.1, max: 3, step: 0.05 }, () => DEFAULT_FIT.margin, (v) => { DEFAULT_FIT.margin = v; }),
  field('F.minShell', 'F', 'Số điểm ngoài tối thiểu mới báo lệch', { unit: 'điểm', min: 1, max: 500, step: 1, int: true }, () => DEFAULT_FIT.minShell, (v) => { DEFAULT_FIT.minShell = v; }),
  field('F.ratio', 'F', 'Tỉ lệ điểm ngoài / (trong + ngoài) tối thiểu', { min: 0, max: 1, step: 0.05 }, () => DEFAULT_FIT.ratio, (v) => { DEFAULT_FIT.ratio = v; }),
  field('F.minInside', 'F', 'Số điểm tối thiểu trong box (ít điểm)', { unit: 'điểm', min: 1, max: 500, step: 1, int: true, help: 'Guideline: box tối thiểu 6 điểm' }, () => DEFAULT_FIT.minInside, (v) => { DEFAULT_FIT.minInside = v; }),
  field('F.clear', 'F', 'Bỏ lớp điểm sát đáy box (khi chưa đo được mặt đường)', { unit: 'm', min: 0, max: 1, step: 0.01 }, () => DEFAULT_FIT.groundClear, (v) => { DEFAULT_FIT.groundClear = v; }),
  field('G.float', 'G', 'Đáy được CAO hơn mặt đường tối đa', { unit: 'm', min: 0, max: 1, step: 0.01 }, () => DEFAULT_GROUND.floatTol, (v) => { DEFAULT_GROUND.floatTol = v; }),
  field('G.sink', 'G', 'Đáy được THẤP hơn mặt đường tối đa', { unit: 'm', min: 0, max: 1, step: 0.01 }, () => DEFAULT_GROUND.sinkTol, (v) => { DEFAULT_GROUND.sinkTol = v; }),
  field('G.sigma', 'G', 'Chỉ báo khi lệch > k × độ bất định', { unit: 'k', min: 0, max: 10, step: 0.1 }, () => DEFAULT_GROUND.sigmaK, (v) => { DEFAULT_GROUND.sigmaK = v; }),
  field('G.range', 'G', 'Chỉ đo mặt đường trong bán kính', { unit: 'm', min: 5, max: 300, step: 5 }, () => DEFAULT_GROUND.maxRange, (v) => { DEFAULT_GROUND.maxRange = v; }),
  field('X.split', 'X', 'Outside liên tục tối thiểu để tách ID', { unit: 'frame', min: 2, max: 200, step: 1, int: true }, () => splitConfig.minFrames, (v) => { splitConfig.minFrames = v; }),
];
const BY_KEY = new Map(FIELDS.map((f) => [f.key, f]));
export const fieldsOf = (s: SectionId) => FIELDS.filter((f) => f.section === s);

/** Hợp lệ: số hữu hạn trong khoảng, số nguyên nếu `int`. */
export const validValue = (f: Field, v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && v >= f.min && v <= f.max && (!f.int || Number.isInteger(v));

const cloneSize = (s: ClassSize): ClassSize => ({ length: [...s.length], width: [...s.width], height: [...s.height] });
const DEFAULT_SIZE: Record<ClassKey, ClassSize> = Object.fromEntries(CLASS_KEYS.map((k) => [k, cloneSize(DEFAULT_QC_RULES.size[k])])) as Record<ClassKey, ClassSize>;
const DEFAULT_SYNC: ClassKey[] = [...DEFAULT_QC_RULES.scaleSyncGroups];

export const getSize = (k: ClassKey): ClassSize => DEFAULT_QC_RULES.size[k];
export const defaultSize = (k: ClassKey): ClassSize => DEFAULT_SIZE[k];
export const sizeChanged = (k: ClassKey) => DIMS.some((d) => getSize(k)[d][0] !== DEFAULT_SIZE[k][d][0] || getSize(k)[d][1] !== DEFAULT_SIZE[k][d][1]);
/** Khoảng kích thước hợp lệ: 0 ≤ min ≤ max ≤ 50 m. */
export const validRange = (lo: unknown, hi: unknown): boolean => typeof lo === 'number' && typeof hi === 'number' && Number.isFinite(lo) && Number.isFinite(hi) && lo >= 0 && hi <= 50 && lo <= hi;
export function setSizeRange(k: ClassKey, d: Dim, lo: number, hi: number): boolean {
  if (!validRange(lo, hi)) return false;
  DEFAULT_QC_RULES.size[k][d] = [lo, hi];
  return true;
}
export const resetSize = (k: ClassKey) => { DEFAULT_QC_RULES.size[k] = cloneSize(DEFAULT_SIZE[k]); };
export const syncGroups = (): ClassKey[] => DEFAULT_QC_RULES.scaleSyncGroups;
export function setSync(k: ClassKey, on: boolean) {
  const cur = new Set(DEFAULT_QC_RULES.scaleSyncGroups);
  if (on) cur.add(k); else cur.delete(k);
  DEFAULT_QC_RULES.scaleSyncGroups = CLASS_KEYS.filter((c) => cur.has(c));
}
export const syncChanged = () => JSON.stringify([...DEFAULT_QC_RULES.scaleSyncGroups].sort()) !== JSON.stringify([...DEFAULT_SYNC].sort());

export function setValue(key: string, v: number): boolean {
  const f = BY_KEY.get(key);
  if (!f || !validValue(f, v)) return false;
  // Z: không cho thấp nhất > cao nhất
  if (key === 'Z.min' && v > DEFAULT_QC_RULES.zMax) return false;
  if (key === 'Z.max' && v < DEFAULT_QC_RULES.zMin) return false;
  f.set(v);
  return true;
}
export const isChanged = (f: Field) => f.get() !== f.def;
export const sectionChanged = (s: SectionId) =>
  fieldsOf(s).some(isChanged) || (s === 'K' && CLASS_KEYS.some(sizeChanged)) || (s === 'S' && syncChanged());

export function resetSection(s: SectionId) {
  for (const f of fieldsOf(s)) f.set(f.def);
  if (s === 'K') for (const k of CLASS_KEYS) resetSize(k);
  if (s === 'S') DEFAULT_QC_RULES.scaleSyncGroups = [...DEFAULT_SYNC];
}
export const resetAll = () => { for (const s of SECTIONS) resetSection(s.id); };

/** Dữ liệu lưu: chỉ giá trị khác mặc định. */
export interface Persisted { n: Record<string, number>; size: Partial<Record<ClassKey, ClassSize>>; sync?: ClassKey[] }
export function toPersisted(): Persisted {
  const n: Record<string, number> = {};
  for (const f of FIELDS) if (isChanged(f)) n[f.key] = f.get();
  const size: Partial<Record<ClassKey, ClassSize>> = {};
  for (const k of CLASS_KEYS) if (sizeChanged(k)) size[k] = cloneSize(getSize(k));
  return { n, size, ...(syncChanged() ? { sync: [...DEFAULT_QC_RULES.scaleSyncGroups] } : {}) };
}
/** Áp dữ liệu đã lưu (hỏng thì bỏ từng phần); trước đó đặt lại mặc định. */
export function applyPersisted(raw: unknown): void {
  resetAll();
  if (!raw || typeof raw !== 'object') return;
  const p = raw as Partial<Persisted>;
  if (p.n && typeof p.n === 'object') for (const [k, v] of Object.entries(p.n)) setValue(k, v as number);
  if (p.size && typeof p.size === 'object') {
    for (const k of CLASS_KEYS) {
      const s = (p.size as Record<string, Partial<ClassSize> | undefined>)[k];
      if (!s) continue;
      for (const d of DIMS) { const r = s[d]; if (Array.isArray(r) && r.length === 2) setSizeRange(k, d, r[0] as number, r[1] as number); }
    }
  }
  if (Array.isArray(p.sync)) DEFAULT_QC_RULES.scaleSyncGroups = CLASS_KEYS.filter((c) => (p.sync as unknown[]).includes(c));
}

/** Mã của cấu hình ảnh hưởng tới số liệu nền (lệch / ít điểm / mặt đường): đổi thì kết quả đã tính không còn dùng. */
export const backgroundConfigKey = () => JSON.stringify([DEFAULT_GROUND, DEFAULT_FIT]);

/** Ngưỡng kích thước riêng theo object (số thứ tự object 1…): ưu tiên hơn ngưỡng theo class. */
export function setObjectOverrides(m: ReadonlyMap<number, ClassSize>): void {
  SIZE_OVERRIDES.clear();
  for (const [num, s] of m) SIZE_OVERRIDES.set(num, cloneSize(s));
}
export function cloneClassSize(s: ClassSize): ClassSize { return cloneSize(s); }
