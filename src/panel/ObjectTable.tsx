import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { askConfirm } from './confirmStore';
import type { ObjectRow } from '../shared/table';
import type { CvatLabel, CvatTrack } from '../shared/types';
import { sortedShapes, stateAt } from '../shared/interp';
import { getAttr, parseLabelSpecs } from '../shared/attributes';
import { DEFAULT_GROUND } from '../shared/ground';
import { ISSUE_NAMES } from '../shared/qcrules';
import { sym, symLabel, useSymbols } from './symbolStore';
import { fmtIou, type OverlapPair } from '../shared/overlap';
import { PENDING_STYLE } from './ui';
import { seenStore, useSeen } from './seenStore';
import { scrollToTopOfPanel } from './scrollTo';
import { onAction, useKeyHint } from './actions';
import { clientIdOf, useCvatIdVersion } from './cvatIds';
import { findLateStart } from '../shared/splitId';

/** ID đã xem trong Batch Review: gạch chân. */
const SEEN_STYLE = { textDecoration: 'underline', textDecorationThickness: 2, textUnderlineOffset: 2 } as const;

type SortKey = 'num' | 'assigned' | 'outside' | 'missing' | 'jumps' | 'issues' | 'drift' | 'overlap' | 'dist';
/** Dòng đang chọn và dòng so le (giao diện tối / xám đảo màu cả trang nên màu sáng vẫn dùng được). */
const SEL_BG = '#bcd7ff';
/** Ô có flag (thiếu keyframe outside, đi xa bất thường, lỗi luật, trôi box, chồng lấn, gợi ý attribute): nền cam nhạt, đè lên màu dòng (kể cả dòng đang chọn). */
const FLAG_CELL: React.CSSProperties = { background: '#ffd9a8' };
const ODD_BG = '#f1f4f8';
// Tiêu đề cột dính ngay dưới thanh đầu trang (.cvla-head) khi cuộn xuống; `top` do ObjectTable đo; nền đặc để dòng bên dưới không lộ ra.
const HEAD_CELL: React.CSSProperties = { position: 'sticky', top: 0, zIndex: 5, background: '#fff', boxShadow: '0 1px 0 #c5ccd6' };
/** Khoảng cách tâm box tới ego (gốc toạ độ, trên mặt phẳng ngang) và frame đo. */
interface Dist { d: number; frame: number }

const KIND_NAMES: Record<string, string> = { ...ISSUE_NAMES, W: 'Ít điểm ở giữa (frame ít điểm nằm giữa hai frame ổn, box nội suy; không tính là P)', P: 'Ít điểm trong box (theo ngưỡng ở tab Threshold, chỉ các frame đã tải point cloud)', T: 'Trôi box', M: 'Đi xa bất thường' };
/** Tooltip cột luật QC: số frame lỗi theo từng mã. */
const issueTip = (by: Record<string, number>) => {
  const lines = Object.entries(by).filter(([, n]) => n > 0).map(([k, n]) => `${symLabel(k)} — ${KIND_NAMES[k] ?? k}: ${n} frame`);
  return lines.length ? lines.join(String.fromCharCode(10)) : 'Không có lỗi luật QC';
};

/** Cờ cảnh báo của một object (tính khi mở menu chuột phải): frame đi xa (lỗi D), frame ít điểm, và cờ sớm nhất (kind: motion / sparse / drift / overlap hoặc mã lỗi luật). */
export interface ObjFlags { far: number[]; motion: number[]; sparse: number[]; mid: number[]; rules: [string, number[]][]; drift: number[]; overlapWith: number[]; first: { frame: number; kind: string } | null; pending: boolean }

export function ObjectTable({ jobId, onRelocate, locked, onLock, onUnlock, flagsOf, onIgnoreKind, onIgnoreAll, onOutside, onAcceptHints, onIgnoreMotion, onIgnoreMid, onOpenAt, rows, hints, overlapFrames, overlapPairs, onOpen, onSelect, selectedNum, onDelete, incomplete, tracks, labels: jobLabels, start, stop, cvatFrame }: {
  jobId: number;
  locked: readonly number[] | null; onLock: () => void; onUnlock: () => void; // khóa danh sách ID gốc (không xóa được)
  onRelocate: (num: number) => void; // thêm outside phía trước cho object xuất hiện muộn (giữ ID)
  flagsOf: (num: number) => ObjFlags; // menu chuột phải: cờ cảnh báo của object
  onOutside: (num: number, kind: 'far' | 'sparse') => void; // outside toàn bộ frame đi xa (lỗi D) / ít điểm của object
  onAcceptHints: (num: number) => void; // chấp nhận mọi gợi ý attribute của object
  onIgnoreAll: (num: number) => void; // bỏ qua toàn bộ flag của object
  onIgnoreKind: (num: number, kind: string) => void; // bỏ qua một loại lỗi ở mọi frame của object: 'far' (D), 'sparse' (ít điểm P) hoặc mã lỗi luật
  onIgnoreMid: (num: number) => void; // bỏ qua cảnh báo ít điểm (P) ở các frame nằm giữa hai frame ổn của object
  onIgnoreMotion: (num: number) => void; // bỏ qua lỗi đi xa bất thường (Y) ở mọi frame của object
  onOpenAt: (num: number, frame: number) => void; // mở Batch Review của object ở frame cho trước
  labels: CvatLabel[];
  selectedNum: number | null; onSelect: (num: number) => void; // bấm 1 lần: chọn dòng (chọn object); bấm đúp: mở Batch Review (onOpen)
  onDelete: (r: ObjectRow) => void; rows: ObjectRow[]; hints: Map<number, number>; overlapFrames: Map<number, number>; overlapPairs: OverlapPair[]; onOpen: (num: number, first: number | null) => void;
  incomplete: ReadonlySet<number>; // object còn frame chưa tải / chưa tính ít điểm: ô "luật QC" (có phần ít điểm P) chưa đáng tin
  tracks: CvatTrack[]; start: number; stop: number;
  cvatFrame: number | null; // frame đang mở trên CVAT (nếu biết): mặc định đo khoảng cách tại frame này
}) {
  useCvatIdVersion(); // ID lấy từ CVAT đổi → vẽ lại bảng
  useSymbols();
  const hint = useKeyHint();
  const [label, setLabel] = useState('');
  // Menu chuột phải: tác động lên đúng dòng (object) được bấm, không đổi dòng đang chọn. Toạ độ tính theo khung bọc bảng (không dùng fixed vì chế độ tối đảo màu cả trang bằng filter).
  const wrapRef = useRef<HTMLDivElement>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; row: ObjectRow; flags: ObjFlags } | null>(null);
  const [sub, setSub] = useState<string | null>(null); // mục lỗi đang mở menu con (hover)
  useEffect(() => { setSub(null); }, [ctx]);
  useEffect(() => {
    if (!ctx) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setCtx(null); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [ctx]);
  const seen = useSeen(jobId);
  const [sort, setSort] = useState<SortKey>('num');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyJumps, setOnlyJumps] = useState(false);
  const [onlyHints, setOnlyHints] = useState(false);
  const [onlyMade, setOnlyMade] = useState(false);
  const [onlyOverlap, setOnlyOverlap] = useState(false);
  // Khoảng cách tới ego: tại một frame (mặc định frame đang mở trên CVAT) hoặc gần nhất trên cả track. Bấm tiêu đề cột lần nữa để đảo chiều.
  const [distMode, setDistMode] = useState<'frame' | 'min'>('frame');
  const [distFrame, setDistFrame] = useState(cvatFrame ?? start);
  const [distAsc, setDistAsc] = useState(true);
  useEffect(() => { if (cvatFrame !== null) setDistFrame(cvatFrame); }, [cvatFrame]);
  const dist = useMemo(() => {
    const out = new Map<number, Dist>();
    const at = (t: CvatTrack, f: number) => { const c = stateAt(t, f).cuboid; return c ? Math.hypot(c.x, c.y) : null; };
    tracks.forEach((t, i) => {
      if (distMode === 'frame') {
        const d = at(t, distFrame);
        if (d !== null) out.set(i + 1, { d, frame: distFrame });
        return;
      }
      let best: Dist | null = null;
      for (let f = start; f <= stop; f++) {
        const d = at(t, f);
        if (d !== null && (!best || d < best.d)) best = { d, frame: f };
      }
      if (best) out.set(i + 1, best);
    });
    return out;
  }, [tracks, start, stop, distMode, distFrame]);
  // Object không có box ở frame đo luôn nằm cuối, dù sắp tăng hay giảm.
  const byDist = (a: ObjectRow, b: ObjectRow) => {
    const x = dist.get(a.num)?.d, y = dist.get(b.num)?.d;
    if (x === undefined || y === undefined) return x === undefined ? (y === undefined ? a.num - b.num : 1) : -1;
    return distAsc ? x - y : y - x;
  };
  // Attribute của từng object: attribute tĩnh lấy giá trị của track; attribute đổi theo frame liệt kê các giá trị lần lượt xuất hiện ở các keyframe có box.
  const attrsOf = useMemo(() => {
    const specs = parseLabelSpecs(jobLabels);
    const out = new Map<number, { name: string; value: string }[]>();
    tracks.forEach((t, i) => {
      const keys = sortedShapes(t).filter((s) => !s.outside).map((s) => s.frame);
      out.set(i + 1, (specs.get(t.label_id)?.attrs ?? []).map((a) => {
        if (!a.mutable || !keys.length) return { name: a.name, value: getAttr(t, keys[0] ?? 0, a) ?? a.def };
        const seq: string[] = [];
        for (const f of keys) { const v = getAttr(t, f, a) ?? a.def; if (seq[seq.length - 1] !== v) seq.push(v); }
        return { name: a.name, value: seq.join(' → ') };
      }));
    });
    return out;
  }, [tracks, jobLabels]);
  // Mở bảng (vd. từ Batch Review): cuộn để object đang chọn nằm ở đầu trang, dòng đã được tô sáng như vừa bấm 1 lần.
  const selRow = useRef<HTMLTableRowElement>(null);
  useLayoutEffect(() => { scrollToTopOfPanel(selRow.current, tableRef.current?.tHead?.getBoundingClientRect().height ?? 0); }, []); // trừ cả dòng tên cột dính dưới thanh đầu, nếu không dòng đang chọn bị nó che
  // Object xuất hiện giữa chừng (chưa có keyframe nào từ frame đầu job): tô cam ô "Khoảng frame" để nhắc thêm outside phía trước.
  const lateOf = useMemo(() => {
    const m = new Map<number, number>();
    tracks.forEach((t, i) => { const l = findLateStart(t, start, stop); if (l) m.set(i + 1, l.first); });
    return m;
  }, [tracks, start, stop]);
  const ov = (r: ObjectRow) => overlapFrames.get(r.num) ?? 0;
  const h = (r: ObjectRow) => hints.get(r.num) ?? 0;
  const labels = useMemo(() => [...new Set(rows.map((r) => r.label))], [rows]);
  const shown = useMemo(() => {
    const r = rows.filter((x) => (!label || x.label === label) && (!onlyMissing || x.missing > 0) && (!onlyJumps || x.jumps > 0) && (!onlyMade || x.made !== null) && (!onlyHints || h(x) > 0) && (!onlyOverlap || ov(x) > 0));
    return r.sort((a, b) => (sort === 'num' ? a.num - b.num : sort === 'dist' ? byDist(a, b) : sort === 'overlap' ? ov(b) - ov(a) : b[sort] - a[sort]));
  }, [rows, hints, overlapFrames, label, sort, onlyMissing, onlyJumps, onlyHints, onlyOverlap, onlyMade, dist, distAsc]);
  // Flag: object có ít nhất một ô được tô (cột thiếu KF outside, đi xa, luật QC, trôi box, chồng lấn, và gợi ý attribute `!`).
  const flagged = (r: ObjectRow) => r.missing > 0 || r.jumps > 0 || r.issues > 0 || r.drift > 0 || ov(r) > 0 || h(r) > 0;
  const flagCount = useMemo(() => shown.filter(flagged).length, [shown, overlapFrames, hints]);
  const [flagNote, setFlagNote] = useState('');
  const pendingScroll = useRef(false);
  /** Nhảy tới object có flag kế tiếp (theo thứ tự đang hiển thị, sau dòng đang chọn; hết thì quay vòng): chọn dòng đó và cuộn tới. */
  const nextFlag = () => {
    const cur = shown.findIndex((r) => r.num === selectedNum);
    for (let k = 1; k <= shown.length; k++) {
      const r = shown[((cur < 0 ? -1 : cur) + k) % shown.length]!;
      if (!flagged(r)) continue;
      if (r.num === selectedNum) { setFlagNote('Chỉ còn object này có flag.'); return; }
      setFlagNote('');
      pendingScroll.current = true;
      onSelect(r.num);
      return;
    }
    setFlagNote('Không có object nào có flag trong danh sách đang hiển thị.');
  };
  const nextFlagRef = useRef(nextFlag);
  nextFlagRef.current = nextFlag;
  useEffect(() => onAction((id) => { if (id === 'table.nextFlag') nextFlagRef.current(); }), []);
  // Sau khi chọn: cuộn dòng mới chọn vào vùng nhìn, dưới thanh đầu dính và dòng tên cột dính (nếu đã nhìn thấy rõ thì không cuộn).
  useEffect(() => {
    if (!pendingScroll.current) return;
    pendingScroll.current = false;
    const el = selRow.current;
    if (!el) return;
    const doc = el.ownerDocument;
    const headH = (el.getRootNode() as Document | ShadowRoot).querySelector<HTMLElement>('.cvla-head')?.getBoundingClientRect().height ?? 0;
    const theadH = tableRef.current?.tHead?.getBoundingClientRect().height ?? 0;
    const r = el.getBoundingClientRect();
    if (r.top < headH + theadH + 4 || r.bottom > (doc.defaultView?.innerHeight ?? 800)) el.scrollIntoView({ block: 'center' });
  }, [selectedNum]);
  // Đo chiều cao thanh đầu trang cố định để tiêu đề cột dính ngay dưới nó (đổi khi thanh đầu trang xuống dòng).
  const tableRef = useRef<HTMLTableElement>(null);
  const [headTop, setHeadTop] = useState(0);
  useLayoutEffect(() => {
    const head = (tableRef.current?.getRootNode() as Document | ShadowRoot | undefined)?.querySelector?.('.cvla-head') as HTMLElement | null | undefined;
    if (!head) return;
    const upd = () => setHeadTop(Math.round(head.getBoundingClientRect().height));
    upd();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(upd);
    ro.observe(head);
    return () => ro.disconnect();
  }, []);
  const headCell: React.CSSProperties = { ...HEAD_CELL, top: headTop };
  const th = (k: SortKey, text: string, title?: string) => (
    <th style={{ ...headCell, cursor: 'pointer', textAlign: 'left' }} onClick={() => { if (k === 'dist' && sort === 'dist') setDistAsc((x) => !x); else { setSort(k); if (k === 'dist') setDistAsc(true); } }} title={title}>{text}{sort === k ? (k === 'dist' && distAsc ? ' ▴' : ' ▾') : ''}</th>
  );
  const far = DEFAULT_GROUND.maxRange;
  const pendingTip = 'Chưa đủ dữ liệu: object còn frame đang tải ngầm / chưa tính ít điểm (P), con số có thể còn tăng; viền vàng tự mất khi tính xong.';
  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ marginBottom: 6 }}>
        Nhãn: <select value={label} onChange={(e) => setLabel(e.target.value)}>
          <option value="">tất cả</option>
          {labels.map((l) => <option key={l}>{l}</option>)}
        </select>{' '}
        <label><input type="checkbox" checked={onlyMissing} onChange={(e) => setOnlyMissing(e.target.checked)} /> chỉ ID thiếu keyframe outside</label>{' '}
        <label title="Object có frame bị cảnh báo vật đi xa bất thường so với các frame trước"><input type="checkbox" checked={onlyJumps} onChange={(e) => setOnlyJumps(e.target.checked)} /> chỉ ID có cảnh báo đi xa</label>{' '}
        <label title="Object do chính tool tạo (xanh lá: trong nháp, xanh dương: đã upload); chỉ loại này xóa được"><input type="checkbox" checked={onlyMade} onChange={(e) => setOnlyMade(e.target.checked)} /> chỉ object do tool tạo</label>{' '}
        <label title="Object có thuộc tính (attribute) khác với gợi ý theo kích thước box"><input type="checkbox" checked={onlyHints} onChange={(e) => setOnlyHints(e.target.checked)} /> chỉ ID có gợi ý thuộc tính</label>{' '}
        <label title="Object chồng lên object khác (xét chéo giữa các ID) ở ít nhất một frame"><input type="checkbox" checked={onlyOverlap} onChange={(e) => setOnlyOverlap(e.target.checked)} /> chỉ ID có chồng lấn</label>{' '}
        — {shown.length}/{rows.length} object{' '}
        <button onClick={nextFlag} disabled={flagCount === 0} title={hint('table.nextFlag', 'Nhảy tới object có flag tiếp theo (ô cảnh báo tô cam): chọn dòng đó và cuộn tới; hết danh sách thì quay vòng')}>⚑ Flag tiếp{flagCount ? ` (${flagCount} object)` : ''}</button>
        {flagNote && <span style={{ color: '#7a4b00', marginLeft: 6 }}>{flagNote}</span>}
        <span style={{ color: '#777', fontSize: 11, marginLeft: 8 }}>bấm 1 lần để chọn dòng, bấm đúp để mở Batch Review</span>
        <span style={{ marginLeft: 10 }}>
          {locked ? (
            <>
              <b style={{ color: '#7a4b00' }} title="ID gốc đã khóa: không xóa được, chỉ chỉnh sửa. Object ngoài danh sách (🔓) xóa được.">🔒 Đã khóa {locked.length} ID gốc</b>{' '}
              <button onClick={onUnlock} style={{ padding: '0 5px' }} title="Mở khóa: quay về chỉ xóa được object do tool tạo">mở khóa</button>
            </>
          ) : (
            <button onClick={onLock} style={{ padding: '0 5px' }} title="Chụp danh sách ID hiện có trên server làm ID gốc: các ID này không bao giờ xóa được; object ngoài danh sách (vẽ thêm trên CVAT hoặc tạo trên tool) xóa được">🔒 Khóa danh sách ID gốc</button>
          )}
        </span>
        {seen.size > 0 && (
          <span style={{ marginLeft: 10 }} title="ID gạch chân = object đã mở xem trong Batch Review (lưu theo job)">
            <span style={SEEN_STYLE}>ID</span> đã xem: {rows.filter((r) => seen.has(r.id)).length}{' '}
            <button onClick={() => { void askConfirm({ title: 'Bỏ đánh dấu đã xem', message: 'Bỏ đánh dấu "đã xem" của mọi object trong job này?', confirmLabel: 'Bỏ đánh dấu' }).then((ok) => { if (ok) seenStore.clear(jobId); }); }} style={{ padding: '0 5px' }}>↺ bỏ đánh dấu</button>
          </span>
        )}
      </div>
      <div style={{ marginBottom: 6 }} title="Khoảng cách từ ego (gốc toạ độ) tới tâm box, trên mặt phẳng ngang. Bấm tiêu đề cột 📏 để sắp xếp gần → xa, bấm lần nữa để đảo chiều.">
        📏 Khoảng cách tới ego:{' '}
        <select value={distMode} onChange={(e) => setDistMode(e.target.value as 'frame' | 'min')}>
          <option value="frame">tại frame</option>
          <option value="min">gần nhất trên cả track</option>
        </select>{' '}
        {distMode === 'frame' && (
          <>
            <input type="number" min={start} max={stop} value={distFrame} style={{ width: 64 }}
              onChange={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) setDistFrame(Math.min(stop, Math.max(start, v))); }} />
            {cvatFrame !== null && cvatFrame !== distFrame && <button onClick={() => setDistFrame(cvatFrame)} title="Đo tại frame đang mở trên CVAT">↺ frame CVAT ({cvatFrame})</button>}
          </>
        )}
      </div>
      <table ref={tableRef} style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{th('num', 'ID')}<th style={{ ...headCell, textAlign: 'left' }}>Nhãn</th><th style={{ ...headCell, textAlign: 'left' }} title="Attribute của object; attribute đổi theo frame hiện các giá trị lần lượt (a → b)">Attribute</th>{th('assigned', 'Được gán')}{th('outside', 'Outside')}{th('missing', 'Outside thiếu KF')}{th('jumps', '⚠ đi xa')}{th('issues', incomplete.size ? '⚠ luật QC ⏳' : '⚠ luật QC', incomplete.size ? `${incomplete.size} object chưa đủ dữ liệu (viền vàng). ${pendingTip}` : undefined)}{th('drift', '⚠ trôi box')}{th('overlap', '⚠ chồng lấn')}{th('dist', '📏 cách ego (m)', distMode === 'frame' ? `Khoảng cách tới ego tại frame ${distFrame}; — = không có box ở frame đó (luôn xếp cuối)` : 'Khoảng cách gần nhất tới ego trên cả track')}<th style={{ ...headCell, textAlign: 'left' }}>Khoảng frame</th><th style={headCell}>KF</th><th style={headCell} /></tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr
              key={r.num} ref={r.num === selectedNum ? selRow : undefined} onClick={() => onSelect(r.num)} onDoubleClick={() => onOpen(r.num, r.first)} aria-selected={r.num === selectedNum}
              onContextMenu={(e) => {
                e.preventDefault();
                const b = wrapRef.current?.getBoundingClientRect();
                setCtx({ x: e.clientX - (b?.left ?? 0), y: e.clientY - (b?.top ?? 0), row: r, flags: flagsOf(r.num) });
              }}
              style={{ cursor: 'pointer', userSelect: 'none', borderTop: '1px solid #ddd', background: r.num === selectedNum ? SEL_BG : r.made === 'draft' ? '#dff5df' : r.made === 'server' ? '#e3ecff' : i % 2 ? ODD_BG : undefined }}
            >
              <td><b style={seen.has(r.id) ? SEEN_STYLE : undefined} title={seen.has(r.id) ? 'Đã xem trong Batch Review' : undefined}>{clientIdOf(tracks, r.num)}</b>{clientIdOf(tracks, r.num) !== r.num ? <span style={{ color: '#999', fontSize: 10 }} title="Số thứ tự trong tool (CVAT đã cấp ID khác)"> (#{r.num})</span> : null} {r.made === 'draft' ? <span title="Object do tool tạo, đang trong NHÁP (chưa có trên CVAT)" style={{ background: '#2e9d3b', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🛠 mới</span> : r.ext ? <span title="Object có trên server nhưng NGOÀI danh sách ID gốc đã khóa: xóa được" style={{ background: '#a05a00', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🔓 ngoài list</span> : r.made === 'server' ? <span title="Object do tool tạo và đã upload; xóa được bằng tool" style={{ background: '#2f5fd0', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🛠 tool</span> : <span style={{ color: "#999", fontSize: 10 }}>{locked?.includes(r.id) ? '🔒 ' : ''}db {r.id}</span>}</td><td>{r.label}</td>
              {(() => {
                const at = attrsOf.get(r.num) ?? [];
                return (
                  <td style={{ fontSize: 11, maxWidth: 260, ...(h(r) > 0 ? FLAG_CELL : null) }} title={at.map((a) => `${a.name} = ${a.value}`).join(String.fromCharCode(10)) || 'Nhãn này không có attribute'}>
                    {at.length ? at.map((a, j) => <span key={a.name}>{j > 0 && ', '}<span style={{ color: '#666' }}>{a.name}</span> {a.value || '—'}</span>) : <span style={{ color: '#999' }}>—</span>}
                    {h(r) > 0 && <b style={{ color: '#c2410c', marginLeft: 4, fontSize: 13 }} title={`Có ${h(r)} gợi ý đổi attribute ở object này (mở Batch Review để xem và áp)`}>!</b>}
                  </td>
                );
              })()}
              <td>{r.assigned}</td><td>{r.outside}</td>
              <td style={{ color: r.missing ? '#b00' : undefined, fontWeight: r.missing ? 700 : 400, ...(r.missing ? FLAG_CELL : null) }}>{r.missing}</td>
              <td style={{ color: r.jumps ? '#a05a00' : undefined, fontWeight: r.jumps ? 700 : 400, ...(r.jumps ? FLAG_CELL : null) }}>{r.jumps}</td>
              <td style={{ color: r.issues ? '#a0006e' : undefined, fontWeight: r.issues ? 700 : 400, ...(incomplete.has(r.num) ? PENDING_STYLE : r.issues ? FLAG_CELL : null) }} title={incomplete.has(r.num) ? `${pendingTip}\n${issueTip(r.issuesByKind)}` : issueTip(r.issuesByKind)}>{r.issues}</td>
              <td style={{ color: r.drift ? '#a0006e' : undefined, fontWeight: r.drift ? 700 : 400, ...(r.drift ? FLAG_CELL : null) }} title={r.drift ? `Toạ độ ego của box không đổi trong khi xe chạy (box đi theo xe), frame ${r.driftFrames.join(', ')}` : 'Không có trôi box'}>{r.drift}</td>
              <td style={{ color: ov(r) ? '#b45a00' : undefined, fontWeight: ov(r) ? 700 : 400, ...(ov(r) ? FLAG_CELL : null) }} title={overlapPairs.filter((p) => p.a === r.num || p.b === r.num).map((p) => `#${p.a}–#${p.b}: frame ${p.frames.join(', ')} (tối đa ${fmtIou(p.max)})`).join('\n')}>{ov(r)}</td>
              {(() => {
                const d = dist.get(r.num);
                return <td style={{ color: d && d.d > far ? '#999' : undefined }} title={d ? `${d.d.toFixed(2)} m tại frame ${d.frame}${d.d > far ? ` — ngoài ${far} m: không đo mặt đường` : ''}` : distMode === 'frame' ? `Không có box ở frame ${distFrame}` : 'Không có box'}>{d ? d.d.toFixed(1) : '—'}</td>;
              })()}
              <td style={lateOf.has(r.num) ? { ...FLAG_CELL, color: '#7a1f1f', fontWeight: 700 } : undefined} title={lateOf.has(r.num) ? `Xuất hiện muộn từ frame ${lateOf.get(r.num)} (frame đầu job ${start} chưa có keyframe): nên thêm keyframe outside phía trước (chuột phải → Outside phía trước, giữ ID)` : undefined}>{r.first === null ? '—' : `${r.first}–${r.last}`}{lateOf.has(r.num) && <span style={{ marginLeft: 4 }}>⚠</span>}</td><td>{r.keyframes}</td>
              <td>{r.made !== null && <button onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(r); }} title={r.made === 'draft' ? 'Xóa object này khỏi nháp (chưa lên CVAT nên không ảnh hưởng server)' : 'Xóa object do tool tạo khỏi CVAT (xác nhận ở màn hình upload)'}>🗑</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {ctx && (() => {
        const { row, flags: fl } = ctx;
        const close = () => setCtx(null);
        const run = (f: () => void) => () => { close(); f(); };
        const first = fl.first;
        const kindText = first ? (first.kind === 'motion' ? 'đi xa bất thường' : first.kind === 'sparse' ? 'ít điểm' : first.kind === 'drift' ? 'trôi box' : first.kind === 'overlap' ? 'chồng lấn' : `lỗi ${symLabel(first.kind)}`) : '';
        const nHints = h(row);
        const nFlags = fl.far.length + fl.sparse.length + fl.motion.length + fl.rules.reduce((s, [, fr]) => s + fr.length, 0) + fl.drift.length + fl.overlapWith.length;
        const wrapW = wrapRef.current?.getBoundingClientRect().width ?? 600;
        const flip = Math.min(ctx.x, wrapW - 280) + 280 + 230 > wrapW; // không đủ chỗ bên phải: menu con mở sang trái
        type Act = { label: string; title: string; run: () => void };
        const errs: { key: string; name: string; n: number; acts: Act[] }[] = [];
        if (fl.far.length) errs.push({ key: 'far', name: `Lỗi ${symLabel('D')} · quá xa`, n: fl.far.length, acts: [
          { label: '⛔ Outside frame đi xa', title: 'Đặt outside cho các frame lỗi D ở đầu / cuối track (có hộp xác nhận, hoàn tác được)', run: () => onOutside(row.num, 'far') },
          { label: '🚫 Bỏ qua lỗi này', title: 'Bỏ qua lỗi D ở mọi frame của object này', run: () => onIgnoreKind(row.num, 'far') },
        ] });
        if (fl.sparse.length) errs.push({ key: 'sparse', name: `Ít điểm${fl.pending ? ' ⏳' : ''}`, n: fl.sparse.length, acts: [
          { label: '🚫 Bỏ qua cảnh báo ít điểm', title: 'Bỏ qua cảnh báo ít điểm (P) ở mọi frame của object này. Hoàn lại từng frame ở Batch Review (chuột phải chip ít điểm).', run: () => onIgnoreKind(row.num, 'sparse') },
          ...(fl.mid.length ? [{ label: `🚫 Chỉ bỏ qua frame ở giữa (${fl.mid.length})`, title: 'Chỉ bỏ qua ít điểm ở các frame nằm giữa hai frame không ít điểm (box nội suy)', run: () => onIgnoreMid(row.num) }] : []),
          { label: '⛔ Outside frame ít điểm', title: 'Đặt outside cho các frame ít điểm ở đầu / cuối track (có hộp xác nhận, hoàn tác được)', run: () => onOutside(row.num, 'sparse') },
        ] });
        if (fl.motion.length) errs.push({ key: 'motion', name: 'Đi xa bất thường', n: fl.motion.length, acts: [
          { label: '🚫 Bỏ qua lỗi này', title: 'Bỏ qua lỗi đi xa bất thường (Y) ở mọi frame của object này', run: () => onIgnoreMotion(row.num) },
        ] });
        for (const [k, frs] of fl.rules) errs.push({ key: `rule:${k}`, name: `Lỗi ${symLabel(k)} · ${KIND_NAMES[k] ?? k}`, n: frs.length, acts: [
          { label: '🚫 Bỏ qua lỗi này', title: `Bỏ qua lỗi ${symLabel(k)} ở mọi frame của object này`, run: () => onIgnoreKind(row.num, k) },
        ] });
        if (nHints) errs.push({ key: 'attr', name: 'Gợi ý attribute', n: nHints, acts: [
          { label: '✔ Chấp nhận gợi ý', title: 'Chấp nhận mọi gợi ý attribute còn hiệu lực của object này, một lần hoàn tác', run: () => onAcceptHints(row.num) },
        ] });
        return (
          <>
            <div className="cvla-backdrop" onClick={close} onContextMenu={(e) => { e.preventDefault(); close(); }} />
            <div className="cvla-menu cvla-ctxmenu" role="menu" aria-label={`Menu object ${row.num}`} style={{ left: Math.max(0, Math.min(ctx.x, wrapW - 280)), top: ctx.y, right: 'auto' }}>
              <h4>Object #{row.num} · {row.label}</h4>
              <h4>Lỗi (rê chuột vào lỗi để chọn xử lý)</h4>
              <button role="menuitem" disabled={nFlags === 0} onClick={run(() => onIgnoreAll(row.num))} title="Bỏ qua mọi flag đang báo của object này: lỗi D, ít điểm, đi xa bất thường, lỗi luật, trôi box, chồng lấn (không gồm cảnh báo lệch; hoàn lại từng mục ở Batch Review)">🚫 Bỏ qua toàn bộ flag ({nFlags})</button>
              {errs.length === 0 && <div style={{ fontSize: 12, color: '#777', padding: '2px 4px' }}>Không có lỗi nào đang báo</div>}
              {errs.map((er) => (
                <div key={er.key} style={{ position: 'relative' }} onMouseEnter={() => setSub(er.key)}>
                  <button role="menuitem" aria-haspopup="menu" aria-expanded={sub === er.key} onClick={() => setSub(er.key)} style={{ width: '100%', display: 'flex', justifyContent: 'space-between', gap: 8, background: sub === er.key ? '#e8f0ff' : undefined }}>
                    <span>{er.name} ({er.n})</span><span aria-hidden>▸</span>
                  </button>
                  {sub === er.key && (
                    <div className="cvla-menu" role="menu" aria-label={er.name} style={{ top: -8, minWidth: 220, ...(flip ? { right: '100%', left: 'auto', marginRight: 2 } : { left: '100%', right: 'auto', marginLeft: 2 }) }}>
                      {er.acts.map((ac) => <button key={ac.label} role="menuitem" title={ac.title} onClick={run(ac.run)}>{ac.label}</button>)}
                    </div>
                  )}
                </div>
              ))}
              <button role="menuitem" disabled={!first} onClick={run(() => first && onOpenAt(row.num, first.frame))} title="Mở Batch Review của object, cửa sổ bắt đầu ở frame có cờ cảnh báo sớm nhất (lỗi luật gồm D, đi xa bất thường, ít điểm, trôi box, chồng lấn)">⚑ Nhảy tới cờ cảnh báo đầu tiên{first ? ` (frame ${first.frame}: ${kindText})` : ' (không có)'}</button>
              <button role="menuitem" disabled={!lateOf.has(row.num)} onClick={run(() => onRelocate(row.num))} title={lateOf.has(row.num) ? `Object xuất hiện từ frame ${lateOf.get(row.num)}: giữ ID, thêm keyframe outside ở mọi frame trước đó. Có hộp xác nhận, chỉ nằm trong nháp.` : 'Chỉ dùng được cho object xuất hiện muộn (chưa có keyframe nào từ frame đầu job)'}>⇢ Outside phía trước (xuất hiện muộn, giữ ID)</button>
              <hr />
              <button role="menuitem" onClick={run(() => onOpen(row.num, row.first))}>▶ Mở Batch Review (từ frame đầu)</button>
              <button role="menuitem" onClick={run(() => onSelect(row.num))} title="Chọn object này (CVAT chọn theo nếu đang bật đồng bộ)">◎ Chọn object trong tool và CVAT</button>
              <button role="menuitem" disabled={!(row.id > 0)} title={row.id > 0 ? undefined : 'Object mới trong nháp chưa có ID trên CVAT nên không đánh dấu được'} onClick={run(() => { if (seen.has(row.id)) seenStore.remove(jobId, row.id); else seenStore.add(jobId, row.id); })}>{seen.has(row.id) ? '↺ Bỏ đánh dấu đã xem' : '✓ Đánh dấu đã xem'}</button>
              <button role="menuitem" onClick={run(() => { try { void navigator.clipboard?.writeText(`#${row.num}`); } catch { /* bỏ qua */ } })}>⧉ Sao chép số thứ tự (#{row.num})</button>
              {row.made !== null && <button role="menuitem" className="cvla-danger" onClick={run(() => onDelete(row))}>🗑 {row.ext ? 'Xóa object ngoài list' : 'Xóa object do tool tạo'}</button>}
            </div>
          </>
        );
      })()}
    </div>
  );
}
