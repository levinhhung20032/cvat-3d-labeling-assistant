import { unzipSync } from 'fflate';
import { parsePcd, type PointCloud } from '../shared/pcd';
import { fetchBinary } from './bridge';

export class Cancelled extends Error {}

interface Task {
  n: number;
  prio: number; // nhỏ = ưu tiên cao; 0 = cửa sổ đang xem
  ok: (p: PointCloud) => void;
  fail: (e: Error) => void;
}

/**
 * Tải point cloud theo hàng đợi ưu tiên. Máy chủ sinh mỗi frame mất ~3 giây nên: yêu cầu khẩn
 * (cửa sổ đang xem) được dùng tới `maxTotal` kết nối, còn tải trước chỉ dùng `maxBackground`,
 * để luôn còn chỗ cho frame người dùng vừa chuyển tới. Chỉ giữ trong bộ nhớ (không lưu ra đĩa).
 */
class CloudLoader {
  private cache = new Map<number, PointCloud>(); // LRU
  private pending = new Map<number, Promise<PointCloud>>();
  private queue: Task[] = [];
  private running = 0;
  private listeners = new Set<() => void>();

  constructor(private cap: number, private maxTotal: number, private maxBackground: number) {}

  cachedCount() { return this.cache.size; }
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
      if (this.running >= (t.prio === 0 ? this.maxTotal : this.maxBackground)) break;
      this.queue.shift();
      this.running++;
      fetchBinary('frame', t.n)
        .then((buf) => parsePcd(buf, false))
        .then((pc) => {
          this.cache.set(t.n, pc);
          while (this.cache.size > this.cap) this.cache.delete(this.cache.keys().next().value as number);
          t.ok(pc);
          this.emit();
        })
        .catch((e) => t.fail(e instanceof Error ? e : new Error(String(e))))
        .finally(() => {
          this.pending.delete(t.n);
          this.running--;
          this.pump();
        });
    }
  }
}

export const pointClouds = new CloudLoader(64, 4, 2);

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
