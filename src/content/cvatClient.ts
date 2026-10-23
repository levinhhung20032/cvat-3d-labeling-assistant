import type { WriteAction } from '../shared/plan';
import type { UploadPayload } from '../shared/plan';
import type { CvatAnnotations, CvatJob, CvatLabel } from '../shared/types';

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
}

const WRITE_PATH = /^\/api\/jobs\/\d+\/annotations$/;

/**
 * Điểm duy nhất gọi API CVAT. Lớp ghi chỉ có `create` và `update` (PATCH);
 * không tồn tại đường nào gửi `action=delete` hoặc PUT.
 */
export class CvatClient {
  private readonly origin: string;
  private readonly dryRun: boolean;
  private readonly fetchImpl: typeof fetch;
  private readonly getCsrf: () => string | null;
  private readonly log: (e: WriteLogEntry) => void;

  constructor(opts: ClientOptions) {
    this.origin = opts.origin;
    this.dryRun = opts.dryRun ?? true;
    this.fetchImpl = opts.fetchImpl ?? ((...a) => fetch(...a));
    this.getCsrf = opts.getCsrf ?? (() => null);
    this.log = opts.log ?? (() => {});
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

  private async getBinary(jobId: number, query: string): Promise<ArrayBuffer> {
    const url = new URL(`/api/jobs/${jobId}/data?${query}`, this.origin);
    const res = await this.fetchImpl(url.toString(), { method: 'GET', credentials: 'include' });
    if (!res.ok) throw new Error(`GET ${url.pathname} → ${res.status}`);
    return res.arrayBuffer();
  }

  /** Point cloud của frame: PCD nhị phân (x y z rgb), ~5 MB. */
  getFrame(jobId: number, n: number): Promise<ArrayBuffer> {
    return this.getBinary(jobId, `type=frame&number=${n}&quality=original`);
  }

  /** Ảnh camera của frame: file zip chứa image_0.jpg … image_7.jpg, ~5 MB. */
  getContextImages(jobId: number, n: number): Promise<ArrayBuffer> {
    return this.getBinary(jobId, `type=context_image&quality=original&number=${n}`);
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
