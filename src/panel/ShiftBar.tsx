import { useEffect, useState } from 'react';
import { computeKpi, fmtDuration } from '../shared/shift';
import { SLOT_LABEL, endWarning, minutesLeft, slotAt } from '../shared/schedule';
import { shiftStore, useSchedule, useShifts } from './shiftStore';

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
  return (
    <button
      onClick={onOpen}
      className={warn ? 'cvla-shift cvla-shift-warn' : info.slot === 'OT' ? 'cvla-shift cvla-shift-ot' : 'cvla-shift'}
      title={`Ca tự động theo lịch (sáng ${sch.amStart}–${sch.amEnd}, chiều ${sch.pmStart}–${sch.pmEnd}; ngoài giờ tính OT). Bấm để xem KPI của ca.`}
    >● {text}</button>
  );
}

/** Cảnh báo khi còn ≤ warnMin phút là hết ca sáng / chiều, nhắc upload phần đang làm. */
export function ShiftBanner({ pending, onUpload }: { pending: number; onUpload: () => void }) {
  const now = useClock();
  const sch = useSchedule();
  const w = endWarning(now, sch);
  if (!w) return null;
  return (
    <div role="alert" style={{ background: '#fff3cd', border: '1px solid #e0b000', color: '#5a4300', padding: '4px 8px', margin: '6px 0', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
      <b>⏰ Còn {w.minutesLeft} phút là hết {SLOT_LABEL[w.slot]} ({hm(w.endsAt)}).</b>
      {pending > 0
        ? <span>Đang có <b>{pending}</b> frame chưa upload.</span>
        : <span>Hãy hoàn tất và kiểm tra phần đang làm.</span>}
      {pending > 0 && <button className="cvla-primary" onClick={onUpload}>⬆ Upload ngay</button>}
    </div>
  );
}
