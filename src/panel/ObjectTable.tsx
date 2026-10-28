import { useMemo, useState } from 'react';
import type { ObjectRow } from '../shared/table';
import { ISSUE_NAMES } from '../shared/qcrules';
import { fmtIou, type OverlapPair } from '../shared/overlap';

type SortKey = 'num' | 'assigned' | 'outside' | 'missing' | 'jumps' | 'issues' | 'drift' | 'hints' | 'overlap';

const KIND_NAMES: Record<string, string> = { ...ISSUE_NAMES, P: 'Ít điểm (dưới 6 điểm trong box, chỉ các frame đã tải point cloud)' };
/** Tooltip cột luật QC: số frame lỗi theo từng mã. */
const issueTip = (by: Record<string, number>) => {
  const lines = Object.entries(by).filter(([, n]) => n > 0).map(([k, n]) => `${k} — ${KIND_NAMES[k] ?? k}: ${n} frame`);
  return lines.length ? lines.join(String.fromCharCode(10)) : 'Không có lỗi luật QC';
};

export function ObjectTable({ rows, hints, overlapFrames, overlapPairs, onOpen, onDelete }: { onDelete: (r: ObjectRow) => void; rows: ObjectRow[]; hints: Map<number, number>; overlapFrames: Map<number, number>; overlapPairs: OverlapPair[]; onOpen: (num: number, first: number | null) => void }) {
  const [label, setLabel] = useState('');
  const [sort, setSort] = useState<SortKey>('num');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyJumps, setOnlyJumps] = useState(false);
  const [onlyHints, setOnlyHints] = useState(false);
  const [onlyMade, setOnlyMade] = useState(false);
  const [onlyOverlap, setOnlyOverlap] = useState(false);
  const ov = (r: ObjectRow) => overlapFrames.get(r.num) ?? 0;
  const h = (r: ObjectRow) => hints.get(r.num) ?? 0;
  const labels = useMemo(() => [...new Set(rows.map((r) => r.label))], [rows]);
  const shown = useMemo(() => {
    const r = rows.filter((x) => (!label || x.label === label) && (!onlyMissing || x.missing > 0) && (!onlyJumps || x.jumps > 0) && (!onlyMade || x.made !== null) && (!onlyHints || h(x) > 0) && (!onlyOverlap || ov(x) > 0));
    return r.sort((a, b) => (sort === 'num' ? a.num - b.num : sort === 'hints' ? h(b) - h(a) : sort === 'overlap' ? ov(b) - ov(a) : b[sort] - a[sort]));
  }, [rows, hints, overlapFrames, label, sort, onlyMissing, onlyJumps, onlyHints, onlyOverlap, onlyMade]);
  const th = (k: SortKey, text: string) => (
    <th style={{ cursor: 'pointer', textAlign: 'left' }} onClick={() => setSort(k)}>{text}{sort === k ? ' ▾' : ''}</th>
  );
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
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{th('num', 'ID')}<th style={{ textAlign: 'left' }}>Nhãn</th>{th('assigned', 'Được gán')}{th('outside', 'Outside')}{th('missing', 'Outside thiếu KF')}{th('jumps', '⚠ đi xa')}{th('issues', '⚠ luật QC')}{th('drift', '⚠ trôi box')}{th('hints', '💡 thuộc tính')}{th('overlap', '⚠ chồng lấn')}<th style={{ textAlign: 'left' }}>Khoảng frame</th><th>KF</th><th /></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.num} onClick={() => onOpen(r.num, r.first)} style={{ cursor: 'pointer', borderTop: '1px solid #ddd', background: r.made === 'draft' ? '#dff5df' : r.made === 'server' ? '#e3ecff' : undefined }}>
              <td><b>{r.num}</b> {r.made === 'draft' ? <span title="Object do tool tạo, đang trong NHÁP (chưa có trên CVAT)" style={{ background: '#2e9d3b', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🛠 mới</span> : r.made === 'server' ? <span title="Object do tool tạo và đã upload; chỉ loại này mới xóa được bằng tool" style={{ background: '#2f5fd0', color: '#fff', fontSize: 10, padding: '0 4px', borderRadius: 3 }}>🛠 tool</span> : <span style={{ color: "#999", fontSize: 10 }}>db {r.id}</span>}</td><td>{r.label}</td><td>{r.assigned}</td><td>{r.outside}</td>
              <td style={{ color: r.missing ? '#b00' : undefined, fontWeight: r.missing ? 700 : 400 }}>{r.missing}</td>
              <td style={{ color: r.jumps ? '#a05a00' : undefined, fontWeight: r.jumps ? 700 : 400 }}>{r.jumps}</td>
              <td style={{ color: r.issues ? '#a0006e' : undefined, fontWeight: r.issues ? 700 : 400 }} title={issueTip(r.issuesByKind)}>{r.issues}</td>
              <td style={{ color: r.drift ? '#a0006e' : undefined, fontWeight: r.drift ? 700 : 400 }} title={r.drift ? `Vật đứng yên mà box nhích (đã bù chuyển động của xe), frame ${r.driftFrames.join(', ')}` : 'Không có trôi box'}>{r.drift}</td>
              <td style={{ color: h(r) ? '#006b7a' : undefined, fontWeight: h(r) ? 700 : 400 }}>{h(r)}</td>
              <td style={{ color: ov(r) ? '#b45a00' : undefined, fontWeight: ov(r) ? 700 : 400 }} title={overlapPairs.filter((p) => p.a === r.num || p.b === r.num).map((p) => `#${p.a}–#${p.b}: frame ${p.frames.join(', ')} (tối đa ${fmtIou(p.max)})`).join('\n')}>{ov(r)}</td>
              <td>{r.first === null ? '—' : `${r.first}–${r.last}`}</td><td>{r.keyframes}</td>
              <td>{r.made !== null && <button onClick={(e) => { e.stopPropagation(); onDelete(r); }} title={r.made === 'draft' ? 'Xóa object này khỏi nháp (chưa lên CVAT nên không ảnh hưởng server)' : 'Xóa object do tool tạo khỏi CVAT (xác nhận ở màn hình upload)'}>🗑</button>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
