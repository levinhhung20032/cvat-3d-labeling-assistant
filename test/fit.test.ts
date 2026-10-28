import { describe, expect, it } from 'vitest';
import { fitGroundOf, fitReport, fitReportAt, type LocalPoints } from '../src/shared/fit';

const pts = (list: [number, number, number][]): LocalPoints => ({
  u: Float32Array.from(list.map((p) => p[0])),
  v: Float32Array.from(list.map((p) => p[1])),
  w: Float32Array.from(list.map((p) => p[2])),
  n: list.length,
});
// box 4 x 2 x 1.5 → hu=2, hv=1, hw=0.75
const list = (n: number, f: (i: number) => [number, number, number]) => Array.from({ length: n }, (_, i) => f(i));
const cloud = (n: number, f: (i: number) => [number, number, number]) => pts(list(n, f));

describe('fitReport', () => {
  it("cụm điểm nằm gọn trong box: ok · nhiều điểm lọt ra phía trước: misfit, phía \"trước\"", () => {
    {
    const r = fitReport(cloud(60, (i) => [-1.5 + (i % 10) * 0.3, -0.8 + (i % 6) * 0.3, -0.4 + (i % 5) * 0.2]), 4, 2, 1.5);
    expect(r.level).toBe('ok');
    expect(r.inside).toBe(60);
  }
    {
    const inside = Array.from({ length: 30 }, (_, i): [number, number, number] => [-1 + (i % 6) * 0.3, -0.5 + (i % 5) * 0.25, 0]);
    const front = Array.from({ length: 30 }, (_, i): [number, number, number] => [2.2 + (i % 4) * 0.1, -0.5 + (i % 5) * 0.25, 0]);
    const r = fitReport(pts([...inside, ...front]), 4, 2, 1.5);
    expect(r.level).toBe('misfit');
    expect(r.side).toBe('trước');
    expect(r.overshoot).toBeGreaterThan(0.1);
    expect(r.message).toMatch(/trước/);
  }
  });
  it("ít điểm trong box: sparse (guideline < 6 điểm) · bỏ qua điểm mặt đường sát đáy box", () => {
    {
    const r = fitReport(pts([[0, 0, 0], [0.5, 0, 0], [0, 0.5, 0]]), 4, 2, 1.5);
    expect(r.level).toBe('sparse');
  }
    {
    const ground = list(200, (i) => [-3 + (i % 20) * 0.3, -1.8 + Math.floor(i / 20) * 0.35, -0.7]);
    const body = list(40, (i) => [-1 + (i % 8) * 0.25, -0.6 + (i % 5) * 0.3, 0.1]);
    expect(fitReport(pts([...ground, ...body]), 4, 2, 1.5).level).toBe('ok');
  }
  });
  it('vài điểm rời rạc ngoài box không đủ ngưỡng: ok', () => {
    const body = list(80, (i) => [-1.5 + (i % 10) * 0.3, -0.8 + (i % 8) * 0.2, 0]);
    const stray = list(5, () => [2.3, 0, 0]);
    expect(fitReport(pts([...body, ...stray]), 4, 2, 1.5).level).toBe('ok');
  });
});


describe('fitReportAt (point cloud thô, box có yaw và tâm bất kỳ)', () => {
  const box = { x: 20, y: -5, z: 0.8, yaw: 0.6, sx: 4, sy: 2, sz: 1.5 };
  const world = (u: number, v: number, w: number): [number, number, number] => [
    box.x + u * Math.cos(box.yaw) - v * Math.sin(box.yaw), box.y + u * Math.sin(box.yaw) + v * Math.cos(box.yaw), box.z + w,
  ];
  const xyz = (pts: [number, number, number][]) => Float32Array.from(pts.flatMap(([u, v, w]) => world(u, v, w)));
  it('3 điểm trong box → ít điểm · 20 điểm trong box → ok · kết quả giống fitReport trên điểm đã chuyển về hệ box', () => {
    const few = list(3, (i) => [i * 0.3, 0, 0.2] as [number, number, number]);
    const many = list(20, (i) => [-1.5 + i * 0.15, 0, 0.2] as [number, number, number]);
    expect(fitReportAt(xyz(few), few.length, box).level).toBe('sparse');
    expect(fitReportAt(xyz(many), many.length, box).level).toBe('ok');
    expect(fitReportAt(xyz(many), many.length, box).inside).toBe(fitReport(pts(many), 4, 2, 1.5).inside);
  });
});

describe('đếm điểm của vật theo mặt đường ĐO ĐƯỢC (không theo một lớp cố định tính từ đáy box)', () => {
  // box 4 x 2 x 1.5 → đáy ở w = -0.75
  const groundAt = (w: number, holeUnderBox = false) => {
    const out: [number, number, number][] = [];
    for (let u = -4.6; u <= 4.6; u += 0.2) for (let v = -3.6; v <= 3.6; v += 0.2) {
      if (holeUnderBox && Math.abs(u) <= 2.1 && Math.abs(v) <= 1.1) continue;
      out.push([u, v, w]);
    }
    return out;
  };
  const body3 = list(3, (i) => [-0.5 + i * 0.5, 0, 0]);
  it('box chìm 30 cm: lớp mặt đường nằm TRONG box bị bỏ → còn đúng 3 điểm của vật → ít điểm (cách cũ đếm mặt đường là điểm của vật)', () => {
    const scene = [...groundAt(-0.45), ...body3];
    expect(fitReport(pts(scene), 4, 2, 1.5).level).not.toBe('sparse'); // cách cũ: mặt đường ở -0.45 cao hơn đáy + 0,2 nên bị đếm
    const r = fitReport(pts(scene), 4, 2, 1.5, undefined, { a: 0, b: 0, c: -0.45, clear: 0.2 });
    expect(r.inside).toBe(3);
    expect(r.level).toBe('sparse');
  });
  it('box lơ lửng 15 cm: không cắt mất bánh xe nằm sát đáy box (cách cũ bỏ cả 20 cm tính từ đáy)', () => {
    const wheels = list(5, (i) => [-1.5 + i * 0.7, 0.8, -0.65]);
    const scene = [...groundAt(-0.9), ...wheels, ...list(2, (i) => [i, 0, 0])];
    expect(fitReport(pts(scene), 4, 2, 1.5).level).toBe('sparse');
    const r = fitReport(pts(scene), 4, 2, 1.5, undefined, { a: 0, b: 0, c: -0.9, clear: 0.2 });
    expect(r.inside).toBe(7);
    expect(r.level).toBe('ok');
  });
  it('chỉ dùng mặt đường khi phép đo đủ căn cứ; dải bỏ qua = max(20 cm, 3 × phần dư)', () => {
    const plane = { a: 0, b: 0, c: -0.9 };
    expect(fitGroundOf({ confident: false, plane, rms: 0.01 })).toBeNull();
    expect(fitGroundOf(null)).toBeNull();
    expect(fitGroundOf({ confident: true, plane, rms: 0.01 })!.clear).toBeCloseTo(0.2, 9);
    expect(fitGroundOf({ confident: true, plane, rms: 0.1 })!.clear).toBeCloseTo(0.3, 9);
  });
  it('fitReportAt tự đo mặt đường quanh box (point cloud thô): box chìm 30 cm vẫn nhận ra chỉ có 3 điểm của vật', () => {
    const box = { x: 20, y: -5, z: 0.8, yaw: 0.6, sx: 4, sy: 2, sz: 1.5 };
    const world = ([u, v, w]: [number, number, number]) => [box.x + u * Math.cos(box.yaw) - v * Math.sin(box.yaw), box.y + u * Math.sin(box.yaw) + v * Math.cos(box.yaw), box.z + w];
    const scene = [...groundAt(-0.45), ...body3];
    const r = fitReportAt(Float32Array.from(scene.flatMap(world)), scene.length, box);
    expect(r.inside).toBe(3);
    expect(r.level).toBe('sparse');
  });
});
