/**
 * Bố cục các nhóm điều khiển ở đầu tab Batch Review, do người dùng tự sắp: các hàng, mỗi hàng một dãy nhóm có tỉ lệ bề rộng
 * (fr) và chiều cao tuỳ chọn (null = theo nội dung). Chỉ là tiện ích giao diện, lưu cục bộ; hỏng thì về mặc định.
 */
export interface LayoutRow { ids: string[]; w: number[]; h: number | null }
export type CtlLayout = LayoutRow[];
export type DropSide = 'l' | 'r' | 't' | 'b';

/** Id các nhóm (khớp `<Group id>` trong BatchReview). */
export const GROUP_IDS = ['3', '4', '5', '1', '6', '2'];
export const W_MIN = 0.1, W_MAX = 20;
export const H_MIN = 40, H_MAX = 2000;

export const DEFAULT_LAYOUT: CtlLayout = [
  { ids: ['3', '4'], w: [1, 1], h: null },
  { ids: ['5', '1'], w: [1, 1], h: null },
  { ids: ['6', '2'], w: [1, 1.5], h: null },
];

const clamp = (x: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, x));

/** Đọc bố cục đã lưu: mỗi nhóm đúng một lần; id lạ / trùng bị bỏ; nhóm thiếu (bản mới thêm nhóm) thêm thành hàng cuối. */
export function parseLayout(x: unknown, ids: readonly string[] = GROUP_IDS): CtlLayout {
  if (!Array.isArray(x)) return DEFAULT_LAYOUT;
  const seen = new Set<string>();
  const rows: CtlLayout = [];
  for (const r of x) {
    if (!r || typeof r !== 'object') continue;
    const { ids: rid, w, h } = r as Partial<LayoutRow>;
    if (!Array.isArray(rid)) continue;
    const row: LayoutRow = { ids: [], w: [], h: typeof h === 'number' && Number.isFinite(h) ? clamp(Math.round(h), H_MIN, H_MAX) : null };
    rid.forEach((id, i) => {
      if (typeof id !== 'string' || !ids.includes(id) || seen.has(id)) return;
      seen.add(id);
      const wi = Array.isArray(w) ? w[i] : undefined;
      row.ids.push(id);
      row.w.push(typeof wi === 'number' && Number.isFinite(wi) ? clamp(wi, W_MIN, W_MAX) : 1);
    });
    if (row.ids.length) rows.push(row);
  }
  const missing = ids.filter((id) => !seen.has(id));
  if (missing.length) rows.push({ ids: missing, w: missing.map(() => 1), h: null });
  return rows;
}

/** Chuyển nhóm `id` tới cạnh `side` của nhóm `target`: trái / phải = cùng hàng, trên / dưới = hàng mới riêng. */
export function moveGroup(l: CtlLayout, id: string, target: string, side: DropSide): CtlLayout {
  if (id === target) return l;
  let rows = l.map((r) => ({ ...r, ids: [...r.ids], w: [...r.w] }));
  const from = rows.find((r) => r.ids.includes(id));
  if (!from || !rows.some((r) => r.ids.includes(target))) return l;
  const i = from.ids.indexOf(id);
  from.ids.splice(i, 1);
  from.w.splice(i, 1);
  rows = rows.filter((r) => r.ids.length);
  const ri = rows.findIndex((r) => r.ids.includes(target));
  const row = rows[ri]!;
  if (side === 't' || side === 'b') {
    rows.splice(side === 't' ? ri : ri + 1, 0, { ids: [id], w: [1], h: null });
  } else {
    const p = row.ids.indexOf(target) + (side === 'r' ? 1 : 0);
    const avg = row.w.reduce((a, b) => a + b, 0) / row.w.length;
    row.ids.splice(p, 0, id);
    row.w.splice(p, 0, avg);
  }
  return rows;
}

/**
 * Kéo vạch giữa nhóm i và i+1 của hàng r đi `dxFrac` (phần của tổng bề rộng hàng): đổi tỉ lệ của đúng hai nhóm đó, tổng giữ nguyên,
 * mỗi nhóm không hẹp hơn `minFrac` của hàng.
 */
export function resizeSplit(l: CtlLayout, r: number, i: number, dxFrac: number, minFrac = 0.08): CtlLayout {
  const row = l[r];
  if (!row || i < 0 || i + 1 >= row.ids.length) return l;
  const sum = row.w.reduce((a, b) => a + b, 0);
  const pair = row.w[i]! + row.w[i + 1]!;
  const lo = minFrac * sum, hi = pair - lo;
  if (hi < lo) return l;
  const a = clamp(row.w[i]! + dxFrac * sum, lo, hi);
  const w = [...row.w];
  w[i] = a;
  w[i + 1] = pair - a;
  return l.map((x, k) => (k === r ? { ...x, w } : x));
}

/** Đặt chiều cao hàng r (null = theo nội dung). */
export function setRowHeight(l: CtlLayout, r: number, h: number | null): CtlLayout {
  return l.map((x, k) => (k === r ? { ...x, h: h === null ? null : clamp(Math.round(h), H_MIN, H_MAX) } : x));
}
