import { computeKpi, MONTHS, type Shift, type ShiftTrackRec, type ShiftUpload } from './shift';
import { normalizeSchedule, type Schedule, type Slot } from './schedule';

/*
 * KPI ghi cho ca (chủ dự án 2026-10-30):
 * - KPI gắn với ID: ca nào SỞ HỮU một ID thì nhận toàn bộ KPI của ID đó, không có ID nửa ca này nửa ca kia.
 * - Không tính lặp trong một NGÀY làm việc: cùng ID upload nhiều lần trong ngày (kể cả ở ca khác của cùng ngày) chỉ tính một lần,
 *   cho ca đầu tiên của ngày đã làm ID đó; KPI của ID trong ngày tính trên mọi lần upload của ngày đó (gộp như một ca).
 * - Sửa lại ID ở một ngày SAU ngày đầu tiên làm ID đó → KPI rework: VẪN tính vào KPI của ca (chủ dự án 2026-10-30), chỉ hiện riêng để biết.
 * - KPI của ca OT có thể dồn sang ca sáng / chiều khác, kể cả ca sắp tới (tối đa 3 ngày tới); có thể chia nhỏ: đủ chỉ tiêu một ca
 *   thì dồn sang ca sau. Chỉ ID mà chính ca OT sở hữu mới dồn được.
 */

/** Ngày làm việc của ca (YYYY-MM-DD, giờ máy): OT trước giờ vào ca sáng thuộc ngày hôm trước (như `slotAt`). */
export function workDay(shift: Pick<Shift, 'start' | 'slot'>, sch: Schedule): string {
  const d = new Date(shift.start);
  const [h, m] = normalizeSchedule(sch).amStart.split(':').map(Number) as [number, number];
  const early = shift.slot === 'OT' && d.getHours() * 60 + d.getMinutes() < h * 60 + m;
  return ymd(early ? new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1) : d);
}
export const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Khoá của một ID: máy chủ (phạm vi kho, '' = máy chủ dữ liệu cũ) + job + ID database (object chưa có ID database: số thứ tự). */
export const idKeyOf = (origin: string | undefined, jobId: number, t: Pick<ShiftTrackRec, 'id' | 'num'>) => `${origin ?? ''}|${jobId}:${t.id > 0 ? t.id : `n${t.num}`}`;

export interface IdCredit {
  key: string; jobId: number; num: number; label: string;
  day: string; // ngày làm việc
  kpi: number;
  rework: boolean; // đã làm ID này ở một ngày trước đó
  source: string; // ca sở hữu tự nhiên (ca đầu tiên của ngày đã làm ID)
  owner: string; // ca nhận KPI (= source, trừ khi ca OT đã dồn ID này sang ca khác)
  firstTime: string; // lần upload đầu của ID trong ngày (sắp xếp)
}

/** Ngày đầu tiên làm từng ID, dựng từ các ca có sẵn (dùng khi kho chưa có sổ, hoặc bổ sung sổ). */
export function firstDays(shifts: readonly Shift[], sch: Schedule, into: Record<string, string> = {}): Record<string, string> {
  const out = { ...into };
  for (const s of shifts) {
    const day = workDay(s, sch);
    for (const u of s.uploads) for (const t of u.tracks) {
      const k = idKeyOf(u.origin, u.jobId, t);
      if (!out[k] || day < out[k]!) out[k] = day;
    }
  }
  return out;
}

/** KPI theo ID của mọi ca: gộp theo (ngày, ID), ca đầu tiên của ngày sở hữu, áp phân bổ của ca OT, đánh dấu rework theo sổ ngày đầu. */
export function creditAll(shifts: readonly Shift[], idDays: Record<string, string>, sch: Schedule): IdCredit[] {
  const ordered = [...shifts].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  const groups = new Map<string, { day: string; key: string; first: Shift; uploads: ShiftUpload[]; last: ShiftTrackRec; jobId: number; firstTime: string }>();
  for (const s of ordered) {
    const day = workDay(s, sch);
    for (const u of [...s.uploads].sort((a, b) => (a.time < b.time ? -1 : a.time > b.time ? 1 : 0))) {
      for (const t of u.tracks) {
        const key = idKeyOf(u.origin, u.jobId, t);
        const gk = `${day}|${key}`;
        let g = groups.get(gk);
        if (!g) groups.set(gk, (g = { day, key, first: s, uploads: [], last: t, jobId: u.jobId, firstTime: u.time }));
        g.uploads.push({ ...u, tracks: [{ ...t, num: 0 }] }); // num cố định: một ID dù số thứ tự hiển thị đổi giữa các lần upload
        g.last = t;
      }
    }
  }
  const out: IdCredit[] = [];
  for (const g of groups.values()) {
    const k = computeKpi({ ...g.first, uploads: g.uploads, touched: [] }).objects[0];
    if (!k) continue;
    const owner = g.first.assign?.[g.key] ?? g.first.name;
    const known = idDays[g.key];
    out.push({ key: g.key, jobId: g.jobId, num: g.last.num, label: g.last.label, day: g.day, kpi: k.kpi, rework: !!known && known < g.day, source: g.first.name, owner, firstTime: g.firstTime });
  }
  return out.sort((a, b) => (a.firstTime < b.firstTime ? -1 : a.firstTime > b.firstTime ? 1 : 0));
}

export interface ShiftCredit { kpi: number; rework: number; ids: IdCredit[]; fromOthers: number } // kpi: tổng (gồm rework); rework: phần rework trong đó
/** KPI ca `name` được nhận (kể cả ca chưa mở: KPI dồn từ OT). */
export function creditOf(credits: readonly IdCredit[], name: string): ShiftCredit {
  const ids = credits.filter((c) => c.owner === name);
  return {
    ids,
    kpi: ids.reduce((n, c) => n + c.kpi, 0),
    rework: ids.filter((c) => c.rework).reduce((n, c) => n + c.kpi, 0),
    fromOthers: ids.filter((c) => c.source !== name).length,
  };
}

export interface AllocTarget { name: string; slot: Slot; start: string; future: boolean }
const slotName = (d: Date, slot: Slot) => `${MONTHS[d.getMonth()]}${d.getDate()}${slot}`;
const atTime = (d: Date, hhmm: string) => { const [h, m] = hhmm.split(':').map(Number) as [number, number]; return new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m, 0, 0); };

/**
 * Ca sáng / chiều có thể nhận KPI dồn từ OT, theo thứ tự thời gian: các ca đã có trong `pastDays` ngày gần nhất (kể cả ca đang chạy)
 * và các ca sắp tới (chưa bắt đầu) tới hết `aheadDays` ngày sau hôm nay.
 */
export function allocTargets(shifts: readonly Shift[], now: Date, sch: Schedule, aheadDays = 3, pastDays = 7): AllocTarget[] {
  const s = normalizeSchedule(sch);
  const out: AllocTarget[] = [];
  const names = new Set<string>();
  const since = new Date(now.getFullYear(), now.getMonth(), now.getDate() - pastDays).toISOString();
  for (const x of shifts) {
    if (x.slot === 'OT' || x.start < since) continue;
    out.push({ name: x.name, slot: x.slot ?? 'AM', start: x.start, future: false });
    names.add(x.name);
  }
  for (let i = 0; i <= aheadDays; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + i);
    for (const [slot, start] of [['AM', s.amStart], ['PM', s.pmStart]] as const) {
      const at = atTime(d, start);
      const name = slotName(d, slot);
      if (at > now && !names.has(name)) { out.push({ name, slot, start: at.toISOString(), future: true }); names.add(name); }
    }
  }
  return out.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
}

/**
 * Gợi ý dồn các ID của ca OT (theo thứ tự đã làm) bắt đầu từ ca `targets[0]`:
 * - không chia: mọi ID vào `targets[0]`;
 * - chia: đổ vào ca hiện tại cho tới khi ca đó đạt chỉ tiêu (ID cuối có thể vượt một chút, ID không bị cắt đôi) rồi sang ca kế tiếp;
 *   hết ca để dồn thì ID còn lại giữ ở OT (null). KPI rework tính như KPI thường.
 * `current`: KPI ca đó đã có (không kể các ID đang được dồn).
 */
export function suggestAlloc(items: readonly IdCredit[], targets: readonly { name: string; current: number }[], target: number, split: boolean): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  if (!targets.length) { for (const c of items) out[c.key] = null; return out; }
  if (!split) { for (const c of items) out[c.key] = targets[0]!.name; return out; }
  let i = 0;
  let cur = targets[0]!.current;
  for (const c of items) {
    while (i < targets.length && cur >= target) { i++; cur = i < targets.length ? targets[i]!.current : 0; }
    if (i >= targets.length) { out[c.key] = null; continue; }
    out[c.key] = targets[i]!.name;
    cur += c.kpi;
  }
  return out;
}

/** Ca có làm việc thật (có upload / sửa / nhận gợi ý), dùng để đếm "ngày đi làm". */
const worked = (s: Shift) => s.uploads.length > 0 || s.edits > 0 || s.accepted > 0;

/**
 * Chỉ giữ KPI của hôm nay và `keepDays` NGÀY ĐI LÀM gần nhất trước đó (chủ dự án 2026-10-30): ngày không có ca nào làm việc thật không
 * được đếm. Ca cũ hơn bị bỏ, trừ ca OT đã dồn KPI sang một ca còn giữ (không thì ca nhận bị mất phần KPI đã dồn).
 * Sổ ngày đầu (`idDays`, để nhận ra rework) giữ riêng, không bị cắt theo.
 */
export function retainShifts(shifts: readonly Shift[], now: Date, sch: Schedule, keepDays = 3): Shift[] {
  const today = workDay({ start: now.toISOString(), slot: 'OT' }, sch); // trước giờ vào ca sáng vẫn là ngày hôm trước
  const days = [...new Set(shifts.filter(worked).map((s) => workDay(s, sch)).filter((d) => d < today))].sort().reverse();
  if (days.length <= keepDays) return [...shifts];
  const cutoff = days[keepDays - 1]!;
  const kept = shifts.filter((s) => workDay(s, sch) >= cutoff);
  const keptNames = new Set(kept.map((s) => s.name));
  return shifts.filter((s) => keptNames.has(s.name) || Object.values(s.assign ?? {}).some((to) => keptNames.has(to)));
}
