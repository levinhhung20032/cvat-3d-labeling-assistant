import { Fragment, useMemo, useState } from 'react';
import { ISSUE_KINDS, ISSUE_NAMES, type IssueKind } from '../shared/qcrules';
import { detectAll, flagKey, flagState, parseQcMatrix, type FlagState, type QcFlag } from '../shared/qcimport';
import type { CvatTrack } from '../shared/types';
import { qcFlagStore, useFlagMarks, useQcImports } from './qcFlagStore';

const STATE_LABEL: Record<FlagState, string> = { open: 'còn lỗi', cleared: 'đã hết (tool)', ignore: 'bỏ qua', fixed: 'đã sửa' };
const STATE_COLOR: Record<FlagState, string> = { open: '#b00', cleared: '#060', ignore: '#666', fixed: '#06c' };
const STATES = Object.keys(STATE_LABEL) as FlagState[];
const PAGE = 60; // số ID mỗi trang

interface Row { f: QcFlag; msg: string | undefined; state: FlagState }

/** [1,2,3,5,9,10] → [[1,3],[5,5],[9,10]] */
function toRanges(frames: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const f of [...frames].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && f === last[1] + 1) last[1] = f; else out.push([f, f]);
  }
  return out;
}
const counts = (rows: Row[]) => STATES.map((s) => [s, rows.filter((r) => r.state === s).length] as const).filter(([, n]) => n > 0);

/**
 * Đối chiếu file QC (.xlsx): nạp file, lấy các flag ở sheet Matrix, so với dữ liệu hiện tại của job (kể cả bản nháp chưa upload).
 * Danh sách gom theo ID (mỗi ID một dòng, bấm mũi tên để xem từng loại lỗi với các đoạn frame), nên một ID không còn chiếm hàng trăm dòng.
 * Đánh dấu bỏ qua (ignore) / đã sửa (fixed) theo từng loại, từng ID, hoặc theo lô nhiều ID đã tick. File chỉ đọc trong trình duyệt.
 */
export function QcCompare({ jobId, tracks, labels, start, stop, onOpen }: {
  jobId: number; tracks: CvatTrack[]; labels: string[]; start: number; stop: number;
  onOpen: (num: number, frame: number) => void;
}) {
  const imports = useQcImports();
  const marks = useFlagMarks();
  const imp = imports[String(jobId)] ?? null;
  const [err, setErr] = useState('');
  const [fState, setFState] = useState<'all' | FlagState>('open');
  const [fKinds, setFKinds] = useState<Set<IssueKind>>(new Set(ISSUE_KINDS));
  const [fId, setFId] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const [open, setOpen] = useState<Set<number>>(new Set());
  const [picked, setPicked] = useState<Set<number>>(new Set());

  const detected = useMemo(() => (imp ? detectAll(tracks, labels, start, stop) : new Map<string, string>()), [imp, tracks, labels, start, stop]);
  const rows = useMemo<Row[]>(() => (imp ? imp.flags.map((f) => {
    const msg = detected.get(`${f.num}:${f.frame}:${f.kind}`);
    return { f, msg, state: flagState(marks[flagKey(jobId, f)], msg !== undefined) };
  }) : []), [imp, detected, marks, jobId]);
  const total = (s: FlagState) => rows.filter((r) => r.state === s).length;
  const shown = rows.filter((r) => (fState === 'all' || r.state === fState) && fKinds.has(r.f.kind) && (!fId.trim() || String(r.f.num) === fId.trim()));
  // gom theo ID → theo loại
  const groups = useMemo(() => {
    const m = new Map<number, Map<IssueKind, Row[]>>();
    for (const r of shown) {
      const byKind = m.get(r.f.num) ?? new Map<IssueKind, Row[]>();
      byKind.set(r.f.kind, [...(byKind.get(r.f.kind) ?? []), r]);
      m.set(r.f.num, byKind);
    }
    return [...m].sort((a, b) => a[0] - b[0]);
  }, [shown]);

  const load = async (file: File | undefined) => {
    setErr('');
    if (!file) return;
    const r = parseQcMatrix(new Uint8Array(await file.arrayBuffer()));
    if (!r.ok) { setErr(r.message); return; }
    qcFlagStore.setImport(jobId, { name: file.name, at: new Date().toISOString(), flags: r.flags });
    setLimit(PAGE); setOpen(new Set()); setPicked(new Set());
  };
  const toggleKind = (k: IssueKind) => setFKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleIn = (set: Set<number>, num: number) => { const n = new Set(set); if (n.has(num)) n.delete(num); else n.add(num); return n; };
  const markRows = (rs: Row[], mark: 'ignore' | 'fixed' | null) => qcFlagStore.mark(jobId, rs.map((r) => r.f), mark);
  const pickedRows = groups.filter(([num]) => picked.has(num)).flatMap(([, byKind]) => [...byKind.values()].flat());

  const actions = (rs: Row[]) => (
    <>
      <button onClick={() => markRows(rs, 'ignore')} disabled={rs.every((r) => r.state === 'ignore')} title={`Bỏ qua ${rs.length} flag`}>ignore</button>{' '}
      <button onClick={() => markRows(rs, 'fixed')} disabled={rs.every((r) => r.state === 'fixed')} title={`Đánh dấu đã sửa ${rs.length} flag`}>fixed</button>{' '}
      {rs.some((r) => r.state === 'ignore' || r.state === 'fixed') && <button onClick={() => markRows(rs.filter((r) => r.state === 'ignore' || r.state === 'fixed'), null)} title="Bỏ đánh dấu">↺</button>}
    </>
  );

  return (
    <div style={{ marginTop: 14, borderTop: '2px solid #1f2937', paddingTop: 6 }}>
      <b>QC comparison</b> <span style={{ color: '#555', fontSize: 12 }}>— đối chiếu file báo cáo QC (.xlsx, sheet Matrix) với lỗi tool tự phát hiện</span>
      <p style={{ margin: '4px 0', color: '#555' }}>
        Chọn file báo cáo QC của job này; tool đọc sheet <code>Matrix</code> (ID × frame, ký hiệu S K Z H O D) ngay trên máy bạn, không gửi đi đâu.
        Mỗi flag được so với dữ liệu hiện tại (kể cả nháp chưa upload): <b>đã hết</b> nghĩa là tool không còn thấy lỗi đó. Bạn có thể đặt <b>ignore</b> (chấp nhận) hoặc <b>fixed</b> (đã sửa)
        cho từng loại, từng ID, hoặc cả lô ID đã tick. Số frame trong file được hiểu là số frame của job.
      </p>
      <p style={{ margin: '4px 0' }}>
        <label className="cvla-filebtn">⬆ Chọn file QC để đối chiếu (QC comparison){' '}<input type="file" accept=".xlsx" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} /></label>
        {imp && <button style={{ marginLeft: 8 }} onClick={() => { if (confirm('Bỏ file QC đã nạp và mọi đánh dấu ignore / fixed của job này?')) qcFlagStore.clearImport(jobId); }}>Bỏ file</button>}
      </p>
      {err && <p style={{ color: '#b00' }}>{err}</p>}
      {imp && (
        <>
          <p style={{ margin: '4px 0' }}>
            <b>{imp.name}</b> ({new Date(imp.at).toLocaleString()}): {imp.flags.length} flag ·{' '}
            {STATES.map((s) => <span key={s} style={{ color: STATE_COLOR[s], marginRight: 8 }}>{STATE_LABEL[s]} {total(s)}</span>)}{' '}
            <button
              disabled={!total('cleared')}
              onClick={() => qcFlagStore.mark(jobId, rows.filter((r) => r.state === 'cleared').map((r) => r.f), 'fixed')}
              title="Đặt fixed cho mọi flag mà tool không còn thấy lỗi"
            >✔ Đánh dấu fixed các flag đã hết</button>
          </p>
          <p style={{ margin: '4px 0', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
            <span>Hiện{' '}
              <select value={fState} onChange={(e) => { setFState(e.target.value as 'all' | FlagState); setLimit(PAGE); }}>
                <option value="all">tất cả</option>
                {STATES.map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
              </select>
            </span>
            {ISSUE_KINDS.map((k) => (
              <label key={k} title={ISSUE_NAMES[k]}><input type="checkbox" checked={fKinds.has(k)} onChange={() => { toggleKind(k); setLimit(PAGE); }} /> {k}</label>
            ))}
            <button onClick={() => { setFKinds(new Set(ISSUE_KINDS)); setLimit(PAGE); }} disabled={fKinds.size === ISSUE_KINDS.length} title="Hiện mọi loại lỗi">Bật tất cả</button>
            <button onClick={() => { setFKinds(new Set()); setLimit(PAGE); }} disabled={fKinds.size === 0} title="Ẩn mọi loại lỗi">Tắt tất cả</button>
            <span>ID <input value={fId} onChange={(e) => { setFId(e.target.value.replace(/\D/g, '')); setLimit(PAGE); }} size={4} style={{ width: 48 }} /></span>
            <span style={{ color: '#555' }}>{groups.length} ID · {shown.length} flag</span>
          </p>
          {groups.length > 0 && (
            <p style={{ margin: '4px 0', display: 'flex', flexWrap: 'wrap', gap: '4px 8px', alignItems: 'center', background: '#f1f4f8', padding: '3px 6px' }}>
              <label><input
                type="checkbox" className="cvla-check"
                checked={picked.size > 0 && groups.every(([n]) => picked.has(n))}
                onChange={(e) => setPicked(e.target.checked ? new Set(groups.map(([n]) => n)) : new Set())}
              /> chọn tất cả ID đang hiện</label>
              <span style={{ color: '#555' }}>Đã chọn <b>{picked.size}</b> ID ({pickedRows.length} flag):</span>
              <button disabled={!pickedRows.length} onClick={() => markRows(pickedRows, 'ignore')}>Ignore lô đã chọn</button>
              <button disabled={!pickedRows.length} onClick={() => markRows(pickedRows, 'fixed')}>Fixed lô đã chọn</button>
              <button disabled={!pickedRows.length} onClick={() => markRows(pickedRows.filter((r) => r.state === 'ignore' || r.state === 'fixed'), null)}>↺ Bỏ đánh dấu lô</button>
              <span style={{ borderLeft: '1px solid #bbb', height: 16 }} />
              <button disabled={!shown.length} onClick={() => markRows(shown, 'ignore')} title="Mọi flag đang hiện, kể cả các ID ở trang sau">Ignore tất cả đang hiện ({shown.length})</button>
              <button disabled={!shown.length} onClick={() => markRows(shown, 'fixed')}>Fixed tất cả đang hiện</button>
            </p>
          )}
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr style={{ textAlign: 'left' }}><th /><th /><th>ID</th><th>Lỗi (số frame)</th><th>Trạng thái</th><th /></tr></thead>
            <tbody>
              {groups.slice(0, limit).map(([num, byKind]) => {
                const all = [...byKind.values()].flat();
                const isOpen = open.has(num);
                return (
                  <Fragment key={num}>
                    <tr style={{ borderTop: '1px solid #ddd', background: isOpen ? '#f8fbff' : undefined }}>
                      <td><input type="checkbox" className="cvla-check" checked={picked.has(num)} onChange={() => setPicked(toggleIn(picked, num))} title="Chọn để ignore / fixed theo lô" /></td>
                      <td><button onClick={() => setOpen(toggleIn(open, num))} style={{ padding: '0 5px' }} title="Xem từng loại lỗi và các đoạn frame">{isOpen ? '▾' : '▸'}</button></td>
                      <td><button onClick={() => onOpen(num, start)} style={{ padding: '0 5px', fontWeight: 700 }} title="Mở object này trong Batch Review từ frame đầu">{num}</button>{" "}<span style={{ color: '#567', fontWeight: 400 }}>{labels[num - 1] ?? ''}</span></td>
                      <td>{[...byKind].map(([k, rs]) => <span key={k} style={{ marginRight: 8 }} title={ISSUE_NAMES[k]}><b>{k}</b> {rs.length}</span>)}</td>
                      <td>{counts(all).map(([s, n]) => <span key={s} style={{ color: STATE_COLOR[s], marginRight: 8, fontWeight: 600 }}>{STATE_LABEL[s]} {n}</span>)}</td>
                      <td style={{ whiteSpace: 'nowrap' }}>{actions(all)}</td>
                    </tr>
                    {isOpen && [...byKind].map(([k, rs]) => (
                      <tr key={`${num}:${k}`} style={{ background: '#f8fbff' }}>
                        <td /><td />
                        <td colSpan={2} style={{ paddingLeft: 16 }}>
                          <b>{k}</b> <span style={{ color: '#666' }}>{ISSUE_NAMES[k]}</span>{' '}
                          {toRanges(rs.map((r) => r.f.frame)).map(([a, b]) => {
                            const inRange = rs.filter((r) => r.f.frame >= a && r.f.frame <= b);
                            const tip = inRange.map((r) => `frame ${r.f.frame}: ${STATE_LABEL[r.state]}${r.msg ? ` — ${r.msg}` : ''}`).slice(0, 12).join('\n');
                            return (
                              <button key={a} onClick={() => onOpen(num, a)} title={tip} style={{ padding: '0 4px', marginRight: 3 }}>{a === b ? a : `${a}–${b}`}</button>
                            );
                          })}
                        </td>
                        <td>{counts(rs).map(([s, n]) => <span key={s} style={{ color: STATE_COLOR[s], marginRight: 8 }}>{STATE_LABEL[s]} {n}</span>)}</td>
                        <td style={{ whiteSpace: 'nowrap' }}>{actions(rs)}</td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
          {groups.length > limit && <p><button onClick={() => setLimit(limit + PAGE)}>Xem thêm ({groups.length - limit} ID nữa)</button></p>}
          {groups.length === 0 && <p style={{ color: '#666' }}>Không có flag nào khớp bộ lọc.</p>}
        </>
      )}
    </div>
  );
}
