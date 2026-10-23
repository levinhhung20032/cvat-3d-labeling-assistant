import { useEffect, useState } from 'react';
import { computeKpi, fmtDuration, kpiText, type Kpi, type Shift } from '../shared/shift';
import { shiftStore, useShifts } from './shiftStore';

function KpiView({ k }: { k: Kpi }) {
  const t = k.totals;
  return (
    <div>
      <table style={{ borderCollapse: 'collapse', margin: '4px 0' }}>
        <tbody>
          {[
            ['Thời lượng', fmtDuration(k.durationMin)],
            ['Số lần upload', k.uploads],
            ['Object đã tác động (đã upload)', `${t.objects}${Object.keys(k.byLabel).length ? ' — ' + Object.entries(k.byLabel).map(([l, n]) => `${l} ${n}`).join(', ') : ''}`],
            ['Frame outside của các object đó', `${t.outsideNow} (mới đặt trong ca ${t.outsideNew}, đưa trở lại ${t.outsideRestored})`],
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
          <thead><tr style={{ textAlign: 'left' }}><th>ID</th><th>Nhãn</th><th>upload</th><th>+KF</th><th>−KF</th><th>~KF</th><th>khoá</th><th>outside</th><th>mới</th><th>trở lại</th></tr></thead>
          <tbody>
            {k.objects.map((o) => (
              <tr key={`${o.jobId}:${o.num}`} style={{ borderTop: '1px solid #eee' }}>
                <td><b>{o.num}</b>{k.objects.some((x) => x.jobId !== o.jobId) ? <span style={{ color: '#999' }}> (job {o.jobId})</span> : ''}</td>
                <td>{o.label}</td><td>{o.uploads}</td><td>{o.added}</td><td>{o.removed}</td><td>{o.modified}</td><td>{o.baked}</td>
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

/** Tab "Ca / KPI": ca đang chạy (tính trực tiếp) và lịch sử các ca đã ra. */
export function ShiftPanel() {
  const { active, history } = useShifts();
  const [, tick] = useState(0);
  const [open, setOpen] = useState<string | null>(history[0]?.name ?? null);
  useEffect(() => {
    const t = window.setInterval(() => tick((x) => x + 1), 30000);
    return () => window.clearInterval(t);
  }, []);
  useEffect(() => { if (!active && history[0]) setOpen(history[0].name); }, [history.length]);

  const row = (s: Shift) => {
    const k = computeKpi(s);
    const isOpen = open === s.name;
    return (
      <div key={s.name} style={{ border: '1px solid #ccc', margin: '6px 0', padding: 6 }}>
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', cursor: 'pointer' }} onClick={() => setOpen(isOpen ? null : s.name)}>
          <b>{s.name}</b>
          <span style={{ color: '#555' }}>{new Date(s.start).toLocaleString()} · {fmtDuration(k.durationMin)} · {k.totals.objects} object · {k.totals.outsideNow} frame outside</span>
          {isOpen ? '▾' : '▸'}
        </div>
        {isOpen && (
          <>
            <KpiView k={k} />
            <div style={{ marginTop: 4 }}>
              <Copy text={kpiText(k)} />{' '}
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
        KPI tính từ những gì đã <b>upload</b> lên CVAT trong ca (object nào được tác động, bao nhiêu frame outside, số keyframe). Dữ liệu chỉ lưu trong trình duyệt này.
      </p>
      {active ? (
        <>
          <h4 style={{ margin: '6px 0' }}>Ca đang chạy</h4>
          {row(active)}
        </>
      ) : <p>Chưa vào ca. Bấm "▶ Vào ca" ở thanh trên.</p>}
      <h4 style={{ margin: '10px 0 0' }}>Lịch sử ({history.length})</h4>
      {history.length === 0 && <p style={{ color: '#666' }}>Chưa có ca nào kết thúc.</p>}
      {history.map(row)}
    </>
  );
}
