import { unzipSync } from 'fflate';
import { parsePcd, type PointCloud } from '../shared/pcd';
import { fetchBinary } from './bridge';

export class Cancelled extends Error {}

interface Task {
  n: number;
  prio: number; // nhỏ = ưu tiên cao; 0 = cửa sổ đang xem
  tries?: number; // số lần đã thử lại sau lỗi tải
  ok: (p: PointCloud) => void;
  fail: (e: Error) => void;
}

/**
 * Tải point cloud theo hàng đợi ưu tiên. Máy chủ sinh mỗi frame mất ~3 giây (6 frame song song ~7 giây ⇒ nhiều kết nối song song
 * nhanh hơn hẳn) nên: yêu cầu khẩn (cửa sổ đang xem) được dùng tới `maxTotal` kết nối; tải trước dùng `maxBackground` khi đang có
 * yêu cầu khẩn, và tới `maxIdle` (vẫn chừa chỗ cho yêu cầu khẩn) khi không có, để tải nền nhanh lúc người dùng đang xem/sửa.
 * Chỉ giữ trong bộ nhớ (không lưu ra đĩa).
 */
export class CloudLoader {
  private cache = new Map<number, PointCloud>(); // LRU
  private pending = new Map<number, Promise<PointCloud>>();
  private queue: Task[] = [];
  private running = 0;
  private listeners = new Set<() => void>();

  private runningUrgent = 0;
  private finished: number[] = []; // thời điểm (ms) hoàn thành của các frame gần đây, để đo tốc độ

  constructor(
    private cap: number, private maxTotal: number, private maxBackground: number, private maxIdle = maxBackground,
    private load: (n: number) => Promise<ArrayBuffer> = (n) => fetchBinary('frame', n),
    private parse: (b: ArrayBuffer) => PointCloud = (b) => parsePcd(b, false),
    private now: () => number = () => performance.now(),
  ) {}

  cachedCount() { return this.cache.size; }
  /** Frame đã có trong bộ nhớ (dùng đếm "đã tải" của cửa sổ, không phụ thuộc cột nào vừa được dựng). */
  has(n: number) { return this.cache.has(n); }
  /** Tốc độ tải thực tế (giây/frame, tính trên ~12 frame hoàn thành gần nhất); null nếu chưa đủ số liệu. */
  secondsPerFrame(): number | null {
    const f = this.finished;
    return f.length >= 3 ? (f[f.length - 1]! - f[0]!) / 1000 / (f.length - 1) : null;
  }
  subscribe(cb: () => void) {
    this.listeners.add(cb);
    return () => { this.listeners.delete(cb); };
  }
  private emit() { this.listeners.forEach((cb) => cb()); }

  get(n: number, prio = 0): Promise<PointCloud> {
    const hit = this.cache.get(n);
    if (hit) { this.cache.delete(n); this.cache.set(n, hit); return Promise.resolve(hit); }
    const queued = this.queue.find((t) => t.n === n);
    if (queued) queued.prio = Math.min(queued.prio, prio);
    const existing = this.pending.get(n);
    if (existing) { this.pump(); return existing; }
    const p = new Promise<PointCloud>((ok, fail) => this.queue.push({ n, prio, ok, fail }));
    this.pending.set(n, p);
    p.catch(() => {});
    this.pump();
    return p;
  }

  /**
   * Đặt kế hoạch tải: frame → độ ưu tiên. Yêu cầu đang xếp hàng mà không còn trong kế hoạch bị hủy;
   * yêu cầu đang chạy không bị ngắt.
   */
  plan(wanted: Map<number, number>) {
    this.queue = this.queue.filter((t) => {
      const prio = wanted.get(t.n);
      if (prio === undefined) {
        this.pending.delete(t.n);
        t.fail(new Cancelled());
        return false;
      }
      t.prio = prio;
      return true;
    });
    for (const [n, prio] of wanted) {
      if (!this.cache.has(n) && !this.pending.has(n)) void this.get(n, prio).catch(() => {});
    }
    this.pump();
  }

  private pump() {
    while (this.queue.length) {
      this.queue.sort((a, b) => a.prio - b.prio || a.n - b.n);
      const t = this.queue[0]!;
      const urgentActive = this.runningUrgent > 0 || this.queue.some((q) => q.prio === 0);
      const limit = t.prio === 0 ? this.maxTotal : urgentActive ? this.maxBackground : this.maxIdle;
      if (this.running >= limit) break;
      this.queue.shift();
      this.running++;
      const urgent = t.prio === 0;
      let retry = false;
      if (urgent) this.runningUrgent++;
      this.load(t.n)
        .then((buf) => this.parse(buf))
        .then((pc) => {
          this.finished.push(this.now());
          if (this.finished.length > 12) this.finished.shift();
          this.cache.set(t.n, pc);
          while (this.cache.size > this.cap) this.cache.delete(this.cache.keys().next().value as number);
          t.ok(pc);
          this.emit();
        })
        .catch((e) => {
          // Lỗi mạng / máy chủ tạm thời (quá tải khi nhiều kết nối song song…): thử lại tối đa 3 lần với thời gian chờ tăng dần, rồi mới báo lỗi.
          const tries = (t.tries ?? 0) + 1;
          console.warn('[CVLA] tải frame', t.n, 'lỗi (lần', tries, '):', String(e));
          if (tries < 4) { retry = true; t.tries = tries; setTimeout(() => { this.queue.push(t); this.pump(); }, 700 * tries); }
          else t.fail(e instanceof Error ? e : new Error(String(e)));
        })
        .finally(() => {
          if (!retry) this.pending.delete(t.n);
          this.running--;
          if (urgent) this.runningUrgent--;
          this.pump();
        });
    }
  }
}

export const pointClouds = new CloudLoader(64, 6, 2, 5);

class Lru<V> {
  private m = new Map<number, Promise<V>>();
  constructor(private cap: number, private load: (n: number) => Promise<V>) {}
  get(n: number): Promise<V> {
    const hit = this.m.get(n);
    if (hit) { this.m.delete(n); this.m.set(n, hit); return hit; }
    const p = this.load(n);
    this.m.set(n, p);
    p.catch(() => this.m.delete(n));
    while (this.m.size > this.cap) this.m.delete(this.m.keys().next().value as number);
    return p;
  }
}

/** Ảnh camera của frame: index camera → Blob JPEG. Chỉ tải khi người dùng chọn một frame. */
export const cameraImages = new Lru<Map<number, Blob>>(2, async (n) => {
  const files = unzipSync(new Uint8Array(await fetchBinary('context', n)));
  const out = new Map<number, Blob>();
  for (const [name, data] of Object.entries(files)) {
    const m = /image_(\d+)\.(?:jpe?g|png)$/i.exec(name);
    if (m) out.set(Number(m[1]), new Blob([data as BlobPart], { type: 'image/jpeg' }));
  }
  return out;
});
