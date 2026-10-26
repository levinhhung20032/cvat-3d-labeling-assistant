import { useState } from 'react';
import type { UploadResult } from '../content/uploader';
import type { CvatAnnotations, CvatJob, CvatLabel } from '../shared/types';
import { post, rpc } from './bridge';
import { madeStore } from './madeStore';

/**
 * Xóa object do CHÍNH TOOL tạo khỏi CVAT. Chỉ ID nằm trong sổ object do tool tạo mới xóa được; object có sẵn trên server
 * không có đường nào để xóa. Mặc định chạy thử; xóa thật cần tick xác nhận. Không hoàn tác được trên CVAT (nội dung trước khi xóa
 * được ghi vào nhật ký cục bộ).
 */
export function DeleteDialog({ job, baseline, labels, ids, onClose, onDone }: {
  job: CvatJob; baseline: CvatAnnotations; labels: CvatLabel[]; ids: number[]; onClose: () => void; onDone: () => void;
}) {
  const [ok, setOk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const names = new Map(labels.map((l) => [l.id, l.name]));
  const rows = ids.map((id) => {
    const i = baseline.tracks.findIndex((t) => t.id === id);
    return { id, num: i + 1, label: i >= 0 ? names.get(baseline.tracks[i]!.label_id) ?? '?' : '?' };
  });

  const run = async (real: boolean) => {
    setBusy(true); setResult(null);
    const r = await rpc<UploadResult>((reqId) => ({
      type: 'deleteOwn', reqId,
      req: { real, ids, madeIds: madeStore.ids(job.id), baselineIds: baseline.tracks.map((t) => t.id!).filter((x) => typeof x === 'number') },
    }));
    setBusy(false); setResult(r);
    if (real && r.ok && r.sent && r.stage === 'done') {
      madeStore.remove(job.id, r.deletedIds ?? ids);
      window.setTimeout(() => { onDone(); post({ type: 'reloadCvat' }); }, 1500);
    }
  };

  return (
    <div style={{ border: '2px solid #b00', background: '#fff5f5', padding: 10, margin: '8px 0' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <b>Xóa object do tool tạo khỏi CVAT (job {job.id})</b>
        <button onClick={onClose} disabled={busy}>Đóng</button>
      </div>
      <p style={{ margin: '6px 0' }}>
        Sẽ xóa <b>{rows.length}</b> object: {rows.map((r) => `#${r.num} ${r.label} (db ${r.id})`).join(', ')}.
        Chỉ object do tool tạo mới xóa được; mọi object có sẵn trên server được giữ nguyên và tool kiểm tra lại bằng cách đọc server sau khi xóa.
        ID hiển thị của các object đứng sau chúng (nếu có) sẽ lùi lại.
      </p>
      <p style={{ margin: '6px 0' }}>
        <label><input type="checkbox" checked={ok} onChange={(e) => setOk(e.target.checked)} /> Tôi hiểu: xóa thật khỏi CVAT, không hoàn tác được từ tool.</label>
      </p>
      <div style={{ display: 'flex', gap: 8 }}>
        <button disabled={busy} onClick={() => run(false)}>Chạy thử (không gửi gì)</button>
        <button disabled={busy || !ok} onClick={() => run(true)} style={{ fontWeight: 700, background: ok ? '#ffd6d6' : undefined }}>🗑 Xóa khỏi CVAT</button>
      </div>
      {busy && <p>Đang xử lý…</p>}
      {result && (
        <div style={{ margin: '8px 0', padding: 6, border: `1px solid ${result.ok ? '#0a0' : '#b00'}`, background: result.ok ? '#e8ffe8' : '#fdd' }}>
          <b>{result.ok ? (result.sent ? 'Thành công' : 'Chạy thử đạt') : 'Không thành công'}</b> · bước: {result.stage}
          <div>{result.message}</div>
        </div>
      )}
    </div>
  );
}
