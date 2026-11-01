import { useEffect, useState } from 'react';
import { ACTIONS, assign, comboOf, conflictOf, prettyCombo, unassign } from '../shared/keymap';
import { applyKeymap, setCapturing, useCurrentKeymap } from './actions';
import { keyTarget } from './bridge';
import { askConfirm } from './confirmStore';

/**
 * Menu chuột phải của một nút ở Batch Review: gán phím tắt mới, gỡ từng phím, gỡ hết phím của thao tác đó
 * (cùng dữ liệu với tab Phím tắt). Vị trí (x, y) tính theo khung bọc có position: relative.
 */
export function KeyBindMenu({ id, x, y, maxW, onClose }: { id: string; x: number; y: number; maxW: number; onClose: () => void }) {
  const map = useCurrentKeymap();
  const [capturing, setCap] = useState(false);
  const [note, setNote] = useState('');
  const def = ACTIONS.find((a) => a.id === id);
  const keys = map[id] ?? [];
  const label = (aid: string | null) => ACTIONS.find((a) => a.id === aid)?.label ?? aid ?? '';

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !capturing) onClose(); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [capturing, onClose]);

  useEffect(() => {
    if (!capturing) return;
    setCapturing(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCap(false); setNote('Đã hủy.'); return; }
      const combo = comboOf(e);
      if (!combo) return; // mới chỉ bấm phím bổ trợ, chờ phím chính
      setCap(false);
      void (async () => {
        const c = conflictOf(map, id, combo);
        if ((c.action || c.reserved) && !await askConfirm({
          title: `Phím ${prettyCombo(combo)} đang vướng`,
          message: `${c.action ? `Đã dùng cho "${label(c.action)}" (thay thế sẽ gỡ khỏi thao tác đó).` : ''}${c.action && c.reserved ? '\n' : ''}${c.reserved ? `Trùng phím có sẵn (${c.reserved}).` : ''}`,
          confirmLabel: 'Vẫn gán', danger: true,
        })) { setNote('Đã hủy, phím giữ nguyên.'); return; }
        const r = assign(map, id, combo);
        applyKeymap(r.map);
        setNote(`Đã gán ${prettyCombo(combo)}${r.stolenFrom ? ` (gỡ khỏi "${label(r.stolenFrom)}")` : ''}.`);
      })();
    };
    const kt = keyTarget();
    kt.addEventListener('keydown', onKey as EventListener, true);
    return () => { kt.removeEventListener('keydown', onKey as EventListener, true); setCapturing(false); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [capturing, map, id]);

  return (
    <>
      <div className="cvla-backdrop" onClick={() => { if (!capturing) onClose(); }} onContextMenu={(e) => { e.preventDefault(); if (!capturing) onClose(); }} />
      <div className="cvla-menu cvla-ctxmenu" role="menu" aria-label="Phím tắt của nút" style={{ left: Math.max(0, Math.min(x, maxW - 300)), top: y, right: 'auto', minWidth: 280 }}>
        <h4>Phím tắt · {def?.label ?? id}</h4>
        {keys.length === 0 && <div style={{ opacity: .7 }}>Chưa gán phím nào.</div>}
        {keys.map((c) => (
          <button key={c} role="menuitem" disabled={capturing} onClick={() => { applyKeymap(unassign(map, id, c)); setNote(`Đã gỡ ${prettyCombo(c)}.`); }} title="Gỡ phím này khỏi thao tác">
            × Gỡ phím <b>{prettyCombo(c)}</b>
          </button>
        ))}
        <button role="menuitem" className={capturing ? 'cvla-primary' : undefined} onClick={() => { setNote(''); setCap((v) => !v); }} title="Bấm xong rồi nhấn tổ hợp phím muốn dùng (Esc để hủy)">
          {capturing ? '● Bấm phím muốn gán… (Esc hủy)' : '＋ Gán phím mới…'}
        </button>
        {keys.length > 1 && (
          <button role="menuitem" disabled={capturing} onClick={() => { applyKeymap({ ...map, [id]: [] }); setNote('Đã gỡ mọi phím của thao tác này.'); }}>🗑 Gỡ tất cả phím</button>
        )}
        {note && <div style={{ color: '#7a4b00' }}>{note}</div>}
        <hr />
        <button role="menuitem" onClick={onClose}>Đóng</button>
      </div>
    </>
  );
}
