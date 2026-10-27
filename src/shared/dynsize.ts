import { parseCuboid, type Cuboid } from './cuboid';
import { sortedShapes } from './interp';
import { apply, fromEuler, transpose, type Vec3 } from './rot';
import type { CvatTrack } from './types';

const EPS = 1e-6;
export const sameSize = (a: Pick<Cuboid, 'sx' | 'sy' | 'sz'>, b: Pick<Cuboid, 'sx' | 'sy' | 'sz'>) =>
  Math.abs(a.sx - b.sx) < EPS && Math.abs(a.sy - b.sy) < EPS && Math.abs(a.sz - b.sz) < EPS;

/**
 * Dynamic size TẮT: kích thước của object là một giá trị chung. Đặt kích thước `size` cho mọi keyframe có box
 * của track (keyframe outside giữ nguyên). Chỉ đổi 3 số kích thước, không đổi vị trí / góc / ID.
 * Trả track mới và danh sách frame bị đổi.
 */
export function propagateSize(track: CvatTrack, size: Pick<Cuboid, 'sx' | 'sy' | 'sz'>): { track: CvatTrack; frames: number[] } {
  const frames: number[] = [];
  const shapes = sortedShapes(track).map((s) => {
    if (s.outside) return s;
    if (sameSize(parseCuboid(s.points), size)) return s;
    const points = s.points.slice();
    points[6] = size.sx; points[7] = size.sy; points[8] = size.sz;
    frames.push(s.frame);
    return { ...s, points };
  });
  return { track: frames.length ? { ...track, shapes } : track, frames };
}

export type Anchor = 'neg' | 'pos' | 'center';
export interface AxisAnchors { x: Anchor | null; y: Anchor | null; z: Anchor | null } // null: trục không đổi kích thước

/**
 * Suy ra, cho từng trục (dọc xe / ngang / cao), MẶT nào của box đã đứng yên khi bạn đổi kích thước một frame:
 * kéo cạnh dưới → mặt trên đứng yên ('pos'), kéo cạnh trên → mặt dưới đứng yên ('neg'), đổi đối xứng quanh tâm → 'center'.
 * Độ dời tâm được đo trong hệ trục riêng của box TRƯỚC khi sửa; không khớp mẫu nào (vừa dời vừa đổi cỡ) thì coi là 'center'.
 */
export function detectAnchors(before: Cuboid, after: Cuboid): AxisAnchors {
  const d = [after.x - before.x, after.y - before.y, after.z - before.z] as Vec3;
  const local = apply(transpose(fromEuler(before.rx, before.ry, before.yaw)), d);
  const one = (ds: number, c: number): Anchor | null => {
    if (Math.abs(ds) < 1e-6) return null;
    const tol = 0.03 + 0.15 * Math.abs(ds);
    if (Math.abs(c - ds / 2) <= tol) return 'neg'; // tâm dời theo hướng mặt bị kéo ⇒ mặt đối diện (âm) đứng yên
    if (Math.abs(c + ds / 2) <= tol) return 'pos';
    return 'center';
  };
  return { x: one(after.sx - before.sx, local[0]), y: one(after.sy - before.sy, local[1]), z: one(after.sz - before.sz, local[2]) };
}

/**
 * Dynamic size TẮT, đồng bộ "thông minh": áp kích thước mới cho mọi keyframe có box khác NHƯNG giữ nguyên mặt đã đứng yên ở frame
 * vừa sửa. Ví dụ kéo cạnh trên của box xuống thì ở mọi keyframe, đáy giữ nguyên và chỉ nóc hạ xuống (tâm dời theo trục của chính
 * keyframe đó), chứ không căn theo tâm. Trục đổi đối xứng quanh tâm thì giữ tâm như cũ. Không đổi góc, ID, keyframe outside.
 */
export function propagateEdit(track: CvatTrack, before: Cuboid, after: Cuboid): { track: CvatTrack; frames: number[] } {
  const anchors = detectAnchors(before, after);
  const frames: number[] = [];
  const shapes = sortedShapes(track).map((s) => {
    if (s.outside) return s;
    const b = parseCuboid(s.points);
    if (sameSize(b, after)) return s;
    const ds = [after.sx - b.sx, after.sy - b.sy, after.sz - b.sz];
    const an = [anchors.x, anchors.y, anchors.z];
    const shift: Vec3 = [0, 0, 0];
    for (let i = 0; i < 3; i++) {
      if (an[i] === 'neg') shift[i] = ds[i]! / 2;
      else if (an[i] === 'pos') shift[i] = -ds[i]! / 2;
    }
    const w = apply(fromEuler(b.rx, b.ry, b.yaw), shift); // dời tâm theo trục riêng của chính keyframe này
    const points = s.points.slice();
    points[0] = b.x + w[0]; points[1] = b.y + w[1]; points[2] = b.z + w[2];
    points[6] = after.sx; points[7] = after.sy; points[8] = after.sz;
    frames.push(s.frame);
    return { ...s, points };
  });
  return { track: frames.length ? { ...track, shapes } : track, frames };
}
