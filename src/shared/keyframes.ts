import { upsertKeyframe } from './edit';
import { referenceCuboid, sortedShapes, stateAt } from './interp';
import type { Cuboid } from './cuboid';
import type { CvatTrack } from './types';

export interface TrackChange {
  track: CvatTrack;
  frames: number[]; // frame bị đổi (để đánh dấu "đã sửa")
}

/**
 * Gỡ keyframe tại `frame` (frame trở về nội suy). Không bao giờ gỡ keyframe outside (luật 2) và không gỡ
 * keyframe đầu tiên của track (sẽ đổi điểm bắt đầu của track). Trả null nếu không được phép.
 */
export function removeKeyframe(track: CvatTrack, frame: number): TrackChange | null {
  const shapes = sortedShapes(track);
  const i = shapes.findIndex((s) => s.frame === frame);
  if (i <= 0 || shapes[i]!.outside) return null;
  return { track: { ...track, shapes: shapes.filter((_, j) => j !== i) }, frames: [frame] };
}

/** Bật/tắt keyframe: keyframe → gỡ; frame nội suy hoặc giữ nguyên → chốt giá trị hiện tại thành keyframe. */
export function toggleKeyframe(track: CvatTrack, frame: number): TrackChange | null {
  const st = stateAt(track, frame);
  if (st.status === 'key') return removeKeyframe(track, frame);
  if ((st.status === 'interp' || st.status === 'hold') && st.cuboid) {
    return { track: upsertKeyframe(track, frame, st.cuboid), frames: [frame] };
  }
  return null;
}

/**
 * "Mở khoá keyframe ở giữa": gỡ mọi keyframe nằm hẳn bên trong (a, b), giữ hai đầu mút.
 * Giữ nguyên keyframe outside và keyframe đầu tiên của track.
 */
export function removeInnerKeyframes(track: CvatTrack, a: number, b: number): TrackChange {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const shapes = sortedShapes(track);
  const removed: number[] = [];
  const kept = shapes.filter((s, i) => {
    const inner = s.frame > lo && s.frame < hi && !s.outside && i > 0;
    if (inner) removed.push(s.frame);
    return !inner;
  });
  return { track: removed.length ? { ...track, shapes: kept } : track, frames: removed };
}

/**
 * "Khoá hết thành keyframe" khi upload: ghi giá trị hiển thị hiện tại của mọi frame có box trong [a, b]
 * thành keyframe. Hình dạng đường đi không đổi, chỉ thêm keyframe.
 */
export function bakeKeyframes(track: CvatTrack, a: number, b: number): TrackChange {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  let out = track;
  const added: number[] = [];
  for (let f = lo; f <= hi; f++) {
    const st = stateAt(track, f); // đọc trạng thái từ track gốc, không bị ảnh hưởng bởi keyframe vừa thêm
    if ((st.status === 'interp' || st.status === 'hold') && st.cuboid) {
      out = upsertKeyframe(out, f, st.cuboid);
      added.push(f);
    }
  }
  return { track: out, frames: added };
}

// ---------- outside ----------
const hasShape = (t: CvatTrack, f: number) => sortedShapes(t).some((s) => s.frame === f);

/**
 * Đặt outside TỪ frame f (kiểu CVAT: object outside cho tới keyframe kế tiếp; khi upload mỗi frame outside
 * được tự điền keyframe riêng). Chỉ làm ở frame đang có box. Keyframe đầu của track cũng đặt outside được
 * (track bắt đầu bằng outside; vẫn chỉ là một `update`, không đổi ID).
 */
export function setOutsideFrom(track: CvatTrack, f: number): TrackChange | null {
  const st = stateAt(track, f);
  if (!st.cuboid) return null;
  return { track: upsertKeyframe(track, f, st.cuboid, true), frames: [f] };
}

/** Đưa object trở lại (có box) TỪ frame f: dùng box gần nhất làm giá trị, sau đó giữ nguyên tới keyframe kế. */
export function restoreFrom(track: CvatTrack, f: number, stop: number): TrackChange | null {
  const st = stateAt(track, f);
  if (st.status !== 'outside' && st.status !== 'outside-key') return null;
  const ref = referenceCuboid(track, f, stop);
  if (!ref) return null;
  return { track: upsertKeyframe(track, f, ref, false), frames: [f] };
}

/** Outside cả khoảng [a, b] (mỗi frame một keyframe outside); frame b+1 giữ nguyên trạng thái (thêm keyframe giữ giá trị). */
export function setOutsideRange(track: CvatTrack, a: number, b: number, stop: number): TrackChange | null {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  let out = track;
  const frames: number[] = [];
  for (let f = lo; f <= hi; f++) {
    const st = stateAt(track, f);
    if (!st.cuboid) continue;
    out = upsertKeyframe(out, f, st.cuboid, true);
    frames.push(f);
  }
  if (!frames.length) return null;
  if (hi + 1 <= stop && !hasShape(track, hi + 1)) {
    const nx = stateAt(track, hi + 1);
    if (nx.cuboid) { out = upsertKeyframe(out, hi + 1, nx.cuboid, false); frames.push(hi + 1); }
  }
  return { track: out, frames };
}

/** Đảo ngược outside theo khoảng [a, b]: mọi frame outside trong khoảng được đưa trở lại (mỗi frame một keyframe có box).
 *  Box lấy từ `bak` (box đã lưu trước khi đặt outside) nếu có, không thì box tham chiếu gần nhất. Frame b+1 giữ nguyên trạng thái. */
export function restoreOutsideRange(track: CvatTrack, a: number, b: number, stop: number, bak: Record<string, Cuboid> = {}): TrackChange | null {
  const lo = Math.min(a, b), hi = Math.max(a, b);
  const isOut = (t: CvatTrack, f: number) => { const s = stateAt(t, f).status; return s === 'outside' || s === 'outside-key'; };
  let out = track;
  const frames: number[] = [];
  const after = hi + 1 <= stop && !hasShape(track, hi + 1) && isOut(track, hi + 1) ? stateAt(track, hi + 1).cuboid : null;
  for (let f = lo; f <= hi; f++) {
    if (!isOut(out, f)) continue;
    const box = bak[String(f)] ?? referenceCuboid(out, f, stop);
    if (!box) continue;
    out = upsertKeyframe(out, f, box, false);
    frames.push(f);
  }
  if (!frames.length) return null;
  if (after) { out = upsertKeyframe(out, hi + 1, after, true); frames.push(hi + 1); }
  return { track: out, frames };
}
