import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { buildCameras, camDirs, materializeSetup, rankCameras, UNMAPPED, yawToUi } from '../shared/cameras';
import type { CamCount, CamOverride, CameraSetup, MappedCamera } from '../shared/cameras';
import { activeSetup, loadPopGeo, savePopGeo, useCameraBank, useCameraPop, useCameraShow, type PopGeo } from './cameraStore';
import { cameraImages } from './stores';

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));
const LENS = 190; // px, đường kính kính lúp
/** Chiều cao vùng ảnh lần hiện gần nhất (px): khung giữ chỗ giữ đúng chiều cao này khi chưa chọn frame / đang tải, để trang không giật. */
let lastAreaH = 360;

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
  const [show, setShow] = useCameraShow();
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
        <label title="Tắt: Batch Review không hiện và không tải ảnh camera (nhẹ máy chủ hơn). Lưu trên máy này.">
          <input type="checkbox" checked={show} onChange={(e) => setShow(e.target.checked)} /> <b>Hiện ảnh camera trong Batch Review</b>
        </label>
      </p>
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

/**
 * Cửa sổ nổi nhỏ: kéo thanh tiêu đề để dời, kéo góc dưới phải để đổi cỡ; vị trí / cỡ nhớ trên máy này, luôn được kéo về trong khung tool.
 * Vẽ qua portal ra ngoài `.cvla-root` (giao diện tối / xám đặt `filter` ở đó, làm `position: fixed` bám theo nội dung thay vì khung tool).
 */
function FloatWin({ host, title, onDock, children }: { host: Element; title: ReactNode; onDock: () => void; children: ReactNode }) {
  const fitIn = (g: PopGeo): PopGeo => {
    const W = window.innerWidth, H = window.innerHeight;
    const w = clamp(g.w, 240, Math.max(240, W - 8)), h = clamp(g.h, 160, Math.max(160, H - 8));
    return { w, h, x: clamp(g.x, 0, Math.max(0, W - w)), y: clamp(g.y, 0, Math.max(0, H - h)) };
  };
  const [geo, setGeo] = useState<PopGeo>(() => fitIn(loadPopGeo() ?? { w: 440, h: 340, x: window.innerWidth - 456, y: window.innerHeight - 356 }));
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ px: number; py: number; x: number; y: number } | null>(null);
  const save = (g: PopGeo) => { setGeo(g); savePopGeo(g); };
  useEffect(() => {
    const on = () => setGeo((g) => fitIn(g));
    window.addEventListener('resize', on);
    return () => window.removeEventListener('resize', on);
  }, []);
  return createPortal(
    <div
      ref={box}
      // Thả chuột sau khi kéo góc đổi cỡ (resize của CSS): ghi lại cỡ mới.
      onPointerUp={() => { const el = box.current; if (el && (el.offsetWidth !== geo.w || el.offsetHeight !== geo.h)) save(fitIn({ ...geo, w: el.offsetWidth, h: el.offsetHeight })); }}
      style={{
        position: 'fixed', left: geo.x, top: geo.y, width: geo.w, height: geo.h, zIndex: 60, boxSizing: 'border-box',
        display: 'flex', flexDirection: 'column', background: '#fff', color: '#111', font: '12px/1.4 system-ui',
        border: '1px solid #1f2937', borderRadius: 6, boxShadow: '0 6px 24px rgba(0,0,0,.45)', resize: 'both', overflow: 'hidden', minWidth: 240, minHeight: 160,
      }}
    >
      <div
        onPointerDown={(e) => {
          if (e.button !== 0 || (e.target as HTMLElement).closest('button')) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          drag.current = { px: e.clientX, py: e.clientY, x: geo.x, y: geo.y };
        }}
        onPointerMove={(e) => { const d = drag.current; if (d) setGeo(fitIn({ ...geo, x: d.x + e.clientX - d.px, y: d.y + e.clientY - d.py })); }}
        onPointerUp={() => { if (drag.current) { drag.current = null; save(geo); } }}
        style={{ flex: 'none', display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', background: '#1f2937', color: '#e5e7eb', cursor: 'move', userSelect: 'none', touchAction: 'none' }}
      >
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{title}</span>
        <button onClick={onDock} title="Gắn ảnh camera trở lại dưới các cột frame" style={{ padding: '0 6px' }}>⧈ Gắn lại</button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 4 }}>{children}</div>
    </div>,
    host,
  );
}

/**
 * Ảnh camera của frame để đối chiếu bằng mắt. Camera phù hợp nhất (theo phương vị của object) xếp đầu.
 * Vùng ảnh luôn giữ chỗ (chiều cao lần hiện gần nhất): chưa chọn frame thì hiện khung trống; đổi frame thì giữ ảnh cũ (mờ) tới khi ảnh mới
 * tải và giải mã xong, nên trang không co giãn / giật mỗi lần chọn hoặc sửa frame.
 */
export function CameraPanel({ frame, azimuth }: { frame: number | null; azimuth: number | null }) {
  const [bank, setBank] = useCameraBank();
  const setup0 = activeSetup(bank);
  const [pick, setPick] = useState<string | null>(null);
  const [images, setImages] = useState<Map<string, Blob> | null>(null);
  const [shownFrame, setShownFrame] = useState<number | null>(null); // frame của ảnh đang hiện (khác `frame` khi đang tải)
  const [err, setErr] = useState('');
  useEffect(() => { setPick(null); }, [frame]);
  useEffect(() => {
    if (frame === null) return;
    let live = true;
    setErr('');
    cameraImages.get(frame).then((m) => { if (live) { setImages(m); setShownFrame(frame); } }).catch((e) => live && setErr(String(e)));
    return () => { live = false; };
  }, [frame]);
  const loading = frame !== null && shownFrame !== frame && !err;
  const [pop, setPop] = useCameraPop();
  const anchor = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<Element | null>(null);
  useEffect(() => { setHost(anchor.current?.closest('.cvla-root')?.parentElement ?? null); }, []);
  const floating = pop && !!host;
  const area = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = area.current;
    if (!el || floating) return; // cửa sổ nổi có cỡ riêng, không làm mốc cho khung giữ chỗ
    const ro = new ResizeObserver(() => { if (el.offsetHeight > 40) lastAreaH = el.offsetHeight; });
    ro.observe(el);
    return () => ro.disconnect();
  }, [floating]);
  const files = useMemo(() => [...(images?.keys() ?? [])], [images]);
  const setup = useMemo(() => (files.length ? materializeSetup(files, setup0) : setup0), [files, setup0]);
  useEffect(() => {
    if (files.length && JSON.stringify(setup) !== JSON.stringify(setup0)) setBank({ ...bank, sets: { ...bank.sets, [bank.active]: setup } });
  }, [setup, setup0, files.length]);
  const cams = useMemo(() => buildCameras(files, setup), [files, setup]);
  const ranked = useMemo(() => rankCameras<MappedCamera>(azimuth ?? 0, cams), [azimuth, cams]);
  const cur = ranked.find((c) => c.key === pick) ?? ranked[0];
  // Ảnh mới chỉ thay ảnh cũ khi đã giải mã xong (không có khoảnh khắc khung ảnh rỗng); URL cũ thu hồi sau khi đổi.
  const [url, setUrl] = useState('');
  const urlRef = useRef('');
  const swap = (u: string) => { const old = urlRef.current; urlRef.current = u; setUrl(u); if (old) URL.revokeObjectURL(old); };
  useEffect(() => {
    const b = cur ? images?.get(files[cur.index]!) : undefined;
    if (!b) { if (images) swap(''); return; }
    let live = true;
    const u = URL.createObjectURL(b);
    const im = new Image();
    im.src = u;
    im.decode().catch(() => undefined).then(() => { if (live) swap(u); else URL.revokeObjectURL(u); });
    return () => { live = false; };
  }, [images, files, cur?.key]);
  useEffect(() => () => { if (urlRef.current) URL.revokeObjectURL(urlRef.current); }, []);
  const status = <>{loading && <span style={{ color: '#a60' }}> · đang tải ảnh frame {frame}{shownFrame !== null ? ` (đang hiện frame ${shownFrame})` : ''}…</span>}</>;
  const body = (
    <>
      <div style={{ margin: '4px 0', minHeight: 26, display: 'flex', flexWrap: 'wrap', justifyContent: 'center', gap: 4 }}>
        {frame !== null && ranked.map((c, i) => (
          <button key={c.key} onClick={() => setPick(c.key)} style={{ marginRight: 4, fontWeight: c.key === cur?.key ? 700 : 400 }}>
            {files[c.index]!.split('/').pop()} {c.dir ? c.name : '(chưa gán)'}{i === 0 && c.dir ? ' ★' : ''}
          </button>
        ))}
      </div>
      {err && <p style={{ color: '#b00', margin: '2px 0' }}>Lỗi: {err}</p>}
      <div ref={area} style={{ minHeight: floating ? 0 : lastAreaH, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: url && frame !== null ? 'flex-start' : 'center', opacity: loading && url ? 0.55 : 1, transition: 'opacity .15s' }}>
        {frame === null && <p style={{ color: '#666' }}>Bấm vào một cột (tiêu đề frame) để xem ảnh camera của frame đó.</p>}
        {frame !== null && !images && !err && <p style={{ color: '#666' }}>đang tải ảnh…</p>}
        {!loading && images && images.size === 0 && <p>Frame này không có ảnh camera.</p>}
        {!loading && images && images.size > 0 && !url && <p>Không đọc được ảnh đã chọn.</p>}
        {url && frame !== null && <ZoomImage url={url} />}
      </div>
    </>
  );
  return (
    <div ref={anchor} style={{ marginTop: 8, display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>
      <div>
        <b>Ảnh camera · frame {frame ?? '—'}</b>
        {!floating && status}
        {azimuth !== null && <> · phương vị object {azimuth.toFixed(0)}°</>}
        <span style={{ color: '#888' }}> · gán camera ↔ hướng, tắt ảnh camera ở tab Camera</span>{' '}
        {floating
          ? <button onClick={() => setPop(false)} title="Gắn ảnh camera trở lại dưới các cột frame">⧈ Gắn lại</button>
          : <button onClick={() => setPop(true)} title="Tách ảnh camera ra cửa sổ nổi nhỏ: kéo thanh tiêu đề để dời, kéo góc dưới phải để đổi cỡ">⧉ Tách cửa sổ</button>}
      </div>
      {floating
        ? <>
            <p style={{ color: '#666', margin: '2px 0' }}>Ảnh camera đang ở cửa sổ nổi.</p>
            <FloatWin host={host!} onDock={() => setPop(false)} title={<><b>📷 frame {frame ?? '—'}</b>{status}</>}>
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center' }}>{body}</div>
            </FloatWin>
          </>
        : body}
    </div>
  );
}
