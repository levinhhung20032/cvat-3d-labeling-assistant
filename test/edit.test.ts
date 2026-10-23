import { describe, expect, it } from 'vitest';
import { parseCuboid } from '../src/shared/cuboid';
import {
  applyLocalBox, dragEdge, dragMove, dragRotate, dragRotateRel, dragYawByX, handleOffset, hitTest, identityBox, upsertKeyframe,
} from '../src/shared/edit';
import { stateAt } from '../src/shared/interp';
import { shape, track } from './fixtures';

const cub = (over: Partial<ReturnType<typeof parseCuboid>> = {}) => ({
  x: 10, y: 5, z: 1, rx: 0, ry: 0, yaw: 0, sx: 4, sy: 2, sz: 1.5, ...over,
});

describe('kéo thả', () => {
  const k = 10; // px/mét
  it('di chuyển trên view Trên: kéo lên màn hình = tiến theo hướng box', () => {
    const b = dragMove('top', identityBox(cub()), 0, -20, k);
    expect(b.cu).toBeCloseTo(2);
    expect(b.cv).toBeCloseTo(0);
  });
  it('box yaw 90°: tiến theo hướng box = tăng y thế giới', () => {
    const base = cub({ yaw: Math.PI / 2 });
    const c = applyLocalBox(base, dragMove('top', identityBox(base), 0, -20, k));
    expect(c.x).toBeCloseTo(10);
    expect(c.y).toBeCloseTo(7);
  });
  it('kéo sang trái trên view Trên = sang trái của box (+v)', () => {
    expect(dragMove('top', identityBox(cub()), -30, 0, k).cv).toBeCloseTo(3);
  });
  it('view Bên: kéo xuống màn hình = hạ z', () => {
    expect(dragMove('side', identityBox(cub()), 0, 10, k).cw).toBeCloseTo(-1);
  });
  it('kéo cạnh trước +1 m: dài +1, tâm dịch 0,5 theo hướng box, cạnh sau đứng yên', () => {
    const b0 = identityBox(cub());
    const b = dragEdge('top', b0, 'u', 1, 0, -10, k);
    expect(b.sx).toBeCloseTo(5);
    expect(b.cu).toBeCloseTo(0.5);
    expect(b.cu - b.sx / 2).toBeCloseTo(b0.cu - b0.sx / 2);
  });
  it('kéo cạnh sau vào trong thu nhỏ, không dưới mức tối thiểu', () => {
    const b = dragEdge('top', identityBox(cub()), 'u', -1, 0, -1000, k);
    expect(b.sx).toBeGreaterThanOrEqual(0.05);
  });
  it('xoay: con trỏ bên trái tâm → yaw +90°; ở trên → 0', () => {
    expect(dragRotate(identityBox(cub()), -20, 0).dyaw).toBeCloseTo(Math.PI / 2);
    expect(dragRotate(identityBox(cub()), 0, -20).dyaw).toBeCloseTo(0);
  });
  it('luôn rx = ry = 0 sau khi áp', () => {
    const c = applyLocalBox({ ...cub(), rx: 0.1, ry: 0.2 }, identityBox(cub()));
    expect([c.rx, c.ry]).toEqual([0, 0]);
  });
});

describe('hitTest', () => {
  const size = 200, half = 10; // k = 10
  const b = identityBox(cub());
  it('giữa box = move; sát cạnh trước = edge u+; đầu mũi tên = rotate', () => {
    expect(hitTest('top', b, 100, 100, size, half)).toEqual({ mode: 'move' });
    expect(hitTest('top', b, 100, 100 - 20 + 1, size, half)).toEqual({ mode: 'edge', axis: 'u', sign: 1 });
    expect(hitTest('top', b, 100, 100 - (2 + handleOffset(10)) * 10, size, half)).toEqual({ mode: 'rotate' });
  });
  it('ngoài box = null', () => {
    expect(hitTest('top', b, 5, 5, size, half)).toBeNull();
  });
});

describe('upsertKeyframe', () => {
  const t = track(9, [shape(0), shape(10)]);
  it('thêm keyframe mới ở frame 5, giữ nguyên ID track, chèn đúng thứ tự, shape mới không có id', () => {
    t.shapes[0]!.id = 111;
    const out = upsertKeyframe(t, 5, cub());
    expect(out.id).toBe(9);
    expect(out.shapes.map((s) => s.frame)).toEqual([0, 5, 10]);
    expect(out.shapes[1]!.id).toBeUndefined();
    expect(out.shapes[0]!.id).toBe(111);
    expect(stateAt(out, 5)).toMatchObject({ status: 'key' });
    expect(stateAt(out, 5).cuboid!.x).toBe(10);
  });
  it('ghi đè keyframe sẵn có giữ nguyên id shape và đuôi đệm', () => {
    const out = upsertKeyframe(t, 0, cub({ x: 1 }));
    expect(out.shapes).toHaveLength(2);
    expect(out.shapes[0]!.id).toBe(111);
    expect(out.shapes[0]!.points).toHaveLength(16);
    expect(out.shapes[0]!.points[0]).toBe(1);
  });
  it('không sửa track gốc', () => {
    expect(t.shapes).toHaveLength(2);
  });
});

describe('tay nắm xoay ngắn + xoay bằng Alt', () => {
  it('tay nắm ngắn (0,4 m) khi phóng to, nhưng luôn cách mặt trước ≥ 12 px khi thu nhỏ', () => {
    expect(handleOffset(40)).toBeCloseTo(0.4);
    expect(handleOffset(10)).toBeCloseTo(1.2);
    expect(handleOffset(10) * 10).toBeGreaterThanOrEqual(12);
  });
  it('tay nắm không che cạnh trước: điểm sát cạnh vẫn là đổi kích thước', () => {
    const b = identityBox(cub());
    for (const [size, half] of [[200, 10], [300, 5], [150, 20]] as const) {
      const k = size / (2 * half), c = size / 2;
      const edgeY = c - 2 * k;
      expect(hitTest('top', b, c, edgeY + 1, size, half)).toEqual({ mode: 'edge', axis: 'u', sign: 1 });
    }
  });
  it('xoay tương đối không bị nhảy: bắt đầu ở đâu cũng dyaw = 0', () => {
    expect(dragRotateRel(identityBox(cub()), 30, 20, 30, 20).dyaw).toBeCloseTo(0);
  });
  it('xoay ngược chiều kim đồng hồ trên màn hình = +yaw; 90° khi từ phía trước sang bên trái', () => {
    // từ "trên" (0,-20) sang "trái" (-20,0)
    expect(dragRotateRel(identityBox(cub()), 0, -20, -20, 0).dyaw).toBeCloseTo(Math.PI / 2);
    // từ "trái" sang "trên" = -90°
    expect(dragRotateRel(identityBox(cub()), -20, 0, 0, -20).dyaw).toBeCloseTo(-Math.PI / 2);
  });
  it('qua ranh ±180° vẫn đi đường ngắn', () => {
    const d = dragRotateRel(identityBox(cub()), -20, 1, -20, -1).dyaw; // quanh hướng trái-xuống/lên nhỏ
    expect(Math.abs(d)).toBeLessThan(0.2);
  });
  it('điểm bắt đầu sát tâm: không xoay (tránh góc vô định)', () => {
    expect(dragRotateRel(identityBox(cub()), 1, 1, 30, 30).dyaw).toBe(0);
  });
  it('view Bên/Trước: kéo sang trái = +yaw theo độ dời ngang', () => {
    expect(dragYawByX(identityBox(cub()), -20).dyaw).toBeGreaterThan(0);
    expect(dragYawByX(identityBox(cub()), 20).dyaw).toBeLessThan(0);
    expect(dragYawByX(identityBox(cub()), -180).dyaw).toBeCloseTo(Math.PI / 2);
  });
});
