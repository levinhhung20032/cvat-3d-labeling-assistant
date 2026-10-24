import { useMemo } from 'react';
import { notesOfJob, notesToRows } from '../shared/qc';
import { buildXlsx } from '../shared/xlsx';
import type { CvatTrack } from '../shared/types';
import { QcCompare } from './QcCompare';
import { qcStore, useQcMode, useQcNotes } from './qcStore';

/** Danh sách ghi chú QC của job, xuất Excel (ID, frame, note), bật/tắt QC mode. */
export function QcPanel({ jobId, count, tracks, labels, start, stop, onOpen }: {
  jobId: number; count: number; tracks: CvatTrack[]; labels: string[]; start: number; stop: number; onOpen: (num: number, frame: number) => void;
}) {
  const all = useQcNotes();
  const mode = useQcMode();
  const list = useMemo(() => notesOfJob(all, jobId), [all, jobId]);

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

  return (
    <>
      <p style={{ margin: '4px 0' }}>
        <label style={{ fontWeight: 700 }}>
          <input type="checkbox" checked={mode} onChange={(e) => qcStore.setMode(e.target.checked)} /> QC mode
        </label>{' '}
        — bật thì mỗi cột frame trong Batch Review có ô ghi chú; ghi chú gắn với (ID object, frame) và lưu cục bộ, không gửi lên CVAT.
      </p>
      <p style={{ margin: '4px 0' }}>
        Job {jobId}: <b>{list.length}</b> ghi chú ({count} object).{' '}
        <button disabled={!list.length} onClick={exportXlsx} title="File .xlsx gồm 3 cột: ID, frame, note (không có toạ độ hay dữ liệu point cloud)">⬇ Xuất Excel (ID, frame, note)</button>
      </p>
      {list.length === 0 && <p style={{ color: '#666' }}>Chưa có ghi chú. Bật QC mode rồi gõ vào ô ghi chú của cột frame trong Batch Review.</p>}
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
