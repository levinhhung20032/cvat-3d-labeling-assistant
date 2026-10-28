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

describe('thử lại khi tải lỗi và đếm frame đã tải', () => {
  const mk = (failTimes: number) => {
    let calls = 0;
    const loader = new CloudLoader(64, 6, 2, 5,
      async () => { calls++; if (calls <= failTimes) throw new Error('HTTP 502'); return new ArrayBuffer(0); },
      () => ({ count: 0, xyz: new Float32Array(0), rgb: null }) as PointCloud);
    return { loader, get calls() { return calls; } };
  };
  it('lỗi thoáng qua: tự thử lại rồi thành công, has() báo đã tải', async () => {
    vi.useFakeTimers();
    const s = mk(2);
    const p = s.loader.get(7, 0);
    await vi.advanceTimersByTimeAsync(5000);
    await expect(p).resolves.toBeDefined();
    expect(s.calls).toBe(3);
    expect(s.loader.has(7)).toBe(true);
    vi.useRealTimers();
  });
  it('lỗi kéo dài: sau 4 lần mới báo lỗi, has() vẫn false', async () => {
    vi.useFakeTimers();
    const s = mk(99);
    const p = s.loader.get(9, 0).then(() => 'ok', (e: Error) => e.message);
    await vi.advanceTimersByTimeAsync(20000);
    expect(await p).toContain('502');
    expect(s.calls).toBe(4);
    expect(s.loader.has(9)).toBe(false);
    vi.useRealTimers();
  });
});

describe('tạm dừng tải nền (nhường server cho CVAT)', () => {
  it('đang tạm dừng: tải nền không chạy, yêu cầu khẩn vẫn chạy; hết hạn thì tải nền chạy tiếp', async () => {
    vi.useFakeTimers();
    const started: number[] = [];
    let t = 0;
    const loader = new CloudLoader(64, 6, 2, 5,
      (n) => { started.push(n); return new Promise<ArrayBuffer>(() => {}); },
      () => ({ count: 0, xyz: new Float32Array(0), rgb: null }) as PointCloud,
      () => t);
    loader.pauseBackground(1000);
    loader.plan(new Map([[1, 5], [2, 6], [3, 7]]));
    expect(started).toEqual([]);
    void loader.get(9, 0);
    expect(started).toEqual([9]);
    t = 1100;
    await vi.advanceTimersByTimeAsync(1200);
    expect(started.sort()).toEqual([1, 9]); // sau khi hết hạn tải nền chạy lại, nhưng còn yêu cầu khẩn đang chạy nên chỉ dùng tối đa 2 kết nối
    vi.useRealTimers();
  });
});

describe('frame đã từng tải (để báo "đã tải xong")', () => {
  it('frame bị đẩy khỏi bộ nhớ LRU vẫn được tính là đã tải; frame chưa tải thì không', async () => {
    const loader = new CloudLoader(2, 6, 2, 5, async () => new ArrayBuffer(0), () => ({ count: 0, xyz: new Float32Array(0), rgb: null }) as PointCloud);
    for (const n of [1, 2, 3]) await loader.get(n);
    expect(loader.cachedCount()).toBe(2); // bộ nhớ chỉ giữ 2 frame
    expect(loader.peek(1)).toBeUndefined();
    expect([1, 2, 3].every((n) => loader.everLoaded(n))).toBe(true);
    expect(loader.everLoaded(4)).toBe(false);
  });
});

describe('frame tải lỗi (để tiến độ "tải xong" không kẹt mãi)', () => {
  it('lỗi sau mọi lần thử lại → failed; tải lại được thì không còn tính là lỗi', async () => {
    vi.useFakeTimers();
    let ok = false;
    const loader = new CloudLoader(64, 6, 2, 5, async () => { if (!ok) throw new Error('HTTP 502'); return new ArrayBuffer(0); }, () => ({ count: 0, xyz: new Float32Array(0), rgb: null }) as PointCloud);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const p = loader.get(7).catch(() => 'failed');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(await p).toBe('failed');
    expect(loader.failed(7)).toBe(true);
    expect(loader.failed(8)).toBe(false);
    ok = true;
    await loader.get(7);
    expect(loader.failed(7)).toBe(false);
    expect(loader.everLoaded(7)).toBe(true);
    warn.mockRestore();
    vi.useRealTimers();
  });
});

describe('tải nền cả job song song với cửa sổ Batch Review', () => {
  it('kế hoạch cửa sổ đặt lại KHÔNG hủy tải nền; frame cửa sổ chạy trước', () => {
    const s = fake({ total: 6, bg: 2, idle: 1 });
    s.loader.background(new Map([10, 11, 12].map((f) => [f, 100 + f])));
    s.loader.plan(new Map([[1, 0], [2, 0]]));
    expect(s.started.slice(0, 1)).toEqual([10]); // tải nền đã chạy trước khi có cửa sổ
    expect(s.started).toContain(1);
    expect(s.started).toContain(2);
    s.loader.plan(new Map([[3, 0]])); // đổi cửa sổ
    expect(s.started).toContain(3);
    // các frame nền còn xếp hàng vẫn còn: hoàn thành các yêu cầu đang chạy thì chúng được chạy tiếp
    return (async () => {
      for (const n of [10, 1, 2, 3]) if (s.started.includes(n)) await s.finish(n);
      expect(s.started).toContain(11);
    })();
  });
  it('frame đang được giữ (đã tải nhưng chưa tính) không bị đẩy khỏi bộ nhớ khi đầy; frame khác thì bị đẩy như thường', async () => {
    const loader = new CloudLoader(2, 6, 2, 5, async () => new ArrayBuffer(0), () => ({ count: 0, xyz: new Float32Array(0), rgb: null }) as PointCloud);
    const keep = new Set([1]);
    loader.setKeep((n) => keep.has(n));
    for (const n of [1, 2, 3]) await loader.get(n);
    expect(loader.peek(1)).toBeDefined(); // cũ nhất nhưng đang giữ
    expect(loader.peek(2)).toBeUndefined();
    expect(loader.peek(3)).toBeDefined();
    keep.clear();
    await loader.get(4);
    expect(loader.peek(1)).toBeUndefined(); // hết giữ thì bị đẩy như thường
  });
});
