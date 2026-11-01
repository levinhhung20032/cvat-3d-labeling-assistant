import { useEffect, useRef, useSyncExternalStore } from 'react';
import { confirmStore } from './confirmStore';

/** Vẽ hộp xác nhận đang chờ (một hộp tại một thời điểm). Esc = Hủy, Enter = Đồng ý. */
export function ConfirmHost() {
  const c = useSyncExternalStore(confirmStore.subscribe, confirmStore.get);
  const okRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (c) okRef.current?.focus(); }, [c]);
  if (!c) return null;
  return (
    <div className="cvla-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) confirmStore.answer(false); }}>
      <div
        className="cvla-modal" role="alertdialog" aria-modal="true" aria-label={c.title ?? 'Xác nhận'}
        onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); confirmStore.answer(false); } }}
      >
        <b className="cvla-modal-title">{c.title ?? 'Xác nhận'}</b>
        <div className="cvla-modal-msg">{c.message}</div>
        <div className="cvla-modal-actions">
          <button onClick={() => confirmStore.answer(false)}>{c.cancelLabel ?? 'Hủy'}</button>
          <button ref={okRef} className={c.danger ? 'cvla-danger' : 'cvla-primary'} onClick={() => confirmStore.answer(true)}>{c.confirmLabel ?? 'Đồng ý'}</button>
        </div>
      </div>
    </div>
  );
}
