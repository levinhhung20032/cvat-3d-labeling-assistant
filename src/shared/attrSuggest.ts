import { getAttr, matchValue, type AttrSpec, type LabelSpec } from './attributes';
import { parseCuboid, type Cuboid } from './cuboid';
import { sortedShapes } from './interp';
import type { CvatTrack } from './types';

export type Confidence = 'cao' | 'vừa' | 'thấp';

export interface AttrHint {
  spec: AttrSpec;
  current: string | undefined; // giá trị đang có (chưa tính mặc định)
  effective: string; // giá trị hiệu lực (có tính mặc định của nhãn)
  suggested: string; // luôn là một giá trị hợp lệ của attribute
  confidence: Confidence;
  reason: string;
  scope: 'track' | 'frame';
}

interface Dim { L: number; W: number; H: number }
interface Pick { v: string; c: Confidence; why: string }

const pct = (a: number[], q: number) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.min(s.length - 1, Math.max(0, Math.round(q * (s.length - 1))))]! : NaN;
};
const f2 = (n: number) => n.toFixed(2);
const dimText = (d: Dim) => `dài ${f2(d.L)} × rộng ${f2(d.W)} × cao ${f2(d.H)} m`;

/** Kích thước đại diện của track: trung vị dài/rộng, phân vị 80% của chiều cao (bỏ lúc cúi / ngồi), trên các keyframe có box. */
export function trackDims(track: CvatTrack): Dim | null {
  const cubs = sortedShapes(track).filter((s) => !s.outside).map((s) => parseCuboid(s.points));
  if (!cubs.length) return null;
  return { L: pct(cubs.map((c) => c.sx), 0.5), W: pct(cubs.map((c) => c.sy), 0.5), H: pct(cubs.map((c) => c.sz), 0.8) };
}

// ---------- quy tắc theo kích thước (đã đối chiếu với một job thật: xe phần lớn 3,9–5,1 × 1,8–2,1 × 1,5–1,9 m là "car") ----------
export function vehicleType(d: Dim): Pick {
  const why = dimText(d);
  if (d.L < 1.4 && d.W < 0.9 && d.H < 1.4) return { v: 'stroller', c: 'thấp', why: `${why}: rất nhỏ (xe nôi / xe lăn)` };
  if (d.L < 2.8 && d.W < 1.5) return { v: 'tricycle', c: 'thấp', why: `${why}: ngắn và hẹp (xe ba bánh)` };
  if (d.L >= 11 || (d.L >= 8 && d.H >= 3.2)) return { v: 'trailer', c: 'vừa', why: `${why}: rất dài (xe đầu kéo)` };
  if (d.L >= 7 && d.H >= 2.6) return { v: 'bus', c: d.W >= 2.3 ? 'vừa' : 'thấp', why: `${why}: dài và cao (xe buýt / khách)` };
  if (d.H >= 2.4 && d.L >= 5.0) return { v: 'truck', c: d.H >= 2.6 ? 'vừa' : 'thấp', why: `${why}: cao ≥ 2,4 m (xe tải)` };
  if (d.L >= 5.8) return { v: 'truck', c: 'thấp', why: `${why}: dài ≥ 5,8 m (xe tải)` };
  if (d.H >= 2.0 && d.L >= 4.4 && d.W >= 1.8) return { v: 'van', c: d.H >= 2.1 ? 'vừa' : 'thấp', why: `${why}: thân cao (van / MPV)` };
  if (d.L >= 5.2 && d.H >= 1.7 && d.H <= 2.0) return { v: 'pickup', c: 'thấp', why: `${why}: dài, thấp hơn van (bán tải)` };
  if (d.L >= 3.0 && d.L <= 5.4 && d.W >= 1.55 && d.W <= 2.25 && d.H <= 2.0) {
    const core = d.L >= 3.7 && d.L <= 5.0 && d.W >= 1.7 && d.W <= 2.1 && d.H >= 1.35 && d.H <= 1.9;
    return { v: 'car', c: core ? 'cao' : 'vừa', why };
  }
  return { v: 'other', c: 'thấp', why: `${why}: không khớp nhóm nào` };
}

export function animalSpecies(d: Dim): Pick {
  const why = dimText(d);
  if (d.L < 0.7 && d.H < 0.5) return { v: 'cat', c: 'vừa', why: `${why}: nhỏ (mèo)` };
  if (d.L < 1.3 && d.H < 0.95) return { v: 'dog', c: 'vừa', why: `${why}: cỡ chó` };
  if (d.L >= 2.0 && d.H >= 1.3) return { v: 'buffalo', c: 'thấp', why: `${why}: rất lớn (trâu)` };
  if (d.L >= 1.4 && d.H >= 1.0) return { v: 'cow', c: 'thấp', why: `${why}: cỡ bò` };
  return { v: 'other', c: 'thấp', why: `${why}: không khớp nhóm nào` };
}

export function obstacleType(d: Dim): Pick {
  const why = dimText(d);
  if (d.H < 0.15 && Math.max(d.L, d.W) >= 0.8) return { v: 'metal_sheet', c: 'thấp', why: `${why}: rất mỏng, phẳng (tấm kim loại / ván)` };
  if (d.L < 0.5 && d.W < 0.5 && d.H < 0.3) return { v: 'brick', c: 'thấp', why: `${why}: nhỏ (gạch / đá)` };
  if (Math.max(d.L, d.W) < 0.6 && d.H >= 0.4 && d.H <= 1.2) return { v: 'traffic cone', c: 'vừa', why: `${why}: nhỏ, cao ~0,4–1,2 m (cọc tiêu)` };
  if (Math.max(d.L, d.W) >= 1.2 && Math.min(d.L, d.W) < 0.6 && d.H >= 0.5 && d.H <= 1.4) return { v: 'traffic barrier', c: 'thấp', why: `${why}: dài, mỏng, cao ~1 m (rào chắn)` };
  if (Math.max(d.L, d.W) < 0.35 && d.H >= 1.0) return { v: 'pole', c: 'thấp', why: `${why}: mảnh, cao (trụ)` };
  if (d.H >= 1.0 && Math.max(d.L, d.W) < 1.0) return { v: 'charging_point', c: 'thấp', why: `${why}: cao, nhỏ (trụ sạc)` };
  if (Math.max(d.L, d.W) < 1.2 && d.H < 0.9) return { v: 'sack', c: 'thấp', why: `${why}: khối nhỏ (bao / túi)` };
  return { v: 'other', c: 'thấp', why: `${why}: không khớp nhóm nào` };
}

export function pedestrianAge(d: Dim): Pick {
  const why = `cao ${f2(d.H)} m`;
  if (d.H < 1.25) return { v: 'child', c: 'cao', why: `${why} < 1,25 m` };
  if (d.H < 1.35) return { v: 'child', c: 'vừa', why: `${why} < 1,35 m` };
  return { v: 'adult', c: d.H >= 1.5 ? 'cao' : 'vừa', why: `${why} (guideline: không chắc thì chọn adult)` };
}

/** Tư thế người đi bộ ở một frame so với chiều cao đứng của chính người đó. */
export function pedestrianPose(h: number, standingH: number): Pick | null {
  const ratio = h / Math.max(standingH, 1.5);
  const why = `cao ${f2(h)} m, bằng ${(ratio * 100).toFixed(0)}% chiều cao đứng`;
  if (ratio >= 0.88) return { v: 'standing', c: ratio >= 0.95 ? 'cao' : 'vừa', why };
  if (ratio >= 0.7) return { v: 'bending', c: 'thấp', why };
  return { v: 'sitting', c: 'thấp', why };
}

/** Có người đi bộ nằm trong phạm vi box xe hai bánh ở frame đó không (guideline: người đã nằm trong box xe → with_rider). */
export function riderInside(bike: Cuboid, peds: Cuboid[]): boolean {
  const cos = Math.cos(bike.yaw), sin = Math.sin(bike.yaw);
  return peds.some((p) => {
    const dx = p.x - bike.x, dy = p.y - bike.y;
    const u = dx * cos + dy * sin, v = -dx * sin + dy * cos;
    return Math.abs(u) <= bike.sx / 2 + 0.3 && Math.abs(v) <= bike.sy / 2 + 0.3 && Math.abs(p.z - bike.z) <= (bike.sz + p.sz) / 2;
  });
}

export function rideState(boxH: number, withPedestrian: boolean): Pick | null {
  if (withPedestrian) return { v: 'true', c: 'cao', why: 'có người đi bộ nằm trong phạm vi box xe' };
  if (boxH >= 1.4) return { v: 'true', c: 'vừa', why: `box cao ${f2(boxH)} m ≥ 1,4 m (gồm người lái)` };
  if (boxH < 1.1) return { v: 'false', c: 'vừa', why: `box cao ${f2(boxH)} m < 1,1 m, không có người trong box` };
  return null; // vùng mập mờ: không gợi ý
}

export interface SuggestCtx {
  track: CvatTrack;
  label: string; // tên nhãn
  spec: LabelSpec;
  frame: number; // frame tham chiếu (cho attribute đổi theo frame)
  box: Cuboid | null; // box ở frame tham chiếu (null nếu outside / chưa có)
  pedestrians: Cuboid[]; // box người đi bộ ở frame tham chiếu (để xét người lái xe hai bánh)
}

/**
 * Gợi ý giá trị attribute từ hình học của box (và từ người đi bộ chồng lên xe hai bánh). Chỉ trả những attribute mà
 * gợi ý KHÁC giá trị hiệu lực hiện tại (kể cả đang để mặc định). Giá trị gợi ý luôn thuộc danh sách hợp lệ của attribute.
 */
export function suggestAttributes(ctx: SuggestCtx): AttrHint[] {
  const out: AttrHint[] = [];
  const dims = trackDims(ctx.track);
  const lab = ctx.label.trim().toLowerCase();
  const push = (spec: AttrSpec, p: Pick | null, scope: 'track' | 'frame') => {
    if (!p) return;
    const sug = matchValue(spec, p.v);
    if (!sug) return;
    const current = getAttr(ctx.track, ctx.frame, spec);
    const effective = current ?? spec.def;
    if (effective === sug) return;
    out.push({ spec, current, effective, suggested: sug, confidence: p.c, reason: p.why, scope });
  };
  const find = (name: string) => ctx.spec.attrs.find((a) => a.name.toLowerCase() === name);
  if (!dims) return out;

  if (lab === 'vehicles' || lab === 'vehicle') {
    const a = find('type');
    if (a) push(a, vehicleType(dims), 'track');
  } else if (lab === 'pedestrian') {
    const age = find('age');
    if (age) push(age, pedestrianAge(dims), 'track');
    const pose = find('pose');
    if (pose && ctx.box) push(pose, pedestrianPose(ctx.box.sz, dims.H), 'frame');
  } else if (lab === 'two-wheels') {
    const rs = find('ride_state');
    if (rs && ctx.box) push(rs, rideState(ctx.box.sz, riderInside(ctx.box, ctx.pedestrians)), 'frame');
  } else if (lab === 'animal') {
    const a = find('species');
    if (a) push(a, animalSpecies(dims), 'track');
  } else if (lab === 'obstacle') {
    const a = find('type');
    if (a) push(a, obstacleType(dims), 'track');
  }
  return out;
}
