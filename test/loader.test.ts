import { describe, expect, it, vi } from 'vitest';
import { parsePcd } from '../src/shared/pcd';
import type { PointCloud } from '../src/shared/pcd';

vi.stubGlobal('location', { hash: '' }); // stores.ts nạp bridge.ts, nơi đọc location / window khi khởi tạo
vi.stubGlobal('window', {});
const { CloudLoader } = await import('../src/panel/stores');
type CloudLoader = InstanceType<typeof CloudLoader>;

/** Server giả: mỗi lần tải là một lời hứa do test tự hoàn thành; đếm số kết nối đang chạy. */
function fake(opts: { total: number; bg: number; idle: number }) {
  const waiting = new Map<number, () => void>();
  let active = 0, peak = 0;
  const started: number[] = [];
  let t = 0;
  const loader = new CloudLoader(64, opts.total, opts.bg, opts.idle,
    (n) => new Promise<ArrayBuffer>((ok) => {
      active++; peak = Math.max(peak, active); started.push(n);
      waiting.set(n, () => { active--; ok(new ArrayBuffer(0)); });
    }),
    () => ({ count: 0, xyz: new Float32Array(0), rgb: null }) as PointCloud,
    () => (t += 1000));
  const finish = async (n: number) => { waiting.get(n)!(); waiting.delete(n); await new Promise((r) => setTimeout(r, 0)); };
  return { loader, started, finish, get active() { return active; }, get peak() { return peak; } };
}
const plan = (l: CloudLoader, frames: number[], prio: (f: number) => number) => l.plan(new Map(frames.map((f) => [f, prio(f)])));

describe('tải point cloud', () => {
  it('không có yêu cầu khẩn: tải nền dùng tới maxIdle kết nối (chừa 1 chỗ cho yêu cầu khẩn)', () => {
    const s = fake({ total: 6, bg: 2, idle: 5 });
    plan(s.loader, [1, 2, 3, 4, 5, 6, 7, 8], (f) => f);
    expect(s.active).toBe(5);
  });
  it('có yêu cầu khẩn đang xếp hàng: tải nền chỉ dùng maxBackground', () => {
    const s = fake({ total: 6, bg: 2, idle: 5 });
    plan(s.loader, [0, 1, 2, 3, 4, 5, 6, 7], (f) => (f === 0 ? 0 : f));
    expect(s.started[0]).toBe(0);
    expect(s.active).toBeLessThanOrEqual(3); // 1 khẩn + tối đa 2 nền
  });
  it('yêu cầu khẩn đến lúc tải nền đã chiếm 5 kết nối vẫn có chỗ ngay', () => {
    const s = fake({ total: 6, bg: 2, idle: 5 });
    plan(s.loader, [1, 2, 3, 4, 5, 6, 7, 8], (f) => f);
    expect(s.active).toBe(5);
    void s.loader.get(40, 0);
    expect(s.active).toBe(6);
    expect(s.started).toContain(40);
  });
  it('không bao giờ vượt maxTotal', async () => {
    const s = fake({ total: 6, bg: 2, idle: 5 });
    plan(s.loader, Array.from({ length: 20 }, (_, i) => i + 1), (f) => f);
    for (const n of [...s.started]) await s.finish(n);
    expect(s.peak).toBeLessThanOrEqual(6);
  });
  it('đo tốc độ giây/frame sau vài frame hoàn thành', async () => {
    const s = fake({ total: 6, bg: 2, idle: 5 });
    expect(s.loader.secondsPerFrame()).toBeNull();
    plan(s.loader, [1, 2, 3, 4], (f) => f);
    for (const n of [...s.started]) await s.finish(n);
    expect(s.loader.secondsPerFrame()).toBeCloseTo(1, 5); // đồng hồ giả tăng 1000 ms mỗi lần
  });
});

describe('đọc PCD', () => {
  it('đường nhanh (Float32Array) cho kết quả y hệt đường DataView', () => {
    const n = 5, stride = 16;
    const head = `# .PCD v0.7\nVERSION 0.7\nFIELDS x y z rgb\nSIZE 4 4 4 4\nTYPE F F F F\nCOUNT 1 1 1 1\nWIDTH ${n}\nHEIGHT 1\nVIEWPOINT 0 0 0 1 0 0 0\nPOINTS ${n}\nDATA binary\n`;
    const pad = (4 - (head.length % 4)) % 4; // thử cả hai trường hợp căn hàng bằng cách chèn khoảng trắng vào header
    const h = head.replace('DATA binary', ' '.repeat(pad) + 'DATA binary');
    const hb = new TextEncoder().encode(h);
    const buf = new ArrayBuffer(hb.length + n * stride);
    new Uint8Array(buf).set(hb);
    const dv = new DataView(buf, hb.length);
    for (let i = 0; i < n; i++) { dv.setFloat32(i * 16, i + 0.5, true); dv.setFloat32(i * 16 + 4, -i, true); dv.setFloat32(i * 16 + 8, i * 2, true); dv.setUint32(i * 16 + 12, 0xff00ff, true); }
    const fast = parsePcd(buf, false);
    const slow = parsePcd(buf, true);
    expect(Array.from(fast.xyz)).toEqual(Array.from(slow.xyz));
    expect(fast.count).toBe(n);
    expect(fast.xyz[3]).toBe(1.5);
  });
});
