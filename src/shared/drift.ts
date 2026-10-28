import { stateAt } from './interp';
import type { CvatTrack } from './types';

/**
 * Cảnh báo "trôi box": vật ĐỨNG YÊN theo thế giới nhưng box nhích. Toạ độ trong từng frame là theo ego (xe chạy nên vật đứng yên cũng
 * đổi toạ độ), vì vậy trước hết ước lượng chuyển động của ego giữa hai frame liền nhau từ chính các object (RANSAC trên phép biến
 * đổi cứng 2D: vật đứng yên chiếm đa số nên khớp với nhau, vật chuyển động bị loại như ngoại lai), cộng dồn thành toạ độ "thế giới"
 * của từng đoạn, rồi với mỗi object đứng yên (bước nhích giữa hai frame rất nhỏ) báo các frame mà box lệch quá ngưỡng so với vị trí
 * đứng yên của nó (trung vị).
 */
export interface DriftConfig {
  tol: number; // m: sai số để một object được coi là khớp với chuyển động ego khi ước lượng
  minPairDist: number; // m: hai object dùng để dựng phép biến đổi phải cách nhau tối thiểu (ổn định góc)
  minInliers: number; // số object khớp tối thiểu để chấp nhận ước lượng ego của một bước
  decideFrames: number; // số frame đầu (kể từ keyframe đầu của đoạn) dùng để quyết định vật đứng yên hay không; đoạn ngắn hơn thì không xét
  staticSpread: number; // m: trong `decideFrames` frame đầu, mọi vị trí thế giới lệch trung vị không quá mức này thì vật đứng yên
  warnDist: number; // m: lệch so với vị trí đứng yên (neo từ các frame đầu) vượt mức này thì cảnh báo
  departDist: number; // m: chuỗi lệch đạt tới mức này coi là vật bắt đầu chạy thật, không phải trôi box
  maxRansac: number; // số cặp thử tối đa mỗi bước
}
export const DEFAULT_DRIFT: DriftConfig = { tol: 0.25, minPairDist: 3, minInliers: 3, decideFrames: 5, staticSpread: 0.2, warnDist: 0.4, departDist: 1.5, maxRansac: 4000 };

interface Xf { th: number; tx: number; ty: number } // p' = R(th)·p + t
const rot = (th: number, x: number, y: number): [number, number] => [Math.cos(th) * x - Math.sin(th) * y, Math.sin(th) * x + Math.cos(th) * y];
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** Phép biến đổi cứng 2D khớp a → b theo bình phương tối thiểu (Kabsch 2D). */
function fitRigid(a: [number, number][], b: [number, number][]): Xf {
  const n = a.length;
  let cax = 0, cay = 0, cbx = 0, cby = 0;
  for (let i = 0; i < n; i++) { cax += a[i]![0]; cay += a[i]![1]; cbx += b[i]![0]; cby += b[i]![1]; }
  cax /= n; cay /= n; cbx /= n; cby /= n;
  let dot = 0, cross = 0;
  for (let i = 0; i < n; i++) {
    const ax = a[i]![0] - cax, ay = a[i]![1] - cay, bx = b[i]![0] - cbx, by = b[i]![1] - cby;
    dot += ax * bx + ay * by; cross += ax * by - ay * bx;
  }
  const th = Math.atan2(cross, dot);
  const [rx, ry] = rot(th, cax, cay);
  return { th, tx: cbx - rx, ty: cby - ry };
}

/** Chuyển động ego giữa hai frame: phép biến đổi T với p(frame sau) = T(p(frame trước)) cho vật đứng yên; null nếu không đủ cơ sở. */
export function estimateEgo(a: [number, number][], b: [number, number][], cfg: DriftConfig = DEFAULT_DRIFT): Xf | null {
  const n = a.length;
  if (n < cfg.minInliers) return null;
  const err = (t: Xf, i: number) => { const [x, y] = rot(t.th, a[i]![0], a[i]![1]); return Math.hypot(x + t.tx - b[i]![0], y + t.ty - b[i]![1]); };
  let best: number[] = [], bestSum = Infinity;
  let tried = 0;
  for (let i = 0; i < n && tried < cfg.maxRansac; i++) {
    for (let j = i + 1; j < n && tried < cfg.maxRansac; j++) {
      const da = Math.hypot(a[j]![0] - a[i]![0], a[j]![1] - a[i]![1]), db = Math.hypot(b[j]![0] - b[i]![0], b[j]![1] - b[i]![1]);
      if (da < cfg.minPairDist || Math.abs(da - db) > cfg.tol) continue; // khoảng cách hai vật phải giữ nguyên nếu cùng đứng yên
      tried++;
      const th = wrap(Math.atan2(b[j]![1] - b[i]![1], b[j]![0] - b[i]![0]) - Math.atan2(a[j]![1] - a[i]![1], a[j]![0] - a[i]![0]));
      const [rx, ry] = rot(th, a[i]![0], a[i]![1]);
      const t: Xf = { th, tx: b[i]![0] - rx, ty: b[i]![1] - ry };
      const inl: number[] = [];
      let sum = 0;
      for (let k = 0; k < n; k++) { const e = err(t, k); if (e <= cfg.tol) { inl.push(k); sum += e; } }
      if (inl.length > best.length || (inl.length === best.length && sum < bestSum)) { best = inl; bestSum = sum; }
    }
  }
  if (best.length < cfg.minInliers) return null;
  // tinh chỉnh bằng bình phương tối thiểu trên các object khớp, rồi chọn lại tập khớp một lần
  let t = fitRigid(best.map((k) => a[k]!), best.map((k) => b[k]!));
  const inl2 = a.map((_, k) => k).filter((k) => err(t, k) <= cfg.tol);
  if (inl2.length >= cfg.minInliers) t = fitRigid(inl2.map((k) => a[k]!), inl2.map((k) => b[k]!));
  return t;
}

export interface DriftFrame { f: number; dist: number } // dist: m lệch so với vị trí đứng yên
export interface DriftInfo { num: number; frames: DriftFrame[]; steps: number; medianStep: number }

const median = (v: number[]) => { const s = [...v].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2) : 0; };

/**
 * Với mỗi object đứng yên (≥ minSteps bước, bước nhích trung vị ≤ staticStep trong cùng một đoạn liên tục) trả các frame mà box lệch
 * quá warnDist so với vị trí đứng yên (trung vị) của nó. Object đang chuyển động bình thường không bị xét.
 */
export function findDrift(tracks: CvatTrack[], frames: number[], cfg: DriftConfig = DEFAULT_DRIFT): Map<number, DriftInfo> {
  const sorted = [...frames].sort((x, y) => x - y);
  // toạ độ tâm (x, y) của mọi object ở mọi frame
  const pos = new Map<number, Map<number, [number, number]>>();
  for (const f of sorted) {
    const m = new Map<number, [number, number]>();
    tracks.forEach((t, i) => { const c = stateAt(t, f).cuboid; if (c) m.set(i, [c.x, c.y]); });
    pos.set(f, m);
  }
  // chuyển động ego từng bước và toạ độ thế giới (so với frame đầu của đoạn)
  const cum = new Map<number, { th: number; tx: number; ty: number; seg: number }>();
  let seg = 0;
  let cur: { th: number; tx: number; ty: number } | null = null;
  for (let k = 0; k < sorted.length; k++) {
    const f = sorted[k]!;
    if (k === 0) { cur = { th: 0, tx: 0, ty: 0 }; cum.set(f, { ...cur, seg }); continue; }
    const prev = sorted[k - 1]!;
    const pa = pos.get(prev)!, pb = pos.get(f)!;
    const ids = [...pb.keys()].filter((i) => pa.has(i));
    const T = f - prev === 1 ? estimateEgo(ids.map((i) => pa.get(i)!), ids.map((i) => pb.get(i)!), cfg) : null;
    if (!T || !cur) { seg++; cur = { th: 0, tx: 0, ty: 0 }; cum.set(f, { ...cur, seg }); continue; } // không ước lượng được → đoạn mới
    // C_f(p) = C_{f-1}(T^-1 p): R' = Rc·R(-th), t' = tc − R'·t
    const th2 = wrap(cur.th - T.th);
    const [rtx, rty] = rot(th2, T.tx, T.ty);
    cur = { th: th2, tx: cur.tx - rtx, ty: cur.ty - rty };
    cum.set(f, { ...cur, seg });
  }
  const world = (f: number, p: [number, number]): [number, number] => { const c = cum.get(f)!; const [x, y] = rot(c.th, p[0], p[1]); return [x + c.tx, y + c.ty]; };

  const out = new Map<number, DriftInfo>();
  tracks.forEach((_, i) => {
    // chuỗi vị trí thế giới theo từng đoạn liên tục
    const bySeg = new Map<number, { f: number; w: [number, number] }[]>();
    // đoạn = chuỗi frame liền nhau có box trong cùng một đoạn ego (khoảng trống, ví dụ outside, cắt đoạn)
    let run = 0, lastF = -2;
    for (const f of sorted) {
      const p = pos.get(f)!.get(i);
      if (!p) continue;
      if (f !== lastF + 1) run++;
      lastF = f;
      const s = cum.get(f)!.seg * 100000 + run;
      const l = bySeg.get(s) ?? [];
      l.push({ f, w: world(f, p) });
      bySeg.set(s, l);
    }
    const warn: DriftFrame[] = [];
    let steps = 0;
    const allSteps: number[] = [];
    for (const list of bySeg.values()) {
      for (let k = 1; k < list.length; k++) allSteps.push(Math.hypot(list[k]!.w[0] - list[k - 1]!.w[0], list[k]!.w[1] - list[k - 1]!.w[1]));
      steps += Math.max(0, list.length - 1);
      // Quyết định đứng yên hay không CHỈ từ `decideFrames` frame đầu kể từ keyframe đầu của đoạn: nếu cả cụm nằm trong `staticSpread`
      // quanh vị trí trung vị của nó thì vật đứng yên, và vị trí trung vị đó là điểm neo để đo trôi ở các frame sau.
      if (list.length < cfg.decideFrames) continue;
      const head = list.slice(0, cfg.decideFrames);
      const ax = median(head.map((q) => q.w[0])), ay = median(head.map((q) => q.w[1]));
      if (Math.max(...head.map((q) => Math.hypot(q.w[0] - ax, q.w[1] - ay))) > cfg.staticSpread) continue; // đang chuyển động ngay từ đầu
      // Các frame sau neo: chuỗi lệch liên tục quá warnDist mà đạt tới departDist là vật BẮT ĐẦU chạy thật (không báo); chưa tới thì là trôi box.
      let run: DriftFrame[] = [];
      const flush = () => { if (run.length && Math.max(...run.map((r) => r.dist)) < cfg.departDist) warn.push(...run); run = []; };
      for (const q of list.slice(cfg.decideFrames)) {
        const d = Math.hypot(q.w[0] - ax, q.w[1] - ay);
        if (d > cfg.warnDist) run.push({ f: q.f, dist: d }); else flush();
      }
      flush();
    }
    if (warn.length) out.set(i + 1, { num: i + 1, frames: warn.sort((x, y) => x.f - y.f), steps, medianStep: median(allSteps) });
  });
  return out;
}
