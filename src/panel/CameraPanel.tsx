import { useEffect, useMemo, useRef, useState } from 'react';
import { rankCameras } from '../shared/cameras';
import { cameraImages } from './stores';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const LENS = 190; // px, đường kính kính lúp

/**
 * Ảnh camera có hai cách phóng to:
 * - Kính lúp (scope): rê chuột trên ảnh, một vòng tròn phóng to vùng dưới con trỏ; cuộn chuột đổi độ phóng đại.
 * - Zoom & kéo: cuộn chuột để zoom quanh con trỏ (1–10×), kéo để dịch ảnh, bấm đúp để về vừa khung.
 */
function ZoomImage({ url }: { url: string }) {
  const [mode, setMode] = useState<'lens' | 'pan'>('lens');
  const [lensZoom, setLensZoom] = useState(4);
  const [view, setView] = useState({ s: 1, x: 0, y: 0 });
  const [cur, setCur] = useState<{ x: number; y: number } | null>(null);
  const [size, setSize] = useState<[number, number]>([0, 0]);
  const wrap = useRef<HTMLDivElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null);
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const viewRef = useRef(view);
  viewRef.current = view;

  useEffect(() => { setView({ s: 1, x: 0, y: 0 }); }, [url, mode]);

  useEffect(() => {
    const el = img.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setSize([el.clientWidth, el.clientHeight]));
    ro.observe(el);
    return () => ro.disconnect();
  }, [url]);

  const fit = (v: { s: number; x: number; y: number }) => ({
    s: v.s,
    x: clamp(v.x, size[0] * (1 - v.s), 0),
    y: clamp(v.y, size[1] * (1 - v.s), 0),
  });

  // Cuộn chuột (listener gốc để chặn cuộn trang).
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const on = (e: WheelEvent) => {
      e.preventDefault();
      const f = e.deltaY < 0 ? 1.2 : 1 / 1.2;
      if (modeRef.current === 'lens') { setLensZoom((z) => clamp(z * f, 2, 12)); return; }
      const r = el.getBoundingClientRect();
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const v = viewRef.current;
      const s = clamp(v.s * f, 1, 10);
      const k = s / v.s;
      setView(fit({ s, x: cx - (cx - v.x) * k, y: cy - (cy - v.y) * k }));
    };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, [size[0], size[1]]);

  const local = (e: React.PointerEvent) => {
    const r = wrap.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const lens = mode === 'lens' && cur && size[0] > 0;
  // vị trí kính lúp: cạnh con trỏ, lật sang trái/trên nếu tràn
  const lx = cur ? (cur.x + 24 + LENS > size[0] ? cur.x - 24 - LENS : cur.x + 24) : 0;
  const ly = cur ? (cur.y + 24 + LENS > size[1] ? cur.y - 24 - LENS : cur.y + 24) : 0;

  return (
    <div>
      <div style={{ margin: '4px 0', fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center' }}>
        <label><input type="radio" checked={mode === 'lens'} onChange={() => setMode('lens')} /> Kính lúp (scope)</label>
        <label><input type="radio" checked={mode === 'pan'} onChange={() => setMode('pan')} /> Zoom &amp; kéo</label>
        {mode === 'lens' ? (
          <span>độ phóng đại <b>{lensZoom.toFixed(1)}×</b> (cuộn chuột trên ảnh) <input type="range" min={2} max={12} step={0.5} value={lensZoom} onChange={(e) => setLensZoom(Number(e.target.value))} /></span>
        ) : (
          <span>zoom <b>{view.s.toFixed(1)}×</b> (cuộn chuột quanh con trỏ · kéo để dịch · bấm đúp để về vừa khung) <button onClick={() => setView({ s: 1, x: 0, y: 0 })}>Về vừa khung</button></span>
        )}
      </div>
      <div
        ref={wrap}
        style={{ position: 'relative', display: 'inline-block', overflow: 'hidden', maxWidth: 'min(100%, 1100px)', border: '1px solid #ccc', touchAction: 'none', cursor: mode === 'lens' ? 'crosshair' : view.s > 1 ? 'grab' : 'zoom-in' }}
        onPointerMove={(e) => {
          const p = local(e);
          if (mode === 'lens') setCur(p);
          else if (drag.current) {
            const d = drag.current;
            setView(fit({ s: viewRef.current.s, x: d.vx + p.x - d.x, y: d.vy + p.y - d.y }));
          }
        }}
        onPointerLeave={() => setCur(null)}
        onPointerDown={(e) => {
          if (mode !== 'pan' || e.button !== 0) return;
          const p = local(e);
          wrap.current!.setPointerCapture(e.pointerId);
          drag.current = { x: p.x, y: p.y, vx: view.x, vy: view.y };
        }}
        onPointerUp={() => { drag.current = null; }}
        onDoubleClick={() => mode === 'pan' && setView({ s: 1, x: 0, y: 0 })}
      >
        <img
          ref={img} src={url} draggable={false}
          style={{
            display: 'block', maxWidth: '100%', userSelect: 'none',
            transformOrigin: '0 0', transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`,
          }}
        />
        {lens && cur && (
          <div
            style={{
              position: 'absolute', left: lx, top: ly, width: LENS, height: LENS, borderRadius: '50%',
              border: '3px solid #fff', boxShadow: '0 0 0 1px #000, 0 2px 8px rgba(0,0,0,.6)', pointerEvents: 'none',
              backgroundImage: `url(${url})`, backgroundRepeat: 'no-repeat',
              backgroundSize: `${size[0] * lensZoom}px ${size[1] * lensZoom}px`,
              backgroundPosition: `${-(cur.x * lensZoom - LENS / 2)}px ${-(cur.y * lensZoom - LENS / 2)}px`,
            }}
          >
            <span style={{ position: 'absolute', left: LENS / 2 - 6, top: LENS / 2 - 1, width: 12, height: 2, background: 'rgba(255,255,255,.9)' }} />
            <span style={{ position: 'absolute', left: LENS / 2 - 1, top: LENS / 2 - 6, width: 2, height: 12, background: 'rgba(255,255,255,.9)' }} />
          </div>
        )}
      </div>
    </div>
  );
}

/** Ảnh camera của frame để đối chiếu bằng mắt. Camera phù hợp nhất (theo phương vị của object) xếp đầu. */
export function CameraPanel({ frame, azimuth }: { frame: number; azimuth: number | null }) {
  const ranked = useMemo(() => rankCameras(azimuth ?? 0), [azimuth]);
  const [pick, setPick] = useState<number | null>(null);
  const [images, setImages] = useState<Map<number, Blob> | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setPick(null); }, [frame]);
  useEffect(() => {
    let live = true;
    setImages(null); setErr('');
    cameraImages.get(frame).then((m) => live && setImages(m)).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [frame]);
  const idx = pick ?? ranked[0]!.index;
  const [url, setUrl] = useState('');
  useEffect(() => {
    const b = images?.get(idx);
    if (!b) { setUrl(''); return; }
    const u = URL.createObjectURL(b);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [images, idx]);
  return (
    <div style={{ marginTop: 8 }}>
      <b>Ảnh camera · frame {frame}</b>
      {azimuth !== null && <> · phương vị object {azimuth.toFixed(0)}°</>}
      <div style={{ margin: '4px 0' }}>
        {ranked.map((c, i) => (
          <button key={c.index} onClick={() => setPick(c.index)} style={{ marginRight: 4, fontWeight: c.index === idx ? 700 : 400 }}>
            image_{c.index} {c.name}{i === 0 ? ' ★' : ''}
          </button>
        ))}
      </div>
      {err && <p style={{ color: '#b00' }}>Lỗi: {err}</p>}
      {!images && !err && <p>đang tải ảnh…</p>}
      {images && !url && <p>Không có image_{idx} trong frame này.</p>}
      {url && <ZoomImage url={url} />}
    </div>
  );
}
