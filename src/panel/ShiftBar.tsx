import { useEffect, useState } from 'react';
import { Notice } from './Notice';
import { Icon } from './Icon';
import { computeKpi, fmtDuration } from '../shared/shift';
import { SLOT_LABEL, endWarning, minutesLeft, slotAt } from '../shared/schedule';
import { shiftStore, useCredits, useSchedule, useShifts } from './shiftStore';
import { creditOf } from '../shared/kpiCredit';

/** Đồng hồ nội bộ: mỗi 15 giây đồng bộ ca theo lịch và vẽ lại (vào / ra ca tự động). */
function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    shiftStore.sync(new Date());
    const t = window.setInterval(() => { const d = new Date(); shiftStore.sync(d); setNow(d); }, 15000);
    return () => window.clearInterval(t);
  }, []);
  return now;
}

const hm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtLeft = (m: number) => (m >= 60 ? `${Math.floor(m / 60)} giờ ${m % 60} phút` : `${m} phút`);

/** Thẻ ca hiện tại ở thanh đầu: tên ca, thời gian còn lại (ca sáng / chiều) hoặc thời gian OT; bấm để mở tab Ca / KPI. */
export function ShiftBadge({ onOpen }: { onOpen: () => void }) {
  const now = useClock();
  const sch = useSchedule();
  const { active } = useShifts();
  const info = slotAt(now, sch);
  const left = minutesLeft(now, sch);
  const warn = endWarning(now, sch);
  const kpi = active ? computeKpi(active, now) : null;
  const text = info.slot === 'OT'
    ? `OT${active && active.slot === 'OT' ? ` · ${fmtDuration(kpi!.durationMin)}` : ' · chưa có thao tác'}`
    : `${SLOT_LABEL[info.slot]} ${info.name} · còn ${fmtLeft(left ?? 0)}`;
  // Tiến trình KPI của ca đang chạy (KPI ghi cho ca: không tính lặp trong ngày, gồm KPI dồn từ OT và rework):
  // ca sáng / chiều so với chỉ tiêu, OT chỉ hiện số đã làm.
  const credits = useCredits();
  const cr = active ? creditOf(credits, active.name) : null;
  const done = cr?.kpi ?? 0;
  const rework = cr?.rework ?? 0;
  const hasTarget = info.slot !== 'OT';
  const pct = hasTarget ? Math.min(100, Math.round((done / sch.kpiTarget) * 100)) : 0;
  const reached = hasTarget && done >= sch.kpiTarget;
  return (
    <>
      <button
        onClick={onOpen}
        className={warn ? 'cvla-shift cvla-shift-warn' : info.slot === 'OT' ? 'cvla-shift cvla-shift-ot' : 'cvla-shift'}
        title={`Ca tự động theo lịch (sáng ${sch.amStart}–${sch.amEnd}, chiều ${sch.pmStart}–${sch.pmEnd}; ngoài giờ tính OT). Bấm để xem KPI của ca.`}
      >● {text}</button>
      <span
        onClick={onOpen}
        style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginLeft: 6, cursor: 'pointer', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: reached ? '#14532d' : undefined, fontWeight: reached ? 700 : 400 }}
        title={hasTarget
          ? `KPI ca này: ${done}/${sch.kpiTarget} frame (${pct}%)${rework ? `, trong đó rework ${rework}` : ''}. Tính từ những gì đã upload; ID đã làm trong ngày không tính lặp; gồm KPI dồn từ OT. Chỉ tiêu sửa ở tab Ca / KPI.`
          : `KPI ca OT: ${done} frame${rework ? `, trong đó rework ${rework}` : ''} (OT không có chỉ tiêu; dồn sang ca khác ở tab Ca / KPI).`}
      >
        KPI {hasTarget ? (
          <>
            <progress value={Math.min(done, sch.kpiTarget)} max={sch.kpiTarget} style={{ width: 70, height: 10 }} />
            <span style={{ display: 'inline-block', minWidth: '6.5em' }}>{done}/{sch.kpiTarget}{reached ? ' ✓' : ` · ${pct}%`}</span>
          </>
        ) : <span style={{ display: 'inline-block', minWidth: '3em' }}>{done}</span>}
        {rework > 0 && <span style={{ color: '#7c2d12' }} title="Phần rework trong KPI: sửa lại ID đã làm ở ngày trước (đã tính vào KPI)">· R {rework}</span>}
      </span>
    </>
  );
}

/** Cảnh báo khi còn ≤ warnMin phút là hết ca sáng / chiều, nhắc upload phần đang làm. */
export function ShiftBanner({ pending, onUpload }: { pending: number; onUpload: () => void }) {
  const now = useClock();
  const sch = useSchedule();
  const w = endWarning(now, sch);
  if (!w) return null;
  return (
    <Notice tone="warn" actions={pending > 0 ? <button className="cvla-primary" onClick={onUpload}><Icon name="upload" />Upload ngay</button> : undefined}>
      <b><Icon name="clock" /> Còn {w.minutesLeft} phút là hết {SLOT_LABEL[w.slot]} ({hm(w.endsAt)}).</b>
      {pending > 0
        ? <span>Đang có <b>{pending}</b> frame chưa upload.</span>
        : <span>Hãy hoàn tất và kiểm tra phần đang làm.</span>}
    </Notice>
  );
}
