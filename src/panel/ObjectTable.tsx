import { useEffect, useMemo, useState } from 'react';
import type { ObjectRow } from '../shared/table';
import type { CvatTrack } from '../shared/types';
import { stateAt } from '../shared/interp';
import { DEFAULT_GROUND } from '../shared/ground';
import { ISSUE_NAMES } from '../shared/qcrules';
import { fmtIou, type OverlapPair } from '../shared/overlap';
import { PENDING_STYLE } from './ui';

type SortKey = 'num' | 'assigned' | 'outside' | 'missing' | 'jumps' | 'issues' | 'drift' | 'hints' | 'overlap' | 'dist';
/** Khoảng cách tâm box tới ego (gốc toạ độ, trên mặt phẳng ngang) và frame đo. */
interface Dist { d: number; frame: number }

const KIND_NAMES: Record<string, string> = { ...ISSUE_NAMES, P: 'Ít điểm (dưới 6 điểm trong box, chỉ các frame đã tải point cloud)' };
/** Tooltip cột luật QC: số frame lỗi theo từng mã. */
const issueTip = (by: Record<string, number>) => {
  const lines = Object.entries(by).filter(([, n]) => n > 0).map(([k, n]) => `${k} — ${KIND_NAMES[k] ?? k}: ${n} frame`);
  return lines.length ? lines.join(String.fromCharCode(10)) : 'Không có lỗi luật QC';
};

export function ObjectTable({ rows, hints, overlapFrames, overlapPairs, onOpen, onDelete, incomplete, tracks, start, stop, cvatFrame }: {
  onDelete: (r: ObjectRow) => void; rows: ObjectRow[]; hints: Map<number, number>; overlapFrames: Map<number, number>; overlapPairs: OverlapPair[]; onOpen: (num: number, first: number | null) => void;
  incomplete: ReadonlySet<number>; // object còn frame chưa tải / chưa tính ít điểm: ô "luật QC" (có phần ít điểm P) chưa đáng tin
  tracks: CvatTrack[]; start: number; stop: number;
  cvatFrame: number | null; // frame đang mở trên CVAT (nếu biết): mặc định đo khoảng cách tại frame này
}) {
  const [label, setLabel] = useState('');
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
  const ov = (r: ObjectRow) => overlapFrames.get(r.num) ?? 0;
  const h = (r: ObjectRow) => hints.get(r.num) ?? 0;
  const labels = useMemo(() => [...new Set(rows.map((r) => r.label))], [rows]);
  const shown = useMemo(() => {
    const r = rows.filter((x) => (!label || x.label === label) && (!onlyMissing || x.missing > 0) && (!onlyJumps || x.jumps > 0) && (!onlyMade || x.made !== null) && (!onlyHints || h(x) > 0) && (!onlyOverlap || ov(x) > 0));
    return r.sort((a, b) => (sort === 'num' ? a.num - b.num : sort === 'dist' ? byDist(a, b) : sort === 'hints' ? h(b) - h(a) : sort === 'overlap' ? ov(b) - ov(a) : b[sort] - a[sort]));
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
          <tr>{th('num', 'ID')}<th style={{ textAlign: 'left' }}>Nhãn</th>{th('assigned', 'Được gán')}{th('outside', 'Outside')}{th('missing', 'Outside thiếu KF')}{th('jumps', '⚠ đi xa')}{th('issues', incomplete.size ? '⚠ luật QC ⏳' : '⚠ luật QC', incomplete.size ? `${incomplete.size} object chưa đủ dữ liệu (viền vàng). ${pendingTip}` : undefined)}{th('drift', '⚠ trôi box')}{th('hints', '💡 thuộc tính')}{th('overlap', '⚠ chồng lấn')}{th('dist', '📏 cách ego (m)', distMode === 'frame' ? `Khoảng cách tới ego tại frame ${distFrame}; — = không có box ở frame đó (luôn xếp cuối)` : 'Khoảng cách gần nhất tới ego trên cả track')}<th style={{ textAlign: 'left' }}>Khoảng frame</th><th>KF</th><th /></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.num} onClick={() => onOpen(r.num, r.first)} style={{ cursor: 'pointer', borderTop: '1px solid #ddd', background: r.made === 'draft' ? '#dff5df' : r.made === 'server' ? '#e3ecff' : undefined }}>
              <td><b>{r.num}</b> {r.made === 'draft' ? <span title="Object do tool tạo, đang trong NHÁP (chưa có trên CVAT)" style={{ background: '#2e9d3b', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🛠 mới</span> : r.made === 'server' ? <span title="Object do tool tạo và đã upload; chỉ loại này mới xóa được bằng tool" style={{ background: '#2f5fd0', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🛠 tool</span> : <span style={{ color: "#999", fontSize: 10 }}>db {r.id}</span>}</td><td>{r.label}</td><td>{r.assigned}</td><td>{r.outside}</td>
              <td style={{ color: r.missing ? '#b00' : undefined, fontWeight: r.missing ? 700 : 400 }}>{r.missing}</td>
              <td style={{ color: r.jumps ? '#a05a00' : undefined, fontWeight: r.jumps ? 700 : 400 }}>{r.jumps}</td>
              <td style={{ color: r.issues ? '#a0006e' : undefined, fontWeight: r.issues ? 700 : 400, ...(incomplete.has(r.num) ? PENDING_STYLE : null) }} title={incomplete.has(r.num) ? `${pendingTip}\n${issueTip(r.issuesByKind)}` : issueTip(r.issuesByKind)}>{r.issues}</td>
              <td style={{ color: r.drift ? '#a0006e' : undefined, fontWeight: r.drift ? 700 : 400 }} title={r.drift ? `Toạ độ ego của box không đổi trong khi xe chạy (box đi theo xe), frame ${r.driftFrames.join(', ')}` : 'Không có trôi box'}>{r.drift}</td>
              <td style={{ color: h(r) ? '#006b7a' : undefined, fontWeight: h(r) ? 700 : 400 }}>{h(r)}</td>
              <td style={{ color: ov(r) ? '#b45a00' : undefined, fontWeight: ov(r) ? 700 : 400 }} title={overlapPairs.filter((p) => p.a === r.num || p.b === r.num).map((p) => `#${p.a}–#${p.b}: frame ${p.frames.join(', ')} (tối đa ${fmtIou(p.max)})`).join('\n')}>{ov(r)}</td>
              {(() => {
                const d = dist.get(r.num);
                return <td style={{ color: d && d.d > far ? '#999' : undefined }} title={d ? `${d.d.toFixed(2)} m tại frame ${d.frame}${d.d > far ? ` — ngoài ${far} m: không đo mặt đường` : ''}` : distMode === 'frame' ? `Không có box ở frame ${distFrame}` : 'Không có box'}>{d ? d.d.toFixed(1) : '—'}</td>;
              })()}
              <td>{r.first === null ? '—' : `${r.first}–${r.last}`}</td><td>{r.keyframes}</td>
              <td>{r.made !== null && <button onClick={(e) => { e.stopPropagation(); onDelete(r); }} title={r.made === 'draft' ? 'Xóa object này khỏi nháp (chưa lên CVAT nên không ảnh hưởng server)' : 'Xóa object do tool tạo khỏi CVAT (xác nhận ở màn hình upload)'}>🗑</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
