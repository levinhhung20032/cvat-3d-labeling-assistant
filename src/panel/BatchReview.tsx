import { apply, transpose, type Mat3 } from '../shared/rot';
import { askConfirm } from './confirmStore';
import { kv } from './storage';
import { onViewport, viewport } from './bridge';
import { useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { azimuthDeg, parseCuboid, serializeCuboid, type Cuboid } from '../shared/cuboid';
import {
  applyLocalBox, viewFrame, dragCorner, dragEdge, dragMove, dragRotateRel, dragTilt, dragYawByX, hitTest, identityBox, localBoxOf, screenRect, type Hit, type LocalBox,
} from '../shared/edit';
import { referenceCuboid, stateAt, type FrameState } from '../shared/interp';
import { resizeKeyframes, rotateAllKeyframes, translateKeyframes, upsertKeyframe as upsertKf } from '../shared/edit';
import {
  removeInnerKeyframes, removeOutsideKeyframes, restoreFrom, restoreOutsideRange, setOutsideFrom, setOutsideRange, toggleKeyframe,
  type TrackChange,
} from '../shared/keyframes';
import type { PointCloud } from '../shared/pcd';
import { type ObjectRow, pageCount, pageFrames, pageOf } from '../shared/table';
import type { CvatAnnotations, CvatJob, CvatLabel, CvatTrack } from '../shared/types';
import { parseLabelSpecs } from '../shared/attributes';
import { AttributePanel } from './AttributePanel';
import { gpuActive } from './gpu';
import { Help, PENDING_STYLE, Pill, Slider } from './ui';
import { ControlLayout, GripCtx, PopCtx } from './ControlLayout';
// Bảng so sánh Patchwork++ chỉ có trên máy kiểm thử (PwCompare.tsx không đưa lên git): không có file thì nút và bảng không xuất hiện.
type PwCompareProps = { ann: CvatAnnotations; start: number; stop: number; num: number; onJump: (num: number, f: number) => void; onClose: () => void };
const pwCompareMods = import.meta.glob('./PwCompare.tsx', { eager: true }) as Record<string, { PwCompare?: (p: PwCompareProps) => JSX.Element }>;
const PwCompare = Object.values(pwCompareMods)[0]?.PwCompare ?? null;
import { setPoolSource, setSegForced } from './groundSeg';
import { clampPan, drawView, type EgoPlane, hexRgb, localize, NO_PAN, panBy, panOffset, rotateLocal, REF_COLOR, statusColor, type Local, type Pan, type Scene, type View } from './render';
import { Cancelled, pointClouds } from './stores';
import { issueKey, ignoreKey, ignoreStore, motionKey, overlapKey, shiftStore, useIgnored } from './shiftStore';
import { CameraPanel } from './CameraPanel';
import { useCameraShow } from './cameraStore';
import { qcStore, useQcMode, useQcNotes } from './qcStore';
import { qcKey } from '../shared/qc';
import { actionOfTitle, onAction, useKeyHint, useKeyOf } from './actions';
import { KeyBindMenu } from './KeyBindMenu';
import { DEFAULT_FIT, fitGroundOf, fitReport, type FitReport } from '../shared/fit';
import { thresholdStore, useThresholdVersion } from './thresholdStore';
import { sym, symLabel, useSymbols } from './symbolStore';
import { findLateStart, findLongOutsideGaps, SPLIT_OUTSIDE_FRAMES, type OutsideGap } from '../shared/splitId';
import { useColors } from './colorStore';
import { useFrameLayout } from './layoutStore';
import { View3D, type View3dOther } from './View3D';
import { yawVsEgoDeg } from '../shared/view3d';
import { clientIdOf } from './cvatIds';
import { adviseGround, type GroundAdvice } from '../shared/groundSuggest';
import { confirmSnap, DEFAULT_GROUND, egoGround, levelGround, neighborGroundZ, enforceConsistency, GROUND_KINDS, groundSnap, groundSnapBy, pwGroundPlane, type ConsistencyItem, tiltFromPlane, type GroundKind, type GroundResult, type GroundSector } from '../shared/ground';
import { DEFAULT_REFLECT, mirrorBox, mirroredPoints, pointsBelow, reflectionPlane, refPlane, type PlaneSource, type RefMode, type RefState } from '../shared/reflect';
import { refStore, useRefState } from './refStore';
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
const VIEW_GAP = 4; // tab Ref: khoảng cách giữa 3 view xếp ngang
/** Tab Ref: ở cỡ ô này khung nhìn rộng đúng bằng ở Batch Review; ô to hơn thì thấy thêm vùng xung quanh (giữ nguyên tỉ lệ px / m). */
const REF_BASE = 400;
/** Tab Ref: cỡ ô tự khớp chiều ngang (trang cuộn dọc nếu cao quá) hoặc chỉnh tay; ẩn được cột Gốc để cột Gộp chiếm cả chiều ngang. */
interface RefViewPrefs { auto: boolean; size: number; orig: boolean }
const REF_VIEW_KEY = 'cvla-ref-view', REF_CELL_MAX = 1000;
function loadRefPrefs(): RefViewPrefs {
  try {
    const p = JSON.parse(kv.get(REF_VIEW_KEY) ?? '{}') as Partial<RefViewPrefs>;
    const size = typeof p.size === 'number' && Number.isFinite(p.size) ? Math.min(REF_CELL_MAX, Math.max(CELL_MIN, p.size)) : 480;
    return { auto: p.auto !== false, size, orig: p.orig !== false };
  } catch { return { auto: true, size: 480, orig: true }; }
}

setPoolSource((g) => pointClouds.peek(g)); // gộp điểm mặt đất của frame lân cận (mức 4) lấy từ các frame đã tải

// --- tùy chọn hiển thị, nhớ theo từng người dùng (chỉ là tiện ích, không quan trọng nếu mất) ---
// ptAlpha: độ đậm 0.1–1; ptSize: hệ số cỡ điểm (màu point nay ở tab Màu sắc).
interface Prefs { auto: boolean; size: number; slabMargin: number; perWin: number; keyOnly: boolean; tilt: boolean; gap: number; suggest: boolean; gkind: GroundKind; gshowAll: boolean; gadvise: boolean; ptAlpha: number; ptSize: number }
const PREFS_DEFAULT: Prefs = { auto: true, size: 200, slabMargin: 0.5, perWin: 6, keyOnly: false, tilt: true, gap: 28, suggest: true, gkind: 'measured', gshowAll: false, gadvise: true, ptAlpha: 1, ptSize: 1 };
// Bản cũ lưu 3 công tắc ground / egoPlane / pwShow: chuyển thành một nguồn (ưu tiên đo riêng).
const legacyKind = (p: { ground?: boolean; egoPlane?: boolean; pwShow?: boolean }): GroundKind => (p.ground === false ? (p.egoPlane ? 'ego' : p.pwShow ? 'pw' : 'measured') : 'measured');
const loadPrefs = (): Prefs => {
  try {
    const p = JSON.parse(kv.get('cvla-prefs') ?? '{}') as Partial<Prefs>;
    const num = (v: unknown, d: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d);
    return {
      auto: p.auto ?? true, size: num(p.size, 200, CELL_MIN, CELL_MAX), slabMargin: num(p.slabMargin, 0.5, 0, 3),
      perWin: Math.round(num(p.perWin, 6, 2, 30)), keyOnly: p.keyOnly === true, tilt: p.tilt !== false, gap: Math.round(num(p.gap, 28, 4, 80)), suggest: p.suggest !== false, gkind: GROUND_KINDS.includes(p.gkind as GroundKind) ? (p.gkind as GroundKind) : legacyKind(p as { ground?: boolean; egoPlane?: boolean; pwShow?: boolean }), gshowAll: p.gshowAll === true, gadvise: p.gadvise !== false,
      ptAlpha: num(p.ptAlpha, 1, 0.1, 1), ptSize: num(p.ptSize, 1, 0.5, 4),
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

const cm = (m: number) => Math.round(Math.abs(m) * 100);
/** Ba nguồn mặt đường chọn được. Ground snap / lock chỉ chạy khi frame chọn ĐÚNG 1 nguồn; chọn nhiều thì chỉ hiển thị, không snap / lock. */
const GROUND_LABEL: Record<GroundKind, { short: string; full: string; tip: string }> = {
  measured: { short: 'local', full: 'local (đo riêng)', tip: `Đo mặt đường riêng cho object ở đúng frame này (lớp thấp nhất có mật độ ở 8 cung quanh box + lớp tiếp xúc dưới gầm), không dự đoán từ frame khác. Báo ⏬ khi đáy cao hơn mặt đường quá ${cm(DEFAULT_GROUND.floatTol)} cm hoặc thấp hơn quá ${cm(DEFAULT_GROUND.sinkTol)} cm và vượt độ bất định của phép đo.` },
  ego: { short: 'ego', full: 'ego (z = 0)', tip: 'Mặt phẳng Oxy của ego (z = 0, mặt đường dưới xe): vạch vàng chấm ở view Bên / Trước, theo z của box ở frame này. Snap / lock (nếu chọn nguồn này) đặt đáy box lên z = 0.' },
  pw: { short: 'patchwork++', full: 'patchwork++', tip: 'Mặt đường fit từ các điểm Patchwork++ gán là mặt đất quanh box (vạch tím nét đứt ở view Bên / Trước). Snap / lock đặt đáy box lên mặt này; frame thiếu điểm mặt đất quanh box thì không có vạch.' },
  nbr: { short: 'box ID nhỏ', full: 'box ID nhỏ (≤ 5 m)', tip: 'Mặt đường lấy từ ĐÁY các box có ID nhỏ hơn (đã được kiểm duyệt) có tâm cách box này không quá 5 m ở frame này: trung bình có trọng số theo khoảng cách, coi là mặt ngang (vạch cam chấm gạch ở view Bên / Trước). Không có box nào trong 5 m thì không có nguồn này.' },
};
const GROUND_OPT: Record<GroundKind, string> = { measured: 'local', ego: 'ego', pw: 'patchwork++', nbr: 'box ID nhỏ' };
/** Chọn ĐÚNG 1 nguồn mặt đường (Ground snap / lock dùng nguồn này). */
function GroundPick({ kind, onChange, label, title }: { kind: GroundKind; onChange: (k: GroundKind) => void; label?: string; title?: string }) {
  return (
    <span onClick={(e) => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: 3, minWidth: 0, flex: '0 1 auto' }}>
      {label && <span>{label}:</span>}
      <select
        value={kind} onChange={(e) => onChange(e.target.value as GroundKind)}
        title={title ?? `Mặt đường dùng cho Ground snap / lock: ${GROUND_LABEL[kind].full}.`}
        style={{ fontSize: 11, padding: 0, height: 16, maxWidth: 110, minWidth: 0, width: '100%', fontWeight: 600 }}
      >
        {GROUND_KINDS.map((k) => <option key={k} value={k} title={GROUND_LABEL[k].tip}>{GROUND_OPT[k]}</option>)}
      </select>
    </span>
  );
}

// Nguồn mặt đường theo frame đã lưu: bản cũ lưu mảng (chọn nhiều), nay chỉ giữ 1 nguồn (ưu tiên theo thứ tự đo riêng → ego → Patchwork++).
const loadFrameSel = (key: string): Record<number, GroundKind> => {
  const out: Record<number, GroundKind> = {};
  try {
    const o = JSON.parse(kv.get(key) ?? '{}') as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (!Number.isInteger(Number(k))) continue;
      const one = Array.isArray(v) ? GROUND_KINDS.find((g) => v.includes(g)) : GROUND_KINDS.find((g) => g === v);
      if (one) out[Number(k)] = one;
    }
  } catch { /* bỏ qua */ }
  return out;
};

interface DragState { hit: NonNullable<Hit>; x0: number; y0: number; base: LocalBox; moved: boolean }

function Cell({ nbrPlane, nbrZ, frame, view, size, loc, st, half, box, misfit, ghost, ground, groundMarks, contactW, egoPlane, mark, scene, overlays, tiltOn, autoSnap, lockKind, onPreview, onCommit, onZoom, pan, onPan, reflect, pwPlane, ovCount, ovNums, onPreviewOther, onCommitOther, onSyncGround }: {
  onSyncGround: (i: number, all: boolean, back: boolean) => void; // bấm đúp vào box xung quanh: đồng bộ mặt đường (Ctrl: cả các frame phía sau) (đáy box đang xét = đáy box đó)
  nbrPlane: EgoPlane | null; nbrZ: number | null; // mặt đường theo đáy box ID nhỏ (vẽ) và độ cao thế giới của nó (snap)
  ovNums: number[]; // số thứ tự object của từng box chồng lấn / xung quanh (để hiện ID khi rê chuột)
  ovCount: number; // overlays[0 … ovCount − 1] là box của object khác đang chồng lấn (kéo được); phần còn lại (box gương ref) không kéo
  onPreviewOther: (i: number, b: LocalBox | null) => void; onCommitOther: (i: number, delta: [number, number, number], dyaw?: number, all?: boolean, back?: boolean) => void; // dời box chồng lấn: xem trước / ghi (độ dời tâm theo hệ của khung nhìn)
  pwPlane: EgoPlane | null; // mặt đường Patchwork++ gợi ý (tím) trong hệ của khung nhìn
  lockKind: GroundKind | null; // nguồn mặt đường của lock (frame chọn đúng 1 nguồn); null: không lock
  reflect: { pts: Local | null; plane: number } | null; // ref mode (chỉ ở tab Ref)
  egoPlane: EgoPlane | null; // mặt phẳng Oxy của ego trong hệ của khung nhìn (null: công tắc tắt)
  scene: Scene; overlays: LocalBox[]; tiltOn: boolean; frame: Mat3 | null; // frame: khung nhìn căn theo box nghiêng (null nếu box không nghiêng)
  mark: { u: number; v: number; w: number } | null;
  ground: number | null; autoSnap: boolean;
  groundMarks: GroundSector[]; contactW: number | null; // mặt đường đo được ở từng cung quanh box + lớp tiếp xúc dưới gầm (để vẽ)
  ghost: LocalBox | null; misfit: boolean; view: View; size: number; loc: Local | null; st: FrameState; half: number; box: LocalBox | null;
  onPreview: (b: LocalBox | null) => void; onCommit: (c: Cuboid, all?: 'rot' | 'move' | 'size', lb?: LocalBox, back?: boolean) => void; onZoom: (factor: number) => void;
  pan: Pan; onPan: (p: Pan) => void; // dời khung nhìn (giữ chuột phải kéo), dùng chung mọi view / frame
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const drag = useRef<DragState | null>(null);
  const panDrag = useRef<{ x0: number; y0: number; base: Pan } | null>(null);
  const [tip, setTip] = useState<{ n: number; x: number; y: number } | null>(null);
  const ovDrag = useRef<{ i: number; base: LocalBox; x0: number; y0: number; last: LocalBox; moved: boolean; rot: { cx: number; cy: number } | null } | null>(null);
  const k = size / (2 * half);
  const [ox, oy] = panOffset(view, pan, k);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  const colorsNow = useColors(); // màu đổi (tab Màu sắc) thì vẽ lại ô
  useEffect(() => {
    const ctx = ref.current?.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    drawView(ctx, size, view, loc, box, half, st.status, !!drag.current, misfit, ghost, ground, mark, scene, overlays, st.cuboid, groundMarks, contactW, pan, egoPlane, reflect, pwPlane, nbrPlane);
  }, [nbrPlane, view, size, dpr, loc, st.status, st.cuboid, half, box, misfit, ghost, ground, groundMarks, contactW, egoPlane, mark, scene, overlays, pan, reflect, pwPlane, colorsNow]);

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
  const pos = (e: React.MouseEvent) => {
    const r = ref.current!.getBoundingClientRect();
    return [e.clientX - r.left - ox, e.clientY - r.top - oy] as const;
  };

  /** Box chồng lấn dưới con trỏ (vùng bao của hình chiếu, kể cả khi box bị xoay so với box đang xét): chỉ dời, không đổi cỡ / xoay. -1 nếu không có. */
  const ovAt = (px: number, py: number): number => {
    for (let i = Math.min(ovCount, overlays.length) - 1; i >= 0; i--) {
      const o = overlays[i]!;
      const cs = Math.abs(Math.cos(o.dyaw)), sn = Math.abs(Math.sin(o.dyaw));
      const sx = o.sx * cs + o.sy * sn, sy = o.sx * sn + o.sy * cs; // cỡ vùng bao theo trục u, v
      const r = screenRect(view, { ...o, dyaw: 0, sx, sy }, size, half);
      if (px >= r.left - 4 && px <= r.right + 4 && py >= r.top - 4 && py <= r.bottom + 4) return i;
    }
    return -1;
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
    // Box chồng lấn: kéo ở phần chỉ thuộc box đó (ngoài box đang xét), hoặc giữ Shift để kéo nó ngay cả ở vùng chồng lên box đang xét.
    const oi = ovAt(px, py);
    if (oi >= 0 && ((e.shiftKey && !e.ctrlKey) || !hit)) {
      ref.current!.setPointerCapture(e.pointerId);
      // Giữ Alt: xoay box chồng lấn (view Trên: quanh tâm của nó, hướng về phía con trỏ; view Bên / Trước: theo độ dời ngang) thay vì dời.
      const ob = overlays[oi]!;
      const rc = screenRect(view, { ...ob, dyaw: 0 }, size, half);
      ovDrag.current = { i: oi, base: ob, x0: px, y0: py, last: ob, moved: false, rot: e.altKey ? { cx: (rc.left + rc.right) / 2, cy: (rc.top + rc.bottom) / 2 } : null };
      return;
    }
    if (e.altKey && (!hit || hit.mode === 'move')) hit = { mode: 'move' };
    if (!hit || (hit.mode === 'rotate' && view !== 'top')) return;
    ref.current!.setPointerCapture(e.pointerId);
    drag.current = { hit, x0: px, y0: py, base, moved: false };
  };

  const move = (e: React.PointerEvent) => {
    const p = panDrag.current;
    if (p) { onPan(panBy(view, p.base, (e.clientX - p.x0) / k, (e.clientY - p.y0) / k)); return; }
    const [px, py] = pos(e);
    const od = ovDrag.current;
    if (od) {
      const dx = px - od.x0, dy = py - od.y0;
      if (Math.hypot(dx, dy) > 1) od.moved = true;
      if (od.rot) {
        const r = view === 'top' ? dragRotateRel(od.base, od.x0 - od.rot.cx, od.y0 - od.rot.cy, px - od.rot.cx, py - od.rot.cy) : dragYawByX(od.base, dx);
        od.last = { ...od.base, dyaw: od.base.dyaw + r.dyaw };
      } else od.last = dragMove(view, od.base, dx, dy, k);
      onPreviewOther(od.i, od.last);
      return;
    }
    const d = drag.current;
    if (!d) {
      const ti = ovAt(px, py), tn = ti >= 0 ? ovNums[ti] : undefined;
      setTip((t) => (tn === undefined ? (t ? null : t) : t && t.n === tn && Math.abs(t.x - px - ox) < 1 && Math.abs(t.y - py - oy) < 1 ? t : { n: tn, x: px + ox, y: py + oy }));
      if (ref.current && st.cuboid) {
        const h = hitTest(view, identityBox(st.cuboid), px, py, size, half);
        ref.current.style.cursor = !e.altKey && !h && ovAt(px, py) >= 0 ? 'move' : cursorFor(view, h, e.altKey);
      }
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

  const up = (e: React.PointerEvent) => {
    if (panDrag.current) {
      panDrag.current = null;
      if (ref.current) ref.current.style.cursor = 'default';
      return;
    }
    const od = ovDrag.current;
    if (od) {
      ovDrag.current = null;
      if (od.moved) onCommitOther(od.i, [od.last.cu - od.base.cu, od.last.cv - od.base.cv, od.last.cw - od.base.cw], od.last.dyaw - od.base.dyaw, !!od.rot && e.ctrlKey, e.ctrlKey && e.shiftKey);
      onPreviewOther(od.i, null);
      return;
    }
    const d = drag.current;
    drag.current = null;
    if (!d || !st.cuboid) return;
    if (d.moved && box) {
      let b = box;
      // Tự bám mặt đất: sau khi dời / đổi cỡ, đặt lại độ cao để đáy chạm mặt đường tại vị trí mới.
      const geometryChanged = b.cu !== 0 || b.cv !== 0 || b.cw !== 0 || b.sx !== st.cuboid.sx || b.sy !== st.cuboid.sy || b.sz !== st.cuboid.sz;
      if (autoSnap && lockKind && loc && geometryChanged && !frame) {
        const at = { cu: b.cu, cv: b.cv, cw: b.cw, range: Math.hypot(st.cuboid.x, st.cuboid.y) };
        const g = groundSnapBy(lockKind, loc, b.sx, b.sy, b.sz, at, st.cuboid.z, DEFAULT_GROUND, nbrZ);
        if (g && g.confident && (lockKind !== 'measured' || confirmSnap(loc, b.sx, b.sy, b.sz, at, g))) b = { ...b, cw: b.cw + g.dz }; // đo riêng: đo lại tại chỗ mới phải ra cùng mặt đường
      }
      if (frame) { const [cu, cv, cw] = apply(transpose(frame), [b.cu, b.cv, b.cw]); b = { ...b, cu, cv, cw }; } // về hệ yaw
      const rotated = d.hit.mode === 'rotate' || (d.hit.mode === 'move' && e.altKey);
      const moved = d.hit.mode === 'move' && !e.altKey && e.ctrlKey;
      const resized = (d.hit.mode === 'edge' || d.hit.mode === 'corner') && e.ctrlKey;
      // Giữ Ctrl khi kéo = áp cho frame này và mọi frame phía sau (Ctrl+Shift: mọi frame phía trước): Ctrl+Alt+kéo xoay · Ctrl+kéo (dời) dời cùng độ lệch · Ctrl+kéo cạnh / góc đổi kích thước
      onCommit(applyLocalBox(st.cuboid, b), rotated && e.ctrlKey && e.altKey ? 'rot' : moved ? 'move' : resized ? 'size' : undefined, resized ? b : undefined, e.ctrlKey && e.shiftKey);
    }
    onPreview(null);
  };

  return (
    <div style={{ position: 'relative', width: size, height: size }}>
      <canvas
        ref={ref} width={Math.round(size * dpr)} height={Math.round(size * dpr)}
        style={{ display: 'block', width: size, height: size, touchAction: 'none' }}
        onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerLeave={() => setTip(null)} onPointerCancel={() => { const od = ovDrag.current; ovDrag.current = null; drag.current = null; panDrag.current = null; onPreview(null); if (od) onPreviewOther(od.i, null); }}
        onContextMenu={(e) => e.preventDefault()}
        onDoubleClick={(e) => {
          if (drag.current || ovDrag.current || panDrag.current) return;
          const [px, py] = pos(e);
          const oi = ovAt(px, py);
          if (oi >= 0 && ovNums[oi] !== undefined) { e.stopPropagation(); onSyncGround(oi, e.ctrlKey, e.shiftKey); }
        }}
      />
      {tip && !ovDrag.current && !drag.current && (
        <div style={{ position: 'absolute', left: Math.min(tip.x + 10, size - 44), top: Math.max(0, tip.y - 20), background: '#0b3a6b', color: '#fff', fontSize: 12, fontWeight: 700, padding: '1px 6px', borderRadius: 6, pointerEvents: 'none', whiteSpace: 'nowrap' }}>ID #{tip.n}</div>
      )}
    </div>
  );
}

const NO_ISSUES: FrameIssue[] = [];
/** Một dòng trong nhóm Hiển thị (nhóm chia cố định 2 dòng; hẹp quá thì dòng tự xuống tiếp). */
const DISPLAY_LINE: React.CSSProperties = { flexBasis: '100%', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center' };
const REF_MODE_TEXT: Record<RefMode, string> = { bottom: 'mặt dưới box', road: 'mặt đường', custom: 'Custom', mirror: 'gương tự dò', pw: 'Patchwork++' };
const PLANE_TEXT: Record<PlaneSource, string> = { bottom: 'mặt dưới box', road: 'mặt đường đo được', ego: 'z = 0 của ego (chưa đo được mặt đường)', custom: 'tự chỉnh', mirror: 'gương tự dò từ ảnh phản chiếu', pw: 'mặt đường Patchwork++' };
const NO_MARKS: GroundSector[] = [];

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

export interface NearbyCfg { on: boolean; max: number; mode: 'auto' | 'pick'; ids: number[] }
const NB_DEFAULT: NearbyCfg = { on: false, max: 5, mode: 'auto', ids: [] };
const NB_NONE = { cand: [] as { num: number; d: number }[], cfg: NB_DEFAULT };

function Column({ nbrZ, midSparse, onIgnoreP, pIgnored, kind, onKind, showAll, advise, onAdvice, pwShow = false, groundOv, groundOn, egoOn, suggestOn, f, size, st, refCub, half, locHalf, selected, edited, warn, fixed, ignored, autoSnap, onSnap, onGround, motion, motionIgnored, onIgnoreMotion, onIgnore, onFit, onSuggest, onAccept, onSelect, onLoaded, onCommit, onZoom, onToggleKf, onToggleOutside, onHover, scene, overlap, overlayCubs, overlayNums, nbCount, nearby, onNearby, onCommitOther, onSyncGroundAll, ignoredOverlap, onRestoreOverlap, onIgnoreOverlap, onOpenObject, qcOn, qcNote, onQcNote, tiltOn, issues, issueIgnored, onIgnoreIssue, fileFlags, onMarkFlag, onFocusFrame, pan, onPan, refl = null, onBelow, onRefPlane, horizontal = false, hideGroundPick = false }: {
  hideGroundPick?: boolean; // tab Ref: ẩn ô chọn mặt đường (có ô riêng)
  horizontal?: boolean; // 3 view Trên | Bên | Trước xếp ngang (tab Ref, hoặc bố cục frame dọc): 3 view Trên | Bên | Trước xếp ngang
  pwShow?: boolean; // hiện mặt đường Patchwork++ gợi ý (vạch tím) ở view Bên / Trước
  kind: GroundKind; onKind: (f: number, k: GroundKind) => void; // nguồn mặt đường của RIÊNG frame này (đổi ở frame khác không đụng tới)
  showAll: boolean; // hiện cả 3 mặt đường để so sánh (snap / lock vẫn chỉ dùng nguồn đã chọn)
  advise: boolean; onAdvice: (f: number, a: GroundAdvice | null) => void; // hệ thống gợi ý chọn mặt đường
  onRefPlane?: (f: number, d: number | null) => void; // tab Ref: mặt phản chiếu cao hơn đáy box bao nhiêu (m)
  refl?: RefState | null; // tab Ref: vẽ box ảo, mặt phản chiếu và điểm lấy đối xứng
  onBelow?: (f: number, n: number) => void; // số điểm dưới mặt đường trong chân box (để gợi ý bật ref)
  onFocusFrame: (f: number) => void;
  pan: Pan; onPan: (p: Pan) => void;
  fileFlags: FileFlag[]; onMarkFlag: (f: number, kind: IssueKind, mark: FlagMark | null) => void;
  tiltOn: boolean;
  midSparse: boolean; // frame ít điểm nằm giữa hai frame ổn (box nội suy): vẫn báo P nhưng ghi chú và cho bỏ qua
  pIgnored: boolean; onIgnoreP: (f: number, on: boolean) => void; // bỏ qua / hoàn lại cảnh báo ít điểm (P) của frame này
  issues: FrameIssue[]; issueIgnored: (kind: string) => boolean; onIgnoreIssue: (f: number, kind: string, on: boolean) => void;
  qcOn: boolean; qcNote: string; onQcNote: (f: number, text: string) => void;
  overlap: { other: number; ratio: number }[]; overlayCubs: Cuboid[]; overlayNums: number[]; nbCount: number; nearby: { cand: { num: number; d: number }[]; cfg: NearbyCfg }; onNearby: (f: number, c: NearbyCfg) => void; onCommitOther: (num: number, f: number, c: Cuboid, allAfter?: boolean, back?: boolean) => void; onSyncGroundAll: (other: number, f: number, back?: boolean) => void; ignoredOverlap: number[]; onRestoreOverlap: (other: number) => void; onIgnoreOverlap: (other: number) => void; onOpenObject: (other: number) => void;
  onToggleOutside: (f: number) => void; onHover: (f: number | null) => void; scene: Scene;
  motion: MotionWarning | null; motionIgnored: boolean; onIgnoreMotion: (f: number, on: boolean) => void;
  autoSnap: boolean; onSnap: (f: number, g: GroundResult | null) => void; onGround: (f: number) => void;
  suggestOn: boolean; // công tắc gợi ý sửa box (kích thước / vị trí) khi lệch
  groundOv: GroundResult | null; egoOn: boolean; groundOn: boolean; // egoOn: công tắc hiện mặt đường ego (Oxy); mặt đường đã tinh chỉnh theo các frame khác của object (BatchReview tính); groundOn: công tắc dò mặt đất
  ignored: boolean; onIgnore: (f: number, on: boolean) => void;
  fixed: boolean; onSuggest: (f: number, s: Suggestion | null) => void; onAccept: (f: number, s: Suggestion) => void;
  warn: boolean; onFit: (f: number, r: FitReport | null) => void;
  onToggleKf: (f: number) => void;
  nbrZ: number | null; // độ cao thế giới của mặt đường theo đáy box ID nhỏ trong 5 m ở frame này (null: không có box nào)
  f: number; size: number; st: FrameState; refCub: Cuboid | null; half: number; locHalf: number; selected: boolean; edited: boolean;
  onSelect: () => void; onLoaded: (f: number) => void; onCommit: (f: number, c: Cuboid, all?: 'rot' | 'move' | 'size', lb?: LocalBox, back?: boolean) => void; onZoom: (factor: number) => void;
}) {
  useSymbols(); // ký hiệu lỗi đổi thì vẽ lại
  useColors(); // màu viền frame đổi (tab Màu sắc) thì vẽ lại
  const hint = useKeyHint();
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
  const loc = useMemo(() => (pc && refCub ? localize(pc, refCub, locHalf, f, DEFAULT_GROUND.pw >= 4 || pwShow || advise) : null), [pc, refCub, locHalf, f, pwShow, advise]);
  // Khung nhìn căn theo box: box nghiêng thì điểm, box gợi ý, vật khác... đều quay sang khung riêng của box để mọi view thấy box thẳng.
  const M = useMemo(() => (st.cuboid ? viewFrame(st.cuboid) : null), [st.cuboid]);
  const locView = useMemo(() => (loc && M ? rotateLocal(loc, M) : loc), [loc, M]);
  // Mặt phẳng Oxy của ego (z = 0 thế giới) trong hệ của khung nhìn, tính theo z của box ở đúng frame này.
  const egoPlane = useMemo<EgoPlane | null>(
    () => (egoOn && st.cuboid ? (M ? [M[2], M[5], M[8], -st.cuboid.z] : [0, 0, 1, -st.cuboid.z]) : null),
    [egoOn, st.cuboid, M],
  );
  // Mặt đường Patchwork++ gợi ý: mặt phẳng fit từ các điểm mặt đất quanh box (gộp cả frame lân cận), + G.pwLift; viết trong hệ của khung nhìn.
  const pwPlane = useMemo<EgoPlane | null>(() => {
    if (!pwShow || !loc || !st.cuboid) return null;
    const pl = pwGroundPlane(loc, st.cuboid.sx, st.cuboid.sy);
    if (!pl) return null;
    const n = M ? apply(M, [-pl.a, -pl.b, 1]) : [-pl.a, -pl.b, 1];
    return [n[0]!, n[1]!, n[2]!, pl.c + DEFAULT_GROUND.pwLift];
  }, [pwShow, loc, st.cuboid, M]);
  const nbrPlane = useMemo<EgoPlane | null>(() => {
    if (nbrZ === null || !st.cuboid || !(kind === 'nbr' || showAll)) return null;
    return M ? [M[2], M[5], M[8], nbrZ - st.cuboid.z] : [0, 0, 1, nbrZ - st.cuboid.z];
  }, [nbrZ, kind, showAll, st.cuboid, M]);
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
  const bad = fit && fit.level !== 'ok' && !(ignored && fit.level === 'misfit') && !(pIgnored && fit.level === 'sparse') ? fit : null;
  useEffect(() => { onFit(f, bad); }, [f, bad]);
  // Ground snap: ước lượng mặt đường dưới chân box.
  const snap = groundOn ? groundOv : null;
  // Snap / lock dùng đúng nguồn mặt đường đã chọn ở frame này.
  const lockKind: GroundKind | null = kind;
  const snapSel = useMemo<GroundResult | null>(() => {
    const c = st.cuboid;
    if (!lockKind || !c) return null;
    if (lockKind === 'measured') return groundOv;
    if (lockKind === 'ego') return egoGround(c.z, c.sz);
    if (lockKind === 'nbr') return nbrZ === null ? null : levelGround(nbrZ, c.z, c.sz);
    return loc ? groundSnapBy('pw', loc, c.sx, c.sy, c.sz, { cu: 0, cv: 0, cw: 0, range: Math.hypot(c.x, c.y) }, c.z) : null;
  }, [lockKind, groundOv, loc, st.cuboid, nbrZ]);
  useEffect(() => { onSnap(f, snapSel); }, [f, snapSel]);
  // Gợi ý nguồn mặt đường: tính cả 3 nguồn cho frame này rồi chọn theo thứ tự đo riêng → Patchwork++ → ego z=0 (groundSuggest.ts).
  const advice = useMemo<GroundAdvice | null>(() => {
    const c = st.cuboid;
    if (!advise || !c || (!loc && nbrZ === null)) return null;
    const at = { cu: 0, cv: 0, cw: 0, range: Math.hypot(c.x, c.y) };
    const nb = nbrZ === null ? null : levelGround(nbrZ, c.z, c.sz);
    if (!loc) return adviseGround({ nbr: nb, ego: egoGround(c.z, c.sz) }, DEFAULT_GROUND.pwAgree);
    return adviseGround({ nbr: nb, measured: groundSnapBy('measured', loc, c.sx, c.sy, c.sz, at, c.z), pw: groundSnapBy('pw', loc, c.sx, c.sy, c.sz, at, c.z), ego: egoGround(c.z, c.sz) }, DEFAULT_GROUND.pwAgree);
  }, [advise, loc, st.cuboid, nbrZ]);
  useEffect(() => { onAdvice(f, advice); }, [f, advice]);
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
  // Ref mode: mặt đường dưới object (đo được ở bước đếm điểm / Ground snap; tab Ref đo thêm nếu chưa có), z = 0 của ego, rồi mặt phản chiếu.
  const ptsView = M ? locView : loc;
  const egoW = st.cuboid ? -st.cuboid.z : null;
  const roadW = useMemo(() => {
    const known = fitGround?.c ?? groundOv?.groundW ?? null;
    if (known !== null || !refl || refl.mode !== 'road' || !loc || !st.cuboid) return known;
    return groundSnap(loc, st.cuboid.sx, st.cuboid.sy, st.cuboid.sz, { cu: 0, cv: 0, cw: 0, range: Math.hypot(st.cuboid.x, st.cuboid.y) })?.groundW ?? null;
  }, [fitGround, groundOv, refl?.mode, loc, st.cuboid]);
  // Mặt gương tự dò (điểm phản chiếu lật lại khớp hình vật nhất) — vừa là một lựa chọn mặt phản chiếu, vừa để chấm mức khớp của mặt đang dùng.
  const mirrorFit = useMemo(() => (refl && loc && st.cuboid ? reflectionPlane(loc, st.cuboid.sx, st.cuboid.sy, st.cuboid.sz) : null), [!!refl, loc, st.cuboid]);
  const pwRefW = useMemo(() => {
    if (!refl || refl.mode !== 'pw' || !loc || !st.cuboid) return null;
    const pl = pwGroundPlane(loc, st.cuboid.sx, st.cuboid.sy);
    return pl ? pl.c + DEFAULT_GROUND.pwLift : null;
  }, [refl?.mode, loc, st.cuboid]);
  const plane = refl && box ? refPlane(box, refl, roadW, egoW, { mirrorW: mirrorFit?.valid ? mirrorFit.h : null, pwW: pwRefW }) : null;
  const reflect = useMemo(() => (plane && box && ptsView ? { pts: mirroredPoints(ptsView, box, plane.w), plane: plane.w } : null), [plane?.w, box, ptsView]);
  const below = useMemo(() => (onBelow && !refl && ptsView && st.cuboid ? pointsBelow(ptsView, identityBox(st.cuboid), roadW, egoW) : 0), [!!onBelow, refl, ptsView, st.cuboid, roadW, egoW, thrVer]);
  useEffect(() => { onBelow?.(f, below); }, [f, below]);
  useEffect(() => { onRefPlane?.(f, plane && box ? plane.w - (box.cw - box.sz / 2) : null); }, [f, plane?.w, box?.cw, box?.sz]);
  const [ovPrev, setOvPrev] = useState<{ i: number; box: LocalBox } | null>(null); // box chồng lấn đang được kéo (xem trước ở cả 3 view)
  const overlays = useMemo(() => {
    const o = refCub ? overlayCubs.map((x, i) => { const b = boxV(localBoxOf(refCub, x)); return i >= overlayCubs.length - nbCount ? { ...b, color: '#2f9bff' } : b; }) : [];
    if (ovPrev && o[ovPrev.i]) o[ovPrev.i] = { ...ovPrev.box, color: o[ovPrev.i]!.color };
    return plane && box ? [...o, { ...mirrorBox(box, plane.w), color: REF_COLOR }] : o;
  }, [refCub, overlayCubs, nbCount, M, ovPrev, plane?.w, plane ? box : null]);
  /** Ghi vị trí mới của box chồng lấn: dời tâm theo độ dời trong hệ khung nhìn (đã quy về hệ yaw của box đang xét), giữ nguyên cỡ / góc của nó. */
  const commitOther = (i: number, delta: [number, number, number], dyaw = 0, all = false, back = false) => {
    const other = overlayCubs[i], num = overlayNums[i];
    if (!refCub || !other || num === undefined) return;
    const [du, dv, dw] = M ? apply(transpose(M), delta) : delta;
    const cos = Math.cos(refCub.yaw), sin = Math.sin(refCub.yaw);
    onCommitOther(num, f, { ...other, x: other.x + du * cos - dv * sin, y: other.y + du * sin + dv * cos, z: other.z + dw, yaw: other.yaw + dyaw }, all && dyaw !== 0, back);
  }; // ref tắt: không phụ thuộc box (box tạo mới mỗi lần vẽ)
  /** Bấm đúp vào box xung quanh (đang hiện ID): dời box đang xét theo z để đáy trùng đáy box đó (cùng mặt đường). */
  const syncGround = (i: number, all = false, back = false) => {
    const o = overlayCubs[i], n = overlayNums[i], c = st.cuboid;
    if (!o || n === undefined || !c) return;
    if (all) { onSyncGroundAll(n, f, back); return; } // Ctrl: cả các frame phía sau; Ctrl+Shift: các frame phía trước
    const dz = (o.z - o.sz / 2) - (c.z - c.sz / 2);
    if (Math.abs(dz) < 1e-4) return;
    onCommit(f, { ...c, z: c.z + dz });
  };
  const color = statusColor(st.status);
  return (
    <div
      onClick={onSelect}
      // Phím khoá KF / outside / ground snap / chấp nhận / bỏ qua gợi ý tác dụng lên cột đang trỏ chuột; viền xanh cho biết cột nào sẽ nhận phím.
      onMouseEnter={(e) => { onHover(f); e.currentTarget.style.boxShadow = '0 0 0 3px #2563eb'; }}
      onMouseLeave={(e) => { onHover(null); e.currentTarget.style.boxShadow = ''; }}
      style={{ border: `3px solid ${color}`, outline: selected ? '2px solid #111' : 'none', width: horizontal ? size * 3 + 2 * VIEW_GAP : size, flex: 'none' }}
    >
      <div style={{ background: color, color: '#fff', padding: '1px 4px', fontSize: Math.max(11, Math.min(14, size / 14)), display: 'flex', alignItems: 'center', gap: 4 }}>
        <span style={{ flex: 1, minWidth: 0, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={`frame ${f} · ${STATUS_TEXT[st.status]} · bấm đúp: thu nhỏ tool và đưa camera 3D của CVAT tới object ở frame này`} onDoubleClick={() => onFocusFrame(f)}>
        {bad || shownMotion || overlap.length ? '⚠ ' : ''}frame {f} · {STATUS_TEXT[st.status]}{edited ? ' · ✎' : ''}{qcNote ? ' · 📝' : ''}{st.cuboid ? ` · yaw ${yawVsEgoDeg(st.cuboid.yaw).toFixed(1)}°` : ''}{st.cuboid && (st.cuboid.rx !== 0 || st.cuboid.ry !== 0) ? ` · ∠${(st.cuboid.rx * 57.2958).toFixed(1)}°/${(st.cuboid.ry * 57.2958).toFixed(1)}°` : ''}
        </span>
        <span style={{ flex: 'none', display: 'flex', gap: 2 }}>
          {st.cuboid && (
            <button
              title={hint('kf.toggle', st.status === 'key' ? 'Keyframe (khoá). Bấm để mở khoá (về nội suy)' : 'Chưa là keyframe. Bấm để khoá thành keyframe')}
              onClick={(e) => { e.stopPropagation(); onToggleKf(f); }}
              style={{ padding: '0 3px', lineHeight: 1.1 }}
            >{st.status === 'key' ? '🔒' : '🔓'}</button>
          )}
          {(st.cuboid || st.status === 'outside' || st.status === 'outside-key') && (
            <button
              title={hint('outside.from', st.cuboid ? 'Gắn keyframe outside từ frame này (phím tắt: khi trỏ chuột vào cột)' : 'Đưa object trở lại từ frame này (phím tắt: khi trỏ chuột vào cột)')}
              onClick={(e) => { e.stopPropagation(); onToggleOutside(f); }}
              style={{ padding: '0 3px', lineHeight: 1.1 }}
            >{st.cuboid ? '⛔' : '↩'}</button>
          )}
        </span>
      </div>
      {/* Kích thước box ở frame này (dài × rộng × cao, m): dòng riêng cao cố định ngay dưới tiêu đề, không đè lên point cloud; đang kéo thì hiện
          kích thước mới. Frame không có box vẫn giữ dòng trống để các cột thẳng hàng. */}
      <div
        style={{ height: 16, lineHeight: '16px', fontSize: 11, padding: '0 4px', background: '#eef2f7', color: '#222', whiteSpace: 'nowrap', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 4, fontVariantNumeric: 'tabular-nums' }}
        title={box ? `Dài × rộng × cao của box ở frame ${f} (m)` : undefined}
      >
        <span style={{ flex: '1 0 auto', whiteSpace: 'nowrap' }}>{box ? <>L×W×H <b>{box.sx.toFixed(2)} × {box.sy.toFixed(2)} × {box.sz.toFixed(2)}</b> m</> : ''}</span>
        {!hideGroundPick && <GroundPick kind={kind} onChange={(k) => onKind(f, k)} title={`Mặt đường của RIÊNG frame ${f} (đổi ở frame khác không ảnh hưởng frame này). Ground snap / lock dùng mặt đường này.`} />}
      </div>
      {/* Lỗi & gợi ý ở ĐẦU cột, dạng chip một dòng, vùng cao cố định nên các cột không bao giờ lệch hàng; chi tiết ở dưới các view. */}
      <div style={{ height: 40, overflow: 'hidden', display: 'flex', flexWrap: 'wrap', alignContent: 'flex-start', gap: 2, padding: '2px 2px 0', background: '#fafafa' }}>
        {sug && (
          <span style={{ ...CHIP, background: '#c9f3ff', color: '#00505c' }} title={sug.message}>
            💡 gợi ý
            <button onClick={(e) => { e.stopPropagation(); onAccept(f, sug); }} style={CHIP_BTN} title={hint('suggest.accept', 'Chấp nhận box gợi ý')}>✔</button>
            <button onClick={(e) => { e.stopPropagation(); onIgnore(f, true); }} style={CHIP_BTN} title={hint('suggest.ignore', 'Bỏ qua gợi ý')}>✖</button>
          </span>
        )}
        {bad && !sug && <span style={{ ...CHIP, background: '#ffe0f7', color: '#5a0040' }} title={bad.level === 'sparse' ? `${bad.message}${midSparse ? ' · nằm giữa hai frame ổn (box nội suy)' : ''} · chuột phải để bỏ qua` : bad.message} onContextMenu={bad.level === 'sparse' ? (e) => { e.preventDefault(); e.stopPropagation(); onIgnoreP(f, true); } : undefined}>⚠ {bad.level === 'misfit' ? 'lệch' : 'ít điểm'}</span>}
        {bad && sug && <span style={{ ...CHIP, background: '#ffe0f7', color: '#5a0040' }} title={bad.message}>⚠ lệch</span>}
        {issues.filter((i) => !issueIgnored(i.kind)).map((i) => <span key={i.kind} style={{ ...CHIP, background: '#f9d4ee', color: '#5a0040' }} title={i.message}>⚠ {symLabel(i.kind)}</span>)}
        {ignoredOverlap.map((o) => <span key={`ig${o}`} style={{ ...CHIP, background: '#e5e7eb', color: '#4b5563' }} title={`Cặp chồng lấn với #${o} ở frame này đã được bỏ qua (không báo lỗi). Hoàn lại ở dòng ghi chú bên dưới cột.`}>⊘ O #{o} bỏ qua</span>)}
        {overlap.map((o) => <span key={o.other} style={{ ...CHIP, background: '#ffd9a8', color: '#5a2d00' }} title={`Chồng với #${o.other} (IoU ${fmtIou(o.ratio)}). Kéo box cam nét đứt trong view để dời object #${o.other} ở frame này (giữ Shift để kéo ở vùng chồng lên box đang xét).`}>⚠ O #{o.other}</span>)}
        {fileFlags.filter((ff) => ff.state === 'open').map((ff) => <span key={ff.kind} style={{ ...CHIP, background: '#ffd6d6', color: '#600' }} title="Flag từ file QC mà tool không tự phát hiện">QC {ff.kind}</span>)}
        {shownMotion && <span style={{ ...CHIP, background: '#ffe9c7', color: '#6b3a00' }} title={shownMotion.message}>⚠ {sym('M')} {shownMotion.vertical && !shownMotion.horizontal ? 'đổi độ cao' : 'đi xa'}</span>}
        {kind === 'measured' && snap?.warn && <span style={{ ...CHIP, background: '#eaf6d8', color: '#2d5a00' }} title={groundTip(snap)}>⏬ {groundAction(snap)}</span>}
        {advice && (advice.kind !== kind || advice.conflict) && (
          <span style={{ ...CHIP, background: advice.conflict ? '#fff0c2' : '#e6f0ff', color: '#233' }} title={advice.detail}>
            💡 mặt đường: {GROUND_OPT[advice.kind]}{advice.conflict ? ' ⚠' : ''}
            {advice.kind !== kind && <button onClick={(e) => { e.stopPropagation(); onKind(f, advice.kind); }} style={CHIP_BTN} title="Dùng mặt đường gợi ý cho frame này">✔</button>}
          </span>
        )}
      </div>
      <div style={{ position: 'relative', ...(horizontal ? { display: 'flex', gap: VIEW_GAP } : null) }}>
      {VIEWS.map((v) => (
        <Cell key={v} nbrPlane={nbrPlane} nbrZ={nbrZ} reflect={reflect} pwPlane={pwPlane} frame={M} egoPlane={egoPlane} scene={scene} overlays={overlays} tiltOn={tiltOn} mark={mark} ground={M ? null : snap?.groundW ?? null} groundMarks={M ? NO_MARKS : snap?.marks ?? NO_MARKS} contactW={M ? null : snap?.contactW ?? null} autoSnap={autoSnap && lockKind !== null} lockKind={lockKind} ghost={boxV(sug?.box ?? null)} misfit={bad?.level === 'misfit'} view={v} size={size} loc={M ? locView : loc} st={st} half={half} box={box} onPreview={setPreview} onCommit={(c, all, lb, back) => onCommit(f, c, all, lb, back)} onZoom={onZoom} pan={pan} onPan={onPan} ovCount={overlayCubs.length} ovNums={overlayNums} onPreviewOther={(i, b) => setOvPrev(b ? { i, box: b } : null)} onCommitOther={commitOther} onSyncGround={syncGround} />
      ))}
      </div>
      {reflect && plane && (
        <div style={{ fontSize: 11, padding: '1px 4px', background: '#f3e8ff', color: '#4c1d95' }} title="Điểm trong box ảo (tím nét đứt) được lật qua mặt phản chiếu (vạch tím) và vẽ chồng lên box chính bằng màu tím">
          ref: {reflect.pts?.n ?? 0} điểm gộp{mirrorFit && mirrorFit.best > 0 ? ` · khớp hình ${Math.round((100 * mirrorFit.scoreAt(plane.w)) / mirrorFit.best)}% mức tốt nhất${mirrorFit.valid ? '' : ' (ít điểm phản chiếu)'}` : ''} · mặt phản chiếu: {PLANE_TEXT[plane.src]} ({plane.w >= (box ? box.cw - box.sz / 2 : 0) ? '+' : ''}{((plane.w - (box ? box.cw - box.sz / 2 : 0)) * 100).toFixed(0)} cm so với đáy box)
        </div>
      )}
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
              <button onClick={(e) => { e.stopPropagation(); onAccept(f, sug); }} style={{ padding: '0 4px' }} title={hint('suggest.accept', 'Chấp nhận box gợi ý ở frame này')}>✔ nhận</button>{' '}
              <button onClick={(e) => { e.stopPropagation(); onIgnore(f, true); }} style={{ padding: '0 4px' }} title={hint('suggest.ignore', 'Bỏ qua gợi ý ở frame này')}>✖ bỏ qua</button>
            </div>
          )}
        </div>
      )}
      {pIgnored && fit?.level === 'sparse' && (
        <div style={{ background: '#eee', color: '#555', fontSize: 11, padding: '1px 4px' }}>
          đã bỏ qua ít điểm{' '}
          <button onClick={(e) => { e.stopPropagation(); onIgnoreP(f, false); }} style={{ padding: '0 4px' }}>hoàn lại</button>
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
      {nearby.cand.length > 0 && (
        <div style={{ background: '#e3f0ff', color: '#0b3a6b', fontSize: 11, padding: '1px 4px' }} onClick={(e) => e.stopPropagation()} title="Hiện thêm box của các ID xung quanh (xanh dương nét đứt) trong frame này. Chỉ áp cho frame này. Phím tắt: C.">
          <label><input type="checkbox" checked={nearby.cfg.on} onChange={(e) => onNearby(f, { ...nearby.cfg, on: e.target.checked })} /> ID xung quanh</label>
          {nearby.cfg.on && (
            <>
              {' '}tối đa <input type="number" min={1} max={30} value={nearby.cfg.max} onChange={(e) => onNearby(f, { ...nearby.cfg, max: Math.max(1, Math.min(30, Math.round(Number(e.target.value)) || 1)) })} style={{ width: 38, fontSize: 11 }} />
              <div style={{ paddingLeft: 14 }}>
                <label><input type="radio" checked={nearby.cfg.mode === 'auto'} onChange={() => onNearby(f, { ...nearby.cfg, mode: 'auto' })} /> ổn (gần nhất)</label>{' '}
                <label><input type="radio" checked={nearby.cfg.mode === 'pick'} onChange={() => onNearby(f, { ...nearby.cfg, mode: 'pick' })} /> chọn ID</label>
                {nearby.cfg.mode === 'pick' && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0 8px', maxHeight: 70, overflowY: 'auto' }}>
                    {nearby.cand.map((c) => (
                      <label key={c.num} title={`cách ${c.d.toFixed(1)} m`}><input type="checkbox" checked={nearby.cfg.ids.includes(c.num)} onChange={(e) => onNearby(f, { ...nearby.cfg, ids: e.target.checked ? [...nearby.cfg.ids, c.num] : nearby.cfg.ids.filter((x) => x !== c.num) })} />#{c.num}</label>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      )}
      {ignoredOverlap.map((o) => (
        <div key={`ig${o}`} style={{ background: '#e5e7eb', color: '#4b5563', fontSize: 11, padding: '1px 4px' }} title="Cặp này đã được bỏ qua ở mọi frame nên không báo lỗi O; ghi chú này cho biết ở frame này hai object vẫn đang chồng nhau.">
          ⊘ đã bỏ qua cặp chồng lấn với <button onClick={(e) => { e.stopPropagation(); onOpenObject(o); }} style={{ padding: '0 4px' }}>#{o}</button>{' '}
          <button onClick={(e) => { e.stopPropagation(); onRestoreOverlap(o); }} style={{ padding: '0 4px' }} title="Báo lại lỗi chồng lấn của cặp này ở mọi frame">↺ hoàn lại</button>
        </div>
      ))}
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
            đã bỏ qua {symLabel(i.kind)}{' '}<button onClick={(e) => { e.stopPropagation(); onIgnoreIssue(f, i.kind, false); }} style={{ padding: '0 4px' }}>hoàn lại</button>
          </div>
        ) : (
          <div key={i.kind} style={{ background: '#f9d4ee', color: '#5a0040', fontSize: 11, padding: '1px 4px' }} title={i.message}>
            ⚠ <b>{symLabel(i.kind)}</b> {i.message}{' '}
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
          <button onClick={(e) => { e.stopPropagation(); onGround(f); }} style={{ padding: '0 4px' }} title={hint('ground.snap', 'Dời box theo z để đáy chạm mặt đường')}>snap</button>
        </div>
      )}
    </div>
  );
}

/** Tab Ref: kéo cạnh phải (chia 3 vì 3 ô xếp ngang), cạnh dưới hoặc góc của một hàng để đổi cỡ ô; mọi hàng dùng chung cỡ. Thả chuột thì lưu. */
function EdgeResize({ size, onResize, children }: { size: number; onResize: (size: number, save: boolean) => void; children: ReactNode }) {
  const drag = useRef<{ x: number; y: number; s: number; mode: 'x' | 'y' | 'xy' } | null>(null);
  const next = (e: React.PointerEvent) => {
    const d = drag.current!;
    const dx = (e.clientX - d.x) / 3, dy = e.clientY - d.y;
    return d.s + (d.mode === 'x' ? dx : d.mode === 'y' ? dy : Math.max(dx, dy));
  };
  const grip = (mode: 'x' | 'y' | 'xy', style: React.CSSProperties) => (
    <div
      title="Kéo để đổi cỡ ô: tỉ lệ giữ nguyên nên ô to hơn thì thấy rộng hơn quanh object"
      onPointerDown={(e) => { if (e.button !== 0) return; e.stopPropagation(); e.currentTarget.setPointerCapture(e.pointerId); drag.current = { x: e.clientX, y: e.clientY, s: size, mode }; }}
      onPointerMove={(e) => { if (drag.current) onResize(next(e), false); }}
      onPointerUp={(e) => { if (drag.current) { onResize(next(e), true); drag.current = null; } }}
      onClick={(e) => e.stopPropagation()}
      style={{ position: 'absolute', zIndex: 3, touchAction: 'none', background: 'rgba(192, 132, 252, .35)', borderRadius: 3, cursor: mode === 'x' ? 'ew-resize' : mode === 'y' ? 'ns-resize' : 'nwse-resize', ...style }}
    />
  );
  return (
    <div style={{ position: 'relative', display: 'inline-block' }}>
      {children}
      {grip('x', { top: 0, right: -9, width: 7, height: '100%' })}
      {grip('y', { left: 0, bottom: -9, height: 7, width: '100%' })}
      {grip('xy', { right: -11, bottom: -11, width: 11, height: 11 })}
    </div>
  );
}

/** Object đang / vừa xem trong Batch Review và frame đầu cửa sổ lúc đó (nút ↶), giữ qua lúc rời tab. */
interface ObjPos { num: number; at: number }
let objMem: { job: number; here: ObjPos; back: ObjPos | null } | null = null;

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
  const grip = useContext(GripCtx);
  const pop = useContext(PopCtx);
  return (
    // cao 100% ô của bố cục (hàng đặt chiều cao cố định thì nội dung dài cuộn trong nhóm)
    <fieldset className="cvla-group" style={{ border: '1px solid #c5ccd6', margin: 0, minWidth: 0, height: '100%', boxSizing: 'border-box', overflow: 'auto', padding: '1px 8px 4px', display: 'flex', flexWrap: 'wrap', gap: '4px 10px', alignItems: 'center', alignContent: 'flex-start', background: bg }}>
      <legend style={{ fontSize: 11, fontWeight: 700, color: '#456', padding: '0 4px' }}>
        {grip?.(id)}
        {pop?.(id)}
        <span role="button" tabIndex={0} onClick={toggle} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') toggle(); }} style={{ cursor: 'pointer', userSelect: 'none' }} title={shut ? 'Mở rộng' : 'Thu nhỏ'}>{shut ? '▸' : '▾'} </span>
        {title}
      </legend>
      {!shut && children}
    </fieldset>
  );
}

export function BatchReview({ drift, midOut, onSplit, onFocusFrame, job, ann, rows, selectedNum, setSelectedNum, initialFrame, edited, onEdit, onTrack, focus, onView, onSel, onHoverFrame, labels, overlaps, ignoredOverlaps, refView = false, onOpenRef, onCloseRef, openAt = null }: {
  openAt?: number | null; // mở từ bảng object: cửa sổ bắt đầu đúng ở frame này (frame đầu của object), không nhảy theo frame CVAT lúc vừa mở
  refView?: boolean; // tab Ref: một frame (initialFrame), hai cột Gốc / Gộp đối xứng
  onOpenRef?: (frame?: number) => void; onCloseRef?: () => void;
  overlaps: OverlapItem[]; // chồng lấn của cả job (đã bỏ cặp được bỏ qua)
  ignoredOverlaps: OverlapItem[]; // các chồng lấn thuộc cặp ĐÃ bỏ qua: không báo lỗi nhưng vẫn ghi chú ở frame đó (và cho hoàn lại)
  onSplit: (trackIndex: number, resume: number) => number | null; // tách ID tại frame resume; trả số thứ tự object mới, null nếu không tách được
  onHoverFrame: (f: number | null) => void;
  onFocusFrame: (f: number) => void; // bấm đúp vào cột frame
  drift: Map<number, { f: number; dist: number }[]>; // trôi box theo số thứ tự object
  midOut: Map<number, number[]>; // outside ở giữa (frame ít điểm nằm giữa hai frame không ít điểm) theo số thứ tự object
  labels: CvatLabel[];
  onSel: (frame: number | null) => void;
  onView: (frames: number[]) => void;
  focus: { frame: number; nonce: number } | null;
  onTrack: (trackIndex: number, track: CvatTrack, frames: number[]) => void;
  job: CvatJob; ann: CvatAnnotations; rows: ObjectRow[]; selectedNum: number | null; setSelectedNum: (n: number) => void;
  initialFrame: number; edited: Set<string>; onEdit: (trackIndex: number, frame: number, c: Cuboid, sizeAll?: boolean) => void;
}) {
  const { start_frame: start, stop_frame: stop } = job;
  const hint = useKeyHint();
  const keyOf = useKeyOf();
  // Chuột phải vào nút có phím tắt: menu gán / gỡ phím (cùng dữ liệu với tab Phím tắt)
  const brRoot = useRef<HTMLDivElement>(null);
  const [bindMenu, setBindMenu] = useState<{ id: string; x: number; y: number } | null>(null);
  const [prefs, setPrefs] = useState(() => loadPrefs());
  const [showCmp, setShowCmp] = useState(false);
  const thrVer = useThresholdVersion(); // ngưỡng cảnh báo chỉnh tay (tab Threshold) đổi thì tính lại cảnh báo
  const max = ann.tracks.length;
  const num = selectedNum ?? 1;
  const track = ann.tracks[num - 1] ?? null;
  // Danh sách frame cần xem: cả job hoặc khoảng [từ, đến] tự chọn; tùy chọn chỉ giữ keyframe của object đang chọn.
  const [viewFrom, setViewFrom] = useState(() => (openAt !== null && openAt > start && openAt <= stop ? String(openAt) : ''));
  const viewTo = ''; // khoảng xem luôn chạy tới hết job; cửa sổ [a, b] chọn bằng hai ô a → b (a bắt đầu cửa sổ, b - a + 1 = số frame)
  const forceFirst = useRef(false); // vừa nhập điểm xuất phát a / vừa sửa ô Object ID: về trang đầu
  const pendingAt = useRef<number | null>(null); // nút ↶: đổi object rồi về cửa sổ chứa frame này
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
  // Nguồn mặt đường theo TỪNG frame của object (nhớ cục bộ, mỗi frame đúng 1 nguồn): frame chưa chọn riêng thì theo dropdown chung ở nhóm Gợi ý & mặt đất. Đổi ở một frame
  // chỉ ghi frame đó, không đụng vạch / cảnh báo / snap của frame khác.
  const gSelKey = `cvla-gsrc:${job.id}:${num}`;
  const [frameKind, setFrameKindState] = useState<Record<number, GroundKind>>(() => loadFrameSel(gSelKey));
  useEffect(() => { setFrameKindState(loadFrameSel(gSelKey)); }, [gSelKey]);
  const kindOf = (f: number): GroundKind => frameKind[f] ?? prefs.gkind;
  const saveKinds = (next: Record<number, GroundKind>) => {
    setFrameKindState(next);
    try { kv.set(gSelKey, JSON.stringify(next)); } catch { /* bỏ qua */ }
  };
  const setFrameKind = (f: number, k: GroundKind) => saveKinds({ ...frameKind, [f]: k });
  const anyMeasured = prefs.gkind === 'measured' || prefs.gshowAll || Object.values(frameKind).includes('measured');
  const anyPw = prefs.gkind === 'pw' || prefs.gshowAll || prefs.gadvise || Object.values(frameKind).includes('pw');
  useEffect(() => { setSegForced(anyPw); }, [anyPw]);
  const [advs, setAdvs] = useState<Map<number, GroundAdvice | null>>(new Map());
  const [autoSnap, setAutoSnapState] = useState(() => { try { return kv.get('cvla-autosnap') === '1'; } catch { return false; } });
  const setAutoSnap = (v: boolean) => { setAutoSnapState(v); try { kv.set('cvla-autosnap', v ? '1' : '0'); } catch { /* bỏ qua */ } };
  const [rangeFrom, setRangeFrom] = useState('');
  const [rangeTo, setRangeTo] = useState('');
  const vp = useViewport();
  const [camShow] = useCameraShow();
  useSymbols();
  const colors = useColors();
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
  const commit = (f: number, cub: Cuboid, all?: 'rot' | 'move' | 'size', lb?: LocalBox, back = false) => {
    const cur = track ? stateAt(track, f).cuboid : null;
    const lo = back ? -Infinity : f + 1, hi = back ? f - 1 : Infinity; // Ctrl: các frame phía sau; Ctrl+Shift: các frame phía trước
    if (all === 'size' && track && lb && cur) {
      // Ctrl+kéo cạnh / góc: frame này đặt đúng box vừa kéo; mọi keyframe có box phía sau đổi cùng kích thước (tâm dời theo trục riêng của từng box)
      let r = resizeKeyframes(upsertKf(track, f, cub), lb, lo, hi);
      if (!dyn) { // Dynamic size tắt: mọi keyframe phải cùng kích thước, kể cả các keyframe phía trước
        r = { ...r, track: { ...r.track, shapes: r.track.shapes.map((sh) => (sh.outside || sh.type !== 'cuboid' || sh.frame > f ? sh : { ...sh, points: serializeCuboid({ ...parseCuboid(sh.points), sx: cub.sx, sy: cub.sy, sz: cub.sz }, sh.points) })) } };
      }
      onTrack(num - 1, r.track, [f, ...r.frames]);
      return;
    }
    if (all === 'move' && track && cur) {
      const r = translateKeyframes(upsertKf(track, f, cub), cub.x - cur.x, cub.y - cur.y, cub.z - cur.z, lo, hi);
      onTrack(num - 1, r.track, [f, ...r.frames]);
      return;
    }
    if (all === 'rot' && track && cur) {
      // Ctrl+Alt+kéo: độ xoay vừa kéo được cộng vào frame này và MỌI keyframe có box phía sau nó (quanh tâm từng box)
      const wrap = (a: number) => { let d = a; while (d > Math.PI) d -= 2 * Math.PI; while (d <= -Math.PI) d += 2 * Math.PI; return d; };
      const r = rotateAllKeyframes(upsertKf(track, f, cub), wrap(cub.yaw - cur.yaw), cub.rx - cur.rx, cub.ry - cur.ry, lo, hi); // frame này đặt đúng box vừa kéo (thành keyframe nếu chưa), các keyframe sau cộng độ xoay
      onTrack(num - 1, r.track, [f, ...r.frames]);
      return;
    }
    onEdit(num - 1, f, cub, !dyn && !!cur && !sameSize(cur, cub));
  };
  /** Ctrl + bấm đúp box xung quanh #n: từ frame f trở đi (Ctrl+Shift: từ frame f trở về trước), đáy box của object đang chọn bằng đáy box #n ở từng keyframe (frame nào #n không có box thì giữ nguyên). */
  const syncGroundAfter = (n: number, f: number, back = false) => {
    const other = ann.tracks[n - 1];
    if (!track || !other) return;
    const bottomAt = (g: number) => { const c = stateAt(other, g).cuboid; return c ? c.z - c.sz / 2 : null; };
    const cur = stateAt(track, f).cuboid, b0 = bottomAt(f);
    if (!cur || b0 === null) return;
    let t = upsertKf(track, f, { ...cur, z: cur.z + (b0 - (cur.z - cur.sz / 2)) });
    const frames = [f];
    t = { ...t, shapes: t.shapes.map((sh) => {
      if (sh.outside || sh.type !== 'cuboid' || (back ? sh.frame >= f : sh.frame <= f)) return sh;
      const c = parseCuboid(sh.points), b = bottomAt(sh.frame);
      if (b === null) return sh;
      frames.push(sh.frame);
      return { ...sh, points: serializeCuboid({ ...c, z: c.z + (b - (c.z - c.sz / 2)) }, sh.points) };
    }) };
    onTrack(num - 1, t, frames);
    setNote(`Đã đồng bộ mặt đường với #${n}: đáy box #${num} = đáy box #${n} ở ${frames.length} keyframe ${back ? 'đến' : 'từ'} frame ${f}. Hoàn tác được.`);
  };
  const [refF, setRefF] = useState(initialFrame); // tab Ref: frame đang xem
  const frames = refView ? [refF] : pageFrames(list, k, prefs.perWin, overlap);
  const framesKey = frames.join(',');
  // Đổi cách chia trang / khoảng xem / object: giữ nguyên frame đang xem thay vì nhảy.
  const anchorRef = useRef(frames[0] ?? start);
  anchorRef.current = frames[0] ?? start;
  const listKey = `${list.length}:${list[0]}:${list[list.length - 1]}`;
  useEffect(() => {
    if (forceFirst.current) { forceFirst.current = false; pendingAt.current = null; setK(0); return; }
    const at = pendingAt.current ?? anchorRef.current;
    pendingAt.current = null;
    setK(pageOf(list, at, prefs.perWin, overlap));
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
  useEffect(() => { if (!refView) onView(frames); }, [framesKey]);
  // Object xem trước đó và cửa sổ lúc rời đi (nút ↶). Đổi object bằng bất kỳ cách nào (ô ID, ↑/↓, bảng object, CVAT) đều ghi lại;
  // nhớ qua lúc rời tab Batch Review (vd. mở ID khác từ bảng object thì ↶ vẫn về ID trước đó).
  const mem = objMem?.job === job.id ? objMem : null;
  const here = useRef(mem?.here ?? { num, at: frames[0] ?? start });
  const [back, setBack] = useState<ObjPos | null>(mem?.back ?? null);
  useEffect(() => {
    let b = back;
    if (here.current.num !== num) { b = here.current; setBack(b); }
    here.current = { num, at: frames[0] ?? start };
    objMem = { job: job.id, here: here.current, back: b };
  }, [num, framesKey]);
  /** Sửa ô Object ID hoặc phím object trước / sau: sang object đó và cửa sổ về frame đầu job. */
  const pickId = (n: number) => {
    if (n === num) return;
    forceFirst.current = true;
    if (viewFrom !== '') setViewFrom('');
    setSelectedNum(n);
  };
  // Ref mode của object đang chọn; ở Batch Review, cột nào có nhiều điểm dưới mặt đường (có thể là ảnh phản chiếu) thì gợi ý bật.
  const refS = useRefState(job.id, num);
  const [below, setBelow] = useState<Map<number, number>>(new Map());
  useEffect(() => setBelow(new Map()), [num]);
  const reportBelow = useCallback((f: number, n: number) => setBelow((m) => (m.get(f) === n ? m : new Map(m).set(f, n))), []);
  const refHint = !refView && !refS.on && !refS.dismissed ? frames.filter((f) => (below.get(f) ?? 0) >= DEFAULT_REFLECT.minBelow) : [];
  const [refOffset, setRefOffset] = useState<number | null>(null); // tab Ref: mặt phản chiếu cao hơn đáy box (m)
  const [refPrefs, setRefPrefsState] = useState(loadRefPrefs);
  const setRefPrefs = (p: RefViewPrefs) => { setRefPrefsState(p); try { kv.set(REF_VIEW_KEY, JSON.stringify(p)); } catch { /* bỏ qua */ } };
  const onRefPlane = useCallback((_f: number, d: number | null) => setRefOffset(d), []);
  const setRefMode = (mode: RefMode) => refStore.set(job.id, num, mode === 'custom' ? { mode, dh: refS.mode === 'custom' ? refS.dh : Math.round((refOffset ?? 0) * 100) / 100 } : { mode });
  const nudgeRef = (d: number) => refStore.set(job.id, num, { mode: 'custom', dh: Math.round(((refS.mode === 'custom' ? refS.dh : refOffset ?? 0) + d) * 100) / 100 });
  const canBack = !!back && back.num <= max && back.num !== num;
  const goBack = () => {
    if (!back || !canBack) { setNote('Chưa có object nào xem trước đó.'); return; }
    pendingAt.current = back.at;
    if (viewFrom !== '' && Number(viewFrom) > back.at) setViewFrom('');
    setSelectedNum(back.num);
  };
  // Chồng lấn của object đang chọn ở các frame đang xem, và box của object kia để vẽ lên ô.
  const ovAt = useMemo(() => {
    const m = new Map<number, { other: number; ratio: number }[]>();
    for (const o of overlaps) if (o.a === num || o.b === num) m.set(o.frame, [...(m.get(o.frame) ?? []), { other: o.a === num ? o.b : o.a, ratio: o.ratio }]);
    return m;
  }, [overlaps, num]);
  const ovData = useMemo(() => {
    const cubs = new Map<number, Cuboid[]>(), nums = new Map<number, number[]>();
    for (const f of frames) for (const o of ovAt.get(f) ?? []) {
      const c = ann.tracks[o.other - 1] ? stateAt(ann.tracks[o.other - 1]!, f).cuboid : null;
      if (c) { cubs.set(f, [...(cubs.get(f) ?? []), c]); nums.set(f, [...(nums.get(f) ?? []), o.other]); }
    }
    return { cubs, nums };
  }, [ovAt, framesKey, ann]);
  // ID xung quanh: cài đặt riêng từng frame (bật/tắt, số box tối đa, tự động gần nhất hoặc chọn từng ID)
  const [nbCfg, setNbCfg] = useState<Map<number, NearbyCfg>>(new Map());
  // Alt+C: bật / tắt cho CẢ ID (mọi frame, kể cả frame chưa hiện trong cửa sổ): frame chưa chỉnh riêng lấy mặc định này
  const [nbAll, setNbAll] = useState(false);
  useEffect(() => { setNbCfg(new Map()); setNbAll(false); }, [num]);
  const nbDef = useMemo<NearbyCfg>(() => ({ ...NB_DEFAULT, on: nbAll }), [nbAll]);
  const onNearby = useCallback((f: number, c: NearbyCfg) => setNbCfg((m) => new Map(m).set(f, c)), []);
  const nbCand = useMemo(() => {
    const m = new Map<number, { num: number; d: number }[]>();
    if (!track) return m;
    for (const f of frames) {
      const me = stateAt(track, f).cuboid;
      if (!me) continue;
      const l: { num: number; d: number }[] = [];
      ann.tracks.forEach((t, i) => {
        if (i + 1 === num) return;
        const c = stateAt(t, f).cuboid;
        if (c) l.push({ num: i + 1, d: Math.hypot(c.x - me.x, c.y - me.y) });
      });
      m.set(f, l.sort((a, b) => a.d - b.d));
    }
    return m;
  }, [framesKey, ann, track, num]);
  const nbPicked = useMemo(() => new Map<number, number[]>(), [ovData, nbCand, nbCfg, nbDef, ann]);
  const ovCubs = useMemo(() => {
    const out = new Map(ovData.cubs);
    for (const [f, cand] of nbCand) {
      const cfg = nbCfg.get(f) ?? nbDef;
      if (!cfg.on) continue;
      const have = new Set(ovData.nums.get(f) ?? []);
      const pick = (cfg.mode === 'auto' ? cand : cand.filter((c) => cfg.ids.includes(c.num))).filter((c) => !have.has(c.num)).slice(0, cfg.max);
      const add = pick.map((c) => stateAt(ann.tracks[c.num - 1]!, f).cuboid!);
      if (add.length) out.set(f, [...(out.get(f) ?? []), ...add]);
      nbPicked.set(f, pick.map((c) => c.num));
    }
    return out;
  }, [ovData, nbCand, nbCfg, nbDef, ann]);
  const ovNums = useMemo(() => {
    const out = new Map(ovData.nums);
    for (const [f, n] of nbPicked) if (n.length) out.set(f, [...(out.get(f) ?? []), ...n]);
    return out;
  }, [ovData, ovCubs]);
  // Cặp đã bỏ qua: ghi chú ở từng frame mà hai object vẫn chồng nhau (frame → số thứ tự object kia)
  const ovIgnAt = useMemo(() => {
    const m = new Map<number, number[]>();
    for (const o of ignoredOverlaps) if (o.a === num || o.b === num) m.set(o.frame, [...(m.get(o.frame) ?? []), o.a === num ? o.b : o.a]);
    return m;
  }, [ignoredOverlaps, num]);
  const EMPTY_NUMS: number[] = [];
  /** Dời box của object kia (đang chồng lấn với object đang chọn) ở frame f: ghi vào nháp như một lần sửa của object đó, hoàn tác được. */
  const commitOther = (n: number, f: number, cub: Cuboid, allAfter = false, back = false) => {
    const tr = ann.tracks[n - 1], cur = tr ? stateAt(tr, f).cuboid : null;
    if (allAfter && tr && cur) {
      // Ctrl+Alt+kéo box chồng lấn: độ xoay vừa kéo cộng vào frame này (thành keyframe nếu chưa) và MỌI keyframe có box phía sau của object đó
      const d = cub.yaw - cur.yaw;
      const r2 = rotateAllKeyframes(upsertKf(tr, f, cub), d, 0, 0, back ? -Infinity : f + 1, back ? f - 1 : Infinity); // frame này đặt đúng box vừa xoay, các keyframe sau (Ctrl+Shift: trước) cộng độ xoay
      onTrack(n - 1, r2.track, [f, ...r2.frames]);
      setNote(`Đã xoay object #${n} ở frame ${f} và mọi keyframe phía ${back ? 'trước' : 'sau'} (đang chồng lấn với #${num}). Hoàn tác được.`);
      return;
    }
    onEdit(n - 1, f, cub, false);
    setNote(`Đã sửa (dời / xoay) object #${n} ở frame ${f} (đang chồng lấn với #${num}). Hoàn tác được.`);
  };
  useEffect(() => { onSel(selFrame); }, [selFrame]);

  const updatePrefs = (p: Prefs) => { setPrefs(p); savePrefs(p); };
  const zoomBy = (factor: number) => setZoom((z) => Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, z * factor)));
  useEffect(() => { setZoom(1); }, [num]);

  // Cỡ ô: tự khớp độ phân giải màn hình (đủ rộng cho 6 cột và đủ cao cho 3 hàng), hoặc chỉnh tay.
  const cols6 = Math.min(8, Math.max(2, prefs.perWin));
  const layout = useFrameLayout();
  const rowsV = layout === 'v'; // frame xếp dọc: mỗi frame một hàng, 3 view nằm ngang
  const fitW = rowsV ? Math.floor((vp.w - 60 - 2 * VIEW_GAP) / 3) : Math.floor((vp.w - 24 - (cols6 - 1) * prefs.gap) / cols6 - 6);
  const fitH = rowsV ? CELL_MAX : Math.floor((vp.h - 190) / 3);
  const size = prefs.size;

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
      point: { color: colors.point || null, alpha: prefs.ptAlpha, scale: prefs.ptSize },
    };
  }, [baseHalf, track, prefs.slabMargin, colors.point, prefs.ptAlpha, prefs.ptSize]);
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
  // Bảng so sánh Patchwork++: nhảy tới (object, frame); object khác thì đổi object rồi về cửa sổ chứa frame đó (như nút ↶).
  const jumpTo = (n: number, f: number) => {
    if (n === num) { goFrame(f); return; }
    pendingAt.current = f;
    if (viewFrom !== '' && Number(viewFrom) > f) setViewFrom('');
    setSelectedNum(n);
  };
  const cols = useMemo(
    () => frames.map((f) => ({
      f,
      st: track ? stateAt(track, f) : { status: 'none' as const, cuboid: null },
      ref: track ? referenceCuboid(track, f, stop) : null,
      mot: track ? motionJump(track, f, row?.label ?? '') : null,
    })),
    [track, framesKey, stop, row?.label, thrVer],
  );

  // Mặt đường theo box láng giềng: ở mỗi frame đang xem, các object có ID (hiển thị trong CVAT) NHỎ hơn object đang chọn (coi là đã kiểm duyệt),
  // còn box ở frame đó và tâm cách tâm box đang xét ≤ NEIGHBOR_RADIUS → độ cao thế giới của đáy chúng (neighborGroundZ).
  const nbrZs = useMemo(() => {
    const m = new Map<number, number | null>();
    if (!track) return m;
    const myId = clientIdOf(ann.tracks, num);
    const lower = ann.tracks.filter((_, i) => i !== num - 1 && clientIdOf(ann.tracks, i + 1) < myId);
    for (const f of frames) {
      const me = stateAt(track, f).cuboid;
      if (!me) { m.set(f, null); continue; }
      const others: { x: number; y: number; z: number; sz: number }[] = [];
      for (const t of lower) { const c = stateAt(t, f).cuboid; if (c) others.push(c); }
      m.set(f, neighborGroundZ(me, others));
    }
    return m;
  }, [ann, track, num, framesKey]);

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
  /** Khoảng [a, b]: frame đầu khoảng đang thường → đặt outside cả khoảng; frame đầu đang outside → đưa cả khoảng trở lại có box. */
  const rangeOutside = (a: number, b: number) => {
    if (!track) return;
    const s0 = stateAt(track, Math.min(a, b)).status;
    if (s0 === 'outside' || s0 === 'outside-key') {
      apply(restoreOutsideRange(track, a, b, stop, readBak()), `Đã đưa ${'{n}'} frame trong ${a}–${b} trở lại (có box). Hoàn tác được.`, 'Không có frame outside nào trong khoảng này để đưa trở lại.');
      return;
    }
    saveBak(Array.from({ length: Math.abs(b - a) + 1 }, (_, i) => Math.min(a, b) + i));
    apply(setOutsideRange(track, a, b, stop), `Đã đặt outside ${'{n}'} frame trong ${a}–${b}. Hoàn tác được.`, 'Không có frame nào trong khoảng này đổi được.');
  };
  const onPickSelect = (f: number) => {
    if (!pick) { setSelFrame(f); return; }
    setSelFrame(f);
    if (pick.first === null) { setPick({ first: f }); setNote(`Đã chọn đầu khoảng: frame ${f}. Bấm tiêu đề cột cuối khoảng (Esc để hủy).`); return; }
    const a = Math.min(pick.first, f), b = Math.max(pick.first, f);
    setPick(null);
    setRangeFrom(String(a)); setRangeTo(String(b));
    if (track) {
      rangeOutside(a, b);
    }
  };
  useEffect(() => {
    if (!pick) return;
    // pha bắt (capture) và chặn lan truyền: Esc hủy chọn khoảng thì không đồng thời đưa tool về Bảng object
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setPick(null); setNote('Đã hủy chọn khoảng.'); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [pick]);
  /** ② Current window: outside cho mọi frame có box trong cửa sổ đang hiển thị. */
  const outsideRange = () => {
    const r: [number, number] | null = frames.length ? [frames[0]!, frames[frames.length - 1]!] : null;
    if (r) rangeOutside(r[0], r[1]);
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
  /** ③ Select range: bật / hủy chế độ chọn khoảng bằng hai tiêu đề cột. */
  const togglePick = () => {
    if (pick) { setPick(null); setNote('Đã hủy chọn khoảng.'); } else { setPick({ first: null }); setNote('Chọn khoảng: bấm tiêu đề cột ĐẦU khoảng (Esc để hủy).'); }
  };
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
    const sf = [kindOf(f)];
    const st = track ? stateAt(track, f) : null;
    const g = snaps.get(f);
    if (!st?.cuboid) { snapWhy.current = 'frame này không có box'; return false; }
    if (!g) { snapWhy.current = 'chưa đo được mặt đường ở frame này (point cloud chưa tải xong hoặc ngoài bán kính đo)'; return false; }
    if (!g.confident) { snapWhy.current = 'mặt đường đo được chưa đủ chắc chắn (cần ≥ 2 cung cùng tầng hoặc lớp tiếp xúc xác nhận, không mơ hồ)'; return false; } // chỉ dời khi đủ căn cứ
    // Đo lại tại vị trí sau khi dời: phép đo phụ thuộc đáy box, hai lần phải ra cùng mặt đường, không thì không dời.
    const pc = pointClouds.peek(f);
    if (!pc && sf[0] !== 'nbr' && sf[0] !== 'ego') { snapWhy.current = 'point cloud của frame này chưa có trong bộ nhớ'; return false; }
    const c0 = st.cuboid;
    if (sf[0] === 'measured' && !confirmSnap(localize(pc!, c0, 16, f), c0.sx, c0.sy, c0.sz, { cu: 0, cv: 0, cw: 0, range: Math.hypot(c0.x, c0.y) }, g)) { snapWhy.current = 'đo lại tại chỗ cho ra mặt đường khác (hai lần đo không khớp)'; return false; }
    // Mặt dốc: nghiêng box song song mặt đường (roll / pitch) nếu bật và dốc đủ rõ; không thì chỉ dời z.
    if (g.method === 'plane' && g.plane && g.dzTilt !== undefined && (g.slopeDeg ?? 0) >= 1) {
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
  // Áp gợi ý mặt đường cho mọi frame đang hiện của object (mỗi frame đúng 1 nguồn, ghi riêng từng frame); không đổi box nào.
  const applyAdvice = () => {
    const next = { ...frameKind };
    const changed: number[] = [];
    for (const f of frames) { const a = advs.get(f); if (a && kindOf(f) !== a.kind) { next[f] = a.kind; changed.push(f); } }
    if (changed.length) saveKinds(next);
    setNote(changed.length ? `Đã áp gợi ý mặt đường cho frame ${changed.join(', ')}. Chưa dời box nào: bấm Ground snap để áp.` : (prefs.gadvise ? 'Mặt đường của các frame đang hiện đã theo gợi ý.' : 'Gợi ý mặt đường đang tắt (bật "sg road").'));
  };
  const groundSelectedOrAll = () => {
    const tgt = hoverRef.current ?? selFrame; // trỏ chuột > frame đã chọn > cả cửa sổ
    const list = tgt !== null ? [tgt] : frames;
    const done = list.filter((f) => groundFrame(f));
    setNote(done.length
      ? `Ground snap: đã hạ/nâng đáy box chạm mặt đường ở frame ${done.join(', ')}. Hoàn tác được.`
      : `Không có gì để snap${hoverRef.current !== null || selFrame !== null ? ` ở frame ${hoverRef.current ?? selFrame}` : ''} (đã nằm trên mặt đường, thiếu điểm mặt đường, mặt đường mơ hồ như có vỉa hè, hoặc lệch quá 1 m)${list.length === 1 && snapWhy.current ? `. Lý do: ${snapWhy.current}` : ''}.`);
  };
  // Outside dài (≥ SPLIT_OUTSIDE_FRAMES frame) rồi có box lại: gợi ý bỏ outside + gỡ keyframe cả đoạn, có hộp xác nhận trước khi áp.
  // thrVer: ngưỡng (rule "outsideGap" ở Cài đặt → Threshold) đổi thì tính lại; thiếu nó thì gợi ý không hiện / không mất tới khi object đổi
  const outGaps = useMemo(() => (track ? findLongOutsideGaps(track, start, stop) : []), [track, start, stop, thrVer]);
  const clearGap = async (g: OutsideGap) => {
    if (!track) return;
    if (!await askConfirm({
      title: `Bỏ outside · object #${num}`,
      message: `• Bỏ outside ${g.len} frame (${g.from}–${g.to}) và gỡ keyframe của các frame đó (như bấm O rồi K).\n• Các frame này trở về nội suy giữa box trước frame ${g.from} và box từ frame ${g.resume}.\n\nGiữ nguyên ID. Chỉ nằm trong nháp tới khi bạn upload, hoàn tác được.`,
      confirmLabel: 'Bỏ outside',
    })) return;
    apply(removeOutsideKeyframes(track, g.from, g.to), `Đã bỏ outside và gỡ keyframe ${'{n}'} frame (${g.from}–${g.to}) của #${num}. Nằm trong nháp, chưa upload.`, 'Không gỡ được keyframe outside nào trong đoạn này.');
  };
  const lateStart = useMemo(() => (track ? findLateStart(track, start, stop) : null), [track, start, stop]);
  const relocateLate = async () => {
    if (!track || !lateStart) return;
    const msg = `• Object #${num} xuất hiện từ frame ${lateStart.first} (không phải frame ${start}).\n`
      + `• Giữ nguyên ID #${num}, KHÔNG tạo ID mới: chỉ thêm keyframe outside ở mọi frame ${start}–${lateStart.first - 1}.\n\n`
      + 'Không xóa ID nào. Chỉ nằm trong nháp tới khi bạn upload.';
    if (!await askConfirm({ title: `Outside phía trước · object #${num}`, message: msg, confirmLabel: 'Thêm outside' })) return;
    const n = onSplit(num - 1, -1);
    setNote(n === null ? 'Không thêm được: object này không xuất hiện muộn.' : `Đã thêm keyframe outside frame ${start}–${lateStart.first - 1} cho #${num}, giữ ID. Nằm trong nháp, chưa upload.`);
  };
  const midSet = useMemo(() => new Set(midOut.get(num) ?? []), [midOut, num]); // ít điểm ở giữa hai frame ổn: không báo P (box nội suy)
  const misfitFrames = prefs.suggest ? frames.filter((f) => fits.get(f)?.level === 'misfit') : [];
  const sparseFrames = frames.filter((f) => fits.get(f)?.level === 'sparse' && !ign.has(issueKey(job.id, num, f, 'P')));

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
    if (!(anyMeasured || warn) || !track) { setSeries(new Map()); setFitSeries({ fits: new Map(), checked: 0 }); return; }
    let live = true;
    const timer = window.setTimeout(async () => {
      const grounds = new Map<number, GroundResult | null>();
      const consItems: ConsistencyItem[] = [];
      const fits = new Map<number, FitReport>();
      let checked = 0;
      for (let f = start; f <= stop && live; f++) {
        const c = stateAt(track, f).cuboid;
        const pc = c ? pointClouds.peek(f) : undefined;
        if (!c || !pc) continue; // chưa tải point cloud thì chưa đo frame đó
        const loc = localize(pc, c, 16, f);
        checked++;
        const g = groundSnap(loc, c.sx, c.sy, c.sz, { cu: 0, cv: 0, cw: 0, range: Math.hypot(c.x, c.y) });
        if (kindOf(f) === 'measured' || prefs.gshowAll) { grounds.set(f, g); consItems.push({ f, z: c.z, range: Math.hypot(c.x, c.y), g }); }
        if (warn) fits.set(f, fitReport(loc, c.sx, c.sy, c.sz, DEFAULT_FIT, fitGroundOf(g)));
        if (checked % 3 === 0) await new Promise((r) => window.setTimeout(r, 0));
      }
      if (consItems.length && DEFAULT_GROUND.pw >= 4) {
        // mức 4: loại ước lượng Patchwork++ lệch so với mặt đường các frame kề của cùng object
        const checked2 = enforceConsistency(consItems);
        consItems.forEach((it, i) => grounds.set(it.f, checked2[i]!));
      }
      if (live) { setSeries(grounds); setFitSeries({ fits, checked }); }
    }, 300);
    return () => { live = false; window.clearTimeout(timer); };
  }, [track, anyMeasured, frameKind, prefs.gkind, prefs.gshowAll, warn, cloudTick, start, stop, thrVer]);
  // Tất cả lỗi đang có của object (cả track): lệch / ít điểm, đáy lơ lửng / chìm, chồng lấn; bỏ các frame đã bỏ qua.
  const allWarn = useMemo(() => {
    const misfit: number[] = [], sparse: number[] = [], ground: number[] = [], overl: number[] = [];
    for (const [f, r] of fitSeries.fits) {
      if (r.level === 'misfit') { if (prefs.suggest && !ign.has(ignoreKey(job.id, num, f))) misfit.push(f); }
      else if (r.level === 'sparse' && !ign.has(issueKey(job.id, num, f, 'P'))) sparse.push(f);
    }
    for (const [f, g] of series) if (g?.warn) ground.push(f);
    for (const f of ovAt.keys()) overl.push(f);
    const asc = (a: number, b: number) => a - b;
    return { misfit: misfit.sort(asc), sparse: sparse.sort(asc), ground: ground.sort(asc), overl: overl.sort(asc) };
  }, [fitSeries, series, ovAt, ign, job.id, num, prefs.suggest]);
  // Còn frame có box chưa có point cloud (đang tải ngầm): lệch / ít điểm / đáy của track chưa đủ dữ liệu → viền vàng.
  const cloudPartial = fitSeries.checked < (row?.assigned ?? 0);

  // Nhảy tới frame hiện tại của CVAT khi đồng bộ (trừ lần chạy lúc vừa mở nếu được yêu cầu bỏ qua: mở từ bảng object thì về frame 0).
  const skipFocus = useRef(openAt !== null);
  useEffect(() => {
    if (skipFocus.current) { skipFocus.current = false; return; }
    if (!focus) return;
    setK(Math.min(nWin - 1, pageOf(list, focus.frame, prefs.perWin, overlap)));
  }, [focus?.nonce]);

  // Thao tác bàn phím (đã ánh xạ theo keymap ở App).
  useEffect(
    () => onAction((id) => {
      const cs = cols.map((c) => c.f);
      switch (id) {
        case 'nearby.toggle': {
          const tgt = hoverRef.current ?? selFrame;
          const list = tgt !== null ? [tgt] : cs;
          setNbCfg((m) => {
            const n = new Map(m);
            const on = !list.every((f) => (m.get(f) ?? nbDef).on); // có frame đang tắt → bật hết; đã bật hết → tắt hết
            for (const f of list) n.set(f, { ...(m.get(f) ?? nbDef), on });
            return n;
          });
          break;
        }
        case 'nearby.toggleAll': {
          const on = !nbAll;
          setNbAll(on);
          setNbCfg((m) => { const n = new Map<number, NearbyCfg>(); m.forEach((v, f) => n.set(f, { ...v, on })); return n; }); // frame đã chỉnh riêng cũng theo
          break;
        }
        case 'view3d.toggle': if (!refView) toggle3dRef.current(); break;
        case 'win.next': setK((x) => Math.min(nWin - 1, x + 1)); break;
        case 'win.prev': setK((x) => Math.max(0, x - 1)); break;
        case 'win.first': setK(0); break;
        case 'win.last': setK(nWin - 1); break;
        case 'win.fromStart': if (viewFrom !== '') { forceFirst.current = true; setViewFrom(''); } break;
        case 'dyn.ownReset': if (own !== null) clearOwnDyn(); else setNote('Object này chưa có công tắc Dynamic size riêng.'); break;
        case 'size.unify': if (!dyn) unifySize(); else setNote('Dynamic size đang bật: đồng bộ size chỉ dùng khi tắt Dynamic size.'); break;
        case 'outside.window': outsideRange(); break;
        case 'outside.pick': togglePick(); break;
        case 'view.center': setPan(NO_PAN); break;
        case 'obj.next': if (num < max) pickId(num + 1); break;
        case 'obj.prev': if (num > 1) pickId(num - 1); break;
        case 'obj.back': goBack(); break;
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
    [nbAll, nbDef, num, max, nWin, selFrame, track, k, cols, sugs, ign, snaps, rangeFrom, rangeTo, frames, pick, viewFrom, own, dyn, back],
  );

  if (!track) return <p>Job chưa có object.</p>;
  const selCol = cols.find((c) => c.f === selFrame) ?? null;
  // View 3D (cửa sổ phụ): object + frame đang chọn (chưa chọn frame thì frame đầu có box của cửa sổ); theo frame chọn khi đang mở.
  const [view3d, setView3d] = useState(false);
  const v3Frame = selFrame ?? cols.find((c) => c.st.cuboid)?.f ?? null;
  // Chỉ tính khi cửa sổ 3D đang mở (không tính sẵn mỗi lần render).
  const v3State = view3d && track && v3Frame !== null ? stateAt(track, v3Frame) : null;
  const v3Cub = v3State?.cuboid ?? null;
  const v3Status = v3State?.status ?? 'none';
  const v3Others = useMemo<View3dOther[]>(() => {
    if (!view3d || v3Frame === null) return [];
    const out: View3dOther[] = [];
    ann.tracks.forEach((t, i) => {
      if (i === num - 1) return;
      const c = stateAt(t, v3Frame).cuboid;
      if (c) out.push({ num: i + 1, id: clientIdOf(ann.tracks, i + 1), label: '', cub: c });
    });
    return out;
  }, [view3d, v3Frame, ann, num]);
  const toggle3d = () => {
    if (view3d) { setView3d(false); return; }
    if (!track || v3Frame === null || !stateAt(track, v3Frame).cuboid) { setNote('View 3D: object này không có box ở frame đang chọn (hãy chọn một frame có box).'); return; }
    setView3d(true);
  };
  const toggle3dRef = useRef(toggle3d);
  toggle3dRef.current = toggle3d;
  useEffect(() => { if (view3d && !v3Cub) setView3d(false); }, [view3d, !!v3Cub]); // frame đang chọn không còn box: đóng
  const az = selCol?.ref ? azimuthDeg(selCol.ref) : null;
  /** Một cột frame (lưới Batch Review và hai cột của tab Ref dùng chung). */
  const colEl = (c: (typeof cols)[number], key: string, sz: number, extra: { refl?: RefState | null; onBelow?: (f: number, n: number) => void; onRefPlane?: (f: number, d: number | null) => void; half?: number; locHalf?: number; horizontal?: boolean; hideGroundPick?: boolean } = {}) => (
    <Column
      key={key} nbrZ={nbrZs.get(c.f) ?? null} midSparse={midSet.has(c.f)} pIgnored={ign.has(issueKey(job.id, num, c.f, 'P'))} onIgnoreP={(f, on) => ignoreStore.set([issueKey(job.id, num, f, 'P')], on)} f={c.f} size={sz} st={c.st} refCub={c.ref} half={extra.half ?? half} locHalf={extra.locHalf ?? locHalf} horizontal={extra.horizontal} hideGroundPick={extra.hideGroundPick} selected={selFrame === c.f} pan={panEff} onPan={setPanClamped}
      edited={edited.has(`${num}:${c.f}`)} warn={warn} fixed={!dyn} ignored={ign.has(ignoreKey(job.id, num, c.f))}
      onIgnore={(f, on) => ignoreFrames([f], on)}
      motion={c.mot} motionIgnored={ign.has(motionKey(job.id, num, c.f))}
      onIgnoreMotion={ignoreMotion}
      kind={kindOf(c.f)} onKind={setFrameKind} showAll={prefs.gshowAll} advise={prefs.gadvise} onAdvice={(f, a) => setAdvs((m) => (m.get(f) === a ? m : new Map(m).set(f, a)))} autoSnap={autoSnap} pwShow={kindOf(c.f) === 'pw' || prefs.gshowAll} groundOv={series.get(c.f) ?? null} groundOn={kindOf(c.f) === 'measured' || prefs.gshowAll} egoOn={kindOf(c.f) === 'ego' || prefs.gshowAll} suggestOn={prefs.suggest} onGround={(f) => { if (!groundFrame(f)) setNote(`Không snap được frame ${f}: ${snapWhy.current || 'không rõ lý do'}.`); }}
      onSnap={(f, g) => setSnaps((m) => (m.get(f) === g ? m : new Map(m).set(f, g)))}
      onSuggest={(f, s) => setSugs((m) => (m.get(f) === s ? m : new Map(m).set(f, s)))} onAccept={accept}
      onFit={(f, r) => setFits((m) => (m.get(f) === r ? m : new Map(m).set(f, r)))} onSelect={() => onPickSelect(c.f)}
      onLoaded={(f) => setLoaded((s) => new Set(s).add(f))}
      onCommit={commit} onZoom={zoomBy} onToggleKf={toggleKf} overlap={ovAt.get(c.f) ?? []} overlayCubs={ovCubs.get(c.f) ?? EMPTY_CUBS} overlayNums={ovNums.get(c.f) ?? EMPTY_NUMS} nbCount={(nbPicked.get(c.f) ?? EMPTY_NUMS).length} nearby={nbCand.has(c.f) ? { cand: nbCand.get(c.f)!, cfg: nbCfg.get(c.f) ?? nbDef } : NB_NONE} onNearby={onNearby} onCommitOther={commitOther} onSyncGroundAll={syncGroundAfter} ignoredOverlap={ovIgnAt.get(c.f) ?? EMPTY_NUMS} onRestoreOverlap={(o) => { ignoreStore.set([overlapKey(job.id, num, o)], false); setNote(`Đã hoàn lại cặp #${Math.min(num, o)}–#${Math.max(num, o)}: báo lại chồng lấn ở mọi frame.`); }} onIgnoreOverlap={(o) => { ignoreStore.set([overlapKey(job.id, num, o)], true); setNote(`Đã bỏ qua cặp #${Math.min(num, o)}–#${Math.max(num, o)} (mọi frame).`); }} onOpenObject={setSelectedNum} tiltOn={true} onFocusFrame={onFocusFrame} fileFlags={(fileFlags.get(c.f) ?? NO_FLAGS).filter((x) => !x.det)} onMarkFlag={markFlagAsk} issues={issueMap.get(c.f) ?? NO_ISSUES} issueIgnored={(k) => ign.has(issueKey(job.id, num, c.f, k))} onIgnoreIssue={ignoreIssueAsk} qcOn={qcOn} qcNote={qcNotes[qcKey(job.id, num, c.f)] ?? ''} onQcNote={(f, t) => qcStore.set(job.id, num, f, t)} onToggleOutside={toggleOutside} onHover={(f) => { hoverRef.current = f; onHoverFrame(f); }} scene={scene}
      refl={extra.refl ?? null} onBelow={extra.onBelow} onRefPlane={extra.onRefPlane}
    />
  );

  if (refView) {
    const rc = cols[0]!;
    // Mỗi hàng là 3 view xếp ngang; hai hàng (Gốc trên, Ref dưới) cùng cỡ. Tự khớp: vừa chiều ngang và (nếu được) vừa chiều cao cả hai hàng.
    const rows = refPrefs.orig ? 2 : 1;
    const fitSize = Math.max(CELL_MIN, Math.min(REF_CELL_MAX, Math.floor((vp.w - 80 - 2 * VIEW_GAP) / 3), Math.floor((vp.h - 260) / rows) - 70));
    const refSize = refPrefs.auto ? fitSize : refPrefs.size;
    const refHalf = half * refSize / REF_BASE; // cùng tỉ lệ px / m: ô to hơn = tầm nhìn rộng hơn
    const refGeo = { half: refHalf, locHalf: Math.max(locHalf, refHalf * 1.2), horizontal: true, hideGroundPick: true };
    const resizeTo = (v: number, save: boolean) => {
      const p = { ...refPrefs, auto: false, size: Math.round(Math.min(REF_CELL_MAX, Math.max(CELL_MIN, v))) };
      if (save) setRefPrefs(p); else setRefPrefsState(p);
    };
    const offset = refS.mode === 'custom' ? refS.dh : refOffset;
    return (
      <>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center', marginBottom: 6, padding: '4px 8px', background: '#f6f0ff', border: '1px solid #d8c4f5', borderRadius: 4 }}>
          <b>Ref mode · object #{num}</b>
          <span>
            frame <button disabled={refF <= start} onClick={() => setRefF(refF - 1)} title="Frame trước">◀</button>{' '}
            <input
              type="number" min={start} max={stop} value={refF} style={{ width: 64 }}
              onChange={(e) => { const v = Math.round(Number(e.target.value)); if (Number.isFinite(v)) setRefF(Math.min(stop, Math.max(start, v))); }}
            />{' '}
            <button disabled={refF >= stop} onClick={() => setRefF(refF + 1)} title="Frame sau">▶</button>
          </span>
          <span title="Mặt phẳng nằm ngang dùng để lấy đối xứng. Mặt đường: đo dưới object ở frame này; không đo được thì z = 0 của ego. Tự chỉnh độ cao là chuyển sang Custom.">
            Mặt phản chiếu:{' '}
            {(['bottom', 'road', 'mirror', 'pw', 'custom'] as const).map((m) => (
              <label key={m} style={{ marginRight: 6 }}><input type="radio" checked={refS.mode === m} onChange={() => setRefMode(m)} /> {REF_MODE_TEXT[m]}</label>
            ))}
          </span>
          <span title="Độ cao mặt phản chiếu so với đáy box (+ cao hơn, − thấp hơn). Chỉnh là chuyển sang Custom; Custom đi theo box khi box dời.">
            cao hơn đáy box{' '}
            <button onClick={() => nudgeRef(-0.05)}>−</button>{' '}
            <input
              type="number" step={0.01} value={offset === null ? '' : offset.toFixed(2)} style={{ width: 64 }}
              onChange={(e) => { const v = Number(e.target.value); if (e.target.value.trim() !== '' && Number.isFinite(v)) refStore.set(job.id, num, { mode: 'custom', dh: Math.max(-5, Math.min(5, v)) }); }}
            /> m{' '}
            <button onClick={() => nudgeRef(0.05)}>+</button>
          </span>
          <button onClick={onCloseRef}>← Batch Review</button>
          <button onClick={() => { refStore.set(job.id, num, { on: false }); onCloseRef?.(); }} title="Tắt ref mode cho object này">Tắt ref mode</button>
          {note && <span style={{ color: '#7a4b00' }}>{note}</span>}
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', alignItems: 'center', marginBottom: 6 }}>
          <span>
            Zoom <button onClick={() => zoomBy(1 / 1.25)} title={hint('zoom.out', 'Thu nhỏ')}>−</button> <b>{Math.round(zoom * 100)}%</b>{' '}
            <button onClick={() => zoomBy(1.25)} title={hint('zoom.in', 'Phóng to')}>+</button>{' '}
            <button onClick={() => { setZoom(1); setPan(NO_PAN); }} title={hint('zoom.reset', 'Zoom 100% và đưa box về giữa ô')}>Vừa object</button>
          </span>
          <span title="Cỡ mỗi ô view (px), hai hàng luôn cùng cỡ. Kéo cạnh phải / cạnh dưới / góc của một hàng để đổi cỡ: tỉ lệ px / m giữ nguyên nên ô to hơn thì thấy rộng hơn quanh object (zoom vẫn đổi tỉ lệ).">
            Cỡ ô{' '}
            <label><input type="checkbox" checked={refPrefs.auto} onChange={(e) => setRefPrefs({ ...refPrefs, auto: e.target.checked, size: refSize })} /> tự khớp màn hình</label>{' '}
            <Slider min={CELL_MIN} max={REF_CELL_MAX} step={10} value={refSize} def={480} unit="px" disabled={refPrefs.auto} onChange={(v) => setRefPrefs({ ...refPrefs, auto: false, size: v })} />
          </span>
          <label title="Ẩn hàng Gốc, chỉ còn hàng Gộp đối xứng">
            <input type="checkbox" checked={refPrefs.orig} onChange={(e) => setRefPrefs({ ...refPrefs, orig: e.target.checked })} /> hiện hàng Gốc
          </label>
          <span style={{ color: '#777', fontSize: 11 }}>tầm nhìn ±{refHalf.toFixed(1)} m</span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, alignItems: 'safe center', overflowX: 'auto', padding: '2px 12px 12px 4px' }}>
          {refPrefs.orig && (
            <div>
              <div style={{ fontWeight: 600 }}>Gốc</div>
              <EdgeResize size={refSize} onResize={resizeTo}>{colEl(rc, 'orig', refSize, refGeo)}</EdgeResize>
            </div>
          )}
          <div>
            <div style={{ fontWeight: 600, color: '#6b21a8' }}>Gộp đối xứng (ref)</div>
            <EdgeResize size={refSize} onResize={resizeTo}>{colEl(rc, 'ref', refSize, { ...refGeo, refl: refS, onRefPlane })}</EdgeResize>
          </div>
        </div>
        <p style={{ fontSize: 11, color: '#666', margin: '2px 0' }}>
          Box ảo (tím nét đứt) đối xứng với box chính qua mặt phản chiếu (vạch tím); điểm trong box ảo được lật lại và vẽ chồng lên box chính bằng màu tím.
          Chỉ để xem, không đổi dữ liệu nhãn. Sửa box ở cột nào cũng được (frame sửa thành keyframe như ở Batch Review).
        </p>
      </>
    );
  }

  return (
    <div
      ref={brRoot} style={{ position: 'relative' }}
      onContextMenu={(e) => {
        const t = e.target as Element | null;
        if (!t || t.ownerDocument !== document) return; // nút trong cửa sổ rời: để menu mặc định
        const btn = t.closest('button');
        const id = btn ? actionOfTitle(btn.getAttribute('title') ?? '') : null;
        if (!btn || !id) return;
        e.preventDefault();
        const b = brRoot.current?.getBoundingClientRect();
        setBindMenu({ id, x: e.clientX - (b?.left ?? 0), y: e.clientY - (b?.top ?? 0) });
      }}
    >
      {view3d && v3Cub && v3Frame !== null && (
        <View3D
          num={num} id={clientIdOf(ann.tracks, num)} label={row?.label ?? ''} frame={v3Frame} cub={v3Cub} status={v3Status} others={v3Others}
          onClose={() => setView3d(false)}
        />
      )}
      {/* Nhóm điều khiển: người dùng tự sắp (kéo ⠿ ở tiêu đề để chuyển nhóm, kéo vạch để đổi rộng / cao), xem ControlLayout.
          Mặc định 3 hàng (chủ dự án 2026-10-30): Keyframe & kích thước + Outside · Gợi ý & mặt đất + QC · Object & cửa sổ + Hiển thị. */}
      <ControlLayout groups={{
        '3': (
          <Group id="3" title={<>Keyframe & kích thước <Help text="🔒 / 🔓 trên tiêu đề cột hoặc nút 🔒 frame: khoá / mở khoá frame đang chọn. 🔓 KF giữa: mở khoá keyframe ở giữa Phạm vi. Rê chuột lên nút để xem phím tắt." /></>} bg="#f4f4f4">
          <label title={`Chỉ áp dụng cho object #${num} đang chọn, không đổi cả class. BẬT: kích thước nội suy giữa các keyframe. TẮT (static): đổi kích thước ở một frame thì áp cho mọi keyframe của object. Hiện đang: ${dynWhy}. Mặc định theo class / attribute đặt ở tab Dynamic size.`} style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={dyn} onChange={(e) => setDyn(e.target.checked)} /> Dynamic size · #{num}
          </label>
          {own !== null && <button onClick={clearOwnDyn} title={hint('dyn.ownReset', 'Theo class: bỏ công tắc riêng, quay về theo attribute / class (tab Dynamic size)')}>↺</button>}
          {!dyn && <button disabled={selFrame === null} onClick={() => unifySize()} title={hint('size.unify', `Đồng bộ size: lấy kích thước của frame đang chọn (${selFrame ?? 'chưa chọn, bấm tiêu đề cột'}) áp cho mọi keyframe của object (hoàn tác được)`)}>Đồng bộ</button>}
          <span style={{ whiteSpace: 'nowrap' }}>
          <b title="Khoảng frame mà các nút Keyframe và Outside bên cạnh tác động (khác với khoảng đang hiển thị ở nhóm Object & cửa sổ). Mặc định bằng cửa sổ đang xem, tự đặt lại khi đổi cửa sổ.">Phạm vi</b>{' '}
          <span>
            frame{' '}
            <input value={rangeFrom} onChange={(e) => setRangeFrom(e.target.value)} size={3} style={{ width: 44 }} /> →{' '}
            <input value={rangeTo} onChange={(e) => setRangeTo(e.target.value)} size={3} style={{ width: 44 }} />
          </span>
          </span>
          <button
            disabled={!selSt?.cuboid}
            onClick={() => selFrame !== null && toggleKf(selFrame)}
            title={hint('kf.toggle', selSt?.status === 'key'
              ? 'Mở khoá frame đang chọn: keyframe về nội suy. Chọn frame bằng cách bấm tiêu đề cột.'
              : 'Khoá frame đang chọn thành keyframe (giá trị giữ nguyên). Chọn frame bằng cách bấm tiêu đề cột.')}
          >{selSt?.status === 'key' ? '🔓' : '🔒'} frame <span style={{ display: 'inline-block', minWidth: '2ch', textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>{selFrame ?? '…'}</span></button>
          <button onClick={unlockInner} title={hint('kf.unlockInner', 'Mở khoá keyframe ở giữa: gỡ mọi keyframe nằm hẳn bên trong Phạm vi, giữ hai đầu mút; frame về nội suy')}>🔓 KF giữa</button>
  
          </Group>
        ),
        '4': (
          <Group id="4" title={<>Outside</>} bg="#fff4f4">
          <button
            disabled={selFrame === null}
            onClick={() => selFrame !== null && toggleOutside(selFrame)}
            title={hint('outside.from', 'Outside từ frame đang chọn tới keyframe kế tiếp; nếu frame đang là outside thì đưa object trở lại. Chọn frame bằng cách bấm tiêu đề cột.')}
          >① ⛔ Outside — frame <span style={{ display: 'inline-block', minWidth: '2ch', textAlign: 'left', fontVariantNumeric: 'tabular-nums' }}>{selFrame ?? '…'}</span></button>
          <button onClick={outsideRange} title={hint('outside.window', 'Đặt outside cho mọi frame có box trong cửa sổ đang hiển thị; frame ngay sau cửa sổ giữ nguyên trạng thái')}>② ⛔ Current window</button>
          <button
            onClick={togglePick}
            style={{ background: pick ? '#ffd9d9' : undefined, fontWeight: pick ? 700 : 400 }}
            title={hint('outside.pick', 'Select range: bấm nút rồi bấm tiêu đề hai cột (đầu và cuối khoảng, có thể ở hai cửa sổ khác nhau): mọi frame có box trong khoảng thành outside. Esc hoặc bấm lại để hủy.')}
          >{pick ? (pick.first === null ? '③ Bấm cột đầu…' : `③ Bấm cột cuối (từ ${pick.first})…`) : '③ ⛔ Select range'}</button>
          </Group>
        ),
        '5': (
          <Group id="5" title={<>Gợi ý & mặt đất</>} bg="#f0fbff">
          <button
            onClick={acceptSelectedOrAll}
            disabled={![...sugs.values()].some(Boolean)}
            style={{ fontWeight: 700, background: [...sugs.values()].some(Boolean) ? '#c9f3ff' : undefined }}
            title={hint('suggest.accept', 'Áp box gợi ý (nét đứt xanh lơ) cho frame đang chọn; nếu chưa chọn frame thì cho mọi frame có gợi ý trong cửa sổ.')}
          >✔ Chấp nhận{[...sugs.entries()].filter(([f, s]) => s && frames.includes(f)).length ? ` · ${[...sugs.entries()].filter(([f, s]) => s && frames.includes(f)).length}` : ''}</button>
          <button
            onClick={ignoreSelectedOrAll}
            disabled={![...sugs.values()].some(Boolean)}
            title={hint('suggest.ignore', 'Bỏ qua gợi ý (nét đứt xanh lơ) của frame đang chọn; nếu chưa chọn frame thì của mọi frame có gợi ý trong cửa sổ.')}
          >✖ Bỏ qua</button>
          <button
            onClick={groundSelectedOrAll}
            title={hint('ground.snap', 'Ground snap: ước lượng mặt đường quanh chân box (đường xanh lá nét đứt ở view Bên/Trước) rồi hạ/nâng box cho đáy chạm đất. Frame đang chọn, hoặc cả cửa sổ nếu chưa chọn.')}
          >⏬ Ground snap</button>
          <label title="sg size = gợi ý kích thước box: khi box lệch cụm điểm, đề xuất box mới (nét đứt xanh lơ, nút ✔ nhận) kèm cảnh báo ⚠ lệch. Tắt: không có gợi ý và không có cảnh báo lệch (⚠ ít điểm vẫn hiện)." style={{ fontWeight: 600 }}>
            <input type="checkbox" checked={prefs.suggest} onChange={(e) => updatePrefs({ ...prefs, suggest: e.target.checked })} /> sg size
          </label>
          <GroundPick
            kind={prefs.gkind} label="mặt đường"
            onChange={(k) => updatePrefs({ ...prefs, gkind: k })}
            title="Mặt đường mặc định cho các frame chưa chọn riêng (mỗi frame có dropdown riêng ở đầu cột, đổi ở frame nào chỉ ảnh hưởng frame đó). Chỉ chọn 1: Ground snap và gr lock dùng mặt đường này."
          />
          <label title="Hiện cả 3 mặt đường để so sánh: đo riêng (vạch xanh lá + chấm), ego z=0 (vàng chấm), Patchwork++ (tím nét đứt). Chỉ để xem: Ground snap / lock vẫn dùng đúng nguồn đã chọn.">
            <input type="checkbox" checked={prefs.gshowAll} onChange={(e) => updatePrefs({ ...prefs, gshowAll: e.target.checked })} /> hiện cả 3
          </label>
          <label title="sg road = gợi ý chọn mặt đường: mỗi frame đo cả 3 nguồn rồi gợi ý một nguồn (đo riêng nếu đủ tin → Patchwork++ → ego z=0) bằng chip 💡 ở đầu cột; ⚠ khi đo riêng và Patchwork++ lệch nhau nhiều. Bật sẽ chạy Patchwork++ cho các frame đang hiện.">
            <input type="checkbox" checked={prefs.gadvise} onChange={(e) => updatePrefs({ ...prefs, gadvise: e.target.checked })} /> sg road
          </label>
          <button onClick={applyAdvice} disabled={!prefs.gadvise} title="Chọn nguồn mặt đường theo gợi ý cho mọi frame đang hiện của object (chỉ đổi lựa chọn, chưa dời box; bấm Ground snap để áp).">💡 Áp gợi ý</button>
          <label title="gr lock = tự bám mặt đất khi kéo: sau mỗi lần dời / đổi cỡ box bằng chuột, tự đặt lại độ cao cho đáy chạm mặt đường tại vị trí mới. Dùng mặt đường đã chọn ở frame đó.">
            <input type="checkbox" checked={autoSnap} onChange={(e) => setAutoSnap(e.target.checked)} /> gr lock
          </label>
          {PwCompare && (
          <button onClick={() => setShowCmp((v) => !v)} aria-pressed={showCmp} style={showCmp ? { fontWeight: 700 } : undefined}
            title="So sánh cách đo mặt đường cũ với Patchwork++ cho lỗi G (đáy lơ lửng / chìm): tỉ lệ báo theo tầm, ca mơ hồ, ca không đo được, và danh sách frame hai cách kết luận khác nhau.">⚖ So sánh Patchwork++</button>)}
          </Group>
        ),
        '1': (
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
          {(warn || anyMeasured) && cloudPartial && (
            <span style={{ color: '#666', fontSize: 11, ...PENDING_STYLE }} title="Lệch / ít điểm / đáy chỉ kiểm được ở frame đã tải point cloud; các frame còn lại đang tải ngầm, số liệu tự cập nhật">(đã kiểm {fitSeries.checked}/{row?.assigned ?? 0} frame có box)</span>
          )}
          {trackSummary.byKind.map(([kind, fr]) => (
            <span key={kind} style={{ color: '#a0006e', fontWeight: 600 }} title="Cả track (ký hiệu lỗi đặt ở tab Threshold). Bấm một đoạn để nhảy tới frame đầu của đoạn.">
              ⚠ {symLabel(kind)} ({fr.length}):{' '}
              {toRanges(fr).map(([x, y]) => (
                <button key={x} onClick={() => goFrame(x)} style={{ padding: '0 3px', marginRight: 2, fontWeight: 600, color: '#a0006e' }}>{x === y ? x : `${x}–${y}`}</button>
              ))}
              <button
                onClick={() => { ignoreStore.set(fr.map((f) => issueKey(job.id, num, f, kind)), true); setNote(`Đã bỏ qua ${fr.length} cảnh báo ${symLabel(kind)} của object #${num}.`); }}
                style={{ padding: '0 3px', fontSize: 10 }} title={`Bỏ qua cả ${fr.length} frame ${kind} của object này (theo lô)`}
              >✖ bỏ qua tất cả</button>
            </span>
          ))}
          {lateStart && (
            <span style={{ color: '#7a1f1f', fontWeight: 600 }} title={`Object bắt đầu từ frame ${lateStart.first}, không phải frame đầu job.`}>
              ⚠ xuất hiện từ frame {lateStart.first}{' '}
              <button onClick={relocateLate} style={{ padding: '0 4px', fontWeight: 600 }} title="Giữ ID, thêm keyframe outside ở mọi frame trước lúc xuất hiện. Có hộp xác nhận.">⇢ outside phía trước</button>
            </span>
          )}
          {outGaps.map((g) => (
            <span key={g.from} style={{ color: '#7a1f1f', fontWeight: 600 }} title={`Outside liên tục ${g.len} frame (${g.from}–${g.to}) rồi có box lại từ frame ${g.resume}. Từ ${SPLIT_OUTSIDE_FRAMES} frame trở lên nên bỏ outside cả đoạn.`}>
              ⚠ outside {g.len} frame ({g.from}–{g.to}){' '}
              <button
                onClick={() => clearGap(g)}
                style={{ padding: '0 4px', fontWeight: 600 }}
                title={`Bỏ outside cả ${g.len} frame (${g.from}–${g.to}) và gỡ keyframe của chúng (như O rồi K): các frame trở về nội suy, giữ ID. Có hộp xác nhận, hoàn tác được.`}
              >⛔ bỏ outside + gỡ key {g.from}–{g.to}</button>
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
        ),
        '6': (
          <Group id="6" title={<>Object & cửa sổ</>}>
          <span>
            <IdBox value={num} max={max} onCommit={pickId} />{' '}
            <button disabled={!canBack} onClick={goBack} title={hint('obj.back', canBack ? `Về object #${back!.num} vừa xem (cửa sổ từ frame ${back!.at})` : 'Về object xem trước đó (chưa có)')}>↶</button>
          </span>
          <span>
            <button onClick={toggle3d} aria-pressed={view3d} title={hint('view3d.toggle', 'Mở / đóng cửa sổ 3D (70% màn hình, nền mờ) xoay được quanh box của object ở frame đang chọn (chỉ point trong bán kính đặt ở Cài đặt › Hiển thị, kèm box các object khác)')}>🧊 3D</button>
          </span>
          <span>
            <label title={`Reflection mode cho riêng object #${num}: dựng box ảo đối xứng với box qua mặt phản chiếu (mặc định mặt dưới box) và gộp điểm phản chiếu vào box chính để hình vật nét hơn. Bật thì có tab Ref cạnh tab Batch Review.`} style={{ fontWeight: 600 }}>
              <input type="checkbox" checked={refS.on} onChange={(e) => refStore.set(job.id, num, { on: e.target.checked })} /> ref mode
            </label>
            {refS.on && <button onClick={() => onOpenRef?.(selFrame ?? cols.find((c) => c.st.cuboid)?.f)} style={{ marginLeft: 4 }} title="Mở tab Ref ở frame đang chọn (chưa chọn thì frame đầu có box của cửa sổ)">Mở tab Ref</button>}
          </span>
          <span>
            <button disabled={k === 0} onClick={() => setK(0)} title={hint('win.first', 'Về cửa sổ đầu tiên')}>|◀</button>{' '}
            <button disabled={k === 0} onClick={() => setK(k - 1)} title={hint('win.prev', 'Cửa sổ frame trước')}>◀</button>{' '}
            <span style={{ display: 'inline-block', minWidth: '6.5em', textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}>Cửa sổ {k + 1}/{nWin}</span>{' '}
            <button disabled={k >= nWin - 1} onClick={() => setK(k + 1)} title={hint('win.next', 'Cửa sổ frame sau')}>▶</button>{' '}
            <button disabled={k >= nWin - 1} onClick={() => setK(nWin - 1)} title={hint('win.last', 'Tới cửa sổ cuối cùng')}>▶|</button>
          </span>
          <span title="Cửa sổ đang hiện. Nhập a: bắt đầu cửa sổ từ frame a, b tự thành a + số frame - 1 (mặc định 6 frame). Sửa b: đổi số frame hiển thị (b - a + 1). Enter để áp dụng.">
            Cửa sổ hiện{' '}
            <input value={winA} onChange={(e) => setWinA(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} onBlur={commitA} onFocus={(e) => e.target.select()} size={3} style={{ width: 44 }} /> →{' '}
            <input value={winB} onChange={(e) => setWinB(e.target.value.replace(/\D/g, ''))} onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }} onBlur={commitB} onFocus={(e) => e.target.select()} size={3} style={{ width: 44 }} />{' '}
            <span style={{ display: 'inline-block', minWidth: '4.6em', fontVariantNumeric: 'tabular-nums' }}>({frames.length} frame)</span>{' '}
            <label><input type="checkbox" checked={prefs.keyOnly} onChange={(e) => updatePrefs({ ...prefs, keyOnly: e.target.checked })} /> chỉ keyframe</label>
            {viewFrom !== '' && <button style={{ marginLeft: 4 }} onClick={() => { forceFirst.current = true; setViewFrom(''); }} title={hint('win.fromStart', 'Quay về đầu job')}>⟲ từ đầu</button>}
          </span>
          </Group>
        ),
        '2': (
          <Group id="2" title={<>Hiển thị</>}>
          <div style={DISPLAY_LINE}>
          <span>
            Zoom <button onClick={() => zoomBy(1 / 1.25)} title={hint('zoom.out', 'Thu nhỏ')}>−</button> <b>{Math.round(zoom * 100)}%</b>{' '}
            <button onClick={() => zoomBy(1.25)} title={hint('zoom.in', 'Phóng to')}>+</button> <button onClick={() => { setZoom(1); setPan(NO_PAN); }} title={hint('zoom.reset', 'Zoom 100% và đưa box về giữa ô')}>Vừa object</button>{' '}
            <button onClick={() => setPan(NO_PAN)} disabled={!panned} style={panned ? { fontWeight: 700, color: '#a16207' } : undefined} title={hint('view.center', 'Đưa khung nhìn về giữa box (đang dời bằng chuột phải). Giữ chuột phải trên ô rồi kéo để dời khung nhìn.')}>⌖ Về giữa</button>
          </span>
          <span>
            Cỡ ô{' '}
            <Slider width={90} min={CELL_MIN} max={CELL_MAX} step={10} value={size} def={200} unit="px" onChange={(v) => updatePrefs({ ...prefs, size: v })} />
          </span>
          <span title="Khoảng cách giữa các cột frame (4–80 px)">
            Khoảng cách{' '}
            <Slider width={90} min={4} max={80} step={2} value={prefs.gap} def={28} unit="px" onChange={(v) => updatePrefs({ ...prefs, gap: v })} />
          </span>
          <span title="Độ dày lát cắt ở view Bên / Trước = nửa bề rộng box + biên này. Giảm để bớt tường và vật ở xa hai bên.">
            Lát cắt +{' '}
            <Slider width={90} min={0} max={3} step={0.1} value={prefs.slabMargin} def={0.5} unit="m" decimals={1} onChange={(v) => updatePrefs({ ...prefs, slabMargin: v })} />
          </span>
          <span title="Kiểu vẽ point cloud ở mọi ô: cỡ điểm, độ đậm (thấp thì điểm mờ, chỗ điểm dày vẫn đậm) và màu (theo độ cao, hoặc một màu chọn từ bảng màu). Điểm lọt ra ngoài box vẫn tô hồng, điểm ref vẫn tím.">
            Điểm: cỡ{' '}
            <Slider width={90} min={0.5} max={4} step={0.1} value={prefs.ptSize} def={1} unit="×" decimals={1} onChange={(v) => updatePrefs({ ...prefs, ptSize: v })} />{' '}
            độ đậm{' '}
            <Slider width={90} min={10} max={100} step={5} value={Math.round(prefs.ptAlpha * 100)} def={100} unit="%" onChange={(v) => updatePrefs({ ...prefs, ptAlpha: v / 100 })} />
          </span>
          </div>
          </Group>
        ),
      }} />
      {showCmp && PwCompare && <PwCompare ann={ann} start={start} stop={stop} num={num} onJump={jumpTo} onClose={() => setShowCmp(false)} />}
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
        {refHint.length > 0 && (
          <span style={{ background: '#f3e8ff', color: '#4c1d95', padding: '1px 6px', borderRadius: 8 }} title={`Dưới mặt đường, trong chân box, có từ ${DEFAULT_REFLECT.minBelow} điểm (ngưỡng ở tab Threshold, mục Đáy lơ lửng / chìm): có thể là ảnh phản chiếu của vật. Ref mode gộp các điểm đó vào box để hình vật nét hơn.`}>
            💡 nhiều điểm dưới mặt đường ở frame {refHint.join(', ')}: bật ref mode?{' '}
            <button onClick={() => { refStore.set(job.id, num, { on: true }); onOpenRef?.(refHint[0]); }} style={{ padding: '0 4px' }}>Bật</button>{' '}
            <button onClick={() => refStore.set(job.id, num, { dismissed: true })} style={{ padding: '0 4px' }} title="Không gợi ý ref mode cho object này nữa">Bỏ qua</button>
          </span>
        )}
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
        Mẹo thao tác <Help text={`phím tắt khoá KF / outside / ground snap / chấp nhận / bỏ qua gợi ý (${['kf.toggle', 'outside.from', 'ground.snap', 'suggest.accept', 'suggest.ignore'].map((id) => keyOf(id) ?? 'chưa gán').join(' / ')}) tác dụng lên cột frame đang trỏ chuột (viền xanh) · rê chuột lên nút để xem phím tắt, đổi phím ở tab "Phím tắt" · cuộn chuột trên ô để zoom mọi frame · giữ chuột phải rồi kéo để dời khung nhìn (mọi frame cùng dời), nút ⌖ Về giữa để đưa về giữa ·` + " kéo trong box để dời, kéo cạnh để đổi kích thước, kéo chấm trắng ngắn ở đầu mũi tên (view Trên) hoặc GIỮ ALT rồi kéo để xoay (giữ thêm CTRL = xoay frame này và TẤT CẢ keyframe phía sau) · GIỮ ALT rồi kéo ở phần box chồng lấn (nét đứt vàng, ngoài box đang xét) = xoay box đó (thêm CTRL = xoay luôn mọi keyframe phía sau của object đó) · CTRL+kéo trong box = dời frame này và TẤT CẢ keyframe phía sau cùng độ lệch · CTRL+kéo cạnh / góc = đổi kích thước frame này và TẤT CẢ keyframe phía sau (nguồn mặt đường \"box ID nhỏ\" lấy đáy các box có ID nhỏ hơn trong 5 m) (view Trên: yaw · view Bên: pitch · view Trước: roll, nếu bật \"nghiêng theo mặt đường\") · sửa frame nào thì frame đó thành keyframe"} />
      </div>
      <div style={{ display: 'flex', flexDirection: rowsV ? 'column' : 'row', gap: prefs.gap, overflowX: 'auto', justifyContent: 'safe center', alignItems: rowsV ? 'safe center' : undefined, padding: '2px 4px 6px' }}>
        {cols.map((c) => colEl(c, String(c.f), size, { onBelow: !refS.on && !refS.dismissed ? reportBelow : undefined, horizontal: rowsV }))}
      </div>
      <div style={{ fontSize: 11, color: '#555', marginTop: 4 }}>
        Viền: <span style={{ color: statusColor('key') }}>■ keyframe</span> <span style={{ color: statusColor('interp') }}>■ nội suy</span>{' '}
        <span style={{ color: statusColor('hold') }}>■ giữ nguyên</span> <span style={{ color: statusColor('outside') }}>■ outside</span>{' '}
        <span style={{ color: statusColor('none') }}>■ chưa có</span> · khung nhìn rộng ±{half.toFixed(1)} m quanh object
      </div>
      {bulk && (
        <div role="dialog" aria-modal="true" onClick={() => setBulk(null)} style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 50 }}>
          <div onClick={(e) => e.stopPropagation()} style={{ background: '#fff', color: '#111', border: '1px solid #888', borderRadius: 6, padding: 14, maxWidth: 420, boxShadow: '0 4px 18px rgba(0,0,0,.4)' }}>
            <p style={{ margin: '0 0 6px' }}>
              Bạn vừa chọn <b>{bulk.verb}</b> lỗi <b>{symLabel(bulk.kind)}</b> của object #{num} ở frame {bulk.f}.
            </p>
            <p style={{ margin: '0 0 10px' }}>
              Object này còn <b>{bulk.others.length}</b> frame khác cùng lỗi {symLabel(bulk.kind)}: {bulk.others.slice(0, 14).join(', ')}{bulk.others.length > 14 ? ', …' : ''}.
              Có muốn {bulk.verb} luôn cho các frame còn lại không?
            </p>
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
              <button onClick={() => setBulk(null)}>Hủy</button>
              <button onClick={() => { bulk.run([bulk.f]); setBulk(null); }}>Chỉ frame {bulk.f}</button>
              <button className="cvla-primary" autoFocus onClick={() => { bulk.run([bulk.f, ...bulk.others]); setNote(`Đã ${bulk.verb} lỗi ${symLabel(bulk.kind)} của object #${num} ở ${bulk.others.length + 1} frame.`); setBulk(null); }}>Tất cả {bulk.others.length + 1} frame</button>
            </div>
          </div>
        </div>
      )}
      {bindMenu && <KeyBindMenu id={bindMenu.id} x={bindMenu.x} y={bindMenu.y} maxW={brRoot.current?.getBoundingClientRect().width ?? 600} onClose={() => setBindMenu(null)} />}
      {camShow ? <CameraPanel frame={selCol?.f ?? null} azimuth={az} /> : <p style={{ color: '#666' }}>Ảnh camera đang tắt (bật lại ở tab Camera).</p>}
    </div>
  );
}
