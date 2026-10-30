import { apply, transpose, type Mat3 } from '../shared/rot';
import { kv } from './storage';
import { onViewport, viewport } from './bridge';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { azimuthDeg, type Cuboid } from '../shared/cuboid';
import {
  applyLocalBox, viewFrame, dragCorner, dragEdge, dragMove, dragRotateRel, dragTilt, dragYawByX, hitTest, identityBox, localBoxOf, type Hit, type LocalBox,
} from '../shared/edit';
import { referenceCuboid, stateAt, type FrameState } from '../shared/interp';
import { upsertKeyframe as upsertKf } from '../shared/edit';
import {
  removeInnerKeyframes, restoreFrom, setOutsideFrom, setOutsideRange, toggleKeyframe,
  type TrackChange,
} from '../shared/keyframes';
import type { PointCloud } from '../shared/pcd';
import { type ObjectRow, pageCount, pageFrames, pageOf } from '../shared/table';
import type { CvatAnnotations, CvatJob, CvatLabel, CvatTrack } from '../shared/types';
import { parseLabelSpecs } from '../shared/attributes';
import { AttributePanel } from './AttributePanel';
import { gpuActive } from './gpu';
import { Help, PENDING_STYLE, Pill, Slider } from './ui';
import { clampPan, drawView, type EgoPlane, localize, NO_PAN, panBy, panOffset, rotateLocal, STATUS_COLOR, type Local, type Pan, type Scene, type View } from './render';
import { Cancelled, pointClouds } from './stores';
import { issueKey, ignoreKey, ignoreStore, motionKey, overlapKey, shiftStore, useIgnored } from './shiftStore';
import { CameraPanel } from './CameraPanel';
import { qcStore, useQcMode, useQcNotes } from './qcStore';
import { qcKey } from '../shared/qc';
import { onAction } from './actions';
import { DEFAULT_FIT, fitGroundOf, fitReport, type FitReport } from '../shared/fit';
import { thresholdStore, useThresholdVersion } from './thresholdStore';
import { sym, useSymbols } from './symbolStore';
import { findLongOutsideGaps, SPLIT_OUTSIDE_FRAMES, type OutsideGap } from '../shared/splitId';
import { confirmSnap, DEFAULT_GROUND, groundSnap, tiltFromPlane, type GroundResult, type GroundSector } from '../shared/ground';
import { motionJump, type MotionWarning } from '../shared/motion';
import { trackIssues, type FrameIssue, type IssueKind } from '../shared/qcrules';
import { flagKey, flagState, type FlagMark, type FlagState } from '../shared/qcimport';
import { qcFlagStore, useFlagMarks, useQcImports } from './qcFlagStore';
import { suggestBox, type Suggestion } from '../shared/suggest';
import { defaultDyn, useDynClasses, useDynRules } from './dynClassStore';
import { resolveDyn } from '../shared/dynrule';
import { propagateSize, sameSize } from '../shared/dynsize';
import { fmtIou, type OverlapItem } from '../shared/overlap';

const VIEWS: View[] = ['top', 'side', 'front'];
const STATUS_TEXT: Record<FrameState['status'], string> = {
  key: 'keyframe', interp: 'nội suy', hold: 'giữ nguyên', 'outside-key': 'outside (KF)', outside: 'outside', none: 'chưa có',
};
const EMPTY_CUBS: Cuboid[] = [];
const ZOOM_MIN = 0.5, ZOOM_MAX = 8;
const CELL_MIN = 110, CELL_MAX = 520;

// --- tùy chọn hiển thị, nhớ theo từng người dùng (chỉ là tiện ích, không quan trọng nếu mất) ---
interface Prefs { auto: boolean; size: number; slabMargin: number; perWin: number; keyOnly: boolean; tilt: boolean; gap: number; ground: boolean; suggest: boolean; egoPlane: boolean }
const PREFS_DEFAULT: Prefs = { auto: true, size: 200, slabMargin: 0.5, perWin: 6, keyOnly: false, tilt: true, gap: 28, ground: true, suggest: true, egoPlane: false };
const loadPrefs = (): Prefs => {
  try {
    const p = JSON.parse(kv.get('cvla-prefs') ?? '{}') as Partial<Prefs>;
    const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      auto: p.auto ?? true, size: num(p.size, 200, CELL_MIN, CELL_MAX), slabMargin: num(p.slabMargin, 0.5, 0, 3),
      perWin: Math.round(num(p.perWin, 6, 2, 30)), keyOnly: p.keyOnly === true, tilt: p.tilt !== false, gap: Math.round(num(p.gap, 28, 4, 80)), ground: p.ground !== false, suggest: p.suggest !== false, egoPlane: p.egoPlane === true,
    };
  } catch { return { ...PREFS_DEFAULT }; }
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
  if (hit.mode === 'corner') return hit.diag === 'nwse' ? 'nwse-resize' : 'nesw-resize';
  const horizontal = (view === 'top' && hit.axis === 'v') || (view === 'side' && hit.axis === 'u') || (view === 'front' && hit.axis === 'v');
  return horizontal ? 'ew-resize' : 'ns-resize';
}

interface DragState { hit: NonNullable<Hit>; x0: number; y0: number; base: LocalBox; moved: boolean }

function Cell({ frame, view, size, loc, st, half, box, misfit, ghost, ground, groundMarks, contactW, egoPlane, mark, scene, overlays, tiltOn, autoSnap, onPreview, onCommit, onZoom, pan, onPan }: {
  egoPlane: EgoPlane | null; // mặt phẳng Oxy của ego trong hệ của khung nhìn (null: công tắc tắt)
  scene: Scene; overlays: LocalBox[]; tiltOn: boolean; frame: Mat3 | null; // frame: khung nhìn căn theo box nghiêng (null nếu box không nghiêng)
  mark: { u: number; v: number; w: number } | null;
  ground: number | null; autoSnap: boolean;
  groundMarks: GroundSector[]; contactW: number | null; // mặt đường đo được ở từng cung quanh box + lớp tiếp xúc dưới gầm (để vẽ)
  ghost: LocalBox | null; misfit: boolean; view: View; size: number; loc: Local | null; st: FrameState; half: number; box: LocalBox | null;
  onPreview: (b: LocalBox | null) => void; onCommit: (c: Cuboid) => void; onZoom: (factor: number) => void;
  pan: Pan; onPan: (p: Pan) => void; // dời khung nhìn (giữ chuột phải kéo), dùng chung mọi view / frame
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragState | null>(null);
  const panDrag = useRef<{ x0: number; y0: number; base: Pan } | null>(null);
  const k = size / (2 * half);
  const [ox, oy] = panOffset(view, pan, k);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawView(ctx, size, view, loc, box, half, st.status, !!drag.current, misfit, ghost, ground, mark, scene, overlays, st.cuboid, groundMarks, contactW, pan, egoPlane);
  }, [view, size, dpr, loc, st.status, st.cuboid, half, box, misfit, ghost, ground, groundMarks, contactW, egoPlane, mark, scene, overlays, pan]);

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

  // Toạ độ chuột quy về khung nhìn CHƯA dời, để chọn cạnh / kéo / xoay box không phải biết tới việc dời.
  const pos = (e: React.PointerEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left - ox, e.clientY - r.top - oy] as const;
  };

  const down = (e: React.PointerEvent) => {
    if (e.button === 2) {
      // Giữ chuột phải kéo = dời khung nhìn (mọi frame cùng dời), không sửa box.
      e.preventDefault();
      ref.current!.setPointerCapture(e.pointerId);
      panDrag.current = { x0: e.clientX, y0: e.clientY, base: pan };
      ref.current!.style.cursor = 'grabbing';
      return;
    }
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
    const p = panDrag.current;
    if (p) { onPan(panBy(view, p.base, (e.clientX - p.x0) / k, (e.clientY - p.y0) / k)); return; }
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
    // Giữ Alt: view Trên xoay yaw; view Bên / Trước xoay pitch / roll (nghiêng theo mặt đường) nếu bật, không thì xoay yaw như cũ.
    const nb =
      rotating
        ? (view === 'top' ? dragRotateRel(d.base, d.x0 - c, d.y0 - c, px - c, py - c)
          : tiltOn ? dragTilt(view, d.base, d.x0 - c, d.y0 - c, px - c, py - c) : dragYawByX(d.base, dx))
        : d.hit.mode === 'move' ? dragMove(view, d.base, dx, dy, k)
        : d.hit.mode === 'edge' ? dragEdge(view, d.base, d.hit.axis, d.hit.sign, dx, dy, k)
        : d.hit.mode === 'corner' ? dragCorner(view, d.base, d.hit.h, d.hit.v, dx, dy, k)
        : d.base;
    onPreview(nb);
  };

  const up = () => {
    if (panDrag.current) {
      panDrag.current = null;
      if (ref.current) ref.current.style.cursor = 'default';
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d || !st.cuboid) return;
    if (d.moved && box) {
      let b = box;
      // Tự bám mặt đất: sau khi dời / đổi cỡ, đặt lại độ cao để đáy chạm mặt đường tại vị trí mới.
      const geometryChanged = b.cu !== 0 || b.cv !== 0 || b.cw !== 0 || b.sx !== st.cuboid.sx || b.sy !== st.cuboid.sy || b.sz !== st.cuboid.sz;
      if (autoSnap && loc && geometryChanged && !frame) {
        const at = { cu: b.cu, cv: b.cv, cw: b.cw, range: Math.hypot(st.cuboid.x, st.cuboid.y) };
        const g = groundSnap(loc, b.sx, b.sy, b.sz, at);
        if (g && confirmSnap(loc, b.sx, b.sy, b.sz, at, g)) b = { ...b, cw: b.cw + g.dz }; // đo lại tại chỗ mới phải ra cùng mặt đường
      }
      if (frame) { const [cu, cv, cw] = apply(transpose(frame), [b.cu, b.cv, b.cw]); b = { ...b, cu, cv, cw }; } // về hệ yaw
      onCommit(applyLocalBox(st.cuboid, b));
    }
    onPreview(null);
  };

  return (
    <canvas
      ref={ref} width={Math.round(size * dpr)} height={Math.round(size * dpr)}
      style={{ display: 'block', width: size, height: size, touchAction: 'none' }}
      onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={() => { drag.current = null; panDrag.current = null; onPreview(null); }}
      onContextMenu={(e) => e.preventDefault()}
    />
  );
}

const NO_ISSUES: FrameIssue[] = [];
const NO_MARKS: GroundSector[] = [];

const cm = (m: number) => Math.round(Math.abs(m) * 100);
/** Hành động cần làm để đáy box nằm trên mặt đường ("nâng 12 cm" / "hạ 12 cm"), thay cho mũi tên dễ hiểu nhầm. */
const groundAction = (g: GroundResult) => `${g.dz > 0 ? 'nâng' : 'hạ'} ${cm(g.dz)} cm`;
const groundTip = (g: GroundResult) =>
  `Đáy box ${g.dz < 0 ? 'CAO hơn' : 'THẤP hơn'} mặt đường ${cm(g.dz)} cm (cho phép ${g.dz < 0 ? 'cao' : 'thấp'} tới ${cm(g.dz < 0 ? DEFAULT_GROUND.floatTol : DEFAULT_GROUND.sinkTol)} cm) · độ bất định ±${cm(g.sigma)} cm · `
  + `${g.nSectors} cung quanh box${g.contactW !== null ? ' + lớp tiếp xúc dưới gầm' : ''}${g.ambiguous ? ' · có hai tầng (vỉa hè?), chưa chắc chọn đúng' : ''}. `
  + 'Vạch xanh lá ở view Bên / Trước: mặt đường đo được ở từng cung; vạch xanh lơ: lớp tiếp xúc dưới gầm. Phím G để snap.';

/** [1,2,3,5,6,9] → [[1,3],[5,6],[9,9]] (các frame liền nhau gom thành một đoạn). */
function toRanges(frames: number[]): [number, number][] {
  const out: [number, number][] = [];
  for (const f of [...frames].sort((a, b) => a - b)) {
    const last = out[out.length - 1];
    if (last && f === last[1] + 1) last[1] = f; else out.push([f, f]);
  }
  return out;
}
const CHIP: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: 2, fontSize: 11, lineHeight: '16px', padding: '0 4px', borderRadius: 8, whiteSpace: 'nowrap', height: 16 };
const CHIP_BTN: React.CSSProperties = { padding: '0 3px', lineHeight: 1, height: 14, fontSize: 10 };
interface FileFlag { kind: IssueKind; state: FlagState; msg?: string; det: boolean }
const NO_FLAGS: FileFlag[] = [];

function Column({ groundOv, groundOn, egoOn, suggestOn, f, size, st, refCub, half, locHalf, selected, edited, warn, fixed, ignored, autoSnap, onSnap, onGround, motion, motionIgnored, onIgnoreMotion, onIgnore, onFit, onSuggest, onAccept, onSelect, onLoaded, onCommit, onZoom, onToggleKf, onToggleOutside, onHover, scene, overlap, overlayCubs, onIgnoreOverlap, onOpenObject, qcOn, qcNote, onQcNote, tiltOn, issues, issueIgnored, onIgnoreIssue, fileFlags, onMarkFlag, onFocusFrame, pan, onPan }: {
  onFocusFrame: (f: number) => void;
  pan: Pan; onPan: (p: Pan) => void;
  fileFlags: FileFlag[]; onMarkFlag: (f: number, kind: IssueKind, mark: FlagMark | null) => void;
  tiltOn: boolean;
  issues: FrameIssue[]; issueIgnored: (kind: string) => boolean; onIgnoreIssue: (f: number, kind: string, on: boolean) => void;
  qcOn: boolean; qcNote: string; onQcNote: (f: number, text: string) => void;
  overlap: { other: number; ratio: number }[]; overlayCubs: Cuboid[]; onIgnoreOverlap: (other: number) => void; onOpenObject: (other: number) => void;
  onToggleOutside: (f: number) => void; onHover: (f: number | null) => void; scene: Scene;
  motion: MotionWarning | null; motionIgnored: boolean; onIgnoreMotion: (f: number, on: boolean) => void;
  autoSnap: boolean; onSnap: (f: number, g: GroundResult | null) => void; onGround: (f: number) => void;
  suggestOn: boolean; // công tắc gợi ý sửa box (kích thước / vị trí) khi lệch
  groundOv: GroundResult | null; egoOn: boolean; groundOn: boolean; // egoOn: công tắc hiện mặt đường ego (Oxy); mặt đường đã tinh chỉnh theo các frame khác của object (BatchReview tính); groundOn: công tắc dò mặt đất
  ignored: boolean; onIgnore: (f: number, on: boolean) => void;
  fixed: boolean; onSuggest: (f: number, s: Suggestion | null) => void; onAccept: (f: number, s: Suggestion) => void;
  warn: boolean; onFit: (f: number, r: FitReport | null) => void;
  onToggleKf: (f: number) => void;
  f: number; size: number; st: FrameState; refCub: Cuboid | null; half: number; locHalf: number; selected: boolean; edited: boolean;
  onSelect: () => void; onLoaded: (f: number) => void; onCommit: (f: number, c: Cuboid) => void; onZoom: (factor: number) => void;
}) {
  useSymbols(); // ký hiệu lỗi đổi thì vẽ lại
  const [pc, setPc] = useState<PointCloud | null>(() => pointClouds.peek(f) ?? null); // đã có trong kho (tải ở giao diện chính) thì dùng ngay
  const [err, setErr] = useState('');
  const [preview, setPreview] = useState<LocalBox | null>(null);
  const [retryN, setRetryN] = useState(0);
  useEffect(() => {
    let live = true;
    const hit = pointClouds.peek(f);
    setErr('');
    if (hit) { setPc(hit); onLoaded(f); } else setPc(null); // không xoá rồi nạp lại: tránh nháy "đang tải…" dù dữ liệu đã có
    pointClouds.get(f, 0)
      .then((p) => { if (live) { setPc(p); onLoaded(f); } })
      .catch((e) => { if (live && !(e instanceof Cancelled)) setErr(String(e)); });
    return () => { live = false; };
  }, [f, retryN]);
  // Frame đang hiện mà bị bỏ (về từ một chunk không qua kiểm chứng đánh số) → tải lại, không hiện dữ liệu không tin được.
  const pcRef = useRef(pc);
  pcRef.current = pc;
  useEffect(() => pointClouds.subscribe(() => {
    if (pcRef.current && pointClouds.invalidated(f)) { pcRef.current = null; setPc(null); setRetryN((x) => x + 1); }
  }), [f]);
  // Lọc điểm một lần ở phạm vi lớn nhất (thu nhỏ tối đa) để phóng to/thu nhỏ không phải lọc lại.
  const loc = useMemo(() => (pc && refCub ? localize(pc, refCub, locHalf) : null), [pc, refCub, locHalf]);
  // Khung nhìn căn theo box: box nghiêng thì điểm, box gợi ý, vật khác... đều quay sang khung riêng của box để mọi view thấy box thẳng.
  const M = useMemo(() => (st.cuboid ? viewFrame(st.cuboid) : null), [st.cuboid]);
  const locView = useMemo(() => (loc && M ? rotateLocal(loc, M) : loc), [loc, M]);
  // Mặt phẳng Oxy của ego (z = 0 thế giới) trong hệ của khung nhìn, tính theo z của box ở đúng frame này.
  const egoPlane = useMemo<EgoPlane | null>(
    () => (egoOn && st.cuboid ? (M ? [M[2], M[5], M[8], -st.cuboid.z] : [0, 0, 1, -st.cuboid.z]) : null),
    [egoOn, st.cuboid, M],
  );
  const boxV = <T extends LocalBox | null>(b: T): T => {
    if (!b || !M) return b;
    const [cu, cv, cw] = apply(M, [b.cu, b.cv, b.cw]);
    return { ...b, cu, cv, cw };
  };
  // Mặt đường riêng của object ở frame này, đo độc lập với công tắc "dò mặt đất": để khi đếm điểm của vật (ít điểm / lệch / gợi ý)
  // bỏ đúng lớp mặt đường thật thay vì một lớp cố định tính từ đáy box (box chìm / lơ lửng sẽ đếm sai).
  const thrVer = useThresholdVersion();
  const fitGround = useMemo(
    () => (warn && loc && st.cuboid ? fitGroundOf(groundSnap(loc, st.cuboid.sx, st.cuboid.sy, st.cuboid.sz, { cu: 0, cv: 0, cw: 0, range: Math.hypot(st.cuboid.x, st.cuboid.y) })) : null),
    [warn, loc, st.cuboid, thrVer],
  );
  // Tắt "gợi ý kích thước box" thì bỏ luôn cảnh báo lệch (lệch chỉ có ý nghĩa đi kèm gợi ý); ít điểm vẫn báo.
  const fit = useMemo(() => {
    const r = warn && loc && st.cuboid ? fitReport(loc, st.cuboid.sx, st.cuboid.sy, st.cuboid.sz, DEFAULT_FIT, fitGround) : null;
    return r && r.level === 'misfit' && !suggestOn ? null : r;
  }, [warn, loc, st.cuboid, suggestOn, fitGround, thrVer]);
  // Gợi ý sửa box khi cảnh báo lệch; hiện nét đứt trên 3 view, chấp nhận bằng nút / phím A.
  const sug = useMemo(
    () => (suggestOn && !ignored && fit?.level === 'misfit' && loc && st.cuboid ? suggestBox(loc, st.cuboid.sx, st.cuboid.sy, st.cuboid.sz, fixed, DEFAULT_FIT, fitGround) : null),
    [suggestOn, fit, loc, st.cuboid, fixed, ignored, fitGround],
  );
  useEffect(() => { onSuggest(f, sug); }, [f, sug]);
  // Gợi ý đã bỏ qua: không vẽ nét đứt, không tô điểm lọt ngoài, không tính vào cảnh báo.
  const bad = fit && fit.level !== 'ok' && !(ignored && fit.level === 'misfit') ? fit : null;
  useEffect(() => { onFit(f, bad); }, [f, bad]);
  // Ground snap: ước lượng mặt đường dưới chân box.
  const snap = groundOn ? groundOv : null;
  useEffect(() => { onSnap(f, snap); }, [f, snap]);
  // Cảnh báo vật đi xa bất thường: dấu × cam ở vị trí dự đoán từ chuyển động các frame trước.
  const shownMotion = motion && !motionIgnored ? motion : null;
  const mark = useMemo(() => {
    if (!shownMotion || !st.cuboid) return null;
    const dx = shownMotion.pred.x - st.cuboid.x, dy = shownMotion.pred.y - st.cuboid.y;
    const cs = Math.cos(st.cuboid.yaw), sn = Math.sin(st.cuboid.yaw);
    const m = { u: dx * cs + dy * sn, v: -dx * sn + dy * cs, w: shownMotion.pred.z - st.cuboid.z };
    if (!M) return m;
    const [u, v, w] = apply(M, [m.u, m.v, m.w]);
    return { u, v, w };
  }, [shownMotion, st.cuboid, M]);
  const box = preview ?? (st.cuboid ? identityBox(st.cuboid) : null);
  const overlays = useMemo(() => (refCub ? overlayCubs.map((o) => boxV(localBoxOf(refCub, o))) : []), [refCub, overlayCubs, M]);
  const color = STATUS_COLOR[st.status];
  return (
    <div
      onClick={onSelect}
      // Bấm đúp vào cột: thu nhỏ tool và đưa camera 3D của CVAT tới object ở frame này (không áp dụng khi bấm vào nút / ô nhập)
      onDoubleClick={(e) => { if ((e.target as HTMLElement).closest('button, input, textarea, select')) return; onFocusFrame(f); }}
      // Phím K / O / G / A / I tác dụng lên cột đang trỏ chuột; viền xanh cho biết cột nào sẽ nhận phím.
      onMouseEnter={(e) => { onHover(f); e.currentTarget.style.boxShadow = '0 0 0 3px #2563eb'; }}
      onMouseLeave={(e) => { onHover(null); e.currentTarget.style.boxShadow = ''; }}
      style={{ border: `3px solid ${color}`, outline: selected ? '2px solid #111' : 'none', width: size, flex: 'none' }}
    >
      <div style={{ background: color, color: '#fff', padding: '1px 4px', fontSize: Math.max(11, Math.min(14, size / 14)), display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`frame ${f} · ${STATUS_TEXT[st.status]}`}>
        {bad || shownMotion || overlap.length ? '⚠ ' : ''}frame {f} · {STATUS_TEXT[st.status]}{edited ? ' · ✎' : ''}{qcNote ? ' · 📝' : ''}{st.cuboid && (st.cuboid.rx !== 0 || st.cuboid.ry !== 0) ? ` · ∠${(st.cuboid.rx * 57.2958).toFixed(1)}°/${(st.cuboid.ry * 57.2958).toFixed(1)}°` : ''}
        </span>
        <span style={{ flex: 'none', display: 'flex', gap: 2 }}>
          {st.cuboid && (
            <button
              title={st.status === 'key' ? 'Keyframe (khoá). Bấm để mở khoá (về nội suy) — phím K' : 'Chưa là keyframe. Bấm để khoá thành keyframe — phím K'}
              onClick={(e) => { e.stopPropagation(); onToggleKf(f); }}
              style={{ padding: '0 3px', lineHeight: 1.1 }}
            >{st.status === 'key' ? '🔒' : '🔓'}</button>
          )}
          {(st.cuboid || st.status === 'outside' || st.status === 'outside-key') && (
            <button
              title={st.cuboid ? 'Gắn keyframe outside từ frame này (phím O khi trỏ chuột vào cột)' : 'Đưa object trở lại từ frame này (phím O khi trỏ chuột vào cột)'}
              onClick={(e) => { e.stopPropagation(); onToggleOutside(f); }}
              style={{ padding: '0 3px', lineHeight: 1.1 }}
            >{st.cuboid ? '⛔' : '↩'}</button>
          )}
        </span>
      </div>
      {/* Lỗi & gợi ý ở ĐẦU cột, dạng chip một dòng, vùng cao cố định nên các cột không bao giờ lệch hàng; chi tiết ở dưới các view. */}
      <div style={{ height: 40, overflow: 'hidden', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: 2, padding: '2px 2px 0', background: '#fafafa' }}>
        {sug && (
          <span style={{ ...CHIP, background: '#c9f3ff', color: '#00505c' }} title={sug.message}>
            💡 gợi ý
            <button onClick={(e) => { e.stopPropagation(); onAccept(f, sug); }} style={CHIP_BTN} title="Chấp nhận box gợi ý">✔</button>
            <button onClick={(e) => { e.stopPropagation(); onIgnore(f, true); }} style={CHIP_BTN} title="Bỏ qua gợi ý (phím I)">✖</button>
          </span>
        )}
        {bad && !sug && <span style={{ ...CHIP, background: '#ffe0f7', color: '#5a0040' }} title={bad.message}>⚠ {bad.level === 'misfit' ? 'lệch' : 'ít điểm'}</span>}
        {bad && sug && <span style={{ ...CHIP, background: '#ffe0f7', color: '#5a0040' }} title={bad.message}>⚠ lệch</span>}
        {issues.filter((i) => !issueIgnored(i.kind)).map((i) => <span key={i.kind} style={{ ...CHIP, background: '#f9d4ee', color: '#5a0040' }} title={i.message}>⚠ {sym(i.kind)}</span>)}
        {overlap.map((o) => <span key={o.other} style={{ ...CHIP, background: '#ffd9a8', color: '#5a2d00' }} title={`Chồng với #${o.other} (IoU ${fmtIou(o.ratio)})`}>⚠ O #{o.other}</span>)}
        {fileFlags.filter((ff) => ff.state === 'open').map((ff) => <span key={ff.kind} style={{ ...CHIP, background: '#ffd6d6', color: '#600' }} title="Flag từ file QC mà tool không tự phát hiện">QC {ff.kind}</span>)}
        {shownMotion && <span style={{ ...CHIP, background: '#ffe9c7', color: '#6b3a00' }} title={shownMotion.message}>⚠ {sym('M')} đi xa</span>}
        {snap?.warn && <span style={{ ...CHIP, background: '#eaf6d8', color: '#2d5a00' }} title={groundTip(snap)}>⏬ {groundAction(snap)}</span>}
      </div>
      {VIEWS.map((v) => (
        <Cell key={v} frame={M} egoPlane={egoPlane} scene={scene} overlays={overlays} tiltOn={tiltOn} mark={mark} ground={M ? null : snap?.groundW ?? null} groundMarks={M ? NO_MARKS : snap?.marks ?? NO_MARKS} contactW={M ? null : snap?.contactW ?? null} autoSnap={autoSnap} ghost={boxV(sug?.box ?? null)} misfit={bad?.level === 'misfit'} view={v} size={size} loc={M ? locView : loc} st={st} half={half} box={box} onPreview={setPreview} onCommit={(c) => onCommit(f, c)} onZoom={onZoom} pan={pan} onPan={onPan} />
      ))}
      {!pc && (
        <div style={{ fontSize: 11, padding: 2 }}>
          {err ? <>Lỗi tải frame: {err.slice(0, 120)} <button onClick={(e) => { e.stopPropagation(); setRetryN((x) => x + 1); }} style={{ padding: '0 4px' }}>↻ thử lại</button></> : 'đang tải…'}
        </div>
      )}
      {/* cảnh báo / ghi chú đặt DƯỚI các view để các cột luôn thẳng hàng dù số cảnh báo khác nhau */}
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
      {(qcOn || qcNote) && (
        <input
          value={qcNote} maxLength={500} placeholder="note QC…" readOnly={!qcOn}
          title={qcOn ? 'Ghi chú QC cho frame này (lưu cục bộ, xuất Excel ở tab QC)' : qcNote}
          onClick={(e) => e.stopPropagation()} onChange={(e) => onQcNote(f, e.target.value)}
          style={{ width: '100%', boxSizing: 'border-box', fontSize: 11, background: '#fffbe0', border: 0, borderBottom: '1px solid #e0b000' }}
        />
      )}
      {overlap.map((o) => (
        <div key={o.other} style={{ background: '#ffd9a8', color: '#5a2d00', fontSize: 11, padding: '1px 4px' }} title="Phần giao trên hình chiếu từ trên / diện tích box nhỏ hơn. Box cam nét đứt trên ô là object kia.">
          ⚠ chồng với <button onClick={(e) => { e.stopPropagation(); onOpenObject(o.other); }} style={{ padding: '0 4px' }}>#{o.other}</button> {fmtIou(o.ratio)}{' '}
          <button onClick={(e) => { e.stopPropagation(); onIgnoreOverlap(o.other); }} style={{ padding: '0 4px' }} title="Bỏ qua cặp này ở mọi frame (ví dụ người ngồi trên xe máy)">✖ bỏ qua cặp</button>
        </div>
      ))}
      {fileFlags.map((ff) => (
        <div key={ff.kind} style={{ background: ff.state === 'open' ? '#ffd6d6' : ff.state === 'cleared' ? '#dff5df' : '#eee', color: ff.state === 'open' ? '#600' : '#333', fontSize: 11, padding: '1px 4px' }} title={`Flag từ file QC đã nạp (tab QC); khi trùng với cảnh báo tự động thì chỉ hiện cảnh báo tự động${ff.msg ? ` — tool thấy: ${ff.msg}` : ''}`}>
          QC file: <b>{ff.kind}</b> {ff.state === 'open' ? 'còn lỗi' : ff.state === 'cleared' ? 'đã hết' : ff.state === 'ignore' ? 'bỏ qua' : 'đã sửa'}{' '}
          {(ff.state === 'open' || ff.state === 'cleared') && (
            <>
              <button onClick={(e) => { e.stopPropagation(); onMarkFlag(f, ff.kind, 'ignore'); }} style={{ padding: '0 4px' }}>ignore</button>{' '}
              <button onClick={(e) => { e.stopPropagation(); onMarkFlag(f, ff.kind, 'fixed'); }} style={{ padding: '0 4px' }}>fixed</button>
            </>
          )}
          {(ff.state === 'ignore' || ff.state === 'fixed') && <button onClick={(e) => { e.stopPropagation(); onMarkFlag(f, ff.kind, null); }} style={{ padding: '0 4px' }}>↺</button>}
        </div>
      ))}
      {issues.map((i) => (issueIgnored(i.kind)
        ? (
          <div key={i.kind} style={{ background: '#eee', color: '#555', fontSize: 11, padding: '1px 4px' }}>
            đã bỏ qua {sym(i.kind)}{' '}<button onClick={(e) => { e.stopPropagation(); onIgnoreIssue(f, i.kind, false); }} style={{ padding: '0 4px' }}>hoàn lại</button>
          </div>
        ) : (
          <div key={i.kind} style={{ background: '#f9d4ee', color: '#5a0040', fontSize: 11, padding: '1px 4px' }} title={i.message}>
            ⚠ <b>{sym(i.kind)}</b> {i.message}{' '}
            <button onClick={(e) => { e.stopPropagation(); onIgnoreIssue(f, i.kind, true); }} style={{ padding: '0 4px' }}>✖ bỏ qua</button>
          </div>
        )))}
      {shownMotion && (
        <div style={{ background: '#ffe9c7', color: '#6b3a00', fontSize: 11, padding: '1px 4px' }} title={shownMotion.message}>
          ⚠ <b>{sym('M')}</b> {shownMotion.message}{' '}
          <button onClick={(e) => { e.stopPropagation(); onIgnoreMotion(f, true); }} style={{ padding: '0 4px' }} title="Bỏ qua lỗi Y ở frame này của MỌI object có lỗi Y ở frame đó">✖ bỏ qua</button>
        </div>
      )}
      {motion && motionIgnored && (
        <div style={{ background: '#eee', color: '#555', fontSize: 11, padding: '1px 4px' }}>
          đã bỏ qua cảnh báo đi xa{' '}
          <button onClick={(e) => { e.stopPropagation(); onIgnoreMotion(f, false); }} style={{ padding: '0 4px' }}>hoàn lại</button>
        </div>
      )}
      {snap?.warn && (
        <div style={{ background: '#eaf6d8', color: '#2d5a00', fontSize: 11, padding: '1px 4px' }} title={groundTip(snap)}>
          ⏬ {groundAction(snap)}: đáy {snap.dz < 0 ? 'cao hơn' : 'thấp hơn'} mặt đường {cm(snap.dz)} cm (±{cm(snap.sigma)}){snap.slopeDeg >= 1 ? ` · dốc ${snap.slopeDeg.toFixed(1)}°${snap.steep ? ' — dốc lớn, đáy chỉ chạm một phía' : ''}` : ''}{' '}
          <button onClick={(e) => { e.stopPropagation(); onGround(f); }} style={{ padding: '0 4px' }} title="Dời box theo z để đáy chạm mặt đường (phím G)">snap</button>
        </div>
      )}
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

const GROUPS_KEY = 'cvla-br-collapsed';
const loadCollapsed = (): Record<string, boolean> => { try { return JSON.parse(kv.get(GROUPS_KEY) ?? '{}') as Record<string, boolean>; } catch { return {}; } };

/** Nhóm điều khiển của Batch Review: bấm tiêu đề để thu nhỏ / mở rộng, nhớ trạng thái. */
function Group({ id, title, bg, children }: { id: string; title: ReactNode; bg?: string; children: ReactNode }) {
  const [shut, setShut] = useState(() => !!loadCollapsed()[id]);
  const toggle = () => setShut((v) => { const next = !v; kv.set(GROUPS_KEY, JSON.stringify({ ...loadCollapsed(), [id]: next })); return next; });
  return (
    <fieldset className="cvla-group" style={{ border: '1px solid #c5ccd6', margin: 0, minWidth: 0, padding: '1px 8px 4px', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', alignContent: 'flex-start', background: bg }}>
      <legend style={{ fontSize: 11, fontWeight: 700, color: '#456', padding: '0 4px' }}>
        <span role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(); }} style={{ cursor: 'pointer', userSelect: 'none' }} title={shut ? 'Mở rộng' : 'Thu nhỏ'}>{shut ? '▸' : '▾'} </span>
        {title}
      </legend>
      {!shut && children}
    </fieldset>
  );
}

export function BatchReview({ drift, onSplit, onFocusFrame, job, ann, rows, selectedNum, setSelectedNum, initialFrame, edited, onEdit, onTrack, focus, onView, onSel, onHoverFrame, labels, overlaps }: {
  overlaps: OverlapItem[]; // chồng lấn của cả job (đã bỏ cặp được bỏ qua)
  onSplit: (trackIndex: number, resume: number) => number | null; // tách ID tại frame resume; trả số thứ tự object mới, null nếu không tách được
  onHoverFrame: (f: number | null) => void;
  onFocusFrame: (f: number) => void; // bấm đúp vào cột frame
  drift: Map<number, { f: number; dist: number }[]>; // trôi box theo số thứ tự object
  labels: CvatLabel[];
  onSel: (frame: number | null) => void;
  onView: (frames: number[]) => void;
  focus: { frame: number; nonce: number } | null;
  onTrack: (trackIndex: number, track: CvatTrack, frames: number[]) => void;
  job: CvatJob; ann: CvatAnnotations; rows: ObjectRow[]; selectedNum: number | null; setSelectedNum: (n: number) => void;
  initialFrame: number; edited: Set<string>; onEdit: (trackIndex: number, frame: number, c: Cuboid, sizeAll?: boolean) => void;
}) {
  const { start_frame: start, stop_frame: stop } = job;
  const [prefs, setPrefs] = useState(loadPrefs);
  const thrVer = useThresholdVersion(); // ngưỡng cảnh báo chỉnh tay (tab Threshold) đổi thì tính lại cảnh báo
  const max = ann.tracks.length;
  const num = selectedNum ?? 1;
  const track = ann.tracks[num - 1] ?? null;
  // Danh sách frame cần xem: cả job hoặc khoảng [từ, đến] tự chọn; tùy chọn chỉ giữ keyframe của object đang chọn.
  const [viewFrom, setViewFrom] = useState('');
  const viewTo = ''; // khoảng xem luôn chạy tới hết job; cửa sổ [a, b] chọn bằng hai ô a → b (a bắt đầu cửa sổ, b - a + 1 = số frame)
  const forceFirst = useRef(false); // vừa nhập điểm xuất phát a: về trang đầu
  const list = useMemo(() => {
    const a = Math.max(start, Math.min(stop, Number.isInteger(Number(viewFrom)) && viewFrom !== '' ? Number(viewFrom) : start));
    const b = Math.max(a, Math.min(stop, Number.isInteger(Number(viewTo)) && viewTo !== '' ? Number(viewTo) : stop));
    let l: number[] = [];
    for (let f = a; f <= b; f++) l.push(f);
    if (prefs.keyOnly && track) { const ks = new Set(track.shapes.map((x) => x.frame)); l = l.filter((f) => ks.has(f)); }
    return l.length ? l : [a];
  }, [start, stop, viewFrom, viewTo, prefs.keyOnly, track]);
  const overlap = prefs.keyOnly ? 0 : 1;
  const nWin = pageCount(list.length, prefs.perWin, overlap);
  const [kRaw, setK] = useState(() => Math.min(nWin - 1, pageOf(list, initialFrame, prefs.perWin, overlap)));
  const k = Math.min(kRaw, nWin - 1);
  const [selFrame, setSelFrame] = useState<number | null>(null);
  const hoverRef = useRef<number | null>(null); // cột frame đang trỏ chuột (không cần render lại)
  const [loaded, setLoaded] = useState<Set<number>>(new Set());
  const qcOn = useQcMode();
  const qcNotes = useQcNotes();
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
  useSymbols();
  const row = rows.find((r) => r.num === num);
  // Dynamic size theo từng object (nhớ cục bộ). Mặc định: bật cho nhãn co giãn, tắt cho Vehicle / Obstacle.
  const dynClasses = useDynClasses(job.id);
  const dynRules = useDynRules(job.id);
  const dynKey = `cvla-dyn:${job.id}:${num}`;
  const [, bumpDyn] = useState(0);
  const specs = useMemo(() => parseLabelSpecs(labels), [labels]);
  // Thứ tự ưu tiên: công tắc RIÊNG của object này > luật theo giá trị attribute > công tắc của class. Chỉ ảnh hưởng object đang chọn.
  const own = (() => { try { const v = kv.get(dynKey); if (v === '1') return true; if (v === '0') return false; } catch { /* bỏ qua */ } return null; })();
  const auto = track ? resolveDyn(track, specs.get(track.label_id), dynClasses[row?.label ?? ''] ?? defaultDyn(row?.label ?? ''), dynRules) : { dyn: true, by: 'class' as const };
  const dyn = own ?? auto.dyn;
  const setDyn = (v: boolean) => { try { kv.set(dynKey, v ? '1' : '0'); } catch { /* bỏ qua */ } bumpDyn((x) => x + 1); thresholdStore.changed(); if (!v) unifySize(true); };
  const clearOwnDyn = () => { try { kv.remove(dynKey); } catch { /* bỏ qua */ } bumpDyn((x) => x + 1); thresholdStore.changed(); };
  const dynWhy = own !== null ? 'công tắc riêng của object này' : auto.by === 'attr' ? `theo attribute ${auto.attr} = ${auto.value}` : 'theo class';
  /** Ghi cuboid mới vào frame f. Dynamic size tắt mà kích thước đổi → áp kích thước mới cho mọi keyframe. */
  const commit = (f: number, cub: Cuboid) => {
    const cur = track ? stateAt(track, f).cuboid : null;
    onEdit(num - 1, f, cub, !dyn && !!cur && !sameSize(cur, cub));
  };
  const frames = pageFrames(list, k, prefs.perWin, overlap);
  const framesKey = frames.join(',');
  // Đổi cách chia trang / khoảng xem / object: giữ nguyên frame đang xem thay vì nhảy.
  const anchorRef = useRef(frames[0] ?? start);
  anchorRef.current = frames[0] ?? start;
  const listKey = `${list.length}:${list[0]}:${list[list.length - 1]}`;
  useEffect(() => {
    if (forceFirst.current) { forceFirst.current = false; setK(0); return; }
    setK(pageOf(list, anchorRef.current, prefs.perWin, overlap));
  }, [prefs.perWin, prefs.keyOnly, listKey, num]);
  // Hai ô a → b luôn hiện cửa sổ đang xem; nhập a = điểm xuất phát (b tự thành a + số frame - 1), sửa b = đổi số frame hiển thị.
  const [winA, setWinA] = useState('');
  const [winB, setWinB] = useState('');
  useEffect(() => { setWinA(String(frames[0] ?? '')); setWinB(String(frames[frames.length - 1] ?? '')); }, [framesKey]);
  const commitA = () => {
    const a = Number(winA);
    if (winA.trim() === '' || !Number.isInteger(a) || a < start || a > stop) { setWinA(String(frames[0] ?? '')); return; }
    if (a === frames[0]) return;
    forceFirst.current = true;
    setViewFrom(a === start ? '' : String(a));
    if (a === start && viewFrom === '') { forceFirst.current = false; setK(0); }
  };
  const commitB = () => {
    const b = Number(winB), a = frames[0] ?? start;
    if (winB.trim() === '' || !Number.isInteger(b) || b < a + 1 || b > stop) { setWinB(String(frames[frames.length - 1] ?? '')); return; }
    const n = prefs.keyOnly ? list.filter((f) => f >= a && f <= b).length : b - a + 1;
    if (n >= 2) updatePrefs({ ...prefs, perWin: Math.min(30, n) });
  };
  useEffect(() => { onView(frames); }, [framesKey]);
  // Chồng lấn của object đang chọn ở các frame đang xem, và box của object kia để vẽ lên ô.
  const ovAt = useMemo(() => {
    const m = new Map<number, { other: number; ratio: number }[]>();
    for (const o of overlaps) if (o.a === num || o.b === num) m.set(o.frame, [...(m.get(o.frame) ?? []), { other: o.a === num ? o.b : o.a, ratio: o.ratio }]);
    return m;
  }, [overlaps, num]);
  const ovCubs = useMemo(() => {
    const m = new Map<number, Cuboid[]>();
    for (const f of frames) for (const o of ovAt.get(f) ?? []) {
      const c = ann.tracks[o.other - 1] ? stateAt(ann.tracks[o.other - 1]!, f).cuboid : null;
      if (c) m.set(f, [...(m.get(f) ?? []), c]);
    }
    return m;
  }, [ovAt, framesKey, ann]);
  useEffect(() => { onSel(selFrame); }, [selFrame]);

  const updatePrefs = (p: Prefs) => { setPrefs(p); savePrefs(p); };
  const zoomBy = (factor: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));
  useEffect(() => { setZoom(1); }, [num]);

  // Cỡ ô: tự khớp độ phân giải màn hình (đủ rộng cho 6 cột và đủ cao cho 3 hàng), hoặc chỉnh tay.
  const cols6 = Math.min(8, Math.max(2, prefs.perWin));
  const fitW = Math.floor((vp.w - 24 - (cols6 - 1) * prefs.gap) / cols6 - 6);
  const fitH = Math.floor((vp.h - 190) / 3);
  const size = prefs.auto ? Math.min(CELL_MAX, Math.max(CELL_MIN, Math.min(fitW, fitH))) : prefs.size;

  const baseHalf = useMemo(() => {
    if (!track) return 5;
    let m = 1;
    for (const s of track.shapes) if (!s.outside) m = Math.max(m, s.points[6] ?? 0, s.points[7] ?? 0, s.points[8] ?? 0);
    return Math.min(15, Math.max(3, m * 0.8 + 1));
  }, [track]);
  const half = baseHalf / zoom;
  const scene = useMemo<Scene>(() => {
    // Lát cắt view Bên / Trước bám theo kích thước box (+ biên tùy chỉnh), để không lẫn tường / vật ở xa hai bên.
    let sx = 1, sy = 1;
    if (track) for (const s of track.shapes) if (!s.outside) { sx = Math.max(sx, s.points[6] ?? 0); sy = Math.max(sy, s.points[7] ?? 0); }
    const cap = baseHalf * 0.5;
    return {
      zClip: baseHalf, colorHalf: baseHalf,
      slab: Math.min(cap, sy / 2 + prefs.slabMargin), slabFront: Math.min(cap, sx / 2 + prefs.slabMargin),
    };
  }, [baseHalf, track, prefs.slabMargin]);
  const locHalf = baseHalf / ZOOM_MIN;
  // Dời khung nhìn (giữ chuột phải kéo trên ô): dùng chung mọi frame; không dời ra ngoài vùng điểm đã lọc; đổi object thì về giữa.
  const [pan, setPan] = useState<Pan>(NO_PAN);
  const panLim = Math.max(0, locHalf - half);
  const panEff = useMemo(() => clampPan(pan, panLim), [pan, panLim]);
  const panned = panEff.u !== 0 || panEff.v !== 0 || panEff.w !== 0;
  const setPanClamped = useCallback((p: Pan) => setPan(clampPan(p, panLim)), [panLim]);
  useEffect(() => setPan(NO_PAN), [num]);

  // Luật QC (S K Z H D) tính trên cả job để so mốc kích thước và frame liền trước đúng.
  const rawIssueMap = useMemo(() => {
    const m = track ? trackIssues(track, row?.label ?? '', Array.from({ length: stop - start + 1 }, (_, i) => start + i), undefined, num) : new Map<number, FrameIssue[]>();
    // Trôi box (đứng yên mà box nhích): tính chéo giữa các frame ở App, gộp vào cùng danh sách cảnh báo của frame.
    for (const d of drift.get(num) ?? []) {
      m.set(d.f, [...(m.get(d.f) ?? []), { kind: 'T', message: `trôi box: toạ độ theo ego không đổi trong khi xe đã đi ${d.dist.toFixed(1)} m (box đi theo xe thay vì ở lại chỗ vật đứng yên); bỏ qua nếu vật thật sự chạy cùng vận tốc với xe` }]);
    }
    return m;
  }, [track, row?.label, start, stop, drift, num, thrVer]);
  // Flag từ file QC đã nạp cho object này, theo frame; "đã hết" = tool không còn thấy lỗi (ở dữ liệu hiện tại, kể cả nháp).
  const qcImports = useQcImports();
  const flagMarks = useFlagMarks();
  const fileFlags = useMemo(() => {
    const m = new Map<number, FileFlag[]>();
    for (const fl of qcImports[String(job.id)]?.flags ?? []) {
      if (fl.num !== num) continue;
      const det = fl.kind === 'O'
        ? overlaps.some((o) => o.frame === fl.frame && (o.a === num || o.b === num))
        : (rawIssueMap.get(fl.frame) ?? []).some((i) => i.kind === fl.kind);
      const msg = fl.kind === 'O'
        ? overlaps.filter((o) => o.frame === fl.frame && (o.a === num || o.b === num)).map((o) => `chồng với #${o.a === num ? o.b : o.a} (IoU ${fmtIou(o.ratio)})`).join('; ')
        : (rawIssueMap.get(fl.frame) ?? []).find((i) => i.kind === fl.kind)?.message;
      m.set(fl.frame, [...(m.get(fl.frame) ?? []), { kind: fl.kind, state: flagState(flagMarks[flagKey(job.id, fl)], det), msg, det }]);
    }
    return m;
  }, [qcImports, flagMarks, rawIssueMap, overlaps, job.id, num]);
  // Lỗi trùng với flag của file QC (cùng object, frame, loại) thì chỉ lấy MỘT: ưu tiên QC TỰ ĐỘNG (dự đoán); flag file trùng bị ẩn, cảnh báo tự động ghi chú "file QC cũng báo".
  const fileCover = useMemo(() => new Set([...fileFlags].flatMap(([f, list]) => list.filter((x) => x.det).map((x) => `${f}:${x.kind}`))), [fileFlags]);
  const issueMap = useMemo(() => {
    if (!fileCover.size) return rawIssueMap;
    const m = new Map<number, FrameIssue[]>();
    for (const [f, list] of rawIssueMap) m.set(f, list.map((i) => (fileCover.has(`${f}:${i.kind}`) ? { ...i, message: `${i.message} · file QC cũng báo` } : i)));
    return m;
  }, [rawIssueMap, fileCover]);
  const openIssues = (f: number) => (issueMap.get(f) ?? NO_ISSUES).filter((i) => !ign.has(issueKey(job.id, num, f, i.kind)));
  // Bỏ qua (ignore) / đã sửa (fixed) một lỗi ở một frame: nếu object còn frame khác cùng lỗi thì hỏi có áp luôn cho các frame đó không.
  const [bulk, setBulk] = useState<{ kind: string; verb: string; f: number; others: number[]; run: (frames: number[]) => void } | null>(null);
  const ignoreIssueAsk = (f: number, kind: string, on: boolean) => {
    const run = (frames: number[]) => ignoreStore.set(frames.map((g) => issueKey(job.id, num, g, kind)), on);
    if (!on) { run([f]); return; }
    const others = [...issueMap].filter(([g, l]) => g !== f && l.some((i) => i.kind === kind) && !ign.has(issueKey(job.id, num, g, kind))).map(([g]) => g).sort((a, b) => a - b);
    if (others.length) setBulk({ kind, verb: 'bỏ qua (ignore)', f, others, run }); else run([f]);
  };
  // Lỗi đi xa bất thường (Y) thường xảy ra cùng lúc ở mọi object của một frame (xe nhảy vị trí, frame bị thiếu): bỏ qua ở một frame
  // của một object thì bỏ qua luôn lỗi Y của MỌI object có lỗi Y ở frame đó. Hoàn lại chỉ áp cho object đang xem.
  const ignoreMotion = (f: number, on: boolean) => {
    if (!on) { ignoreStore.set([motionKey(job.id, num, f)], false); return; }
    const keys: string[] = [];
    ann.tracks.forEach((t, i) => {
      const k = motionKey(job.id, i + 1, f);
      if (!ign.has(k) && motionJump(t, f, specs.get(t.label_id)?.name ?? '')) keys.push(k);
    });
    const mine = motionKey(job.id, num, f);
    if (!keys.includes(mine)) keys.push(mine);
    ignoreStore.set(keys, true);
    setNote(keys.length > 1 ? `Đã bỏ qua lỗi Y ở frame ${f} của ${keys.length} object.` : `Đã bỏ qua lỗi Y ở frame ${f}.`);
  };
  const markFlagAsk = (f: number, kind: IssueKind, mk: FlagMark | null) => {
    const run = (frames: number[]) => qcFlagStore.mark(job.id, frames.map((g) => ({ num, frame: g, kind })), mk);
    if (!mk) { run([f]); return; }
    const others = [...fileFlags].filter(([g, l]) => g !== f && l.some((x) => x.kind === kind && x.state === 'open')).map(([g]) => g).sort((a, b) => a - b);
    if (others.length) setBulk({ kind, verb: mk === 'fixed' ? 'đánh dấu đã sửa (fixed)' : 'bỏ qua (ignore)', f, others, run }); else run([f]);
  };
  // Tóm tắt lỗi của CẢ TRACK (không chỉ cửa sổ đang xem): luật QC theo loại, và đi xa bất thường; bỏ các frame đã bỏ qua.
  const trackSummary = useMemo(() => {
    const byKind = new Map<string, number[]>();
    for (const [f, list] of issueMap) {
      for (const i of list) if (!ign.has(issueKey(job.id, num, f, i.kind))) byKind.set(i.kind, [...(byKind.get(i.kind) ?? []), f]);
    }
    const far: number[] = [];
    if (track) for (let f = start; f <= stop; f++) if (!ign.has(motionKey(job.id, num, f)) && motionJump(track, f, row?.label ?? '')) far.push(f);
    return { byKind: [...byKind].sort(([a], [b]) => a.localeCompare(b)), far };
  }, [issueMap, ign, job.id, num, track, row?.label, start, stop, thrVer]);
  const goFrame = (f: number) => { setK(Math.min(nWin - 1, pageOf(list, f, prefs.perWin, overlap))); setSelFrame(f); };
  const cols = useMemo(
    () => frames.map((f) => ({
      f,
      st: track ? stateAt(track, f) : { status: 'none' as const, cuboid: null },
      ref: track ? referenceCuboid(track, f, stop) : null,
      mot: track ? motionJump(track, f, row?.label ?? '') : null,
    })),
    [track, framesKey, stop, row?.label, thrVer],
  );

  // Kế hoạch tải: cửa sổ đang xem trước, rồi các frame phía sau (gần trước), rồi phía trước; tối đa 60 frame.
  // Chạy nền trong lúc người dùng chỉnh sửa; đổi cửa sổ thì kế hoạch được sắp lại quanh vị trí mới.
  useEffect(() => {
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
  // Sao lưu box trước khi đặt outside (nhất là frame đầu track) để khi đưa object trở lại thì có đúng vị trí cũ.
  const bakKey = `cvla-bak:${job.id}:${num}`;
  const readBak = (): Record<string, Cuboid> => { try { return JSON.parse(kv.get(bakKey) ?? '{}') as Record<string, Cuboid>; } catch { return {}; } };
  const saveBak = (fr: number[]) => {
    if (!track) return;
    const m = readBak();
    for (const f of fr) { const c = stateAt(track, f).cuboid; if (c) m[String(f)] = c; }
    try { kv.set(bakKey, JSON.stringify(m)); } catch { /* bỏ qua */ }
  };
  const toggleOutside = (f: number) => {
    if (!track) return;
    const st = stateAt(track, f);
    const isOut = st.status === 'outside' || st.status === 'outside-key';
    if (!isOut) saveBak([f]);
    const bak = isOut ? readBak()[String(f)] : undefined;
    const res = isOut ? (bak ? { track: upsertKf(track, f, bak, false), frames: [f] } : restoreFrom(track, f, stop)) : setOutsideFrom(track, f);
    apply(res, isOut ? `Frame ${f}: đã đưa object trở lại (có box).` : `Frame ${f}: đã gắn keyframe outside (tới keyframe kế tiếp).`,
      'Không đổi được: cần frame có box hoặc frame outside có box tham chiếu.');
  };
  // Chế độ 3: chọn khoảng bằng chuột. Bật rồi bấm tiêu đề cột đầu và cột cuối (có thể ở hai cửa sổ khác nhau: đổi cửa sổ rồi bấm tiếp); Esc để hủy.
  const [pick, setPick] = useState<{ first: number | null } | null>(null);
  const onPickSelect = (f: number) => {
    if (!pick) { setSelFrame(f); return; }
    setSelFrame(f);
    if (pick.first === null) { setPick({ first: f }); setNote(`Đã chọn đầu khoảng: frame ${f}. Bấm tiêu đề cột cuối khoảng (Esc để hủy).`); return; }
    const a = Math.min(pick.first, f), b = Math.max(pick.first, f);
    setPick(null);
    setRangeFrom(String(a)); setRangeTo(String(b));
    if (track) {
      saveBak(Array.from({ length: b - a + 1 }, (_, i) => a + i));
      apply(setOutsideRange(track, a, b, stop), `Đã đặt outside ${'{n}'} frame trong ${a}–${b}. Hoàn tác được.`, 'Không có frame nào trong khoảng này đổi được.');
    }
  };
  useEffect(() => {
    if (!pick) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setPick(null); setNote('Đã hủy chọn khoảng.'); } };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [pick]);
  /** ② Current window: outside cho mọi frame có box trong cửa sổ đang hiển thị. */
  const outsideRange = () => {
    const r: [number, number] | null = frames.length ? [frames[0]!, frames[frames.length - 1]!] : null;
    if (r && track) saveBak(Array.from({ length: Math.abs(r[1] - r[0]) + 1 }, (_, i) => Math.min(r[0], r[1]) + i));
    if (r && track) apply(setOutsideRange(track, r[0], r[1], stop), `Đã đặt outside ${'{n}'} frame trong ${r[0]}–${r[1]}. Hoàn tác được.`, 'Không có frame nào trong khoảng này đổi được.');
  };
  /** Áp kích thước của frame đang chọn (hoặc frame có box đầu tiên trong cửa sổ) cho mọi keyframe; auto = vừa tắt Dynamic size. */
  const unifySize = (auto = false) => {
    const src = selFrame ?? (track ? frames.find((f) => stateAt(track, f).cuboid) ?? null : null);
    const cur = track && src !== null ? stateAt(track, src).cuboid : null;
    if (!track || !cur) { setNote('Chọn frame có box (bấm tiêu đề cột) để lấy kích thước.'); return; }
    const r = propagateSize(track, cur);
    apply(r.frames.length ? { track: r.track, frames: r.frames } : null, `Đã áp kích thước frame ${src} cho ${'{n}'} keyframe. Hoàn tác được.`, 'Mọi keyframe đã cùng kích thước.');
  };
  const unlockInner = () => {
    const r = range();
    if (r && track) apply(removeInnerKeyframes(track, r[0], r[1]), `Đã mở khoá ${'{n}'} keyframe ở giữa ${r[0]}–${r[1]} (giữ hai đầu mút). Hoàn tác được.`, 'Không có keyframe nào ở giữa khoảng này để gỡ.');
  };
  const selSt = track && selFrame !== null ? stateAt(track, selFrame) : null;
  useEffect(() => { setNote(''); }, [num, k]);
  /** Chấp nhận gợi ý: áp box đề xuất thành keyframe (vào nháp, hoàn tác được). */
  const accept = (f: number, s: Suggestion) => {
    const st = track ? stateAt(track, f) : null;
    if (!st?.cuboid) return;
    commit(f, applyLocalBox(st.cuboid, s.box));
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
  // Lý do không snap được (hiện ở thông báo): cảnh báo lơ lửng dùng phép đo mặt đường, còn snap đòi chắc chắn hơn nên hai bên có thể lệch nhau.
  const snapWhy = useRef('');
  const groundFrame = (f: number): boolean => {
    snapWhy.current = '';
    if (!prefs.ground) { snapWhy.current = 'dò mặt đất (sg gr) đang tắt'; return false; }
    const st = track ? stateAt(track, f) : null;
    const g = snaps.get(f);
    if (!st?.cuboid) { snapWhy.current = 'frame này không có box'; return false; }
    if (!g) { snapWhy.current = 'chưa đo được mặt đường ở frame này (point cloud chưa tải xong hoặc ngoài bán kính đo)'; return false; }
    if (!g.confident) { snapWhy.current = 'mặt đường đo được chưa đủ chắc chắn (cần ≥ 2 cung cùng tầng hoặc lớp tiếp xúc xác nhận, không mơ hồ)'; return false; } // chỉ dời khi đủ căn cứ
    // Đo lại tại vị trí sau khi dời: phép đo phụ thuộc đáy box, hai lần phải ra cùng mặt đường, không thì không dời.
    const pc = pointClouds.peek(f);
    if (!pc) { snapWhy.current = 'point cloud của frame này chưa có trong bộ nhớ'; return false; }
    const c0 = st.cuboid;
    if (!confirmSnap(localize(pc, c0, 16), c0.sx, c0.sy, c0.sz, { cu: 0, cv: 0, cw: 0, range: Math.hypot(c0.x, c0.y) }, g)) { snapWhy.current = 'đo lại tại chỗ cho ra mặt đường khác (hai lần đo không khớp)'; return false; }
    // Mặt dốc: nghiêng box song song mặt đường (roll / pitch) nếu bật và dốc đủ rõ; không thì chỉ dời z.
    if (prefs.tilt && g.method === 'plane' && g.plane && g.dzTilt !== undefined && (g.slopeDeg ?? 0) >= 1) {
      const t = tiltFromPlane(g.plane.a, g.plane.b, st.cuboid.yaw);
      const same = Math.abs(t.rx - st.cuboid.rx) < 0.002 && Math.abs(t.ry - st.cuboid.ry) < 0.002 && Math.abs(g.dzTilt) < 0.005;
      if (same) { snapWhy.current = 'box đã song song mặt đường'; return false; }
      commit(f, { ...st.cuboid, rx: t.rx, ry: t.ry, z: st.cuboid.z + g.dzTilt });
      return true;
    }
    if (Math.abs(g.dz) < 0.005) { snapWhy.current = 'đáy box đã chạm mặt đường (lệch < 5 mm)'; return false; }
    commit(f, { ...st.cuboid, z: st.cuboid.z + g.dz });
    return true;
  };
  const groundSelectedOrAll = () => {
    if (!prefs.ground) { setNote('Dò mặt đất đang tắt (bật ở nhóm Gợi ý & mặt đất).'); return; }
    const tgt = hoverRef.current ?? selFrame; // trỏ chuột > frame đã chọn > cả cửa sổ
    const list = tgt !== null ? [tgt] : frames;
    const done = list.filter((f) => groundFrame(f));
    setNote(done.length
      ? `Ground snap: đã hạ/nâng đáy box chạm mặt đường ở frame ${done.join(', ')}. Hoàn tác được.`
      : `Không có gì để snap${hoverRef.current !== null || selFrame !== null ? ` ở frame ${hoverRef.current ?? selFrame}` : ''} (đã nằm trên mặt đường, thiếu điểm mặt đường, mặt đường mơ hồ như có vỉa hè, hoặc lệch quá 1 m)${list.length === 1 && snapWhy.current ? `. Lý do: ${snapWhy.current}` : ''}.`);
  };
  // Outside dài (≥ SPLIT_OUTSIDE_FRAMES frame) rồi có box lại: gợi ý tách ID, có hộp xác nhận (xem trước) trước khi áp.
  const outGaps = useMemo(() => (track ? findLongOutsideGaps(track, start, stop) : []), [track, start, stop]);
  const splitAt = (g: OutsideGap) => {
    if (!track) return;
    const msg = `Tách ID object #${num}?\n\n`
      + `• Outside ${g.len} frame (${g.from}–${g.to}), có box lại từ frame ${g.resume}.\n`
      + `• Phần từ frame ${g.resume} trở đi thành object MỚI (cuối danh sách, chưa có trên CVAT tới khi upload).\n`
      + `• Object #${num} giữ ID, giữ phần trước, và outside có keyframe từ frame ${g.resume} tới frame ${stop}.\n\n`
      + 'Không xóa ID nào. Chỉ nằm trong nháp tới khi bạn upload.';
    if (!window.confirm(msg)) return;
    const n = onSplit(num - 1, g.resume);
    setNote(n === null ? 'Không tách được: frame này không phải keyframe có box ngay sau đoạn outside.' : `Đã tách: object mới #${n} (từ frame ${g.resume}); #${num} outside từ frame ${g.resume}. Nằm trong nháp, chưa upload.`);
  };
  const misfitFrames = prefs.suggest ? frames.filter((f) => fits.get(f)?.level === 'misfit') : [];
  const sparseFrames = frames.filter((f) => fits.get(f)?.level === 'sparse');

  // Đếm sự kiện của kho point cloud (không đếm số frame trong bộ nhớ: job dài thì số đó đứng ở mức tối đa, frame mới tải không làm
  // tính lại) và số frame đã từng tải của job (để hiển thị).
  const [cloudTick, setCloudTick] = useState(0);
  useEffect(() => pointClouds.subscribe(() => setCloudTick((x) => x + 1)), []);
  const loadedFrames = useMemo(() => { let n = 0; for (let f = start; f <= stop; f++) if (pointClouds.everLoaded(f)) n++; return n; }, [cloudTick, start, stop]);
  // Mặt đường của object theo CẢ track: đo ĐỘC LẬP ở từng frame (đã tải point cloud), không dự đoán từ frame khác; σ quyết định có báo hay không.
  const [series, setSeries] = useState<Map<number, GroundResult | null>>(new Map());
  // Độ khớp box ↔ cụm điểm (lệch / ít điểm) của CẢ track, tính chung vòng lặp với mặt đường; checked = số frame đã có point cloud để kiểm.
  const [fitSeries, setFitSeries] = useState<{ fits: Map<number, FitReport>; checked: number }>({ fits: new Map(), checked: 0 });
  useEffect(() => {
    if (!(prefs.ground || warn) || !track) { setSeries(new Map()); setFitSeries({ fits: new Map(), checked: 0 }); return; }
    let live = true;
    const timer = window.setTimeout(async () => {
      const grounds = new Map<number, GroundResult | null>();
      const fits = new Map<number, FitReport>();
      let checked = 0;
      for (let f = start; f <= stop && live; f++) {
        const c = stateAt(track, f).cuboid;
        const pc = c ? pointClouds.peek(f) : undefined;
        if (!c || !pc) continue; // chưa tải point cloud thì chưa đo frame đó
        const loc = localize(pc, c, 16);
        checked++;
        const g = groundSnap(loc, c.sx, c.sy, c.sz, { cu: 0, cv: 0, cw: 0, range: Math.hypot(c.x, c.y) });
        if (prefs.ground) grounds.set(f, g);
        if (warn) fits.set(f, fitReport(loc, c.sx, c.sy, c.sz, DEFAULT_FIT, fitGroundOf(g)));
        if (checked % 3 === 0) await new Promise((r) => window.setTimeout(r, 0));
      }
      if (live) { setSeries(prefs.ground ? grounds : new Map()); setFitSeries({ fits, checked }); }
    }, 300);
    return () => { live = false; window.clearTimeout(timer); };
  }, [track, prefs.ground, warn, cloudTick, start, stop, thrVer]);
  // Tất cả lỗi đang có của object (cả track): lệch / ít điểm, đáy lơ lửng / chìm, chồng lấn; bỏ các frame đã bỏ qua.
  const allWarn = useMemo(() => {
    const misfit: number[] = [], sparse: number[] = [], ground: number[] = [], overl: number[] = [];
    for (const [f, r] of fitSeries.fits) {
      if (r.level === 'misfit') { if (prefs.suggest && !ign.has(ignoreKey(job.id, num, f))) misfit.push(f); }
      else if (r.level === 'sparse') sparse.push(f);
    }
    if (prefs.ground) for (const [f, g] of series) if (g?.warn) ground.push(f);
    for (const f of ovAt.keys()) overl.push(f);
    const asc = (a: number, b: number) => a - b;
    return { misfit: misfit.sort(asc), sparse: sparse.sort(asc), ground: ground.sort(asc), overl: overl.sort(asc) };
  }, [fitSeries, series, ovAt, ign, job.id, num, prefs.ground, prefs.suggest]);
  // Còn frame có box chưa có point cloud (đang tải ngầm): lệch / ít điểm / đáy của track chưa đủ dữ liệu → viền vàng.
  const cloudPartial = fitSeries.checked < (row?.assigned ?? 0);

  // Nhảy tới frame hiện tại của CVAT khi đồng bộ.
  useEffect(() => {
    if (!focus) return;
    setK(Math.min(nWin - 1, pageOf(list, focus.frame, prefs.perWin, overlap)));
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
        case 'zoom.reset': setZoom(1); setPan(NO_PAN); break;
        case 'kf.unlockInner': unlockInner(); break;
        case 'kf.toggle': {
          const tgt = hoverRef.current ?? selFrame;
          if (tgt === null) setNote('Rê chuột lên một cột frame (hoặc chọn cột) rồi nhấn phím.');
          else toggleKf(tgt);
          break;
        }
      }
    }),
    [num, max, nWin, selFrame, track, k, cols, sugs, ign, snaps, rangeFrom, rangeTo],
  );

  if (!track) return <p>Job chưa có object.</p>;
  const selCol = cols.find((c) => c.f === selFrame) ?? null;
  const az = selCol?.ref ? azimuthDeg(selCol.ref) : null;

  return (
    <>
      {/* 3 hàng cố định (chủ dự án 2026-10-30): Keyframe & kích thước + Outside · Gợi ý & mặt đất + QC · Object & cửa sổ + Hiển thị.
          Hai cột thẳng hàng ở mọi hàng; nội dung dài xuống dòng TRONG nhóm, không đẩy nhóm sang hàng khác. */}
      <div style={{ marginBottom: 6, display: 'grid', gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 6, alignItems: 'stretch' }}>
        <Group id="3" title={<>Keyframe & kích thước <Help text="🔒 / 🔓 trên tiêu đề cột hoặc phím K: khoá / mở khoá frame đang chọn. Alt+K: mở khoá keyframe ở giữa Phạm vi tác động." /></>} bg="#f4f4f4">
        <label title={`Chỉ áp dụng cho object #${num} đang chọn, không đổi cả class. BẬT: kích thước nội suy giữa các keyframe. TẮT (static): đổi kích thước ở một frame thì áp cho mọi keyframe của object. Hiện đang ${dynWhy}. Mặc định theo class / attribute đặt ở tab Dynamic size.`} style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={dyn} onChange={(e) => setDyn(e.target.checked)} /> Dynamic size · #{num}
        </label>
        <span style={{ color: '#567', fontSize: 11 }} title="Nguồn quyết định dynamic size của object này">({dynWhy})</span>
        {own !== null && <button onClick={clearOwnDyn} title="Bỏ công tắc riêng, quay về theo attribute / class (tab Dynamic size)">↺ theo class</button>}
        {!dyn && <button disabled={selFrame === null} onClick={() => unifySize()} title="Lấy kích thước của frame đang chọn áp cho mọi keyframe của object (hoàn tác được)">Đồng bộ size theo frame {selFrame ?? '…'}</button>}
        <span style={{ whiteSpace: 'nowrap' }}>
        <b title="Khoảng frame mà các nút Keyframe và Outside bên cạnh tác động (khác với khoảng đang hiển thị ở nhóm Object & cửa sổ). Mặc định bằng cửa sổ đang xem.">Phạm vi tác động</b>{' '}
        <span>
          frame{' '}
          <input value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} size={3} style={{ width: 44 }} /> →{' '}
          <input value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} size={3} style={{ width: 44 }} />{' '}
          <button onClick={() => { setRangeFrom(String(frames[0])); setRangeTo(String(frames[frames.length - 1])); }} title="Đặt phạm vi tác động bằng đúng cửa sổ đang hiển thị" style={{ padding: '0 5px' }}>= cửa sổ</button>
        </span>
        </span>
        <button
          disabled={!selSt?.cuboid}
          onClick={() => selFrame !== null && toggleKf(selFrame)}
          title="Phím K. Khoá frame đang chọn thành keyframe (giá trị giữ nguyên); frame đang là keyframe thì mở khoá về nội suy. Chọn frame bằng cách bấm tiêu đề cột."
        >{selSt?.status === 'key' ? '🔓 Mở khoá' : '🔒 Khoá'} frame {selFrame ?? '…'} (K)</button>
        <button onClick={unlockInner} title="Gỡ mọi keyframe nằm hẳn bên trong khoảng, giữ hai đầu mút; frame về nội suy">🔓 Mở khoá KF giữa (Alt+K)</button>

        </Group>
        <Group id="4" title={<>Outside</>} bg="#fff4f4">
        <button
          disabled={selFrame === null}
          onClick={() => selFrame !== null && toggleOutside(selFrame)}
          title="Phím O. Outside từ frame đang chọn tới keyframe kế tiếp; nếu frame đang là outside thì đưa object trở lại. Chọn frame bằng cách bấm tiêu đề cột."
        >① ⛔ Outside — frame {selFrame ?? '…'} (O)</button>
        <button onClick={outsideRange} title="Đặt outside cho mọi frame có box trong cửa sổ đang hiển thị; frame ngay sau cửa sổ giữ nguyên trạng thái">② ⛔ Current window</button>
        <button
          onClick={() => { if (pick) { setPick(null); setNote('Đã hủy chọn khoảng.'); } else { setPick({ first: null }); setNote('Chọn khoảng: bấm tiêu đề cột ĐẦU khoảng (Esc để hủy).'); } }}
          style={{ background: pick ? '#ffd9d9' : undefined, fontWeight: pick ? 700 : 400 }}
          title="Select range: bấm nút rồi bấm tiêu đề hai cột (đầu và cuối khoảng, có thể ở hai cửa sổ khác nhau): mọi frame có box trong khoảng thành outside. Esc để hủy."
        >{pick ? (pick.first === null ? '③ Bấm cột đầu…' : `③ Bấm cột cuối (từ ${pick.first})…`) : '③ ⛔ Select range'}</button>
        </Group>
        <Group id="5" title={<>Gợi ý & mặt đất</>} bg="#f0fbff">
        <button
          onClick={acceptSelectedOrAll}
          disabled={![...sugs.values()].some(Boolean)}
          style={{ fontWeight: 700, background: [...sugs.values()].some(Boolean) ? '#c9f3ff' : undefined }}
          title="Áp box gợi ý (nét đứt xanh lơ) cho frame đang chọn; nếu chưa chọn frame thì cho mọi frame có gợi ý trong cửa sổ. Phím A."
        >✔ Chấp nhận (A){[...sugs.entries()].filter(([f, s]) => s && frames.includes(f)).length ? ` · ${[...sugs.entries()].filter(([f, s]) => s && frames.includes(f)).length}` : ''}</button>
        <button
          onClick={ignoreSelectedOrAll}
          disabled={![...sugs.values()].some(Boolean)}
          title="Bỏ qua gợi ý (nét đứt xanh lơ) của frame đang chọn; nếu chưa chọn frame thì của mọi frame có gợi ý trong cửa sổ. Phím I."
        >✖ Bỏ qua (I)</button>
        <button
          onClick={groundSelectedOrAll}
          title="Ground snap: ước lượng mặt đường quanh chân box (đường xanh lá nét đứt ở view Bên/Trước) rồi hạ/nâng box cho đáy chạm đất. Frame đang chọn, hoặc cả cửa sổ nếu chưa chọn. Phím G."
>⏬ Ground snap (G)</button>
        <label title="sg size = gợi ý kích thước box: khi box lệch cụm điểm, đề xuất box mới (nét đứt xanh lơ, nút ✔ nhận, phím A) kèm cảnh báo ⚠ lệch. Tắt: không có gợi ý và không có cảnh báo lệch (⚠ ít điểm vẫn hiện)." style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={prefs.suggest} onChange={(e) => updatePrefs({ ...prefs, suggest: e.target.checked })} /> sg size
        </label>
        <label title="gr z=0 = hiện mặt đường ego (Oxy): mặt phẳng Oxy (z = 0, mặt đường dưới xe) vẽ bằng vạch vàng chấm ở view Bên / Trước của MỌI frame, theo z của box ở frame đó (box nghiêng thì vạch nghiêng theo). Để so box với mặt đường chung của cả cảnh; không ảnh hưởng cảnh báo hay dữ liệu.">
          <input type="checkbox" checked={prefs.egoPlane} onChange={(e) => updatePrefs({ ...prefs, egoPlane: e.target.checked })} /> gr z=0
        </label>
        <label title={`sg gr = dò mặt đất: đo mặt đường riêng cho object ở đúng frame đang xét (lớp thấp nhất có mật độ ở 8 cung quanh box + lớp tiếp xúc dưới gầm), không dự đoán từ frame khác. Báo khi đáy cao hơn mặt đường quá ${cm(DEFAULT_GROUND.floatTol)} cm hoặc thấp hơn quá ${cm(DEFAULT_GROUND.sinkTol)} cm và vượt độ bất định của phép đo. Tắt: không còn chip ⏬, không có Ground snap (G) và tự bám mặt đất.`} style={{ fontWeight: 600 }}>
          <input type="checkbox" checked={prefs.ground} onChange={(e) => updatePrefs({ ...prefs, ground: e.target.checked })} /> sg gr
        </label>
        <label title="gr lock = tự bám mặt đất khi kéo: sau mỗi lần dời / đổi cỡ box bằng chuột, tự đặt lại độ cao cho đáy chạm mặt đường tại vị trí mới">
          <input type="checkbox" checked={autoSnap} disabled={!prefs.ground} onChange={(e) => setAutoSnap(e.target.checked)} /> gr lock
        </label>
        </Group>
        <Group id="1" title={<>QC & cảnh báo</>}>
        <label title="QC mode: hiện ô ghi chú ở mỗi cột frame (xuất Excel ở tab QC)" style={{ fontWeight: 600 }}><input type="checkbox" checked={qcOn} onChange={(e) => qcStore.setMode(e.target.checked)} /> QC</label>
        <label title="Cảnh báo box không bao đúng cụm điểm (điểm lọt ra ngoài box) hoặc dưới 6 điểm"><input type="checkbox" checked={warn} onChange={(e) => setWarn(e.target.checked)} /> cảnh báo lệch</label>
        {([
          ['lệch', allWarn.misfit, '#a0006e', 'Box không bao đúng cụm điểm (cả track, các frame đã tải point cloud)', true],
          ['ít điểm', allWarn.sparse, '#a0006e', 'Dưới 6 điểm trong box (cả track, các frame đã tải point cloud)', true],
          ['⏬ đáy lơ lửng / chìm', allWarn.ground, '#2d5a00', `Đáy box lệch mặt đường quá ngưỡng (cả track, mặt đường đo riêng ở từng frame, trong ${DEFAULT_GROUND.maxRange} m quanh ego)`, true],
          ['chồng lấn', allWarn.overl, '#b45a00', 'Box chồng lên object khác (xét chéo giữa các ID)', false],
        ] as [string, number[], string, string, boolean][]).filter(([, fr]) => fr.length > 0).map(([name, fr, color, tip, needsCloud]) => (
          <span
            key={name} style={{ color, fontWeight: 600, ...(needsCloud && cloudPartial ? PENDING_STYLE : null) }}
            title={tip + (needsCloud && cloudPartial ? `. Chưa đủ dữ liệu: mới kiểm ${fitSeries.checked}/${row?.assigned ?? 0} frame có box, các frame còn lại đang tải ngầm` : '') + '. Bấm một đoạn để nhảy tới frame đầu của đoạn.'}
          >
            {needsCloud && cloudPartial ? '⏳' : '⚠'} {name} ({fr.length}):{' '}
            {toRanges(fr).map(([x, y]) => (
              <button key={x} onClick={() => goFrame(x)} style={{ padding: '0 3px', marginRight: 2, fontWeight: 600, color }}>{x === y ? x : `${x}–${y}`}</button>
            ))}
          </span>
        ))}
        {(warn || prefs.ground) && cloudPartial && (
          <span style={{ color: '#666', fontSize: 11, ...PENDING_STYLE }} title="Lệch / ít điểm / đáy chỉ kiểm được ở frame đã tải point cloud; các frame còn lại đang tải ngầm, số liệu tự cập nhật">(đã kiểm {fitSeries.checked}/{row?.assigned ?? 0} frame có box)</span>
        )}
        {trackSummary.byKind.map(([kind, fr]) => (
          <span key={kind} style={{ color: '#a0006e', fontWeight: 600 }} title="Cả track (ký hiệu lỗi đặt ở tab Threshold). Bấm một đoạn để nhảy tới frame đầu của đoạn.">
            ⚠ {sym(kind)} ({fr.length}):{' '}
            {toRanges(fr).map(([x, y]) => (
              <button key={x} onClick={() => goFrame(x)} style={{ padding: '0 3px', marginRight: 2, fontWeight: 600, color: '#a0006e' }}>{x === y ? x : `${x}–${y}`}</button>
            ))}
            <button
              onClick={() => { ignoreStore.set(fr.map((f) => issueKey(job.id, num, f, kind)), true); setNote(`Đã bỏ qua ${fr.length} cảnh báo ${sym(kind)} của object #${num}.`); }}
              style={{ padding: '0 3px', fontSize: 10 }} title={`Bỏ qua cả ${fr.length} frame ${kind} của object này (theo lô)`}
            >✖ bỏ qua tất cả</button>
          </span>
        ))}
        {outGaps.map((g) => (
          <span key={g.from} style={{ color: '#7a1f1f', fontWeight: 600 }} title={`Outside liên tục ${g.len} frame (${g.from}–${g.to}) rồi có box lại từ frame ${g.resume}. Từ ${SPLIT_OUTSIDE_FRAMES} frame trở lên nên tách ID (guideline).`}>
            ⚠ outside {g.len} frame ({g.from}–{g.to}){' '}
            <button
              onClick={() => splitAt(g)}
              style={{ padding: '0 4px', fontWeight: 600 }}
              title={`Tách ID: phần từ frame ${g.resume} thành object MỚI (nằm cuối danh sách, chưa lên CVAT cho tới khi upload); object #${num} giữ phần trước và outside có keyframe tới cuối job. Có hộp xác nhận, hoàn tác bằng cách không upload nháp.`}
            >✂ tách ID từ frame {g.resume}</button>
          </span>
        ))}
        {trackSummary.far.length > 0 && (
          <span style={{ color: '#a05a00', fontWeight: 600 }} title="Cả track. Bấm một đoạn để nhảy tới frame đầu của đoạn.">
            ⚠ đi xa bất thường ({trackSummary.far.length}):{' '}
            {toRanges(trackSummary.far).map(([x, y]) => (
              <button key={x} onClick={() => goFrame(x)} style={{ padding: '0 3px', marginRight: 2, fontWeight: 600, color: '#a05a00' }}>{x === y ? x : `${x}–${y}`}</button>
            ))}
            <button
              onClick={() => { ignoreStore.set(trackSummary.far.map((f) => motionKey(job.id, num, f)), true); setNote(`Đã bỏ qua ${trackSummary.far.length} cảnh báo đi xa của object #${num}.`); }}
              style={{ padding: '0 3px', fontSize: 10 }} title="Bỏ qua cả các frame này của object (theo lô)"
            >✖ bỏ qua tất cả</button>
          </span>
        )}
        </Group>
        <Group id="6" title={<>Object & cửa sổ</>}>
        <span><IdBox value={num} max={max} onCommit={setSelectedNum} /></span>
        <span>
          <button disabled={k === 0} onClick={() => setK(0)} title="Về cửa sổ đầu tiên">|&lt;</button>{' '}
          <button disabled={k === 0} onClick={() => setK(k - 1)}>◀</button>{' '}
          <span style={{ display: 'inline-block', minWidth: '6.5em', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>Cửa sổ {k + 1}/{nWin}</span>{' '}
          <button disabled={k >= nWin - 1} onClick={() => setK(k + 1)}>▶</button>{' '}
          <button disabled={k >= nWin - 1} onClick={() => setK(nWin - 1)} title="Tới cửa sổ cuối cùng">&gt;|</button>
        </span>
        <span title="Cửa sổ đang hiện. Nhập a: bắt đầu cửa sổ từ frame a, b tự thành a + số frame - 1 (mặc định 6 frame). Sửa b: đổi số frame hiển thị (b - a + 1). Enter để áp dụng.">
          Cửa sổ hiện{' '}
          <input value={winA} onChange={(e) => setWinA(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} onBlur={commitA} onFocus={(e) => e.target.select()} size={3} style={{ width: 44 }} /> →{' '}
          <input value={winB} onChange={(e) => setWinB(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} onBlur={commitB} onFocus={(e) => e.target.select()} size={3} style={{ width: 44 }} />{' '}
          <span style={{ display: 'inline-block', minWidth: '4.6em', fontVariantNumeric: 'tabular-nums' }}>({frames.length} frame)</span>{' '}
          <label><input type="checkbox" checked={prefs.keyOnly} onChange={(e) => updatePrefs({ ...prefs, keyOnly: e.target.checked })} /> chỉ keyframe</label>
          {viewFrom !== '' && <button style={{ marginLeft: 4 }} onClick={() => { forceFirst.current = true; setViewFrom(''); }} title="Quay về đầu job">⟲ từ đầu</button>}
        </span>
        </Group>
        <Group id="2" title={<>Hiển thị</>}>
        <span>
          Zoom <button onClick={() => zoomBy(1 / 1.25)}>−</button> <b>{Math.round(zoom * 100)}%</b>{' '}
          <button onClick={() => zoomBy(1.25)}>+</button> <button onClick={() => { setZoom(1); setPan(NO_PAN); }} title="Zoom 100% và đưa box về giữa ô">Vừa object</button>{' '}
          <button onClick={() => setPan(NO_PAN)} disabled={!panned} style={panned ? { fontWeight: 700, color: '#a16207' } : undefined} title="Đưa khung nhìn về giữa box (đang dời bằng chuột phải). Giữ chuột phải trên ô rồi kéo để dời khung nhìn.">⌖ Về giữa</button>
        </span>
        <span>
          Cỡ ô{' '}
          <label><input type="checkbox" checked={prefs.auto} onChange={(e) => updatePrefs({ ...prefs, auto: e.target.checked })} /> tự khớp màn hình</label>{' '}
          <Slider min={CELL_MIN} max={CELL_MAX} step={10} value={size} def={200} unit="px" disabled={prefs.auto} onChange={(v) => updatePrefs({ ...prefs, auto: false, size: v })} />
        </span>
        <span title="Khoảng cách giữa các cột frame (4–80 px)">
          Khoảng cách{' '}
          <Slider min={4} max={80} step={2} value={prefs.gap} def={28} unit="px" onChange={(v) => updatePrefs({ ...prefs, gap: v })} />
        </span>
        <span title="Độ dày lát cắt ở view Bên / Trước = nửa bề rộng box + biên này. Giảm để bớt tường và vật ở xa hai bên.">
          Lát cắt +{' '}
          <Slider min={0} max={3} step={0.1} value={prefs.slabMargin} def={0.5} unit="m" decimals={1} onChange={(v) => updatePrefs({ ...prefs, slabMargin: v })} />
        </span>
        <label title="Cho box nghiêng (roll / pitch): giữ Alt rồi kéo ở view Bên (pitch) / view Trước (roll), và Ground snap (G) nghiêng box song song mặt đường dốc. Tắt: Alt+kéo ở các view này chỉ xoay yaw và G chỉ dời z."><input type="checkbox" checked={prefs.tilt} onChange={(e) => updatePrefs({ ...prefs, tilt: e.target.checked })} /> nghiêng theo mặt đường</label>
        </Group>
      </div>
      <div style={{ marginBottom: 6, display: 'flex', flexWrap: 'wrap', gap: '4px 12px', alignItems: 'center' }}>
        {row && (
          <span style={{ display: 'inline-flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
            <Pill tone="class" title="Nhãn của object">{row.label}</Pill>
            <Pill title="Số frame có box">gán {row.assigned}</Pill>
            <Pill title="Số frame outside">outside {row.outside}</Pill>
            <Pill tone={row.missing > 0 ? 'bad' : 'plain'} title="Frame outside thiếu keyframe riêng (sẽ được tự điền khi upload)">thiếu KF {row.missing}</Pill>
            <Pill title="ID trong database của CVAT">db {row.id || '—'}</Pill>
          </span>
        )}
        <span style={{ whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums' }}>cửa sổ: {frames.filter((f) => pointClouds.has(f)).length}/{frames.length} · {gpuActive() ? 'GPU ✓ · ' : ''}đã tải: {loadedFrames}/{stop - start + 1}{pointClouds.secondsPerFrame() !== null && loadedFrames < stop - start + 1 ? ` · ~${pointClouds.secondsPerFrame()!.toFixed(1)} s/frame` : ''}</span>
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
        Mẹo thao tác <Help text={"phím K / O / G / A / I tác dụng lên cột frame đang trỏ chuột (viền xanh) · xem/đổi phím ở tab \"Phím tắt\" · cuộn chuột trên ô để zoom mọi frame · giữ chuột phải rồi kéo để dời khung nhìn (mọi frame cùng dời), nút ⌖ Về giữa / phím 0 để đưa về giữa · kéo trong box để dời, kéo cạnh để đổi kích thước, kéo chấm trắng ngắn ở đầu mũi tên (view Trên) hoặc GIỮ ALT rồi kéo để xoay (view Trên: yaw · view Bên: pitch · view Trước: roll, nếu bật \"nghiêng theo mặt đường\") · sửa frame nào thì frame đó thành keyframe"} />
      </div>
      <div style={{ display: 'flex', gap: prefs.gap, overflowX: 'auto', justifyContent: 'safe center', padding: '2px 4px 6px' }}>
        {cols.map((c) => (
          <Column
            key={c.f} f={c.f} size={size} st={c.st} refCub={c.ref} half={half} locHalf={locHalf} selected={selFrame === c.f} pan={panEff} onPan={setPanClamped}
            edited={edited.has(`${num}:${c.f}`)} warn={warn} fixed={!dyn} ignored={ign.has(ignoreKey(job.id, num, c.f))}
            onIgnore={(f, on) => ignoreFrames([f], on)}
            motion={c.mot} motionIgnored={ign.has(motionKey(job.id, num, c.f))}
            onIgnoreMotion={ignoreMotion}
            autoSnap={autoSnap && prefs.ground} groundOv={series.get(c.f) ?? null} groundOn={prefs.ground} egoOn={prefs.egoPlane} suggestOn={prefs.suggest} onGround={(f) => { if (!groundFrame(f)) setNote(`Không snap được frame ${f}: ${snapWhy.current || 'không rõ lý do'}.`); }}
            onSnap={(f, g) => setSnaps((m) => (m.get(f) === g ? m : new Map(m).set(f, g)))}
            onSuggest={(f, s) => setSugs((m) => (m.get(f) === s ? m : new Map(m).set(f, s)))} onAccept={accept}
            onFit={(f, r) => setFits((m) => (m.get(f) === r ? m : new Map(m).set(f, r)))} onSelect={() => onPickSelect(c.f)}
            onLoaded={(f) => setLoaded((s) => new Set(s).add(f))}
            onCommit={commit} onZoom={zoomBy} onToggleKf={toggleKf} overlap={ovAt.get(c.f) ?? []} overlayCubs={ovCubs.get(c.f) ?? EMPTY_CUBS} onIgnoreOverlap={(o) => { ignoreStore.set([overlapKey(job.id, num, o)], true); setNote(`Đã bỏ qua cặp #${Math.min(num, o)}–#${Math.max(num, o)} (mọi frame).`); }} onOpenObject={setSelectedNum} tiltOn={prefs.tilt} onFocusFrame={onFocusFrame} fileFlags={(fileFlags.get(c.f) ?? NO_FLAGS).filter((x) => !x.det)} onMarkFlag={markFlagAsk} issues={issueMap.get(c.f) ?? NO_ISSUES} issueIgnored={(k) => ign.has(issueKey(job.id, num, c.f, k))} onIgnoreIssue={ignoreIssueAsk} qcOn={qcOn} qcNote={qcNotes[qcKey(job.id, num, c.f)] ?? ''} onQcNote={(f, t) => qcStore.set(job.id, num, f, t)} onToggleOutside={toggleOutside} onHover={(f) => { hoverRef.current = f; onHoverFrame(f); }} scene={scene}
          />
        ))}
      </div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
        Viền: <span style={{ color: STATUS_COLOR.key }}>■ keyframe</span> <span style={{ color: STATUS_COLOR.interp }}>■ nội suy</span>{' '}
        <span style={{ color: STATUS_COLOR.hold }}>■ giữ nguyên</span> <span style={{ color: STATUS_COLOR.outside }}>■ outside</span>{' '}
        <span style={{ color: STATUS_COLOR.none }}>■ chưa có</span> · khung nhìn rộng ±{half.toFixed(1)} m quanh object
      </div>
      {bulk && (
        <div role="dialog" aria-modal="true" onClick={() => setBulk(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', color: '#111', border: '1px solid #888', borderRadius: 6, padding: 14, maxWidth: 420, boxShadow: '0 4px 18px rgba(0,0,0,.4)' }}>
            <p style={{ margin: '0 0 6px' }}>
              Bạn vừa chọn <b>{bulk.verb}</b> lỗi <b>{sym(bulk.kind)}</b> của object #{num} ở frame {bulk.f}.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              Object này còn <b>{bulk.others.length}</b> frame khác cùng lỗi {sym(bulk.kind)}: {bulk.others.slice(0, 14).join(', ')}{bulk.others.length > 14 ? ', …' : ''}.
              Có muốn {bulk.verb} luôn cho các frame còn lại không?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => setBulk(null)}>Hủy</button>
              <button onClick={() => { bulk.run([bulk.f]); setBulk(null); }}>Chỉ frame {bulk.f}</button>
              <button className="cvla-primary" autoFocus onClick={() => { bulk.run([bulk.f, ...bulk.others]); setNote(`Đã ${bulk.verb} lỗi ${sym(bulk.kind)} của object #${num} ở ${bulk.others.length + 1} frame.`); setBulk(null); }}>Tất cả {bulk.others.length + 1} frame</button>
            </div>
          </div>
        </div>
      )}
      {selCol ? <CameraPanel frame={selCol.f} azimuth={az} /> : <p style={{ color: '#666' }}>Bấm vào một cột (tiêu đề frame) để xem ảnh camera của frame đó.</p>}
    </>
  );
}
