import { useEffect, useState } from 'react';
import { computeKpi, fmtDuration, kpiText, type Kpi, type Shift } from '../shared/shift';
import { DEFAULT_SCHEDULE } from '../shared/schedule';
import { setSchedule, shiftStore, useCredits, useSchedule, useShifts } from './shiftStore';
import { creditOf } from '../shared/kpiCredit';
import { OtAllocator } from './OtAllocator';

function KpiView({ k, target }: { k: Kpi; target: number | null }) {
  const t = k.totals;
  return (
    <div>
      <table style={{ borderCollapse: 'collapse', margin: '4px 0' }}>
        <tbody>
          {[
            ['KPI thô (việc đã upload trong ca, chưa gộp ngày)', `${target ? `${t.kpi}/${target} (${Math.round((t.kpi / target) * 100)}%) · ` : ''}${t.kpi} = ${t.span} từ lúc ID xuất hiện (tính cả outside) + ${t.outsideLocked} KF outside đã khoá − ${t.dup} trùng`],
            ['Thời lượng', fmtDuration(k.durationMin)],
            ['Số lần upload', k.uploads],
            ['Object đã tác động (đã upload)', `${t.objects}${Object.keys(k.byLabel).length ? ' — ' + Object.entries(k.byLabel).map(([l, n]) => `${l} ${n}`).join(', ') : ''}`],
            ['Frame outside của các object đó', `${t.outsideNow} (mới đặt trong ca ${t.outsideNew}, đưa trở lại ${t.outsideRestored})`],
            ['Frame đã thay đổi (sửa tay, nội suy, outside, lưu outside thành keyframe)', t.framesChanged],
            ['Keyframe', `+${t.added} thêm · −${t.removed} gỡ · ~${t.modified} sửa · ${t.baked} khoá thêm`],
            ['Gợi ý', `chấp nhận ${k.accepted} · bỏ qua ${k.ignored}`],
            ['Thao tác sửa trong nháp', k.edits],
          ].map(([a, b]) => (
            <tr key={String(a)} style={{ borderTop: '1px solid #ddd' }}><td style={{ padding: '2px 14px 2px 0', color: '#555' }}>{a}</td><td><b>{b}</b></td></tr>
          ))}
        </tbody>
      </table>
      {k.objects.length > 0 && (
        <table style={{ borderCollapse: 'collapse', fontSize: 12 }}>
          <thead><tr style={{ textAlign: 'left' }}><th>ID</th><th>Nhãn</th><th title="span + KF outside khoá − trùng">KPI</th><th title="Số frame từ lúc ID xuất hiện tới hết job, tính cả outside">từ lúc xuất hiện</th><th title="Keyframe outside đã khoá trong ca (trừ phần trùng)">KF outside khoá</th><th>upload</th><th>frame đổi</th><th>+KF</th><th>−KF</th><th>~KF</th><th>khoá</th><th>outside</th><th>mới</th><th>trở lại</th></tr></thead>
          <tbody>
            {k.objects.map((o) => (
              <tr key={`${o.jobId}:${o.num}`} style={{ borderTop: '1px solid #eee' }}>
                <td><b>{o.num}</b>{k.objects.some((x) => x.jobId !== o.jobId) ? <span style={{ color: '#999' }}> (job {o.jobId})</span> : ''}</td>
                <td>{o.label}</td><td><b>{o.kpi}</b></td><td>{o.span}</td><td>{o.outsideLocked}{o.dup ? <span style={{ color: '#999' }}> (−{o.dup})</span> : ''}</td><td>{o.uploads}</td><td>{o.framesChanged}</td><td>{o.added}</td><td>{o.removed}</td><td>{o.modified}</td><td>{o.baked}</td>
                <td>{o.outsideNow}</td><td>{o.outsideNew}</td><td>{o.outsideRestored}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {k.pending.length > 0 && (
        <div style={{ background: '#fff3cd', padding: 4, marginTop: 4 }}>
          Đã sửa nhưng <b>chưa upload</b> (không tính vào KPI): object {k.pending.map((p) => p.split(':')[1]).join(', ')}
        </div>
      )}
    </div>
  );
}

function Copy({ text }: { text: string }) {
  const [done, setDone] = useState(false);
  return (
    <button onClick={() => { void navigator.clipboard?.writeText(text).then(() => { setDone(true); setTimeout(() => setDone(false), 1500); }); }}>
      {done ? 'Đã sao chép' : 'Sao chép'}
    </button>
  );
}

/** Lịch ca tự động: giờ bắt đầu / kết thúc ca sáng, ca chiều và số phút cảnh báo trước khi hết ca. */
function ScheduleEditor() {
  const sch = useSchedule();
  const time = (key: 'amStart' | 'amEnd' | 'pmStart' | 'pmEnd', label: string) => (
    <label>{label} <input type="time" value={sch[key]} onChange={(e) => e.target.value && setSchedule({ [key]: e.target.value })} /></label>
  );
  return (
    <details style={{ margin: '6px 0' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>Lịch ca tự động: sáng {sch.amStart}–{sch.amEnd} · chiều {sch.pmStart}–{sch.pmEnd} · cảnh báo trước {sch.warnMin} phút · chỉ tiêu KPI {sch.kpiTarget}/ca</summary>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px 14px', alignItems: 'center', padding: '6px 0' }}>
        {time('amStart', 'Ca sáng từ')}{time('amEnd', 'đến')}
        {time('pmStart', 'Ca chiều từ')}{time('pmEnd', 'đến')}
        <label>Cảnh báo trước <input type="number" min={1} max={120} value={sch.warnMin} onChange={(e) => setSchedule({ warnMin: Number(e.target.value) })} style={{ width: 56 }} /> phút</label>
        <label title="Chỉ tiêu KPI (frame) của mỗi ca sáng / chiều, hiện ở thanh tiến trình cạnh tên ca trên hàng đầu. OT không có chỉ tiêu.">Chỉ tiêu KPI mỗi ca <input type="number" min={1} max={100000} value={sch.kpiTarget} onChange={(e) => setSchedule({ kpiTarget: Number(e.target.value) })} style={{ width: 70 }} /> frame</label>
        <button onClick={() => setSchedule(DEFAULT_SCHEDULE)}>Về mặc định</button>
      </div>
      <p style={{ margin: 0, color: '#555' }}>Không cần chấm công: tool tự vào / ra ca theo giờ máy. Thời gian ngoài ca sáng và ca chiều (sau 17:30, trước 8:30, nghỉ trưa) tính là <b>OT</b>; ca OT được mở khi có thao tác đầu tiên và kết thúc ở thao tác cuối.</p>
    </details>
  );
}

/** Tab "Ca / KPI": ca đang chạy (tính trực tiếp) và lịch sử các ca đã kết thúc. */
export function ShiftPanel() {
  const { active, history } = useShifts();
  const sch = useSchedule();
  const credits = useCredits();
  const [, tick] = useState(0);
  const [open, setOpen] = useState<string | null>(history[0]?.name ?? null);
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => { if (!active && history[0]) setOpen(history[0].name); }, [history.length]);

  const row = (s: Shift) => {
    const k = computeKpi(s);
    const cr = creditOf(credits, s.name);
    const ot = s.slot === 'OT';
    const given = credits.filter((c) => c.source === s.name && c.owner !== s.name);
    const isOpen = open === s.name;
    return (
      <div key={s.name} style={{ border: '1px solid #ccc', margin: '6px 0', padding: 6 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : s.name)}>
          <b>{s.name}</b>
          <span style={{ color: '#555' }}>{new Date(s.start).toLocaleString()} · {fmtDuration(k.durationMin)} · KPI <b>{cr.kpi}</b>{ot ? '' : `/${sch.kpiTarget}`}{cr.rework ? ` · rework ${cr.rework}` : ''}{given.length ? ` · đã dồn ${given.length} ID` : ''} · {k.totals.objects} object · {k.totals.outsideNow} frame outside</span>
          {isOpen ? '▾' : '▸'}
        </div>
        {isOpen && (
          <>
            <p style={{ margin: '4px 0', background: '#f1f7ee', padding: 4 }}>
              <b>KPI ghi cho ca: {cr.kpi}{ot ? '' : `/${sch.kpiTarget} (${Math.round((cr.kpi / sch.kpiTarget) * 100)}%)`}</b>
              {cr.rework ? <> · trong đó rework <b>{cr.rework}</b> (sửa lại ID đã làm ở ngày trước)</> : null}
              {cr.fromOthers ? <> · gồm {cr.fromOthers} ID dồn từ OT</> : null}
              {given.length ? <> · đã dồn {given.length} ID ({given.reduce((n, c) => n + c.kpi, 0)}) sang {[...new Set(given.map((c) => c.owner))].join(', ')}</> : null}
              <br /><span style={{ color: '#555', fontSize: 12 }}>Mỗi ID tính một lần mỗi ngày, cho ca đầu tiên của ngày đã làm ID đó. Bảng dưới là toàn bộ việc đã upload trong ca (chưa gộp).</span>
            </p>
            {ot && <OtAllocator shift={s} />}
            <KpiView k={k} target={null} />
            <div style={{ marginTop: 4 }}>
              <Copy text={`KPI ghi cho ca ${s.name}: ${cr.kpi}${ot ? '' : `/${sch.kpiTarget}`}${cr.rework ? ` · rework ${cr.rework}` : ''}${cr.fromOthers ? ` · gồm ${cr.fromOthers} ID dồn từ OT` : ''}${given.length ? ` · đã dồn ${given.length} ID sang ${[...new Set(given.map((c) => c.owner))].join(', ')}` : ''}
${kpiText(k)}`} />{' '}
              {s.end && <button onClick={() => { if (confirm(`Xóa ca ${s.name} khỏi lịch sử?`)) shiftStore.remove(s.name); }}>Xóa khỏi lịch sử</button>}
            </div>
          </>
        )}
      </div>
    );
  };

  return (
    <>
      <p style={{ margin: '4px 0', color: '#555' }}>
        KPI tính từ những gì đã <b>upload</b> lên CVAT: với mỗi ID, số frame từ lúc ID xuất hiện tới hết job (tính cả outside),
        cộng số keyframe outside đã khoá, trừ frame trùng. Mỗi ID tính <b>một lần mỗi ngày</b> cho ca đầu tiên của ngày đã làm ID đó; sửa lại ID ở ngày
        sau là <b>rework</b> (vẫn tính KPI, hiện riêng để biết). KPI ca OT dồn được sang ca sáng / chiều (kể cả ca trong 3 ngày tới).
        Chỉ lưu ca của hôm nay và <b>3 ngày đi làm gần nhất</b> (ngày không làm không tính). Dữ liệu chỉ lưu trong trình duyệt này.
      </p>
      <ScheduleEditor />
      {(() => {
        // Ca chưa mở nhưng đã nhận KPI dồn từ OT.
        const known = new Set([...(active ? [active.name] : []), ...history.map((h) => h.name)]);
        const future = [...new Set(credits.map((c) => c.owner))].filter((n) => !known.has(n));
        return future.length ? (
          <p style={{ margin: '4px 0', background: '#faf7ff', padding: 4 }}>
            Ca sắp tới đã nhận KPI dồn từ OT: {future.map((n) => { const c = creditOf(credits, n); return <span key={n} style={{ marginRight: 12 }}><b>{n}</b> {c.kpi}/{sch.kpiTarget}{c.rework ? ` (rework ${c.rework})` : ''}</span>; })}
          </p>
        ) : null;
      })()}
      {active ? (
        <>
          <h4 style={{ margin: '6px 0' }}>Ca đang chạy</h4>
          {row(active)}
        </>
      ) : <p style={{ color: '#666' }}>Chưa có ca đang chạy (ngoài giờ ca sáng / chiều; ca OT sẽ tự mở khi bạn có thao tác đầu tiên).</p>}
      <h4 style={{ margin: '10px 0 0' }}>Lịch sử ({history.length})</h4>
      {history.length === 0 && <p style={{ color: '#666' }}>Chưa có ca nào kết thúc.</p>}
      {history.map(row)}
    </>
  );
}
