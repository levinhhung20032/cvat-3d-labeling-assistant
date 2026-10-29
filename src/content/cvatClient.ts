import type { WriteAction } from '../shared/plan';
import type { UploadPayload } from '../shared/plan';
import type { CvatAnnotations, CvatJob, CvatLabel, CvatTrack } from '../shared/types';
import { entryBuffer, ZipStreamReader, type ZipEntry } from '../shared/zipStream';

export interface WriteLogEntry {
  time: string;
  action: WriteAction;
  jobId: number;
  dryRun: boolean;
  payload: UploadPayload;
}

export interface ClientOptions {
  origin: string;
  /** Mặc định true: chỉ dựng payload, không gửi. */
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  /** Gọi đúng lúc gửi; kết quả không được lưu lại. */
  getCsrf?: () => string | null;
  log?: (e: WriteLogEntry) => void;
  /** Chờ giữa các lần thử lại (thay được trong kiểm thử). */
  sleep?: (ms: number) => Promise<void>;
}

/** Thử lại khi tải chunk mà máy chủ báo bận / đang dựng chunk (lần đầu mở job mới, cvat-b trả 503 rồi mới trả 200). */
export const CHUNK_RETRY_DELAYS = [5000, 10000, 20000, 30000];
const BUSY_STATUS = [429, 502, 503, 504];

export const MAX_DELETE = 20;
const WRITE_PATH = /^\/api\/jobs\/\d+\/annotations$/;

/**
 * Điểm duy nhất gọi API CVAT. Ghi chỉ có `create` và `update` (PATCH); `action=delete` chỉ qua `deleteOwn` (track do tool tạo, theo sổ ID);
 * không tồn tại đường nào gửi PUT.
 */
export class CvatClient {
  private readonly origin: string;
  private readonly dryRun: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly getCsrf: () => string | null;
  private readonly log: (e: WriteLogEntry) => void;
  private readonly sleep: (ms: number) => Promise<void>;
  private loadCtl = new AbortController(); // huỷ mọi request tải frame / chunk đang chạy (nút "Tải lại")

  constructor(opts: ClientOptions) {
    this.origin = opts.origin;
    this.dryRun = opts.dryRun ?? true;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.getCsrf = opts.getCsrf ?? (() => null);
    this.log = opts.log ?? (() => {});
    this.sleep = opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
  }

  private async get<T>(path: string, query: Record<string, string | number> = {}): Promise<T> {
    const url = new URL(path, this.origin);
    for (const [k, v] of Object.entries(query)) url.searchParams.set(k, String(v));
    const res = await this.fetchImpl(url.toString(), {
      method: 'GET',
      credentials: 'include',
      // Không đặt Accept: CVAT 2.77.1 trả 406 với `application/json`, nhưng 200 với mặc định `*/*`.
    });
    if (!res.ok) throw new Error(`GET ${url.pathname} → ${res.status}`);
    return (await res.json()) as T;
  }

  getJob(jobId: number): Promise<CvatJob> {
    return this.get(`/api/jobs/${jobId}`);
  }

  async getLabels(jobId: number): Promise<CvatLabel[]> {
    const page = await this.get<{ results: CvatLabel[] }>('/api/labels', {
      job_id: jobId,
      page_size: 500,
    });
    return page.results;
  }

  getAnnotations(jobId: number): Promise<CvatAnnotations> {
    return this.get(`/api/jobs/${jobId}/annotations`);
  }

  /** Huỷ mọi request tải point cloud (frame / chunk) đang chạy hoặc đang chờ thử lại; request tải sau đó chạy bình thường. */
  abortLoads(): void {
    this.loadCtl.abort();
    this.loadCtl = new AbortController();
  }

  private async getBinary(jobId: number, query: string, cache?: RequestCache, signal?: AbortSignal): Promise<ArrayBuffer> {
    const url = new URL(`/api/jobs/${jobId}/data?${query}`, this.origin);
    const res = await this.fetchImpl(url.toString(), { method: 'GET', credentials: 'include', ...(cache ? { cache } : {}), ...(signal ? { signal } : {}) });
    if (!res.ok) throw new Error(`GET ${url.pathname} → ${res.status}`);
    return res.arrayBuffer();
  }

  /** Point cloud của frame: PCD nhị phân (x y z rgb), ~5 MB. Dùng bộ nhớ đệm HTTP của trình duyệt (như chính giao diện CVAT): nạp lại tab thì frame đã tải không phải sinh lại ở server. */
  getFrame(jobId: number, n: number): Promise<ArrayBuffer> {
    return this.getBinary(jobId, `type=frame&number=${n}&quality=original`, 'force-cache', this.loadCtl.signal);
  }

  /** Số frame mỗi chunk của job (`data_chunk_size` trong job, không có thì đọc meta); null nếu không biết. */
  async getChunkSize(job: CvatJob): Promise<number | null> {
    const own = job['data_chunk_size'];
    if (typeof own === 'number' && own > 0) return own;
    try {
      const meta = await this.get<{ chunk_size?: number }>(`/api/jobs/${job.id}/data/meta`);
      return typeof meta.chunk_size === 'number' && meta.chunk_size > 0 ? meta.chunk_size : null;
    } catch { return null; }
  }

  /**
   * Đọc chunk thứ `index` của job (đánh số theo job) THEO LUỒNG, giống cách giao diện CVAT tải point cloud: một request cho cả
   * chunk thay vì một request mỗi frame (mỗi request `type=frame` bắt máy chủ đọc lại cả chunk). Gọi `onFile(i, buf)` cho từng file
   * trong zip theo thứ tự; trả về số file. Máy chủ báo bận (đang dựng chunk) thì chờ rồi thử lại.
   */
  async streamChunk(jobId: number, index: number, onFile: (i: number, buf: ArrayBuffer) => Promise<void> | void): Promise<number> {
    const url = new URL(`/api/jobs/${jobId}/data?type=chunk&quality=original&index=${index}`, this.origin);
    const signal = this.loadCtl.signal;
    let res: Response;
    for (let attempt = 0; ; attempt++) {
      res = await this.fetchImpl(url.toString(), { method: 'GET', credentials: 'include', signal });
      if (res.ok) break;
      if (!BUSY_STATUS.includes(res.status) || attempt >= CHUNK_RETRY_DELAYS.length) throw new Error(`GET ${url.pathname} (chunk ${index}) → ${res.status}`);
      await this.sleep(CHUNK_RETRY_DELAYS[attempt]!);
      if (signal.aborted) throw new Error('đã huỷ (người dùng bấm tải lại)');
    }
    if (!res.body) throw new Error('trình duyệt không đọc được luồng dữ liệu');
    const reader = res.body.getReader();
    const ready: ZipEntry[] = [];
    const zip = new ZipStreamReader((e) => ready.push(e));
    let i = 0;
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        zip.push(value);
        while (ready.length) await onFile(i++, entryBuffer(ready.shift()!));
        if (zip.finished) break;
      }
      zip.end();
    } finally {
      reader.cancel().catch(() => {});
    }
    return i;
  }

  /**
   * Như `streamChunk` nhưng KIỂM CHỨNG cách đánh số trước khi tin chunk: file đầu phải trùng từng byte với frame `first` tải riêng
   * (`type=frame`), và số file phải đúng `count`. Sai một trong hai → lỗi, bên gọi bỏ chunk và quay về tải từng frame (point cloud
   * gán nhầm frame sẽ làm sai mọi cảnh báo và chỉnh sửa trên dữ liệu thật).
   */
  async streamChunkChecked(jobId: number, index: number, first: number, count: number, onFile: (i: number, buf: ArrayBuffer) => void): Promise<number> {
    const ref = this.frameForCheck(jobId, first);
    ref.catch(() => {});
    const n = await this.streamChunk(jobId, index, async (i, buf) => {
      if (i >= count) throw new Error(`chunk ${index} có nhiều hơn ${count} file như dự kiến`);
      if (i === 0) {
        const want = await ref;
        if (!sameBytes(want, buf)) throw new Error(`file đầu của chunk ${index} không trùng frame ${first}: thứ tự frame trong chunk khác dự kiến`);
      }
      onFile(i, buf);
    });
    if (n !== count) throw new Error(`chunk ${index} có ${n} file, dự kiến ${count}`);
    return n;
  }

  /** Frame dùng để đối chiếu chunk (thử lại vài lần nếu máy chủ bận). */
  private async frameForCheck(jobId: number, n: number): Promise<ArrayBuffer> {
    for (let attempt = 0; ; attempt++) {
      try { return await this.getFrame(jobId, n); } catch (e) {
        if (this.loadCtl.signal.aborted || (e instanceof Error && e.name === 'AbortError')) throw e;
        if (attempt >= 2) throw new Error(`không tải được frame ${n} để đối chiếu chunk: ${String(e)}`);
        await this.sleep(3000 * (attempt + 1));
      }
    }
  }

  /** Ảnh camera của frame: file zip chứa image_0.jpg … image_7.jpg, ~5 MB. */
  getContextImages(jobId: number, n: number): Promise<ArrayBuffer> {
    return this.getBinary(jobId, `type=context_image&quality=original&number=${n}`);
  }

  /**
   * Xóa track do CHÍNH TOOL tạo ra (chủ dự án duyệt 2026-10-26). Đây là đường DUY NHẤT gửi `action=delete`: chỉ nhận các track có id
   * nằm trong `allowedIds` (sổ các ID tool đã tạo), tối đa `MAX_DELETE` track mỗi lần; object có sẵn trên server không bao giờ qua được.
   * LƯU Ý: hàm này KHÔNG vi phạm luật 1 (không xóa / không đổi ID), đây là ngoại lệ duy nhất đã được duyệt. Đừng gỡ nó, đừng mở rộng nó,
   * và đừng coi câu "không có delete" ở các tài liệu cũ là luật còn hiệu lực.
   */
  async deleteOwn(jobId: number, tracks: CvatTrack[], allowedIds: ReadonlySet<number>): Promise<{ sent: boolean }> {
    if (!tracks.length || tracks.length > MAX_DELETE) throw new Error(`Chỉ được xóa 1–${MAX_DELETE} object mỗi lần`);
    for (const t of tracks) {
      if (typeof t.id !== 'number' || !allowedIds.has(t.id)) throw new Error(`Từ chối xóa track ${String(t.id)}: không phải object do tool tạo`);
    }
    const payload: UploadPayload = { version: 0, tags: [], shapes: [], tracks };
    this.log({ time: new Date().toISOString(), action: 'delete', jobId, dryRun: this.dryRun, payload });
    if (this.dryRun) return { sent: false };
    const url = new URL(`/api/jobs/${jobId}/annotations`, this.origin);
    url.searchParams.set('action', 'delete');
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrf = this.getCsrf();
    if (csrf) headers['X-CSRFToken'] = csrf;
    const res = await this.fetchImpl(url.toString(), { method: 'PATCH', credentials: 'include', headers, body: JSON.stringify(payload) });
    if (!res.ok) throw new Error(`PATCH ${url.pathname} (delete) → ${res.status}`);
    return { sent: true };
  }

  /** Chỉ `create` / `update`. Dry-run mặc định: trả payload, không gửi. */
  async write(
    jobId: number,
    action: WriteAction,
    payload: UploadPayload,
  ): Promise<{ sent: boolean; payload: UploadPayload }> {
    if (action !== 'create' && action !== 'update') {
      throw new Error(`Hành động không được phép: ${String(action)}`);
    }
    const path = `/api/jobs/${jobId}/annotations`;
    if (!WRITE_PATH.test(path)) throw new Error('Đường dẫn ghi không hợp lệ');
    this.log({ time: new Date().toISOString(), action, jobId, dryRun: this.dryRun, payload });
    if (this.dryRun) return { sent: false, payload };

    const url = new URL(path, this.origin);
    url.searchParams.set('action', action);
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    const csrf = this.getCsrf(); // đọc lúc gửi, không giữ lại
    if (csrf) headers['X-CSRFToken'] = csrf;
    const res = await this.fetchImpl(url.toString(), {
      method: 'PATCH',
      credentials: 'include',
      headers,
      body: JSON.stringify(payload),
    });
    if (!res.ok) throw new Error(`PATCH ${url.pathname} → ${res.status}`);
    return { sent: true, payload };
  }
}

function sameBytes(a: ArrayBuffer, b: ArrayBuffer): boolean {
  if (a.byteLength !== b.byteLength) return false;
  const x = new Uint8Array(a), y = new Uint8Array(b);
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return false;
  return true;
}
