import { sortedShapes, stateAt } from './interp';
import type { CvatTrack } from './types';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Tên ca: <tháng viết tắt><ngày><AM/PM>, ví dụ sáng 21/10 → "Oct21AM". Tính theo giờ lúc vào ca (trước 12:00 là AM). */
export function shiftName(d: Date): string {
  return `${MONTHS[d.getMonth()]}${d.getDate()}${d.getHours() < 12 ? 'AM' : 'PM'}`;
}

/** Nếu tên đã có (hai ca cùng buổi) thì thêm hậu tố #2, #3… */
export function uniqueShiftName(base: string, existing: string[]): string {
  if (!existing.includes(base)) return base;
  let i = 2;
  while (existing.includes(`${base}#${i}`)) i++;
  return `${base}#${i}`;
}

const EPS = 1e-6;
const CUB: (keyof import('./cuboid').Cuboid)[] = ['x', 'y', 'z', 'rx', 'ry', 'yaw', 'sx', 'sy', 'sz'];

/**
 * Các frame của track đã THAY ĐỔI sau lần upload, dù do sửa tay, nội suy tự đổi theo keyframe vừa sửa, outside tự điền
 * hay lưu outside thành keyframe: trạng thái có box / outside đổi, hoặc box đổi giá trị, hoặc frame outside được thêm keyframe riêng.
 * Khoá thêm keyframe mà giá trị hiển thị không đổi thì không tính.
 */
export function changedFrames(before: CvatTrack, after: CvatTrack, start: number, stop: number): number[] {
  const had = new Set(sortedShapes(before).map((s) => s.frame));
  const out: number[] = [];
  for (let f = start; f <= stop; f++) {
    const a = stateAt(before, f), b = stateAt(after, f);
    const outA = a.cuboid === null && a.status !== 'none', outB = b.cuboid === null && b.status !== 'none';
    let diff = (a.cuboid === null) !== (b.cuboid === null) || outA !== outB;
    if (!diff && a.cuboid && b.cuboid) diff = CUB.some((k) => Math.abs(a.cuboid![k] - b.cuboid![k]) > EPS);
    if (!diff && outB && b.status === 'outside-key' && !had.has(f)) diff = true; // outside được lưu thành keyframe riêng
    if (diff) out.push(f);
  }
  return out;
}

/** Các frame outside của track trong [start, stop], tính theo cách CVAT hiển thị. */
export function outsideFrames(track: CvatTrack, start: number, stop: number): number[] {
  const out: number[] = [];
  for (let f = start; f <= stop; f++) {
    const s = stateAt(track, f).status;
    if (s === 'outside' || s === 'outside-key') out.push(f);
  }
  return out;
}

export interface ShiftTrackRec {
  num: number; // ID hiển thị
  id: number; // ID database
  label: string;
  added: number; // keyframe thêm
  removed: number; // keyframe gỡ
  modified: number; // keyframe đổi giá trị
  baked: number; // frame được khoá thêm thành keyframe khi upload
  outsideFilled: number; // keyframe outside tự điền
  outsideBefore: number[]; // frame outside trước lần upload
  outsideAfter: number[]; // frame outside sau lần upload
  changedFrames?: number[]; // frame thay đổi thật sự (changedFrames()); thiếu ở dữ liệu ca cũ
}
export interface ShiftUpload { time: string; jobId: number; tracks: ShiftTrackRec[] }

export interface Shift {
  name: string;
  start: string;
  end: string | null;
  uploads: ShiftUpload[];
  accepted: number; // gợi ý đã chấp nhận
  ignored: number; // gợi ý đã bỏ qua
  edits: number; // số thao tác sửa trong nháp
  touched: string[]; // `${jobId}:${num}` các object đã sửa (kể cả chưa upload)
}

export interface ObjectKpi {
  jobId: number; num: number; id: number; label: string; uploads: number;
  added: number; removed: number; modified: number; baked: number;
  framesChanged: number; // số frame đã thay đổi (hợp các lần upload)
  outsideNow: number; // số frame outside sau cùng
  outsideNew: number; // frame outside mới đặt trong ca (không outside lúc đầu)
  outsideRestored: number; // frame đưa trở lại có box
}

export interface Kpi {
  name: string;
  durationMin: number;
  uploads: number;
  objects: ObjectKpi[];
  byLabel: Record<string, number>;
  totals: { objects: number; added: number; removed: number; modified: number; baked: number; framesChanged: number; outsideNow: number; outsideNew: number; outsideRestored: number };
  accepted: number; ignored: number; edits: number;
  pending: string[]; // object đã sửa nhưng chưa upload
}

export function computeKpi(shift: Shift, now: Date = new Date()): Kpi {
  const end = shift.end ? new Date(shift.end) : now;
  const per = new Map<string, { o: ObjectKpi; before: Set<number>; after: Set<number>; changed: Set<number> }>();
  for (const up of shift.uploads) {
    for (const t of up.tracks) {
      const key = `${up.jobId}:${t.num}`;
      let e = per.get(key);
      if (!e) {
        e = {
          o: { jobId: up.jobId, num: t.num, id: t.id, label: t.label, uploads: 0, added: 0, removed: 0, modified: 0, baked: 0, framesChanged: 0, outsideNow: 0, outsideNew: 0, outsideRestored: 0 },
          before: new Set(t.outsideBefore), after: new Set(), changed: new Set(),
        };
        per.set(key, e);
      }
      for (const f of t.changedFrames ?? []) e.changed.add(f);
      e.o.uploads++;
      e.o.added += t.added; e.o.removed += t.removed; e.o.modified += t.modified; e.o.baked += t.baked;
      e.after = new Set(t.outsideAfter); // trạng thái sau lần upload cuối
    }
  }
  const objects = [...per.values()].map(({ o, before, after, changed }) => {
    o.framesChanged = changed.size;
    o.outsideNow = after.size;
    o.outsideNew = [...after].filter((f) => !before.has(f)).length;
    o.outsideRestored = [...before].filter((f) => !after.has(f)).length;
    return o;
  }).sort((a, b) => a.jobId - b.jobId || a.num - b.num);

  const sum = (k: keyof ObjectKpi) => objects.reduce((n, o) => n + (o[k] as number), 0);
  const byLabel: Record<string, number> = {};
  for (const o of objects) byLabel[o.label] = (byLabel[o.label] ?? 0) + 1;
  const uploaded = new Set(objects.map((o) => `${o.jobId}:${o.num}`));
  return {
    name: shift.name,
    durationMin: Math.max(0, Math.round((end.getTime() - new Date(shift.start).getTime()) / 60000)),
    uploads: shift.uploads.length,
    objects, byLabel,
    totals: {
      objects: objects.length, added: sum('added'), removed: sum('removed'), modified: sum('modified'), baked: sum('baked'), framesChanged: sum('framesChanged'),
      outsideNow: sum('outsideNow'), outsideNew: sum('outsideNew'), outsideRestored: sum('outsideRestored'),
    },
    accepted: shift.accepted, ignored: shift.ignored, edits: shift.edits,
    pending: shift.touched.filter((k) => !uploaded.has(k)),
  };
}

export const fmtDuration = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} giờ ${min % 60} phút` : `${min} phút`);

/** Văn bản KPI để xem hoặc sao chép. */
export function kpiText(k: Kpi): string {
  const lines = [
    `Ca ${k.name} · ${fmtDuration(k.durationMin)} · ${k.uploads} lần upload`,
    `Object đã tác động (đã upload): ${k.totals.objects}${Object.keys(k.byLabel).length ? ' — ' + Object.entries(k.byLabel).map(([l, n]) => `${l} ${n}`).join(', ') : ''}`,
    `ID: ${k.objects.map((o) => `${o.num}${o.jobId ? '' : ''}`).join(', ') || '—'}`,
    `Frame outside của các object đó: ${k.totals.outsideNow} (mới đặt trong ca ${k.totals.outsideNew}, đưa trở lại ${k.totals.outsideRestored})`,
    `Frame đã thay đổi (sửa tay, nội suy, outside, lưu outside thành keyframe): ${k.totals.framesChanged}`,
    `Keyframe: +${k.totals.added} / −${k.totals.removed} / ~${k.totals.modified}, khoá thêm ${k.totals.baked}`,
    `Gợi ý: chấp nhận ${k.accepted}, bỏ qua ${k.ignored} · thao tác sửa ${k.edits}`,
  ];
  if (k.pending.length) lines.push(`Đã sửa nhưng CHƯA upload: ${k.pending.map((p) => p.split(':')[1]).join(', ')}`);
  return lines.join('\n');
}
