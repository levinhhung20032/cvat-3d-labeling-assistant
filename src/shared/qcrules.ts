import type { Cuboid } from './cuboid';
import { stateAt } from './interp';
import { ruleHits, type MetricId, type Rule } from './alertRules';
import type { CvatTrack } from './types';

/**
 * Bộ luật QC theo file báo cáo QC của dự án (sheet Matrix): ký hiệu từng loại issue.
 * S = scale không đồng bộ, K = kích thước ngoài ngưỡng, Z = z ngoài ngưỡng, H = đổi hướng đột ngột,
 * O = chồng lấn (tính ở overlap.ts), D = quá xa.
 */
export type IssueKind = 'S' | 'K' | 'Z' | 'H' | 'O' | 'D';
export const ISSUE_NAMES: Record<IssueKind, string> = {
  S: 'Scale không đồng bộ', K: 'Kích thước ngoài ngưỡng', Z: 'Z ngoài ngưỡng', H: 'Đổi hướng đột ngột', O: 'Chồng lấn', D: 'Quá xa',
};
export const ISSUE_KINDS = Object.keys(ISSUE_NAMES) as IssueKind[];

export type ClassKey = 'vehicle' | 'two_wheel' | 'pedestrian';
export type Range = [number, number];
export interface ClassSize { length: Range; width: Range; height: Range }
/**
 * Rule cảnh báo do người dùng nhập (tab Threshold). Khác null thì `trackIssues` xét K Z H D S CHỈ theo rule này (không rule = không báo);
 * null (test, chưa nạp tab) thì dùng cấu hình mặc định `DEFAULT_QC_RULES` bên dưới. `job` là job đang mở, để khớp rule theo object.
 */
export const RULESET: { rules: Rule[] | null; job: number } = { rules: null, job: 0 };
/**
 * Luật S theo Dynamic size: panel đặt hàm cho biết object có KHÔNG dynamic (một size cho cả object) hay không, theo class / attribute /
 * công tắc riêng của JOB đang mở. Chưa đặt (test, chưa mở job) thì dùng `scaleSyncGroups`.
 */
export const SIZE_SYNC: { fn: ((track: CvatTrack, label: string, num?: number) => boolean) | null } = { fn: null };
export interface QcRuleConfig {
  size: Record<ClassKey, ClassSize>;
  sizeEps: number;
  scaleSyncGroups: ClassKey[];
  scaleSyncTol: number;
  zMin: number;
  zMax: number;
  maxRotationJumpDeg: number;
  maxDistance: number; // m, khoảng cách 3D từ tâm box tới gốc toạ độ (như tool QC)
}

export const DEFAULT_QC_RULES: QcRuleConfig = {
  size: {
    vehicle: { length: [3.2, 5.5], width: [1.6, 2.2], height: [1.5, 1.9] },
    two_wheel: { length: [1.5, 2.0], width: [0.6, 0.9], height: [1.5, 1.8] },
    pedestrian: { length: [0.65, 1.0], width: [0.65, 1.0], height: [1.2, 1.9] },
  },
  sizeEps: 0.001,
  scaleSyncGroups: ['vehicle'],
  scaleSyncTol: 0.01,
  zMin: -3,
  zMax: 3,
  maxRotationJumpDeg: 40,
  maxDistance: 80,
};

/** Tên nhãn CVAT → nhóm luật (null: Animal, Obstacle… chưa có ngưỡng nên không cảnh báo kích thước / hướng). */
export function classKey(label: string): ClassKey | null {
  const l = label.trim().toLowerCase();
  const n = l.replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const has = (names: string[]) => names.includes(n) || (n.endsWith('s') && names.includes(n.slice(0, -1)));
  if (has(['vehicle', 'car', 'truck', 'bus', 'van', 'suv', 'sedan', 'pickup', 'minibus'])) return 'vehicle';
  if (has(['two_wheel', 'two_wheeler', 'twowheel', 'motorbike', 'motorcycle', 'bicycle', 'bike'])) return 'two_wheel';
  if (has(['pedestrian', 'person', 'human', 'people'])) return 'pedestrian';
  return null;
}

/** 'T' = trôi box (vật đứng yên mà box nhích; tính chéo giữa các frame ở drift.ts, không nằm trong file QC). */
export type ExtraKind = 'T';
export interface FrameIssue { kind: IssueKind | ExtraKind; message: string }

const wrapDeg = (r: number) => {
  let d = (r * 180) / Math.PI;
  d = ((d + 180) % 360 + 360) % 360 - 180;
  return d;
};

/** Kích thước chuẩn của track (làm mốc cho luật S): trung vị (phần tử giữa, lấy bên trên khi chẵn) theo từng trục, như tool QC. */
function medianSize(boxes: Cuboid[]): { sx: number; sy: number; sz: number } | null {
  if (boxes.length < 2) return null;
  const med = (k: 'sx' | 'sy' | 'sz') => boxes.map((b) => b[k]).sort((a, b) => a - b)[Math.floor(boxes.length / 2)]!;
  return { sx: med('sx'), sy: med('sy'), sz: med('sz') };
}

/** Issue của từng frame của một track (trừ O, tính chéo giữa các object ở overlap.ts). */
export function trackIssues(track: CvatTrack, label: string, frames: number[], cfg: QcRuleConfig = DEFAULT_QC_RULES, num?: number): Map<number, FrameIssue[]> {
  const out = new Map<number, FrameIssue[]>();
  const add = (f: number, kind: IssueKind, message: string) => {
    const cur = out.get(f) ?? [];
    const same = cur.find((i) => i.kind === kind);
    if (same) { same.message += `; ${message}`; return; } // một mã lỗi mỗi frame, gộp thông báo
    out.set(f, [...cur, { kind, message }]);
  };
  const ck = classKey(label);
  const boxes = new Map<number, Cuboid>();
  for (const f of frames) { const c = stateAt(track, f).cuboid; if (c) boxes.set(f, c); }

  const syncOn = SIZE_SYNC.fn ? SIZE_SYNC.fn(track, label, num) : !RULESET.rules && !!ck && cfg.scaleSyncGroups.includes(ck);
  const ref = syncOn ? medianSize([...boxes.values()]) : null;
  const tol = cfg.scaleSyncTol + 1e-9; // tránh sai số số thực (4.24 − 4.23 > 0.01)
  for (const [f, c] of boxes) {
    if (RULESET.rules) {
      // Theo rule người dùng nhập: đo từng thuộc tính của box rồi để rule quyết định.
      const v: Partial<Record<MetricId, number>> = { length: c.sx, width: c.sy, height: c.sz, z: c.z, distance: Math.hypot(c.x, c.y, c.z) };
      const p = boxes.get(f - 1);
      if (p) v.yawJump = Math.abs(wrapDeg(c.yaw - p.yaw));
      if (ref) v.sizeDev = Math.max(Math.abs(c.sx - ref.sx), Math.abs(c.sy - ref.sy), Math.abs(c.sz - ref.sz));
      for (const h of ruleHits(RULESET.rules, { job: RULESET.job, label, num }, v)) add(f, h.code as IssueKind, h.message);
      continue;
    }
    const lim = ck ? cfg.size[ck] : null;
    if (lim) {
      const e = cfg.sizeEps;
      const bad: string[] = [];
      const chk = (name: string, v: number, r: Range) => { if (v < r[0] - e || v > r[1] + e) bad.push(`${name} ${v.toFixed(2)} (cho phép ${r[0]}–${r[1]})`); };
      chk('dài', c.sx, lim.length); chk('rộng', c.sy, lim.width); chk('cao', c.sz, lim.height);
      if (bad.length) add(f, 'K', `kích thước ngoài ngưỡng: ${bad.join(', ')}${ck === 'vehicle' && c.sx > lim.length[1] + e ? ' — có thể là xe bus/truck' : ''}`);
    }
    if (ref && (Math.abs(c.sx - ref.sx) > tol || Math.abs(c.sy - ref.sy) > tol || Math.abs(c.sz - ref.sz) > tol)) {
      add(f, 'S', `scale không đồng bộ: ${c.sx.toFixed(2)}×${c.sy.toFixed(2)}×${c.sz.toFixed(2)} so với ${ref.sx.toFixed(2)}×${ref.sy.toFixed(2)}×${ref.sz.toFixed(2)} (kích thước chuẩn = trung vị của object)`);
    }
    if (c.z < cfg.zMin || c.z > cfg.zMax) add(f, 'Z', `z = ${c.z.toFixed(2)} m ngoài [${cfg.zMin}, ${cfg.zMax}]`);
    const dist = Math.hypot(c.x, c.y, c.z);
    if (dist > cfg.maxDistance) add(f, 'D', `quá xa: ${dist.toFixed(0)} m (> ${cfg.maxDistance} m)`);
    if (ck) {
      const p = boxes.get(f - 1);
      if (p) {
        const d = Math.abs(wrapDeg(c.yaw - p.yaw));
        if (d > cfg.maxRotationJumpDeg) add(f, 'H', `đổi hướng đột ngột: ${d.toFixed(0)}° so với frame ${f - 1} (> ${cfg.maxRotationJumpDeg}°)`);
      }
    }
  }
  return out;
}
