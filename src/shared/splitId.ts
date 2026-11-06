import { upsertKeyframe } from './edit';
import { sortedShapes, stateAt } from './interp';
import type { CvatTrack } from './types';

/** Outside liên tục từ ngần này frame trở lên rồi xuất hiện lại thì nên tách ID (guideline); dưới mức này giữ ID và đánh outside. */
export const SPLIT_OUTSIDE_FRAMES = 6;
/** Ngưỡng đang dùng (tab Threshold chỉnh được); mặc định = SPLIT_OUTSIDE_FRAMES. */
export const splitConfig = { minFrames: SPLIT_OUTSIDE_FRAMES };

export interface OutsideGap {
  from: number; // frame outside đầu tiên của đoạn
  to: number; // frame outside cuối cùng
  resume: number; // frame đầu tiên có box trở lại (luôn là một keyframe)
  len: number; // số frame outside liên tục
}

/**
 * Các đoạn outside liên tục ≥ minLen frame nằm GIỮA hai đoạn có box của track (có box trước đó và có box lại sau đó).
 * Đoạn outside ở đầu track hoặc kéo tới cuối job không có phần "sau" để tách nên không tính.
 */
export function findLongOutsideGaps(track: CvatTrack, start: number, stop: number, minLen = splitConfig.minFrames): OutsideGap[] {
  const out: OutsideGap[] = [];
  let seen = false;
  let from: number | null = null;
  for (let f = start; f <= stop; f++) {
    if (stateAt(track, f).cuboid) {
      if (seen && from !== null && f - from >= minLen) out.push({ from, to: f - 1, resume: f, len: f - from });
      seen = true;
      from = null;
    } else if (seen && from === null) from = f;
  }
  return out;
}

export interface SplitResult {
  oldTrack: CvatTrack; // giữ ID: phần trước đoạn outside, rồi outside có keyframe ở MỌI frame từ `resume` tới cuối job
  newTrack: CvatTrack; // object mới (chưa có id): phần từ `resume` trở đi, thêm vào cuối danh sách
  frames: number[]; // frame của track cũ bị đổi (để đánh dấu "đã sửa")
}

/**
 * Tách ID tại frame `resume` (frame đầu tiên có box lại sau đoạn outside dài). Không xóa ID nào: track cũ chỉ được `update`,
 * track mới được `create` ở cuối danh sách. Null nếu `resume` không phải keyframe có box ngay sau một đoạn outside.
 */
export function splitTrack(track: CvatTrack, resume: number, stop: number): SplitResult | null {
  const shapes = sortedShapes(track);
  const head = shapes.filter((s) => s.frame < resume);
  const tail = shapes.filter((s) => s.frame >= resume);
  if (!head.length || !tail.length || tail[0]!.frame !== resume || tail[0]!.outside) return null;
  let ref = null;
  for (let f = resume - 1; f >= track.frame && !ref; f--) ref = stateAt(track, f).cuboid;
  if (!ref) return null;
  let oldTrack: CvatTrack = { ...track, shapes: head };
  const frames: number[] = [];
  for (let f = resume; f <= stop; f++) { oldTrack = upsertKeyframe(oldTrack, f, ref, true); frames.push(f); }
  const { id: _id, ...rest } = track;
  const newTrack: CvatTrack = { ...rest, frame: resume, shapes: tail.map(({ id: _sid, ...s }) => structuredClone(s)) };
  return { oldTrack, newTrack, frames };
}

export interface LateStart {
  first: number; // frame đầu tiên có box của track
}

/** Track có box đầu tiên muộn hơn frame đầu job (xuất hiện giữa chừng). Null nếu bắt đầu từ frame đầu hoặc không có box nào. */
export function findLateStart(track: CvatTrack, start: number, stop: number): LateStart | null {
  // Track đã có keyframe (kể cả outside) từ frame đầu job = đã ở dạng "outside tới lúc xuất hiện", không phải xuất hiện muộn.
  const firstShape = sortedShapes(track)[0];
  if (firstShape && firstShape.frame <= start) return null;
  for (let f = start; f <= stop; f++) {
    if (stateAt(track, f).cuboid) return f > start ? { first: f } : null;
  }
  return null;
}

/**
 * ID xuất hiện giữa chừng (từ frame `first` > start): GIỮ NGUYÊN ID, chỉ thêm keyframe outside ở mọi frame start..first-1
 * (copy box đầu tiên làm giá trị nền). Không tạo object mới, không xóa gì; frame từ `first` trở đi không đổi.
 */
export function outsideBeforeAppear(track: CvatTrack, start: number, stop: number): { track: CvatTrack; frames: number[]; first: number } | null {
  const late = findLateStart(track, start, stop);
  if (!late) return null;
  const ref = stateAt(track, late.first).cuboid;
  if (!ref) return null;
  let cur = track;
  const frames: number[] = [];
  for (let f = start; f < late.first; f++) { cur = upsertKeyframe(cur, f, ref, true); frames.push(f); }
  return { track: cur, frames, first: late.first };
}
