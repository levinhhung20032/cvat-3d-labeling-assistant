import { useEffect, useMemo, useRef, useState } from 'react';
import { buildCameras, camDirs, materializeSetup, rankCameras, UNMAPPED, yawToUi } from '../shared/cameras';
import type { CamCount, CamOverride, CameraSetup, MappedCamera } from '../shared/cameras';
import { activeSetup, useCameraBank } from './cameraStore';
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
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
      <div style={{ margin: '4px 0', fontSize: 12, display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center', justifyContent: 'center' }}>
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
            className="cvla-lens" // ảnh nền của kính lúp cũng phải được đảo ngược lại ở giao diện tối / xám, như thẻ img
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

const num = { width: 56 } as const;

/** Gán tên camera của job ↔ hướng, chọn bộ 6 / 8 camera, xem và sửa góc nhìn (yaw, ống kính, nửa FOV) được đề xuất cho mỗi camera. */
function CameraSetupEditor({ files, setup, onChange, onCount }: { files: string[]; setup: CameraSetup; onChange: (s: CameraSetup) => void; onCount: (n: CamCount) => void }) {
  const cams = buildCameras(files, setup);
  const dirs = camDirs(setup.count);
  const patchOver = (key: string, o: CamOverride) => onChange({ ...setup, over: { ...setup.over, [key]: { ...setup.over[key], ...o } } });
  const used = new Map<string, number>();
  for (const c of cams) if (c.dir) used.set(c.dir, (used.get(c.dir) ?? 0) + 1);
  return (
    <div style={{ border: '1px solid #bbb', borderRadius: 6, padding: 8, margin: '6px 0', fontSize: 12, textAlign: 'left', maxWidth: 'min(100%, 760px)' }}>
      <div style={{ display: 'flex', gap: 14, alignItems: 'center', flexWrap: 'wrap', marginBottom: 6 }}>
        <b>Bộ camera:</b>
        {([6, 8] as const).map((n) => (
          <label key={n}>
            <input type="radio" checked={setup.count === n} onChange={() => onCount(n)} /> {n} camera
          </label>
        ))}
        <button onClick={() => onChange({ count: setup.count, map: {}, over: {}, flip: setup.flip })} title="Bỏ mọi chỉnh tay: gán hướng và góc nhìn đề xuất lại theo tên file">Tự đề xuất lại</button>
        <label title="Bật khi ảnh camera của job bị lật: object bên trái xe lại hiện ở camera bên phải. Đổi dấu mọi yaw cùng lúc.">
          <input type="checkbox" checked={setup.flip} onChange={(e) => onChange({ ...setup, flip: e.target.checked })} /> Đảo trái ↔ phải
        </label>
        <span style={{ color: '#888' }}>Góc nhìn là ước lượng ±15°, chỉnh được.</span>
      </div>
      <table style={{ borderCollapse: 'collapse', width: '100%' }}>
        <thead>
          <tr style={{ textAlign: 'left' }}><th>Tên camera trong job</th><th>Hướng</th><th title="Theo la bàn nhìn từ trên: dương = lệch phải, âm = lệch trái so với hướng trước xe">Yaw (°, + phải / − trái)</th><th>Ống kính</th><th>Nửa FOV (°)</th></tr>
        </thead>
        <tbody>
          {cams.map((c, i) => (
            <tr key={c.key}>
              <td>{files[i]!.split('/').pop()}</td>
              <td>
                <select
                  value={c.dir}
                  onChange={(e) => onChange({ ...setup, map: { ...setup.map, [c.key]: e.target.value }, over: { ...setup.over, [c.key]: {} } })}
                  style={{ borderColor: c.dir && (used.get(c.dir) ?? 0) > 1 ? '#d90' : undefined }}
                >
                  <option value={UNMAPPED}>— chưa gán —</option>
                  {dirs.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
                {c.suggested && c.dir && <span title="Đề xuất theo tên file; chọn lại để chốt" style={{ color: '#888' }}> ✦</span>}
              </td>
              <td><input type="number" style={num} value={yawToUi(c.yaw)} min={-180} max={180} step={5} disabled={!c.dir} onChange={(e) => patchOver(c.key, { yaw: (setup.flip ? 1 : -1) * Number(e.target.value) || 0 })} /></td>
              <td>
                <select value={c.lens} disabled={!c.dir} onChange={(e) => patchOver(c.key, { lens: e.target.value as 'wide' | 'fisheye' })}>
                  <option value="wide">góc rộng</option><option value="fisheye">fisheye</option>
                </select>
              </td>
              <td><input type="number" style={num} value={c.halfFov} min={10} max={120} step={5} disabled={!c.dir} onChange={(e) => patchOver(c.key, { halfFov: Number(e.target.value) })} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {[...used].some(([, n]) => n > 1) && <p style={{ color: '#a60', margin: '4px 0 0' }}>⚠ Có hướng được gán cho nhiều hơn một camera.</p>}
    </div>
  );
}

/** Tab Camera: cấu hình ánh xạ camera. Tên file lấy từ ảnh của một frame do người dùng chọn (mọi frame cùng bộ camera). */
export function CameraTab({ start, stop }: { start: number; stop: number }) {
  const [bank, setBank] = useCameraBank();
  const setup = activeSetup(bank);
  const setSetup = (st: CameraSetup) => setBank({ ...bank, sets: { ...bank.sets, [bank.active]: st } });
  const [frame, setFrame] = useState(start);
  const [files, setFiles] = useState<string[] | null>(null);
  // Ghi đầy đủ hướng / yaw / ống kính / FOV của mọi camera vào cấu hình (để xuất setting.json mang đủ giá trị đang dùng).
  useEffect(() => {
    if (!files?.length) return;
    const full = materializeSetup(files, setup);
    if (JSON.stringify(full) !== JSON.stringify(setup)) setSetup(full);
  }, [files, setup]);
  const [err, setErr] = useState('');
  useEffect(() => {
    let live = true;
    setFiles(null); setErr('');
    cameraImages.get(frame).then((m) => live && setFiles([...m.keys()])).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [frame]);
  return (
    <div style={{ padding: '6px 0' }}>
      <p style={{ margin: '4px 0' }}>
        Gán tên camera trong job vào hướng của xe; tool tự đề xuất hướng và góc nhìn của từng camera, chỉnh tay được.
        Danh sách camera lấy từ ảnh của frame{' '}
        <input type="number" style={{ width: 64 }} min={start} max={stop} value={frame} onChange={(e) => setFrame(clamp(Math.round(Number(e.target.value) || start), start, stop))} />
        {' '}(cấu hình áp cho mọi frame).
      </p>
      {err && <p style={{ color: '#b00' }}>Lỗi: {err}</p>}
      {!files && !err && <p>đang tải ảnh…</p>}
      {files && files.length === 0 && <p>Frame này không có ảnh camera.</p>}
      {files && files.length > 0 && <CameraSetupEditor files={files} setup={setup} onChange={setSetup} onCount={(n) => setBank({ ...bank, active: n })} />}
    </div>
  );
}

/** Ảnh camera của frame để đối chiếu bằng mắt. Camera phù hợp nhất (theo phương vị của object) xếp đầu. */
export function CameraPanel({ frame, azimuth }: { frame: number; azimuth: number | null }) {
  const [bank, setBank] = useCameraBank();
  const setup0 = activeSetup(bank);
  const [pick, setPick] = useState<string | null>(null);
  const [images, setImages] = useState<Map<string, Blob> | null>(null);
  const [err, setErr] = useState('');
  useEffect(() => { setPick(null); }, [frame]);
  useEffect(() => {
    let live = true;
    setImages(null); setErr('');
    cameraImages.get(frame).then((m) => live && setImages(m)).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [frame]);
  const files = useMemo(() => [...(images?.keys() ?? [])], [images]);
  const setup = useMemo(() => (files.length ? materializeSetup(files, setup0) : setup0), [files, setup0]);
  useEffect(() => {
    if (files.length && JSON.stringify(setup) !== JSON.stringify(setup0)) setBank({ ...bank, sets: { ...bank.sets, [bank.active]: setup } });
  }, [setup, setup0, files.length]);
  const cams = useMemo(() => buildCameras(files, setup), [files, setup]);
  const ranked = useMemo(() => rankCameras<MappedCamera>(azimuth ?? 0, cams), [azimuth, cams]);
  const cur = ranked.find((c) => c.key === pick) ?? ranked[0];
  const [url, setUrl] = useState('');
  useEffect(() => {
    const b = cur ? images?.get(files[cur.index]!) : undefined;
    if (!b) { setUrl(''); return; }
    const u = URL.createObjectURL(b);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [images, files, cur?.key]);
  return (
    <div style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div>
        <b>Ảnh camera · frame {frame}</b>
        {azimuth !== null && <> · phương vị object {azimuth.toFixed(0)}°</>}
        <span style={{ color: '#888' }}> · gán camera ↔ hướng ở tab Camera</span>
      </div>
      <div style={{ margin: '4px 0', display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
        {ranked.map((c, i) => (
          <button key={c.key} onClick={() => setPick(c.key)} style={{ marginRight: 4, fontWeight: c.key === cur?.key ? 700 : 400 }}>
            {files[c.index]!.split('/').pop()} {c.dir ? c.name : '(chưa gán)'}{i === 0 && c.dir ? ' ★' : ''}
          </button>
        ))}
      </div>
      {err && <p style={{ color: '#b00' }}>Lỗi: {err}</p>}
      {!images && !err && <p>đang tải ảnh…</p>}
      {images && images.size === 0 && <p>Frame này không có ảnh camera.</p>}
      {images && images.size > 0 && !url && <p>Không đọc được ảnh đã chọn.</p>}
      {url && <ZoomImage url={url} />}
    </div>
  );
}
