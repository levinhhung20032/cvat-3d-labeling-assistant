import { propagateEdit, propagateSize } from '../shared/dynsize';
import { findOverlaps, groupPairs } from '../shared/overlap';
import { applyDraft, buildDraft, checkDraft, draftKey, type SavedDraft } from '../shared/draft';
import { kv } from './storage';
import { api } from '../shared/api';
import { useEffect, useMemo, useReducer, useRef, useState } from 'react';
import type { Cuboid } from '../shared/cuboid';
import { upsertKeyframe } from '../shared/edit';
import { actionFor, comboOf } from '../shared/keymap';
import { stateAt } from '../shared/interp';
import type { ContentMessage } from '../shared/protocol';
import { summarize } from '../shared/summary';
import { buildRows } from '../shared/table';
import type { CvatAnnotations, CvatJob, CvatLabel, CvatTrack } from '../shared/types';
import { BatchReview } from './BatchReview';
import { JobInfo } from './JobInfo';
import { KeysPanel } from './KeysPanel';
import { UploadDialog } from './UploadDialog';
import { QcPanel } from './QcPanel';
import { DynSizePanel } from './DynSizePanel';
import { Help, PENDING_STYLE } from './ui';
import { pointClouds } from './stores';
import { ShiftBadge, ShiftBanner } from './ShiftBar';
import { findDrift } from '../shared/drift';
import { fitReportAt } from '../shared/fit';
import { loadPass, savePass, sigOf, type PassEntry } from './passStore';
import { DEFAULT_GROUND } from '../shared/ground';
import { splitTrack } from '../shared/splitId';
import { DeleteDialog } from './DeleteDialog';
import { madeStore, useMadeIds } from './madeStore';
import { dynClassStore } from './dynClassStore';
import { ShiftPanel } from './ShiftPanel';
import { attrKey, issueKey, motionKey, overlapKey, shiftStore, useIgnored, useShifts } from './shiftStore';
import { parseLabelSpecs } from '../shared/attributes';
import { suggestAttributes } from '../shared/attrSuggest';
import { fmtDuration, shiftName, computeKpi } from '../shared/shift';
import { emitAction, isCapturing, useKeymap } from './actions';
import { ObjectTable } from './ObjectTable';
import { diag, keyTarget, onContentMessage, post, resolveBinary, resolveChunkEnd, resolveChunkFile, resolveRpc, streamChunk } from './bridge';

export interface Data {
  job: CvatJob;
  labels: CvatLabel[];
  ann: CvatAnnotations; // baseline: đúng như CVAT trả về
  removedIds: number[];
}

// --- nháp chỉnh sửa (chỉ trong bộ nhớ, chưa upload) ---
interface Entry { idx: number; before: CvatTrack; after: CvatTrack; keys: string[]; added: string[] }
interface Draft { work: CvatAnnotations | null; edited: Set<string>; undo: Entry[]; redo: Entry[] }
type Action =
  | { t: 'load'; ann: CvatAnnotations }
  | { t: 'edit'; idx: number; frame: number; cub: Cuboid; sizeAll?: boolean } // sizeAll: dynamic size tắt → kích thước mới áp cho mọi keyframe
  | { t: 'track'; idx: number; track: CvatTrack; frames: number[] } // đổi keyframe hàng loạt
  | { t: 'restore'; work: CvatAnnotations; edited: Set<string> } // khôi phục bản nháp đã lưu
  | { t: 'addTrack'; track: CvatTrack } // object MỚI do tool tạo (chưa có id), thêm vào cuối
  | { t: 'removeTrack'; idx: number } // xóa object do tool tạo trong nháp (chỉ track chưa có id)
  | { t: 'split'; idx: number; oldTrack: CvatTrack; newTrack: CvatTrack; frames: number[] } // tách ID: track cũ (update) + object mới ở cuối (create)
  | { t: 'undo' | 'redo' | 'reset'; baseline?: CvatAnnotations };

const replaceTrack = (a: CvatAnnotations, idx: number, tr: CvatTrack): CvatAnnotations => {
  const tracks = a.tracks.slice();
  tracks[idx] = tr;
  return { ...a, tracks };
};

function applyChange(s: Draft, idx: number, after: CvatTrack, frames: number[]): Draft {
  if (!s.work || !frames.length) return s;
  const before = s.work.tracks[idx]!;
  const keys = frames.map((f) => `${idx + 1}:${f}`);
  const added = keys.filter((k) => !s.edited.has(k));
  return {
    work: replaceTrack(s.work, idx, after),
    edited: new Set([...s.edited, ...keys]),
    undo: [...s.undo, { idx, before, after, keys, added }],
    redo: [],
  };
}

function reducer(s: Draft, a: Action): Draft {
  switch (a.t) {
    case 'load':
      return { work: a.ann, edited: new Set(), undo: [], redo: [] };
    case 'restore':
      return { work: a.work, edited: a.edited, undo: [], redo: [] };
    case 'addTrack': {
      if (!s.work || typeof a.track.id === 'number') return s;
      const idx = s.work.tracks.length;
      const keys = a.track.shapes.map((x) => `${idx + 1}:${x.frame}`);
      // thêm / xóa object làm đổi chỉ số track nên lịch sử hoàn tác cũ không còn dùng được
      return { work: { ...s.work, tracks: [...s.work.tracks, a.track] }, edited: new Set([...s.edited, ...keys]), undo: [], redo: [] };
    }
    case 'split': {
      const old = s.work?.tracks[a.idx];
      if (!s.work || !old || typeof a.newTrack.id === 'number') return s;
      const newIdx = s.work.tracks.length;
      const keys = [...a.frames.map((f) => `${a.idx + 1}:${f}`), ...a.newTrack.shapes.map((x) => `${newIdx + 1}:${x.frame}`)];
      // thêm object làm đổi chỉ số track nên lịch sử hoàn tác cũ không còn dùng được (như addTrack)
      return { work: { ...s.work, tracks: [...replaceTrack(s.work, a.idx, a.oldTrack).tracks, a.newTrack] }, edited: new Set([...s.edited, ...keys]), undo: [], redo: [] };
    }
    case 'removeTrack': {
      const t = s.work?.tracks[a.idx];
      if (!s.work || !t || typeof t.id === 'number') return s; // object có sẵn trên server không bao giờ xóa được ở đây
      const edited = new Set<string>();
      for (const k of s.edited) {
        const [n, f] = k.split(':');
        const num = Number(n);
        if (num === a.idx + 1) continue;
        edited.add(num > a.idx + 1 ? `${num - 1}:${f}` : k);
      }
      return { work: { ...s.work, tracks: s.work.tracks.filter((_, i) => i !== a.idx) }, edited, undo: [], redo: [] };
    }
    case 'reset':
      return { work: a.baseline ?? s.work, edited: new Set(), undo: [], redo: [] };
    case 'edit':
      if (!s.work) return s;
      {
        const prev = s.work.tracks[a.idx]!;
        const before = stateAt(prev, a.frame).cuboid; // box trước khi sửa: để biết mặt nào đứng yên khi đổi kích thước
        const t1 = upsertKeyframe(prev, a.frame, a.cub);
        if (!a.sizeAll) return applyChange(s, a.idx, t1, [a.frame]);
        const r = before ? propagateEdit(t1, before, a.cub) : propagateSize(t1, a.cub);
        return applyChange(s, a.idx, r.track, [...new Set([a.frame, ...r.frames])]);
      }
    case 'track':
      return applyChange(s, a.idx, a.track, a.frames);
    case 'undo': {
      const e = s.undo[s.undo.length - 1];
      if (!e || !s.work) return s;
      const edited = new Set(s.edited);
      for (const k of e.added) edited.delete(k);
      return { work: replaceTrack(s.work, e.idx, e.before), edited, undo: s.undo.slice(0, -1), redo: [...s.redo, e] };
    }
    case 'redo': {
      const e = s.redo[s.redo.length - 1];
      if (!e || !s.work) return s;
      return {
        work: replaceTrack(s.work, e.idx, e.after), edited: new Set([...s.edited, ...e.keys]),
        undo: [...s.undo, e], redo: s.redo.slice(0, -1),
      };
    }
  }
}

let VERSION = '?';
try { VERSION = api.runtime.getManifest().version; } catch { /* extension vừa được Reload */ }

const EMPTY: Draft = { work: null, edited: new Set<string>(), undo: [], redo: [] };

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: Data };
type Tab = 'objects' | 'review' | 'shift' | 'qc' | 'dyn' | 'keys' | 'job';
/** Tải ưu tiên ngần này frame đầu; tải xong là mở được Batch Review (job ngắn hơn: cả job), phần còn lại tải và tính ngầm. */
const UNLOCK_FRAMES = 6;


/** Giao diện chung: nút bo góc, tab rõ ràng, thanh đầu (tiêu đề, ca, tab, nút upload) dính ở đầu khi cuộn. */
const STYLE = `
.cvla-root button { font: inherit; border: 1px solid #9aa4b2; background: #fff; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
.cvla-root button:hover:not(:disabled) { background: #eaf1fb; border-color: #5b7db1; }
.cvla-root button:disabled { opacity: .45; cursor: default; }
.cvla-root input[type=text], .cvla-root input:not([type]), .cvla-root select { font: inherit; border: 1px solid #9aa4b2; border-radius: 4px; padding: 1px 4px; }
.cvla-root input:focus-visible, .cvla-root select:focus-visible, .cvla-root button:focus-visible { outline: 2px solid #2b6cb0; outline-offset: 1px; }
.cvla-root table th { font-weight: 600; background: #f1f4f8; padding: 3px 6px; }
.cvla-root table td { padding: 2px 6px; }
.cvla-root fieldset { border-radius: 6px; }
.cvla-root .cvla-tab { border-radius: 4px 4px 0 0; border-bottom: 2px solid transparent; background: #f1f4f8; }
.cvla-root .cvla-tab.cvla-tab-on { background: #1f2937; color: #fff; border-color: #1f2937; font-weight: 700; }
.cvla-root .cvla-tab.cvla-tab-on:hover:not(:disabled) { background: #1f2937; }
/* Giao diện tối: đảo màu cả panel rồi đảo ngược lại canvas / ảnh (point cloud, ảnh camera) để chúng giữ màu gốc; hue-rotate 180° giữ nguyên sắc (xanh vẫn xanh, đỏ vẫn đỏ). */
body { margin: 0; }
.cvla-root { background: #fff; min-height: 100vh; box-sizing: border-box; }
.cvla-root.cvla-dark { filter: invert(1) hue-rotate(180deg) brightness(.92); }
/* Xám: như tối nhưng giảm tương phản rồi tăng sáng, nền ra màu xám than thay vì gần đen. */
.cvla-root.cvla-gray { filter: invert(1) hue-rotate(180deg) contrast(.6) brightness(1.5); }
.cvla-root.cvla-dark canvas, .cvla-root.cvla-dark img, .cvla-root.cvla-dark video, .cvla-root.cvla-dark .cvla-lens, .cvla-root.cvla-gray canvas, .cvla-root.cvla-gray img, .cvla-root.cvla-gray video, .cvla-root.cvla-gray .cvla-lens { filter: invert(1) hue-rotate(180deg); }
/* Công tắc gạt: mọi ô tick trong panel hiển thị như toggle (ô chọn dòng dùng class cvla-check để giữ dạng ô tick). */
.cvla-root input[type=checkbox]:not(.cvla-check) { appearance: none; -webkit-appearance: none; width: 30px; height: 17px; border-radius: 9px; background: #9aa4b2; position: relative; vertical-align: middle; margin: 0 4px 0 0; cursor: pointer; transition: background .15s; flex: none; }
.cvla-root input[type=checkbox]:not(.cvla-check)::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 1px 2px rgba(0,0,0,.4); }
.cvla-root input[type=checkbox]:not(.cvla-check):checked { background: #2b6cb0; }
.cvla-root input[type=checkbox]:not(.cvla-check):checked::after { left: 15px; }
.cvla-root input[type=checkbox]:not(.cvla-check):disabled { opacity: .45; cursor: default; }
.cvla-root button.cvla-primary { background: #2563eb; color: #fff; border-color: #1d4ed8; }
.cvla-root button.cvla-primary:hover:not(:disabled) { background: #1d4ed8; }
.cvla-root button.cvla-shift { border-radius: 12px; padding: 1px 10px; background: #e6f4ea; border-color: #34a853; color: #14532d; font-size: 12px; }
.cvla-root button.cvla-shift-ot { background: #ede9fe; border-color: #7c3aed; color: #4c1d95; }
.cvla-root button.cvla-shift-warn { background: #fde68a; border-color: #d97706; color: #7a4100; font-weight: 700; }
.cvla-root label.cvla-filebtn { display: inline-flex; align-items: center; border: 1px solid #9aa4b2; border-radius: 4px; padding: 2px 8px; background: #fff; cursor: pointer; }
.cvla-root label.cvla-filebtn input { display: none; }
.cvla-badge { display: inline-block; min-width: 16px; padding: 0 5px; margin-left: 6px; border-radius: 9px; background: #fff; color: #1d4ed8; font-size: 11px; line-height: 16px; text-align: center; }
.cvla-help { display: inline-block; width: 15px; height: 15px; border-radius: 50%; border: 1px solid #8a94a3; color: #5b6573; font-size: 10px; line-height: 14px; text-align: center; cursor: help; margin-left: 4px; font-weight: 700; user-select: none; }
.cvla-root button.cvla-num { border: 0; background: transparent; padding: 0 2px; min-width: 40px; text-align: left; text-decoration: underline dotted; }
.cvla-pill { display: inline-block; padding: 0 7px; border-radius: 9px; font-size: 11px; line-height: 17px; background: #e8ecf1; color: #34404f; white-space: nowrap; }
.cvla-pill-class { background: #1f2937; color: #fff; font-weight: 600; }
.cvla-pill-warn { background: #fde68a; color: #7a5200; }
.cvla-pill-bad { background: #fecaca; color: #991b1b; font-weight: 700; }
.cvla-head { position: sticky; top: 0; z-index: 20; background: #fff; padding-bottom: 4px; border-bottom: 1px solid #d5dbe3; margin: -10px -10px 8px; padding: 8px 10px 6px; }
`;

type Theme = 'auto' | 'dark' | 'gray' | 'light';
const THEME_NEXT: Record<Theme, Theme> = { auto: 'dark', dark: 'gray', gray: 'light', light: 'auto' };
const THEME_LABEL: Record<Theme, string> = { auto: '◐ tự động', dark: '🌙 tối', gray: '🌫 xám', light: '☀ sáng' };
const loadTheme = (): Theme => { try { const v = kv.get('cvla-theme'); return v === 'dark' || v === 'gray' || v === 'light' ? v : 'auto'; } catch { return 'auto'; } };

const loadSync = () => { try { return kv.get('cvla-sync') !== '0'; } catch { return true; } };

export function App() {
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [draft, dispatch] = useReducer(reducer, EMPTY);
  const [tab, setTab] = useState<Tab>('objects');
  const [theme, setThemeState] = useState<Theme>(loadTheme);
  const setTheme = (t: Theme) => { setThemeState(t); try { kv.set('cvla-theme', t); } catch { /* bỏ qua */ } };
  // 'auto' theo cài đặt tối / sáng của hệ điều hành.
  const [osDark, setOsDark] = useState(() => typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches);
  useEffect(() => {
    if (typeof matchMedia !== 'function') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => setOsDark(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  const skin = theme === 'auto' ? (osDark ? 'dark' : 'light') : theme; // giao diện thực tế đang dùng
  const [uploading, setUploading] = useState(false);
  const { active: shift } = useShifts();
  const [, tickShift] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => tickShift((x) => x + 1), 30000);
    return () => window.clearInterval(t);
  }, []);
  const [toast, setToast] = useState('');
  const [reloadMenu, setReloadMenu] = useState(false); // menu của nút "Tải lại frame" (chỉ frame lỗi / tất cả)
  const [restorable, setRestorable] = useState<SavedDraft | null>(null);
  const restorableRef = useRef<SavedDraft | null>(null);
  const [draftNote, setDraftNote] = useState('');
  useEffect(() => {
    if (!toast) return;
    const t = window.setTimeout(() => setToast(''), 9000);
    return () => window.clearTimeout(t);
  }, [toast]);
  const [pushOut, setPushOutState] = useState(() => { try { return kv.get('cvla-sync-out') !== '0'; } catch { return true; } });
  const pushOutRef = useRef(pushOut);
  const setPushOut = (v: boolean) => { setPushOutState(v); pushOutRef.current = v; try { kv.set('cvla-sync-out', v ? '1' : '0'); } catch { /* bỏ qua */ } };
  const viewFrames = useRef<number[]>([]);
  const selFrameRef = useRef<number | null>(null);
  const hoverFrameRef = useRef<number | null>(null);
  const focusRef = useRef<() => void>(() => {});
  const workRef = useRef<CvatAnnotations | null>(null);
  const [keymap, setKeymap] = useKeymap();
  const [sync, setSyncState] = useState(loadSync);
  const [focus, setFocus] = useState<{ frame: number; nonce: number } | null>(null);
  const syncRef = useRef(sync);
  const countRef = useRef(0);
  const lastCvatNum = useRef<number | null>(null);
  const lastCvatFrame = useRef<number | null>(null);
  const toolSelAt = useRef(0); // lúc tool vừa chọn object (CVAT còn báo object cũ trong lúc chuyển)
  const setSync = (v: boolean) => { setSyncState(v); syncRef.current = v; try { kv.set('cvla-sync', v ? '1' : '0'); } catch { /* bỏ qua */ } };
  const [selectedNum, setSelectedNum] = useState<number | null>(null);
  const [startFrame, setStartFrame] = useState(0); // frame đầu của cửa sổ đang xem, để quay lại đúng chỗ
  // Chẩn đoán: nếu sau 6 giây vẫn chưa có dữ liệu thì nói rõ panel đang ở chế độ nào và đã bỏ qua tin nhắn nào.
  const [stuck, setStuck] = useState(false);
  useEffect(() => {
    if (state.kind !== 'loading') { setStuck(false); return; }
    const t = window.setTimeout(() => setStuck(true), 6000);
    return () => window.clearTimeout(t);
  }, [state.kind]);

  useEffect(() => {
    const onMsg = (m: ContentMessage) => {
      if (m.type === 'loading') setState({ kind: 'loading' });
      else if (m.type === 'error') setState({ kind: 'error', message: m.message });
      else if (m.type === 'data') {
        setState({ kind: 'ok', data: { job: m.job, labels: m.labels, ann: m.annotations, removedIds: m.removedIds } });
        dispatch({ t: 'load', ann: m.annotations });
        // Có bản nháp chưa upload từ lần trước (F5, đóng tab…) → hỏi khôi phục; nháp không còn khớp CVAT thì bỏ và báo.
        const chk = checkDraft(kv.get(draftKey(m.job.id)), m.job.id, m.annotations);
        restorableRef.current = chk.ok ? chk.draft : null;
        setRestorable(restorableRef.current);
        if (!chk.ok && chk.reason !== 'none') { setDraftNote(chk.message); kv.remove(draftKey(m.job.id)); }
        countRef.current = m.annotations.tracks.length;
        dynClassStore.ensure(m.job.id, m.labels.map((l) => l.name)); // lấy class của job một lần
        // Point cloud tải theo chunk như giao diện CVAT (ít request, máy chủ không phải đọc lại chunk cho từng frame); không biết cỡ chunk
        // hoặc job không phải 3D thì chỉ tải từng frame.
        // Job ground truth chỉ gồm một số frame chọn lọc: thứ tự trong chunk khác dải start…stop → không dùng chunk.
        pointClouds.setChunks(m.chunkSize && m.job.dimension !== '2d' && m.job['type'] !== 'ground_truth'
          ? { start: m.job.start_frame, stop: m.job.stop_frame, size: m.chunkSize, stream: streamChunk }
          : null);
      } else if (m.type === 'cvatDbl') {
        // Bấm đúp trong CVAT: chọn object đó và chuyển sang Batch Review; ô "CVAT → tool" tắt thì bỏ qua (content script cũng không gửi).
        if (syncRef.current && m.num >= 1 && m.num <= countRef.current) {
          lastCvatNum.current = m.num;
          setSelectedNum(m.num);
          if (readyRef.current) setTab('review'); // Batch Review chỉ mở khi đã tải xong
          if (m.frame !== null) {
            lastCvatFrame.current = m.frame;
            setFocus({ frame: m.frame, nonce: Date.now() });
          }
        }
      } else if (m.type === 'cvat') {
        // Chọn object / đổi frame trong giao diện CVAT → tool chọn đúng object đó.
        if (syncRef.current && m.num !== null && m.num !== lastCvatNum.current && Date.now() - toolSelAt.current > 5000 && m.num >= 1 && m.num <= countRef.current) {
          lastCvatNum.current = m.num;
          setSelectedNum(m.num);
          setTab((t) => (t === 'job' || t === 'keys' || !readyRef.current ? t : 'review')); // Batch Review chỉ mở khi đã tải xong
        } else if (m.num === null) lastCvatNum.current = null;
        // Đổi frame trong CVAT → cửa sổ của tool chạy theo.
        if (syncRef.current && m.frame !== null && m.frame !== lastCvatFrame.current && countRef.current > 0) {
          lastCvatFrame.current = m.frame;
          setFocus({ frame: m.frame, nonce: Date.now() });
        }
      } else if (m.type === 'focusFailed') {
        const why: Record<string, string> = {
          'wrong-frame': 'CVAT chưa nạp xong frame cần xem (server đang bận?)',
          'not-drawn': 'CVAT chưa vẽ object này ở frame hiện tại',
          'no-canvas3d': 'không tìm thấy khung 3D của CVAT (đang ở chế độ khác?)',
          'no-root': 'không đọc được giao diện CVAT',
        };
        setToast(`Focus: không zoom được vào object #${m.num} — ${why[m.reason] ?? m.reason}. Thử bấm Focus lại sau vài giây.`);
      } else if (m.type === 'rpc') resolveRpc(m.reqId, m.result);
      else if (m.type === 'binary') resolveBinary(m.reqId, m.buf, m.error);
      else if (m.type === 'chunkFile') resolveChunkFile(m.reqId, m.i, m.buf);
      else if (m.type === 'chunkEnd') resolveChunkEnd(m.reqId, m.count, m.error);
    };
    const off = onContentMessage(onMsg);
    post({ type: 'ready' });
    return off;
  }, []);

  const keymapRef = useRef(keymap);
  keymapRef.current = keymap;
  // Báo cho content script phím bật tắt cửa sổ hiện hành để nó nghe được cả khi con trỏ đang ở trang CVAT.
  useEffect(() => { post({ type: 'hotkeys', toggle: keymap['window.toggle'] ?? [] }); }, [keymap]);
  useEffect(() => { post({ type: 'dblOpen', on: sync }); }, [sync]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCapturing()) return;
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
      const combo = comboOf(e);
      const id = combo ? actionFor(keymapRef.current, combo) : null;
      if (!id) return;
      e.preventDefault();
      if (id === 'undo') dispatch({ t: 'undo' });
      else if (id === 'redo') dispatch({ t: 'redo' });
      else if (id === 'focus.cvat') focusRef.current();
      else if (id === 'window.toggle') post({ type: 'toggleWindow' });
      else emitAction(id);
    };
    const kt = keyTarget();
    kt.addEventListener('keydown', onKey as EventListener);
    return () => kt.removeEventListener('keydown', onKey as EventListener);
  }, []);

  const data = state.kind === 'ok' ? state.data : null;
  const work = draft.work;
  // Lưu nháp chưa upload (chỉ các track đã sửa) để F5 không mất công; dừng lưu khi đang chờ người dùng quyết định khôi phục.
  useEffect(() => {
    if (!data || !draft.work) return;
    const t = window.setTimeout(() => {
      if (restorableRef.current) return;
      const d = buildDraft(data.job.id, data.ann, draft.work!, draft.edited);
      if (d) kv.set(draftKey(data.job.id), JSON.stringify(d)); else kv.remove(draftKey(data.job.id));
    }, 600);
    return () => window.clearTimeout(t);
  }, [draft.work, draft.edited, data]);
  workRef.current = work;

  /** Nút Focus: thu nhỏ tool và đưa camera 3D của CVAT lại gần object đang chọn (đổi frame CVAT nếu object không có ở frame đó). */
  focusRef.current = () => {
    const w = workRef.current;
    if (selectedNum === null || !w) { setToast('Chọn một object trước khi Focus.'); return; }
    const track = w.tracks[selectedNum - 1];
    if (!track) return;
    const has = (f: number) => !!stateAt(track, f).cuboid;
    let frame: number | null = null;
    // Zoom vào object ở frame đang trỏ chuột (khi bấm phím F), không thì frame đang được chọn trong tool.
    const pref = hoverFrameRef.current ?? selFrameRef.current;
    if (pref !== null && !has(pref)) setToast(`Frame ${pref}: object không có box ở frame này (outside / chưa xuất hiện) nên không zoom vào được; dùng frame gần nhất có box.`);
    if (pref !== null && has(pref)) frame = pref;
    else if (lastCvatFrame.current !== null && has(lastCvatFrame.current)) frame = lastCvatFrame.current;
    else {
      const pool = viewFrames.current.filter(has);
      const ref = lastCvatFrame.current ?? viewFrames.current[0] ?? 0;
      if (pool.length) frame = pool.reduce((a, f) => (Math.abs(f - ref) < Math.abs(a - ref) ? f : a));
    }
    if (frame !== null) lastCvatFrame.current = frame;
    lastCvatNum.current = selectedNum;
    pointClouds.pauseBackground(30_000); // nhường server cho CVAT nạp frame rồi mới zoom
    post({ type: 'cvatFocus', num: selectedNum, frame, zoom: true, minimize: true });
  };

  /** Chọn object từ phía tool (ô nhập ID, ↑/↓, bảng object) → chuyển focus bên CVAT sang object đó. */
  const selectFromTool = (num: number) => {
    toolSelAt.current = Date.now();
    setSelectedNum(num);
    lastCvatNum.current = num; // tiếng vọng từ CVAT không kích hoạt lại
    const w = workRef.current;
    if (!pushOutRef.current || !w) return;
    const track = w.tracks[num - 1];
    if (!track) return;
    let frame: number | null = null;
    const cur = lastCvatFrame.current;
    if (cur === null || !stateAt(track, cur).cuboid) {
      // Object không có box ở frame CVAT đang mở → chọn frame có box: ưu tiên trong cửa sổ tool đang xem, rồi gần nhất.
      const inView = viewFrames.current.filter((f) => stateAt(track, f).cuboid);
      const pool = inView.length ? inView : Array.from({ length: (data?.job.stop_frame ?? 0) + 1 }, (_, i) => i).filter((f) => stateAt(track, f).cuboid);
      if (pool.length) {
        const ref = cur ?? pool[0]!;
        frame = pool.reduce((a, f) => (Math.abs(f - ref) < Math.abs(a - ref) ? f : a));
      }
    }
    if (frame !== null) lastCvatFrame.current = frame; // không để cửa sổ tool nhảy theo chính thao tác này
    if (frame !== null) pointClouds.pauseBackground(8_000);
    post({ type: 'cvatFocus', num, frame });
  };
  const ignAll = useIgnored();
  // Số gợi ý thuộc tính theo object (tính ở frame có box đầu tiên), không tính gợi ý đã bỏ qua.
  const attrHints = useMemo(() => {
    const m = new Map<number, number>();
    if (!data || !work) return m;
    const specs = parseLabelSpecs(data.labels);
    const peds = (f: number) => work.tracks
      .filter((t) => specs.get(t.label_id)?.name.toLowerCase() === 'pedestrian')
      .map((t) => stateAt(t, f).cuboid)
      .filter((c): c is NonNullable<typeof c> => !!c);
    work.tracks.forEach((t, i) => {
      const spec = specs.get(t.label_id);
      const first = t.shapes.find((s) => !s.outside);
      if (!spec || !first) return;
      const hints = suggestAttributes({ track: t, label: spec.name, spec, frame: first.frame, box: stateAt(t, first.frame).cuboid, pedestrians: peds(first.frame) });
      const n = hints.filter((h) => !ignAll.has(attrKey(data.job.id, i + 1, h.spec.id, h.scope === 'frame' ? first.frame : null))).length;
      if (n) m.set(i + 1, n);
    });
    return m;
  }, [data, work, ignAll]);
  // Chồng lấn CHÉO giữa các object ở mọi frame của job (tính lại khi nháp đổi), bỏ các cặp đã được bỏ qua.
  const labelNames = useMemo(() => new Map((data?.labels ?? []).map((l) => [l.id, l.name])), [data]);
  const trackLabels = useMemo(() => (work ? work.tracks.map((t) => labelNames.get(t.label_id) ?? '') : []), [work, labelNames]);
  const overlaps = useMemo(() => {
    if (!data || !work) return [];
    const frames: number[] = [];
    for (let f = data.job.start_frame; f <= data.job.stop_frame; f++) frames.push(f);
    return findOverlaps(work.tracks, frames, work.tracks.map((t) => labelNames.get(t.label_id) ?? '')).filter((o) => !ignAll.has(overlapKey(data.job.id, o.a, o.b)));
  }, [data, work, ignAll, labelNames]);
  const overlapFrames = useMemo(() => {
    const m = new Map<number, number>();
    for (const o of overlaps) { m.set(o.a, (m.get(o.a) ?? 0) + 1); m.set(o.b, (m.get(o.b) ?? 0) + 1); }
    return m;
  }, [overlaps]);
  const overlapPairs = useMemo(() => groupPairs(overlaps), [overlaps]);
  const madeIds = useMadeIds(data?.job.id ?? 0);
  const [deleting, setDeleting] = useState<number[] | null>(null);
  // Trôi box: vật đứng yên mà box nhích (đã bù chuyển động của xe), tính trên cả job, bỏ các frame đã bỏ qua.
  const driftAll = useMemo(() => {
    if (!data || !work) return new Map<number, { f: number; dist: number }[]>();
    const frames: number[] = [];
    for (let f = data.job.start_frame; f <= data.job.stop_frame; f++) frames.push(f);
    return new Map([...findDrift(work.tracks, frames)].map(([num, d]) => [num, d.frames]));
  }, [data, work]);
  const drift = useMemo(() => {
    const m = new Map<number, { f: number; dist: number }[]>();
    if (!data) return m;
    for (const [num, fr] of driftAll) {
      const open = fr.filter((x) => !ignAll.has(issueKey(data.job.id, num, x.f, 'T')));
      if (open.length) m.set(num, open);
    }
    return m;
  }, [driftAll, data, ignAll]);
  // Ít điểm (dưới 6 điểm trong box) + mặt đường riêng của MỌI object (fitReportAt đo mặt đường quanh từng box), tính TĂNG DẦN:
  // kết quả lưu theo (frame, object) kèm chữ ký box (mã băm vị trí / hướng / kích thước). Frame "chờ" = còn box chưa tính với đúng chữ
  // ký hiện tại; sửa nhãn chỉ làm chờ lại đúng các box đã đổi. Frame chờ được tải nền (kể cả tải lại khi đã rời bộ nhớ) và không bị
  // đẩy khỏi bộ nhớ trước khi tính xong. Kết quả được lưu theo job: tab CVAT tải lại (sau upload) thì dùng lại, không tính từ đầu.
  const [cloudTick, setCloudTick] = useState(0); // tăng mỗi lần kho point cloud đổi (tải xong / tải lỗi)
  useEffect(() => pointClouds.subscribe(() => setCloudTick((x) => x + 1)), []);
  // Tiến trình đợt tải lại: tính lại mỗi lần kho đổi và mỗi giây (để số giây chờ máy chủ chạy).
  const [, setSecTick] = useState(0);
  const reloadSt = pointClouds.reloadStatus();
  const reloading = reloadSt.total > 0;
  useEffect(() => {
    if (!reloading) return;
    const t = window.setInterval(() => setSecTick((x) => x + 1), 1000);
    return () => window.clearInterval(t);
  }, [reloading]);
  const passRes = useRef(new Map<number, Map<number, PassEntry>>());
  const passKey = data ? `cvla-pass:${data.job.id}` : null;
  const restored = useMemo(() => { passRes.current = passKey ? loadPass(passKey) : new Map(); return passKey; }, [passKey]);
  const [passTick, setPassTick] = useState(0);
  const computed = useRef(0); // số frame thực sự đã tính trong phiên này (khôi phục từ kho thì không tính)
  // Frame chờ: tính ngay trong lần vẽ (không trong effect), để tiến độ / mở khoá không bao giờ đọc một tập rỗng cũ.
  const pending = useMemo(() => {
    const out = new Set<number>();
    if (!data || !work) return out;
    const tracks = work.tracks;
    for (let f = data.job.start_frame; f <= data.job.stop_frame; f++) {
      const r = passRes.current.get(f);
      let ok = !!r;
      if (r) for (const num of r.keys()) if (num > tracks.length) ok = false;
      for (let i = 0; ok && i < tracks.length; i++) {
        const c = stateAt(tracks[i]!, f).cuboid, e = r!.get(i + 1);
        if (c ? !e || e.sig !== sigOf(c) : e) ok = false;
      }
      if (!ok) out.add(f);
    }
    return out;
  }, [data, work, passTick, restored]);
  const pendingRef = useRef(pending);
  pendingRef.current = pending;
  useEffect(() => { pointClouds.setKeep((n) => pendingRef.current.has(n)); return () => pointClouds.setKeep(() => false); }, []);
  useEffect(() => {
    if (!data || !work) return;
    const a = data.job.start_frame, tracks = work.tracks;
    const bg = new Map<number, number>();
    for (const f of pending) if (!pointClouds.peek(f) && !pointClouds.failed(f)) bg.set(f, f - a < UNLOCK_FRAMES ? 10 + f - a : 100 + f - a); // frame đầu trước (sau cửa sổ Batch Review), phần còn lại sau
    pointClouds.background(bg);
    // Ưu tiên tải: còn frame đang chờ tải thì CHƯA tính (mặt đường, ít điểm…) để băng thông và CPU dành cho việc tải; tải xong hết mới tính.
    if (bg.size > 0) return;
    let live = true;
    const timer = window.setTimeout(async () => {
      let n = 0, frames = 0;
      for (const f of pending) {
        const pc = pointClouds.peek(f);
        if (!pc) continue;
        const old = passRes.current.get(f), r = new Map<number, PassEntry>();
        for (let i = 0; i < tracks.length && live; i++) {
          const c = stateAt(tracks[i]!, f).cuboid;
          if (!c) continue;
          const sig = sigOf(c), prev = old?.get(i + 1);
          r.set(i + 1, prev && prev.sig === sig ? prev : { sig, sparse: fitReportAt(pc.xyz, pc.count, c).level === 'sparse' });
          if (++n % 40 === 0) await new Promise((res) => window.setTimeout(res, 0));
        }
        if (!live) return; // bị ngắt giữa chừng thì không ghi frame đó, lần sau tính lại
        passRes.current.set(f, r);
        frames++;
      }
      if (live && frames) { computed.current += frames; setPassTick((x) => x + 1); }
    }, 200);
    return () => { live = false; window.clearTimeout(timer); };
  }, [data, work, cloudTick, pending]);
  // Lưu kết quả (gom lại, không ghi sau từng frame).
  useEffect(() => {
    if (!passKey || !passTick) return;
    const t = window.setTimeout(() => savePass(passKey, passRes.current), 1500);
    return () => window.clearTimeout(t);
  }, [passKey, passTick]);
  // Tổng hợp: số frame ít điểm theo object (chỉ kết quả khớp box hiện tại), object còn frame chờ (số liệu chưa đáng tin), tiến độ.
  const passView = useMemo(() => {
    const sparse = new Map<number, number>(), incomplete = new Set<number>();
    if (!data || !work) return { sparse, incomplete, pending: 0, failed: 0, total: 0, loading: 0 };
    const { start_frame: a, stop_frame: b } = data.job;
    let failed = 0, waitingFrames = 0, loading = 0;
    for (let f = a; f <= b; f++) {
      const waiting = pending.has(f);
      if (waiting && pointClouds.failed(f)) { failed++; continue; } // tải lỗi sau mọi lần thử: bỏ qua, không chờ mãi
      if (waiting) { waitingFrames++; if (!pointClouds.peek(f)) loading++; }
      const r = passRes.current.get(f);
      work.tracks.forEach((t, i) => {
        const c = stateAt(t, f).cuboid;
        if (!c) return;
        const e = r?.get(i + 1);
        if (waiting && (!e || e.sig !== sigOf(c))) incomplete.add(i + 1);
        else if (e?.sparse) sparse.set(i + 1, (sparse.get(i + 1) ?? 0) + 1);
      });
    }
    return { sparse, incomplete, pending: waitingFrames, failed, total: b - a + 1, loading };
  }, [data, work, pending, cloudTick]);
  const sparseAll = passView.sparse;
  // Frame tải lỗi (vd máy chủ báo bận) không bị bỏ mặc: khi không còn frame nào đang tải thì tự thử lại sau 20 giây, tối đa 3 lần; có nút thử lại tay.
  const autoRetry = useRef(0);
  const retryFailedNow = () => { pointClouds.retryFailed(); };
  // Nút cố định trên thanh đầu: luôn bấm được, báo lại kết quả (số frame lỗi được tải lại, hoặc còn bao nhiêu frame đang tải).
  const reloadAllClouds = () => {
    if (!data) return;
    const { start_frame: a, stop_frame: b } = data.job;
    if (!confirm(`Tải lại tất cả ${b - a + 1} frame point cloud từ máy chủ? Mất khoảng 1–5 phút (hàng trăm MB); số liệu đã tính vẫn giữ.`)) return;
    autoRetry.current = 0;
    pointClouds.abortInFlight();
    setToast(`Đang tải lại ${pointClouds.reloadAll(a, b)} frame…`);
  };
  const reloadClouds = () => {
    autoRetry.current = 0;
    pointClouds.abortInFlight(); // ngắt cả request đang treo để giải phóng kết nối máy chủ
    const n = pointClouds.retryFailed();
    setToast(n ? `Đã ngắt request đang chạy, đang tải lại ${n} frame lỗi…` : passView.loading > 0 ? `Không có frame lỗi; đã ngắt request đang chạy và tải lại ${passView.loading} frame chưa về.` : 'Không có frame lỗi cần tải lại.');
  };
  useEffect(() => {
    if (passView.failed === 0) { autoRetry.current = 0; return; }
    if (passView.loading > 0 || autoRetry.current >= 3) return;
    const t = window.setTimeout(() => { autoRetry.current++; retryFailedNow(); }, 20000);
    return () => window.clearTimeout(t);
  }, [passView.failed, passView.loading]);
  // Batch Review mở được khi UNLOCK_FRAMES frame đầu đã tải xong (hoặc đã có kết quả lưu / tải lỗi; job ngắn hơn: cả job); số liệu của phần
  // còn lại tự cập nhật sau (ô chưa đủ có viền vàng). Đã mở thì giữ nguyên
  // cho job đó. Báo "đã tải xong" (một lần mỗi job) khi không còn frame chờ — chỉ khi phiên này đã thực sự tính (khôi phục thì không).
  const [readyJob, setReadyJob] = useState<number | null>(null);
  const ready = !!data && readyJob === data.job.id;
  const readyRef = useRef(false);
  readyRef.current = ready;
  const [doneJob, setDoneJob] = useState<number | null>(null);
  const [doneNote, setDoneNote] = useState('');
  useEffect(() => {
    if (!data || !work) return;
    const { pending: waiting, failed, total } = passView;
    if (!ready) {
      const a = data.job.start_frame;
      let ok = true;
      for (let f = a; f < a + Math.min(UNLOCK_FRAMES, total); f++) if (pending.has(f) && !pointClouds.peek(f) && !pointClouds.failed(f)) ok = false;
      if (ok) setReadyJob(data.job.id);
    }
    if (waiting === 0 && doneJob !== data.job.id) {
      setDoneJob(data.job.id);
      if (computed.current > 0) setDoneNote(`Job ${data.job.id}: đã tải ${total - failed}/${total} frame${failed ? ` (${failed} frame tải lỗi, bỏ qua)` : ''}, đo xong mặt đường cho ${work.tracks.length} object (trong bán kính ${DEFAULT_GROUND.maxRange} m quanh ego), đã tính trôi box (${driftAll.size} object có trôi). Mọi số liệu trong bảng đã đầy đủ.`);
    }
  }, [data, work, passView, ready, doneJob, driftAll]);
  const openReview = () => {
    if (readyRef.current) setTab('review');
    else setToast(`Batch Review mở được khi ${Math.min(UNLOCK_FRAMES, passView.total)} frame đầu đã tải xong (xem tiến độ phía trên).`);
  };
  // Trước khi tool tự tải lại tab CVAT (sau upload / xóa): ghi lại chỗ đang làm; tool mở lại thì về đúng chỗ (hiệu lực 2 phút).
  const here = useRef({ job: 0, tab, num: selectedNum, start: startFrame }); // trạng thái mới nhất (hộp thoại giữ hàm cũ)
  here.current = { job: data?.job.id ?? 0, tab, num: selectedNum, start: startFrame };
  const saveResume = () => {
    if (here.current.job) kv.set('cvla-resume', JSON.stringify({ ...here.current, at: Date.now() }));
  };
  const [resumeTab, setResumeTab] = useState<Tab | null>(null);
  useEffect(() => {
    if (!data) return;
    const raw = kv.get('cvla-resume');
    if (!raw) return;
    kv.remove('cvla-resume');
    try {
      const r = JSON.parse(raw) as { job: number; tab: Tab; num: number | null; start: number; at: number };
      if (r.job !== data.job.id || Date.now() - r.at > 120_000) return;
      if (r.num) setSelectedNum(r.num);
      if (Number.isInteger(r.start)) setStartFrame(r.start);
      setResumeTab(r.tab);
    } catch { /* bỏ qua */ }
  }, [data?.job.id]);
  useEffect(() => {
    if (!resumeTab || (resumeTab === 'review' && !ready)) return; // Batch Review: chờ tới khi mở được
    setTab(resumeTab);
    setResumeTab(null);
  }, [resumeTab, ready]);
  const rows = useMemo(
    () => (data && work
      ? buildRows(work, data.labels, data.job.start_frame, data.job.stop_frame, (num, f) => ignAll.has(motionKey(data.job.id, num, f)), (num, f, k) => ignAll.has(issueKey(data.job.id, num, f, k)), new Set(madeIds)).map((r) => {
        const dr = drift.get(r.num) ?? [], sn = sparseAll.get(r.num) ?? 0;
        return { ...r, drift: dr.length, driftFrames: dr.map((x) => x.f), issues: r.issues + sn, issuesByKind: { ...r.issuesByKind, ...(sn ? { P: sn } : {}) } };
      })
      : []),
    [data, work, ignAll, madeIds, drift, sparseAll],
  );

  /** Xóa object do tool tạo: trong nháp thì bỏ khỏi nháp; đã upload thì mở hộp thoại xóa trên CVAT (chỉ ID trong sổ của tool). */
  const deleteMade = (r: { num: number; id: number; made: 'draft' | 'server' | null }) => {
    if (!data || r.made === null) return;
    if (r.made === 'draft') {
      if (!confirm(`Xóa object #${r.num} (do tool tạo, đang trong nháp)? Chưa có gì trên CVAT nên không ảnh hưởng server.`)) return;
      dispatch({ t: 'removeTrack', idx: r.num - 1 });
      if (selectedNum !== null && selectedNum >= r.num) setSelectedNum(selectedNum > r.num ? selectedNum - 1 : null);
      setToast(`Đã xóa object #${r.num} khỏi nháp. (Hoàn tác / làm lại bị làm mới.)`);
      return;
    }
    if (draft.edited.size) { setToast('Hãy upload hoặc bỏ nháp trước khi xóa object trên CVAT (ID hiển thị sẽ đổi nên nháp không còn đúng).'); return; }
    setDeleting([r.id]);
  };

  const reload = () => {
    if (draft.edited.size && !confirm(`Có ${draft.edited.size} frame đã sửa chưa upload. Tải lại sẽ bỏ nháp. Tiếp tục?`)) return;
    post({ type: 'load' });
  };

  const tabBtn = (t: Tab, label: string) => (
    <button
      onClick={() => (t === 'review' ? openReview() : setTab(t))}
      disabled={t === 'review' && !ready}
      title={t === 'review' && !ready ? 'Mở được khi đã tải xong point cloud mọi frame và tính xong mặt đường / trôi box' : undefined}
      className={tab === t ? 'cvla-tab cvla-tab-on' : 'cvla-tab'}
    >
      {label}
    </button>
  );

  return (
    <div className={skin === 'dark' ? 'cvla-root cvla-dark' : skin === 'gray' ? 'cvla-root cvla-gray' : 'cvla-root'} style={{ font: '13px/1.4 system-ui', padding: 10, color: '#111' }}>
      <style>{STYLE}</style>
      <div className="cvla-head">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 6 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <b>CVAT 3D Assistant · v{VERSION}</b>
        <ShiftBadge onOpen={() => setTab('shift')} />
        </span>
        <span>
          <label title="Khi bạn chọn một object trong giao diện CVAT, tool tự chọn object đó và nhảy tới frame hiện tại của CVAT">
            <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> CVAT → tool
          </label>{' '}
          <label title="Khi bạn chọn object trong tool, giao diện CVAT chuyển focus sang object đó (đổi frame nếu object không có ở frame hiện tại)">
            <input type="checkbox" checked={pushOut} onChange={(e) => setPushOut(e.target.checked)} /> tool → CVAT
          </label>{' '}
          <button onClick={() => focusRef.current()} disabled={selectedNum === null} title="Thu nhỏ tool và đưa camera 3D của CVAT lại gần object đang chọn (như bấm đúp vào object trong CVAT). Phím F.">🎯 Focus</button>{' '}
          <button onClick={() => setTheme(THEME_NEXT[theme])} title="Giao diện: tự động (theo hệ điều hành) → tối → xám → sáng">{THEME_LABEL[theme]}</button>{' '}
          <button onClick={reload}>Tải lại</button>
        </span>
      </div>
      <div style={{ margin: '6px 0 0', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 4 }}>
        {tabBtn('objects', 'Bảng object')}
        {tabBtn('review', 'Batch Review')}
        {tabBtn('shift', 'Ca / KPI')}
        {tabBtn('qc', 'QC')}
        {tabBtn('dyn', 'Dynamic size')}
        {tabBtn('keys', 'Phím tắt')}
        {tabBtn('job', 'Thông tin job')}
        {data && (reloadMenu ? (
          <span style={{ marginLeft: 8 }}>
            Tải lại:{' '}
            <button onClick={() => { setReloadMenu(false); reloadClouds(); }} title="Chỉ tải lại các frame lỗi (frame đang tải thì giữ nguyên)">Chỉ frame lỗi{passView.failed ? <span className="cvla-badge">{passView.failed}</span> : null}</button>{' '}
            <button onClick={() => { setReloadMenu(false); reloadAllClouds(); }} title="Bỏ hết point cloud đã tải và tải lại cả job từ máy chủ">Tất cả {data.job.stop_frame - data.job.start_frame + 1} frame</button>{' '}
            <button onClick={() => setReloadMenu(false)} title="Đóng menu">✕</button>
          </span>
        ) : (
          <button onClick={() => setReloadMenu(true)} style={{ marginLeft: 8 }} title="Tải lại point cloud: chọn chỉ frame lỗi hoặc tất cả">↻ Tải lại frame ▾{passView.failed ? <span className="cvla-badge">{passView.failed}</span> : null}</button>
        ))}
        {data && (
          <span style={{ marginLeft: 12, padding: '2px 6px', background: draft.edited.size ? '#fff3cd' : '#eee' }}>
            Nháp: <b>{draft.edited.size}</b> frame chưa upload <Help text="Các chỉnh sửa chỉ nằm trong bộ nhớ (và bản lưu cục bộ để F5 không mất) cho tới khi bạn bấm Upload lên CVAT." />{' '}
            <button disabled={!draft.undo.length} onClick={() => dispatch({ t: 'undo' })}>Hoàn tác</button>{' '}
            <button disabled={!draft.redo.length} onClick={() => dispatch({ t: 'redo' })}>Làm lại</button>{' '}
            <button
              disabled={!draft.edited.size}
              onClick={() => { if (confirm('Bỏ toàn bộ chỉnh sửa trong nháp?')) dispatch({ t: 'reset', baseline: data.ann }); }}
            >Bỏ nháp</button>{' '}
            <button className={draft.edited.size ? 'cvla-primary' : undefined} onClick={() => setUploading(true)} style={{ fontWeight: 700 }}>⬆ Upload lên CVAT…{draft.edited.size ? <span className="cvla-badge">{draft.edited.size}</span> : null}</button>
          </span>
        )}
      </div>
      </div>
      <ShiftBanner pending={draft.edited.size} onUpload={() => setUploading(true)} />
      {restorable && data && (
        <div style={{ background: '#e0f2fe', border: '1px solid #38bdf8', padding: '4px 8px', margin: '6px 0' }}>
          Có <b>bản nháp chưa upload</b> từ lần trước ({new Date(restorable.savedAt).toLocaleString()}): {restorable.edited.length} frame đã sửa, {Object.keys(restorable.tracks).length} object.{' '}
          <button style={{ fontWeight: 700 }} onClick={() => {
            const r = applyDraft(restorable, data.ann);
            dispatch({ t: 'restore', work: r.work, edited: r.edited });
            restorableRef.current = null; setRestorable(null);
            setToast(r.skipped.length ? `Đã khôi phục nháp; bỏ qua object ${r.skipped.join(', ')} (ID không còn khớp).` : 'Đã khôi phục bản nháp.');
          }}>Khôi phục</button>{' '}
          <button onClick={() => { kv.remove(draftKey(data.job.id)); restorableRef.current = null; setRestorable(null); }}>Bỏ bản nháp</button>
        </div>
      )}
      {draftNote && <div style={{ background: '#fff3cd', border: '1px solid #e0b000', padding: '4px 8px', margin: '6px 0' }}>{draftNote} <button onClick={() => setDraftNote('')}>×</button></div>}
      {deleting && data && (
        <DeleteDialog
          job={data.job} baseline={data.ann} labels={data.labels} ids={deleting}
          onClose={() => setDeleting(null)} onDone={() => { setDeleting(null); post({ type: 'load' }); }} onBeforeReload={saveResume}
        />
      )}
      {uploading && data && work && (
        <UploadDialog
          baseline={data.ann} working={work} job={data.job} labels={data.labels}
          onClose={() => setUploading(false)} onBeforeReload={saveResume}
          onUploaded={(tracks) => {
            // đã lên CVAT thì không còn là nháp: xóa ngay để lần nạp lại / F5 không hiện lại "bản nháp chưa upload"
            kv.remove(draftKey(data.job.id)); restorableRef.current = null; setRestorable(null);
            shiftStore.upload({ time: new Date().toISOString(), jobId: data.job.id, tracks });
          }}
          onReload={() => {
            setUploading(false);
            openReview();
            setToast('Đã upload thành công, tool đã nạp lại dữ liệu từ CVAT. Nếu CVAT không tự tải lại, hãy F5 tab CVAT trước khi bấm Save ở đó.');
            post({ type: 'load' });
          }}
        />
      )}
      {data && reloading && (
        <div style={{ background: '#eef4ff', border: '1px solid #7aa2e3', padding: '4px 8px', margin: '6px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <progress value={reloadSt.total - reloadSt.left} max={reloadSt.total} style={{ width: 160 }} />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            ↻ Đang tải lại: <b>{reloadSt.total - reloadSt.left}/{reloadSt.total}</b> frame đã về
            {reloadSt.chunks.map((c) => (
              <span key={c.k}> · chunk {c.k}: {c.got === 0 ? `chờ máy chủ dựng (${c.secs} s, thường 20–30 s)` : `đang nhận ${c.got}/${c.count} file (${c.secs} s)`}</span>
            ))}
            {reloadSt.chunks.length === 0 ? ' · đang tải từng frame' : ''}
          </span>
        </div>
      )}
      {data && passView.pending > 0 && (
        <div style={{ background: '#eef4ff', border: '1px solid #7aa2e3', padding: '4px 8px', margin: '6px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          <progress value={passView.total - passView.pending} max={passView.total} style={{ width: 160 }} />
          <span style={{ fontVariantNumeric: 'tabular-nums' }}>
            ⏳ {passView.loading > 0
              ? <>Đang tải point cloud: còn <b>{passView.loading}</b> frame (mặt đường và ít điểm sẽ tính sau khi tải xong)</>
              : <>{ready ? 'Đang tính phần còn lại' : 'Đang tính'}: đã tính xong <b>{passView.total - passView.pending - passView.failed}/{passView.total}</b> frame (mặt đường, ít điểm)</>}{passView.failed ? ` · ${passView.failed} frame tải lỗi, bỏ qua` : ''} · trôi box: đã tính.{' '}
            {ready ? <>Ô có <span style={PENDING_STYLE}>viền vàng</span>: số liệu chưa đủ, tự cập nhật khi tải xong.</> : `Batch Review mở được khi ${Math.min(UNLOCK_FRAMES, passView.total)} frame đầu tải xong.`}{' '}
            <button onClick={retryFailedNow} title="Tải lại các frame lỗi ngay (frame đang tải thì giữ nguyên)">↻ Tải lại</button>
          </span>
        </div>
      )}
      {data && passView.failed > 0 && (
        <div style={{ background: '#fff4e5', border: '1px solid #e0a040', padding: '4px 8px', margin: '6px 0', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
          ⚠ <b>{passView.failed}</b> frame tải lỗi (thường do máy chủ báo bận), nên chưa có số liệu mặt đường / ít điểm của các frame đó.
          <button onClick={() => { autoRetry.current = 0; retryFailedNow(); }}>↻ Tải lại các frame lỗi</button>
          <span style={{ color: '#666' }}>{autoRetry.current < 3 ? `Tự thử lại sau 20 giây (đã thử ${autoRetry.current}/3).` : 'Đã tự thử 3 lần; bấm nút để thử tiếp.'}</span>
        </div>
      )}
      {doneNote && (
        <div style={{ background: '#e8ffe8', border: '1px solid #0a0', padding: 6, margin: '6px 0' }}>
          ✅ <b>Đã tải xong.</b> {doneNote} <button onClick={() => setDoneNote('')}>×</button>
        </div>
      )}
      {toast && (
        <div style={{ background: '#e8ffe8', border: '1px solid #0a0', padding: 6, margin: '6px 0' }}>
          {toast} <button onClick={() => setToast('')}>×</button>
        </div>
      )}
      {state.kind === 'loading' && (
        <div>
          <p>Đang đọc…</p>
          {stuck && (
            <p style={{ background: '#fff3cd', padding: 6, border: '1px solid #e0b100' }}>
              Chưa nhận được dữ liệu từ trang CVAT sau 6 giây. Chế độ panel: <b>{diag.mode === 'inpage' ? 'nhúng trong trang' : 'khung (iframe)'}</b>.{' '}
              {diag.rejected
                ? `Đã bỏ qua ${diag.rejected} tin nhắn (lý do: ${diag.lastReason}; origin ${diag.lastOrigin || '?'}, mong đợi ${diag.expectedOrigin}).`
                : 'Chưa có tin nhắn nào gửi tới panel.'}{' '}
              Mở Console (F12) và tìm "[CVLA]" để xem chi tiết; bấm "Tải lại" để thử lại.
            </p>
          )}
        </div>
      )}
      {state.kind === 'error' && <p style={{ color: '#b00' }}>Lỗi: {state.message}</p>}
      {data && data.removedIds.length > 0 && (
        <div style={{ background: '#fdd', border: '1px solid #b00', padding: 8, marginBottom: 8 }}>
          CẢNH BÁO: ID đã biến mất so với lần đọc trước: {data.removedIds.join(', ')}
        </div>
      )}
      {data && work && tab === 'objects' && (
        <ObjectTable
          onDelete={deleteMade} rows={rows} hints={attrHints} overlapFrames={overlapFrames} overlapPairs={overlapPairs} incomplete={passView.incomplete}
          tracks={work.tracks} start={data.job.start_frame} stop={data.job.stop_frame} cvatFrame={focus?.frame ?? null}
          onOpen={(num, first) => {
            selectFromTool(num);
            setStartFrame(first ?? data.job.start_frame);
            openReview();
          }}
        />
      )}
      {data && work && tab === 'qc' && (
        <QcPanel
          jobId={data.job.id} count={work.tracks.length} tracks={work.tracks} start={data.job.start_frame} stop={data.job.stop_frame}
          labels={trackLabels}
          onOpen={(num, frame) => { selectFromTool(num); setStartFrame(frame); openReview(); }}
        />
      )}
      {data && work && tab === 'review' && (
        <BatchReview
          overlaps={overlaps} drift={driftAll}
          labels={data.labels} job={data.job} ann={work} rows={rows} selectedNum={selectedNum} setSelectedNum={selectFromTool}
          onSel={(f) => { selFrameRef.current = f; }}
          onHoverFrame={(f) => { hoverFrameRef.current = f; }}
          onFocusFrame={(f) => { selFrameRef.current = f; hoverFrameRef.current = f; focusRef.current(); }}
          onView={(f) => {
            viewFrames.current = f;
            if (f.length) setStartFrame(f[0]!);
          }} initialFrame={startFrame} edited={draft.edited} focus={focus}
          onEdit={(idx, frame, cub, sizeAll) => { dispatch({ t: 'edit', idx, frame, cub, sizeAll }); shiftStore.edit(data.job.id, idx + 1); }}
          onTrack={(idx, track, frames) => { dispatch({ t: 'track', idx, track, frames }); shiftStore.edit(data.job.id, idx + 1); }}
          onSplit={(idx, resume) => {
            const t = work.tracks[idx];
            const r = t ? splitTrack(t, resume, data.job.stop_frame) : null;
            if (!r) return null;
            dispatch({ t: 'split', idx, oldTrack: r.oldTrack, newTrack: r.newTrack, frames: r.frames });
            shiftStore.edit(data.job.id, idx + 1);
            return work.tracks.length + 1; // số thứ tự (ID hiển thị) của object mới: nằm cuối danh sách
          }}
        />
      )}
      {data && work && tab === 'dyn' && <DynSizePanel jobId={data.job.id} labels={data.labels} tracks={work.tracks} />}
      {tab === 'shift' && <ShiftPanel />}
      {tab === 'keys' && <KeysPanel map={keymap} setMap={setKeymap} />}
      {data && tab === 'job' && <JobInfo s={summarize(data.job, data.labels, data.ann)} />}
    </div>
  );
}
