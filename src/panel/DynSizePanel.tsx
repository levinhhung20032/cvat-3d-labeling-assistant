import { useMemo } from 'react';
import type { CvatLabel, CvatTrack } from '../shared/types';
import { defaultDyn, dynClassStore, useDynClasses } from './dynClassStore';
import { kv } from './storage';

/** Tab "Dynamic size": bật / tắt theo class (danh sách class lấy từ job). Object có công tắc riêng trong Batch Review sẽ ưu tiên công tắc riêng. */
export function DynSizePanel({ jobId, labels, tracks }: { jobId: number; labels: CvatLabel[]; tracks: CvatTrack[] }) {
  const map = useDynClasses(jobId);
  const names = useMemo(() => labels.map((l) => l.name), [labels]);
  const counts = useMemo(() => {
    const m = new Map<number, number>();
    for (const t of tracks) m.set(t.label_id, (m.get(t.label_id) ?? 0) + 1);
    return m;
  }, [tracks]);

  /** Đổi công tắc của class; bỏ công tắc riêng của các object thuộc class đó để cài đặt có hiệu lực ngay. */
  const toggle = (l: CvatLabel, on: boolean) => {
    dynClassStore.set(jobId, l.name, on);
    tracks.forEach((t, i) => { if (t.label_id === l.id) { try { kv.remove(`cvla-dyn:${jobId}:${i + 1}`); } catch { /* bỏ qua */ } } });
  };

  return (
    <>
      <p style={{ margin: '4px 0' }}>
        <b>Dynamic size theo class</b> (job {jobId}). <b>Bật</b>: kích thước nội suy giữa các keyframe. <b>Tắt</b>: đổi kích thước ở một frame thì áp cho mọi keyframe của object.
        Danh sách class lấy từ job này (lần đầu mở job); mặc định tắt cho Vehicle / Obstacle, bật cho các class còn lại.
      </p>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left' }}><th>Class</th><th>Số object</th><th>Dynamic size</th></tr></thead>
        <tbody>
          {labels.map((l) => {
            const on = map[l.name] ?? defaultDyn(l.name);
            return (
              <tr key={l.id} style={{ borderTop: '1px solid #ddd' }}>
                <td><b>{l.name}</b></td>
                <td>{counts.get(l.id) ?? 0}</td>
                <td>
                  <label style={{ fontWeight: 600, color: on ? '#060' : '#a00' }}>
                    <input type="checkbox" checked={on} onChange={(e) => toggle(l, e.target.checked)} /> {on ? 'BẬT (nội suy)' : 'TẮT (một size cho cả object)'}
                  </label>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <p style={{ margin: '6px 0' }}>
        <button onClick={() => { dynClassStore.reset(jobId, names); tracks.forEach((_, i) => { try { kv.remove(`cvla-dyn:${jobId}:${i + 1}`); } catch { /* bỏ qua */ } }); }}>Đặt lại mặc định</button>{' '}
        <span style={{ color: '#555' }}>Đổi công tắc class sẽ xóa công tắc riêng của các object thuộc class đó. Tắt dynamic size chỉ áp dụng cho lần sửa size tiếp theo (hoặc bấm "Đồng bộ size" trong Batch Review).</span>
      </p>
    </>
  );
}
