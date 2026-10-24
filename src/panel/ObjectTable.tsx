import { useMemo, useState } from 'react';
import type { ObjectRow } from '../shared/table';
import type { OverlapPair } from '../shared/overlap';

type SortKey = 'num' | 'assigned' | 'outside' | 'missing' | 'jumps' | 'hints' | 'overlap';

export function ObjectTable({ rows, hints, overlapFrames, overlapPairs, onOpen }: { rows: ObjectRow[]; hints: Map<number, number>; overlapFrames: Map<number, number>; overlapPairs: OverlapPair[]; onOpen: (num: number, first: number | null) => void }) {
  const [label, setLabel] = useState('');
  const [sort, setSort] = useState<SortKey>('num');
  const [onlyMissing, setOnlyMissing] = useState(false);
  const [onlyJumps, setOnlyJumps] = useState(false);
  const [onlyHints, setOnlyHints] = useState(false);
  const [onlyOverlap, setOnlyOverlap] = useState(false);
  const ov = (r: ObjectRow) => overlapFrames.get(r.num) ?? 0;
  const h = (r: ObjectRow) => hints.get(r.num) ?? 0;
  const labels = useMemo(() => [...new Set(rows.map((r) => r.label))], [rows]);
  const shown = useMemo(() => {
    const r = rows.filter((x) => (!label || x.label === label) && (!onlyMissing || x.missing > 0) && (!onlyJumps || x.jumps > 0) && (!onlyHints || h(x) > 0) && (!onlyOverlap || ov(x) > 0));
    return r.sort((a, b) => (sort === 'num' ? a.num - b.num : sort === 'hints' ? h(b) - h(a) : sort === 'overlap' ? ov(b) - ov(a) : b[sort] - a[sort]));
  }, [rows, hints, overlapFrames, label, sort, onlyMissing, onlyJumps, onlyHints, onlyOverlap]);
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
        <label title="Object có thuộc tính (attribute) khác với gợi ý theo kích thước box"><input type="checkbox" checked={onlyHints} onChange={(e) => setOnlyHints(e.target.checked)} /> chỉ ID có gợi ý thuộc tính</label>{' '}
        <label title="Object chồng lên object khác (xét chéo giữa các ID) ở ít nhất một frame"><input type="checkbox" checked={onlyOverlap} onChange={(e) => setOnlyOverlap(e.target.checked)} /> chỉ ID có chồng lấn</label>{' '}
        — {shown.length}/{rows.length} object
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr>{th('num', 'ID')}<th style={{ textAlign: 'left' }}>Nhãn</th>{th('assigned', 'Được gán')}{th('outside', 'Outside')}{th('missing', 'Outside thiếu KF')}{th('jumps', '⚠ đi xa')}{th('hints', '💡 thuộc tính')}{th('overlap', '⚠ chồng lấn')}<th style={{ textAlign: 'left' }}>Khoảng frame</th><th>KF</th></tr>
        </thead>
        <tbody>
          {shown.map((r) => (
            <tr key={r.num} onClick={() => onOpen(r.num, r.first)} style={{ cursor: 'pointer', borderTop: '1px solid #ddd' }}>
              <td><b>{r.num}</b> <span style={{ color: "#999", fontSize: 10 }}>db {r.id}</span></td><td>{r.label}</td><td>{r.assigned}</td><td>{r.outside}</td>
              <td style={{ color: r.missing ? '#b00' : undefined, fontWeight: r.missing ? 700 : 400 }}>{r.missing}</td>
              <td style={{ color: r.jumps ? '#a05a00' : undefined, fontWeight: r.jumps ? 700 : 400 }}>{r.jumps}</td>
              <td style={{ color: h(r) ? '#006b7a' : undefined, fontWeight: h(r) ? 700 : 400 }}>{h(r)}</td>
              <td style={{ color: ov(r) ? '#b45a00' : undefined, fontWeight: ov(r) ? 700 : 400 }} title={overlapPairs.filter((p) => p.a === r.num || p.b === r.num).map((p) => `#${p.a}–#${p.b}: frame ${p.frames.join(', ')} (tối đa ${Math.round(p.max * 100)}%)`).join('\n')}>{ov(r)}</td>
              <td>{r.first === null ? '—' : `${r.first}–${r.last}`}</td><td>{r.keyframes}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
