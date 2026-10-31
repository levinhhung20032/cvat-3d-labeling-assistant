import { useEffect, useMemo, useRef, useState } from 'react';
import { COLOR_KEYS, DEFAULT_COLORS, isHex, sameColors, type ColorSettings } from '../shared/colors';
import type { LocalBox } from '../shared/edit';
import { drawView, NO_PAN, type EgoPlane, type Local, type View } from './render';
import { colorStore, useColors } from './colorStore';
import { withColors } from './colorState';

/** Bảng màu point: tránh hồng (điểm lọt ngoài box) và tím (ref mode) để không lẫn. */
const POINT_SWATCHES = ['#ffffff', '#cbd5e1', '#facc15', '#fb923c', '#f87171', '#4ade80', '#22d3ee', '#60a5fa'];
const HEIGHT_GRADIENT = 'linear-gradient(90deg, hsl(220 80% 55%), hsl(120 80% 55%), hsl(20 80% 55%))';

function PointColorPicker({ value, onChange }: { value: string; onChange: (c: string) => void }) {
  const sw = (bg: string, on: boolean, title: string, click: () => void) => (
    <button key={title} type="button" className="cvla-keep" onClick={click} title={title} aria-pressed={on}
      style={{ width: 20, height: 20, padding: 0, background: bg, border: on ? '2px solid #f59e0b' : '1px solid #64748b', borderRadius: 3, cursor: 'pointer', verticalAlign: 'middle' }} />
  );
  const custom = value !== '' && !POINT_SWATCHES.includes(value);
  return (
    <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
      {sw(HEIGHT_GRADIENT, value === '', 'Theo độ cao (mặc định)', () => onChange(''))}
      {POINT_SWATCHES.map((c) => sw(c, value === c, c, () => onChange(c)))}
      <label title="Chọn màu khác" className="cvla-keep" style={{ display: 'inline-flex', alignItems: 'center', cursor: 'pointer', border: custom ? '2px solid #f59e0b' : '1px solid #64748b', borderRadius: 3, width: 20, height: 20, overflow: 'hidden', background: custom ? value : 'conic-gradient(red, yellow, lime, cyan, blue, magenta, red)' }}>
        <input type="color" value={value || '#ffffff'} onChange={(e) => onChange(e.target.value)} style={{ opacity: 0, width: 20, height: 20, padding: 0, border: 0, cursor: 'pointer' }} />
      </label>
    </span>
  );
}

/** Một dòng chọn màu: ô chọn màu + mã hex (gõ tay được) + ↺ về mặc định. Chỉ sửa bản nháp, chưa lưu. */
function ColorRow({ label, hint, value, def, onChange }: { label: string; hint?: string; value: string; def: string; onChange: (c: string) => void }) {
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }} title={hint}>
      <span style={{ width: 150 }}>{label}</span>
      <input type="color" className="cvla-keep" value={value} onChange={(e) => onChange(e.target.value.toLowerCase())} style={{ width: 36, height: 24, padding: 0, border: '1px solid #64748b', cursor: 'pointer' }} />
      <input
        value={text} spellCheck={false} maxLength={7} style={{ width: 70, fontFamily: 'monospace' }}
        onChange={(e) => { setText(e.target.value); if (isHex(e.target.value)) onChange(e.target.value.toLowerCase()); }}
        onBlur={() => setText(value)}
      />
      <button type="button" onClick={() => onChange(def)} disabled={value === def} title={`Về mặc định ${def}`} style={{ padding: '0 5px' }}>↺</button>
    </div>
  );
}

// ---- Khung xem trước: cảnh tổng hợp (mặt đường, xe, tường) vẽ bằng đúng hàm vẽ của Batch Review với màu nháp ----
const rng = (seed: number) => () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const SAMPLE_BOX: LocalBox = { cu: 0, cv: 0, cw: 0, dyaw: 0, sx: 4, sy: 1.8, sz: 1.5 };
function sampleCloud(): Local {
  const r = rng(11), u: number[] = [], v: number[] = [], w: number[] = [];
  const add = (a: number, b: number, c: number) => { u.push(a); v.push(b); w.push(c); };
  for (let x = -7; x <= 7; x += 0.3) for (let y = -7; y <= 7; y += 0.3) add(x + (r() - 0.5) * 0.2, y + (r() - 0.5) * 0.2, -0.8 + (r() - 0.5) * 0.05);
  for (let i = 0; i < 700; i++) { // vỏ xe
    const side = r();
    if (side < 0.4) add((r() < 0.5 ? -2 : 2), (r() - 0.5) * 1.8, -0.7 + r() * 1.4);
    else if (side < 0.8) add((r() - 0.5) * 4, (r() < 0.5 ? -0.9 : 0.9), -0.7 + r() * 1.4);
    else add((r() - 0.5) * 3.6, (r() - 0.5) * 1.6, 0.7);
  }
  for (let i = 0; i < 350; i++) add(-6 + r() * 12, r() < 0.5 ? -5 : 5, -0.8 + r() * 2.4); // tường hai bên
  const n = u.length;
  return { u: Float32Array.from(u), v: Float32Array.from(v), w: Float32Array.from(w), n };
}
const EGO_PLANE: EgoPlane = [0, 0, 1, -0.95];
const PW_PLANE: EgoPlane = [0.04, 0, 1, -0.7];
const SAMPLE_GROUND = -0.8;
const VIEWS: { v: View; name: string }[] = [{ v: 'top', name: 'Trên' }, { v: 'side', name: 'Bên' }, { v: 'front', name: 'Trước' }];
const SZ = 190;

function PreviewCanvas({ view, colors, loc }: { view: View; colors: ColorSettings; loc: Local }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const half = 6;
    const scene = { zClip: half, slab: half * 0.5, colorHalf: half, point: { color: colors.point || null, alpha: 1, scale: 1 } };
    withColors(colors, () => drawView(ctx, SZ, view, loc, SAMPLE_BOX, half, 'key', false, false, null, SAMPLE_GROUND, null, scene, [], null, [], null, NO_PAN, EGO_PLANE, null, PW_PLANE));
  }, [view, colors, loc, dpr]);
  return <canvas ref={ref} width={Math.round(SZ * dpr)} height={Math.round(SZ * dpr)} style={{ width: SZ, height: SZ, display: 'block' }} />;
}

const STATUS_SAMPLES: { key: keyof ColorSettings; name: string }[] = [
  { key: 'frameKey', name: 'keyframe' }, { key: 'frameInterp', name: 'nội suy' }, { key: 'frameHold', name: 'giữ nguyên' },
  { key: 'frameOutside', name: 'outside' }, { key: 'frameNone', name: 'chưa có' },
];

/** Tab Màu sắc: chỉnh nháp + xem trước; chỉ bấm Lưu mới đổi màu thật trong Batch Review. */
export function ColorPanel() {
  const saved = useColors();
  const [draft, setDraft] = useState<ColorSettings>(() => ({ ...saved }));
  const dirty = !sameColors(draft, saved);
  const set = (k: keyof ColorSettings) => (c: string) => setDraft((d) => ({ ...d, [k]: c }));
  const loc = useMemo(sampleCloud, []);
  const row = (k: keyof ColorSettings, label: string, hint?: string) => <ColorRow key={k} label={label} hint={hint} value={draft[k]} def={DEFAULT_COLORS[k]} onChange={set(k)} />;
  const head = (t: string) => <div style={{ fontWeight: 700, margin: '10px 0 2px' }}>{t}</div>;
  return (
    <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', alignItems: 'flex-start' }}>
      <div style={{ minWidth: 380 }}>
        <div style={{ marginBottom: 6 }}>
          Chọn màu rồi xem ở khung bên cạnh. <b>Chỉ khi bấm Lưu</b> màu mới đổi trong Batch Review; rời tab mà chưa lưu thì bản nháp bị bỏ.
        </div>
        {head('Point cloud')}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }} title="Màu cố định cho mọi point, hoặc tô theo độ cao (gradient). Điểm lọt ngoài box vẫn tô hồng.">
          <span style={{ width: 150 }}>Màu point</span>
          <PointColorPicker value={draft.point} onChange={set('point')} />
        </div>
        {head('View')}
        {row('viewBg', 'Nền các view', 'Nền ô Trên / Bên / Trước')}
        {head('Vạch mặt đường')}
        {row('groundLocal', 'local', 'Mặt đường đo riêng quanh object')}
        {row('groundEgo', 'ego', 'Mặt phẳng ego z = 0')}
        {row('groundPw', 'patchwork++', 'Mặt đường fit từ điểm Patchwork++')}
        {head('Viền frame / box theo trạng thái')}
        {row('frameKey', 'keyframe')}
        {row('frameInterp', 'nội suy')}
        {row('frameHold', 'giữ nguyên')}
        {row('frameOutside', 'outside')}
        {row('frameNone', 'chưa có box')}
        <div style={{ display: 'flex', gap: 8, marginTop: 14, alignItems: 'center' }}>
          <button type="button" onClick={() => colorStore.save(draft)} disabled={!dirty} style={{ fontWeight: 700, padding: '3px 12px' }} title="Áp màu nháp vào Batch Review">💾 Lưu</button>
          <button type="button" onClick={() => setDraft({ ...saved })} disabled={!dirty} title="Bỏ các thay đổi chưa lưu">Hủy thay đổi</button>
          <button type="button" onClick={() => setDraft({ ...DEFAULT_COLORS })} disabled={COLOR_KEYS.every((k) => draft[k] === DEFAULT_COLORS[k])} title="Đặt bản nháp về màu mặc định (vẫn phải bấm Lưu)">↺ Mặc định</button>
          <span style={{ color: dirty ? '#b45309' : '#16803c' }}>{dirty ? '● có thay đổi chưa lưu' : '✓ đã lưu'}</span>
        </div>
      </div>
      <div>
        <div style={{ fontWeight: 700, marginBottom: 4 }}>Xem trước (bản nháp)</div>
        <div style={{ display: 'flex', gap: 6 }}>
          {VIEWS.map(({ v, name }) => (
            <div key={v} title={`Ô ${name}: xe mẫu, vạch local / ego / patchwork++`}>
              <PreviewCanvas view={v} colors={draft} loc={loc} />
              <div style={{ textAlign: 'center', fontSize: 11 }}>{name}</div>
            </div>
          ))}
        </div>
        <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
          {STATUS_SAMPLES.map(({ key, name }) => (
            <div key={key} className="cvla-keep" style={{ width: 96, height: 44, border: `3px solid ${draft[key]}`, background: '#fafafa', fontSize: 11, textAlign: 'center', lineHeight: '38px' }}>{name}</div>
          ))}
        </div>
      </div>
    </div>
  );
}
