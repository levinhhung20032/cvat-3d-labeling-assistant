import { upsertKeyframe } from './edit';
import { sortedShapes, stateAt } from './interp';
import type { AttrValue, CvatLabel, CvatShape, CvatTrack } from './types';

export interface AttrSpec { id: number; name: string; input: string; mutable: boolean; def: string; values: string[] }
export interface LabelSpec { id: number; name: string; attrs: AttrSpec[] }

/** Đặc tả attribute của từng nhãn, đọc từ cấu hình nhãn thật của job (không dựa vào chữ trong guideline). */
export function parseLabelSpecs(labels: CvatLabel[]): Map<number, LabelSpec> {
  return new Map(labels.map((l) => [l.id, {
    id: l.id,
    name: l.name,
    attrs: (l.attributes ?? []).map((a) => ({
      id: a.id, name: a.name, input: a.input_type ?? 'select', mutable: !!a.mutable,
      def: a.default_value ?? '', values: (a.values ?? []).map(String),
    })),
  }]));
}

const entry = (list: AttrValue[] | undefined, id: number) => (list ?? []).find((a) => a.spec_id === id);

/**
 * Giá trị attribute của track ở frame f (chưa tính giá trị mặc định).
 * - attribute tĩnh: ở cấp track;
 * - attribute đổi theo frame (mutable): giá trị ở keyframe gần nhất ≤ f có ghi attribute đó.
 */
export function getAttr(track: CvatTrack, f: number, spec: AttrSpec): string | undefined {
  if (spec.mutable) {
    const shapes = sortedShapes(track);
    for (let i = shapes.length - 1; i >= 0; i--) {
      const s = shapes[i]!;
      if (s.frame > f) continue;
      const e = entry(s.attributes, spec.id);
      if (e) return e.value;
    }
  }
  return entry(track.attributes, spec.id)?.value;
}

const withEntry = (list: AttrValue[] | undefined, id: number, value: string): AttrValue[] => {
  const l = list ?? [];
  return l.some((a) => a.spec_id === id) ? l.map((a) => (a.spec_id === id ? { ...a, value } : a)) : [...l, { spec_id: id, value }];
};

export interface AttrChange { track: CvatTrack; frames: number[] }

/** Đặt attribute tĩnh cho cả track. */
export function setAttrStatic(track: CvatTrack, spec: AttrSpec, value: string): AttrChange | null {
  if (getAttr(track, 0, spec) === value) return null;
  return { track: { ...track, attributes: withEntry(track.attributes, spec.id, value) }, frames: [-1] };
}

/** Đặt attribute mutable cho CẢ track (mọi keyframe có box). */
export function setAttrAll(track: CvatTrack, spec: AttrSpec, value: string): AttrChange | null {
  const shapes = sortedShapes(track).map((s): CvatShape => (s.outside ? s : { ...s, attributes: withEntry(s.attributes, spec.id, value) }));
  const changed = shapes.some((s, i) => s !== sortedShapes(track)[i]);
  return changed ? { track: { ...track, shapes }, frames: [-1] } : null;
}

/**
 * Đặt attribute mutable TỪ frame f (tới keyframe kế tiếp có ghi attribute đó). Tạo keyframe tại f nếu chưa có
 * (giữ nguyên hình dạng đang hiển thị). Trả null nếu frame không có box.
 */
export function setAttrFrom(track: CvatTrack, spec: AttrSpec, f: number, value: string): AttrChange | null {
  const st = stateAt(track, f);
  if (!st.cuboid) return null;
  if (getAttr(track, f, spec) === value && st.status === 'key') return null;
  let t = st.status === 'key' ? track : upsertKeyframe(track, f, st.cuboid);
  t = { ...t, shapes: sortedShapes(t).map((s) => (s.frame === f ? { ...s, attributes: withEntry(s.attributes, spec.id, value) } : s)) };
  return { track: t, frames: [f] };
}

/**
 * Đồng bộ attribute mutable TỪ frame f VỀ SAU: đặt giá trị tại f (tạo keyframe giữ nguyên hình dạng nếu chưa có) rồi ghi đè giá trị
 * ở mọi keyframe sau f đang ghi attribute đó với giá trị khác. Keyframe sau f chưa ghi attribute thì tự kế thừa giá trị mới.
 * Trả null nếu f không có box hoặc không có gì đổi.
 */
export function setAttrForward(track: CvatTrack, spec: AttrSpec, f: number, value: string): AttrChange | null {
  if (!spec.mutable || !stateAt(track, f).cuboid) return null;
  const first = setAttrFrom(track, spec, f, value);
  const base = first?.track ?? track;
  const frames = new Set(first?.frames ?? []);
  const shapes = sortedShapes(base).map((sh): CvatShape => {
    if (sh.outside || sh.frame <= f) return sh;
    const e = entry(sh.attributes, spec.id);
    if (!e || e.value === value) return sh;
    frames.add(sh.frame);
    return { ...sh, attributes: withEntry(sh.attributes, spec.id, value) };
  });
  return frames.size ? { track: { ...base, shapes }, frames: [...frames] } : null;
}

/** Khớp giá trị mong muốn với danh sách giá trị hợp lệ của attribute (bỏ khác biệt hoa/thường, dấu cách, gạch). */
export function matchValue(spec: AttrSpec, wanted: string): string | null {
  const norm = (s: string) => s.toLowerCase().replace(/[\s_-]/g, '');
  const w = norm(wanted);
  // Checkbox của CVAT: danh sách values chỉ ghi giá trị mặc định (vd. ['false']) nhưng 'true' / 'false' đều hợp lệ.
  if (spec.input === 'checkbox') return w === 'true' || w === 'false' ? w : null;
  return spec.values.find((v) => norm(v) === w) ?? spec.values.find((v) => norm(v).startsWith(w)) ?? null;
}
