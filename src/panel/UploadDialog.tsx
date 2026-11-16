import { useEffect, useMemo, useRef, useState } from 'react';
import { scrollIntoPanel } from './scrollTo';
import type { UploadResult } from '../content/uploader';
import { changedFrames, firstSeen, lockedOutsideKeys, outsideFrames, type ShiftTrackRec } from '../shared/shift';
import { buildUploadPlan } from '../shared/upload';
import type { CvatAnnotations, CvatJob, CvatLabel } from '../shared/types';
import { post, rpc } from './bridge';
import { kv, storageHealth } from './storage';
import { madeStore } from './madeStore';

interface LastInfo { time: string; tracks: number; reverted: boolean; verified: boolean }

/**
 * Màn hình xem lại trước khi upload. Mặc định là CHẠY THỬ (kiểm tra xung đột và luật, không gửi gì).
 * Ghi thật chỉ khi bạn tick xác nhận rồi bấm "Gửi lên CVAT". Chỉ gửi lệnh update, không bao giờ delete.
 */
export function UploadDialog({ baseline, working, job, labels, onClose, onReload, onUploaded, onBeforeReload, onIgnoreFlags }: {
  baseline: CvatAnnotations; working: CvatAnnotations; job: CvatJob; labels: CvatLabel[];
  onClose: () => void; onReload: () => void; onUploaded: (tracks: ShiftTrackRec[]) => void;
  onIgnoreFlags: (nums: number[]) => void; // tick "bỏ qua toàn bộ flag": sau upload thành công, bỏ qua mọi flag của các object vừa upload
  onBeforeReload: () => void; // ngay trước khi tải lại tab CVAT: ghi lại chỗ đang làm để tool mở lại đúng chỗ
}) {
  const root = useRef<HTMLDivElement>(null);
  const resultBox = useRef<HTMLDivElement>(null);
  // Hộp thoại mở ở đầu panel: tự cuộn lên để thấy ngay (người dùng thường đang cuộn xuống ở các view); kết quả mới hiện ra cũng được cuộn tới.
  useEffect(() => { scrollIntoPanel(root.current); }, []);
  const [bake, setBake] = useState(true);
  const [includeOthers, setIncludeOthers] = useState(false);
  const [okTilt, setOkTilt] = useState(false);
  const [ignoreFlags, setIgnoreFlags] = useState(false); // chỉ áp cho lần upload này, mặc định tắt
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<UploadResult | null>(null);
  const [last, setLast] = useState<LastInfo | null>(null);
  const [okRevert, setOkRevert] = useState(false);
  const [autoReload, setAutoReloadState] = useState(() => { try { return kv.get('cvla-autoreload') !== '0'; } catch { return true; } });
  const setAutoReload = (v: boolean) => { setAutoReloadState(v); try { kv.set('cvla-autoreload', v ? '1' : '0'); } catch { /* bỏ qua */ } };

  const plan = useMemo(() => buildUploadPlan(baseline, working, job.stop_frame, includeOthers, bake), [baseline, working, job, includeOthers, bake]);
  const names = useMemo(() => new Map(labels.map((l) => [l.id, l.name])), [labels]);
  const needTilt = plan.tiltSet > 0;
  const nothing = plan.changed.length === 0 && plan.created.length === 0;
  const blocked = plan.blockers.length > 0;

  // Ghi thành công và đã đọc lại khớp → tự đóng, nạp lại dữ liệu và quay về Batch Review.
  useEffect(() => {
    if (result?.ok && result.sent && result.stage === 'done') {
      // Quay về Batch Review với dữ liệu mới; nếu bật tự tải lại thì tải lại tab CVAT ngay sau đó (tool tự mở lại).
      // (hẹn giờ lồng nhau để không bị hủy khi hộp thoại đóng lại sau onReload)
      const t = window.setTimeout(() => {
        onReload();
        if (autoReload) window.setTimeout(() => { onBeforeReload(); post({ type: 'reloadCvat' }); }, 600);
      }, 1200);
      return () => window.clearTimeout(t);
    }
  }, [result]);

  useEffect(() => { if (result) scrollIntoPanel(resultBox.current, 'nearest'); }, [result]);

  useEffect(() => {
    void rpc<{ last: LastInfo | null }>((reqId) => ({ type: 'revertInfo', reqId })).then((r) => setLast(r.last));
  }, [result]);

  const run = async (real: boolean) => {
    setBusy(true);
    setResult(null);
    const r = await rpc<UploadResult>((reqId) => ({
      type: 'upload', reqId,
      req: { real, changed: plan.changed, created: plan.created, expected: plan.expected, baselineIds: baseline.tracks.map((t) => t.id!), stopFrame: job.stop_frame },
    }));
    setBusy(false);
    setResult(r);
    if (r.sent && r.createdIds?.length) madeStore.add(job.id, r.createdIds); // ghi vào sổ object do tool tạo (chỉ những ID này xóa được bằng tool)
    if (real && r.ok && r.sent && r.stage === 'done') {
      if (ignoreFlags) onIgnoreFlags(plan.diffs.map((d) => d.index + 1));
      // ghi nhận vào KPI của ca (nếu đang trong ca)
      onUploaded(plan.diffs.map((d, i) => ({
        num: d.index + 1, id: d.id, label: names.get(working.tracks[d.index]!.label_id) ?? '?',
        added: d.added, removed: d.removed, modified: d.modified, baked: d.baked, outsideFilled: d.outsideFilled,
        changedFrames: changedFrames(plan.expected[i]!, plan.changed[i]!, job.start_frame, job.stop_frame),
        outsideBefore: outsideFrames(plan.expected[i]!, job.start_frame, job.stop_frame),
        outsideAfter: outsideFrames(plan.changed[i]!, job.start_frame, job.stop_frame),
        firstSeen: firstSeen(plan.changed[i]!, job.start_frame, job.stop_frame), stop: job.stop_frame,
        outsideKeys: lockedOutsideKeys(plan.expected[i]!, plan.changed[i]!, job.start_frame, job.stop_frame),
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
    <div ref={root} style={box}>
      <div style={{ display: 'flex', justifyContent: 'space-between' }}>
        <b>Xem lại trước khi upload (job {job.id})</b>
        <button onClick={onClose} disabled={busy}>Đóng</button>
      </div>

      {nothing && !blocked && <p>Không có thay đổi nào cần gửi (mọi track đã giống CVAT{plan.others.tracks ? ', trừ các track chưa sửa còn thiếu keyframe outside' : ''}).</p>}

      {!storageHealth().ok && (
        <p style={{ margin: '6px 0', background: '#ffe5e5', color: '#900', padding: 4, fontWeight: 600 }}>
          ⚠ Tool đang không lưu được dữ liệu: upload vẫn lên CVAT nhưng KPI của lần upload này sẽ KHÔNG được ghi vào ca. Nên tải lại tab CVAT (F5) trước.
        </p>
      )}
      {plan.created.length > 0 && (
        <p style={{ margin: '6px 0', background: '#dff5df', padding: 4 }}>
          🛠 Sẽ <b>tạo {plan.created.length} object mới</b> do tool tạo (PATCH <code>action=create</code>, nằm cuối danh sách nên ID của object cũ không đổi): {plan.createdInfo.map((c) => `#${c.index + 1} ${names.get(c.label_id) ?? '?'} (${c.shapes} keyframe)`).join(', ')}.
          Sau khi tạo, các object này được ghi vào sổ của tool và là loại DUY NHẤT tool cho phép xóa.
        </p>
      )}
      {!nothing && plan.changed.length > 0 && (
        <table style={{ borderCollapse: 'collapse', margin: '6px 0' }}>
          <thead>
            <tr style={{ textAlign: 'left' }}>
              <th>ID</th><th>Nhãn</th><th>+KF</th><th>−KF</th><th>~KF</th><th>thuộc tính</th><th>khoá thêm</th><th>outside tự điền</th><th>nghiêng (rx/ry)</th>
            </tr>
          </thead>
          <tbody>
            {plan.diffs.map((d) => (
              <tr key={d.id} style={{ borderTop: '1px solid #ddd' }}>
                <td><b>{d.index + 1}</b> <span style={{ color: '#999', fontSize: 10 }}>db {d.id}</span></td>
                <td>{names.get(working.tracks[d.index]!.label_id) ?? '?'}</td>
                <td>{d.added}</td><td>{d.removed}</td><td>{d.modified}</td><td>{d.attrs}</td><td>{d.baked}</td><td>{d.outsideFilled}</td><td>{d.tiltSet}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <div>
        Sẽ cập nhật <b>{plan.changed.length}</b> track bằng <code>PATCH …/annotations?action=update</code>{plan.created.length > 0 && <> và tạo <b>{plan.created.length}</b> object mới bằng <code>action=create</code></>}, mỗi lần tối đa 10 track.
        Không xóa track nào, ID cũ giữ nguyên. Keyframe bị gỡ chỉ là bớt shape trong track đó.
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
            Xác nhận ghi roll/pitch (rx/ry) ≠ 0 ở <b>{plan.tiltSet}</b> keyframe (box nghiêng theo mặt đường, tối đa ±30°). Quy ước góc là Euler XYZ như CVAT — hãy kiểm tra bằng mắt trên CVAT sau khi upload.
          </label>
        </p>
      )}

      {plan.changed.length > 0 && (
        <p style={{ margin: '6px 0' }}>
          <label>
            <input type="checkbox" checked={ignoreFlags} onChange={(e) => setIgnoreFlags(e.target.checked)} />{' '}
            Sau khi upload thành công, <b>bỏ qua toàn bộ flag</b> của {plan.changed.length} object vừa upload (D, ít điểm, đi xa bất thường, lỗi luật, trôi box, chồng lấn). Chỉ ẩn cảnh báo trong tool, không đổi dữ liệu nhãn; hoàn lại từng mục ở Batch Review.
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
        <label><input type="checkbox" checked={autoReload} onChange={(e) => setAutoReload(e.target.checked)} /> Sau khi upload thành công, <b>tự tải lại tab CVAT</b> rồi mở lại tool</label>{' '}
        (nếu CVAT đang có thay đổi chưa lưu, trình duyệt sẽ hỏi trước khi tải lại). Chưa tải lại thì <b>đừng bấm Save trong CVAT</b>, vì giao diện CVAT còn giữ bản cũ và có thể ghi đè.
      </div>

      {busy && <p>Đang xử lý…</p>}
      {result && (
        <div ref={resultBox} style={{ margin: '8px 0', padding: 6, border: `1px solid ${result.ok ? '#0a0' : '#b00'}`, background: result.ok ? '#e8ffe8' : '#fdd' }}>
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
