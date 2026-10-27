import { describe, expect, it } from 'vitest';
import { predictGround, refineGround, type GroundFrameIn } from '../src/shared/groundTrack';
import type { GroundResult } from '../src/shared/ground';

const Z = 0.8, SZ = 1.6; // tâm box z = 0,8 ⇒ đáy ở 0,0; mặt đường tuyệt đối gz ⇒ dz = gz - 0
const raw = (gz: number): GroundResult => ({ groundW: gz - Z, dz: gz - (Z - SZ / 2), n: 30, flat: true, method: 'plane', slopeDeg: 0.5 });
const frames = (gz: (f: number) => number | null, n = 12): GroundFrameIn[] =>
  Array.from({ length: n }, (_, f) => { const g = gz(f); return { f, z: Z, sz: SZ, raw: g === null ? null : raw(g) }; });

describe('dự đoán mặt đường từ các frame khác', () => {
  it("hồi quy bền: mặt phẳng ngang và dốc đều · ít hơn 3 điểm: hai điểm nhất quán thì lấy trung bình, lệch nhau thì không dự đoán", () => {
    {
    expect(predictGround([0, 1, 2, 4].map((f) => ({ f, gz: 0.2 })), 3)).toBeCloseTo(0.2, 6);
    expect(predictGround([0, 1, 2, 4, 5].map((f) => ({ f, gz: 0.05 * f })), 3)).toBeCloseTo(0.15, 6);
  }
    {
    expect(predictGround([{ f: 0, gz: 0.1 }, { f: 2, gz: 0.2 }], 1)).toBeCloseTo(0.15, 6);
    expect(predictGround([{ f: 0, gz: 0.1 }, { f: 2, gz: 0.9 }], 1)).toBeNull();
    expect(predictGround([{ f: 0, gz: 0.1 }], 1)).toBeNull();
  }
  });
});

describe('refineGround', () => {
  it("đo lẻ loi (lơ lửng giả 0,45 m ở một frame) bị thay bằng dự đoán từ các frame khác · frame không đo được thì lấy dự đoán; mặt dốc đều dự đoán đúng theo xu hướng", () => {
    {
    const r = refineGround(frames((f) => (f === 5 ? 0.45 : 0.0)));
    expect(r.get(5)!.source).toBe('predicted');
    expect(r.get(5)!.dz).toBeCloseTo(0, 6); // đáy đã chạm đất: không còn báo lơ lửng
    expect(r.get(4)!.source).toBe('measured');
  }
    {
    const r = refineGround(frames((f) => (f === 6 ? null : 0.04 * f)));
    expect(r.get(6)!.source).toBe('predicted');
    expect(r.get(6)!.dz).toBeCloseTo(0.24, 6);
  }
  });
  it("phép đo khớp dự đoán trong dung sai thì giữ nguyên phép đo (không bị làm mượt) · quá ít frame lân cận: giữ phép đo gốc, không bác bỏ; không đo được thì null", () => {
    {
    const r = refineGround(frames((f) => 0.03 * (f % 2)));
    expect([...r.values()].every((x) => x!.source === 'measured')).toBe(true);
  }
    {
    const two = refineGround([{ f: 0, z: Z, sz: SZ, raw: raw(0) }, { f: 1, z: Z, sz: SZ, raw: raw(0.5) }]);
    expect(two.get(1)!.source).toBe('measured');
    expect(two.get(1)!.dz).toBeCloseTo(0.5, 6);
    expect(refineGround([{ f: 0, z: Z, sz: SZ, raw: null }]).get(0)).toBeNull();
  }
  });
  it("xa quá 1 m so với đáy box thì không gợi ý · chỉ dùng frame trong cửa sổ ±window: đoạn xa không ảnh hưởng", () => {
    {
    const r = refineGround(frames((f) => (f === 5 ? null : 1.4)));
    expect(r.get(5)).toBeNull();
  }
    {
    const r = refineGround(frames((f) => (f <= 2 ? 0.5 : f === 13 ? null : 0.0), 14));
    expect(r.get(13)!.source).toBe('predicted');
    expect(r.get(13)!.dz).toBeCloseTo(0, 6); // lân cận 7..12 đều 0; ba frame đầu (xa quá 6) không bị trộn vào
  }
  });
});
