import { describe, expect, it, vi } from 'vitest';
import type { PointCloud } from '../src/shared/pcd';

vi.stubGlobal('location', { hash: '' }); // stores.ts nạp bridge.ts, nơi đọc location / window khi khởi tạo
vi.stubGlobal('window', {});
const { CloudLoader } = await import('../src/panel/stores');

/** Point cloud giả mang số frame gốc trong `count` để kiểm tra frame nào về đúng chỗ nào. */
const pcOf = (b: ArrayBuffer) => ({ count: new DataView(b).getUint32(0, true), xyz: new Float32Array(0), rgb: null }) as PointCloud;
const bufOf = (frame: number) => { const b = new ArrayBuffer(4); new DataView(b).setUint32(0, frame, true); return b; };
const tick = () => new Promise((r) => setTimeout(r, 0));

/** Máy chủ giả: chunk gửi từng file khi test gọi `deliver`; tải từng frame thì trả ngay. */
function setup(opts: { start?: number; stop?: number; size?: number; files?: (k: number, first: number, count: number) => number[] } = {}) {
  const start = opts.start ?? 0, stop = opts.stop ?? 9, size = opts.size ?? 4;
  const perFrame: number[] = [];
  const aborts = { n: 0 };
  const streams: { k: number; first: number; count: number; send: (i: number) => void; end: (err?: Error) => void; files: number[] }[] = [];
  const loader = new CloudLoader(64, 6, 2, 3, async (n) => { perFrame.push(n); return bufOf(n); }, pcOf);
  const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
  loader.onAbort = () => { aborts.n++; };
  loader.setChunks({
    start, stop, size,
    stream: (k, first, count, onFile) => new Promise<number>((ok, fail) => {
      const files = opts.files?.(k, first, count) ?? Array.from({ length: count }, (_, i) => first + i);
      let sent = 0;
      streams.push({ k, first, count, files, send: (i) => { onFile(i, bufOf(files[i]!)); sent++; }, end: (err) => (err ? fail(err) : ok(sent)) });
    }),
  });
  /** Gửi hết file của chunk thứ `idx` (theo thứ tự bắt đầu) rồi kết thúc. */
  const deliverAll = async (idx: number) => { const s = streams[idx]!; s.files.forEach((_, i) => s.send(i)); s.end(); await tick(); };
  return { loader, perFrame, streams, deliverAll, warn, aborts };
}

describe('tải point cloud theo chunk (như giao diện CVAT)', () => {
  it('frame chờ cả chunk về, không gửi request riêng; mỗi frame về đúng số frame', async () => {
    const s = setup();
    const ps = [0, 1, 2, 3].map((n) => s.loader.get(n, 0));
    expect(s.streams.map((x) => [x.k, x.first, x.count])).toEqual([[0, 0, 4]]);
    await s.deliverAll(0);
    expect((await Promise.all(ps)).map((p) => p.count)).toEqual([0, 1, 2, 3]);
    expect(s.perFrame).toEqual([]);
    expect(s.loader.everLoaded(3)).toBe(true);
  });

  it('chunk cuối ngắn hơn: count = số frame còn lại của job; job bắt đầu giữa task (start ≠ 0)', async () => {
    const s = setup({ start: 100, stop: 109, size: 4 });
    void s.loader.get(109, 0).catch(() => {});
    expect(s.streams.map((x) => [x.k, x.first, x.count])).toEqual([[2, 108, 2]]);
  });

  it('tải nền: một chunk mỗi lần; cửa sổ đang xem cần chunk khác thì chạy thêm một', async () => {
    const s = setup();
    s.loader.background(new Map([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((f) => [f, 100 + f])));
    expect(s.streams.map((x) => x.k)).toEqual([0]);
    s.loader.plan(new Map([[9, 0]]));
    expect(s.streams.map((x) => x.k)).toEqual([0, 2]);
    await s.deliverAll(0);
    expect(s.streams.map((x) => x.k)).toEqual([0, 2, 1]);
    expect(s.perFrame).toEqual([]);
  });

  it('đánh số không khớp (lỗi đối chiếu) → bỏ mọi frame của chunk, đánh dấu không tin được, không thử lại chunk, tải từng frame', async () => {
    const s = setup();
    const p = s.loader.get(2, 0);
    const st = s.streams[0]!;
    st.send(0); st.send(1);
    expect(s.loader.has(0)).toBe(true);
    st.end(new Error('chunk 0 có 3 file, dự kiến 4'));
    await tick(); await tick();
    expect(s.loader.has(0)).toBe(false); // frame đã về từ chunk sai bị bỏ
    expect(s.loader.invalidated(1)).toBe(true); // nơi đang hiện frame 1 phải tải lại
    expect((await p).count).toBe(2); // frame còn chờ thì tải riêng
    expect(s.perFrame).toEqual([2]);
    expect((await s.loader.get(1, 0)).count).toBe(1);
    expect(s.loader.invalidated(1)).toBe(false);
    expect(s.streams.length).toBe(1); // chunk sai không bao giờ tải lại
    expect(s.perFrame).toEqual([2, 1]);
  });

  it('số file thiếu → coi như đánh số sai, bỏ frame của chunk', async () => {
    const s = setup({ files: (_k, first) => [first, first + 1] });
    const p = s.loader.get(3, 0);
    await s.deliverAll(0);
    await tick();
    expect(s.loader.has(0)).toBe(false);
    expect(s.loader.invalidated(0)).toBe(true);
    expect((await p).count).toBe(3);
    expect(s.perFrame).toEqual([3]);
    expect(s.streams.length).toBe(1);
  });

  it('lỗi mạng / máy chủ → thử lại chunk một lần, vẫn lỗi thì tải từng frame; "Tải lại" cho chunk thêm cơ hội', async () => {
    const s = setup();
    const p = s.loader.get(2, 0);
    s.streams[0]!.end(new Error('GET /api/jobs/1/data (chunk 0) → 503'));
    await tick();
    expect(s.streams.length).toBe(2); // thử lại chunk
    expect(s.perFrame).toEqual([]);
    s.streams[1]!.end(new Error('mất kết nối'));
    await tick(); await tick();
    expect((await p).count).toBe(2);
    expect(s.perFrame).toEqual([2]);
    s.loader.retryFailed();
    void s.loader.get(3, 0);
    await tick();
    expect(s.streams.length).toBe(3);
  });

  it('chunk đã tải xong mà frame bị đẩy khỏi bộ nhớ → tải lẻ frame đó, không tải lại cả chunk', async () => {
    const s = setup();
    void s.loader.get(0, 0);
    await s.deliverAll(0);
    (s.loader as unknown as { cache: Map<number, PointCloud> }).cache.delete(1);
    await s.loader.get(1, 0);
    expect(s.perFrame).toEqual([1]);
    expect(s.streams.length).toBe(1);
  });

  it('frame ngoài job, hoặc không bật chunk → tải từng frame như cũ', async () => {
    const s = setup({ start: 0, stop: 9 });
    await s.loader.get(15, 0);
    expect(s.perFrame).toEqual([15]);
    s.loader.setChunks(null);
    await s.loader.get(3, 0);
    expect(s.perFrame).toEqual([15, 3]);
  });

  it('đổi job giữa chừng: dữ liệu chunk của job cũ bị bỏ', async () => {
    const s = setup();
    const p = s.loader.get(0, 0).catch(() => 'x');
    const old = s.streams[0]!;
    s.loader.setChunks(null); // sang job khác: yêu cầu đang chờ chuyển sang tải từng frame
    old.send(0); old.end();
    await tick();
    expect(s.perFrame).toEqual([0]);
    expect((await p as PointCloud).count).toBe(0);
  });

  it('tải lại tất cả: bỏ khỏi bộ nhớ rồi tải lại cả job theo chunk, không gửi request từng frame', async () => {
    const s = setup(); // frame 0…9, 4 frame mỗi chunk
    void s.loader.get(0, 0);
    await s.deliverAll(0);
    expect(s.loader.peek(2)).toBeDefined();
    expect(s.loader.reloadAll(0, 9)).toBe(10);
    expect(s.loader.peek(2)).toBeUndefined();
    expect(s.loader.everLoaded(2)).toBe(false);
    expect(s.streams.map((x) => x.k)).toEqual([0, 0]); // chunk 0 tải lại
    await s.deliverAll(1);
    await s.deliverAll(2);
    await s.deliverAll(3);
    for (let n = 0; n <= 9; n++) expect(s.loader.peek(n)?.count).toBe(n);
    expect(s.streams.map((x) => x.k)).toEqual([0, 0, 1, 2]);
    expect(s.perFrame).toEqual([]);
  });

  it('ngắt request đang treo: báo content script huỷ, bỏ frame nhận dở, chunk chạy lại từ đầu với số lần thử mới', async () => {
    const s = setup();
    void s.loader.get(0, 0);
    s.streams[0]!.send(0); // chunk 0 đã nhận file đầu rồi treo
    s.loader.abortInFlight();
    await tick();
    expect(s.aborts.n).toBe(1);
    const p = s.loader.get(0, 0); // kế hoạch tải nền đặt lại yêu cầu cho frame bị bỏ (ở app thật làm mỗi khi kho đổi)
    expect(s.streams.map((x) => x.k)).toEqual([0, 0]); // chunk chạy lại ngay
    expect(s.loader.peek(0)).toBeUndefined(); // frame nhận dở bị bỏ
    s.streams[0]!.send(1); // dữ liệu muộn của luồng cũ bị bỏ
    expect(s.loader.peek(1)).toBeUndefined();
    await s.deliverAll(1);
    expect((await p).count).toBe(0);
    expect(s.loader.peek(1)?.count).toBe(1);
  });

  it('tiến trình tải lại: số frame đã về, chunk chờ máy chủ rồi đang nhận, hết đợt thì total = 0', async () => {
    const s = setup();
    expect(s.loader.reloadStatus().total).toBe(0);
    s.loader.reloadAll(0, 7);
    let st = s.loader.reloadStatus();
    expect([st.total, st.left, st.chunks.map((c) => [c.k, c.got, c.count])]).toEqual([8, 8, [[0, 0, 4]]]);
    s.streams[0]!.send(0); s.streams[0]!.send(1);
    st = s.loader.reloadStatus();
    expect([st.left, st.chunks[0]!.got]).toEqual([6, 2]);
    s.streams[0]!.send(2); s.streams[0]!.send(3); s.streams[0]!.end();
    await tick();
    await s.deliverAll(1);
    expect(s.loader.reloadStatus().total).toBe(0);
  });

  it('tiến trình tải lại cũng tính các frame lỗi được thử lại', async () => {
    const s = setup();
    (s.loader as unknown as { failed_: Set<number> }).failed_.add(5);
    s.loader.retryFailed();
    const st = s.loader.reloadStatus();
    expect([st.total, st.left]).toEqual([1, 1]);
  });
});

describe('frame đã có trong bộ nhớ đệm HTTP · tạm dừng khi kiểm tra', () => {
  it('frame đã có trong bộ nhớ đệm tải từng frame (không chờ chunk), các frame còn lại vẫn theo chunk', async () => {
    const s = setup();
    s.loader.setCached(new Set([0, 1]));
    const ps = [0, 1, 2, 3].map((n) => s.loader.get(n, 0));
    await tick();
    expect(s.perFrame.sort()).toEqual([0, 1]);
    expect(s.streams.map((x) => [x.k, x.first, x.count])).toEqual([[0, 0, 4]]); // frame 2, 3 vẫn đợi chunk
    await s.deliverAll(0);
    expect((await Promise.all(ps)).map((p) => p.count)).toEqual([0, 1, 2, 3]);
  });
  it('đặt bộ nhớ đệm sau khi đã xếp hàng chờ chunk: frame có trong bộ nhớ đệm chuyển sang tải từng frame', async () => {
    const s = setup();
    const p0 = s.loader.get(0, 0);
    s.loader.setCached(new Set([0]));
    await tick();
    expect((await p0).count).toBe(0);
    expect(s.perFrame).toEqual([0]);
  });
  it('hold: không gửi request nào cho tới khi hold(false)', async () => {
    const s = setup();
    s.loader.hold(true);
    const p = s.loader.get(5, 0);
    await tick();
    expect(s.perFrame).toEqual([]);
    expect(s.streams).toEqual([]);
    s.loader.setChunks(null);
    s.loader.hold(false);
    expect((await p).count).toBe(5);
    expect(s.perFrame).toEqual([5]);
  });
});

