import { useEffect, useState } from 'react';
import { ACTIONS, assign, comboOf, defaultKeymap, prettyCombo, unassign, type Keymap } from '../shared/keymap';
import { setCapturing } from './actions';

/** Gán phím tùy ý cho từng thao tác. Bấm "+ thêm phím" rồi bấm tổ hợp phím muốn dùng (Esc để hủy). */
export function KeysPanel({ map, setMap }: { map: Keymap; setMap: (m: Keymap) => void }) {
  const [capturingId, setCapturingId] = useState<string | null>(null);
  const [note, setNote] = useState('');

  useEffect(() => {
    if (!capturingId) return;
    setCapturing(true);
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.key === 'Escape') { setCapturingId(null); setNote('Đã hủy.'); return; }
      const combo = comboOf(e);
      if (!combo) return; // mới chỉ bấm phím bổ trợ, chờ phím chính
      const r = assign(map, capturingId, combo);
      setMap(r.map);
      const taken = r.stolenFrom ? ACTIONS.find((a) => a.id === r.stolenFrom)?.label : null;
      setNote(`Đã gán ${prettyCombo(combo)}${taken ? ` (lấy từ "${taken}")` : ''}.`);
      setCapturingId(null);
    };
    window.addEventListener('keydown', onKey, true);
    return () => { window.removeEventListener('keydown', onKey, true); setCapturing(false); };
  }, [capturingId, map]);

  return (
    <>
      <p style={{ margin: '4px 0' }}>
        Phím tắt chỉ hoạt động khi con trỏ đang ở trong cửa sổ tool (không phải trang CVAT). Mỗi thao tác gán được nhiều phím; một phím chỉ thuộc một thao tác.
      </p>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {ACTIONS.map((a) => (
            <tr key={a.id} style={{ borderTop: '1px solid #ddd' }}>
              <td style={{ padding: '4px 12px 4px 0' }}>{a.label}</td>
              <td>
                {(map[a.id] ?? []).map((c) => (
                  <span key={c} style={{ display: 'inline-block', background: '#eef', border: '1px solid #99c', borderRadius: 3, padding: '0 6px', margin: '0 4px 0 0' }}>
                    <b>{prettyCombo(c)}</b>{' '}
                    <button title="Gỡ phím này" style={{ border: 0, background: 'transparent', cursor: 'pointer' }} onClick={() => setMap(unassign(map, a.id, c))}>×</button>
                  </span>
                ))}
                {(map[a.id] ?? []).length === 0 && <i style={{ color: '#b00' }}>chưa gán </i>}
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
