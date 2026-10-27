import { describe, expect, it } from 'vitest';
import { applyLocalBox, cornerInView, cornerOffset, dragTilt, identityBox, isTilted, viewFrame } from '../src/shared/edit';
import { apply, fromEuler, mul, rotX, rotY, rotZ, toEuler } from '../src/shared/rot';
import { MAX_TILT, type Cuboid } from '../src/shared/cuboid';
import { stateAt } from '../src/shared/interp';
import { serializeCuboid } from '../src/shared/cuboid';
import { shape, track } from './fixtures';

const near = (a: number[], b: number[]) => a.forEach((v, i) => expect(v).toBeCloseTo(b[i]!, 9));
const cub = (o: Partial<Cuboid> = {}): Cuboid => ({ x: 10, y: 5, z: 1, rx: 0, ry: 0, yaw: 0.6, sx: 4, sy: 2, sz: 1.5, ...o });

describe('phép quay', () => {
  it('toEuler(fromEuler) khớp lại góc (trong vùng không suy biến)', () => {
    for (const [rx, ry, rz] of [[0.1, -0.2, 1.2], [-0.3, 0.25, -2.5], [0, 0, 0.7]] as const) {
      const e = toEuler(fromEuler(rx, ry, rz));
      near([e.rx, e.ry, e.rz], [rx, ry, rz]);
    }
  });
});

describe('box nghiêng', () => {
  it("giữ rx, ry khi chỉ đổi yaw / dời; không đổi khi không có delta · pitch quanh trục riêng: trục lên của box xoay đúng góc, đầu xe chúi xuống khi dpitch > 0", () => {
    {
    const c = applyLocalBox(cub({ rx: 0.1, ry: -0.05 }), { ...identityBox(cub()), dyaw: 0.3, cu: 1 });
    expect(c.rx).toBeCloseTo(0.1, 12);
    expect(c.ry).toBeCloseTo(-0.05, 12);
    expect(c.yaw).toBeCloseTo(0.9, 12);
  }
    {
    const base = cub({ yaw: 0 });
    const out = applyLocalBox(base, { ...identityBox(base), dpitch: 0.2 });
    const r = fromEuler(out.rx, out.ry, out.yaw);
    const front = apply(r, [1, 0, 0]); // đầu xe
    expect(front[2]).toBeLessThan(0);
    expect(front[2]).toBeCloseTo(-Math.sin(0.2), 9);
    const expected = mul(fromEuler(0, 0, 0), rotY(0.2));
    near(r, expected);
  }
  });
  it("roll quanh trục dọc của box (có yaw bất kỳ) · kẹp trong ±30° và vị trí tâm không đổi khi chỉ xoay", () => {
    {
    const base = cub({ yaw: 1.1 });
    const out = applyLocalBox(base, { ...identityBox(base), droll: 0.15 });
    const expected = mul(fromEuler(0, 0, 1.1), rotX(0.15));
    near(fromEuler(out.rx, out.ry, out.yaw), expected);
  }
    {
    const base = cub({ yaw: 0 });
    const out = applyLocalBox(base, { ...identityBox(base), dpitch: 1.5 });
    expect(Math.abs(out.ry)).toBeLessThanOrEqual(MAX_TILT + 1e-12);
    expect([out.x, out.y, out.z]).toEqual([base.x, base.y, base.z]);
  }
  });
  it("cornerOffset: không nghiêng thì như cũ (xoay dyaw); isTilted · dragTilt: chỉ view Bên (pitch) / Trước (roll); view Trên không đổi", () => {
    {
    const base = cub({ yaw: 0.6 });
    const b = { ...identityBox(base), dyaw: 0.4 };
    const o = cornerOffset(base, b, [2, 1, 0.5]);
    expect(o[0]).toBeCloseTo(2 * Math.cos(0.4) - Math.sin(0.4), 9);
    expect(o[1]).toBeCloseTo(2 * Math.sin(0.4) + Math.cos(0.4), 9);
    expect(o[2]).toBeCloseTo(0.5, 9);
    expect(isTilted(base, b)).toBe(false);
    expect(isTilted({ ...base, ry: 0.1 }, b)).toBe(true);
  }
    {
    const b = identityBox(cub());
    expect(dragTilt('top', b, 50, 0, 0, -50)).toBe(b);
    const side = dragTilt('side', b, 50, 0, 0, -50); // kéo ngược chiều kim đồng hồ 90° → đầu xe nâng
    expect(side.dpitch).toBeCloseTo(-Math.PI / 2, 9);
    const front = dragTilt('front', b, 50, 0, 0, -50);
    expect(front.droll).toBeCloseTo(Math.PI / 2, 9);
  }
  });
  it('nội suy rx, ry giữa hai keyframe', () => {
    const mk = (f: number, ry: number) => ({ ...shape(f), points: serializeCuboid(cub({ ry }), Array(16).fill(0)) });
    const t = track(1, [mk(0, 0), mk(4, 0.2)]);
    expect(stateAt(t, 2).cuboid!.ry).toBeCloseTo(0.1, 9);
  });
});

describe('khung nhìn căn theo box (box nghiêng không bao giờ bị thấy nghiêng)', () => {
  const base = { rx: 0.2, ry: -0.15, yaw: 0.7 };
  const p: [number, number, number] = [2, 1, 0.5];
  it("box thẳng → không cần khung riêng · chưa kéo gì: góc box trong khung nhìn đúng bằng toạ độ riêng của box", () => {
    {
    expect(viewFrame({ rx: 0, ry: 0, yaw: 1 })).toBeNull();
  }
    {
    const c = cornerInView(base, { cu: 0, cv: 0, cw: 0, dyaw: 0, sx: 4, sy: 2, sz: 1.5 }, p);
    p.forEach((v, i) => expect(c[i]).toBeCloseTo(v, 9));
  }
  });
  it('điểm ở hệ yaw quay bằng viewFrame trùng toạ độ riêng của box', () => {
    const m = viewFrame(base)!;
    const inYaw = apply(rotZ(-base.yaw), apply(fromEuler(base.rx, base.ry, base.yaw), p)); // điểm của box trong hệ yaw
    const back = apply(m, inYaw);
    p.forEach((v, i) => expect(back[i]).toBeCloseTo(v, 9));
  });
});
