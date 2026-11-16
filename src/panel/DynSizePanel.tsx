import { Fragment, useMemo } from 'react';
import type { CvatLabel, CvatTrack } from '../shared/types';
import { defaultDyn, dynClassStore, dynRuleStore, useDynClasses, useDynRules } from './dynClassStore';
import { parseLabelSpecs } from '../shared/attributes';
import { attrRuleKey, ruleValues, type DynRule } from '../shared/dynrule';
import { kv } from './storage';

/**
 * Bảng công tắc Dynamic size theo class (+ theo giá trị attribute) của job. Dùng ở tab "Dynamic size" và ngay trong mục lỗi S của tab
 * Threshold (S chỉ xét object có Dynamic size TẮT), cùng một kho nên hai nơi luôn khớp nhau.
 */
export function DynClassTable({ jobId, labels, tracks }: { jobId: number; labels: CvatLabel[]; tracks: CvatTrack[] }) {
  const map = useDynClasses(jobId);
  const rules = useDynRules(jobId);
  const specs = useMemo(() => parseLabelSpecs(labels), [labels]);
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
      <table style={{ borderCollapse: 'collapse' }}>
        <thead><tr style={{ textAlign: 'left' }}><th>Class</th><th>Số object</th><th>Dynamic size</th></tr></thead>
        <tbody>
          {labels.map((l) => {
            const on = map[l.name] ?? defaultDyn(l.name);
            const attrs = (specs.get(l.id)?.attrs ?? []).filter((a) => ruleValues(a).length > 0);
            const nRules = attrs.reduce((n, a) => n + ruleValues(a).filter((v) => rules[attrRuleKey(l.name, a.name, v)]).length, 0);
            return (
              <Fragment key={l.id}>
              <tr style={{ borderTop: '1px solid #ddd' }}>
                <td><b>{l.name}</b></td>
                <td>{counts.get(l.id) ?? 0}</td>
                <td>
                  <label style={{ fontWeight: 600, color: on ? '#060' : '#a00' }}>
                    <input type="checkbox" checked={on} onChange={(e) => toggle(l, e.target.checked)} /> {on ? 'BẬT (nội suy)' : 'TẮT (một size cho cả object)'}
                  </label>
                </td>
              </tr>
              {attrs.length > 0 && (
                <tr>
                  <td colSpan={3} style={{ paddingLeft: 14, paddingBottom: 4 }}>
                    <details open={nRules > 0}>
                      <summary style={{ cursor: 'pointer', color: '#345' }}>Theo attribute{nRules > 0 ? ` (${nRules} luật)` : ''}</summary>
                      <table style={{ borderCollapse: 'collapse', margin: '2px 0' }}>
                        <tbody>
                          {attrs.map((a) => (
                            <tr key={a.id}>
                              <td style={{ paddingRight: 8, verticalAlign: 'top' }}><b>{a.name}</b></td>
                              <td>
                                {ruleValues(a).map((v) => {
                                  const key = attrRuleKey(l.name, a.name, v);
                                  return (
                                    <label key={v} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
                                      {v}{' '}
                                      <select value={rules[key] ?? ''} onChange={(e) => dynRuleStore.set(jobId, key, (e.target.value || null) as DynRule | null)}>
                                        <option value="">theo class</option>
                                        <option value="dyn">Dynamic</option>
                                        <option value="static">Static</option>
                                      </select>
                                    </label>
                                  );
                                })}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </details>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
  );
}

/** Tab "Dynamic size": bật / tắt theo class (danh sách class lấy từ job). Mỗi class có thể đặt thêm theo GIÁ TRỊ attribute (vd Two-wheels: rider state = false → static, true → dynamic). Công tắc riêng của từng object trong Batch Review luôn được ưu tiên hơn cả hai. */
export function DynSizePanel({ jobId, labels, tracks }: { jobId: number; labels: CvatLabel[]; tracks: CvatTrack[] }) {
  const names = useMemo(() => labels.map((l) => l.name), [labels]);
  return (
    <>
      <p style={{ margin: '4px 0' }}>
        <b>Dynamic size theo class</b> (job {jobId}). <b>Bật</b>: kích thước nội suy giữa các keyframe. <b>Tắt</b>: đổi kích thước ở một frame thì áp cho mọi keyframe của object.
        Danh sách class lấy từ job này (lần đầu mở job); mặc định lấy từ file setting (class có tên trùng), không có thì bật.
      </p>
      <DynClassTable jobId={jobId} labels={labels} tracks={tracks} />
      <p style={{ margin: '6px 0' }}>
        <button onClick={() => { dynClassStore.reset(jobId, names); dynRuleStore.reset(jobId); tracks.forEach((_, i) => { try { kv.remove(`cvla-dyn:${jobId}:${i + 1}`); } catch { /* bỏ qua */ } }); }}>Đặt lại mặc định</button>{' '}
        <span style={{ color: '#555' }}>Đổi công tắc class sẽ xóa công tắc riêng của các object thuộc class đó. Tắt dynamic size chỉ áp dụng cho lần sửa size tiếp theo (hoặc bấm "Đồng bộ size" trong Batch Review).</span>
      </p>
    </>
  );
}
