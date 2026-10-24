import type { Cuboid } from './cuboid';
import { stateAt } from './interp';
import type { CvatTrack } from './types';

export interface OverlapConfig {
  ratio: number; // chồng box: phần giao trên hình chiếu từ trên / diện tích box nhỏ hơn (30%)
  minZ: number; // m: hai box phải chồng nhau theo chiều cao ít nhất mức này (người ngồi trên xe máy vẫn bị tính; hai vật xếp chồng trên-dưới thì không)
}
export const DEFAULT_OVERLAP: OverlapConfig = { ratio: 0.3, minZ: 0.2 };

type P = [number, number];

/** Bốn đỉnh hình chiếu từ trên của box (ngược chiều kim đồng hồ). sx dọc theo hướng box. */
export function footprint(c: Pick<Cuboid, 'x' | 'y' | 'yaw' | 'sx' | 'sy'>): P[] {
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw), hu = c.sx / 2, hv = c.sy / 2;
  return ([[hu, hv], [-hu, hv], [-hu, -hv], [hu, -hv]] as P[]).map(([a, b]) => [c.x + a * cos - b * sin, c.y + a * sin + b * cos] as P);
}

const area = (poly: P[]) => {
  let s = 0;
  for (let i = 0; i < poly.length; i++) { const [x1, y1] = poly[i]!, [x2, y2] = poly[(i + 1) % poly.length]!; s += x1 * y2 - x2 * y1; }
  return Math.abs(s) / 2;
};

/** Diện tích giao của hai đa giác LỒI ngược chiều kim đồng hồ (Sutherland–Hodgman). */
export function intersectionArea(subject: P[], clip: P[]): number {
  let out = subject;
  for (let i = 0; i < clip.length && out.length; i++) {
    const a = clip[i]!, b = clip[(i + 1) % clip.length]!;
    const side = (p: P) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
    const input = out;
    out = [];
    for (let j = 0; j < input.length; j++) {
      const p = input[j]!, q = input[(j + 1) % input.length]!;
      const sp = side(p), sq = side(q);
      if (sp >= 0) out.push(p);
      if ((sp >= 0) !== (sq >= 0)) {
        const t = sp / (sp - sq);
        out.push([p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t]);
      }
    }
  }
  return out.length >= 3 ? area(out) : 0;
}

/** Tỉ lệ chồng của hai box: giao hình chiếu / diện tích box nhỏ hơn. 0 nếu không chồng nhau theo chiều cao. */
export function overlapRatio(a: Cuboid, b: Cuboid, cfg: OverlapConfig = DEFAULT_OVERLAP): number {
  const z = Math.min(a.z + a.sz / 2, b.z + b.sz / 2) - Math.max(a.z - a.sz / 2, b.z - b.sz / 2);
  if (z < cfg.minZ) return 0;
  const small = Math.min(a.sx * a.sy, b.sx * b.sy);
  if (small <= 0) return 0;
  return intersectionArea(footprint(a), footprint(b)) / small;
}

export interface OverlapItem { a: number; b: number; frame: number; ratio: number } // a < b: số thứ tự object (ID hiển thị)
export interface OverlapPair { a: number; b: number; frames: number[]; max: number }

/**
 * Tìm mọi cặp object chồng lấn nhau ở từng frame (xét CHÉO giữa các ID, không chỉ từng ID riêng).
 * Chỉ xét frame cả hai đều có box (không outside). Lọc thô bằng đường tròn bao trước khi tính giao chính xác.
 */
export function findOverlaps(tracks: CvatTrack[], frames: number[], cfg: OverlapConfig = DEFAULT_OVERLAP): OverlapItem[] {
  const out: OverlapItem[] = [];
  for (const f of frames) {
    const live: { num: number; c: Cuboid; r: number }[] = [];
    tracks.forEach((t, i) => {
      const c = stateAt(t, f).cuboid;
      if (c) live.push({ num: i + 1, c, r: Math.hypot(c.sx, c.sy) / 2 });
    });
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const p = live[i]!, q = live[j]!;
        if (Math.hypot(p.c.x - q.c.x, p.c.y - q.c.y) > p.r + q.r) continue;
        const ratio = overlapRatio(p.c, q.c, cfg);
        if (ratio >= cfg.ratio) out.push({ a: p.num, b: q.num, frame: f, ratio });
      }
    }
  }
  return out;
}

/** Gom theo cặp object. */
export function groupPairs(items: OverlapItem[]): OverlapPair[] {
  const m = new Map<string, OverlapPair>();
  for (const it of items) {
    const k = `${it.a}:${it.b}`;
    const p = m.get(k) ?? { a: it.a, b: it.b, frames: [], max: 0 };
    p.frames.push(it.frame);
    p.max = Math.max(p.max, it.ratio);
    m.set(k, p);
  }
  return [...m.values()].sort((x, y) => x.a - y.a || x.b - y.b);
}
