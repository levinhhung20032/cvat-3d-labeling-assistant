import { kv } from './storage';
import { onViewport, viewport } from './bridge';
import { useEffect, useMemo, useRef, useState } from 'react';
import { azimuthDeg, type Cuboid } from '../shared/cuboid';
import {
  applyLocalBox, dragEdge, dragMove, dragRotateRel, dragYawByX, hitTest, identityBox, type Hit, type LocalBox,
} from '../shared/edit';
import { referenceCuboid, stateAt, type FrameState } from '../shared/interp';
import {
  bakeKeyframes, removeInnerKeyframes, restoreFrom, setOutsideFrom, setOutsideRange, toggleKeyframe,
  type TrackChange,
} from '../shared/keyframes';
import type { PointCloud } from '../shared/pcd';
import { type ObjectRow, windowCount, windowFrames } from '../shared/table';
import type { CvatAnnotations, CvatJob, CvatLabel, CvatTrack } from '../shared/types';
import { parseLabelSpecs } from '../shared/attributes';
import { AttributePanel } from './AttributePanel';
import { drawView, localize, STATUS_COLOR, type Local, type Scene, type View } from './render';
import { Cancelled, pointClouds } from './stores';
import { ignoreKey, ignoreStore, motionKey, shiftStore, useIgnored } from './shiftStore';
import { CameraPanel } from './CameraPanel';
import { onAction } from './actions';
import { fitReport, type FitReport } from '../shared/fit';
import { groundSnap, type GroundResult } from '../shared/ground';
import { motionJump, type MotionWarning } from '../shared/motion';
import { isFixedSize, suggestBox, type Suggestion } from '../shared/suggest';

const VIEWS: View[] = ['top', 'side', 'front'];
const STATUS_TEXT: Record<FrameState['status'], string> = {
  key: 'keyframe', interp: 'nội suy', hold: 'giữ nguyên', 'outside-key': 'outside (KF)', outside: 'outside', none: 'chưa có',
};
const ZOOM_MIN = 0.5, ZOOM_MAX = 8;
const CELL_MIN = 110, CELL_MAX = 520;

// --- tùy chọn hiển thị, nhớ theo từng người dùng (chỉ là tiện ích, không quan trọng nếu mất) ---
interface Prefs { auto: boolean; size: number }
const loadPrefs = (): Prefs => {
  try {
    const p = JSON.parse(kv.get('cvla-prefs') ?? '{}') as Partial<Prefs>;
    return { auto: p.auto ?? true, size: Math.min(CELL_MAX, Math.max(CELL_MIN, p.size ?? 200)) };
  } catch { return { auto: true, size: 200 }; }
};
const savePrefs = (p: Prefs) => { try { kv.set('cvla-prefs', JSON.stringify(p)); } catch { /* bỏ qua */ } };

function useViewport() {
  const [v, setV] = useState(() => viewport());
  useEffect(() => onViewport(() => setV(viewport())), []);
  return v;
}

function cursorFor(view: View, hit: Hit, alt = false): string {
  if (!hit) return alt ? 'grab' : 'default';
  if (hit.mode === 'move') return alt ? 'grab' : 'move'; // giữ Alt: kéo = xoay
  if (hit.mode === 'rotate') return 'grab';
  const horizontal = (view === 'top' && hit.axis === 'v') || (view === 'side' && hit.axis === 'u') || (view === 'front' && hit.axis === 'v');
  return horizontal ? 'ew-resize' : 'ns-resize';
}

interface DragState { hit: NonNullable<Hit>; x0: number; y0: number; base: LocalBox; moved: boolean }

function Cell({ view, size, loc, st, half, box, misfit, ghost, ground, mark, scene, autoSnap, onPreview, onCommit, onZoom }: {
  scene: Scene;
  mark: { u: number; v: number; w: number } | null;
  ground: number | null; autoSnap: boolean;
  ghost: LocalBox | null; misfit: boolean; view: View; size: number; loc: Local | null; st: FrameState; half: number; box: LocalBox | null;
  onPreview: (b: LocalBox | null) => void; onCommit: (c: Cuboid) => void; onZoom: (factor: number) => void;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragState | null>(null);
  const k = size / (2 * half);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawView(ctx, size, view, loc, box, half, st.status, !!drag.current, misfit, ghost, ground, mark, scene);
  }, [view, size, dpr, loc, st.status, half, box, misfit, ghost, ground, mark, scene]);

  // Cuộn chuột trên ô = phóng to/thu nhỏ mọi frame (listener gốc để chặn cuộn trang).
  const zoomRef = useRef(onZoom);
  zoomRef.current = onZoom;
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const on = (e: WheelEvent) => { e.preventDefault(); zoomRef.current(e.deltaY < 0 ? 1.15 : 1 / 1.15); };
    el.addEventListener('wheel', on, { passive: false });
    return () => el.removeEventListener('wheel', on);
  }, []);

  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top] as const;
  };

  const down = (e: React.PointerEvent) => {
    if (!st.cuboid || e.button !== 0) return;
    const [px, py] = pos(e);
    const base = identityBox(st.cuboid);
    // Giữ Alt: kéo ở bất kỳ đâu trong ô = xoay thay vì di chuyển (cạnh vẫn đổi kích thước).
    let hit = hitTest(view, base, px, py, size, half);
    if (e.altKey && (!hit || hit.mode === 'move')) hit = { mode: 'move' };
    if (!hit || (hit.mode === 'rotate' && view !== 'top')) return;
    ref.current!.setPointerCapture(e.pointerId);
    drag.current = { hit, x0: px, y0: py, base, moved: false };
  };

  const move = (e: React.PointerEvent) => {
    const [px, py] = pos(e);
    const d = drag.current;
    if (!d) {
      if (ref.current && st.cuboid) ref.current.style.cursor = cursorFor(view, hitTest(view, identityBox(st.cuboid), px, py, size, half), e.altKey);
      return;
    }
    const dx = px - d.x0, dy = py - d.y0;
    if (Math.hypot(dx, dy) > 1) d.moved = true;
    const c = size / 2;
    // Nhấn / thả Alt giữa chừng cũng đổi chế độ ngay (di chuyển ↔ xoay), tính từ trạng thái ban đầu.
    const rotating = d.hit.mode === 'rotate' || (d.hit.mode === 'move' && e.altKey);
    const nb =
      rotating
        ? (view === 'top' ? dragRotateRel(d.base, d.x0 - c, d.y0 - c, px - c, py - c) : dragYawByX(d.base, dx))
        : d.hit.mode === 'move' ? dragMove(view, d.base, dx, dy, k)
        : d.hit.mode === 'edge' ? dragEdge(view, d.base, d.hit.axis, d.hit.sign, dx, dy, k)
        : d.base;
    onPreview(nb);
  };

  const up = () => {
    const d = drag.current;
    drag.current = null;
    if (!d || !st.cuboid) return;
    if (d.moved && box) {
      let b = box;
      // Tự bám mặt đất: sau khi dời / đổi cỡ, đặt lại độ cao để đáy chạm mặt đường tại vị trí mới.
      const geometryChanged = b.cu !== 0 || b.cv !== 0 || b.cw !== 0 || b.sx !== st.cuboid.sx || b.sy !== st.cuboid.sy || b.sz !== st.cuboid.sz;
      if (autoSnap && loc && geometryChanged) {
        const g = groundSnap(loc, b.sx, b.sy, b.sz, { cu: b.cu, cv: b.cv, cw: b.cw });
        if (g) b = { ...b, cw: b.cw + g.dz };
      }
      onCommit(applyLocalBox(st.cuboid, b));
    }
    onPreview(null);
  };

  return (
    <canvas
      ref={ref} width={Math.round(size * dpr)} height={Math.round(size * dpr)}
      style={{ display: 'block', width: size, height: size, touchAction: 'none' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; onPreview(null); }}
    />
  );
}

function Column({ f, size, st, refCub, half, locHalf, selected, edited, warn, fixed, ignored, autoSnap, onSnap, onGround, motion, motionIgnored, onIgnoreMotion, onIgnore, onFit, onSuggest, onAccept, onSelect, onLoaded, onCommit, onZoom, onToggleKf, onToggleOutside, onHover, scene }: {
  onToggleOutside: (f: number) => void; onHover: (f: number | null) => void; scene: Scene;
  motion: MotionWarning | null; motionIgnored: boolean; onIgnoreMotion: (f: number, on: boolean) => void;
  autoSnap: boolean; onSnap: (f: number, g: GroundResult | null) => void; onGround: (f: number) => void;
  ignored: boolean; onIgnore: (f: number, on: boolean) => void;
  fixed: boolean; onSuggest: (f: number, s: Suggestion | null) => void; onAccept: (f: number, s: Suggestion) => void;
  warn: boolean; onFit: (f: number, r: FitReport | null) => void;
  onToggleKf: (f: number) => void;
  f: number; size: number; st: FrameState; refCub: Cuboid | null; half: number; locHalf: number; selected: boolean; edited: boolean;
  onSelect: () => void; onLoaded: (f: number) => void; onCommit: (f: number, c: Cuboid) => void; onZoom: (factor: number) => void;
}) {
  const [pc, setPc] = useState<PointCloud | null>(null);
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<LocalBox | null>(null);
  useEffect(() => {
    let live = true;
    setPc(null); setErr('');
    pointClouds.get(f, 0)
      .then((p) => { if (live) { setPc(p); onLoaded(f); } })
      .catch((e) => { if (live && !(e instanceof Cancelled)) setErr(String(e)); });
    return () => { live = false; };
  }, [f]);
  // Lọc điểm một lần ở phạm vi lớn nhất (thu nhỏ tối đa) để phóng to/thu nhỏ không phải lọc lại.
  const loc = useMemo(() => (pc && refCub ? localize(pc, refCub, locHalf) : null), [pc, refCub, locHalf]);
  const fit = useMemo(
    () => (warn && loc && st.cuboid ? fitReport(loc, st.cuboid.sx, st.cuboid.sy, st.cuboid.sz) : null),
    [warn, loc, st.cuboid],
  );
  // Gợi ý sửa box khi cảnh báo lệch; hiện nét đứt trên 3 view, chấp nhận bằng nút / phím A.
  const sug = useMemo(
    () => (!ignored && fit?.level === 'misfit' && loc && st.cuboid ? suggestBox(loc, st.cuboid.sx, st.cuboid.sy, st.cuboid.sz, fixed) : null),
    [fit, loc, st.cuboid, fixed, ignored],
  );
  useEffect(() => { onSuggest(f, sug); }, [f, sug]);
  // Gợi ý đã bỏ qua: không vẽ nét đứt, không tô điểm lọt ngoài, không tính vào cảnh báo.
  const bad = fit && fit.level !== 'ok' && !(ignored && fit.level === 'misfit') ? fit : null;
  useEffect(() => { onFit(f, bad); }, [f, bad]);
  // Ground snap: ước lượng mặt đường dưới chân box.
  const snap = useMemo(() => (loc && st.cuboid ? groundSnap(loc, st.cuboid.sx, st.cuboid.sy, st.cuboid.sz) : null), [loc, st.cuboid]);
  useEffect(() => { onSnap(f, snap); }, [f, snap]);
  // Cảnh báo vật đi xa bất thường: dấu × cam ở vị trí dự đoán từ chuyển động các frame trước.
  const shownMotion = motion && !motionIgnored ? motion : null;
  const mark = useMemo(() => {
    if (!shownMotion || !st.cuboid) return null;
    const dx = shownMotion.pred.x - st.cuboid.x, dy = shownMotion.pred.y - st.cuboid.y;
    const cs = Math.cos(st.cuboid.yaw), sn = Math.sin(st.cuboid.yaw);
    return { u: dx * cs + dy * sn, v: -dx * sn + dy * cs, w: shownMotion.pred.z - st.cuboid.z };
  }, [shownMotion, st.cuboid]);
  const box = preview ?? (st.cuboid ? identityBox(st.cuboid) : null);
  const color = STATUS_COLOR[st.status];
  return (
    <div
      onClick={onSelect}
      // Phím K / O / G / A / I tác dụng lên cột đang trỏ chuột; viền xanh cho biết cột nào sẽ nhận phím.
      onMouseEnter={(e) => { onHover(f); e.currentTarget.style.boxShadow = '0 0 0 3px #2563eb'; }}
      onMouseLeave={(e) => { onHover(null); e.currentTarget.style.boxShadow = ''; }}
      style={{ border: `3px solid ${color}`, outline: selected ? '2px solid #111' : 'none', width: size, flex: 'none' }}
    >
      <div style={{ background: color, color: '#fff', padding: '1px 4px', fontSize: Math.max(11, Math.min(14, size / 14)), whiteSpace: 'nowrap', overflow: 'hidden' }}>
        {bad || shownMotion ? '⚠ ' : ''}frame {f} · {STATUS_TEXT[st.status]}{edited ? ' · ✎' : ''}
        {(st.cuboid || st.status === 'outside' || st.status === 'outside-key') && (
          <button
            title={st.cuboid ? 'Gắn keyframe outside từ frame này (phím O khi trỏ chuột vào cột)' : 'Đưa object trở lại từ frame này (phím O khi trỏ chuột vào cột)'}
            onClick={(e) => { e.stopPropagation(); onToggleOutside(f); }}
            style={{ float: 'right', padding: '0 3px', lineHeight: 1.1, marginRight: 2 }}
          >{st.cuboid ? '⛔' : '↩'}</button>
        )}
        {st.cuboid && (
          <button
            title={st.status === 'key' ? 'Keyframe (khoá). Bấm để mở khoá (về nội suy) — phím K' : 'Chưa là keyframe. Bấm để khoá thành keyframe — phím K'}
            onClick={(e) => { e.stopPropagation(); onToggleKf(f); }}
            style={{ float: 'right', padding: '0 3px', lineHeight: 1.1 }}
          >{st.status === 'key' ? '🔒' : '🔓'}</button>
        )}
      </div>
      {bad && (
        <div style={{ background: bad.level === 'misfit' ? '#ffe0f7' : '#fff1d6', color: '#5a0040', fontSize: 11, padding: '1px 4px' }} title={bad.message}>
          ⚠ {bad.message}
          {sug && (
            <div style={{ color: '#006b7a' }}>
              {sug.message}{' '}
              <button onClick={(e) => { e.stopPropagation(); onAccept(f, sug); }} style={{ padding: '0 4px' }}>✔ nhận</button>{' '}
              <button onClick={(e) => { e.stopPropagation(); onIgnore(f, true); }} style={{ padding: '0 4px' }} title="Bỏ qua gợi ý ở frame này (phím I)">✖ bỏ qua</button>
            </div>
          )}
        </div>
      )}
      {ignored && fit?.level === 'misfit' && (
        <div style={{ background: '#eee', color: '#555', fontSize: 11, padding: '1px 4px' }}>
          đã bỏ qua gợi ý{' '}
          <button onClick={(e) => { e.stopPropagation(); onIgnore(f, false); }} style={{ padding: '0 4px' }}>hoàn lại</button>
        </div>
      )}
      {shownMotion && (
        <div style={{ background: '#ffe9c7', color: '#6b3a00', fontSize: 11, padding: '1px 4px' }} title={shownMotion.message}>
          ⚠ {shownMotion.message}{' '}
          <button onClick={(e) => { e.stopPropagation(); onIgnoreMotion(f, true); }} style={{ padding: '0 4px' }}>✖ bỏ qua</button>
        </div>
      )}
      {motion && motionIgnored && (
        <div style={{ background: '#eee', color: '#555', fontSize: 11, padding: '1px 4px' }}>
          đã bỏ qua cảnh báo đi xa{' '}
          <button onClick={(e) => { e.stopPropagation(); onIgnoreMotion(f, false); }} style={{ padding: '0 4px' }}>hoàn lại</button>
        </div>
      )}
      {snap && Math.abs(snap.dz) >= 0.08 && (
        <div style={{ background: '#eaf6d8', color: '#2d5a00', fontSize: 11, padding: '1px 4px' }}>
          ⏬ đáy {snap.dz < 0 ? 'lơ lửng' : 'chìm'} {Math.abs(snap.dz).toFixed(2)} m{snap.flat ? '' : ' (mặt đất không phẳng)'}{' '}
          <button onClick={(e) => { e.stopPropagation(); onGround(f); }} style={{ padding: '0 4px' }} title="Dời box theo z để đáy chạm mặt đường (phím G)">snap</button>
        </div>
      )}
      {VIEWS.map((v) => (
        <Cell key={v} scene={scene} mark={mark} ground={snap?.groundW ?? null} autoSnap={autoSnap} ghost={sug?.box ?? null} misfit={bad?.level === 'misfit'} view={v} size={size} loc={loc} st={st} half={half} box={box} onPreview={setPreview} onCommit={(c) => onCommit(f, c)} onZoom={onZoom} />
      ))}
      {!pc && <div style={{ fontSize: 11, padding: 2 }}>{err ? `Lỗi: ${err}` : 'đang tải…'}</div>}
    </div>
  );
}

/** Ô nhập ID object (ID hiển thị như giao diện CVAT). */
function IdBox({ value, max, onCommit }: { value: number; max: number; onCommit: (n: number) => void }) {
  const [text, setText] = useState(String(value));
  const [bad, setBad] = useState(false);
  useEffect(() => { setText(String(value)); setBad(false); }, [value]);
  const go = () => {
    const n = Number(text.trim());
    if (Number.isInteger(n) && n >= 1 && n <= max) { setBad(false); onCommit(n); } else setBad(true);
  };
  return (
    <>
      Object ID{' '}
      <input
        value={text} inputMode="numeric" size={5}
        onChange={(e) => setText(e.target.value)}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => { if (e.key === 'Enter') { go(); (e.target as HTMLInputElement).blur(); } }}
        onBlur={() => { if (text !== String(value)) go(); }}
        style={{ width: 64, borderColor: bad ? '#b00' : undefined, background: bad ? '#fee' : undefined }}
      />
      {bad && <span style={{ color: '#b00' }}> không có object này (1–{max})</span>}
    </>
  );
}

export function BatchReview({ job, ann, rows, selectedNum, setSelectedNum, initialWindow, edited, onEdit, onTrack, focus, onView, onSel, onHoverFrame, labels }: {
  onHoverFrame: (f: number | null) => void;
  labels: CvatLabel[];
  onSel: (frame: number | null) => void;
  onView: (frames: number[]) => void;
  focus: { frame: number; nonce: number } | null;
  onTrack: (trackIndex: number, track: CvatTrack, frames: number[]) => void;
  job: CvatJob; ann: CvatAnnotations; rows: ObjectRow[]; selectedNum: number | null; setSelectedNum: (n: number) => void;
  initialWindow: number; edited: Set<string>; onEdit: (trackIndex: number, frame: number, c: Cuboid) => void;
}) {
  const { start_frame: start, stop_frame: stop } = job;
  const nWin = windowCount(start, stop);
  const [k, setK] = useState(Math.min(initialWindow, nWin - 1));
  const [selFrame, setSelFrame] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null); // cột frame đang trỏ chuột (không cần render lại)
  const [loaded, setLoaded] = useState<Set<number>>(new Set());
  const [prefs, setPrefs] = useState(loadPrefs);
  const [zoom, setZoom] = useState(1);
  const [note, setNote] = useState('');
  const [warn, setWarn] = useState(true);
  const [fits, setFits] = useState<Map<number, FitReport | null>>(new Map());
  const [sugs, setSugs] = useState<Map<number, Suggestion | null>>(new Map());
  const ign = useIgnored();
  const [snaps, setSnaps] = useState<Map<number, GroundResult | null>>(new Map());
  const [autoSnap, setAutoSnapState] = useState(() => { try { return kv.get('cvla-autosnap') === '1'; } catch { return false; } });
  const setAutoSnap = (v: boolean) => { setAutoSnapState(v); try { kv.set('cvla-autosnap', v ? '1' : '0'); } catch { /* bỏ qua */ } };
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const vp = useViewport();
  const max = ann.tracks.length;
  const num = selectedNum ?? 1;
  const track = ann.tracks[num - 1] ?? null;
  const row = rows.find((r) => r.num === num);
  const specs = useMemo(() => parseLabelSpecs(labels), [labels]);
  const frames = windowFrames(k, start, stop);
  const framesKey = frames.join(',');
  useEffect(() => { onView(frames); }, [framesKey]);
  useEffect(() => { onSel(selFrame); }, [selFrame]);

  const updatePrefs = (p: Prefs) => { setPrefs(p); savePrefs(p); };
  const zoomBy = (factor: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));
  useEffect(() => { setZoom(1); }, [num]);

  // Cỡ ô: tự khớp độ phân giải màn hình (đủ rộng cho 6 cột và đủ cao cho 3 hàng), hoặc chỉnh tay.
  const cols6 = 6;
  const fitW = Math.floor((vp.w - 24 - (cols6 - 1) * 6) / cols6 - 6);
  const fitH = Math.floor((vp.h - 190) / 3);
  const size = prefs.auto ? Math.min(CELL_MAX, Math.max(CELL_MIN, Math.min(fitW, fitH))) : prefs.size;

  const baseHalf = useMemo(() => {
    if (!track) return 5;
    let m = 1;
    for (const s of track.shapes) if (!s.outside) m = Math.max(m, s.points[6] ?? 0, s.points[7] ?? 0, s.points[8] ?? 0);
    return Math.min(15, Math.max(3, m * 0.8 + 1));
  }, [track]);
  const half = baseHalf / zoom;
  const scene = useMemo<Scene>(() => ({ zClip: baseHalf, slab: baseHalf * 0.5, colorHalf: baseHalf }), [baseHalf]);
  const locHalf = baseHalf / ZOOM_MIN;

  const cols = useMemo(
    () => frames.map((f) => ({
      f,
      st: track ? stateAt(track, f) : { status: 'none' as const, cuboid: null },
      ref: track ? referenceCuboid(track, f, stop) : null,
      mot: track ? motionJump(track, f, row?.label ?? '') : null,
    })),
    [track, framesKey, stop, row?.label],
  );

  // Kế hoạch tải: cửa sổ đang xem trước, rồi các frame phía sau (gần trước), rồi phía trước; tối đa 60 frame.
  // Chạy nền trong lúc người dùng chỉnh sửa; đổi cửa sổ thì kế hoạch được sắp lại quanh vị trí mới.
  useEffect(() => {
    setLoaded(new Set());
    const cs = frames[0]!, ce = frames[frames.length - 1]!;
    const prio = new Map<number, number>();
    for (const f of frames) prio.set(f, 0);
    for (let f = ce + 1; f <= stop; f++) prio.set(f, 1 + (f - ce));
    for (let f = cs - 1; f >= start; f--) prio.set(f, 4 + 2 * (cs - f));
    pointClouds.plan(new Map([...prio].sort((a, b) => a[1] - b[1]).slice(0, 60)));
  }, [k, nWin, start, stop]);

  // Khoảng frame cho thao tác hàng loạt: mặc định bằng cửa sổ đang xem.
  useEffect(() => {
    setRangeFrom(String(frames[0]));
    setRangeTo(String(frames[frames.length - 1]));
  }, [framesKey]);
  const range = (): [number, number] | null => {
    const a = Number(rangeFrom), b = Number(rangeTo);
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < start || b > stop || a > b) {
      setNote(`Khoảng frame không hợp lệ (${start}–${stop}, từ ≤ đến).`);
      return null;
    }
    return [a, b];
  };
  const apply = (res: TrackChange | null, ok: string, none: string) => {
    if (!res || !res.frames.length) { setNote(none); return; }
    onTrack(num - 1, res.track, res.frames);
    setNote(ok.replace('{n}', String(res.frames.length)));
  };
  const toggleKf = (f: number) =>
    apply(track ? toggleKeyframe(track, f) : null, `Đã đổi keyframe frame ${f}.`,
      'Không đổi được: chỉ bật/tắt keyframe ở frame có box; không gỡ keyframe outside hoặc keyframe đầu tiên của track.');
  /** Gắn keyframe outside tại frame f (tới keyframe kế tiếp); frame đang outside thì đưa object trở lại. */
  const toggleOutside = (f: number) => {
    if (!track) return;
    const st = stateAt(track, f);
    const isOut = st.status === 'outside' || st.status === 'outside-key';
    const res = isOut ? restoreFrom(track, f, stop) : setOutsideFrom(track, f);
    apply(res, isOut ? `Frame ${f}: đã đưa object trở lại (có box).` : `Frame ${f}: đã gắn keyframe outside (tới keyframe kế tiếp).`,
      'Không đổi được: cần frame có box (không phải keyframe đầu của track) hoặc frame outside có box tham chiếu.');
  };
  const outsideRange = () => {
    const r = range();
    if (r && track) apply(setOutsideRange(track, r[0], r[1], stop), `Đã đặt outside ${'{n}'} frame trong ${r[0]}–${r[1]}. Hoàn tác được.`, 'Không có frame nào trong khoảng này đổi được.');
  };
  const unlockInner = () => {
    const r = range();
    if (r && track) apply(removeInnerKeyframes(track, r[0], r[1]), `Đã mở khoá ${'{n}'} keyframe ở giữa ${r[0]}–${r[1]} (giữ hai đầu mút). Hoàn tác được.`, 'Không có keyframe nào ở giữa khoảng này để gỡ.');
  };
  const lockAll = (whole: boolean) => {
    const r = whole ? ([start, stop] as [number, number]) : range();
    if (r && track) apply(bakeKeyframes(track, r[0], r[1]), `Đã khoá ${'{n}'} frame thành keyframe (${r[0]}–${r[1]}). Hoàn tác được.`, 'Mọi frame có box trong khoảng này đã là keyframe.');
  };
  useEffect(() => { setNote(''); }, [num, k]);
  /** Chấp nhận gợi ý: áp box đề xuất thành keyframe (vào nháp, hoàn tác được). */
  const accept = (f: number, s: Suggestion) => {
    const st = track ? stateAt(track, f) : null;
    if (!st?.cuboid) return;
    onEdit(num - 1, f, applyLocalBox(st.cuboid, s.box));
    shiftStore.accepted(job.id, num);
    setNote(`Frame ${f}: đã chấp nhận gợi ý (${s.message.replace('gợi ý: ', '')}).`);
  };
  const acceptSelectedOrAll = () => {
    const tgt = hoverRef.current ?? selFrame; // trỏ chuột > frame đã chọn > cả cửa sổ
    const list = tgt !== null ? [tgt] : frames;
    const todo = list.filter((f) => sugs.get(f));
    if (!todo.length) { setNote(hoverRef.current !== null || selFrame !== null ? `Frame ${hoverRef.current ?? selFrame} không có gợi ý (box đang khớp, quá ít điểm, hoặc chưa tải xong).` : 'Cửa sổ này không có gợi ý nào.'); return; }
    todo.forEach((f) => accept(f, sugs.get(f)!));
    if (todo.length > 1) setNote(`Đã chấp nhận gợi ý cho ${todo.length} frame: ${todo.join(', ')}. Hoàn tác được.`);
  };
  /** Bỏ qua gợi ý của một hoặc nhiều frame (lưu cục bộ theo job, bật lại được). */
  const ignoreFrames = (list: number[], on: boolean) => {
    ignoreStore.set(list.map((f) => ignoreKey(job.id, num, f)), on);
    if (on) list.forEach(() => shiftStore.ignored());
  };
  const ignoreSelectedOrAll = () => {
    const tgt = hoverRef.current ?? selFrame; // trỏ chuột > frame đã chọn > cả cửa sổ
    const list = tgt !== null ? [tgt] : frames;
    const todo = list.filter((f) => sugs.get(f));
    if (!todo.length) { setNote('Không có gợi ý nào để bỏ qua.'); return; }
    ignoreFrames(todo, true);
    setNote(`Đã bỏ qua gợi ý ở frame ${todo.join(', ')}. Bấm "hoàn lại" trong cột để bật lại.`);
  };
  /** Ground snap: dời box theo z để đáy chạm mặt đường (vào nháp, thành keyframe, hoàn tác được). */
  const groundFrame = (f: number): boolean => {
    const st = track ? stateAt(track, f) : null;
    const g = snaps.get(f);
    if (!st?.cuboid || !g || Math.abs(g.dz) < 0.005) return false;
    onEdit(num - 1, f, { ...st.cuboid, z: st.cuboid.z + g.dz });
    return true;
  };
  const groundSelectedOrAll = () => {
    const tgt = hoverRef.current ?? selFrame; // trỏ chuột > frame đã chọn > cả cửa sổ
    const list = tgt !== null ? [tgt] : frames;
    const done = list.filter((f) => groundFrame(f));
    setNote(done.length
      ? `Ground snap: đã hạ/nâng đáy box chạm mặt đường ở frame ${done.join(', ')}. Hoàn tác được.`
      : `Không có gì để snap${hoverRef.current !== null || selFrame !== null ? ` ở frame ${hoverRef.current ?? selFrame}` : ''} (đã chạm đất, thiếu điểm mặt đường, hoặc lệch quá 1 m).`);
  };
  const misfitFrames = frames.filter((f) => fits.get(f)?.level === 'misfit');
  const sparseFrames = frames.filter((f) => fits.get(f)?.level === 'sparse');

  const [cached, setCached] = useState(pointClouds.cachedCount());
  useEffect(() => pointClouds.subscribe(() => setCached(pointClouds.cachedCount())), []);

  // Nhảy tới frame hiện tại của CVAT khi đồng bộ.
  useEffect(() => {
    if (!focus) return;
    setK(Math.min(nWin - 1, Math.max(0, Math.floor((focus.frame - start) / 5))));
  }, [focus?.nonce]);

  // Thao tác bàn phím (đã ánh xạ theo keymap ở App).
  useEffect(
    () => onAction((id) => {
      const cs = cols.map((c) => c.f);
      switch (id) {
        case 'win.next': setK((x) => Math.min(nWin - 1, x + 1)); break;
        case 'win.prev': setK((x) => Math.max(0, x - 1)); break;
        case 'obj.next': if (num < max) setSelectedNum(num + 1); break;
        case 'obj.prev': if (num > 1) setSelectedNum(num - 1); break;
        case 'sel.next': setSelFrame(cs[Math.min(cs.length - 1, (selFrame === null ? -1 : cs.indexOf(selFrame)) + 1)] ?? null); break;
        case 'sel.prev': setSelFrame(cs[Math.max(0, (selFrame === null ? cs.length : cs.indexOf(selFrame)) - 1)] ?? null); break;
        case 'outside.from': {
          const tgt = hoverRef.current ?? selFrame;
          if (tgt === null) setNote('Rê chuột lên một cột frame (hoặc chọn cột) rồi nhấn phím.');
          else toggleOutside(tgt);
          break;
        }
        case 'suggest.accept': acceptSelectedOrAll(); break;
        case 'suggest.ignore': ignoreSelectedOrAll(); break;
        case 'ground.snap': groundSelectedOrAll(); break;
        case 'zoom.in': zoomBy(1.25); break;
        case 'zoom.out': zoomBy(1 / 1.25); break;
        case 'zoom.reset': setZoom(1); break;
        case 'kf.toggle': {
          const tgt = hoverRef.current ?? selFrame;
          if (tgt === null) setNote('Rê chuột lên một cột frame (hoặc chọn cột) rồi nhấn phím.');
          else toggleKf(tgt);
          break;
        }
      }
    }),
    [num, max, nWin, selFrame, track, k, cols, sugs, ign, snaps],
  );

  if (!track) return <p>Job chưa có object.</p>;
  const selCol = cols.find((c) => c.f === selFrame) ?? null;
  const az = selCol?.ref ? azimuthDeg(selCol.ref) : null;

  return (
    <>
      <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
        <span><IdBox value={num} max={max} onCommit={setSelectedNum} />{' '}
          {row && <b>{row.label}</b>} {row && <span style={{ color: '#555' }}>(gán {row.assigned}, outside {row.outside}, thiếu KF {row.missing}, ID database {row.id})</span>}</span>
        <span>
          <button disabled={k === 0} onClick={() => setK(k - 1)}>◀</button>{' '}
          Cửa sổ {k + 1}/{nWin} (frame {frames[0]}–{frames[frames.length - 1]}){' '}
          <button disabled={k >= nWin - 1} onClick={() => setK(k + 1)}>▶</button>
        </span>
        <span>
          Zoom <button onClick={() => zoomBy(1 / 1.25)}>−</button> <b>{Math.round(zoom * 100)}%</b>{' '}
          <button onClick={() => zoomBy(1.25)}>+</button> <button onClick={() => setZoom(1)}>Vừa object</button>
        </span>
        <span>
          Cỡ ô{' '}
          <label><input type="checkbox" checked={prefs.auto} onChange={(e) => updatePrefs({ ...prefs, auto: e.target.checked })} /> tự khớp màn hình</label>{' '}
          <input
            type="range" min={CELL_MIN} max={CELL_MAX} step={10} value={size} disabled={prefs.auto}
            onChange={(e) => updatePrefs({ auto: false, size: Number(e.target.value) })}
          /> {size}px
        </span>
        <label title="Cảnh báo box không bao đúng cụm điểm (điểm lọt ra ngoài box) hoặc dưới 6 điểm"><input type="checkbox" checked={warn} onChange={(e) => setWarn(e.target.checked)} /> cảnh báo lệch</label>
        {warn && (misfitFrames.length > 0 || sparseFrames.length > 0) && (
          <span style={{ color: '#a0006e', fontWeight: 600 }}>
            ⚠ {misfitFrames.length ? `lệch: frame ${misfitFrames.join(', ')}` : ''}{misfitFrames.length && sparseFrames.length ? ' · ' : ''}{sparseFrames.length ? `ít điểm: frame ${sparseFrames.join(', ')}` : ''}
          </span>
        )}
        {cols.some((c) => c.mot && !ign.has(motionKey(job.id, num, c.f))) && (
          <span style={{ color: '#a05a00', fontWeight: 600 }}>
            ⚠ đi xa bất thường: frame {cols.filter((c) => c.mot && !ign.has(motionKey(job.id, num, c.f))).map((c) => c.f).join(', ')}
          </span>
        )}
        <span>cửa sổ: {loaded.size}/{frames.length} · đã tải trước: {cached}/{stop - start + 1}</span>
      </div>
      <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center', background: '#f4f4f4', padding: '4px 6px' }}>
        <b>Keyframe</b>
        <span>
          frame{' '}
          <input value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} size={3} style={{ width: 44 }} /> →{' '}
          <input value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} size={3} style={{ width: 44 }} />
        </span>
        <button onClick={unlockInner} title="Gỡ mọi keyframe nằm hẳn bên trong khoảng, giữ hai đầu mút; frame về nội suy">🔓 Mở khoá KF giữa</button>
        <button onClick={() => lockAll(false)} title="Biến mọi frame có box trong khoảng thành keyframe (giá trị giữ nguyên)">🔒 Khoá tất cả thành KF</button>
        <button onClick={() => lockAll(true)} title="Như trên nhưng cho cả track">🔒 Cả track</button>
        <span style={{ borderLeft: '1px solid #bbb', height: 18 }} />
        <button
          disabled={selFrame === null}
          onClick={() => selFrame !== null && toggleOutside(selFrame)}
          title="Phím O. Frame có box → outside từ frame này tới keyframe kế tiếp; frame outside → đưa object trở lại. Chọn frame bằng cách bấm tiêu đề cột."
        >⛔ Gắn KF outside / trở lại — frame {selFrame ?? '…'} (O)</button>
        <span style={{ borderLeft: '1px solid #bbb', height: 18 }} />
        <button
          onClick={acceptSelectedOrAll}
          disabled={![...sugs.values()].some(Boolean)}
          style={{ fontWeight: 700, background: [...sugs.values()].some(Boolean) ? '#c9f3ff' : undefined }}
          title="Áp box gợi ý (nét đứt xanh lơ) cho frame đang chọn; nếu chưa chọn frame thì cho mọi frame có gợi ý trong cửa sổ. Phím A."
        >✔ Chấp nhận gợi ý (A){[...sugs.entries()].filter(([f, s]) => s && frames.includes(f)).length ? ` · ${[...sugs.entries()].filter(([f, s]) => s && frames.includes(f)).length}` : ''}</button>
        <button
          onClick={ignoreSelectedOrAll}
          disabled={![...sugs.values()].some(Boolean)}
          title="Bỏ qua gợi ý (nét đứt xanh lơ) của frame đang chọn; nếu chưa chọn frame thì của mọi frame có gợi ý trong cửa sổ. Phím I."
        >✖ Bỏ qua gợi ý (I)</button>
        <button
          onClick={groundSelectedOrAll}
          title="Ground snap: ước lượng mặt đường quanh chân box (đường xanh lá nét đứt ở view Bên/Trước) rồi hạ/nâng box cho đáy chạm đất. Frame đang chọn, hoặc cả cửa sổ nếu chưa chọn. Phím G."
        >⏬ Ground snap (G)</button>
        <label title="Sau mỗi lần dời / đổi cỡ box bằng chuột, tự đặt lại độ cao cho đáy chạm mặt đường tại vị trí mới">
          <input type="checkbox" checked={autoSnap} onChange={(e) => setAutoSnap(e.target.checked)} /> tự bám mặt đất khi kéo
        </label>
        <button onClick={outsideRange} title="Đặt outside cho mọi frame có box trong khoảng từ → đến; frame ngay sau khoảng giữ nguyên">⛔ Outside cả khoảng</button>
        <span style={{ color: '#555' }}>· 🔒/🔓 trên tiêu đề cột hoặc phím K: khoá/mở khoá frame đang chọn</span>
        {note && <span style={{ color: '#7a4b00' }}>{note}</span>}
      </div>
      <details open style={{ margin: '0 0 6px', background: '#f8fbff', border: '1px solid #cfe0f5', padding: '2px 6px' }}>
        <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
          Thuộc tính (attribute){(() => {
            const sp = specs.get(track.label_id);
            return sp ? ' · ' + (sp.attrs.map((a) => a.name).join(', ') || 'không có') : '';
          })()}
        </summary>
        {(() => {
          const refFrame = selFrame ?? cols.find((c) => c.st.cuboid)?.f ?? frames[0] ?? null;
          const refCol = cols.find((c) => c.f === refFrame);
          const peds = refFrame === null ? [] : ann.tracks
            .filter((t) => specs.get(t.label_id)?.name.toLowerCase() === 'pedestrian')
            .map((t) => stateAt(t, refFrame).cuboid)
            .filter((c): c is Cuboid => !!c);
          return (
            <AttributePanel
              track={track} num={num} label={specs.get(track.label_id)?.name ?? row?.label ?? ''} spec={specs.get(track.label_id)}
              frame={refFrame} box={refCol?.st.cuboid ?? null} pedestrians={peds} jobId={job.id}
              onApply={(t, fr) => onTrack(num - 1, t, fr)}
            />
          );
        })()}
      </details>
      <div style={{ fontSize: 11, color: '#666', marginBottom: 4 }}>
        phím K / O / G / A / I tác dụng lên cột frame đang trỏ chuột (viền xanh) · xem/đổi phím ở tab "Phím tắt" · cuộn chuột trên ô để zoom mọi frame · kéo trong box để dời, kéo cạnh để đổi kích thước, kéo chấm trắng ngắn ở đầu mũi tên (view Trên) hoặc GIỮ ALT rồi kéo (mọi view) để xoay · sửa frame nào thì frame đó thành keyframe
      </div>
      <div style={{ display: 'flex', gap: 6, overflowX: 'auto' }}>
        {cols.map((c) => (
          <Column
            key={c.f} f={c.f} size={size} st={c.st} refCub={c.ref} half={half} locHalf={locHalf} selected={selFrame === c.f}
            edited={edited.has(`${num}:${c.f}`)} warn={warn} fixed={isFixedSize(row?.label ?? '')} ignored={ign.has(ignoreKey(job.id, num, c.f))}
            onIgnore={(f, on) => ignoreFrames([f], on)}
            motion={c.mot} motionIgnored={ign.has(motionKey(job.id, num, c.f))}
            onIgnoreMotion={(f, on) => ignoreStore.set([motionKey(job.id, num, f)], on)}
            autoSnap={autoSnap} onGround={(f) => { if (!groundFrame(f)) setNote('Không snap được frame này.'); }}
            onSnap={(f, g) => setSnaps((m) => (m.get(f) === g ? m : new Map(m).set(f, g)))}
            onSuggest={(f, s) => setSugs((m) => (m.get(f) === s ? m : new Map(m).set(f, s)))} onAccept={accept}
            onFit={(f, r) => setFits((m) => (m.get(f) === r ? m : new Map(m).set(f, r)))} onSelect={() => setSelFrame(c.f)}
            onLoaded={(f) => setLoaded((s) => new Set(s).add(f))}
            onCommit={(f, cub) => onEdit(num - 1, f, cub)} onZoom={zoomBy} onToggleKf={toggleKf} onToggleOutside={toggleOutside} onHover={(f) => { hoverRef.current = f; onHoverFrame(f); }} scene={scene}
          />
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
        Viền: <span style={{ color: STATUS_COLOR.key }}>■ keyframe</span> <span style={{ color: STATUS_COLOR.interp }}>■ nội suy</span>{' '}
        <span style={{ color: STATUS_COLOR.hold }}>■ giữ nguyên</span> <span style={{ color: STATUS_COLOR.outside }}>■ outside</span>{' '}
        <span style={{ color: STATUS_COLOR.none }}>■ chưa có</span> · khung nhìn rộng ±{half.toFixed(1)} m quanh object
      </div>
      {selCol ? <CameraPanel frame={selCol.f} azimuth={az} /> : <p style={{ color: '#666' }}>Bấm vào một cột (tiêu đề frame) để xem ảnh camera của frame đó.</p>}
    </>
  );
}
