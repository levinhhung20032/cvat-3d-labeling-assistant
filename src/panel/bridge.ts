import { PANEL_SOURCE, type PanelMessage } from '../shared/protocol';

const params = new URLSearchParams(location.hash.slice(1));
export const session = params.get('session') ?? '';
export const parentOrigin = params.get('origin') ?? '';

type Body = PanelMessage extends infer M ? (M extends unknown ? Omit<M, 'source' | 'session'> : never) : never;

export const post = (m: Body) =>
  window.parent.postMessage({ source: PANEL_SOURCE, session, ...m } as PanelMessage, parentOrigin);

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

export function fetchBinary(kind: 'frame' | 'context', n: number): Promise<ArrayBuffer> {
  const reqId = nextId++;
  return new Promise((ok, fail) => {
    waiting.set(reqId, { ok, fail });
    post({ type: 'binary', kind, n, reqId });
  });
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
