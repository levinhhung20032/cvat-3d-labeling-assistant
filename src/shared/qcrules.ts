import type { Cuboid } from './cuboid';
import { stateAt } from './interp';
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
type Range = [number, number];
export interface QcRuleConfig {
  size: Record<ClassKey, { length: Range; width: Range; height: Range }>;
  sizeEps: number;
  scaleSyncGroups: ClassKey[];
  scaleSyncTol: number;
  zMin: number;
  zMax: number;
  maxRotationJumpDeg: number;
  maxDistance: number; // m, tính theo khoảng cách ngang tâm box tới gốc ego
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
  maxDistance: 100,
};

/** Tên nhãn CVAT → nhóm luật (null: Animal, Obstacle… chưa có ngưỡng nên không cảnh báo kích thước / hướng). */
export function classKey(label: string): ClassKey | null {
  const l = label.trim().toLowerCase();
  if (l === 'vehicle' || l === 'vehicles') return 'vehicle';
  if (l === 'two-wheels' || l === 'two-wheel' || l === 'two_wheel' || l === 'two_wheels') return 'two_wheel';
  if (l === 'pedestrian' || l === 'pedestrians') return 'pedestrian';
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

/** Kích thước hay gặp nhất của track (làm mốc cho luật S). */
function modeSize(boxes: Cuboid[], tol: number): { sx: number; sy: number; sz: number } | null {
  const first = boxes[0];
  if (!first) return null;
  const groups: { ref: Cuboid; n: number }[] = [];
  for (const b of boxes) {
    const g = groups.find((x) => Math.abs(x.ref.sx - b.sx) <= tol && Math.abs(x.ref.sy - b.sy) <= tol && Math.abs(x.ref.sz - b.sz) <= tol);
    if (g) g.n++; else groups.push({ ref: b, n: 1 });
  }
  groups.sort((a, b) => b.n - a.n);
  return groups[0]!.ref;
}

/** Issue của từng frame của một track (trừ O, tính chéo giữa các object ở overlap.ts). */
export function trackIssues(track: CvatTrack, label: string, frames: number[], cfg: QcRuleConfig = DEFAULT_QC_RULES): Map<number, FrameIssue[]> {
  const out = new Map<number, FrameIssue[]>();
  const add = (f: number, kind: IssueKind, message: string) => out.set(f, [...(out.get(f) ?? []), { kind, message }]);
  const ck = classKey(label);
  const boxes = new Map<number, Cuboid>();
  for (const f of frames) { const c = stateAt(track, f).cuboid; if (c) boxes.set(f, c); }

  const ref = ck && cfg.scaleSyncGroups.includes(ck) ? modeSize([...boxes.values()], cfg.scaleSyncTol) : null;
  for (const [f, c] of boxes) {
    if (ck) {
      const lim = cfg.size[ck], e = cfg.sizeEps;
      const bad: string[] = [];
      const chk = (name: string, v: number, r: Range) => { if (v < r[0] - e || v > r[1] + e) bad.push(`${name} ${v.toFixed(2)} (cho phép ${r[0]}–${r[1]})`); };
      chk('dài', c.sx, lim.length); chk('rộng', c.sy, lim.width); chk('cao', c.sz, lim.height);
      if (bad.length) add(f, 'K', `kích thước ngoài ngưỡng: ${bad.join(', ')}${ck === 'vehicle' && c.sx > lim.length[1] + e ? ' — có thể là xe bus/truck' : ''}`);
    }
    if (ref && (Math.abs(c.sx - ref.sx) > cfg.scaleSyncTol || Math.abs(c.sy - ref.sy) > cfg.scaleSyncTol || Math.abs(c.sz - ref.sz) > cfg.scaleSyncTol)) {
      add(f, 'S', `scale không đồng bộ: ${c.sx.toFixed(2)}×${c.sy.toFixed(2)}×${c.sz.toFixed(2)} so với ${ref.sx.toFixed(2)}×${ref.sy.toFixed(2)}×${ref.sz.toFixed(2)} (kích thước hay gặp nhất của object)`);
    }
    if (c.z < cfg.zMin || c.z > cfg.zMax) add(f, 'Z', `z = ${c.z.toFixed(2)} m ngoài [${cfg.zMin}, ${cfg.zMax}]`);
    const dist = Math.hypot(c.x, c.y);
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
