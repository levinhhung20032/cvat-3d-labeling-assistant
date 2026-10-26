import { checkOutsideKeyframes, missingOutsideKeyframes, trackIds } from './rules';
import { hasTilt, tiltTooLarge } from './cuboid';
import { sortedShapes } from './interp';
import { bakeKeyframes } from './keyframes';
import type { CvatAnnotations, CvatShape, CvatTrack, Violation } from './types';

// ---------- so sánh ----------
export function stableStringify(x: unknown): string {
  if (Array.isArray(x)) return `[${x.map(stableStringify).join(',')}]`;
  if (x && typeof x === 'object') {
    const o = x as Record<string, unknown>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(',')}}`;
  }
  return JSON.stringify(x);
}

/** Hai track giống hệt nhau (kể cả id của shape). */
export const sameTrack = (a: CvatTrack, b: CvatTrack) => stableStringify(a) === stableStringify(b);

/**
 * Track trên server `server` có chứa đúng nội dung của `want` không: mọi trường của `want` (trừ id của
 * shape mới, vì server tự cấp) đều khớp từng giá trị và số shape bằng nhau. Server được phép có thêm trường.
 */
export function covers(server: CvatTrack, want: CvatTrack): boolean {
  const { shapes: sw, ...restW } = want;
  const { shapes: ss, ...restS } = server;
  for (const k of Object.keys(restW)) {
    if (stableStringify((restS as Record<string, unknown>)[k]) !== stableStringify((restW as Record<string, unknown>)[k])) return false;
  }
  if (ss.length !== sw.length) return false;
  const byFrame = new Map(ss.map((s) => [s.frame, s]));
  for (const w of sw) {
    const s = byFrame.get(w.frame);
    if (!s) return false;
    for (const k of Object.keys(w)) {
      if (k === 'id' && w.id === undefined) continue;
      if (stableStringify(s[k]) !== stableStringify(w[k])) return false;
    }
  }
  return true;
}

// ---------- chuẩn hóa track trước khi gửi ----------
export interface Normalized { track: CvatTrack; outsideFilled: number }

/**
 * - Roll / pitch (rx, ry) được giữ nguyên (chủ dự án cho phép box nghiêng theo mặt đường); vượt ±30° thì bị chặn ở bước kiểm tra.
 * - Mọi frame outside đều có keyframe outside riêng: sau mỗi shape outside, điền các frame còn thiếu tới
 *   shape kế tiếp hoặc tới frame cuối của job (luật 2).
 */
export function normalizeTrack(t: CvatTrack, stopFrame: number): Normalized {
  const shapes = sortedShapes(t);
  const out: CvatShape[] = [];
  let outsideFilled = 0;
  shapes.forEach((s, i) => {
    const cur = s;
    out.push(cur);
    if (cur.outside) {
      const next = shapes[i + 1];
      const end = next ? next.frame - 1 : stopFrame;
      for (let f = cur.frame + 1; f <= end; f++) {
        const { id: _id, ...rest } = structuredClone(cur);
        out.push({ ...rest, frame: f, outside: true });
        outsideFilled++;
      }
    }
  });
  return { track: { ...t, shapes: out }, outsideFilled };
}

/** Số keyframe (không outside) có roll/pitch ≠ 0 và khác với keyframe cùng frame của baseline. */
export function countTiltSet(before: CvatTrack, after: CvatTrack): number {
  const old = new Map(before.shapes.map((s) => [s.frame, s]));
  let n = 0;
  for (const s of after.shapes) {
    if (s.outside || !hasTilt(s.points)) continue;
    const o = old.get(s.frame);
    if (!o || o.points[3] !== s.points[3] || o.points[4] !== s.points[4]) n++;
  }
  return n;
}

// ---------- kế hoạch upload ----------
export interface TrackDiff {
  index: number; // thứ tự track (ID hiển thị − 1)
  id: number;
  added: number; // keyframe thêm (không tính outside tự điền)
  removed: number; // keyframe gỡ
  modified: number; // keyframe giá trị đổi
  outsideFilled: number;
  tiltSet: number; // keyframe có roll/pitch ≠ 0 mà khác baseline (thông tin; cần người dùng xác nhận khi upload)
  baked: number; // frame được khoá thêm thành keyframe
  attrs: number; // attribute cấp track đổi giá trị (attribute đổi theo frame nằm trong ~KF)
}

export interface CreatedInfo { index: number; label_id: number; shapes: number; outsideFilled: number; tiltSet: number }

export interface UploadPlan {
  created: CvatTrack[]; // object MỚI do tool tạo (chưa có id), gửi bằng action=create
  createdInfo: CreatedInfo[];
  changed: CvatTrack[]; // dữ liệu sẽ gửi
  expected: CvatTrack[]; // phiên bản baseline của đúng các track đó (để phát hiện xung đột)
  diffs: TrackDiff[];
  outsideFilled: number;
  tiltSet: number;
  others: { tracks: number; frames: number }; // track không sửa mà vẫn thiếu keyframe outside (không gửi, trừ khi includeOthers)
  blockers: Violation[];
}

const shapeKey = (s: CvatShape) => {
  const { id: _id, ...rest } = s;
  return stableStringify(rest);
};

/** Số attribute cấp track khác nhau giữa hai phiên bản của track. */
export function trackAttrChanges(before: CvatTrack, after: CvatTrack): number {
  const b = new Map((before.attributes ?? []).map((x) => [x.spec_id, x.value]));
  return (after.attributes ?? []).filter((x) => b.get(x.spec_id) !== x.value).length;
}

export function diffTrack(before: CvatTrack, after: CvatTrack, outsideFilled: number): Pick<TrackDiff, 'added' | 'removed' | 'modified'> {
  const b = new Map(before.shapes.map((s) => [s.frame, s]));
  const a = new Map(after.shapes.map((s) => [s.frame, s]));
  let added = 0, removed = 0, modified = 0;
  for (const [f, s] of a) {
    const old = b.get(f);
    if (!old) added++;
    else if (shapeKey(old) !== shapeKey(s)) modified++;
  }
  for (const f of b.keys()) if (!a.has(f)) removed++;
  return { added: Math.max(0, added - outsideFilled), removed, modified };
}

export function buildUploadPlan(
  baseline: CvatAnnotations, working: CvatAnnotations, stopFrame: number, includeOthers = false, bake = false,
): UploadPlan {
  const blockers: Violation[] = [];
  const baseIds = new Set(trackIds(baseline));
  for (const id of baseIds) {
    if (!trackIds(working).includes(id)) blockers.push({ rule: 'id-removed', trackId: id, message: `Track ${id} biến mất so với baseline` });
  }
  const changed: CvatTrack[] = [], expected: CvatTrack[] = [], diffs: TrackDiff[] = [];
  const created: CvatTrack[] = [], createdInfo: CreatedInfo[] = [];
  let outsideFilled = 0, tiltSet = 0, othersTracks = 0, othersFrames = 0;
  working.tracks.forEach((w, index) => {
    const b = baseline.tracks[index];
    if (typeof w.id !== 'number' && !b && index >= baseline.tracks.length) {
      // Object MỚI do tool tạo: chỉ được nằm sau mọi track của CVAT (ID hiển thị của object cũ không đổi), không có id.
      const n = normalizeTrack(w, stopFrame);
      created.push(n.track);
      createdInfo.push({ index, label_id: w.label_id, shapes: n.track.shapes.length, outsideFilled: n.outsideFilled, tiltSet: countTiltSet({ ...w, shapes: [] }, n.track) });
      return;
    }
    if (typeof w.id !== 'number' || !b || b.id !== w.id) {
      blockers.push({ rule: 'id-missing', trackId: w.id, message: `Track thứ ${index + 1} không khớp baseline` });
      return;
    }
    const edited = !sameTrack(w, b);
    const missing = missingOutsideKeyframes(w, stopFrame).length;
    if (!edited && !(includeOthers && missing > 0)) {
      if (missing > 0) { othersTracks++; othersFrames += missing; }
      return;
    }
    const n = normalizeTrack(w, stopFrame);
    // "Khoá hết thành keyframe" chỉ cho object người dùng đã tác động (không cho track chỉ được điền outside hộ).
    let finalTrack = n.track, baked = 0;
    if (bake && edited) {
      const first = sortedShapes(n.track)[0];
      if (first) {
        const r = bakeKeyframes(n.track, first.frame, stopFrame);
        finalTrack = r.track;
        baked = r.frames.length;
      }
    }
    if (sameTrack(finalTrack, b)) return;
    changed.push(finalTrack);
    expected.push(b);
    outsideFilled += n.outsideFilled;
    const ts = countTiltSet(b, finalTrack);
    tiltSet += ts;
    diffs.push({ index, id: w.id, ...diffTrack(b, finalTrack, n.outsideFilled + baked), outsideFilled: n.outsideFilled, tiltSet: ts, baked, attrs: trackAttrChanges(b, finalTrack) });
  });
  blockers.push(...checkOutsideKeyframes({ ...working, tracks: [...changed, ...created] }, stopFrame));
  for (const t of [...changed, ...created]) {
    const bad = t.shapes.filter((x) => !x.outside && tiltTooLarge(x.points)).map((x) => x.frame);
    if (bad.length) blockers.push({ rule: 'tilt-too-large', trackId: t.id, frames: bad, message: `Track ${t.id}: roll/pitch vượt ±30° ở frame ${bad.join(', ')}` });
  }
  tiltSet += createdInfo.reduce((n, c) => n + c.tiltSet, 0);
  return { created, createdInfo, changed, expected, diffs, outsideFilled, tiltSet, others: { tracks: othersTracks, frames: othersFrames }, blockers };
}

export const UPLOAD_BATCH = 10;
