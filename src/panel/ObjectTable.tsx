import { useEffect, useMemo, useState } from 'react';
import type { ObjectRow } from '../shared/table';
import type { CvatLabel, CvatTrack } from '../shared/types';
import { sortedShapes, stateAt } from '../shared/interp';
import { getAttr, parseLabelSpecs } from '../shared/attributes';
import { DEFAULT_GROUND } from '../shared/ground';
import { ISSUE_NAMES } from '../shared/qcrules';
import { sym, useSymbols } from './symbolStore';
import { fmtIou, type OverlapPair } from '../shared/overlap';
import { PENDING_STYLE } from './ui';
import { seenStore, useSeen } from './seenStore';

/** ID đã xem trong Batch Review: gạch chân. */
const SEEN_STYLE = { textDecoration: 'underline', textDecorationThickness: 2, textUnderlineOffset: 2 } as const;

type SortKey = 'num' | 'assigned' | 'outside' | 'missing' | 'jumps' | 'issues' | 'drift' | 'overlap' | 'dist';
/** Dòng đang chọn và dòng so le (giao diện tối / xám đảo màu cả trang nên màu sáng vẫn dùng được). */
const SEL_BG = '#bcd7ff';
const ODD_BG = '#f1f4f8';
/** Khoảng cách tâm box tới ego (gốc toạ độ, trên mặt phẳng ngang) và frame đo. */
interface Dist { d: number; frame: number }

const KIND_NAMES: Record<string, string> = { ...ISSUE_NAMES, P: 'Ít điểm trong box (theo ngưỡng ở tab Threshold, chỉ các frame đã tải point cloud)', T: 'Trôi box', M: 'Đi xa bất thường' };
/** Tooltip cột luật QC: số frame lỗi theo từng mã. */
const issueTip = (by: Record<string, number>) => {
  const lines = Object.entries(by).filter(([, n]) => n > 0).map(([k, n]) => `${sym(k)} — ${KIND_NAMES[k] ?? k}: ${n} frame`);
  return lines.length ? lines.join(String.fromCharCode(10)) : 'Không có lỗi luật QC';
};

export function ObjectTable({ jobId, rows, hints, overlapFrames, overlapPairs, onOpen, onSelect, selectedNum, onDelete, incomplete, tracks, labels: jobLabels, start, stop, cvatFrame }: {
  jobId: number;
  labels: CvatLabel[];
  selectedNum: number | null; onSelect: (num: number) => void; // bấm 1 lần: chọn dòng (chọn object); bấm đúp: mở Batch Review (onOpen)
  onDelete: (r: ObjectRow) => void; rows: ObjectRow[]; hints: Map<number, number>; overlapFrames: Map<number, number>; overlapPairs: OverlapPair[]; onOpen: (num: number, first: number | null) => void;
  incomplete: ReadonlySet<number>; // object còn frame chưa tải / chưa tính ít điểm: ô "luật QC" (có phần ít điểm P) chưa đáng tin
  tracks: CvatTrack[]; start: number; stop: number;
  cvatFrame: number | null; // frame đang mở trên CVAT (nếu biết): mặc định đo khoảng cách tại frame này
}) {
  useSymbols();
  const [label, setLabel] = useState('');
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
  const ov = (r: ObjectRow) => overlapFrames.get(r.num) ?? 0;
  const h = (r: ObjectRow) => hints.get(r.num) ?? 0;
  const labels = useMemo(() => [...new Set(rows.map((r) => r.label))], [rows]);
  const shown = useMemo(() => {
    const r = rows.filter((x) => (!label || x.label === label) && (!onlyMissing || x.missing > 0) && (!onlyJumps || x.jumps > 0) && (!onlyMade || x.made !== null) && (!onlyHints || h(x) > 0) && (!onlyOverlap || ov(x) > 0));
    return r.sort((a, b) => (sort === 'num' ? a.num - b.num : sort === 'dist' ? byDist(a, b) : sort === 'overlap' ? ov(b) - ov(a) : b[sort] - a[sort]));
  }, [rows, hints, overlapFrames, label, sort, onlyMissing, onlyJumps, onlyHints, onlyOverlap, onlyMade, dist, distAsc]);
  const th = (k: SortKey, text: string, title?: string) => (
    <th style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => { if (k === 'dist' && sort === 'dist') setDistAsc((x) => !x); else { setSort(k); if (k === 'dist') setDistAsc(true); } }} title={title}>{text}{sort === k ? (k === 'dist' && distAsc ? ' ▴' : ' ▾') : ''}</th>
  );
  const far = DEFAULT_GROUND.maxRange;
  const pendingTip = 'Chưa đủ dữ liệu: object còn frame đang tải ngầm / chưa tính ít điểm (P), con số có thể còn tăng; viền vàng tự mất khi tính xong.';
  return (
    <>
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
        — {shown.length}/{rows.length} object
        <span style={{ color: '#777', fontSize: 11, marginLeft: 8 }}>bấm 1 lần để chọn dòng, bấm đúp để mở Batch Review</span>
        {seen.size > 0 && (
          <span style={{ marginLeft: 10 }} title="ID gạch chân = object đã mở xem trong Batch Review (lưu theo job)">
            <span style={SEEN_STYLE}>ID</span> đã xem: {rows.filter((r) => seen.has(r.id)).length}{' '}
            <button onClick={() => { if (confirm('Bỏ đánh dấu "đã xem" của mọi object trong job này?')) seenStore.clear(jobId); }} style={{ padding: '0 5px' }}>↺ bỏ đánh dấu</button>
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
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{th('num', 'ID')}<th style={{ textAlign: 'left' }}>Nhãn</th><th style={{ textAlign: 'left' }} title="Attribute của object; attribute đổi theo frame hiện các giá trị lần lượt (a → b)">Attribute</th>{th('assigned', 'Được gán')}{th('outside', 'Outside')}{th('missing', 'Outside thiếu KF')}{th('jumps', '⚠ đi xa')}{th('issues', incomplete.size ? '⚠ luật QC ⏳' : '⚠ luật QC', incomplete.size ? `${incomplete.size} object chưa đủ dữ liệu (viền vàng). ${pendingTip}` : undefined)}{th('drift', '⚠ trôi box')}{th('overlap', '⚠ chồng lấn')}{th('dist', '📏 cách ego (m)', distMode === 'frame' ? `Khoảng cách tới ego tại frame ${distFrame}; — = không có box ở frame đó (luôn xếp cuối)` : 'Khoảng cách gần nhất tới ego trên cả track')}<th style={{ textAlign: 'left' }}>Khoảng frame</th><th>KF</th><th /></tr>
        </thead>
        <tbody>
          {shown.map((r, i) => (
            <tr
              key={r.num} onClick={() => onSelect(r.num)} onDoubleClick={() => onOpen(r.num, r.first)} aria-selected={r.num === selectedNum}
              style={{ cursor: 'pointer', userSelect: 'none', borderTop: '1px solid #ddd', background: r.num === selectedNum ? SEL_BG : r.made === 'draft' ? '#dff5df' : r.made === 'server' ? '#e3ecff' : i % 2 ? ODD_BG : undefined }}
            >
              <td><b style={seen.has(r.id) ? SEEN_STYLE : undefined} title={seen.has(r.id) ? 'Đã xem trong Batch Review' : undefined}>{r.num}</b> {r.made === 'draft' ? <span title="Object do tool tạo, đang trong NHÁP (chưa có trên CVAT)" style={{ background: '#2e9d3b', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🛠 mới</span> : r.made === 'server' ? <span title="Object do tool tạo và đã upload; chỉ loại này mới xóa được bằng tool" style={{ background: '#2f5fd0', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🛠 tool</span> : <span style={{ color: "#999", fontSize: 10 }}>db {r.id}</span>}</td><td>{r.label}</td>
              {(() => {
                const at = attrsOf.get(r.num) ?? [];
                return (
                  <td style={{ fontSize: 11, maxWidth: 260 }} title={at.map((a) => `${a.name} = ${a.value}`).join(String.fromCharCode(10)) || 'Nhãn này không có attribute'}>
                    {at.length ? at.map((a, j) => <span key={a.name}>{j > 0 && ', '}<span style={{ color: '#666' }}>{a.name}</span> {a.value || '—'}</span>) : <span style={{ color: '#999' }}>—</span>}
                  </td>
                );
              })()}
              <td>{r.assigned}</td><td>{r.outside}</td>
              <td style={{ color: r.missing ? '#b00' : undefined, fontWeight: r.missing ? 700 : 400 }}>{r.missing}</td>
              <td style={{ color: r.jumps ? '#a05a00' : undefined, fontWeight: r.jumps ? 700 : 400 }}>{r.jumps}</td>
              <td style={{ color: r.issues ? '#a0006e' : undefined, fontWeight: r.issues ? 700 : 400, ...(incomplete.has(r.num) ? PENDING_STYLE : null) }} title={incomplete.has(r.num) ? `${pendingTip}\n${issueTip(r.issuesByKind)}` : issueTip(r.issuesByKind)}>{r.issues}</td>
              <td style={{ color: r.drift ? '#a0006e' : undefined, fontWeight: r.drift ? 700 : 400 }} title={r.drift ? `Toạ độ ego của box không đổi trong khi xe chạy (box đi theo xe), frame ${r.driftFrames.join(', ')}` : 'Không có trôi box'}>{r.drift}</td>
              <td style={{ color: ov(r) ? '#b45a00' : undefined, fontWeight: ov(r) ? 700 : 400 }} title={overlapPairs.filter((p) => p.a === r.num || p.b === r.num).map((p) => `#${p.a}–#${p.b}: frame ${p.frames.join(', ')} (tối đa ${fmtIou(p.max)})`).join('\n')}>{ov(r)}</td>
              {(() => {
                const d = dist.get(r.num);
                return <td style={{ color: d && d.d > far ? '#999' : undefined }} title={d ? `${d.d.toFixed(2)} m tại frame ${d.frame}${d.d > far ? ` — ngoài ${far} m: không đo mặt đường` : ''}` : distMode === 'frame' ? `Không có box ở frame ${distFrame}` : 'Không có box'}>{d ? d.d.toFixed(1) : '—'}</td>;
              })()}
              <td>{r.first === null ? '—' : `${r.first}–${r.last}`}</td><td>{r.keyframes}</td>
              <td>{r.made !== null && <button onDoubleClick={(e) => e.stopPropagation()} onClick={(e) => { e.stopPropagation(); onDelete(r); }} title={r.made === 'draft' ? 'Xóa object này khỏi nháp (chưa lên CVAT nên không ảnh hưởng server)' : 'Xóa object do tool tạo khỏi CVAT (xác nhận ở màn hình upload)'}>🗑</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
