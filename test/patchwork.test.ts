import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { DEFAULT_PATCHWORK, eigSym3, Patchwork, PW_GROUND, PW_OTHER, PW_REFLECT } from '../src/shared/patchwork';

/** Số ngẫu nhiên tất định (mulberry32). */
const rng = (seed: number) => () => { seed |= 0; seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** Mặt đường z = slope·x quanh gốc, thêm hộp xe tại (cx, cy) nếu có. */
function scene(opts: { slope?: number; car?: [number, number]; below?: number; seed?: number } = {}) {
  const r = rng(opts.seed ?? 1);
  const pts: number[] = [], kind: string[] = [];
  const add = (x: number, y: number, z: number, k: string) => { pts.push(x, y, z); kind.push(k); };
  for (let i = 0; i < 40000; i++) {
    const rad = 3 + 67 * r(), th = 2 * Math.PI * r();
    const x = rad * Math.cos(th), y = rad * Math.sin(th);
    if (opts.car && Math.abs(x - opts.car[0]) < 2.4 && Math.abs(y - opts.car[1]) < 1.1) continue;
    add(x, y, (opts.slope ?? 0) * x + (r() - 0.5) * 0.02, 'g');
  }
  if (opts.car) {
    const [cx, cy] = opts.car;
    for (let i = 0; i < 800; i++) add(cx + (r() - 0.5) * 4.5, cy + (r() - 0.5) * 1.8, 0.3 + r() * 1.3, 'car');
  }
  for (let i = 0; i < (opts.below ?? 0); i++) add(8 + r() * 4, (r() - 0.5) * 4, -2.5 - r(), 'refl');
  return { xyz: new Float32Array(pts), kind };
}
const frac = (label: Uint8Array, kind: string[], k: string, want: number) => {
  let n = 0, hit = 0;
  kind.forEach((x, i) => { if (x === k) { n++; if (label[i] === want) hit++; } });
  return hit / Math.max(1, n);
};

describe('eigSym3', () => {
  it('ma trận chéo và ma trận quay', () => {
    expect(eigSym3([3, 0, 0, 2, 0, 1]).values).toEqual([3, 2, 1]);
    const e = eigSym3([2, 1, 0, 2, 0, 3]);
    expect(e.values[0]).toBeCloseTo(3);
    expect(e.values[1]).toBeCloseTo(3 - 0 + 0 === 3 ? e.values[1] : 0);
    const [vx, vy, vz] = e.vectors[0]!;
    expect(Math.hypot(vx!, vy!, vz!)).toBeCloseTo(1);
  });
});

describe('Patchwork++', () => {
  it('binOf: ngoài (2.7, 80] m là -1, trong tầm là ô hợp lệ', () => {
    const pw = new Patchwork();
    expect(pw.binOf(1, 0)).toBe(-1);
    expect(pw.binOf(85, 0)).toBe(-1);
    expect(pw.binOf(5, 0)).toBeGreaterThanOrEqual(0);
    expect(pw.binOf(5, 0)).not.toBe(pw.binOf(-5, 0));
  });

  it('mặt phẳng ngang: gần như mọi điểm là mặt đất', () => {
    const s = scene();
    const r = new Patchwork().estimate(s.xyz);
    expect(frac(r.label, s.kind, 'g', PW_GROUND)).toBeGreaterThan(0.95);
    expect(r.heightAt(10, 5)!).toBeCloseTo(0, 1);
  });

  it('mặt dốc 4°: heightAt bám theo độ dốc', () => {
    const slope = Math.tan((4 * Math.PI) / 180);
    const s = scene({ slope });
    const r = new Patchwork().estimate(s.xyz);
    expect(frac(r.label, s.kind, 'g', PW_GROUND)).toBeGreaterThan(0.9);
    expect(r.heightAt(12, 3)!).not.toBeNull();
    expect(r.heightAt(12, 3)!).toBeCloseTo(slope * 12, 1);
  });

  it('thân xe trên đường không phải mặt đất, mặt đường quanh xe vẫn là mặt đất', () => {
    const s = scene({ car: [10, 0] });
    const r = new Patchwork().estimate(s.xyz);
    expect(frac(r.label, s.kind, 'car', PW_OTHER)).toBeGreaterThan(0.8);
    expect(frac(r.label, s.kind, 'g', PW_GROUND)).toBeGreaterThan(0.9);
  });

  it('lớp phản chiếu dày sâu dưới đường: tiền nghiệm giữ mặt đất đúng, thiếu nó thì bị nhận nhầm', () => {
    const base = scene({ seed: 5 });
    const r = rng(7);
    const ghost: number[] = [];
    for (let i = 0; i < 6000; i++) { const rad = 12 + 25 * r(), th = 2 * Math.PI * r(); ghost.push(rad * Math.cos(th), rad * Math.sin(th), -3.6 + (r() - 0.5) * 0.02); }
    const xyz = new Float32Array([...base.xyz, ...ghost]);
    const withPrior = new Patchwork().estimate(xyz);
    const without = new Patchwork({ ...DEFAULT_PATCHWORK, prior: false }).estimate(xyz);
    const err = (res: ReturnType<Patchwork['estimate']>) => Math.max(...[[20, 5], [-25, 8], [30, -10]].map(([x, y]) => Math.abs(res.heightAt(x!, y!) ?? 9)));
    expect(err(withPrior)).toBeLessThan(0.05);
    expect(err(without)).toBeGreaterThan(1); // minh hoạ lỗi nếu không có tiền nghiệm
  });

  it('road(): mặt đường quanh xe suy ra từ các ô lân cận (ô chứa xe không phải mặt đất)', () => {
    const slope = Math.tan((4 * Math.PI) / 180);
    const s = scene({ slope, car: [12, 0] });
    const r = new Patchwork().estimate(s.xyz);
    const road = r.road(12, 0, 8, Math.tan((8 * Math.PI) / 180))!;
    expect(road).not.toBeNull();
    expect(road.n).toBeGreaterThanOrEqual(3);
    expect(road.rms).toBeLessThan(0.05);
    expect(road.a * 12 + road.c).toBeCloseTo(slope * 12, 1); // z mặt đường tại tâm xe
    expect(r.road(500, 0, 8, 1)).toBeNull(); // không có ô nào trong bán kính
  });

  it('điểm phản chiếu dưới mặt đất được gắn nhãn phản chiếu', () => {
    const s = scene({ below: 200 });
    const r = new Patchwork().estimate(s.xyz);
    expect(frac(r.label, s.kind, 'refl', PW_REFLECT)).toBeGreaterThan(0.9);
  });

  it('điểm nhiễu sâu dưới mặt đường ở vùng xa: robust giữ mặt đất đúng, bản gốc bị kéo xuống', () => {
    const base = scene({ seed: 3 });
    const r = rng(99);
    const extra: number[] = [];
    for (let i = 0; i < 400; i++) { const rad = 15 + 30 * r(), th = 2 * Math.PI * r(); extra.push(rad * Math.cos(th), rad * Math.sin(th), -2.5 - r() * 4); }
    const xyz = new Float32Array([...base.xyz, ...extra]);
    const robust = new Patchwork().estimate(xyz);
    const orig = new Patchwork({ ...DEFAULT_PATCHWORK, robust: false }).estimate(xyz);
    const errs = (res: ReturnType<Patchwork['estimate']>) => {
      const e: number[] = [];
      for (const [x, y] of [[20, 5], [-25, 8], [30, -10], [-18, -20]] as const) { const h = res.heightAt(x, y); if (h !== null) e.push(Math.abs(h)); }
      return e;
    };
    const er = errs(robust);
    expect(er.length).toBeGreaterThan(0);
    expect(Math.max(...er)).toBeLessThan(0.05);
    expect(Math.max(...errs(orig), 0)).toBeGreaterThanOrEqual(Math.max(...er)); // robust không kém bản gốc
  });

  it('học ngưỡng: chiều cao lidar ổn định quanh mức dời đã cấu hình (gốc nằm trên mặt đường)', () => {
    const pw = new Patchwork({ ...DEFAULT_PATCHWORK, sensorHeight: 1.9 });
    for (let i = 0; i < 4; i++) pw.estimate(scene({ seed: 10 + i }).xyz);
    expect(Math.abs(pw.state().sensorH - 1.9)).toBeLessThan(0.15);
  });
});

// Đối chiếu với Patchwork++ GỐC (pypatchworkpp): fixture sinh bởi scripts/pw_crosscheck.py (7 MB, không nằm trong git).
const FIX = new URL('./fixtures/pw_scenes.json', import.meta.url);
describe.skipIf(!existsSync(FIX))('đối chiếu bản gốc', () => {
  const scenes = existsSync(FIX) ? (JSON.parse(readFileSync(FIX, 'utf8')) as Record<string, { xyz: number[]; ground: number[] }>) : {};
  for (const name of ['flat', 'slope5', 'car', 'wall']) {
    it(`cảnh ${name}: khớp ≥ 98% nhãn mặt đất`, () => {
      const s = scenes[name]!;
      const xyz = new Float32Array(s.xyz);
      const pw = new Patchwork({ ...DEFAULT_PATCHWORK, rnr: false, prior: false }); // cùng thiết lập với script (tiền nghiệm |z| là phần thêm của dự án, bản gốc không có): học ngưỡng qua 3 lượt
      let r = pw.estimate(xyz);
      for (let i = 0; i < 2; i++) r = pw.estimate(xyz);
      let same = 0;
      s.ground.forEach((g, i) => { if ((r.label[i] === PW_GROUND ? 1 : 0) === g) same++; });
      expect(same / s.ground.length).toBeGreaterThanOrEqual(0.98);
    });
  }
});
