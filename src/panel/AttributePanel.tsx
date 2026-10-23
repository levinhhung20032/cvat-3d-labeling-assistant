import { useState } from 'react';
import { setAttrAll, setAttrFrom, setAttrStatic, getAttr, type AttrChange, type AttrSpec, type LabelSpec } from '../shared/attributes';
import { suggestAttributes, type AttrHint } from '../shared/attrSuggest';
import type { Cuboid } from '../shared/cuboid';
import type { CvatTrack } from '../shared/types';
import { attrKey, ignoreStore, useIgnored } from './shiftStore';

const CONF_COLOR = { cao: '#0a7a2f', vừa: '#8a6d00', thấp: '#777' } as const;

/**
 * Thuộc tính (attribute) của object đang chọn: giá trị hiện tại, sửa tay, và gợi ý theo kích thước box
 * (xe: loại xe; người đi bộ: tuổi, tư thế; xe hai bánh: có người lái; động vật; vật cản). Mọi thay đổi vào nháp, hoàn tác được.
 */
export function AttributePanel({ track, num, label, spec, frame, box, pedestrians, jobId, onApply }: {
  track: CvatTrack; num: number; label: string; spec: LabelSpec | undefined; frame: number | null; box: Cuboid | null;
  pedestrians: Cuboid[]; jobId: number; onApply: (t: CvatTrack, frames: number[]) => void;
}) {
  const ign = useIgnored();
  const [note, setNote] = useState('');
  if (!spec || spec.attrs.length === 0) return <div style={{ color: '#666' }}>Nhãn "{label}" không có attribute.</div>;
  const f = frame ?? 0;
  const hints = suggestAttributes({ track, label, spec, frame: f, box, pedestrians });
  const hintOf = (a: AttrSpec) => hints.find((h) => h.spec.id === a.id);
  const keyOf = (h: AttrHint) => attrKey(jobId, num, h.spec.id, h.scope === 'frame' ? f : null);

  const run = (res: AttrChange | null, ok: string) => {
    if (!res) { setNote('Không đổi được (đã đúng giá trị, hoặc frame này không có box).'); return; }
    onApply(res.track, res.frames);
    setNote(ok);
  };
  const apply = (h: AttrHint, mode: 'default' | 'all') => {
    if (!h.spec.mutable) run(setAttrStatic(track, h.spec, h.suggested), `${h.spec.name} → ${h.suggested}.`);
    else if (mode === 'all') run(setAttrAll(track, h.spec, h.suggested), `${h.spec.name} → ${h.suggested} cho cả track.`);
    else run(setAttrFrom(track, h.spec, f, h.suggested), `${h.spec.name} → ${h.suggested} từ frame ${f} (tới keyframe kế tiếp có ghi attribute).`);
  };
  const acceptAll = () => {
    const live = hints.filter((h) => !ign.has(keyOf(h)));
    if (!live.length) { setNote('Không có gợi ý nào.'); return; }
    let t = track;
    const frames = new Set<number>();
    for (const h of live) {
      const r = !h.spec.mutable ? setAttrStatic(t, h.spec, h.suggested) : setAttrFrom(t, h.spec, f, h.suggested);
      if (r) { t = r.track; r.frames.forEach((x) => frames.add(x)); }
    }
    if (frames.size) { onApply(t, [...frames]); setNote(`Đã chấp nhận ${live.length} gợi ý (một lần hoàn tác).`); }
  };
  const setManual = (a: AttrSpec, value: string) =>
    run(a.mutable ? setAttrFrom(track, a, f, value) : setAttrStatic(track, a, value), `${a.name} = ${value}.`);

  const options = (a: AttrSpec) => (a.input === 'checkbox' ? ['false', 'true'] : a.values);
  const liveHints = hints.filter((h) => !ign.has(keyOf(h)));

  return (
    <div style={{ fontSize: 12 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', margin: '2px 0 4px' }}>
        <span>Object <b>{num}</b> ({label}){spec.attrs.some((a) => a.mutable) ? <> · frame tham chiếu <b>{frame ?? '—'}</b></> : null}</span>
        <button disabled={!liveHints.length} onClick={acceptAll} style={{ fontWeight: 700, background: liveHints.length ? '#c9f3ff' : undefined }}>
          ✔ Chấp nhận tất cả gợi ý{liveHints.length ? ` (${liveHints.length})` : ''}
        </button>
        {note && <span style={{ color: '#7a4b00' }}>{note}</span>}
      </div>
      <table style={{ borderCollapse: 'collapse' }}>
        <tbody>
          {spec.attrs.map((a) => {
            const cur = getAttr(track, f, a);
            const eff = cur ?? a.def;
            const h = hintOf(a);
            const ignored = h ? ign.has(keyOf(h)) : false;
            return (
              <tr key={a.id} style={{ borderTop: '1px solid #ddd', verticalAlign: 'top' }}>
                <td style={{ padding: '3px 10px 3px 0' }}>
                  <b>{a.name}</b>
                  <div style={{ fontSize: 10, color: '#888' }}>{a.mutable ? 'đổi theo frame' : 'cả track'}</div>
                </td>
                <td style={{ padding: '3px 10px 3px 0' }}>
                  <select value={options(a).includes(eff) ? eff : ''} onChange={(e) => setManual(a, e.target.value)}>
                    {!options(a).includes(eff) && <option value="">{eff || '—'}</option>}
                    {options(a).map((v) => <option key={v} value={v}>{v}</option>)}
                  </select>
                  {cur === undefined && <div style={{ fontSize: 10, color: '#b00' }}>chưa đặt (mặc định {a.def || '—'})</div>}
                </td>
                <td style={{ padding: '3px 0' }}>
                  {h && !ignored && (
                    <div>
                      💡 gợi ý <b>{h.suggested}</b>{' '}
                      <span style={{ color: CONF_COLOR[h.confidence] }}>(độ tin cậy {h.confidence})</span> — {h.reason}
                      <div>
                        <button onClick={() => apply(h, 'default')}>{a.mutable ? `✔ nhận từ frame ${f}` : '✔ nhận'}</button>{' '}
                        {a.mutable && <button onClick={() => apply(h, 'all')}>✔ nhận cho cả track</button>}{' '}
                        <button onClick={() => ignoreStore.set([keyOf(h)], true)}>✖ bỏ qua</button>
                      </div>
                    </div>
                  )}
                  {h && ignored && (
                    <span style={{ color: '#888' }}>
                      đã bỏ qua gợi ý "{h.suggested}" <button onClick={() => ignoreStore.set([keyOf(h)], false)}>hoàn lại</button>
                    </span>
                  )}
                  {!h && <span style={{ color: '#2a7a2a' }}>✓ khớp với kích thước box</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
