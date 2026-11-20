import { upsertKeyframe } from './edit';
import { sortedShapes, stateAt } from './interp';
import type { CvatTrack } from './types';

export interface JoinResult {
  a: CvatTrack; // object nhận: phần của A trước `from`, rồi toàn bộ box của B từ `from`
  b: CvatTrack; // object nguồn: outside ở mọi frame từ `from` tới cuối job
  from: number; // frame đầu tiên B có box
  framesA: number[]; // frame của A bị đổi
  framesB: number[]; // frame của B bị đổi
}

/** Frame đầu tiên track có box (không outside) trong [track.frame, stop]; null nếu không có. */
export function firstBoxFrame(t: CvatTrack, stop: number): number | null {
  for (let f = t.frame; f <= stop; f++) if (stateAt(t, f).cuboid) return f;
  return null;
}

/**
 * Nối ID: A xuất hiện tới frame x, B xuất hiện từ frame y nhưng cùng là một vật. Sao chép toàn bộ box (keyframe) của B từ frame
 * đầu tiên B có box (`from`) vào A (bỏ keyframe cũ của A từ `from` trở đi, B được ưu tiên), rồi đặt outside B ở mọi frame từ `from`
 * tới `stop`. Không xóa ID nào. Null nếu B không có box nào hoặc A, B là một.
 */
export function joinTracks(a: CvatTrack, b: CvatTrack, stop: number): JoinResult | null {
  if (a === b) return null;
  const from = firstBoxFrame(b, stop);
  if (from === null) return null;
  const head = sortedShapes(a).filter((s) => s.frame < from);
  const tail = sortedShapes(b).filter((s) => s.frame >= from).map(({ id: _id, ...s }) => structuredClone(s));
  const framesA = [...new Set([...sortedShapes(a).filter((s) => s.frame >= from).map((s) => s.frame), ...tail.map((s) => s.frame)])].sort((x, y) => x - y);
  const newA: CvatTrack = { ...a, frame: head.length ? a.frame : from, shapes: [...head, ...tail] };
  let newB = b;
  const framesB: number[] = [];
  for (let f = from; f <= stop; f++) {
    const c = stateAt(b, f).cuboid;
    if (!c) continue;
    newB = upsertKeyframe(newB, f, c, true);
    framesB.push(f);
  }
  return { a: newA, b: newB, from, framesA, framesB };
}
