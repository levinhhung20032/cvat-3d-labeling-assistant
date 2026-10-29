import { strFromU8, unzipSync } from 'fflate';
import { findOverlaps, fmtIou } from './overlap';
import { ISSUE_KINDS, trackIssues, type IssueKind } from './qcrules';
import type { CvatTrack } from './types';

/**
 * Đối chiếu file báo cáo QC (.xlsx) với job: đọc sheet "Matrix" (hàng = Track ID, cột = frame, ô chứa ký hiệu
 * S/K/Z/H/O/D) thành danh sách flag. File chỉ được đọc trong trình duyệt, không gửi đi đâu.
 */
export interface QcFlag { num: number; frame: number; kind: IssueKind }
export interface QcImport { name: string; at: string; flags: QcFlag[] }
export type FlagMark = 'ignore' | 'fixed';

export const MAX_XLSX_BYTES = 20 * 1024 * 1024;

const decode = (s: string) =>
  s.replace(/&#x([0-9a-fA-F]+);/g, (_, h: string) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
const colIndex = (letters: string) => { let n = 0; for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64); return n - 1; };
const textOf = (xml: string) => decode([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));

/** Đường dẫn file sheet có tên `want` trong workbook (so tên không phân biệt hoa thường). */
function sheetPath(files: Record<string, Uint8Array>, want: string): string | null {
  const wb = files['xl/workbook.xml'], rels = files['xl/_rels/workbook.xml.rels'];
  if (!wb || !rels) return null;
  let rid: string | null = null;
  for (const m of strFromU8(wb).matchAll(/<sheet\b([^>]*)\/?>/g)) {
    const name = /\bname="([^"]*)"/.exec(m[1]!)?.[1];
    if (name !== undefined && decode(name).trim().toLowerCase() === want.toLowerCase()) rid = /\br:id="([^"]*)"/.exec(m[1]!)?.[1] ?? null;
  }
  if (!rid) return null;
  for (const m of strFromU8(rels).matchAll(/<Relationship\b([^>]*)\/?>/g)) {
    if (/\bId="([^"]*)"/.exec(m[1]!)?.[1] !== rid) continue;
    const target = /\bTarget="([^"]*)"/.exec(m[1]!)?.[1];
    if (!target) return null;
    return target.startsWith('/') ? target.slice(1) : 'xl/' + target;
  }
  return null;
}

/** Đọc sheet thành lưới chuỗi (hàng → cột → văn bản); hỗ trợ chuỗi inline lẫn sharedStrings. */
function readGrid(files: Record<string, Uint8Array>, path: string): string[][] {
  const shared: string[] = files['xl/sharedStrings.xml']
    ? [...strFromU8(files['xl/sharedStrings.xml']).matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]!))
    : [];
  const xml = strFromU8(files[path]!);
  const grid: string[][] = [];
  for (const row of xml.matchAll(/<row\b[^>]*?(?:\br="(\d+)")?[^>]*>([\s\S]*?)<\/row>/g)) {
    const r = Number(row[1] ?? grid.length + 1) - 1;
    const cells: string[] = [];
    for (const c of row[2]!.matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const ref = /\br="([A-Z]+)\d+"/.exec(c[1]!)?.[1];
      if (!ref || !c[2]) continue;
      const type = /\bt="([^"]*)"/.exec(c[1]!)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c[2]);
      cells[colIndex(ref)] = type === 's' ? shared[Number(v?.[1])] ?? '' : type === 'inlineStr' ? textOf(c[2]) : decode(v?.[1] ?? textOf(c[2]));
    }
    grid[r] = cells;
  }
  return grid;
}

/**
 * Đọc một sheet của file xlsx thành lưới chuỗi. Ưu tiên sheet có tên trong `names` (theo thứ tự), không có thì lấy sheet đầu tiên.
 * Dùng chung cho nhập ghi chú QC (QC note import) và đối chiếu (QC comparison).
 */
export function readSheetGrid(bytes: Uint8Array, names: string[]): { ok: true; grid: string[][]; sheet: string } | { ok: false; message: string } {
  if (bytes.length > MAX_XLSX_BYTES) return { ok: false, message: 'File quá lớn (tối đa 20 MB).' };
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name) }); }
  catch { return { ok: false, message: 'Không đọc được file: không phải .xlsx hợp lệ.' }; }
  for (const n of names) {
    const path = sheetPath(files, n);
    if (path && files[path]) return { ok: true, grid: readGrid(files, path), sheet: n };
  }
  const first = Object.keys(files).filter((k) => k.startsWith('xl/worksheets/')).sort()[0];
  if (!first) return { ok: false, message: 'File không có sheet nào.' };
  return { ok: true, grid: readGrid(files, first), sheet: first.split('/').pop()! };
}

export type ParseResult = { ok: true; flags: QcFlag[]; tracks: number } | { ok: false; message: string };

/** Đọc các flag từ sheet Matrix. Dòng tiêu đề là dòng có ô đầu "Track ID"; các cột sau đó có tiêu đề là số frame. */
export function parseQcMatrix(bytes: Uint8Array): ParseResult {
  if (bytes.length > MAX_XLSX_BYTES) return { ok: false, message: 'File quá lớn (tối đa 20 MB).' };
  let files: Record<string, Uint8Array>;
  try { files = unzipSync(bytes, { filter: (f) => /^xl\/(workbook\.xml|_rels\/workbook\.xml\.rels|sharedStrings\.xml|worksheets\/[^/]+\.xml)$/.test(f.name) }); }
  catch { return { ok: false, message: 'Không đọc được file: không phải .xlsx hợp lệ.' }; }
  const path = sheetPath(files, 'Matrix');
  if (!path || !files[path]) return { ok: false, message: 'Không thấy sheet "Matrix" trong file.' };
  const grid = readGrid(files, path);
  const h = grid.findIndex((r) => r && (r[0] ?? '').trim().toLowerCase() === 'track id');
  if (h < 0) return { ok: false, message: 'Sheet Matrix không có dòng tiêu đề "Track ID".' };
  const frameOfCol = new Map<number, number>();
  (grid[h] ?? []).forEach((t, c) => { if (c >= 1 && t !== undefined && /^\d+$/.test(t.trim())) frameOfCol.set(c, Number(t.trim())); });
  if (!frameOfCol.size) return { ok: false, message: 'Sheet Matrix không có cột frame (tiêu đề dạng số 0, 1, 2…).' };
  const flags: QcFlag[] = [];
  const seen = new Set<number>();
  for (const row of grid.slice(h + 1)) {
    if (!row) continue;
    const num = Number((row[0] ?? '').trim());
    if (!Number.isInteger(num) || num < 1) continue;
    seen.add(num);
    for (const [c, frame] of frameOfCol) {
      const t = (row[c] ?? '').trim().toUpperCase();
      if (!t) continue;
      for (const kind of ISSUE_KINDS) if (t.includes(kind)) flags.push({ num, frame, kind });
    }
  }
  return { ok: true, flags, tracks: seen.size };
}

export const flagKey = (jobId: number, f: QcFlag) => `${jobId}:${f.num}:${f.frame}:${f.kind}`;

/** Mọi vi phạm hiện có theo luật của tool (S K Z H D + O chéo giữa các object): khóa `num:frame:kind` → mô tả. */
export function detectAll(tracks: CvatTrack[], labels: string[], start: number, stop: number): Map<string, string> {
  const out = new Map<string, string>();
  const frames = Array.from({ length: stop - start + 1 }, (_, i) => start + i);
  tracks.forEach((t, i) => {
    for (const [f, list] of trackIssues(t, labels[i] ?? '', frames, undefined, i + 1)) for (const it of list) out.set(`${i + 1}:${f}:${it.kind}`, it.message);
  });
  for (const o of findOverlaps(tracks, frames, labels)) {
    out.set(`${o.a}:${o.frame}:O`, `chồng với #${o.b} (IoU ${fmtIou(o.ratio)})`);
    out.set(`${o.b}:${o.frame}:O`, `chồng với #${o.a} (IoU ${fmtIou(o.ratio)})`);
  }
  return out;
}

export type FlagState = 'open' | 'cleared' | 'ignore' | 'fixed';
/** Trạng thái một flag: người dùng đã đánh dấu thì theo đó; không thì "còn" nếu tool vẫn thấy lỗi, "đã hết" nếu không còn. */
export const flagState = (mark: FlagMark | undefined, detected: boolean): FlagState => mark ?? (detected ? 'open' : 'cleared');
