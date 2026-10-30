import { useEffect, useState } from 'react';
import { ACTIONS, assign, comboOf, conflictOf, defaultKeymap, duplicateCombos, prettyCombo, unassign, type Keymap } from '../shared/keymap';
import { setCapturing } from './actions';
import { keyTarget } from './bridge';

/** Gán phím tùy ý cho từng thao tác. Bấm "+ thêm phím" rồi bấm tổ hợp phím muốn dùng (Esc để hủy). */
export function KeysPanel({ map, setMap }: { map: Keymap; setMap: (m: Keymap) => void }) {
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [note, setNote] = useState('');
  // Phím vừa bấm bị vướng: chờ người dùng xác nhận thay thế hoặc hủy.
  const [pending, setPending] = useState<{ id: string; combo: string; action: string | null; reserved: string | null } | null>(null);
  const label = (id: string | null) => ACTIONS.find((a) => a.id === id)?.label ?? id ?? '';
  const doAssign = (id: string, combo: string) => {
    const r = assign(map, id, combo);
    setMap(r.map);
    setNote(`Đã gán ${prettyCombo(combo)}${r.stolenFrom ? ` (gỡ khỏi "${label(r.stolenFrom)}")` : ''}.`);
    setPending(null);
  };
  const dups = duplicateCombos(map);

  useEffect(() => {
    if (!capturingId) return;
    setCapturing(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturingId(null); setNote('Đã hủy.'); return; }
      const combo = comboOf(e);
      if (!combo) return; // mới chỉ bấm phím bổ trợ, chờ phím chính
      const c = conflictOf(map, capturingId, combo);
      if (c.action || c.reserved) { setPending({ id: capturingId, combo, ...c }); setNote(''); }
      else doAssign(capturingId, combo);
      setCapturingId(null);
    };
    const kt = keyTarget();
    kt.addEventListener('keydown', onKey as EventListener, true);
    return () => { kt.removeEventListener('keydown', onKey as EventListener, true); setCapturing(false); };
  }, [capturingId, map]);

  return (
    <>
      <p style={{ margin: '4px 0' }}>
        Phím tắt chỉ hoạt động khi con trỏ đang ở trong cửa sổ tool (không phải trang CVAT). Mỗi thao tác gán được nhiều phím; một phím chỉ thuộc một thao tác.
      </p>
      {dups.length > 0 && (
        <p style={{ color: '#b00', fontWeight: 600 }}>
          ⚠ Phím đang gán trùng: {dups.map(([c, ids]) => `${prettyCombo(c)} (${ids.map(label).join(' / ')})`).join('; ')}
        </p>
      )}
      {pending && (
        <p style={{ background: '#fff3cd', border: '1px solid #e0b000', padding: '4px 8px' }}>
          <b>{prettyCombo(pending.combo)}</b> đang vướng:{' '}
          {pending.action && <>đã dùng cho "<b>{label(pending.action)}</b>" (thay thế sẽ gỡ khỏi thao tác đó). </>}
          {pending.reserved && <>trùng phím có sẵn ({pending.reserved}). </>}
          <button onClick={() => doAssign(pending.id, pending.combo)}>Vẫn gán</button>{' '}
          <button onClick={() => { setPending(null); setNote('Đã hủy, phím giữ nguyên.'); }}>Hủy</button>
        </p>
      )}
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {ACTIONS.map((a) => (
            <tr key={a.id} style={{ borderTop: '1px solid #ddd' }}>
              <td style={{ padding: '4px 12px 4px 0' }}>{a.label}</td>
              <td>
                {(map[a.id] ?? []).map((c) => (
                  <span key={c} title={conflictOf(map, a.id, c).reserved ?? undefined} style={{ display: 'inline-block', background: conflictOf(map, a.id, c).reserved ? '#fff3cd' : '#eef', border: '1px solid #99c', borderRadius: 3, padding: '0 6px', margin: '0 4px 0 0' }}>
                    <b>{prettyCombo(c)}</b>{' '}
                    <button title="Gỡ phím này" style={{ border: 0, background: 'transparent', cursor: 'pointer' }} onClick={() => setMap(unassign(map, a.id, c))}>×</button>
                  </span>
                ))}
                {(map[a.id] ?? []).length === 0 && <i style={{ color: '#888' }}>chưa gán </i>}
                <button
                  onClick={() => { setCapturingId(capturingId === a.id ? null : a.id); setNote(''); }}
                  style={{ fontWeight: capturingId === a.id ? 700 : 400, background: capturingId === a.id ? '#ffe9a8' : undefined }}
                >
                  {capturingId === a.id ? '● bấm phím…' : '+ thêm phím'}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 8 }}>
        <button onClick={() => { setMap(defaultKeymap()); setNote('Đã khôi phục phím mặc định.'); }}>Khôi phục mặc định</button>{' '}
        <span style={{ color: '#7a4b00' }}>{note}</span>
      </p>
    </>
  );
}
