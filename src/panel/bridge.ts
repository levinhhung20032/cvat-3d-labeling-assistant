import { CONTENT_SOURCE, PANEL_SOURCE, type ContentMessage, type PanelMessage } from '../shared/protocol';

/**
 * Cầu nối panel ↔ content script. Có hai cách chạy panel:
 * - 'iframe': panel là trang của extension nằm trong iframe; nói chuyện bằng postMessage (kiểm origin + mã phiên).
 * - 'inpage': panel được nhúng thẳng vào trang trong Shadow DOM (khi iframe bị trình duyệt / trang chặn); gọi hàm trực tiếp.
 */
export interface PanelHost {
  mode: 'iframe' | 'inpage';
  session: string;
  post(m: PanelMessage): void; // panel → content
  subscribe(cb: (m: ContentMessage) => void): () => void; // content → panel
  keyTarget: EventTarget; // nơi nghe phím của panel
  viewport(): { w: number; h: number };
  onViewport(cb: () => void): () => void;
}

/** Số liệu chẩn đoán hiện lên giao diện khi panel không nhận được dữ liệu. */
export const diag = { mode: 'iframe' as 'iframe' | 'inpage', rejected: 0, lastOrigin: '', expectedOrigin: '', lastReason: '' };

function iframeHost(): PanelHost {
  const params = new URLSearchParams(location.hash.slice(1));
  const session = params.get('session') ?? '';
  const parentOrigin = params.get('origin') ?? '';
  diag.expectedOrigin = parentOrigin;
  return {
    mode: 'iframe',
    session,
    post: (m) => window.parent.postMessage(m, parentOrigin),
    subscribe(cb) {
      const on = (ev: MessageEvent) => {
        const m = ev.data as ContentMessage | undefined;
        if (m?.source !== CONTENT_SOURCE) return;
        // Chỉ nhận tin từ origin của trang cha và đúng mã phiên. (Không so ev.source: Firefox bọc cửa sổ khác Chrome.)
        const reason = ev.origin !== parentOrigin ? 'origin' : m.session !== session ? 'session' : '';
        if (reason) {
          diag.rejected++;
          diag.lastOrigin = ev.origin;
          diag.lastReason = reason;
          if (diag.rejected <= 3) console.warn('[CVLA] panel bỏ qua tin nhắn', { reason, origin: ev.origin, expected: parentOrigin });
          return;
        }
        cb(m);
      };
      window.addEventListener('message', on);
      return () => window.removeEventListener('message', on);
    },
    keyTarget: window,
    viewport: () => ({ w: window.innerWidth, h: window.innerHeight }),
    onViewport(cb) {
      window.addEventListener('resize', cb);
      return () => window.removeEventListener('resize', cb);
    },
  };
}

let host: PanelHost = iframeHost();
export const setHost = (h: PanelHost) => { host = h; diag.mode = h.mode; };

type Body = PanelMessage extends infer M ? (M extends unknown ? Omit<M, 'source' | 'session'> : never) : never;

export const post = (m: Body) => host.post({ source: PANEL_SOURCE, session: host.session, ...m } as PanelMessage);
export const onContentMessage = (cb: (m: ContentMessage) => void) => host.subscribe(cb);
export const keyTarget = () => host.keyTarget;
export const viewport = () => host.viewport();
export const onViewport = (cb: () => void) => host.onViewport(cb);

// --- yêu cầu nhị phân (frame, ảnh camera) ---
let nextId = 1;
const waiting = new Map<number, { ok: (b: ArrayBuffer) => void; fail: (e: Error) => void }>();

export function resolveBinary(reqId: number, buf: ArrayBuffer | null, error?: string) {
  const w = waiting.get(reqId);
  if (!w) return;
  waiting.delete(reqId);
  if (buf) w.ok(buf);
  else w.fail(new Error(error ?? 'không có dữ liệu'));
}

export function fetchBinary(kind: 'frame' | 'context' | 'probe', n: number): Promise<ArrayBuffer> {
  const reqId = nextId++;
  return new Promise((ok, fail) => {
    waiting.set(reqId, { ok, fail });
    post({ type: 'binary', kind, n, reqId });
  });
}

/** Huỷ mọi request tải point cloud đang chạy ở content script (request treo giữ kết nối với máy chủ). */
export function abortLoads() { post({ type: 'abortLoads' }); }

// --- chunk point cloud (theo luồng: nhiều file cho một yêu cầu) ---
const chunkWaiting = new Map<number, { onFile: (i: number, buf: ArrayBuffer) => void; ok: (n: number) => void; fail: (e: Error) => void }>();

/** Tải chunk `index` (frame first … first + count − 1); `onFile` nhận từng frame ngay khi về. Xong thì trả số file. */
export function streamChunk(index: number, first: number, count: number, onFile: (i: number, buf: ArrayBuffer) => void): Promise<number> {
  const reqId = nextId++;
  return new Promise((ok, fail) => {
    chunkWaiting.set(reqId, { onFile, ok, fail });
    post({ type: 'chunk', index, first, count, reqId });
  });
}
export function resolveChunkFile(reqId: number, i: number, buf: ArrayBuffer) {
  chunkWaiting.get(reqId)?.onFile(i, buf);
}
export function resolveChunkEnd(reqId: number, count: number, error?: string) {
  const w = chunkWaiting.get(reqId);
  if (!w) return;
  chunkWaiting.delete(reqId);
  if (error || count < 0) w.fail(new Error(error ?? 'tải chunk lỗi'));
  else w.ok(count);
}

// --- yêu cầu/đáp (upload, hoàn nguyên) ---
const rpcWaiting = new Map<number, (v: unknown) => void>();
export function resolveRpc(reqId: number, v: unknown) {
  const w = rpcWaiting.get(reqId);
  if (!w) return;
  rpcWaiting.delete(reqId);
  w(v);
}
export function rpc<T>(build: (reqId: number) => Body): Promise<T> {
  const reqId = nextId++;
  return new Promise<T>((ok) => {
    rpcWaiting.set(reqId, (v) => ok(v as T));
    post(build(reqId));
  });
}
