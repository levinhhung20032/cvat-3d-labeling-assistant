import { stateAt } from './interp';
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
  totals: { objects: number; added: number; removed: number; modified: number; baked: number; outsideNow: number; outsideNew: number; outsideRestored: number };
  accepted: number; ignored: number; edits: number;
  pending: string[]; // object đã sửa nhưng chưa upload
}

export function computeKpi(shift: Shift, now: Date = new Date()): Kpi {
  const end = shift.end ? new Date(shift.end) : now;
  const per = new Map<string, { o: ObjectKpi; before: Set<number>; after: Set<number> }>();
  for (const up of shift.uploads) {
    for (const t of up.tracks) {
      const key = `${up.jobId}:${t.num}`;
      let e = per.get(key);
      if (!e) {
        e = {
          o: { jobId: up.jobId, num: t.num, id: t.id, label: t.label, uploads: 0, added: 0, removed: 0, modified: 0, baked: 0, outsideNow: 0, outsideNew: 0, outsideRestored: 0 },
          before: new Set(t.outsideBefore), after: new Set(),
        };
        per.set(key, e);
      }
      e.o.uploads++;
      e.o.added += t.added; e.o.removed += t.removed; e.o.modified += t.modified; e.o.baked += t.baked;
      e.after = new Set(t.outsideAfter); // trạng thái sau lần upload cuối
    }
  }
  const objects = [...per.values()].map(({ o, before, after }) => {
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
      objects: objects.length, added: sum('added'), removed: sum('removed'), modified: sum('modified'), baked: sum('baked'),
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
    `Keyframe: +${k.totals.added} / −${k.totals.removed} / ~${k.totals.modified}, khoá thêm ${k.totals.baked}`,
    `Gợi ý: chấp nhận ${k.accepted}, bỏ qua ${k.ignored} · thao tác sửa ${k.edits}`,
  ];
  if (k.pending.length) lines.push(`Đã sửa nhưng CHƯA upload: ${k.pending.map((p) => p.split(':')[1]).join(', ')}`);
  return lines.join('\n');
}
