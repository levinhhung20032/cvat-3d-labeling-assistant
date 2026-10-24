import { useMemo, useState } from 'react';
import { ISSUE_KINDS, ISSUE_NAMES, type IssueKind } from '../shared/qcrules';
import { detectAll, flagKey, flagState, parseQcMatrix, type FlagState } from '../shared/qcimport';
import type { CvatTrack } from '../shared/types';
import { qcFlagStore, useFlagMarks, useQcImports } from './qcFlagStore';

const STATE_LABEL: Record<FlagState, string> = { open: 'còn lỗi', cleared: 'đã hết (tool)', ignore: 'bỏ qua', fixed: 'đã sửa' };
const STATE_COLOR: Record<FlagState, string> = { open: '#b00', cleared: '#060', ignore: '#666', fixed: '#06c' };
const PAGE = 200;

/**
 * Đối chiếu file QC (.xlsx): nạp file, lấy các flag ở sheet Matrix, so với dữ liệu hiện tại của job
 * (kể cả bản nháp chưa upload), đánh dấu từng flag là bỏ qua (ignore) hoặc đã sửa (fixed).
 * File chỉ được đọc ngay trong trình duyệt; không gửi đi đâu.
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

  const detected = useMemo(() => (imp ? detectAll(tracks, labels, start, stop) : new Map<string, string>()), [imp, tracks, labels, start, stop]);
  const rows = useMemo(() => (imp ? imp.flags.map((f) => {
    const msg = detected.get(`${f.num}:${f.frame}:${f.kind}`);
    return { f, msg, state: flagState(marks[flagKey(jobId, f)], msg !== undefined) };
  }) : []), [imp, detected, marks, jobId]);
  const count = (s: FlagState) => rows.filter((r) => r.state === s).length;
  const shown = rows.filter((r) => (fState === 'all' || r.state === fState) && fKinds.has(r.f.kind) && (!fId.trim() || String(r.f.num) === fId.trim()));

  const load = async (file: File | undefined) => {
    setErr('');
    if (!file) return;
    const r = parseQcMatrix(new Uint8Array(await file.arrayBuffer()));
    if (!r.ok) { setErr(r.message); return; }
    qcFlagStore.setImport(jobId, { name: file.name, at: new Date().toISOString(), flags: r.flags });
    setLimit(PAGE);
  };
  const toggleKind = (k: IssueKind) => setFKinds((s) => { const n = new Set(s); if (n.has(k)) n.delete(k); else n.add(k); return n; });

  return (
    <div style={{ marginTop: 14, borderTop: '2px solid #1f2937', paddingTop: 6 }}>
      <b>Đối chiếu file QC (.xlsx)</b>
      <p style={{ margin: '4px 0', color: '#555' }}>
        Chọn file báo cáo QC của job này; tool đọc sheet <code>Matrix</code> (ID × frame, ký hiệu S K Z H O D) ngay trên máy bạn, không gửi đi đâu.
        Mỗi flag được so với dữ liệu hiện tại (kể cả nháp chưa upload): <b>đã hết</b> nghĩa là tool không còn thấy lỗi đó. Bạn có thể đặt <b>ignore</b> (chấp nhận) hoặc <b>fixed</b> (đã sửa).
        Số frame trong file được hiểu là số frame của job.
      </p>
      <p style={{ margin: '4px 0' }}>
        <input type="file" accept=".xlsx" onChange={(e) => { void load(e.target.files?.[0]); e.target.value = ''; }} />
        {imp && <button style={{ marginLeft: 8 }} onClick={() => { if (confirm('Bỏ file QC đã nạp và mọi đánh dấu ignore / fixed của job này?')) qcFlagStore.clearImport(jobId); }}>Bỏ file</button>}
      </p>
      {err && <p style={{ color: '#b00' }}>{err}</p>}
      {imp && (
        <>
          <p style={{ margin: '4px 0' }}>
            <b>{imp.name}</b> ({new Date(imp.at).toLocaleString()}): {imp.flags.length} flag ·{' '}
            <span style={{ color: STATE_COLOR.open }}>còn lỗi {count('open')}</span> ·{' '}
            <span style={{ color: STATE_COLOR.cleared }}>đã hết {count('cleared')}</span> ·{' '}
            <span style={{ color: STATE_COLOR.ignore }}>bỏ qua {count('ignore')}</span> ·{' '}
            <span style={{ color: STATE_COLOR.fixed }}>đã sửa {count('fixed')}</span>{' '}
            <button
              disabled={!count('cleared')}
              onClick={() => qcFlagStore.mark(jobId, rows.filter((r) => r.state === 'cleared').map((r) => r.f), 'fixed')}
              title="Đặt fixed cho mọi flag mà tool không còn thấy lỗi"
            >✔ Đánh dấu fixed các flag đã hết</button>
          </p>
          <p style={{ margin: '4px 0', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' }}>
            <span>Hiện{' '}
              <select value={fState} onChange={(e) => { setFState(e.target.value as 'all' | FlagState); setLimit(PAGE); }}>
                <option value="all">tất cả</option>
                {(Object.keys(STATE_LABEL) as FlagState[]).map((s) => <option key={s} value={s}>{STATE_LABEL[s]}</option>)}
              </select>
            </span>
            {ISSUE_KINDS.map((k) => (
              <label key={k} title={ISSUE_NAMES[k]}><input type="checkbox" checked={fKinds.has(k)} onChange={() => { toggleKind(k); setLimit(PAGE); }} /> {k}</label>
            ))}
            <span>ID <input value={fId} onChange={(e) => { setFId(e.target.value.replace(/\D/g, '')); setLimit(PAGE); }} size={4} style={{ width: 48 }} /></span>
            <span style={{ color: '#555' }}>{shown.length} flag</span>
            {shown.length > 0 && shown.length <= 5000 && (
              <>
                <button onClick={() => qcFlagStore.mark(jobId, shown.map((r) => r.f), 'ignore')} title="Đặt ignore cho mọi flag đang hiện">Ignore tất cả đang hiện</button>
                <button onClick={() => qcFlagStore.mark(jobId, shown.map((r) => r.f), 'fixed')} title="Đặt fixed cho mọi flag đang hiện">Fixed tất cả đang hiện</button>
              </>
            )}
          </p>
          <table style={{ borderCollapse: 'collapse', width: '100%' }}>
            <thead><tr style={{ textAlign: 'left' }}><th>ID</th><th>frame</th><th>loại</th><th>trạng thái</th><th>tool thấy</th><th /></tr></thead>
            <tbody>
              {shown.slice(0, limit).map(({ f, msg, state }) => (
                <tr key={flagKey(jobId, f)} style={{ borderTop: '1px solid #ddd', opacity: state === 'ignore' || state === 'fixed' ? 0.6 : 1 }}>
                  <td><b>{f.num}</b></td>
                  <td><button onClick={() => onOpen(f.num, f.frame)} title="Mở object này ở frame đó">{f.frame}</button></td>
                  <td title={ISSUE_NAMES[f.kind]}><b>{f.kind}</b> <span style={{ color: '#666' }}>{ISSUE_NAMES[f.kind]}</span></td>
                  <td style={{ color: STATE_COLOR[state], fontWeight: 600 }}>{STATE_LABEL[state]}</td>
                  <td style={{ color: '#555', fontSize: 11 }}>{msg ?? '—'}</td>
                  <td style={{ whiteSpace: 'nowrap' }}>
                    <button onClick={() => qcFlagStore.mark(jobId, [f], 'ignore')} disabled={state === 'ignore'}>ignore</button>{' '}
                    <button onClick={() => qcFlagStore.mark(jobId, [f], 'fixed')} disabled={state === 'fixed'}>fixed</button>{' '}
                    {(state === 'ignore' || state === 'fixed') && <button onClick={() => qcFlagStore.mark(jobId, [f], null)} title="Bỏ đánh dấu">↺</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {shown.length > limit && <p><button onClick={() => setLimit(limit + PAGE)}>Xem thêm ({shown.length - limit} flag nữa)</button></p>}
        </>
      )}
    </div>
  );
}
