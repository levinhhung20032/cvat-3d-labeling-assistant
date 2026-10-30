import { DEFAULT_GROUND, enforceConsistency, groundSnap, pwGroundPlane, type GroundResult } from '../shared/ground';
import { stateAt } from '../shared/interp';
import type { CvatTrack } from '../shared/types';
import { setSegForced, segOf } from './groundSeg';
import { localize, type Local } from './render';
import { pointClouds } from './stores';

/**
 * So sánh hai nguồn mặt đường cho lỗi G (đáy lơ lửng / chìm): cách cũ (G.pw = 0) và Patchwork++ (mức đang đặt ở G.pw, nếu đang tắt thì
 * mức 2), trên cùng các cặp (object, frame) đã có point cloud. Chỉ số tổng hợp, không xuất toạ độ hay point cloud.
 */
export interface Totals { measured: number; none: number; warn: number; ambiguous: number; confident: number }
export interface Worst { num: number; f: number; range: number; d: number; n: number; rms: number }
export interface Diff { num: number; f: number; range: number; warnA: boolean; warnB: boolean; dzA: number | null; dzB: number | null; noteB: string }
export interface Bucket { measured: number; warnA: number; warnB: number }
/** Độ khớp mặt đất Patchwork++ với mặt đường cách cũ đo CHẮC (confident), theo tầm: n ca, PW có mặt đất ở m ca, chênh trung vị và p90 của |chênh − trung vị| (m). */
export interface Agree {
  label: string; n: number; withPw: number; med: number; p90: number;
  /** Chỉ các ca mặt đường fit chất lượng tốt (≥ GATE_N ô, phần dư ≤ GATE_RMS): số ca, chênh trung vị, p90. */
  gateN: number; gateMed: number; gateP90: number;
  /** Trong nhóm qua cổng: còn lại sau kiểm tra nhất quán theo thời gian (so với mặt đường các frame kề), chênh trung vị, p90. */
  consKept: number; consMed: number; consP90: number;
}
export const GATE_N = 4, GATE_RMS = 0.03;
export interface CompareReport {
  mode: number; // mức Patchwork++ đã dùng cho cột "Patchwork++"
  pairs: number; // số cặp (object, frame) đã đo
  noCloud: number; // số cặp bị bỏ vì frame chưa tải point cloud
  a: Totals; b: Totals;
  buckets: { label: string; b: Bucket }[];
  agree: Agree[];
  worst: Worst[]; // ca cách cũ đo chắc mà mặt phẳng từ điểm mặt đất lệch nhiều nhất (để kiểm bằng mắt)
  ptsKept: number; ptsDropped: number; // mức 4: kết quả Patchwork++ đủ tin còn lại / bị loại vì không nhất quán theo thời gian
  unconfidentGate: number; // trong số ca cách cũ không đo chắc: số ca Patchwork++ có mặt đường chất lượng tốt (qua cổng)
  unconfident: number; unconfidentPw: number; // ca cách cũ không đo chắc (kể cả không đo được) / trong đó PW có mặt đất dưới tâm box
  diffs: Diff[]; diffTotal: number;
  segMs: number; // ms trung bình để phân tách một frame bằng Patchwork++
  frames: number;
}

const BUCKETS: [string, number][] = [['< 15 m', 15], ['15–40 m', 40], ['40–80 m', Infinity]];
const MAX_DIFFS = 80;
const tot = (): Totals => ({ measured: 0, none: 0, warn: 0, ambiguous: 0, confident: 0 });
const add = (t: Totals, g: GroundResult | null) => {
  t.measured++;
  if (!g) { t.none++; return; }
  if (g.warn) t.warn++;
  if (g.ambiguous) t.ambiguous++;
  if (g.confident) t.confident++;
};

export async function comparePw(
  items: { num: number; track: CvatTrack }[], start: number, stop: number,
  onProgress: (done: number, total: number) => void, ctl: { cancelled: boolean },
): Promise<CompareReport | null> {
  const mode = DEFAULT_GROUND.pw > 0 ? DEFAULT_GROUND.pw : 4;
  const cfgA = { ...DEFAULT_GROUND, pw: 0 }, cfgB = { ...DEFAULT_GROUND, pw: mode };
  const rep: CompareReport = {
    mode, pairs: 0, noCloud: 0, a: tot(), b: tot(), diffs: [], diffTotal: 0, segMs: 0, frames: 0,
    buckets: BUCKETS.map(([label]) => ({ label, b: { measured: 0, warnA: 0, warnB: 0 } })), agree: [], worst: [], unconfident: 0, unconfidentPw: 0, unconfidentGate: 0, ptsKept: 0, ptsDropped: 0,
  };
  const diffsBy: number[][] = BUCKETS.map(() => []);
  const nBy = BUCKETS.map(() => 0);
  const gateBy: number[][] = BUCKETS.map(() => []);
  const consBy: number[][] = BUCKETS.map(() => []);
  const passGate = (r: { n: number; rms: number } | null) => !!r && r.n >= DEFAULT_GROUND.pwMinPts && r.rms <= DEFAULT_GROUND.pwMaxRms;
  interface Cell { num: number; f: number; range: number; z: number; ga: GroundResult | null; gb: GroundResult | null; pp: ReturnType<typeof pwGroundPlane> }
  setSegForced(true); // phải có nhãn Patchwork++ dù G.pw đang tắt
  try {
    // Xếp theo frame (tăng dần) để Patchwork++ học ngưỡng theo đúng thứ tự frame của job.
    const work: { f: number; num: number; track: CvatTrack }[] = [];
    for (let f = start; f <= stop; f++) for (const it of items) work.push({ f, ...it });
    let segTime = 0, done = 0, lastFrame = -1;
    const cells: Cell[] = [];
    for (const { f, num, track } of work) {
      if (ctl.cancelled) return null;
      const c = stateAt(track, f).cuboid;
      if (!c) { done++; continue; }
      const pc = pointClouds.peek(f);
      if (!pc) { rep.noCloud++; done++; continue; }
      if (f !== lastFrame) {
        lastFrame = f;
        const t0 = performance.now();
        segOf(pc);
        segTime += performance.now() - t0;
        rep.frames++;
      }
      const loc = localize(pc, c, 16, f, true); // gộp điểm lân cận theo G.pwPool (so sánh mặc định dùng mức 4)
      const at = { cu: 0, cv: 0, cw: 0, range: Math.hypot(c.x, c.y) };
      const ga = groundSnap(loc, c.sx, c.sy, c.sz, at, cfgA);
      const gb = groundSnap(loc, c.sx, c.sy, c.sz, at, cfgB);
      cells.push({ num, f, range: at.range, z: c.z, ga, gb, pp: pwGroundPlane(loc, c.sx, c.sy, at, cfgB) });
      if (++done % 4 === 0) { onProgress(done, work.length); await new Promise((r) => setTimeout(r, 0)); }
    }
    // Kiểm tra nhất quán theo thời gian theo từng object (mốc: mặt đường các frame kề đủ tin), rồi mới thống kê.
    const byObj = new Map<number, Cell[]>();
    for (const x of cells) { const l = byObj.get(x.num); if (l) l.push(x); else byObj.set(x.num, [x]); }
    for (const list of byObj.values()) {
      const real = enforceConsistency(list.map((x) => ({ f: x.f, z: x.z, range: x.range, g: x.gb })), cfgB);
      // Phép thử hiệu quả của bộ lọc: ở các ca cách cũ đo chắc, coi mặt phẳng Patchwork++ (qua cổng) là kết quả 'pts', mốc = mặt đường cũ.
      const virt = enforceConsistency(list.map((x, i) => ({
        f: x.f, z: x.z, range: x.range, ref: x.ga?.confident ? x.ga : real[i],
        g: x.ga?.confident && x.pp && passGate(x.pp) ? { ...x.ga, pw: 'pts' as const, groundW: x.pp.c + DEFAULT_GROUND.pwLift } : null,
      })), cfgB);
      list.forEach((x, i) => {
        const { num, f, range, ga, pp } = x;
        const gb = real[i] ?? null;
        rep.pairs++;
        add(rep.a, ga); add(rep.b, gb);
        if (gb?.pw === 'pts') { if (gb.inconsistent) rep.ptsDropped++; else if (gb.confident) rep.ptsKept++; }
        if (range <= DEFAULT_GROUND.maxRange) {
          const bk = rep.buckets[BUCKETS.findIndex(([, hi]) => range < hi)]!.b;
          bk.measured++;
          if (ga?.warn) bk.warnA++;
          if (gb?.warn) bk.warnB++;
        }
        const bi = BUCKETS.findIndex(([, hi]) => range < hi);
        if (ga?.confident) {
          nBy[bi]!++;
          if (pp) {
            const dd = pp.c + DEFAULT_GROUND.pwLift - ga.groundW;
            diffsBy[bi]!.push(dd);
            rep.worst.push({ num, f, range, d: dd, n: pp.n, rms: pp.rms });
            if (rep.worst.length > 40) { rep.worst.sort((x2, y2) => Math.abs(y2.d) - Math.abs(x2.d)); rep.worst.length = 12; }
            if (passGate(pp)) { gateBy[bi]!.push(dd); if (virt[i] && !virt[i]!.inconsistent) consBy[bi]!.push(dd); }
          }
        } else {
          rep.unconfident++;
          if (pp) rep.unconfidentPw++;
          if (passGate(pp)) rep.unconfidentGate++;
        }
        const wa = !!ga?.warn, wb = !!gb?.warn;
        if (wa !== wb) {
          rep.diffTotal++;
          if (rep.diffs.length < MAX_DIFFS) {
            rep.diffs.push({ num, f, range, warnA: wa, warnB: wb, dzA: ga?.dz ?? null, dzB: gb?.dz ?? null, noteB: gb ? (gb.pw === 'pts' ? `${gb.n} điểm mặt đất` : gb.pw === 'road' ? `mặt đường PW, ${gb.nSectors} ô` : gb.pw === 'tier' ? 'chọn tầng' : gb.ambiguous ? 'mơ hồ' : `${gb.nSectors} cung`) : 'không đo được' });
          }
        }
      });
    }
    onProgress(work.length, work.length);
    const q = (xs: number[], p: number) => (xs.length ? xs[Math.min(xs.length - 1, Math.floor(p * (xs.length - 1)))]! : 0);
    rep.agree = BUCKETS.map(([label], i) => {
      const d = [...diffsBy[i]!].sort((a, b) => a - b);
      const med = q(d, 0.5);
      const dev = d.map((x) => Math.abs(x - med)).sort((a, b) => a - b);
      const g = [...gateBy[i]!].sort((a, b) => a - b);
      const gm = q(g, 0.5);
      const gdev = g.map((x) => Math.abs(x - gm)).sort((a, b) => a - b);
      const cs = [...consBy[i]!].sort((x, y) => x - y);
      const cm = q(cs, 0.5);
      const cdev = cs.map((x) => Math.abs(x - cm)).sort((x, y) => x - y);
      return { label, n: nBy[i]!, withPw: d.length, med, p90: q(dev, 0.9), gateN: g.length, gateMed: gm, gateP90: q(gdev, 0.9), consKept: cs.length, consMed: cm, consP90: q(cdev, 0.9) };
    });
    rep.worst.sort((x, y) => Math.abs(y.d) - Math.abs(x.d));
    rep.worst.length = Math.min(rep.worst.length, 12);
    rep.segMs = rep.frames ? segTime / rep.frames : 0;
    return rep;
  } finally {
    setSegForced(false);
  }
}
