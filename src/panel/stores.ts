import { unzipSync } from 'fflate';
import { parsePcd, type PointCloud } from '../shared/pcd';
import { abortLoads, fetchBinary } from './bridge';

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
/** Thời gian chờ (ms) giữa các lần thử lại khi máy chủ báo bận (503 / 429). */
const BUSY_DELAYS = [2000, 4000, 8000, 15000, 25000, 40000];
/** Sau khi gặp 503 / 429: trong ngần này ms chỉ chạy tối đa BUSY_PARALLEL kết nối song song (tải 6 frame cùng lúc làm máy chủ yếu quá tải thêm). */
const BUSY_THROTTLE_MS = 90_000, BUSY_PARALLEL = 2;
const LOAD_TIMEOUT_MS = 60_000;

/**
 * Nguồn chunk của job (giống cách giao diện CVAT tải point cloud): frame `start` … `stop`, `size` frame mỗi chunk, chunk đánh số theo
 * job. `stream` tải chunk `index` theo luồng, gọi `onFile(i, buf)` cho frame `first + i` ngay khi về, xong thì trả số file.
 */
export interface ChunkSource {
  start: number;
  stop: number;
  size: number;
  stream: (index: number, first: number, count: number, onFile: (i: number, buf: ArrayBuffer) => void) => Promise<number>;
}
/** running: đang tải · done: đã tải xong (frame bị đẩy khỏi bộ nhớ sau đó thì tải lẻ) · failed: lỗi, tải lẻ (thử lại được) · bad: đánh số sai, không dùng lại. */
type ChunkState = 'running' | 'done' | 'failed' | 'bad';
/** Chờ tối đa (ms) tới frame đầu của chunk (máy chủ có thể mất vài phút dựng chunk lần đầu) và giữa hai frame liền nhau. */
const CHUNK_FIRST_MS = 300_000, CHUNK_IDLE_MS = 120_000;
/** Số lần thử một chunk (lỗi mạng / máy chủ) trước khi quay về tải từng frame. */
const CHUNK_ATTEMPTS = 2;
/** Số chunk tải cùng lúc: 1 cho tải nền, thêm 1 khi cửa sổ đang xem cần chunk khác. */
const CHUNK_PARALLEL = 1, CHUNK_PARALLEL_URGENT = 2;

export class CloudLoader {
  private cache = new Map<number, PointCloud>(); // LRU
  private pending = new Map<number, Promise<PointCloud>>();
  private queue: Task[] = [];
  private running = 0;
  private listeners = new Set<() => void>();

  private runningUrgent = 0;
  private throttleUntil = 0; // máy chủ vừa báo bận: tới lúc này chỉ chạy ít kết nối song song
  private pausedUntil = 0; // tải nền tạm dừng tới thời điểm này (nhường server cho giao diện CVAT đang nạp frame)
  private finished: number[] = []; // thời điểm (ms) hoàn thành của các frame gần đây, để đo tốc độ
  private everLoaded_ = new Set<number>(); // frame đã từng tải xong (kể cả đã bị đẩy khỏi bộ nhớ LRU)
  private failed_ = new Set<number>(); // frame tải lỗi sau mọi lần thử lại (không tính frame bị hủy khỏi kế hoạch)
  private chunks: ChunkSource | null = null;
  private chunkState = new Map<number, ChunkState>();
  private chunkTries = new Map<number, number>();
  private chunkTasks = new Map<number, Task>(); // frame → yêu cầu đang chờ chunk của nó
  private chunkGen = 0; // đổi nguồn chunk (job khác) thì kết quả của nguồn cũ bị bỏ
  private chunkUrgent = new Set<number>(); // chunk đang tải được khởi động cho cửa sổ đang xem
  private chunkAbort = new Map<number, (e: Error) => void>(); // chunk đang chạy → hàm kết thúc nó (dùng để huỷ)
  /** Báo content script huỷ request đang chạy (thay được trong kiểm thử). */
  onAbort: () => void = () => abortLoads();
  private chunkInfo = new Map<number, { t0: number; got: number; count: number }>(); // chunk đang chạy: bắt đầu lúc nào, đã nhận bao nhiêu file
  private reloadTotal = 0; // số frame của đợt tải lại hiện tại (để hiện tiến trình)
  private tracked = new Set<number>(); // frame lỗi được thử lại: chỉ để hiện tiến trình (việc tải do kế hoạch tải nền yêu cầu)
  private forced = new Set<number>(); // frame đang được "tải lại tất cả": giữ trong kế hoạch tới khi tải xong (hoặc lỗi)
  private invalid_ = new Set<number>(); // frame đã giao từ một chunk rồi bị bỏ (chunk không qua kiểm chứng): nơi đang hiện nó phải tải lại

  constructor(
    private cap: number, private maxTotal: number, private maxBackground: number, private maxIdle = maxBackground,
    private load: (n: number) => Promise<ArrayBuffer> = (n) => fetchBinary('frame', n),
    private parse: (b: ArrayBuffer) => PointCloud = (b) => parsePcd(b, false),
    private now: () => number = () => performance.now(),
  ) {}

  cachedCount() { return this.cache.size; }
  /** Frame n đã từng tải xong chưa (bộ nhớ chỉ giữ `cap` frame nên job dài hơn không bao giờ nằm trọn trong bộ nhớ). */
  everLoaded(n: number) { return this.everLoaded_.has(n); }
  /** Bỏ đánh dấu lỗi của mọi frame để tải lại (kế hoạch tải nền tự xếp chúng vào hàng). Trả về số frame được thử lại. */
  retryFailed(): number {
    const n = this.failed_.size;
    for (const f of this.failed_) if (!this.everLoaded_.has(f)) this.tracked.add(f);
    this.failed_.clear();
    this.reloadTotal = new Set([...this.forced, ...this.tracked]).size;
    for (const [k, st] of this.chunkState) if (st === 'failed') { this.chunkState.delete(k); this.chunkTries.delete(k); }
    if (n) { this.emit(); this.replan(); }
    return n;
  }
  /**
   * Tiến trình đợt tải lại (nút "Tải lại frame"): `total` frame của đợt, `left` frame chưa về (lỗi lại thì không tính là chưa về),
   * và các chunk đang chạy (`got` / `count` file đã nhận, `secs` giây từ lúc bắt đầu; got = 0 nghĩa là máy chủ còn đang dựng chunk).
   * Hết đợt thì total = 0.
   */
  reloadStatus(): { total: number; left: number; chunks: { k: number; got: number; count: number; secs: number }[] } {
    let left = 0;
    for (const n of new Set([...this.forced, ...this.tracked])) if (!this.everLoaded_.has(n) && !this.failed_.has(n)) left++;
    if (left === 0) { this.reloadTotal = 0; this.forced.clear(); this.tracked.clear(); return { total: 0, left: 0, chunks: [] }; }
    const chunks = [...this.chunkInfo].map(([k, c]) => ({ k, got: c.got, count: c.count, secs: Math.round((this.now() - c.t0) / 1000) }));
    return { total: this.reloadTotal, left, chunks };
  }
  /**
   * Ngắt MỌI request đang chạy / đang treo (chunk và từng frame) để giải phóng kết nối với máy chủ rồi tải lại từ đầu.
   * Chunk bị ngắt: bỏ các frame đã nhận từ chunk đó (chưa kiểm chứng trọn vẹn), reset số lần thử, chạy lại chunk. Frame lẻ bị ngắt: tự thử lại.
   */
  abortInFlight(): void {
    this.onAbort();
    for (const [k, abort] of [...this.chunkAbort]) { this.chunkTries.set(k, 0); abort(new Error('đã huỷ (người dùng bấm tải lại)')); }
  }
  /**
   * Tải lại TẤT CẢ frame `first … last`: bỏ khỏi bộ nhớ, xoá dấu "đã tải / lỗi" rồi xếp vào hàng tải nền (theo chunk nếu bật).
   * Chunk đang chạy giữ nguyên (frame về sau sẽ ghi đè). Trả về số frame được tải lại.
   */
  reloadAll(first: number, last: number): number {
    for (const n of [...this.cache.keys()]) if (n >= first && n <= last) this.cache.delete(n);
    for (let n = first; n <= last; n++) {
      this.everLoaded_.delete(n); this.failed_.delete(n); this.invalid_.delete(n);
      this.forced.add(n);
    }
    for (const [k, st] of [...this.chunkState]) if (st !== 'running') { this.chunkState.delete(k); this.chunkTries.delete(k); }
    this.reloadTotal = new Set([...this.forced, ...this.tracked]).size;
    this.emit();
    this.replan();
    return last - first + 1;
  }
  /** Frame n từng được giao từ một chunk sau đó bị bỏ (đánh số không qua kiểm chứng): dữ liệu đang hiện của nó không còn tin được. */
  invalidated(n: number) { return this.invalid_.has(n); }
  /** Frame n đã tải lỗi sau mọi lần thử lại (để tiến độ "tải xong" không kẹt mãi vì một frame hỏng). */
  failed(n: number) { return this.failed_.has(n) && !this.everLoaded_.has(n); }
  /**
   * Tạm dừng TẢI NỀN `ms` mili giây (yêu cầu khẩn của cửa sổ đang xem vẫn chạy). Dùng khi tool bảo CVAT chuyển frame / zoom:
   * server sinh mỗi frame ~3 giây, nếu tải nền chiếm hết kết nối thì CVAT phải đợi rất lâu mới nạp xong frame.
   */
  pauseBackground(ms: number) {
    this.pausedUntil = Math.max(this.pausedUntil, this.now() + ms);
    setTimeout(() => this.pump(), ms + 50);
  }
  /** Frame đã có trong bộ nhớ (dùng đếm "đã tải" của cửa sổ, không phụ thuộc cột nào vừa được dựng). */
  has(n: number) { return this.cache.has(n); }
  /** Lấy point cloud nếu ĐÃ có trong bộ nhớ (không kích hoạt tải, không đổi thứ tự LRU). */
  peek(n: number): PointCloud | undefined { return this.cache.get(n); }
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

  /**
   * Bật tải theo chunk cho job (null: chỉ tải từng frame). Frame thuộc chunk chưa tải sẽ chờ cả chunk về thay vì gửi request riêng;
   * chunk lỗi thì các frame của nó quay về tải từng frame.
   */
  setChunks(src: ChunkSource | null) {
    this.chunks = src;
    this.chunkState.clear();
    this.chunkTries.clear();
    this.chunkUrgent.clear();
    this.chunkGen++;
    this.requeueChunkTasks(() => true);
    this.pump();
  }
  private cached = new Set<number>(); // frame đã có trong bộ nhớ đệm HTTP của trình duyệt: tải từng frame (tức thì), không chờ chunk
  /** Đặt tập frame đã có trong bộ nhớ đệm HTTP; các yêu cầu đang chờ chunk của chúng chuyển sang tải từng frame. */
  setCached(frames: Set<number>) {
    this.cached = frames;
    this.requeueChunkTasks((n) => frames.has(n));
    this.pump();
  }
  /** Chunk chứa frame n (−1: không tải theo chunk). */
  private chunkOf(n: number): number {
    const c = this.chunks;
    return c && n >= c.start && n <= c.stop ? Math.floor((n - c.start) / c.size) : -1;
  }
  /** Frame n sẽ về cùng chunk của nó (chunk chưa tải hoặc đang tải). */
  private viaChunk(n: number): boolean {
    if (this.cached.has(n)) return false;
    const k = this.chunkOf(n);
    if (k < 0) return false;
    const st = this.chunkState.get(k);
    return st === undefined || st === 'running';
  }
  /** Chuyển các yêu cầu đang chờ chunk (thoả `pick`) sang hàng đợi tải từng frame. */
  private requeueChunkTasks(pick: (n: number) => boolean) {
    for (const [n, t] of this.chunkTasks) if (pick(n)) { this.chunkTasks.delete(n); this.queue.push(t); }
  }

  get(n: number, prio = 0): Promise<PointCloud> {
    const hit = this.cache.get(n);
    if (hit) { this.cache.delete(n); this.cache.set(n, hit); return Promise.resolve(hit); }
    const queued = this.queue.find((t) => t.n === n) ?? this.chunkTasks.get(n);
    if (queued) queued.prio = Math.min(queued.prio, prio);
    const existing = this.pending.get(n);
    if (existing) { this.pump(); return existing; }
    const p = new Promise<PointCloud>((ok, fail) => {
      const t = { n, prio, ok, fail };
      if (this.viaChunk(n)) this.chunkTasks.set(n, t); else this.queue.push(t);
    });
    this.pending.set(n, p);
    p.catch(() => {});
    this.pump();
    return p;
  }

  /**
   * Đặt kế hoạch tải của cửa sổ đang xem: frame → độ ưu tiên. Sống cùng kế hoạch tải nền (`background`): yêu cầu đang xếp hàng mà
   * không còn trong kế hoạch nào bị hủy; yêu cầu đang chạy không bị ngắt.
   */
  plan(wanted: Map<number, number>) {
    this.windowPlan = wanted;
    this.replan();
  }
  /** Kế hoạch tải nền của cả job (ưu tiên thấp hơn cửa sổ); frame có trong cả hai lấy ưu tiên cao hơn. */
  background(wanted: Map<number, number>) {
    this.bgPlan = wanted;
    this.replan();
  }
  /**
   * Frame nào KHÔNG được đẩy khỏi bộ nhớ (vd frame đã tải nhưng chưa tính xong mặt đường / ít điểm). Bộ nhớ có thể vượt `cap`
   * tạm thời đúng bằng số frame đang được giữ.
   */
  setKeep(keep: (n: number) => boolean) { this.keep = keep; }
  private windowPlan = new Map<number, number>();
  private bgPlan = new Map<number, number>();
  private keep: (n: number) => boolean = () => false;
  private evict() {
    if (this.cache.size <= this.cap) return;
    for (const n of [...this.cache.keys()]) { // cũ nhất trước (LRU)
      if (this.cache.size <= this.cap) break;
      if (!this.keep(n)) this.cache.delete(n);
    }
  }

  private replan() {
    const wanted = new Map(this.bgPlan);
    for (const n of [...this.forced]) {
      if (this.everLoaded_.has(n) || this.failed_.has(n)) this.forced.delete(n);
      else wanted.set(n, Math.min(200 + n, wanted.get(n) ?? Infinity));
    }
    for (const [n, p] of this.windowPlan) wanted.set(n, Math.min(p, wanted.get(n) ?? Infinity));
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
    for (const [n, t] of this.chunkTasks) {
      const prio = wanted.get(n);
      if (prio === undefined) { this.chunkTasks.delete(n); this.pending.delete(n); t.fail(new Cancelled()); } // chunk vẫn tải tiếp
      else t.prio = prio;
    }
    for (const [n, prio] of wanted) {
      if (!this.cache.has(n) && !this.pending.has(n)) void this.get(n, prio).catch(() => {});
    }
    this.pump();
  }

  /** Một request treo (máy chủ không trả lời) không được giữ kết nối mãi: quá LOAD_TIMEOUT_MS thì coi là lỗi để thử lại. */
  private timed<T>(p: Promise<T>, n: number): Promise<T> {
    return new Promise<T>((ok, fail) => {
      const timer = setTimeout(() => fail(new Error(`frame ${n}: quá ${LOAD_TIMEOUT_MS / 1000} giây không có phản hồi`)), LOAD_TIMEOUT_MS);
      p.then((v) => { clearTimeout(timer); ok(v); }, (e) => { clearTimeout(timer); fail(e); });
    });
  }

  /** Khởi động chunk cho các frame đang chờ: ưu tiên chunk có frame của cửa sổ đang xem. */
  private pumpChunks() {
    if (!this.chunks) return;
    const need = new Map<number, number>(); // chunk → ưu tiên cao nhất của các frame đang chờ nó
    for (const t of this.chunkTasks.values()) {
      const k = this.chunkOf(t.n);
      if (k >= 0 && this.chunkState.get(k) === undefined) need.set(k, Math.min(t.prio, need.get(k) ?? Infinity));
    }
    let running = 0, background = 0;
    for (const [k, st] of this.chunkState) if (st === 'running') { running++; if (!this.chunkUrgent.has(k)) background++; }
    for (const [k, prio] of [...need].sort((a, b) => a[1] - b[1] || a[0] - b[0])) {
      const urgent = prio === 0;
      if (running >= CHUNK_PARALLEL_URGENT || (!urgent && background >= CHUNK_PARALLEL)) continue;
      if (!urgent && this.now() < this.pausedUntil) continue;
      this.startChunk(k, urgent);
      running++;
      if (!urgent) background++;
    }
  }

  private startChunk(k: number, urgent: boolean) {
    const c = this.chunks!, gen = this.chunkGen;
    if (urgent) this.chunkUrgent.add(k); else this.chunkUrgent.delete(k);
    const first = c.start + k * c.size, count = Math.min(c.size, c.stop - first + 1);
    this.chunkState.set(k, 'running');
    this.chunkTries.set(k, (this.chunkTries.get(k) ?? 0) + 1);
    this.chunkAbort.set(k, (e) => finish(e));
    this.chunkInfo.set(k, { t0: this.now(), got: 0, count });
    const got: number[] = [];
    let over = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const finish = (err: Error | null) => {
      if (over) return;
      over = true;
      clearTimeout(timer);
      this.chunkAbort.delete(k);
      this.chunkInfo.delete(k);
      if (gen !== this.chunkGen) return; // đã sang job khác
      this.chunkUrgent.delete(k);
      if (err) {
        // Không tin frame của chunk chưa kiểm chứng trọn vẹn: bỏ hết, tải lại (chunk lần nữa, hoặc từng frame); nơi đang hiện chúng tự tải lại.
        for (const n of got) { this.cache.delete(n); this.everLoaded_.delete(n); this.invalid_.add(n); }
        const mapping = /trùng frame|dự kiến/.test(err.message);
        const again = !mapping && (this.chunkTries.get(k) ?? 0) < CHUNK_ATTEMPTS;
        console.warn('[CVLA] tải chunk', k, 'lỗi:', err.message, again ? '→ thử lại chunk' : '→ chuyển sang tải từng frame');
        if (again) this.chunkState.delete(k);
        else { this.chunkState.set(k, mapping ? 'bad' : 'failed'); this.requeueChunkTasks((n) => this.chunkOf(n) === k); }
      } else {
        this.chunkState.set(k, 'done');
        this.requeueChunkTasks((n) => this.chunkOf(n) === k); // frame đã về rồi bị đẩy khỏi bộ nhớ trong lúc chờ → tải lẻ
      }
      this.emit();
      this.pump();
    };
    const arm = (ms: number) => { clearTimeout(timer); timer = setTimeout(() => finish(new Error(`chunk ${k}: quá ${ms / 1000} giây không có dữ liệu`)), ms); };
    arm(CHUNK_FIRST_MS);
    c.stream(k, first, count, (i, buf) => {
      if (over || gen !== this.chunkGen) return;
      if (i >= count) { finish(new Error(`chunk ${k} có nhiều hơn ${count} file như dự kiến`)); return; }
      arm(CHUNK_IDLE_MS);
      let pc: PointCloud;
      try { pc = this.parse(buf); } catch (e) { finish(e instanceof Error ? e : new Error(String(e))); return; }
      const n = first + i;
      this.cache.delete(n);
      this.cache.set(n, pc);
      got.push(n);
      const info = this.chunkInfo.get(k);
      if (info) info.got++;
      this.everLoaded_.add(n);
      this.failed_.delete(n);
      this.invalid_.delete(n);
      this.finished.push(this.now());
      if (this.finished.length > 12) this.finished.shift();
      const t = this.chunkTasks.get(n);
      if (t) { this.chunkTasks.delete(n); this.pending.delete(n); t.ok(pc); }
      this.evict();
      this.emit();
    }).then(
      (files) => finish(files === count ? null : new Error(`chunk ${k} có ${files} file, dự kiến ${count}`)),
      (e) => finish(e instanceof Error ? e : new Error(String(e))),
    );
  }

  private held = false;
  /** Tạm không gửi request nào (đang kiểm tra bộ nhớ đệm để chọn cách tải); `hold(false)` chạy lại hàng đợi. */
  hold(on: boolean) { this.held = on; if (!on) this.pump(); }
  private pump() {
    if (this.held) return;
    this.pumpChunks();
    while (this.queue.length) {
      this.queue.sort((a, b) => a.prio - b.prio || a.n - b.n);
      const t = this.queue[0]!;
      if (t.prio !== 0 && this.now() < this.pausedUntil) break; // hàng đợi đã sắp theo ưu tiên: phía sau toàn tải nền
      const urgentActive = this.runningUrgent > 0 || this.queue.some((q) => q.prio === 0);
      let limit = t.prio === 0 ? this.maxTotal : urgentActive ? this.maxBackground : this.maxIdle;
      if (this.now() < this.throttleUntil) limit = Math.min(limit, BUSY_PARALLEL);
      if (this.running >= limit) break;
      this.queue.shift();
      this.running++;
      const urgent = t.prio === 0;
      let retry = false;
      if (urgent) this.runningUrgent++;
      this.timed(this.load(t.n), t.n)
        .then((buf) => this.parse(buf))
        .then((pc) => {
          this.finished.push(this.now());
          if (this.finished.length > 12) this.finished.shift();
          this.cache.set(t.n, pc);
          this.everLoaded_.add(t.n);
          this.invalid_.delete(t.n);
          this.evict();
          t.ok(pc);
          this.emit();
        })
        .catch((e) => {
          // Lỗi mạng / máy chủ tạm thời (quá tải khi nhiều kết nối song song…): thử lại tối đa 3 lần với thời gian chờ tăng dần, rồi mới báo lỗi.
          // Máy chủ báo bận (503 / 429, vd chunk của job mới chưa dựng xong): chờ lâu hơn, thử nhiều lần hơn và nhường máy chủ (dừng tải nền) trong lúc chờ.
          const tries = (t.tries ?? 0) + 1;
          const busy = /\b(503|429)\b/.test(String(e));
          const max = busy ? BUSY_DELAYS.length + 1 : 4;
          if (tries === 1 || tries >= max) console.warn('[CVLA] tải frame', t.n, 'lỗi (lần', tries, '/', max, '):', String(e)); // không ghi từng lần thử: console không bị tràn
          if (tries < max) {
            retry = true; t.tries = tries;
            const delay = busy ? BUSY_DELAYS[tries - 1]! : 700 * tries;
            if (busy) { this.pauseBackground(delay); this.throttleUntil = this.now() + BUSY_THROTTLE_MS; }
            setTimeout(() => { this.queue.push(t); this.pump(); }, delay);
          } else { this.failed_.add(t.n); t.fail(e instanceof Error ? e : new Error(String(e))); this.emit(); }
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

// Tải từng frame (chỉ khi chunk không dùng được): đo trên cvat-b 2026-10-29, máy chủ làm gần như tuần tự (1 kết nối 5,0 s/frame, 2 kết nối 4,0 s/frame,
// 3 kết nối thì mỗi request chờ 15–25 s; 6 kết nối làm 503) nên tối đa 2 kết nối.
export const pointClouds = new CloudLoader(64, 2, 1, 2);

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

/** Ảnh camera của frame: tên file trong zip → Blob, xếp theo tên (số trong tên so theo giá trị). Chỉ tải khi người dùng chọn một frame. */
export const cameraImages = new Lru<Map<string, Blob>>(2, async (n) => {
  const files = unzipSync(new Uint8Array(await fetchBinary('context', n)));
  const names = Object.keys(files)
    .filter((name) => /\.(?:jpe?g|png|webp)$/i.test(name))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out = new Map<string, Blob>();
  for (const name of names) {
    const type = /\.png$/i.test(name) ? 'image/png' : /\.webp$/i.test(name) ? 'image/webp' : 'image/jpeg';
    out.set(name, new Blob([files[name] as BlobPart], { type }));
  }
  return out;
});
