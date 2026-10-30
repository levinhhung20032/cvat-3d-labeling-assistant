import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUND, enforceConsistency, groundSnap, pwGroundPlane, type GroundConfig, type GroundResult } from '../src/shared/ground';
import type { LocalPoints } from '../src/shared/fit';
import { parsePcd } from '../src/shared/pcd';
import { PW_GROUND, PW_OTHER, type PwResult } from '../src/shared/patchwork';
import { pooledGround } from '../src/panel/groundSeg';
import type { EgoMotion } from '../src/shared/ego';
import type { PointCloud } from '../src/shared/pcd';

type P = [number, number, number];
// box 4 × 2 × 1.5 → đáy ở w = −0.75 (như test/ground.test.ts)
const ring = (f: (u: number, v: number) => number, ext = 5.4): P[] => {
  const out: P[] = [];
  for (let u = -ext; u <= ext; u += 0.25) for (let v = -ext + 1; v <= ext - 1; v += 0.25) {
    if (Math.abs(u) <= 2.1 && Math.abs(v) <= 1.1) continue;
    out.push([u, v, f(u, v)]);
  }
  return out;
};
const local = (list: P[], label?: (p: P) => number, pwW?: number | null): LocalPoints => ({
  u: Float32Array.from(list.map((p) => p[0])), v: Float32Array.from(list.map((p) => p[1])), w: Float32Array.from(list.map((p) => p[2])), n: list.length,
  g: label ? Uint8Array.from(list.map(label)) : undefined, pwW,
});
const run = (p: LocalPoints, cfg: Partial<GroundConfig>) => groundSnap(p, 4, 2, 1.5, { cu: 0, cv: 0, cw: 0, range: 0 }, { ...DEFAULT_GROUND, ...cfg });

describe('groundSnap + Patchwork++', () => {
  it('tắt (pw = 0) hoặc không có nhãn: kết quả như cũ', () => {
    const list = ring(() => -1.0);
    const base = run(local(list), { pw: 0 })!;
    const withLabels = run(local(list, () => PW_OTHER, -1.0), { pw: 0 })!;
    expect(withLabels.groundW).toBe(base.groundW);
    expect(withLabels.nSectors).toBe(base.nSectors);
    expect(withLabels.pw).toBe('off');
    expect(run(local(list), { pw: 2 })!.pw).toBe('off'); // bật nhưng frame chưa có nhãn
  });

  it('pw ≥ 1: điểm không phải mặt đất bị bỏ khỏi các cung', () => {
    const list = ring(() => -1.0);
    const lbl = (p: P) => (p[0] > 2.1 ? PW_OTHER : PW_GROUND); // phía trước box là vật khác
    const all = run(local(list, () => PW_GROUND), { pw: 1 })!;
    const cut = run(local(list, lbl), { pw: 1 })!;
    expect(all.nSectors).toBe(8);
    expect(cut.nSectors).toBeLessThan(8);
    expect(cut.groundW).toBeCloseTo(-1.0, 2);
    expect(cut.pw).toBe('filter');
  });

  // Hai tầng (đường −1.0 ở v > 0, vỉa −0.8 ở v < 0), không có điểm dưới gầm để phân xử.
  const twoTier = (v: number) => (v > 0 ? -1.0 : -0.8);
  it('hai tầng không có bằng chứng tiếp xúc: cũ → mơ hồ; pw = 2 + mặt đất Patchwork++ gần một tầng → chọn tầng đó', () => {
    const list = ring((_u, v) => twoTier(v));
    const old = run(local(list), { pw: 0 })!;
    expect(old.ambiguous).toBe(true);
    const r = run(local(list, () => PW_GROUND, -0.8), { pw: 2 })!;
    expect(r.ambiguous).toBe(false);
    expect(r.pw).toBe('tier');
    expect(r.groundW).toBeCloseTo(-0.8, 1);
    const r1 = run(local(list, () => PW_GROUND, -0.8), { pw: 1 })!;
    expect(r1.pw).toBe('filter'); // chỉ lọc điểm, không chọn tầng
    expect(r1.ambiguous).toBe(true);
  });

  it('mặt đất Patchwork++ lệch mọi tầng quá pwMatch: vẫn mơ hồ như cũ', () => {
    const r = run(local(ring((_u, v) => twoTier(v)), () => PW_GROUND, -0.3), { pw: 2 })!;
    expect(r.ambiguous).toBe(true);
    expect(r.pw).toBe('filter');
  });
});

describe('groundSnap mức 3: mặt đường từ các ô mặt đất Patchwork++', () => {
  const road = { a: 0, b: 0, c: -1.0, rms: 0.01, n: 5 };
  const withRoad = (r: typeof road | null, at = { cu: 0, cv: 0, cw: 0, range: 10 }) =>
    groundSnap({ ...local(ring(() => -0.9)), pwRoad: r }, 4, 2, 1.5, at, { ...DEFAULT_GROUND, pw: 3 });

  it('dùng mặt đường Patchwork++ cho mọi object (kể cả khi các cung quanh box cho kết quả khác)', () => {
    const r = withRoad(road)!;
    expect(r.pw).toBe('road');
    expect(r.groundW).toBeCloseTo(-1.0 + DEFAULT_GROUND.pwLift, 3);
    expect(r.dz).toBeCloseTo(-1.0 + DEFAULT_GROUND.pwLift + 0.75, 3); // đáy box ở −0.75
    expect(r.confident).toBe(true);
    expect(r.warn).toBe(true); // box cao hơn mặt đường ~ 23 cm
  });

  it('không có mặt đường Patchwork++ → quay về cách đo cũ', () => {
    const r = withRoad(null)!;
    expect(r.pw).toBe('off');
    expect(r.groundW).toBeCloseTo(-0.9, 2);
  });

  it('mặt đường chỉ từ 1 ô hoặc phần dư lớn: không đủ tin (không tự snap, không báo)', () => {
    expect(withRoad({ ...road, n: 1, rms: 0.05 })!.confident).toBe(false);
    expect(withRoad({ ...road, rms: 0.2 })!.confident).toBe(false);
    expect(withRoad({ ...road, n: 1, rms: 0.05 })!.warn).toBe(false);
  });

  it('dời đo thử (at.cw) vẫn ra cùng mặt đường tuyệt đối', () => {
    const a = withRoad(road, { cu: 0, cv: 0, cw: 0, range: 10 })!;
    const b = withRoad(road, { cu: 0, cv: 0, cw: 0.1, range: 10 })!;
    expect(b.groundW).toBeCloseTo(a.groundW, 6);
    expect(b.dz).toBeCloseTo(a.dz - 0.1, 6);
  });
});

describe('mức 4: mặt đường fit từ các điểm mặt đất Patchwork++', () => {
  // lưới điểm xa box (ngoài vùng cách cũ xét: cách mép box > 2,5 m), mặt dốc nhẹ w = −1,0 + 0,02·u
  const far = (): P[] => {
    const out: P[] = [];
    for (let u = -9; u <= 9; u += 0.5) for (let v = -9; v <= 9; v += 0.5) if (Math.abs(u) > 4.6 || Math.abs(v) > 3.6) out.push([u, v, -1.0 + 0.02 * u]);
    return out;
  };
  const cfg4 = { ...DEFAULT_GROUND, pw: 4 };

  it('pwGroundPlane: khớp mặt phẳng, bỏ điểm không phải mặt đất và điểm mặt đất lệch xa', () => {
    const list = [...far(), [6, 0, 0.5] as P, [7, 1, 0.8] as P, [-6, 2, -0.4] as P]; // vật + điểm lệch
    const lab = (q: P) => (q[2] > 0 ? PW_OTHER : PW_GROUND);
    const pl = pwGroundPlane(local(list, lab), 4, 2, undefined, cfg4)!;
    expect(pl.a).toBeCloseTo(0.02, 3);
    expect(pl.c).toBeCloseTo(-1.0, 2);
    expect(pl.rms).toBeLessThan(0.01);
    expect(pl.n).toBeGreaterThan(300);
  });

  it('pwGroundPlane: không có nhãn hoặc quá ít điểm → null', () => {
    expect(pwGroundPlane(local(far()), 4, 2, undefined, cfg4)).toBeNull();
    expect(pwGroundPlane(local(far().slice(0, 10), () => PW_GROUND), 4, 2, undefined, cfg4)).toBeNull();
  });

  it('cách cũ có số liệu độc lập nhưng mâu thuẫn mặt phẳng Patchwork++ (> pwAgree) → không đủ tin', () => {
    // một cung phía trước box ở −0,55 (cách cũ: 1 cung, chưa chắc), trong khi mặt đất Patchwork++ ở −1,0
    const near: P[] = [];
    for (let u = 2.2; u <= 2.6; u += 0.05) for (let v = -0.2; v <= 0.2; v += 0.05) near.push([u, v, -0.55]);
    const r = groundSnap(local([...near, ...far()], () => PW_GROUND), 4, 2, 1.5, { cu: 0, cv: 0, cw: 0, range: 30 }, cfg4)!;
    expect(r.pw).toBe('pts');
    expect(r.confident).toBe(false);
    expect(r.warn).toBe(false);
  });

  it('cách cũ không đo được (xa, thưa) → dùng mặt phẳng từ điểm Patchwork++; đo được chắc thì giữ kết quả cũ', () => {
    const r = groundSnap(local(far(), () => PW_GROUND), 4, 2, 1.5, { cu: 0, cv: 0, cw: 0, range: 50 }, cfg4)!;
    expect(r.pw).toBe('pts');
    expect(r.confident).toBe(true);
    expect(r.groundW).toBeCloseTo(-1.0 + DEFAULT_GROUND.pwLift, 2);
    const clear = groundSnap(local([...ring(() => -1.0), ...far()], () => PW_GROUND), 4, 2, 1.5, { cu: 0, cv: 0, cw: 0, range: 5 }, cfg4)!;
    expect(clear.pw).toBe('off'); // đường rõ: giữ nguyên cách đo cũ
    expect(clear.groundW).toBeCloseTo(-1.0, 2);
  });
});

describe('gộp điểm mặt đất từ frame lân cận', () => {
  // xe chạy +x: điểm đứng yên ở x trong frame 0 thành x − 9 ở frame 1 (bước 0→1: p' = p + (−9, 0))
  const ego: EgoMotion = { start: 0, steps: new Map([[1, { c: 1, s: 0, tx: -9, ty: 0, theta: 0, inliers: 9, pairs: 9 }]]) };
  const cloud = (pts: [number, number, number][], labels: number[]) => ({
    pc: { count: pts.length, xyz: Float32Array.from(pts.flat()), rgb: null, intensity: null } as PointCloud,
    seg: { label: Uint8Array.from(labels) } as unknown as PwResult,
  });
  // frame 0: mặt đường z = −1,0 quanh x ∈ [20, 30] (mặt đất) + một thân xe (nhãn khác) ở x = 24
  const f0pts: [number, number, number][] = [];
  const f0lab: number[] = [];
  for (let x = 20; x <= 30; x += 0.5) for (let y = -4; y <= 4; y += 0.5) { f0pts.push([x, y, -1.0]); f0lab.push(PW_GROUND); }
  for (let z = -0.5; z <= 0.5; z += 0.1) { f0pts.push([24, 0, z]); f0lab.push(PW_OTHER); }
  const frames: Record<number, ReturnType<typeof cloud>> = { 0: cloud(f0pts, f0lab) };
  const src = (g: number) => frames[g] ?? null;
  const cub = { x: 15, y: 0, z: -0.25, yaw: 0 }; // frame 1: vật ở (15, 0) = (24, 0) của frame 0, tâm box ở z = −0,25

  it('đưa điểm mặt đất của frame trước về hệ box của frame này, bỏ điểm không phải mặt đất', () => {
    const r = pooledGround(1, cub, 2, 10, ego, src)!;
    expect(r).not.toBeNull();
    expect(r.n).toBeGreaterThan(100);
    expect(Math.min(...r.u)).toBeGreaterThanOrEqual(-10.01);
    expect(Math.max(...r.u)).toBeLessThanOrEqual(10.01);
    // mọi điểm là mặt đường z = −1,0 → w = −1,0 − (−0,25) = −0,75
    for (let i = 0; i < r.n; i++) expect(r.w[i]).toBeCloseTo(-0.75, 5);
    // thân xe (nhãn khác) ở (24, 0) = (15, 0) không bị lẫn vào
    expect(Array.from(r.w).some((w) => w > -0.7)).toBe(false);
  });

  it('không có chuyển động xe / K = 0 / frame lân cận chưa tải → không gộp', () => {
    expect(pooledGround(1, cub, 2, 10, null, src)).toBeNull();
    expect(pooledGround(1, cub, 0, 10, ego, src)).toBeNull();
    expect(pooledGround(1, cub, 2, 10, ego, () => null)).toBeNull();
    expect(pooledGround(1, cub, 1, 10, { start: 0, steps: new Map() }, src)).toBeNull(); // thiếu bước ego
  });

  it('mặt đường fit từ điểm gộp khi frame này không có điểm mặt đất nào quanh box', () => {
    const pool = pooledGround(1, cub, 2, 10, ego, src)!;
    const r = groundSnap({ u: new Float32Array(0), v: new Float32Array(0), w: new Float32Array(0), n: 0, g: new Uint8Array(0), pool }, 4, 2, 1.5, { cu: 0, cv: 0, cw: 0, range: 15 }, { ...DEFAULT_GROUND, pw: 4, pwMinPts: 40 })!;
    expect(r.pw).toBe('pts');
    expect(r.groundW).toBeCloseTo(-0.75 + DEFAULT_GROUND.pwLift, 3);
  });
});

describe('nhất quán theo thời gian (enforceConsistency)', () => {
  const mk = (groundW: number, pw: GroundResult['pw'] = 'pts', confident = true) => ({ groundW, pw, confident, warn: true }) as unknown as GroundResult;
  const cfg = { ...DEFAULT_GROUND, pwConsSpan: 2, pwConsTol: 0.15, pwConsSlope: 0.05 };
  const seq = (ws: (number | null)[], pw: GroundResult['pw'] = 'pts', range = (_i: number) => 20) =>
    ws.map((w, i) => ({ f: i, z: 0, range: range(i), g: w === null ? null : mk(w, pw) }));

  it('một frame lệch nhiều so với các frame kề bị loại (không tin, không báo); các frame còn lại giữ nguyên', () => {
    const out = enforceConsistency(seq([-0.2, -0.2, -0.9, -0.2, -0.2]), cfg);
    expect(out[2]!.inconsistent).toBe(true);
    expect(out[2]!.confident).toBe(false);
    expect(out[2]!.warn).toBe(false);
    for (const i of [0, 1, 3, 4]) expect(out[i]!.inconsistent).toBeUndefined();
  });

  it('chỉ kiểm kết quả Patchwork++ (pts); kết quả cách cũ và frame thiếu số liệu giữ nguyên', () => {
    const old = enforceConsistency(seq([-0.2, -0.2, -0.9, -0.2, -0.2], 'off'), cfg);
    expect(old.every((g) => !g!.inconsistent)).toBe(true);
    expect(enforceConsistency(seq([-0.2, null, null, -0.9]), cfg)[3]!.inconsistent).toBeUndefined(); // frame kề thiếu / ngoài ± span → không có mốc
  });

  it('mốc là frame kề ĐỦ TIN, kể cả kết quả cách cũ (ref); frame kề không đủ tin không làm mốc', () => {
    const items = seq([-0.2, -0.9, -0.2]);
    items[0]!.g = mk(-0.2, 'off', false); // không đủ tin → không làm mốc
    items[2]!.g = mk(-0.2, 'off', true); // làm mốc
    expect(enforceConsistency(items, cfg)[1]!.inconsistent).toBe(true);
    items[2]!.g = mk(-0.2, 'off', false);
    expect(enforceConsistency(items, cfg)[1]!.inconsistent).toBeUndefined(); // hết mốc → giữ nguyên
  });

  it('đổi tầm lớn giữa các frame thì cho phép lệch nhiều hơn (mặt đường dốc); G.pwConsSpan = 0 tắt hẳn', () => {
    const ws = [-0.2, -0.2, -0.45, -0.2, -0.2];
    expect(enforceConsistency(seq(ws), cfg)[2]!.inconsistent).toBe(true); // lệch 25 cm > 15 cm
    expect(enforceConsistency(seq(ws, 'pts', (i) => 20 + 9 * i), cfg)[2]!.inconsistent).toBeUndefined(); // tầm đổi ~ 9–18 m → thêm 0,45–0,9 m
    expect(enforceConsistency(seq([-0.2, -0.9, -0.2]), { ...cfg, pwConsSpan: 0 })[1]!.inconsistent).toBeUndefined();
  });
});

describe('parsePcd: intensity', () => {
  /** PCD nhị phân x y z intensity ring rgb; `align`: đệm tiêu đề cho dữ liệu bắt đầu ở bội của 4 byte (đường nhanh). */
  const pcd = (align: boolean) => {
    const rows = [[1, 2, 3, 10, 0, 0], [4, 5, 6, 200, 1, 0]];
    const mk = (pad: string) => `# .PCD v0.7${pad}\nVERSION 0.7\nFIELDS x y z intensity ring rgb\nSIZE 4 4 4 4 4 4\nTYPE F F F F F U\nCOUNT 1 1 1 1 1 1\nWIDTH 2\nHEIGHT 1\nPOINTS 2\nDATA binary\n`;
    let pad = 0;
    while (align && mk(' '.repeat(pad)).length % 4) pad++;
    const head = mk(' '.repeat(pad));
    const hb = new TextEncoder().encode(head);
    const buf = new ArrayBuffer(hb.length + rows.length * 24);
    new Uint8Array(buf).set(hb);
    const dv = new DataView(buf, hb.length);
    rows.forEach((r, i) => r.forEach((x, k) => (k === 5 ? dv.setUint32(i * 24 + k * 4, x, true) : dv.setFloat32(i * 24 + k * 4, x, true))));
    return buf;
  };
  for (const align of [false, true]) {
    it(`đọc intensity khi được yêu cầu (${align ? 'đường nhanh' : 'đường chậm'}); không yêu cầu thì null`, () => {
      const a = parsePcd(pcd(align), false, true);
      expect(Array.from(a.intensity!)).toEqual([10, 200]);
      expect(Array.from(a.xyz)).toEqual([1, 2, 3, 4, 5, 6]);
      expect(parsePcd(pcd(align), false).intensity).toBeNull();
    });
  }
});
