import { useMemo, useState } from 'react';
import { askConfirm } from './confirmStore';
import type { Shift } from '../shared/shift';
import { allocTargets, creditOf, suggestAlloc, type IdCredit } from '../shared/kpiCredit';
import { shiftStore, useCredits, useSchedule, useShifts } from './shiftStore';

const idText = (c: IdCredit, multiJob: boolean) => `#${c.num}${multiJob ? ` (job ${c.jobId})` : ''}`;

/**
 * Dồn KPI của ca OT sang ca sáng / chiều (kể cả ca sắp tới, tối đa 3 ngày tới). Đơn vị là ID: ca nhận được toàn bộ KPI của ID.
 * Chia nhỏ (tuỳ chọn): đủ chỉ tiêu một ca thì dồn sang ca sau. Tool chỉ GỢI Ý; phân bổ chỉ ghi khi người dùng bấm Xác nhận
 * (sửa được từng ID trước khi xác nhận).
 */
export function OtAllocator({ shift }: { shift: Shift }) {
  const credits = useCredits();
  const sch = useSchedule();
  const { active, history } = useShifts();
  const own = useMemo(() => credits.filter((c) => c.source === shift.name), [credits, shift.name]);
  const targets = useMemo(() => allocTargets([...(active ? [active] : []), ...history], new Date(), sch), [active, history, sch]);
  const [start, setStart] = useState(() => targets.find((t) => t.future)?.name ?? targets[0]?.name ?? '');
  const [split, setSplit] = useState(true);
  const [preview, setPreview] = useState<Record<string, string | null> | null>(null);
  const multiJob = new Set(own.map((c) => c.jobId)).size > 1;
  if (!own.length) return <p style={{ color: '#666', margin: '4px 0' }}>Ca OT này chưa có ID nào để dồn KPI (chỉ tính những gì đã upload; ID đã làm trước đó trong ngày thuộc ca đầu tiên đã làm).</p>;

  const mineKeys = new Set(own.map((c) => c.key));
  /** KPI ca `name` đã có, không kể các ID của ca OT này (đang được dồn lại). */
  const current = (name: string) => creditOf(credits, name).ids.filter((c) => !mineKeys.has(c.key)).reduce((n, c) => n + c.kpi, 0);
  const label = (name: string) => {
    const t = targets.find((x) => x.name === name);
    return `${name}${t?.future ? ' (sắp tới)' : ''} · ${current(name)}/${sch.kpiTarget}`;
  };
  const suggest = () => {
    const i = Math.max(0, targets.findIndex((t) => t.name === start));
    setPreview(suggestAlloc(own, targets.slice(i).map((t) => ({ name: t.name, current: current(t.name) })), sch.kpiTarget, split));
  };
  // Kết quả theo ca (hiện trạng hoặc theo bản xem trước).
  const byShift = (pick: (c: IdCredit) => string) => {
    const m = new Map<string, { kpi: number; rework: number; n: number }>();
    for (const c of own) {
      const to = pick(c);
      const e = m.get(to) ?? { kpi: 0, rework: 0, n: 0 };
      e.kpi += c.kpi;
      if (c.rework) e.rework += c.kpi;
      e.n++;
      m.set(to, e);
    }
    return [...m.entries()];
  };
  const summary = (rows: [string, { kpi: number; rework: number; n: number }][]) => rows.map(([to, e]) => (
    <span key={to} style={{ marginRight: 12, whiteSpace: 'nowrap' }}>
      <b>{to === shift.name ? `giữ ở ${shift.name}` : to}</b>: {e.n} ID · {e.kpi}{e.rework ? ` (rework ${e.rework})` : ''}
      {to !== shift.name && targets.some((t) => t.name === to) ? <span style={{ color: '#555' }}> → ca có {current(to) + e.kpi}/{sch.kpiTarget}</span> : null}
    </span>
  ));
  const assigned = own.some((c) => c.owner !== shift.name);

  return (
    <div style={{ border: '1px dashed #7c3aed', background: '#faf7ff', padding: 6, margin: '6px 0' }}>
      <b>Dồn KPI ca OT</b> <span style={{ color: '#555' }}>({own.length} ID · {own.reduce((n, c) => n + c.kpi, 0)} KPI)</span>
      <div style={{ margin: '4px 0' }}>Hiện tại: {summary(byShift((c) => c.owner))}</div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
        <label>Dồn vào ca{' '}
          <select value={start} onChange={(e) => { setStart(e.target.value); setPreview(null); }}>
            {targets.map((t) => <option key={t.name} value={t.name}>{label(t.name)}</option>)}
          </select>
        </label>
        <label title="Bật: đổ vào ca đã chọn cho tới khi đủ chỉ tiêu rồi sang ca kế tiếp (ID không bị cắt đôi). Tắt: dồn hết vào ca đã chọn.">
          <input type="checkbox" checked={split} onChange={(e) => { setSplit(e.target.checked); setPreview(null); }} /> chia nhỏ (đủ {sch.kpiTarget} thì sang ca sau)
        </label>
        <button onClick={suggest} disabled={!targets.length}>Gợi ý</button>
        {assigned && <button onClick={() => { void askConfirm({ title: 'Trả KPI về ca', message: `Trả toàn bộ KPI về ca ${shift.name}?`, confirmLabel: 'Trả hết' }).then((ok) => { if (ok) shiftStore.unassign(shift.name); }); }}>Trả hết về OT</button>}
      </div>
      {preview && (
        <div style={{ marginTop: 6 }}>
          <div style={{ marginBottom: 4 }}>Gợi ý (chưa ghi, sửa được từng ID): {summary(byShift((c) => preview[c.key] ?? shift.name))}</div>
          <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
            <thead><tr style={{ textAlign: 'left' }}><th>ID</th><th>Nhãn</th><th>KPI</th><th>Dồn vào</th></tr></thead>
            <tbody>
              {own.map((c) => (
                <tr key={c.key} style={{ borderTop: '1px solid #e5e0f5' }}>
                  <td>{idText(c, multiJob)}</td><td>{c.label}</td>
                  <td>{c.kpi}{c.rework ? <span style={{ color: '#7c2d12' }} title="Rework: sửa lại ID đã làm ở ngày trước (vẫn tính KPI)"> (rework)</span> : ''}</td>
                  <td>
                    <select value={preview[c.key] ?? ''} onChange={(e) => setPreview({ ...preview, [c.key]: e.target.value || null })}>
                      <option value="">giữ ở {shift.name}</option>
                      {targets.map((t) => <option key={t.name} value={t.name}>{t.name}{t.future ? ' (sắp tới)' : ''}</option>)}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div style={{ marginTop: 4 }}>
            <button className="cvla-primary" onClick={() => { shiftStore.assign(shift.name, preview); setPreview(null); }}>✔ Xác nhận dồn KPI</button>{' '}
            <button onClick={() => setPreview(null)}>Huỷ</button>
          </div>
        </div>
      )}
    </div>
  );
}
