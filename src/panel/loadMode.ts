import { fetchBinary } from './bridge';
import { kv } from './storage';
import { pointClouds, type ChunkSource } from './stores';

/**
 * Cách tải point cloud (đo trên cvat-a job 9999, 22 frame, 2026-10-29):
 * - từng frame (`type=frame`): tải mới ~2 s/frame, nhưng được trình duyệt giữ trong bộ nhớ đệm HTTP: mở lại / refresh sau upload chỉ ~22 ms/frame;
 * - chunk (`type=chunk`): 158 MB trong 14–17 s (nhanh hơn ~3× khi tải mới), nhưng KHÔNG vào bộ nhớ đệm: mỗi lần refresh tải lại toàn bộ.
 * Tự động: kiểm tra frame nào đã có trong bộ nhớ đệm (không tốn mạng); đã có từ một nửa trở lên thì tải từng frame (gần như tức thì),
 * còn không thì tải chunk (nhanh nhất lúc nguội). Frame đã có trong bộ nhớ đệm luôn tải từng frame. Người dùng có thể ép "chunk" / "frame".
 * Chọn "frame" ở lần đầu thì chậm hơn một lần, nhưng các lần refresh sau (sau mỗi upload) gần như không phải chờ.
 */
export type LoadMode = 'auto' | 'chunk' | 'frame';
const KEY = 'cvla-loadmode';
export const LOAD_MODES: { id: LoadMode; label: string; title: string }[] = [
  { id: 'auto', label: 'Tự động', title: 'Frame đã có trong bộ nhớ đệm trình duyệt thì tải ngay; còn lại tải theo chunk (nhanh nhất lúc tải mới). Từ một nửa số frame đã có trong bộ nhớ đệm thì tải từng frame.' },
  { id: 'chunk', label: 'Chunk', title: 'Tải cả chunk một lần: nhanh nhất lúc tải mới nhưng không vào bộ nhớ đệm, mỗi lần refresh tải lại toàn bộ.' },
  { id: 'frame', label: 'Từng frame', title: 'Tải từng frame: chậm hơn lúc tải mới (một lần), nhưng được trình duyệt nhớ: refresh sau upload gần như tức thì.' },
];
export const loadMode = (): LoadMode => { const v = kv.get(KEY); return v === 'chunk' || v === 'frame' ? v : 'auto'; };
export const setLoadMode = (m: LoadMode) => kv.set(KEY, m);

const PROBE_MAX_MS = 5000;
/**
 * Frame nào đã nằm trong bộ nhớ đệm HTTP (kiểm tra qua content script, không gửi request ra mạng).
 * Tối đa PROBE_MAX_MS: content script không trả lời thì dừng, frame chưa kiểm tra coi như chưa có (loader không bị giữ mãi).
 */
async function probe(first: number, last: number): Promise<Set<number>> {
  const hit = new Set<number>();
  const todo: number[] = [];
  for (let n = first; n <= last; n++) todo.push(n);
  const worker = async () => {
    for (let n = todo.shift(); n !== undefined; n = todo.shift()) {
      try { if (new Uint8Array(await fetchBinary('probe', n))[0] === 1) hit.add(n); } catch { /* không biết: coi như chưa có */ }
    }
  };
  let timer = 0;
  await Promise.race([
    Promise.all(Array.from({ length: 8 }, worker)),
    new Promise<void>((ok) => { timer = window.setTimeout(() => { todo.length = 0; ok(); }, PROBE_MAX_MS); }),
  ]);
  window.clearTimeout(timer);
  return new Set(hit); // bản sao: probe về muộn sau khi hết giờ không đổi tập đã giao cho loader
}

let gen = 0;
/** Gọi một lần mỗi khi nạp job: kiểm tra bộ nhớ đệm rồi chọn chunk / từng frame theo chế độ. Trong lúc kiểm tra loader tạm dừng (không gửi request nào). */
export function configureLoading(first: number, last: number, chunkSrc: ChunkSource | null): void {
  const mine = ++gen;
  const mode = loadMode();
  if (mode === 'frame' || !chunkSrc) {
    pointClouds.setCached(new Set());
    pointClouds.setChunks(null);
    pointClouds.hold(false); // lần kiểm tra trước (nếu đang chạy) bỏ dở nên không tự nhả
    return;
  }
  pointClouds.hold(true);
  void (async () => {
    let cached = new Set<number>();
    try { cached = await probe(first, last); } catch { /* bỏ: tải như chưa có gì trong bộ nhớ đệm */ }
    if (mine !== gen) return; // job khác đã được nạp trong lúc kiểm tra
    const total = last - first + 1;
    const useChunk = mode === 'chunk' || cached.size < total / 2;
    pointClouds.setCached(cached);
    pointClouds.setChunks(useChunk ? chunkSrc : null);
    pointClouds.hold(false);
  })();
}
