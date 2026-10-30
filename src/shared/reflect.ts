import type { LocalBox } from './edit';
import type { LocalPoints } from './fit';

/**
 * Reflection mode (ref): dựng một box ẢO đối xứng với box chính qua một mặt phẳng nằm ngang (mặt phản chiếu), lấy các điểm nằm trong
 * box ảo rồi lật ngược trở lại vào box chính để vẽ chồng lên. Dùng cho vật có ảnh phản chiếu dưới mặt đường (đường ướt, kính…): điểm
 * phản chiếu gộp với điểm thật làm hình vật nét hơn. Chỉ để XEM, không đổi dữ liệu nhãn.
 * Mọi toạ độ ở hệ của khung nhìn (u dọc box, v ngang, w lên; gốc ở tâm box tham chiếu của frame), như các view của Batch Review.
 */
export type RefMode = 'bottom' | 'road' | 'custom';
export interface RefState {
  on: boolean;
  mode: RefMode;
  dh: number; // mặt phản chiếu cao hơn đáy box bao nhiêu (m), dùng khi mode = 'custom'
  dismissed: boolean; // đã bỏ qua gợi ý bật ref cho object này
}
export const REF_OFF: RefState = { on: false, mode: 'bottom', dh: 0, dismissed: false };

export interface ReflectConfig { minBelow: number; clear: number }
/** Gợi ý bật ref khi dưới mặt đường, trong phạm vi chân box, có từ `minBelow` điểm (bỏ lớp `clear` m sát mặt đường). Chỉnh ở tab Threshold. */
export const DEFAULT_REFLECT: ReflectConfig = { minBelow: 15, clear: 0.15 };

export type PlaneSource = 'bottom' | 'road' | 'ego' | 'custom';
/**
 * Độ cao w của mặt phản chiếu. bottom: mặt dưới box; road: mặt đường đo được dưới object, không đo được thì mặt phẳng z = 0 của ego;
 * custom: đáy box + dh (đi theo box khi box dời).
 */
export function refPlane(box: LocalBox, s: Pick<RefState, 'mode' | 'dh'>, roadW: number | null, egoW: number | null): { w: number; src: PlaneSource } {
  const bottom = box.cw - box.sz / 2;
  if (s.mode === 'custom') return { w: bottom + s.dh, src: 'custom' };
  if (s.mode === 'road') {
    if (roadW !== null && Number.isFinite(roadW)) return { w: roadW, src: 'road' };
    if (egoW !== null && Number.isFinite(egoW)) return { w: egoW, src: 'ego' };
  }
  return { w: bottom, src: 'bottom' };
}

/** Box ảo: cùng kích thước, cùng hướng, đối xứng với box chính qua mặt w = h. */
export const mirrorBox = (box: LocalBox, h: number): LocalBox => ({ ...box, cw: 2 * h - box.cw });

/** Điểm (u, v) có nằm trong chân box (đã xoay dyaw quanh tâm) không. */
function inFootprint(box: LocalBox, u: number, v: number): boolean {
  const du = u - box.cu, dv = v - box.cv, cs = Math.cos(box.dyaw), sn = Math.sin(box.dyaw);
  return Math.abs(du * cs + dv * sn) <= box.sx / 2 && Math.abs(-du * sn + dv * cs) <= box.sy / 2;
}

/** Các điểm nằm trong box ảo, đã lật qua mặt w = h trở lại vùng box chính. */
export function mirroredPoints(p: LocalPoints, box: LocalBox, h: number): LocalPoints {
  const m = mirrorBox(box, h);
  const lo = m.cw - m.sz / 2, hi = m.cw + m.sz / 2;
  const idx: number[] = [];
  for (let i = 0; i < p.n; i++) {
    const w = p.w[i]!;
    if (w >= lo && w <= hi && inFootprint(m, p.u[i]!, p.v[i]!)) idx.push(i);
  }
  const u = new Float32Array(idx.length), v = new Float32Array(idx.length), w = new Float32Array(idx.length);
  idx.forEach((i, j) => { u[j] = p.u[i]!; v[j] = p.v[i]!; w[j] = 2 * h - p.w[i]!; });
  return { u, v, w, n: idx.length };
}

/**
 * Số điểm nằm DƯỚI mặt đường trong phạm vi chân box (sâu tới một chiều cao box), bỏ lớp `clear` sát mặt đường: nhiều thì có thể là ảnh
 * phản chiếu của vật → gợi ý bật ref. Mặt đường: đo được dưới object, không có thì z = 0 của ego, không có nữa thì đáy box.
 */
export function pointsBelow(p: LocalPoints, box: LocalBox, roadW: number | null, egoW: number | null, cfg: ReflectConfig = DEFAULT_REFLECT): number {
  const base = roadW ?? egoW ?? box.cw - box.sz / 2;
  const top = base - cfg.clear, bottom = base - box.sz;
  let n = 0;
  for (let i = 0; i < p.n; i++) {
    const w = p.w[i]!;
    if (w < top && w >= bottom && inFootprint(box, p.u[i]!, p.v[i]!)) n++;
  }
  return n;
}

const MODES: RefMode[] = ['bottom', 'road', 'custom'];
/** Đọc trạng thái ref đã lưu (hỏng / thiếu trường thì dùng mặc định từng trường). */
export function parseRefState(raw: unknown): RefState {
  const r = raw && typeof raw === 'object' ? raw as Partial<RefState> : {};
  return {
    on: r.on === true,
    mode: MODES.includes(r.mode as RefMode) ? r.mode as RefMode : 'bottom',
    dh: typeof r.dh === 'number' && Number.isFinite(r.dh) ? Math.max(-5, Math.min(5, r.dh)) : 0,
    dismissed: r.dismissed === true,
  };
}
