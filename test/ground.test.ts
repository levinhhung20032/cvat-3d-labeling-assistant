import { describe, expect, it } from 'vitest';
import { DEFAULT_GROUND, groundSnap, lowestLayer, tiltFromPlane } from '../src/shared/ground';
import { apply, fromEuler } from '../src/shared/rot';
import type { LocalPoints } from '../src/shared/fit';

const pts = (list: [number, number, number][]): LocalPoints => ({
  u: Float32Array.from(list.map((p) => p[0])),
  v: Float32Array.from(list.map((p) => p[1])),
  w: Float32Array.from(list.map((p) => p[2])),
  n: list.length,
});
// box 4 x 2 x 1.5 → hu=2, hv=1, hw=0.75, đáy ở w = -0.75
/** mặt đường quanh box (bỏ phần dưới chân box), độ cao theo f(u, v) */
const ring = (f: (u: number, v: number) => number, ext = 5.4): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let u = -ext; u <= ext; u += 0.25) for (let v = -ext + 1; v <= ext - 1; v += 0.25) {
    if (Math.abs(u) <= 2.1 && Math.abs(v) <= 1.1) continue;
    out.push([u, v, f(u, v)]);
  }
  return out;
};
/** điểm mặt đất lọt dưới gầm (lidar thấy qua khe giữa các bánh) */
const under = (w: number): [number, number, number][] => {
  const out: [number, number, number][] = [];
  for (let u = -1.8; u <= 1.8; u += 0.3) for (let v = -0.8; v <= 0.8; v += 0.4) out.push([u, v, w]);
  return out;
};
const snap = (list: [number, number, number][], range = 0) => groundSnap(pts(list), 4, 2, 1.5, { cu: 0, cv: 0, cw: 0, range });

describe('lớp mặt đường', () => {
  it('lấy mép dưới DÀY ĐẶC (bỏ vài điểm nhiễu thấp lẻ tẻ), tâm lớp = trung vị, mặt trên = phân vị 90%', () => {
    const ws = [-1.6, -1.55, ...Array.from({ length: 40 }, (_, i) => -1.03 + (i % 7) * 0.01), 0.2, 0.3];
    const L = lowestLayer(ws, 4, 0.04, 0.06)!;
    expect(L.h).toBeCloseTo(-1.0, 2);
    expect(L.top).toBeCloseTo(-0.97, 2);
    expect(lowestLayer([-1.6, 0.2], 4, 0.04, 0.06)).toBeNull();
  });
});

describe('groundSnap: mặt đường riêng của object tại frame đang xét', () => {
  it('mặt phẳng ngang: box cao hơn 25 cm → hạ 25 cm, có báo · box chìm 20 cm → nâng 20 cm, có báo · đã nằm trên mặt đường → dz ≈ 0, không báo', () => {
    const a = snap(ring(() => -1.0))!;
    expect(a.dz).toBeCloseTo(-0.25, 2);
    expect(a.groundW).toBeCloseTo(-1.0, 2);
    expect(a.warn).toBe(true);
    expect(a.confident).toBe(true);
    expect(a.nSectors).toBe(8);
    expect(a.flat).toBe(true);
    const b = snap(ring(() => -0.55))!;
    expect(b.dz).toBeCloseTo(0.2, 2);
    expect(b.warn).toBe(true);
    const c = snap(ring(() => -0.75))!;
    expect(Math.abs(c.dz)).toBeLessThan(0.01);
    expect(c.warn).toBe(false);
  });

  it('ngưỡng quy ước hai phía: cao hơn 6 cm không báo, 15 cm báo; thấp hơn 3 cm không báo, 8 cm báo', () => {
    expect(snap(ring(() => -0.81))!.warn).toBe(false);
    expect(snap(ring(() => -0.9))!.warn).toBe(true);
    expect(snap(ring(() => -0.72))!.warn).toBe(false);
    expect(snap(ring(() => -0.67))!.warn).toBe(true);
    expect(DEFAULT_GROUND.floatTol).toBeGreaterThan(DEFAULT_GROUND.sinkTol);
  });

  it('lớp mặt đường dày 6 cm: đáy box đặt lên MẶT TRÊN của lớp (không ăn điểm mặt đường)', () => {
    const thick = ring((u, v) => -1.03 + ((Math.round(u * 4) + Math.round(v * 4)) % 7 + 7) % 7 * 0.01);
    const r = snap(thick)!;
    expect(r.groundW).toBeGreaterThan(-1.0);
    expect(r.groundW).toBeCloseTo(-0.975, 1);
  });

  it('thân xe trong chân box và vài điểm nhiễu thấp hơn mặt đường không làm lệch kết quả', () => {
    const body: [number, number, number][] = [];
    for (let u = -1.8; u <= 1.8; u += 0.3) for (let v = -0.9; v <= 0.9; v += 0.3) for (const w of [-0.4, 0, 0.5]) body.push([u, v, w]);
    const noise: [number, number, number][] = [[2.5, 0.2, -1.6], [2.8, 0.5, -1.7], [-2.6, 0.1, -1.55]];
    expect(snap([...ring(() => -1.0), ...body, ...noise])!.dz).toBeCloseTo(-0.25, 2);
  });

  it('vỉa hè ngay trong một cung: lấy lớp THẤP nhất (mặt đường), không bị vỉa hè cao 20 cm kéo lên', () => {
    const r = snap(ring((_u, v) => (v > 1.5 ? -0.8 : -1.0)))!;
    expect(r.dz).toBeCloseTo(-0.25, 2);
    expect(r.ambiguous).toBe(false);
  });

  it('vỉa hè bọc một bên và phía sau xe: hai tầng mà không có lớp tiếp xúc → chọn tầng thấp nhưng mơ hồ, không báo, không tự dời · có mặt đất lọt dưới gầm → hết mơ hồ, báo', () => {
    const side = ring((u, v) => (v > 1.1 || u < -2.1 ? -0.8 : -1.0));
    const a = snap(side)!;
    expect(a.ambiguous).toBe(true);
    expect(a.confident).toBe(false);
    expect(a.warn).toBe(false);
    expect(a.dz).toBeCloseTo(-0.25, 2);
    const b = snap([...side, ...under(-1.0)])!;
    expect(b.ambiguous).toBe(false);
    expect(b.confident).toBe(true);
    expect(b.warn).toBe(true);
    expect(b.dz).toBeCloseTo(-0.25, 2);
    // xe đỗ TRÊN vỉa hè: lớp tiếp xúc ở tầng cao → chọn tầng cao
    const c = snap([...side, ...under(-0.8)])!;
    expect(c.dz).toBeCloseTo(-0.05, 2);
  });

  it('mơ hồ nhưng box cao hơn CẢ HAI tầng quá ngưỡng thì vẫn báo · một cung thấp bất thường (ổ gà, rãnh) không kéo lệch mặt đường', () => {
    const side = ring((u, v) => (v > 1.1 || u < -2.1 ? -1.0 : -1.2)); // box (đáy -0.75) cao hơn vỉa hè 25 cm, cao hơn mặt đường 45 cm
    const r = snap(side)!;
    expect(r.ambiguous).toBe(true);
    expect(r.warn).toBe(true);
    const hole = ring((u, v) => (u > 2.1 && Math.abs(v) < 0.3 ? -1.4 : -1.0)); // hố sâu 40 cm chỉ trong cung trước đầu xe
    const h = snap(hole)!;
    expect(h.dz).toBeCloseTo(-0.25, 2);
    expect(h.ambiguous).toBe(false);
    // hố / rãnh rộng phủ ≥ 2 cung: không phân biệt được với vỉa hè → mơ hồ, không tự dời box
    const wide = snap(ring((u, v) => (u > 2.1 && Math.abs(v) < 0.6 ? -1.4 : -1.0)))!;
    expect(wide.ambiguous).toBe(true);
    expect(wide.confident).toBe(false);
  });

  it('mặt dốc 6° dọc xe: đo đúng độ dốc, đáy đo tại TÂM chân box (độ cao trung bình dưới box, không theo góc cao nhất) · dốc 4° sang bên: độ cao tại chân box · dốc quá 8° thì không tin mặt nghiêng', () => {
    const t6 = Math.tan((6 * Math.PI) / 180);
    const r = snap(ring((u) => -1.0 + t6 * u))!;
    expect(r.slopeDeg).toBeCloseTo(6, 0);
    expect(r.steep).toBe(true);
    expect(r.groundW).toBeCloseTo(-1.0, 2);
    expect(r.dz).toBeCloseTo(r.groundW + 0.75, 5);
    expect(r.warn).toBe(true); // vẫn cao hơn mặt đường 25 cm
    expect(snap(ring((u) => -0.75 + t6 * u))!.warn).toBe(false); // đáy đúng độ cao trung bình trên dốc: không báo "chìm"
    const t12 = Math.tan((12 * Math.PI) / 180);
    expect(snap(ring((u) => -1.0 + t12 * u))?.slopeDeg ?? 0).toBeLessThan(8.01);
    const t4 = Math.tan((4 * Math.PI) / 180);
    const s = snap(ring((_u, v) => -0.9 + t4 * v))!;
    expect(s.slopeDeg).toBeCloseTo(4, 0);
    expect(s.groundW).toBeGreaterThan(-0.9 - 0.01);
    expect(s.groundW).toBeLessThan(-0.9 + t4 * 1 + 0.001);
  });

  it('vật ở xa: độ bất định lớn hơn nên box cao hơn 15 cm ở 60 m không bị báo (ở gần thì có)', () => {
    const scene = ring(() => -0.9);
    expect(snap(scene, 5)!.warn).toBe(true);
    const far = snap(scene, 60)!;
    expect(far.sigma).toBeGreaterThan(snap(scene, 5)!.sigma);
    expect(far.warn).toBe(false);
  });

  it('không có mặt đường quanh / dưới object → null · chỉ một cung (một vệt hẹp bên cạnh) → có số đo nhưng không tin, không báo, không tự dời', () => {
    const list: [number, number, number][] = [];
    for (let u = -9; u <= 9; u += 0.25) for (let v = -8; v <= 8; v += 0.25) if (Math.abs(u) > 5 || Math.abs(v) > 4) list.push([u, v, -1.0]);
    expect(snap(list)).toBeNull();
    const strip = ring(() => -1.3).filter(([u, v]) => v > 1.2 && v < 1.8 && Math.abs(u) < 0.8);
    const r = snap(strip)!;
    expect(r.nSectors).toBe(1);
    expect(r.confident).toBe(false);
    expect(r.warn).toBe(false);
  });

  it('chỉ thấy mặt đất dưới gầm (không có cung nào): dùng lớp tiếp xúc nhưng không tự dời và không báo', () => {
    const r = snap(under(-0.95))!;
    expect(r.nSectors).toBe(0);
    expect(r.dz).toBeCloseTo(-0.2, 2);
    expect(r.contactW).toBeCloseTo(-0.95, 2);
    expect(r.confident).toBe(false);
    expect(r.warn).toBe(false);
  });

  it('vị trí đặt thử: dời box sang chỗ mặt đất cao hơn thì đo lại theo chỗ mới', () => {
    const list = ring((u) => -1.0 + 0.1 * u);
    const a = snap(list)!;
    const b = groundSnap(pts(list), 4, 2, 1.5, { cu: 1, cv: 0, cw: 0 })!;
    expect(b.dz).toBeGreaterThan(a.dz);
  });

  it('vạch vẽ: mỗi cung đo được có một vạch ở mặt trên lớp, đánh dấu cung đã dùng', () => {
    const r = snap(ring((_u, v) => (v > 1.1 ? -0.8 : -1.0)))!;
    expect(r.marks.length).toBe(8);
    expect(r.marks.filter((m) => m.used).every((m) => Math.abs(m.w + 1.0) < 0.01)).toBe(true);
    expect(r.marks.filter((m) => !m.used).every((m) => Math.abs(m.w + 0.8) < 0.01)).toBe(true);
  });
});

describe('tiltFromPlane', () => {
  it("mặt ngang → không nghiêng · trục lên của box sau khi nghiêng trùng pháp tuyến mặt đường, với mọi yaw", () => {
    const t = tiltFromPlane(0, 0, 1.2);
    expect(t.rx).toBeCloseTo(0, 9);
    expect(t.ry).toBeCloseTo(0, 9);
    for (const yaw of [0, 0.7, -2.2, Math.PI / 2]) {
      const a = 0.15, b = -0.08;
      const { rx, ry } = tiltFromPlane(a, b, yaw);
      const up = apply(fromEuler(rx, ry, yaw), [0, 0, 1]);
      const gx = a * Math.cos(yaw) - b * Math.sin(yaw), gy = a * Math.sin(yaw) + b * Math.cos(yaw), n = Math.hypot(gx, gy, 1);
      expect(up[0]).toBeCloseTo(-gx / n, 9);
      expect(up[1]).toBeCloseTo(-gy / n, 9);
      expect(up[2]).toBeCloseTo(1 / n, 9);
    }
  });
  it("dốc dọc xe 10° (đầu xe lên cao) → pitch xấp xỉ -10° khi yaw = 0 · groundSnap trả mặt phẳng và độ dời khi nghiêng", () => {
    const t10 = Math.tan((10 * Math.PI) / 180);
    const t = tiltFromPlane(t10, 0, 0);
    expect((t.ry * 180) / Math.PI).toBeCloseTo(-10, 3);
    expect(t.rx).toBeCloseTo(0, 9);
    const t6 = Math.tan((6 * Math.PI) / 180);
    const r = snap(ring((u) => -1.0 + t6 * u))!;
    expect(r.plane.a).toBeCloseTo(t6, 2);
    expect(r.dzTilt).toBeCloseTo(-1.0 + 0.75 * Math.hypot(1, t6), 2);
  });
});

import { confirmSnap } from '../src/shared/ground';

describe('đo lại trước khi tự dời box', () => {
  const at = { cu: 0, cv: 0, cw: 0 };
  it('mặt đường rõ ràng: đo lại ở vị trí mới vẫn ra cùng mặt đường → cho dời', () => {
    const list = ring(() => -1.0);
    const g = snap(list)!;
    expect(confirmSnap(pts(list), 4, 2, 1.5, at, g)).toBe(true);
  });
  it('dời xong thì căn cứ đổi (lớp điểm dưới gầm ở -1,25 lọt vào dải tìm của đáy mới) → hai lần đo không khớp → không dời', () => {
    const list = [...ring(() => -1.0), ...under(-1.25)];
    const g = snap(list)!;
    expect(g.confident).toBe(true);
    expect(g.dz).toBeCloseTo(-0.25, 2);
    expect(confirmSnap(pts(list), 4, 2, 1.5, at, g)).toBe(false);
  });
  it('phép đo đầu không đủ căn cứ (mơ hồ / một cung) → không dời', () => {
    const strip = ring(() => -1.3).filter(([u, v]) => v > 1.2 && v < 1.8 && Math.abs(u) < 0.8);
    const g = snap(strip)!;
    expect(confirmSnap(pts(strip), 4, 2, 1.5, at, g)).toBe(false);
  });
});

describe('chỉ đo mặt đường trong bán kính 80 m quanh ego', () => {
  it('object cách ego 79 m: có số đo · 81 m: không đo (null), kể cả khi quanh object có mặt đường rõ ràng', () => {
    const list = ring(() => -1.0);
    expect(DEFAULT_GROUND.maxRange).toBe(80);
    expect(snap(list, 79)).not.toBeNull();
    expect(snap(list, 81)).toBeNull();
  });
});
