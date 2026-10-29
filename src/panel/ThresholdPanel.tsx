import { useEffect, useMemo, useState, type ReactNode } from 'react';
import type { CvatLabel, CvatTrack } from '../shared/types';
import { classKey, type ClassSize } from '../shared/qcrules';
import {
  CLASS_KEYS, CLASS_NAMES, cloneClassSize, DIMS, DIM_NAMES, defaultSize, fieldsOf, getSize, isChanged, resetAll, resetSection, resetSize, SECTIONS,
  sectionChanged, setSizeRange, setSync, setValue, sizeChanged, syncGroups, validRange, type Dim, type Field, type SectionId,
} from '../shared/thresholds';
import { thresholdStore, useThresholdVersion } from './thresholdStore';

/** Ô nhập số: gõ tự do; chỉ ghi khi hợp lệ (`onCommit` trả false thì ô đỏ), rời ô mà còn sai thì về giá trị đang dùng. */
function NumField({ value, onCommit, step, width = 78, title }: { value: number; onCommit: (v: number) => boolean; step: number; width?: number; title?: string }) {
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(String(value)); setBad(false); }, [value]);
  return (
    <input
      type="number" value={text} step={step} title={title}
      style={{ width, borderColor: bad ? '#b00' : undefined, background: bad ? '#fee' : undefined }}
      onChange={(e) => {
        const s = e.target.value;
        setText(s);
        const v = Number(s);
        if (s.trim() === '' || !Number.isFinite(v)) { setBad(true); return; }
        setBad(!onCommit(v));
      }}
      onBlur={() => { if (bad) { setText(String(value)); setBad(false); } }}
    />
  );
}

const WIDE: ClassSize = { length: [0.1, 12], width: [0.1, 4], height: [0.1, 4] };

/** Một hàng khoảng kích thước dài / rộng / cao (min – max). */
function SizeCells({ size, onRange }: { size: ClassSize; onRange: (d: Dim, lo: number, hi: number) => boolean }) {
  return (
    <>
      {DIMS.map((d) => (
        <td key={d} style={{ padding: '2px 8px', whiteSpace: 'nowrap' }}>
          <NumField value={size[d][0]} step={0.05} width={62} title={`${DIM_NAMES[d]} nhỏ nhất (m)`} onCommit={(v) => onRange(d, v, size[d][1])} />
          {' – '}
          <NumField value={size[d][1]} step={0.05} width={62} title={`${DIM_NAMES[d]} lớn nhất (m)`} onCommit={(v) => onRange(d, size[d][0], v)} />
        </td>
      ))}
    </>
  );
}

function FieldRow({ f }: { f: Field }) {
  const changed = isChanged(f);
  return (
    <tr style={{ background: changed ? '#fff8dc' : undefined }}>
      <td style={{ padding: '2px 10px 2px 0' }} title={f.help}>{f.label}{f.help ? ' ⓘ' : ''}</td>
      <td style={{ whiteSpace: 'nowrap' }}>
        <NumField value={f.get()} step={f.step} onCommit={(v) => { const ok = setValue(f.key, v); if (ok) thresholdStore.changed(); return ok; }} />
        {f.unit ? ` ${f.unit}` : ''}
      </td>
      <td style={{ padding: '2px 8px', color: '#777', fontSize: 11 }}>mặc định {f.def}{f.unit ? ` ${f.unit}` : ''}</td>
      <td>{changed && <button onClick={() => { f.set(f.def); thresholdStore.changed(); }} title="Về giá trị mặc định">↺</button>}</td>
    </tr>
  );
}

function Section({ id, title, about, children }: { id: SectionId; title: string; about: string; children?: ReactNode }) {
  const changed = sectionChanged(id);
  return (
    <details open={id === 'K' || changed} style={{ border: '1px solid #ccd', borderRadius: 4, margin: '6px 0', padding: '2px 8px' }}>
      <summary style={{ cursor: 'pointer', fontWeight: 700, padding: '3px 0' }}>
        {title}{changed && <span style={{ color: '#a60', fontWeight: 600, marginLeft: 8 }}>● đã chỉnh</span>}
      </summary>
      <p style={{ margin: '2px 0 4px', color: '#456', fontSize: 12 }}>{about}</p>
      {children}
      {fieldsOf(id).length > 0 && (
        <table style={{ borderCollapse: 'collapse' }}>
          <tbody>{fieldsOf(id).map((f) => <FieldRow key={f.key} f={f} />)}</tbody>
        </table>
      )}
      <div style={{ margin: '4px 0' }}>
        <button disabled={!changed} onClick={() => { resetSection(id); thresholdStore.changed(); }}>↺ Đặt lại mục này</button>
      </div>
    </details>
  );
}

/**
 * Tab "Threshold": chỉnh tay các ngưỡng cảnh báo, chia theo từng loại lỗi. Mục K cho chỉnh khoảng kích thước theo class (áp cho mọi object
 * của class, tức đồng bộ cả class) và đặt ngưỡng riêng cho từng object (ưu tiên hơn ngưỡng class; dùng được cả cho class chưa có ngưỡng).
 */
export function ThresholdPanel({ jobId, labels, tracks }: { jobId: number; labels: CvatLabel[]; tracks: CvatTrack[] }) {
  useThresholdVersion(); // vẽ lại mỗi khi ngưỡng đổi
  const names = useMemo(() => new Map(labels.map((l) => [l.id, l.name])), [labels]);
  const own = thresholdStore.objects();
  const [pick, setPick] = useState('');
  const nameOf = (num: number) => names.get(tracks[num - 1]?.label_id ?? -1) ?? '?';
  const free = tracks.map((t, i) => i + 1).filter((n) => !own.has(n));
  const addOwn = () => {
    const num = Number(pick || free[0]);
    if (!num || own.has(num)) return;
    const ck = classKey(nameOf(num));
    thresholdStore.setObject(num, cloneClassSize(ck ? getSize(ck) : WIDE));
    setPick('');
  };
  const range = (k: (typeof CLASS_KEYS)[number]) => (d: Dim, lo: number, hi: number) => {
    const ok = setSizeRange(k, d, lo, hi);
    if (ok) thresholdStore.changed();
    return ok;
  };

  return (
    <>
      <p style={{ margin: '4px 0' }}>
        <b>Threshold</b>: chỉnh tay ngưỡng cảnh báo theo từng loại lỗi. Có hiệu lực ngay cho bảng object, Batch Review, QC; ô vàng = khác mặc định.
        Ngưỡng chung lưu cho mọi job; ngưỡng riêng theo object lưu theo job. Không gửi đi đâu.{' '}
        <button
          disabled={!SECTIONS.some((s) => sectionChanged(s.id))}
          onClick={() => { if (confirm('Đặt lại TẤT CẢ ngưỡng chung về mặc định? (ngưỡng riêng theo object giữ nguyên)')) { resetAll(); thresholdStore.changed(); } }}
        >↺ Đặt lại tất cả</button>
      </p>
      {SECTIONS.map((s) => (
        <Section key={s.id} id={s.id} title={s.title} about={s.about}>
          {s.id === 'S' && (
            <p style={{ margin: '2px 0' }}>
              Áp dụng cho:{' '}
              {CLASS_KEYS.map((k) => (
                <label key={k} style={{ marginRight: 10 }}>
                  <input type="checkbox" checked={syncGroups().includes(k)} onChange={(e) => { setSync(k, e.target.checked); thresholdStore.changed(); }} /> {CLASS_NAMES[k]}
                </label>
              ))}
              <span style={{ color: '#777', fontSize: 11 }}>(mặc định chỉ Vehicle: các class có dynamic size được đổi kích thước theo frame)</span>
            </p>
          )}
          {s.id === 'K' && (
            <>
              <p style={{ margin: '2px 0', fontWeight: 600 }}>Theo class (đồng bộ cho mọi object của class)</p>
              <table style={{ borderCollapse: 'collapse' }}>
                <thead><tr style={{ textAlign: 'left' }}><th>Class</th>{DIMS.map((d) => <th key={d} style={{ padding: '0 8px' }}>{DIM_NAMES[d]} (m)</th>)}<th /></tr></thead>
                <tbody>
                  {CLASS_KEYS.map((k) => (
                    <tr key={k} style={{ borderTop: '1px solid #ddd', background: sizeChanged(k) ? '#fff8dc' : undefined }}>
                      <td><b>{CLASS_NAMES[k]}</b></td>
                      <SizeCells size={getSize(k)} onRange={range(k)} />
                      <td style={{ whiteSpace: 'nowrap' }}>
                        {sizeChanged(k) && <button onClick={() => { resetSize(k); thresholdStore.changed(); }} title={`Mặc định: ${DIMS.map((d) => `${defaultSize(k)[d][0]}–${defaultSize(k)[d][1]}`).join(' × ')}`}>↺</button>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p style={{ margin: '6px 0 2px', fontWeight: 600 }}>Ngưỡng riêng theo object (ưu tiên hơn ngưỡng class)</p>
              {own.size === 0 && <p style={{ margin: '2px 0', color: '#777' }}>Chưa có. Thêm khi một object cần khoảng kích thước khác class (xe bus / truck, Animal / Obstacle chưa có ngưỡng…).</p>}
              {own.size > 0 && (
                <table style={{ borderCollapse: 'collapse' }}>
                  <thead><tr style={{ textAlign: 'left' }}><th>Object</th>{DIMS.map((d) => <th key={d} style={{ padding: '0 8px' }}>{DIM_NAMES[d]} (m)</th>)}<th /></tr></thead>
                  <tbody>
                    {[...own].sort((a, b) => a[0] - b[0]).map(([num, size]) => (
                      <tr key={num} style={{ borderTop: '1px solid #ddd', background: '#fff8dc' }}>
                        <td style={{ whiteSpace: 'nowrap' }}><b>#{num}</b> · {nameOf(num)}</td>
                        <SizeCells
                          size={size}
                          onRange={(d, lo, hi) => {
                            if (!validRange(lo, hi)) return false;
                            thresholdStore.setObject(num, { ...size, [d]: [lo, hi] });
                            return true;
                          }}
                        />
                        <td><button onClick={() => thresholdStore.setObject(num, null)} title="Bỏ ngưỡng riêng, dùng ngưỡng của class">✕</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <p style={{ margin: '4px 0' }}>
                Thêm ngưỡng riêng cho:{' '}
                <select value={pick} onChange={(e) => setPick(e.target.value)} disabled={!free.length}>
                  <option value="">— chọn object —</option>
                  {free.map((n) => <option key={n} value={n}>#{n} · {nameOf(n)}</option>)}
                </select>{' '}
                <button disabled={!pick} onClick={addOwn}>+ Thêm</button>
                <span style={{ color: '#777', fontSize: 11 }}> (bắt đầu từ ngưỡng của class; job {jobId})</span>
              </p>
            </>
          )}
        </Section>
      ))}
    </>
  );
}
