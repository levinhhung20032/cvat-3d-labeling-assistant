import { useMemo, useState } from 'react';
import { notesOfJob, notesToRows } from '../shared/qc';
import { parseNotesXlsx, planNotesImport, type NotesPlan } from '../shared/qcnotes';
import { buildXlsx } from '../shared/xlsx';
import type { CvatTrack } from '../shared/types';
import { QcCompare } from './QcCompare';
import { qcStore, useQcMode, useQcNotes } from './qcStore';

interface Pending { name: string; plan: NotesPlan; skipped: number; otherJob: number | null }

/**
 * Tab QC có hai phần độc lập:
 * - **QC note**: ghi chú theo (ID, frame) ở QC mode; xuất Excel (ID, frame, note) và NHẬP LẠI file đó (chuyển ghi chú giữa các máy, không cần mạng).
 * - **QC comparison**: nạp file báo cáo QC (sheet Matrix) để đối chiếu với lỗi tool tự phát hiện.
 */
export function QcPanel({ jobId, count, tracks, labels, start, stop, onOpen }: {
  jobId: number; count: number; tracks: CvatTrack[]; labels: string[]; start: number; stop: number; onOpen: (num: number, frame: number) => void;
}) {
  const all = useQcNotes();
  const mode = useQcMode();
  const list = useMemo(() => notesOfJob(all, jobId), [all, jobId]);
  const [pending, setPending] = useState<Pending | null>(null);
  const [msg, setMsg] = useState('');

  const exportXlsx = () => {
    const bytes = buildXlsx(notesToRows(list), 'QC');
    const blob = new Blob([bytes as BlobPart], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `QC_job${jobId}.xlsx`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
  };

  const pick = async (file: File | undefined) => {
    setMsg(''); setPending(null);
    if (!file) return;
    const r = parseNotesXlsx(new Uint8Array(await file.arrayBuffer()));
    if (!r.ok) { setMsg(r.message); return; }
    const m = /job[_\s-]*(\d+)/i.exec(file.name);
    setPending({ name: file.name, plan: planNotesImport(list, r.notes), skipped: r.skipped, otherJob: m && Number(m[1]) !== jobId ? Number(m[1]) : null });
  };
  const commit = (overwrite: boolean) => {
    if (!pending) return;
    const n = qcStore.importNotes(jobId, pending.plan, overwrite);
    setMsg(`Đã nhập ${n.added} ghi chú mới${pending.plan.conflicts.length ? `, ${overwrite ? `ghi đè ${n.overwritten} ghi chú trùng` : `giữ nguyên ${pending.plan.conflicts.length} ghi chú trùng`}` : ''}.`);
    setPending(null);
  };

  const sec: React.CSSProperties = { margin: '10px 0 4px', padding: '4px 0', borderTop: '2px solid #1f2937', fontSize: 14 };
  const p = pending?.plan;

  return (
    <>
      <div style={{ ...sec, borderTop: 'none', marginTop: 0 }}><b>QC note</b> <span style={{ color: '#555', fontSize: 12 }}>— ghi chú theo (ID, frame); xuất ra Excel và nhập lại sau</span></div>
      <p style={{ margin: '4px 0' }}>
        <label style={{ fontWeight: 700 }}>
          <input type="checkbox" checked={mode} onChange={(e) => qcStore.setMode(e.target.checked)} /> QC mode
        </label>{' '}
        — bật thì mỗi cột frame trong Batch Review có ô ghi chú; ghi chú gắn với (ID object, frame) và lưu cục bộ trên máy này, không gửi đi đâu.
      </p>
      <p style={{ margin: '4px 0', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <span>Job {jobId}: <b>{list.length}</b> ghi chú ({count} object).</span>
        <button disabled={!list.length} onClick={exportXlsx} title="File .xlsx gồm 3 cột: ID, frame, note (không có toạ độ hay dữ liệu point cloud)">⬇ Xuất Excel (ID, frame, note)</button>
        <label className="cvla-filebtn" title="Nhập lại file ghi chú .xlsx do tool xuất (cùng 3 cột ID, frame, note), ví dụ để chuyển ghi chú từ máy khác sang">
          ⬆ Nhập ghi chú (QC note import){' '}
          <input type="file" accept=".xlsx" onChange={(e) => { void pick(e.target.files?.[0]); e.target.value = ''; }} />
        </label>
      </p>
      {msg && <p style={{ margin: '4px 0', color: msg.startsWith('Đã nhập') ? '#060' : '#b00' }}>{msg}</p>}
      {pending && p && (
        <div style={{ border: '2px solid #1f2937', background: '#fffef6', padding: 8, margin: '6px 0' }}>
          <b>Nhập ghi chú từ {pending.name}</b>
          <div>
            {p.added.length + p.same.length + p.conflicts.length} ghi chú trong file: <b>{p.added.length}</b> mới · <b>{p.same.length}</b> giống hệt ghi chú hiện có · <b style={{ color: p.conflicts.length ? '#b00' : undefined }}>{p.conflicts.length}</b> trùng (ID, frame) nhưng khác nội dung
            {pending.skipped > 0 && <> · bỏ qua {pending.skipped} dòng sai định dạng</>}.
          </div>
          {pending.otherJob !== null && (
            <div style={{ background: '#fdd', padding: 4, margin: '4px 0' }}>
              Tên file có vẻ là của <b>job {pending.otherJob}</b>, trong khi đang mở <b>job {jobId}</b>. Ghi chú sẽ được gán cho job {jobId}; chỉ nhập nếu đúng ý bạn.
            </div>
          )}
          {p.conflicts.length > 0 && (
            <details style={{ margin: '4px 0' }}>
              <summary style={{ cursor: 'pointer' }}>Xem {p.conflicts.length} ghi chú trùng</summary>
              <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
                <thead><tr style={{ textAlign: 'left' }}><th>ID</th><th>frame</th><th>hiện có</th><th>trong file</th></tr></thead>
                <tbody>{p.conflicts.slice(0, 50).map((c) => <tr key={`${c.num}:${c.frame}`} style={{ borderTop: '1px solid #ddd' }}><td>{c.num}</td><td>{c.frame}</td><td>{c.current}</td><td>{c.incoming}</td></tr>)}</tbody>
              </table>
              {p.conflicts.length > 50 && <div style={{ color: '#666' }}>…và {p.conflicts.length - 50} ghi chú nữa</div>}
            </details>
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 4 }}>
            <button className="cvla-primary" disabled={!p.added.length && !p.conflicts.length} onClick={() => commit(false)} title="Thêm ghi chú mới; ghi chú trùng giữ nguyên bản hiện có">Nhập — giữ ghi chú hiện có khi trùng</button>
            {p.conflicts.length > 0 && <button onClick={() => commit(true)} title="Thêm ghi chú mới và ghi đè các ghi chú trùng bằng nội dung trong file">Nhập — ghi đè ghi chú trùng</button>}
            <button onClick={() => setPending(null)}>Hủy</button>
          </div>
        </div>
      )}
      {list.length === 0 && <p style={{ color: '#666' }}>Chưa có ghi chú. Bật QC mode rồi gõ vào ô ghi chú của cột frame trong Batch Review, hoặc nhập từ file.</p>}
      {list.length > 0 && (
        <table style={{ borderCollapse: 'collapse', width: '100%' }}>
          <thead><tr style={{ textAlign: 'left' }}><th>ID</th><th>frame</th><th>note</th><th /></tr></thead>
          <tbody>
            {list.map((n) => (
              <tr key={`${n.num}:${n.frame}`} style={{ borderTop: '1px solid #ddd' }}>
                <td><b>{n.num}</b></td>
                <td><button onClick={() => onOpen(n.num, n.frame)} title="Mở object này ở frame đó">{n.frame}</button></td>
                <td>
                  <input
                    value={n.note} style={{ width: '100%' }}
                    onChange={(e) => qcStore.set(jobId, n.num, n.frame, e.target.value)}
                  />
                </td>
                <td><button title="Xóa ghi chú" onClick={() => qcStore.set(jobId, n.num, n.frame, '')}>×</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <QcCompare jobId={jobId} tracks={tracks} labels={labels} start={start} stop={stop} onOpen={onOpen} />
    </>
  );
}
