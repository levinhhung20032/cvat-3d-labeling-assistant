/**
 * Patchwork++ — phân tách điểm mặt đất / không phải mặt đất cho MỘT frame point cloud. Viết lại bằng TypeScript theo mã nguồn
 * url-kaist/patchwork-plusplus (cpp/patchworkpp/src/patchworkpp.cpp), giữ đúng các bước: CZM → R-VPF → R-GPF → A-GLE → TGR.
 * Khác bản gốc: intensity của job thang 0–255 (bản gốc 0–1) nên ngưỡng RNR là 51 (= 0,2 · 255); không có intensity thì RNR chỉ dùng
 * điều kiện hình học (góc nhìn và độ sâu dưới mặt đất); gốc toạ độ của dự án nằm trên mặt đường ngay dưới lidar nên z được dời lên `sensorHeight` trước khi chạy.
 * Thử nghiệm (chủ dự án 2026-10-30): ngưỡng cao / phẳng học dần qua các frame như bản gốc.
 *
 * ---------------------------------------------------------------------------------------------------------------------------------
 * BSD 2-Clause License
 *
 * Copyright (c) 2024, Urban Robotics Lab. @ KAIST
 *
 * Redistribution and use in source and binary forms, with or without modification, are permitted provided that the following
 * conditions are met:
 *
 * 1. Redistributions of source code must retain the above copyright notice, this list of conditions and the following disclaimer.
 *
 * 2. Redistributions in binary form must reproduce the above copyright notice, this list of conditions and the following
 *    disclaimer in the documentation and/or other materials provided with the distribution.
 *
 * THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT
 * NOT LIMITED TO, THE IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE DISCLAIMED. IN NO EVENT SHALL
 * THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL DAMAGES
 * (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
 * INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE
 * OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
 * ---------------------------------------------------------------------------------------------------------------------------------
 */

export interface PatchworkConfig {
  sensorHeight: number; // m: lidar cao hơn gốc toạ độ (mặt đường dưới xe) bao nhiêu; chỉ cần gần đúng (tự cập nhật từ vành gần nhất)
  numIter: number; numLpr: number; numMinPts: number;
  thSeeds: number; thDist: number; thSeedsV: number; thDistV: number;
  maxRange: number; minRange: number;
  uprightnessThr: number; adaptiveSeedMargin: number;
  rnr: boolean; rnrVerAngleDeg: number; rnrDepth: number; rnrIntensity: number; // RNR: góc nhìn < rnrVerAngleDeg, thấp hơn mặt đất > rnrDepth và (nếu có intensity) intensity < rnrIntensity
  rvpf: boolean; tgr: boolean; adaptive: boolean; // adaptive: học ngưỡng cao / phẳng qua các frame (A-GLE)
  sectors: number[]; rings: number[]; // theo 4 vùng của CZM
  ringsOfInterest: number; maxStorage: number;
  /**
   * Chống điểm nhiễu / phản chiếu nằm sâu dưới mặt đường (bản gốc để chúng kéo mặt phẳng xuống ở vùng xa): điểm mồi chỉ bắt đầu từ mép
   * dưới ĐỦ DÀY (seedDense điểm trong seedWin m), và điểm mặt đất tính theo khoảng cách TUYỆT ĐỐI tới mặt phẳng. Tắt = như bản gốc.
   */
  robust: boolean; seedDense: number; seedWin: number;
  /**
   * Tiền nghiệm từ hiệu chỉnh của dự án: gốc toạ độ nằm trên mặt đường dưới lidar, nên mặt đường ở cách gốc r mét chỉ có thể nằm trong
   * |z| ≤ priorMargin + priorSlope · r (độ dốc tối đa ≈ priorSlope, mặc định 8%). Điểm ngoài khoảng đó (lớp phản chiếu sâu dưới đường, thân xe / nhà ở
   * trên) không được dùng để dựng ô mặt đất. Job 9999: không có tiền nghiệm này thì lớp phản chiếu dày ở sâu 3,6 m bị nhận là mặt đất.
   */
  prior: boolean; priorMargin: number; priorSlope: number;
}

/** Tham số mặc định của bản gốc (Params()), trừ sensorHeight (1.723 m ở KITTI) và RNR (bản gốc cần intensity, độ sâu 0.8 m). */
export const DEFAULT_PATCHWORK: PatchworkConfig = {
  sensorHeight: 1.7, numIter: 3, numLpr: 20, numMinPts: 10,
  thSeeds: 0.125, thDist: 0.125, thSeedsV: 0.25, thDistV: 0.1,
  maxRange: 80, minRange: 2.7, uprightnessThr: 0.707, adaptiveSeedMargin: -1.2,
  rnr: true, rnrVerAngleDeg: -15, rnrDepth: 0.8, rnrIntensity: 51, rvpf: true, tgr: true, adaptive: true,
  sectors: [16, 32, 54, 32], rings: [2, 4, 4, 4], ringsOfInterest: 4, maxStorage: 1000,
  robust: true, seedDense: 4, seedWin: 0.05,
  prior: true, priorMargin: 0.5, priorSlope: 0.08,
};

/** Nhãn từng điểm. OTHER: đã xét, không phải mặt đất; UNKNOWN: không xét được (ngoài tầm, ô quá ít điểm). */
export const PW_OTHER = 0, PW_GROUND = 1, PW_REFLECT = 2, PW_UNKNOWN = 3;

/** Một ô (patch) của CZM đã fit, toạ độ như đầu vào (gốc trên mặt đường): mặt phẳng nx·x + ny·y + nz·z + d = 0. */
export interface PwPatch {
  zone: number; ring: number; sector: number; // ring: chỉ số vành tính chung mọi vùng (concentric)
  nx: number; ny: number; nz: number; d: number;
  mx: number; my: number; mz: number; // tâm các điểm mặt đất của ô
  flatness: number; ground: boolean; n: number;
}

/** Mặt đường z = a·x + b·y + c (toạ độ đầu vào) fit từ các ô mặt đất lân cận; rms: phần dư (m), n: số ô dùng. */
export interface PwRoad { a: number; b: number; c: number; rms: number; n: number }

export interface PwResult {
  label: Uint8Array;
  patches: (PwPatch | null)[]; // theo chỉ số ô
  /** Độ cao mặt đất (z, toạ độ đầu vào) tại (x, y) theo mặt phẳng của ô chứa điểm đó; null nếu ô không phải mặt đất / ngoài tầm. */
  heightAt(x: number, y: number): number | null;
  /**
   * Mặt đường quanh (x, y): bình phương tối thiểu qua tâm các ô MẶT ĐẤT trong bán kính `radius` (ô chứa chính vật thể không phải mặt đất
   * nên tự bị bỏ, mặt đường suy ra từ các ô xung quanh — dùng được cả khi vật che mặt đường dưới nó). Loại dần ô lệch > 6 cm; dốc quá
   * tanMax thì dùng mặt ngang. Dưới 3 ô: dùng mặt phẳng của ô gần nhất (rms 5 cm). null nếu không có ô mặt đất nào trong bán kính.
   */
  road(x: number, y: number, radius: number, tanMax: number): PwRoad | null;
}

/** Trị riêng (giảm dần) và vector riêng (cột) của ma trận đối xứng 3×3 [a00 a01 a02 a11 a12 a22], phương pháp Jacobi. */
export function eigSym3(m: [number, number, number, number, number, number]): { values: [number, number, number]; vectors: number[][] } {
  const a = [[m[0], m[1], m[2]], [m[1], m[3], m[4]], [m[2], m[4], m[5]]];
  const v = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let sweep = 0; sweep < 32; sweep++) {
    const off = a[0]![1]! ** 2 + a[0]![2]! ** 2 + a[1]![2]! ** 2;
    if (off < 1e-30) break;
    for (const [p, q] of [[0, 1], [0, 2], [1, 2]] as const) {
      const apq = a[p]![q]!;
      if (Math.abs(apq) < 1e-300) continue;
      const theta = (a[q]![q]! - a[p]![p]!) / (2 * apq);
      const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
      const c = 1 / Math.sqrt(t * t + 1), s = t * c;
      for (let k = 0; k < 3; k++) {
        const akp = a[k]![p]!, akq = a[k]![q]!;
        a[k]![p] = c * akp - s * akq; a[k]![q] = s * akp + c * akq;
      }
      for (let k = 0; k < 3; k++) {
        const apk = a[p]![k]!, aqk = a[q]![k]!;
        a[p]![k] = c * apk - s * aqk; a[q]![k] = s * apk + c * aqk;
      }
      for (let k = 0; k < 3; k++) {
        const vkp = v[k]![p]!, vkq = v[k]![q]!;
        v[k]![p] = c * vkp - s * vkq; v[k]![q] = s * vkp + c * vkq;
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j]![j]! - a[i]![i]!);
  return {
    values: order.map((i) => Math.max(0, a[i]![i]!)) as [number, number, number],
    vectors: order.map((i) => [v[0]![i]!, v[1]![i]!, v[2]![i]!]),
  };
}

const meanStd = (xs: number[]): [number, number] => {
  if (xs.length <= 1) return [0, 0]; // như calc_mean_stdev của bản gốc: ít hơn 2 mẫu thì giữ 0
  const m = xs.reduce((s, x) => s + x, 0) / xs.length;
  return [m, Math.sqrt(xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1))];
};

interface Plane { nx: number; ny: number; nz: number; d: number; mx: number; my: number; mz: number; sv: [number, number, number] }

const median = (v: number[]) => { const s = [...v].sort((a, b) => a - b); return s.length % 2 ? s[s.length >> 1]! : (s[s.length / 2 - 1]! + s[s.length / 2]!) / 2; };

/** Bình phương tối thiểu có trọng số z = a·(x − x0) + b·(y − y0) + c0 qua tâm các ô (Cramer); null nếu suy biến (các ô thẳng hàng). */
function fitCentroids(c: PwPatch[], x0: number, y0: number): { a: number; b: number; c0: number } | null {
  let sxx = 0, sxy = 0, syy = 0, sx = 0, sy = 0, sw = 0, sxz = 0, syz = 0, sz = 0;
  for (const p of c) {
    const w = Math.sqrt(p.n), x = p.mx - x0, y = p.my - y0;
    sxx += w * x * x; sxy += w * x * y; syy += w * y * y; sx += w * x; sy += w * y; sw += w; sxz += w * x * p.mz; syz += w * y * p.mz; sz += w * p.mz;
  }
  const A = [sxx, sxy, sx, sxy, syy, sy, sx, sy, sw];
  const det3 = (m: number[]) => m[0]! * (m[4]! * m[8]! - m[5]! * m[7]!) - m[1]! * (m[3]! * m[8]! - m[5]! * m[6]!) + m[2]! * (m[3]! * m[7]! - m[4]! * m[6]!);
  const d = det3(A);
  if (!Number.isFinite(d) || Math.abs(d) < 1e-6 * sw * Math.max(sxx + syy, 1e-9)) return null;
  const r = [sxz, syz, sz];
  const col = (k: number) => A.map((v, i) => (i % 3 === k ? r[(i / 3) | 0]! : v));
  return { a: det3(col(0)) / d, b: det3(col(1)) / d, c0: det3(col(2)) / d };
}

function roadFrom(patches: (PwPatch | null)[], x: number, y: number, radius: number, tanMax: number): PwRoad | null {
  let c = patches.filter((p): p is PwPatch => !!p && p.ground && Math.hypot(p.mx - x, p.my - y) <= radius);
  if (!c.length) return null;
  if (c.length < 3) {
    const p = c.reduce((b, q) => (Math.hypot(q.mx - x, q.my - y) < Math.hypot(b.mx - x, b.my - y) ? q : b));
    const a = -p.nx / p.nz, b = -p.ny / p.nz;
    return Math.hypot(a, b) > tanMax ? { a: 0, b: 0, c: p.mz, rms: 0.05, n: 1 } : { a, b, c: -p.d / p.nz, rms: 0.05, n: 1 };
  }
  let f = fitCentroids(c, x, y);
  for (let it = 0; it < 3 && f; it++) {
    const keep = c.filter((p) => Math.abs(p.mz - (f!.a * (p.mx - x) + f!.b * (p.my - y) + f!.c0)) <= 0.06);
    if (keep.length === c.length || keep.length < 3) break;
    c = keep;
    f = fitCentroids(c, x, y);
  }
  if (!f || Math.hypot(f.a, f.b) > tanMax) f = { a: 0, b: 0, c0: median(c.map((p) => p.mz)) };
  const res = c.map((p) => p.mz - (f!.a * (p.mx - x) + f!.b * (p.my - y) + f!.c0));
  const rms = Math.sqrt(res.reduce((s, r) => s + r * r, 0) / res.length);
  return { a: f.a, b: f.b, c: f.c0 - f.a * x - f.b * y, rms, n: c.length };
}

export class Patchwork {
  private readonly cfg: PatchworkConfig;
  private readonly minRanges: number[];
  private readonly ringSizes: number[];
  private readonly sectorSizes: number[];
  private readonly binOffset: number[]; // chỉ số ô đầu tiên của mỗi vùng
  private readonly ringOffset: number[]; // chỉ số vành (concentric) đầu tiên của mỗi vùng
  private readonly nBins: number;
  private sensorH: number;
  private elevThr: number[];
  private flatThr: number[];
  private updElev: number[][];
  private updFlat: number[][];

  constructor(cfg: PatchworkConfig = DEFAULT_PATCHWORK) {
    this.cfg = { ...cfg, sectors: [...cfg.sectors], rings: [...cfg.rings] };
    const { minRange: lo, maxRange: hi } = cfg;
    this.minRanges = [lo, (7 * lo + hi) / 8, (3 * lo + hi) / 4, (lo + hi) / 2];
    const ends = [this.minRanges[1]!, this.minRanges[2]!, this.minRanges[3]!, hi];
    this.ringSizes = this.minRanges.map((m, z) => (ends[z]! - m) / cfg.rings[z]!);
    this.sectorSizes = cfg.sectors.map((s) => (2 * Math.PI) / s);
    this.binOffset = []; this.ringOffset = [];
    let b = 0, r = 0;
    for (let z = 0; z < 4; z++) { this.binOffset.push(b); this.ringOffset.push(r); b += cfg.rings[z]! * cfg.sectors[z]!; r += cfg.rings[z]!; }
    this.nBins = b;
    this.sensorH = cfg.sensorHeight;
    this.elevThr = new Array(cfg.ringsOfInterest).fill(0);
    this.flatThr = new Array(cfg.ringsOfInterest).fill(0);
    this.updElev = Array.from({ length: cfg.ringsOfInterest }, () => []);
    this.updFlat = Array.from({ length: cfg.ringsOfInterest }, () => []);
  }

  /** Chỉ số ô chứa (x, y), −1 nếu ngoài (minRange, maxRange]. */
  binOf(x: number, y: number): number {
    const r = Math.hypot(x, y);
    if (!(r > this.cfg.minRange && r <= this.cfg.maxRange)) return -1;
    const z = r < this.minRanges[1]! ? 0 : r < this.minRanges[2]! ? 1 : r < this.minRanges[3]! ? 2 : 3;
    const ring = Math.min(Math.floor((r - this.minRanges[z]!) / this.ringSizes[z]!), this.cfg.rings[z]! - 1);
    let th = Math.atan2(y, x);
    if (th < 0) th += 2 * Math.PI;
    const sector = Math.min(Math.floor(th / this.sectorSizes[z]!), this.cfg.sectors[z]! - 1);
    return this.binOffset[z]! + ring * this.cfg.sectors[z]! + sector;
  }

  /** Ngưỡng hiện tại (để kiểm tra / hiển thị). */
  state() { return { sensorH: this.sensorH, elevThr: [...this.elevThr], flatThr: [...this.flatThr] }; }

  /** Phân tách một frame. `xyz`: x,y,z xen kẽ (hệ ego, gốc trên mặt đường dưới lidar). */
  estimate(xyz: Float32Array, count = Math.floor(xyz.length / 3), intensity: Float32Array | null = null): PwResult {
    const cfg = this.cfg;
    const h0 = cfg.sensorHeight; // dời cố định: z' = z − h0 (hệ của bản gốc: gốc ở lidar)
    const X = (i: number) => xyz[i * 3]!, Y = (i: number) => xyz[i * 3 + 1]!, Z = (i: number) => xyz[i * 3 + 2]! - h0;
    const label = new Uint8Array(count).fill(PW_UNKNOWN);

    // RNR (hình học): điểm nhìn dốc xuống và nằm sâu dưới mặt đất → phản chiếu.
    const bin = new Int32Array(count);
    const counts = new Int32Array(this.nBins + 1);
    for (let i = 0; i < count; i++) {
      const x = X(i), y = Y(i), z = Z(i);
      if (cfg.rnr) {
        const ang = (Math.atan2(z, Math.hypot(x, y)) * 180) / Math.PI;
        if (ang < cfg.rnrVerAngleDeg && z < -this.sensorH - cfg.rnrDepth && (!intensity || intensity[i]! < cfg.rnrIntensity)) { label[i] = PW_REFLECT; bin[i] = -1; continue; }
      }
      const b = this.binOf(x, y);
      bin[i] = b;
      if (b >= 0) counts[b + 1]!++;
    }
    for (let b = 0; b < this.nBins; b++) counts[b + 1]! += counts[b]!;
    const idx = new Int32Array(counts[this.nBins]!);
    const fillAt = counts.slice(0, this.nBins);
    for (let i = 0; i < count; i++) { const b = bin[i]!; if (b >= 0) idx[fillAt[b]!++] = i; }

    const plane = (ids: ArrayLike<number>, n = ids.length): Plane | null => {
      if (n === 0) return null;
      let mx = 0, my = 0, mz = 0;
      for (let k = 0; k < n; k++) { const i = ids[k]!; mx += X(i); my += Y(i); mz += Z(i); }
      mx /= n; my /= n; mz /= n;
      let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
      for (let k = 0; k < n; k++) {
        const i = ids[k]!, dx = X(i) - mx, dy = Y(i) - my, dz = Z(i) - mz;
        xx += dx * dx; xy += dx * dy; xz += dx * dz; yy += dy * dy; yz += dy * dz; zz += dz * dz;
      }
      const q = Math.max(1, n - 1);
      const e = eigSym3([xx / q, xy / q, xz / q, yy / q, yz / q, zz / q]);
      let [nx, ny, nz] = e.vectors[2]! as [number, number, number];
      if (nz < 0) { nx = -nx; ny = -ny; nz = -nz; }
      return { nx, ny, nz, d: -(nx * mx + ny * my + nz * mz), mx, my, mz, sv: e.values };
    };
    const dist = (p: Plane, i: number) => p.nx * X(i) + p.ny * Y(i) + p.nz * Z(i) + p.d;

    /** Seed: các điểm thấp hơn trung bình num_lpr điểm thấp nhất + th (vùng 0 bỏ điểm thấp bất thường trước). `ids` đã xếp theo z. */
    const seeds = (zone: number, ids: number[], th: number): number[] => {
      let start = 0;
      if (zone === 0) while (start < ids.length && Z(ids[start]!) < cfg.adaptiveSeedMargin * this.sensorH) start++;
      if (cfg.robust) {
        // bỏ điểm thấp lẻ tẻ: bắt đầu từ điểm đầu tiên có đủ seedDense điểm trong seedWin
        for (let k = start; k + cfg.seedDense - 1 < ids.length; k++) {
          if (Z(ids[k + cfg.seedDense - 1]!) - Z(ids[k]!) <= cfg.seedWin) { start = k; break; }
        }
      }
      let sum = 0, cnt = 0;
      for (let k = start; k < ids.length && cnt < cfg.numLpr; k++) { sum += Z(ids[k]!); cnt++; }
      const lpr = cnt ? sum / cnt : 0;
      const out: number[] = [];
      for (let k = cfg.robust ? start : 0; k < ids.length; k++) if (Z(ids[k]!) < lpr + th) out.push(ids[k]!);
      return out;
    };

    const patches: (PwPatch | null)[] = new Array(this.nBins).fill(null);
    for (let z = 0; z < 4; z++) {
      for (let ring = 0; ring < cfg.rings[z]!; ring++) {
        const cRing = this.ringOffset[z]! + ring;
        const ringFlat: number[] = [];
        const cands: { ground: number[]; flat: number; line: number }[] = [];
        for (let sector = 0; sector < cfg.sectors[z]!; sector++) {
          const b = this.binOffset[z]! + ring * cfg.sectors[z]! + sector;
          const raw = Array.from(idx.subarray(counts[b]!, counts[b + 1]!));
          if (raw.length < cfg.numMinPts) continue; // quá ít điểm: để UNKNOWN
          for (const i of raw) label[i] = PW_OTHER;
          const ids = cfg.prior ? raw.filter((i) => Math.abs(Z(i) + h0) <= cfg.priorMargin + cfg.priorSlope * Math.hypot(X(i), Y(i))) : raw;
          if (ids.length < cfg.numMinPts) continue;
          ids.sort((i, j) => Z(i) - Z(j));

          // R-VPF: vùng 0, bỏ dần mặt đứng nằm dưới mặt đất (tường, thân xe).
          let rest = ids;
          if (cfg.rvpf) {
            for (let it = 0; it < cfg.numIter; it++) {
              const p = plane(seeds(z, rest, cfg.thSeedsV));
              if (!(z === 0 && p && p.nz < cfg.uprightnessThr - 0.1)) break;
              rest = rest.filter((i) => Math.abs(dist(p, i)) >= cfg.thDistV);
            }
          }
          // R-GPF: fit mặt đất lặp num_iter lần; điểm cách mặt (có dấu) < thDist là mặt đất.
          let p = plane(seeds(z, rest, cfg.thSeeds));
          let ground: number[] = [];
          for (let it = 0; it < cfg.numIter && p; it++) {
            const cur: Plane = p;
            ground = rest.filter((i) => (cfg.robust ? Math.abs(dist(cur, i)) : dist(cur, i)) < cfg.thDist);
            p = plane(ground) ?? (it === cfg.numIter - 1 ? null : cur);
          }
          if (!p || !ground.length) continue;

          // A-GLE
          const upright = p.nz > cfg.uprightnessThr;
          const near = cRing < cfg.ringsOfInterest;
          const elev = p.mz, flat = p.sv[2], line = p.sv[1] !== 0 ? p.sv[0] / p.sv[1] : Infinity;
          const notElevated = near && elev < this.elevThr[cRing]!;
          const isFlat = near && flat < this.flatThr[cRing]!;
          const headingOut = p.mx * p.nx + p.my * p.ny + p.mz * p.nz < 0;
          if (upright && notElevated && near) { this.updElev[cRing]!.push(elev); this.updFlat[cRing]!.push(flat); ringFlat.push(flat); }
          let isGround = false;
          if (!upright) isGround = false;
          else if (!near) isGround = true;
          else if (!headingOut) isGround = false;
          else if (notElevated || isFlat) isGround = true;
          else { cands.push({ ground, flat, line }); }
          if (isGround) for (const i of ground) label[i] = PW_GROUND;
          patches[b] = {
            zone: z, ring: cRing, sector, nx: p.nx, ny: p.ny, nz: p.nz, d: p.d - p.nz * h0, mx: p.mx, my: p.my, mz: p.mz + h0,
            flatness: flat, ground: isGround, n: ground.length,
          };
        }
        // TGR: ô bị loại vì cao / không phẳng nhưng độ phẳng gần với các ô cùng vành → trả lại thành mặt đất.
        if (cands.length && cfg.tgr) {
          const [m, s] = meanStd(ringFlat);
          const mu = m + 1.5 * s;
          for (const c of cands) {
            let prob = 1 / (1 + Math.exp((c.flat - mu) / (mu / 10)));
            if (c.ground.length > 1500 && c.flat < cfg.thDist * cfg.thDist) prob = 1;
            const probLine = c.line > 8 ? 0 : 1;
            if (probLine * prob > 0.5 && cRing < cfg.ringsOfInterest) {
              for (const i of c.ground) label[i] = PW_GROUND;
              const b = this.binOf(X(c.ground[0]!), Y(c.ground[0]!));
              if (b >= 0 && patches[b]) patches[b] = { ...patches[b]!, ground: true };
            }
          }
        }
      }
    }
    if (cfg.adaptive) this.updateThresholds();

    return {
      label, patches,
      heightAt: (x, y) => {
        const b = this.binOf(x, y);
        const p = b >= 0 ? patches[b] : null;
        return p?.ground ? -(p.d + p.nx * x + p.ny * y) / p.nz : null;
      },
      road: (x, y, radius, tanMax) => roadFrom(patches, x, y, radius, tanMax),
    };
  }

  /** A-GLE: ngưỡng cao = trung bình + 3σ (vành 0, kèm cập nhật chiều cao lidar) / + 2σ; ngưỡng phẳng = trung bình + σ. */
  private updateThresholds() {
    for (let i = 0; i < this.cfg.ringsOfInterest; i++) {
      const e = this.updElev[i]!, f = this.updFlat[i]!;
      if (e.length) {
        const [m, s] = meanStd(e);
        if (i === 0) { this.elevThr[i] = m + 3 * s; this.sensorH = -m; } else this.elevThr[i] = m + 2 * s;
        if (e.length > this.cfg.maxStorage) e.splice(0, e.length - this.cfg.maxStorage);
      }
      if (f.length) {
        const [m, s] = meanStd(f);
        this.flatThr[i] = m + s;
        if (f.length > this.cfg.maxStorage) f.splice(0, f.length - this.cfg.maxStorage);
      }
    }
  }
}
