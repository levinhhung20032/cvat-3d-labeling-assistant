import type { Cuboid } from '../shared/cuboid';
import { DEFAULT_FIT } from '../shared/fit';
import { DEFAULT_GROUND } from '../shared/ground';
import { kv } from './storage';

/*
 * Kết quả tính "ít điểm" (kèm đo mặt đường riêng của từng box) cho cả job, lưu trong kho của extension theo máy chủ + job: tab CVAT
 * tải lại (tool tự tải lại sau upload) thì dùng lại các kết quả còn khớp box, không phải tính lại từ đầu. Chỉ lưu mã băm chữ ký box và
 * một cờ đúng / sai, không lưu toạ độ hay point cloud.
 */

/** Kết quả tính ít điểm của một box ở một frame, kèm chữ ký box lúc tính. */
export interface PassEntry { sig: string; sparse: boolean; n: number } // n: số điểm trong box (để lọc cảnh báo trôi box)
/** Mã băm FNV-1a 32 bit, dạng base36. */
const hash36 = (s: string) => { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193); } return (h >>> 0).toString(36); };
/** Chữ ký box: đổi vị trí / hướng / kích thước thì kết quả cũ không còn dùng. */
export const sigOf = (c: Cuboid) => hash36(`${c.x},${c.y},${c.z},${c.yaw},${c.sx},${c.sy},${c.sz}`);
/** Phiên bản kết quả lưu: đổi thuật toán / cấu hình (mặt đường, đếm điểm) thì kết quả cũ tự bỏ. */
export const PASS_VERSION = hash36(`pass-2|${JSON.stringify(DEFAULT_GROUND)}|${JSON.stringify(DEFAULT_FIT)}`);
export const PASS_KEEP_JOBS = 10; // chỉ giữ kết quả của ngần này job gần nhất (mỗi máy chủ)
export function loadPass(key: string): Map<number, Map<number, PassEntry>> {
  const out = new Map<number, Map<number, PassEntry>>();
  try {
    const o = JSON.parse(kv.get(key) ?? 'null') as { v: string; frames: Record<string, [number, string, 0 | 1, number][]> } | null;
    if (!o || o.v !== PASS_VERSION) return out;
    for (const [f, list] of Object.entries(o.frames)) out.set(Number(f), new Map(list.map(([num, sig, sp, n]) => [num, { sig, sparse: sp === 1, n }])));
  } catch { /* hỏng: tính lại */ }
  return out;
}
export function savePass(key: string, res: Map<number, Map<number, PassEntry>>) {
  const frames: Record<string, [number, string, 0 | 1, number][]> = {};
  for (const [f, r] of res) frames[f] = [...r].map(([num, e]) => [num, e.sig, e.sparse ? 1 : 0, e.n]);
  try {
    kv.set(key, JSON.stringify({ v: PASS_VERSION, frames }));
    const idx = (JSON.parse(kv.get('cvla-passidx') ?? '[]') as string[]).filter((k) => k !== key);
    idx.unshift(key);
    for (const old of idx.slice(PASS_KEEP_JOBS)) kv.remove(old);
    kv.set('cvla-passidx', JSON.stringify(idx.slice(0, PASS_KEEP_JOBS)));
  } catch { /* bỏ qua: lần sau tính lại */ }
}
