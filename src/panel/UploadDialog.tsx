import { useEffect, useMemo, useState } from 'react';
import type { UploadResult } from '../content/uploader';
import { outsideFrames, type ShiftTrackRec } from '../shared/shift';
import { buildUploadPlan } from '../shared/upload';
import type { CvatAnnotations, CvatJob, CvatLabel } from '../shared/types';
import { rpc } from './bridge';

interface LastInfo { time: string; tracks: number; reverted: boolean; verified: boolean }

/**
 * Màn hình xem lại trước khi upload. Mặc định là CHẠY THỬ (kiểm tra xung đột và luật, không gửi gì).
 * Ghi thật chỉ khi bạn tick xác nhận rồi bấm "Gửi lên CVAT". Chỉ gửi lệnh update, không bao giờ delete.
 */
export function UploadDialog({ baseline, working, job, labels, onClose, onReload, onUploaded }: {
  baseline: CvatAnnotations; working: CvatAnnotations; job: CvatJob; labels: CvatLabel[];
  onClose: () => void; onReload: () => void; onUploaded: (tracks: ShiftTrackRec[]) => void;
}) {
  const [bake, setBake] = useState(true);
  const [includeOthers, setIncludeOthers] = useState(false);
  const [okTilt, setOkTilt] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [last, setLast] = useState<LastInfo | null>(null);
  const [okRevert, setOkRevert] = useState(false);

  const plan = useMemo(() => buildUploadPlan(baseline, working, job.stop_frame, includeOthers, bake), [baseline, working, job, includeOthers, bake]);
  const names = useMemo(() => new Map(labels.map((l) => [l.id, l.name])), [labels]);
  const needTilt = plan.tiltFixed > 0;
  const nothing = plan.changed.length === 0;
  const blocked = plan.blockers.length > 0;

  // Ghi thành công và đã đọc lại khớp → tự đóng, nạp lại dữ liệu và quay về Batch Review.
  useEffect(() => {
    if (result?.ok && result.sent && result.stage === 'done') {
      const t = window.setTimeout(onReload, 1200);
      return () => window.clearTimeout(t);
    }
  }, [result]);

  useEffect(() => {
    void rpc<{ last: LastInfo | null }>((reqId) => ({ type: 'revertInfo', reqId })).then((r) => setLast(r.last));
  }, [result]);

  const run = async (real: boolean) => {
    setBusy(true);
    setResult(null);
    const r = await rpc<UploadResult>((reqId) => ({
      type: 'upload', reqId,
      req: { real, changed: plan.changed, expected: plan.expected, baselineIds: baseline.tracks.map((t) => t.id!), stopFrame: job.stop_frame },
    }));
    setBusy(false);
    setResult(r);
    if (real && r.ok && r.sent && r.stage === 'done') {
      // ghi nhận vào KPI của ca (nếu đang trong ca)
      onUploaded(plan.diffs.map((d, i) => ({
        num: d.index + 1, id: d.id, label: names.get(working.tracks[d.index]!.label_id) ?? '?',
        added: d.added, removed: d.removed, modified: d.modified, baked: d.baked, outsideFilled: d.outsideFilled,
        outsideBefore: outsideFrames(plan.expected[i]!, job.start_frame, job.stop_frame),
        outsideAfter: outsideFrames(plan.changed[i]!, job.start_frame, job.stop_frame),
      })));
    }
  };

  const revert = async (real: boolean) => {
    setBusy(true);
    setResult(null);
    const r = await rpc<UploadResult>((reqId) => ({ type: 'revert', reqId, real }));
    setBusy(false);
    setResult(r);
  };

  const canSend = !busy && !nothing && !blocked && (!needTilt || okTilt);
  const box: React.CSSProperties = { border: '2px solid #1f2937', background: '#fffef6', padding: 10, margin: '8px 0' };

  return (
    <div style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <b>Xem lại trước khi upload (job {job.id})</b>
        <button onClick={onClose} disabled={busy}>Đóng</button>
      </div>

      {nothing && !blocked && <p>Không có thay đổi nào cần gửi (mọi track đã giống CVAT{plan.others.tracks ? ', trừ các track chưa sửa còn thiếu keyframe outside' : ''}).</p>}

      {!nothing && (
        <table style={{ borderCollapse: 'collapse', margin: '6px 0' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>ID</th><th>Nhãn</th><th>+KF</th><th>−KF</th><th>~KF</th><th>thuộc tính</th><th>khoá thêm</th><th>outside tự điền</th><th>rx/ry→0</th>
            </tr>
          </thead>
          <tbody>
            {plan.diffs.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid #ddd' }}>
                <td><b>{d.index + 1}</b> <span style={{ color: '#999', fontSize: 10 }}>db {d.id}</span></td>
                <td>{names.get(working.tracks[d.index]!.label_id) ?? '?'}</td>
                <td>{d.added}</td><td>{d.removed}</td><td>{d.modified}</td><td>{d.attrs}</td><td>{d.baked}</td><td>{d.outsideFilled}</td><td>{d.tiltFixed}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        Sẽ gửi <b>{plan.changed.length}</b> track bằng <code>PATCH …/annotations?action=update</code>, mỗi lần tối đa 10 track.
        Không tạo / xóa track, ID giữ nguyên. Keyframe bị gỡ chỉ là bớt shape trong track đó.
      </div>

      {blocked && (
        <div style={{ background: '#fdd', border: '1px solid #b00', padding: 6, margin: '6px 0' }}>
          <b>Bị chặn:</b>
          <ul style={{ margin: '2px 0' }}>{plan.blockers.map((v, i) => <li key={i}>{v.message}</li>)}</ul>
        </div>
      )}

      <p style={{ margin: '6px 0' }}>
        <label>
          <input type="checkbox" checked={bake} onChange={(e) => setBake(e.target.checked)} />{' '}
          Tự <b>khoá hết thành keyframe</b> cho các object đã tác động (mọi frame có box thành keyframe, đường đi không đổi)
        </label>
      </p>
      {plan.others.tracks > 0 && (
        <p style={{ margin: '6px 0' }}>
          <label>
            <input type="checkbox" checked={includeOthers} onChange={(e) => setIncludeOthers(e.target.checked)} />{' '}
            Điền luôn keyframe outside cho <b>{plan.others.tracks}</b> track khác chưa sửa ({plan.others.frames} frame). Mặc định không đụng tới chúng.
          </label>
        </p>
      )}
      {needTilt && (
        <p style={{ margin: '6px 0', background: '#fff3cd', padding: 4 }}>
          <label>
            <input type="checkbox" checked={okTilt} onChange={(e) => setOkTilt(e.target.checked)} />{' '}
            Đồng ý đưa rx/ry về 0 ở <b>{plan.tiltFixed}</b> keyframe (box chỉ được xoay quanh trục z) — đây là thay đổi dữ liệu gốc.
          </label>
        </p>
      )}

      <div style={{ margin: '8px 0', display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center' }}>
        <button
          disabled={!canSend} onClick={() => run(true)}
          style={{ fontWeight: 700, background: canSend ? '#d7f7d7' : undefined }}
        >⬆ Gửi lên CVAT</button>
        <span style={{ fontSize: 11, color: '#555' }}>Tool vẫn tự kiểm tra xung đột / ID / luật trước khi ghi và lưu nhật ký để hoàn nguyên.</span>
      </div>
      <div style={{ fontSize: 11, color: '#555' }}>
        Thành công thì tool tự quay về Batch Review với dữ liệu mới. Hãy tải lại tab CVAT (F5) — <b>đừng bấm Save trong CVAT trước khi tải lại</b>, vì giao diện CVAT còn giữ bản cũ và có thể ghi đè.
      </div>

      {busy && <p>Đang xử lý…</p>}
      {result && (
        <div style={{ margin: '8px 0', padding: 6, border: `1px solid ${result.ok ? '#0a0' : '#b00'}`, background: result.ok ? '#e8ffe8' : '#fdd' }}>
          <b>{result.ok ? (result.sent ? 'Thành công' : 'Chạy thử đạt') : 'Không thành công'}</b> · bước: {result.stage}
          <div>{result.message}</div>
          {result.ok && result.sent && <button onClick={onReload}>Về Batch Review ngay</button>}
        </div>
      )}

      <hr />
      <b>Hoàn nguyên</b>
      {last ? (
        <div>
          Lần upload gần nhất: {new Date(last.time).toLocaleString()} · {last.tracks} track · {last.reverted ? 'đã hoàn nguyên' : last.verified ? 'đã xác minh khớp' : 'CHƯA xác minh'}.
          {!last.reverted && (
            <div style={{ margin: '6px 0', display: 'flex', gap: 8, alignItems: 'center' }}>
              <label><input type="checkbox" checked={okRevert} onChange={(e) => setOkRevert(e.target.checked)} /> xác nhận hoàn nguyên</label>
              <button disabled={busy || !okRevert} onClick={() => revert(true)}>Hoàn nguyên lần upload gần nhất</button>
            </div>
          )}
        </div>
      ) : <div style={{ color: '#666' }}>Chưa có lần upload nào được ghi nhật ký.</div>}
    </div>
  );
}
