import { propagateEdit, propagateSize } from '../shared/dynsize';
import { findOverlaps, groupPairs } from '../shared/overlap';
import { applyDraft, buildDraft, checkDraft, draftKey, type SavedDraft } from '../shared/draft';
import { hostScope, kv, onStorageHealth, storageHealth } from './storage';
import { seenStore } from './seenStore';
import { useRefState } from './refStore';
import { api } from '../shared/api';
import { useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import type { Cuboid } from '../shared/cuboid';
import { upsertKeyframe } from '../shared/edit';
import { actionFor, comboOf } from '../shared/keymap';
import { estimateEgo, setEgo } from '../shared/ego';
import { clientIdOf, numOfClientId, setCvatIds, useCvatIdVersion } from './cvatIds';
import { configureLoading, LOAD_MODES, loadMode, setLoadMode, type LoadMode } from './loadMode';
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
import { ThresholdPanel } from './ThresholdPanel';
import { CameraTab } from './CameraPanel';
import { ColorPanel } from './ColorPanel';
import { SettingsIO } from './SettingsIO';
import { thresholdStore, useThresholdVersion } from './thresholdStore';
import { backgroundConfigKey } from '../shared/thresholds';
import { Help, PENDING_STYLE } from './ui';
import { pointClouds, type ChunkSource } from './stores';
import { ShiftBadge, ShiftBanner } from './ShiftBar';
import { dropSupported, findDrift } from '../shared/drift';
import { fitReportAt } from '../shared/fit';
import { loadPass, savePass, sigOf, type PassEntry } from './passStore';
import { DEFAULT_GROUND } from '../shared/ground';
import { findLateStart, outsideBeforeAppear, splitTrack } from '../shared/splitId';
import { DeleteDialog } from './DeleteDialog';
import { madeStore, useMadeIds } from './madeStore';
import { deletableIds, lockStore, useLockedIds } from './lockStore';
import { defaultDyn, dynClassStore, useDynClasses, useDynRules } from './dynClassStore';
import { resolveDyn } from '../shared/dynrule';
import { ATTRS_OF, SIZE_SYNC, trackIssues } from '../shared/qcrules';
import { ShiftPanel } from './ShiftPanel';
import { attrKey, ignoreStore, issueKey, motionKey, overlapKey, shiftStore, useIgnored, useShifts } from './shiftStore';
import { getAttr, parseLabelSpecs } from '../shared/attributes';
import { suggestAttributes } from '../shared/attrSuggest';
import { fmtDuration, shiftName, computeKpi } from '../shared/shift';
import { emitAction, isCapturing, useKeymap } from './actions';
import { ObjectTable, type ObjFlags } from './ObjectTable';
import { motionJump } from '../shared/motion';
import { setOutsideRange } from '../shared/keyframes';
import { setAttrFrom, setAttrStatic } from '../shared/attributes';
import { STYLE } from './styles';
import { Notice } from './Notice';
import { Icon } from './Icon';
import { ConfirmHost } from './Dialogs';
import { askConfirm } from './confirmStore';
import { Tutorial, tutorialSeen } from './Tutorial';
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
// version_name (vd. "1.5.0") nếu có: manifest chỉ nhận số ở "version"
try { const m = api.runtime.getManifest() as chrome.runtime.Manifest & { version_name?: string }; VERSION = m.version_name ?? m.version; } catch { /* extension vừa được Reload */ }

const EMPTY: Draft = { work: null, edited: new Set<string>(), undo: [], redo: [] };

type State = { kind: 'loading' } | { kind: 'error'; message: string } | { kind: 'ok'; data: Data };
type Tab = 'objects' | 'review' | 'ref' | 'shift' | 'qc' | 'dyn' | 'thr' | 'cam' | 'color' | 'keys' | 'job';
/** Tải ưu tiên ngần này frame đầu; tải xong là mở được Batch Review (job ngắn hơn: cả job), phần còn lại tải và tính ngầm. */
const UNLOCK_FRAMES = 6;


type Theme = 'auto' | 'dark' | 'gray' | 'light';
const THEME_LABEL: Record<Theme, string> = { auto: 'Tự động', dark: 'Tối', gray: 'Xám', light: 'Sáng' };
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
  const [menu, setMenu] = useState<'settings' | 'more' | null>(null); // menu nổi trên thanh đầu (⚙ tùy chọn nhanh, ⋯ thao tác với nháp)
  const menuRef = useRef<HTMLDivElement>(null);
  const [tutorial, setTutorial] = useState(false); // hướng dẫn dùng lần đầu / xem lại
  const tutorialAuto = useRef(false);
  const [showProgress, setShowProgress] = useState(false); // chi tiết tiến độ tải (bấm chip ở thanh đầu)
  const lastSettings = useRef<Tab>('thr'); // tab con của "Cài đặt" dùng gần nhất
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(null); };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [menu]);
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
        window.setTimeout(() => post({ type: 'readIds' }), 1500); // CVAT đã nạp xong danh sách object chưa thì chưa chắc: người dùng bấm phím để đọc lại
        dynClassStore.ensure(m.job.id, m.labels.map((l) => l.name)); // lấy class của job một lần
        // Point cloud tải theo chunk như giao diện CVAT (ít request, máy chủ không phải đọc lại chunk cho từng frame); không biết cỡ chunk
        // hoặc job không phải 3D thì chỉ tải từng frame.
        // Job ground truth chỉ gồm một số frame chọn lọc: thứ tự trong chunk khác dải start…stop → không dùng chunk.
        const chunkSrc: ChunkSource | null = m.chunkSize && m.job.dimension !== '2d' && m.job['type'] !== 'ground_truth'
          ? { start: m.job.start_frame, stop: m.job.stop_frame, size: m.chunkSize, stream: streamChunk }
          : null;
        chunkSrcRef.current = chunkSrc;
        configureLoading(m.job.start_frame, m.job.stop_frame, chunkSrc);
      } else if (m.type === 'cvatIds') {
        if (m.ok) { setCvatIds(m.pairs); setToast(`Đã lấy ID từ CVAT cho ${m.pairs.length} object.`); }
        else setToast(`Chưa đọc được ID từ CVAT (${m.reason ?? 'không rõ lý do'}). Mở một frame có object trong CVAT rồi bấm lại.`);
      } else if (m.type === 'cvatDbl') {
        // Bấm đúp trong CVAT: chọn object đó và chuyển sang Batch Review; ô "CVAT → tool" tắt thì bỏ qua (content script cũng không gửi).
        const dn = workRef.current ? numOfClientId(workRef.current.tracks, m.num) : null;
        if (syncRef.current && dn !== null) {
          lastCvatNum.current = dn;
          setSelectedNum(dn);
          if (readyRef.current) setTab('review'); // Batch Review chỉ mở khi đã tải xong
          if (m.frame !== null) {
            lastCvatFrame.current = m.frame;
            setFocus({ frame: m.frame, nonce: Date.now() });
          }
        }
      } else if (m.type === 'cvat') {
        // Chọn object / đổi frame trong giao diện CVAT → tool chọn đúng object đó.
        const cn = m.num !== null && workRef.current ? numOfClientId(workRef.current.tracks, m.num) : null;
        if (syncRef.current && cn !== null && cn !== lastCvatNum.current && Date.now() - toolSelAt.current > 5000) {
          lastCvatNum.current = cn;
          setSelectedNum(cn);
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
  const tabRef = useRef(tab);
  tabRef.current = tab;
  // Báo cho content script phím bật tắt cửa sổ hiện hành để nó nghe được cả khi con trỏ đang ở trang CVAT.
  useEffect(() => { post({ type: 'hotkeys', toggle: keymap['window.toggle'] ?? [] }); }, [keymap]);
  useEffect(() => { post({ type: 'dblOpen', on: sync }); }, [sync]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isCapturing()) return;
      const tag = (e.target as HTMLElement)?.tagName;
      const inField = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
      // Esc ở tab bất kỳ: về Bảng object (riêng tab Ref: về Batch Review). Bỏ qua khi Esc đã có việc khác (menu / hộp thoại đang mở, đang chọn khoảng, phím bổ trợ).
      if (e.key === 'Escape') {
        if (e.defaultPrevented || e.ctrlKey || e.altKey || e.shiftKey || e.metaKey) return;
        if (rootRef.current?.querySelector('.cvla-modal-back, .cvla-menu')) return;
        // Đang đứng trong ô nhập / ô chọn (vd. ô Object ID, ô chọn mặt đường của cột frame): Esc đầu tiên chỉ rời ô đó (tránh bỏ dở lúc đang gõ), Esc kế tiếp mới đổi tab.
        if (inField) { (e.target as HTMLElement).blur(); return; }
        if (tabRef.current === 'ref') setTab('review');
        else if (tabRef.current !== 'objects') setTab('objects');
        return;
      }
      if (inField) return;
      const combo = comboOf(e);
      const id = combo ? actionFor(keymapRef.current, combo) : null;
      if (!id) return;
      e.preventDefault();
      if (id === 'undo') dispatch({ t: 'undo' });
      else if (id === 'redo') dispatch({ t: 'redo' });
      else if (id === 'focus.cvat') focusRef.current();
      else if (id === 'window.toggle') post({ type: 'toggleWindow' });
      else if (id === 'ids.remap') syncIdsRef.current();
      else emitAction(id);
    };
    const kt = keyTarget();
    kt.addEventListener('keydown', onKey as EventListener);
    return () => kt.removeEventListener('keydown', onKey as EventListener);
  }, []);

  const data = state.kind === 'ok' ? state.data : null;
  // Lần đầu dùng tool: hiện hướng dẫn một lần khi đã có dữ liệu job (bỏ qua hoặc xong là không hiện lại; xem lại ở menu ⚙).
  useEffect(() => {
    if (data && !tutorialAuto.current) { tutorialAuto.current = true; if (!tutorialSeen()) setTutorial(true); }
  }, [data]);
  const storeHealth = useSyncExternalStore(onStorageHealth, storageHealth); // lỗi ghi kho (extension vừa Reload, kho đầy): báo ngay, không mất lặng lẽ
  const chunkSrcRef = useRef<ChunkSource | null>(null);
  const [lmode, setLmode] = useState<LoadMode>(loadMode);
  const work = draft.work;
  // Object mở xem trong Batch Review: ghi lại để bảng object gạch chân ID đã xem.
  useEffect(() => {
    if (tab !== 'review' || !data || !work || selectedNum === null) return;
    const id = work.tracks[selectedNum - 1]?.id;
    if (typeof id === 'number') seenStore.add(data.job.id, id);
  }, [tab, selectedNum, data, work]);
  // Chuyển động của xe (xoay + tịnh tiến mỗi frame) ước lượng từ các box của job lúc nạp; đặt trước mọi phép tính cảnh báo đi xa (Y).
  useMemo(() => {
    const e = data ? estimateEgo(data.ann.tracks, data.job.start_frame, data.job.stop_frame) : null;
    setEgo(e);
    return e;
  }, [data]);
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
    post({ type: 'cvatFocus', num: clientIdOf(workRef.current?.tracks ?? [], selectedNum), frame, zoom: true, minimize: true });
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
    post({ type: 'cvatFocus', num: clientIdOf(w.tracks, num), frame });
  };
  const ignAll = useIgnored();
  // Ngưỡng cảnh báo chỉnh tay (tab Threshold): mỗi lần đổi, các phép tính dùng ngưỡng tính lại; ngưỡng riêng theo object nạp theo job.
  const thrVer = useThresholdVersion();
  useEffect(() => { if (data) thresholdStore.setJob(data.job.id); }, [data?.job.id]);
  // Luật S (scale không đồng bộ) theo Dynamic size của chính job: object KHÔNG dynamic (theo công tắc riêng > attribute > class) thì phải cùng kích thước.
  const dynJobId = data?.job.id ?? 0;
  const dynMap = useDynClasses(dynJobId);
  const dynRules = useDynRules(dynJobId);
  useMemo(() => {
    if (!data) { SIZE_SYNC.fn = null; ATTRS_OF.fn = null; return; }
    const specs = parseLabelSpecs(data.labels);
    ATTRS_OF.fn = (track, f) => {
      const o: Record<string, string> = {};
      for (const a of specs.get(track.label_id)?.attrs ?? []) o[a.name.trim().toLowerCase()] = getAttr(track, f, a) ?? a.def;
      return o;
    };
    SIZE_SYNC.fn = (track, label, num) => {
      let own: boolean | null = null;
      try { const v = num !== undefined ? kv.get(`cvla-dyn:${data.job.id}:${num}`) : null; if (v === '1') own = true; else if (v === '0') own = false; } catch { /* bỏ qua */ }
      return !(own ?? resolveDyn(track, specs.get(track.label_id), dynMap[label] ?? defaultDyn(label), dynRules).dyn);
    };
  }, [data?.job.id, data?.labels, dynMap, dynRules]);
  useEffect(() => { if (data) thresholdStore.changed(); }, [dynMap, dynRules]);
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
  // Chồng lấn thô (kể cả cặp đã bỏ qua): cặp đã bỏ qua không báo lỗi nhưng vẫn được ghi chú ở từng frame trong Batch Review.
  const overlapsRaw = useMemo(() => {
    if (!data || !work) return [];
    const frames: number[] = [];
    for (let f = data.job.start_frame; f <= data.job.stop_frame; f++) frames.push(f);
    return findOverlaps(work.tracks, frames, work.tracks.map((t) => labelNames.get(t.label_id) ?? ''));
  }, [data, work, labelNames, thrVer]);
  const overlaps = useMemo(() => (data ? overlapsRaw.filter((o) => !ignAll.has(overlapKey(data.job.id, o.a, o.b))) : []), [overlapsRaw, ignAll, data]);
  const overlapsIgnored = useMemo(() => (data ? overlapsRaw.filter((o) => ignAll.has(overlapKey(data.job.id, o.a, o.b))) : []), [overlapsRaw, ignAll, data]);
  const overlapFrames = useMemo(() => {
    const m = new Map<number, number>();
    for (const o of overlaps) { m.set(o.a, (m.get(o.a) ?? 0) + 1); m.set(o.b, (m.get(o.b) ?? 0) + 1); }
    return m;
  }, [overlaps]);
  const overlapPairs = useMemo(() => groupPairs(overlaps), [overlaps]);
  const madeIds = useMadeIds(data?.job.id ?? 0);
  const lockedIds = useLockedIds(data?.job.id ?? 0);
  const deletable = useMemo(() => deletableIds(madeIds, lockedIds, (data?.ann.tracks ?? []).map((t) => t.id).filter((x): x is number => typeof x === 'number')), [madeIds, lockedIds, data]);
  const [deleting, setDeleting] = useState<number[] | null>(null);
  // Trôi box: toạ độ ego của box không đổi trong khi xe chạy (box đi theo xe), tính trên cả job, bỏ các frame đã bỏ qua.
  // Kết quả vòng tính nền (ít điểm, số điểm trong box) theo frame → số thứ tự object; khai báo ở đây vì cảnh báo trôi box cũng dùng.
  const passRes = useRef(new Map<number, Map<number, PassEntry>>());
  const [passTick, setPassTick] = useState(0);
  const bgKey = useRef(backgroundConfigKey());
  useEffect(() => {
    const k = backgroundConfigKey();
    if (k === bgKey.current) return;
    bgKey.current = k;
    passRes.current = new Map(); // ngưỡng lệch / ít điểm / mặt đường đổi: kết quả đã tính không còn đúng, tính lại cho mọi frame
    setPassTick((x) => x + 1);
  }, [thrVer]);
  const passKey = data ? `cvla-pass:${data.job.id}` : null;
  const restored = useMemo(() => { passRes.current = passKey ? loadPass(passKey) : new Map(); return passKey; }, [passKey]);
  const driftAll = useMemo(() => {
    if (!data || !work) return new Map<number, { f: number; dist: number }[]>();
    const frames: number[] = [];
    for (let f = data.job.start_frame; f <= data.job.stop_frame; f++) frames.push(f);
    // Bỏ các frame đầu của chuỗi mà box vẫn còn đủ điểm (vật chạy cùng vận tốc với xe): cần số điểm từ vòng tính nền (passRes);
    // chưa tính tới thì giữ nguyên cảnh báo, tính xong tự gỡ.
    return new Map([...findDrift(work.tracks, frames)]
      .map(([num, d]) => [num, dropSupported(d.frames, (f) => passRes.current.get(f)?.get(num)?.n)] as const)
      .filter(([, fs]) => fs.length)
      .map(([num, fs]) => [num, fs] as [number, { f: number; dist: number }[]]));
  }, [data, work, passTick, restored, thrVer]);
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
          if (prev && prev.sig === sig) r.set(i + 1, prev);
          else { const rep = fitReportAt(pc.xyz, pc.count, c); r.set(i + 1, { sig, sparse: rep.level === 'sparse', n: rep.inside }); }
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
  const reloadAllClouds = async () => {
    if (!data) return;
    const { start_frame: a, stop_frame: b } = data.job;
    if (!await askConfirm({ title: 'Tải lại point cloud', message: `Tải lại tất cả ${b - a + 1} frame point cloud từ máy chủ?
Mất khoảng 1–5 phút (hàng trăm MB); số liệu đã tính vẫn giữ.`, confirmLabel: 'Tải lại tất cả' })) return;
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
  // Mở Batch Review (từ bảng object đã cuộn xuống dưới, từ QC, từ CVAT…): luôn bắt đầu ở đầu trang, không giữ chỗ cuộn của tab trước.
  const rootRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => { if (tab === 'review' || tab === 'ref') rootRef.current?.scrollIntoView({ block: 'start' }); }, [tab]);
  // Tab Ref chỉ có khi object đang chọn bật ref mode; tắt (hoặc đổi sang object không bật) thì về Batch Review.
  // Chưa chọn object nào (vừa tải lại trang): Batch Review đang xem object #1, tab Ref cũng theo object đó.
  const refNum = selectedNum ?? (data?.ann.tracks.length ? 1 : null);
  const refS = useRefState(data?.job.id ?? 0, refNum);
  const [refFrame, setRefFrame] = useState(0);
  useEffect(() => { if (tab === 'ref' && !refS.on) setTab('review'); }, [tab, refS.on]);
  const openRef = (f?: number) => {
    setRefFrame(f ?? selFrameRef.current ?? startFrame);
    if (selectedNum === null && refNum !== null) setSelectedNum(refNum);
    if (readyRef.current) setTab('ref');
  };
  // Mở Batch Review từ bảng object: cửa sổ bắt đầu ở frame này (frame 0) và bỏ lần nhảy theo frame CVAT lúc vừa mở. Hết lượt mở thì xoá.
  const openAtRef = useRef<number | null>(null);
  useEffect(() => { openAtRef.current = null; }, [tab]);
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
  // Lấy ID hiển thị đang dùng trong CVAT (CVAT không đánh lại ID khi tạo / xóa object) để bảng object và việc chọn object khớp với CVAT.
  const syncIds = () => post({ type: 'readIds' });
  const syncIdsRef = useRef(syncIds);
  syncIdsRef.current = syncIds;
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
    if (!resumeTab || ((resumeTab === 'review' || resumeTab === 'ref') && !ready)) return; // Batch Review / Ref: chờ tới khi mở được
    setTab(resumeTab);
    setResumeTab(null);
  }, [resumeTab, ready]);
  const rows = useMemo(
    () => (data && work
      ? buildRows(work, data.labels, data.job.start_frame, data.job.stop_frame, (num, f) => ignAll.has(motionKey(data.job.id, num, f)), (num, f, k) => ignAll.has(issueKey(data.job.id, num, f, k)), new Set(madeIds), deletable.external).map((r) => {
        const dr = drift.get(r.num) ?? [], sn = sparseAll.get(r.num) ?? 0;
        return { ...r, drift: dr.length, driftFrames: dr.map((x) => x.f), issues: r.issues + sn, issuesByKind: { ...r.issuesByKind, ...(sn ? { P: sn } : {}) } };
      })
      : []),
    [data, work, ignAll, madeIds, deletable, drift, sparseAll, thrVer],
  );

  // ---- Menu chuột phải ở bảng object: tác động lên đúng object của dòng được bấm ----
  /** Các frame cảnh báo của một object: đi xa (lỗi D), đi xa bất thường (Y), ít điểm, lỗi luật QC, trôi box, chồng lấn (không tính cái đã bỏ qua). */
  const objectFlags = (num: number): ObjFlags => {
    const none: ObjFlags = { far: [], motion: [], sparse: [], first: null, pending: false };
    if (!data || !work) return none;
    const t = work.tracks[num - 1];
    if (!t) return none;
    const label = labelNames.get(t.label_id) ?? '';
    const jid = data.job.id;
    const frames: number[] = [];
    for (let f = data.job.start_frame; f <= data.job.stop_frame; f++) frames.push(f);
    const far: number[] = [], sparse: number[] = [], motion: number[] = [];
    for (const f of frames) {
      const c = stateAt(t, f).cuboid;
      if (!c) continue;
      if (motionJump(t, f, label) && !ignAll.has(motionKey(jid, num, f))) motion.push(f);
      const e = passRes.current.get(f)?.get(num);
      if (e?.sparse && e.sig === sigOf(c) && !ignAll.has(issueKey(jid, num, f, 'P'))) sparse.push(f);
    }
    const cand: { frame: number; kind: string }[] = [
      ...motion.map((frame) => ({ frame, kind: 'motion' })),
      ...sparse.map((frame) => ({ frame, kind: 'sparse' })),
      ...(drift.get(num) ?? []).map((x) => ({ frame: x.f, kind: 'drift' })),
      ...overlaps.filter((o) => o.a === num || o.b === num).map((o) => ({ frame: o.frame, kind: 'overlap' })),
    ];
    for (const [f, list] of trackIssues(t, label, frames, undefined, num)) {
      for (const i of list) {
        if (ignAll.has(issueKey(jid, num, f, i.kind))) continue;
        cand.push({ frame: f, kind: i.kind });
        if (i.kind === 'D') far.push(f); // lỗi D (quá xa: khoảng cách tới ego vượt rule distance)
      }
    }
    cand.sort((x, y) => x.frame - y.frame);
    return { far: far.sort((x, y) => x - y), motion, sparse, first: cand[0] ?? null, pending: passView.incomplete.has(num) };
  };
  /** Outside toàn bộ frame đã gắn cờ (đi xa = lỗi D / ít điểm) của một object: gom thành các đoạn liên tiếp, hoàn tác được. */
  const outsideFlagged = async (num: number, kind: 'far' | 'sparse') => {
    if (!data || !work) return;
    const t = work.tracks[num - 1];
    if (!t) return;
    const fl = objectFlags(num);
    const flagged = kind === 'far' ? fl.far : fl.sparse;
    const what = kind === 'far' ? 'đi xa (lỗi D)' : 'ít điểm';
    if (!flagged.length) { setToast(`Object #${num}: không có frame ${what} nào để đặt outside.`); return; }
    // Chỉ outside đoạn ĐẦU (vật chưa xuất hiện) và đoạn CUỐI (vật đã biến mất); frame cờ nằm giữa track phải để nội suy.
    const flagSet = new Set(flagged);
    const present: number[] = [];
    for (let f = data.job.start_frame; f <= data.job.stop_frame; f++) if (stateAt(t, f).cuboid) present.push(f);
    const keep = new Set<number>();
    for (let i = 0; i < present.length && flagSet.has(present[i]!); i++) keep.add(present[i]!);
    for (let i = present.length - 1; i >= 0 && flagSet.has(present[i]!); i--) keep.add(present[i]!);
    const frames = flagged.filter((f) => keep.has(f));
    const middle = flagged.filter((f) => !keep.has(f));
    if (!frames.length) { setToast(`Object #${num}: ${middle.length} frame ${what} đều nằm giữa track (${middle.slice(0, 8).join(', ')}${middle.length > 8 ? '…' : ''}), giữ lại để nội suy, không đặt outside.`); return; }
    const list = frames.length > 12 ? `${frames.slice(0, 12).join(', ')}… (+${frames.length - 12})` : frames.join(', ');
    const warn = (fl.pending && kind === 'sparse' ? '\nLưu ý: object còn frame chưa tải / chưa tính, danh sách có thể chưa đủ.' : '')
      + (middle.length ? `\nBỏ qua ${middle.length} frame ở giữa track (${middle.slice(0, 8).join(', ')}${middle.length > 8 ? '…' : ''}): giữ lại để nội suy.` : '');
    if (!await askConfirm({
      title: `Outside frame ${what} · object #${num}`,
      message: `Đặt outside cho ${frames.length} frame: ${list}.\nSau mỗi đoạn, frame kế tiếp giữ nguyên trạng thái. Chỉ nằm trong nháp tới khi bạn upload, hoàn tác được.${warn}`,
      confirmLabel: 'Đặt outside',
    })) return;
    // sao lưu box (cùng sổ với Batch Review) để "đưa object trở lại" khôi phục đúng vị trí cũ
    const bakKey = `cvla-bak:${data.job.id}:${num}`;
    try {
      const m = JSON.parse(kv.get(bakKey) ?? '{}') as Record<string, unknown>;
      for (const f of frames) { const c = stateAt(t, f).cuboid; if (c) m[String(f)] = c; }
      kv.set(bakKey, JSON.stringify(m));
    } catch { /* bỏ qua */ }
    let cur = t;
    const changed = new Set<number>();
    let a = frames[0]!, prev = a;
    const runs: [number, number][] = [];
    for (const f of frames.slice(1)) { if (f === prev + 1) { prev = f; continue; } runs.push([a, prev]); a = f; prev = f; }
    runs.push([a, prev]);
    for (const [x, y] of runs) {
      const r = setOutsideRange(cur, x, y, data.job.stop_frame);
      if (r) { cur = r.track; r.frames.forEach((f) => changed.add(f)); }
    }
    if (!changed.size) { setToast(`Object #${num}: không đổi được frame nào.`); return; }
    dispatch({ t: 'track', idx: num - 1, track: cur, frames: [...changed] });
    shiftStore.edit(data.job.id, num);
    setToast(`Object #${num}: đã đặt outside ${frames.length} frame ${what} (${runs.length} đoạn). Hoàn tác ở ô Nháp.`);
  };
  /** Bỏ qua lỗi đi xa bất thường (Y) ở mọi frame đang báo của MỘT object (như nút "bỏ qua tất cả" ở Batch Review: chỉ object này). */
  const ignoreMotionAll = (num: number) => {
    if (!data) return;
    const frames = objectFlags(num).motion;
    if (!frames.length) { setToast(`Object #${num}: không có lỗi đi xa bất thường nào để bỏ qua.`); return; }
    ignoreStore.set(frames.map((f) => motionKey(data.job.id, num, f)), true);
    setToast(`Object #${num}: đã bỏ qua lỗi đi xa bất thường ở ${frames.length} frame (${frames.length > 8 ? `${frames.slice(0, 8).join(', ')}…` : frames.join(', ')}). Hoàn lại từng frame ở Batch Review.`);
  };
  /** Chấp nhận mọi gợi ý attribute còn hiệu lực của một object (một lần hoàn tác); tính ở frame có box đầu tiên như dấu ! ở bảng. */
  const acceptHints = (num: number) => {
    if (!data || !work) return;
    const t = work.tracks[num - 1];
    const specs = parseLabelSpecs(data.labels);
    const spec = t ? specs.get(t.label_id) : undefined;
    const first = t?.shapes.find((s) => !s.outside);
    if (!t || !spec || !first) { setToast(`Object #${num}: không có attribute hoặc chưa có box để gợi ý.`); return; }
    const peds = work.tracks
      .filter((x) => specs.get(x.label_id)?.name.toLowerCase() === 'pedestrian')
      .map((x) => stateAt(x, first.frame).cuboid)
      .filter((c): c is NonNullable<typeof c> => !!c);
    const live = suggestAttributes({ track: t, label: spec.name, spec, frame: first.frame, box: stateAt(t, first.frame).cuboid, pedestrians: peds })
      .filter((h) => !ignAll.has(attrKey(data.job.id, num, h.spec.id, h.scope === 'frame' ? first.frame : null)));
    if (!live.length) { setToast(`Object #${num}: không có gợi ý attribute nào.`); return; }
    let cur = t;
    const frames = new Set<number>();
    for (const h of live) {
      const r = !h.spec.mutable ? setAttrStatic(cur, h.spec, h.suggested) : setAttrFrom(cur, h.spec, first.frame, h.suggested);
      if (r) { cur = r.track; r.frames.forEach((f) => frames.add(f)); }
    }
    if (!frames.size) { setToast(`Object #${num}: các attribute đã đúng giá trị gợi ý.`); return; }
    dispatch({ t: 'track', idx: num - 1, track: cur, frames: [...frames] });
    shiftStore.edit(data.job.id, num);
    setToast(`Object #${num}: đã chấp nhận ${live.length} gợi ý attribute (${live.map((h) => `${h.spec.name} → ${h.suggested}`).join(', ')}).`);
  };
  /** Mở Batch Review của object, cửa sổ bắt đầu ở frame cho trước. */
  const openAtFrame = (num: number, frame: number) => {
    if (!data) return;
    selectFromTool(num);
    setStartFrame(frame);
    openAtRef.current = frame;
    openReview();
  };

  /** Xóa object do tool tạo: trong nháp thì bỏ khỏi nháp; đã upload thì mở hộp thoại xóa trên CVAT (chỉ ID trong sổ của tool). */
  /** Menu chuột phải bảng object: thêm outside phía trước cho object xuất hiện muộn, giữ ID (cùng logic nút trong Batch Review). */
  const relocateLate = async (num: number) => {
    if (!data || !work) return;
    const t = work.tracks[num - 1];
    const { start_frame: a, stop_frame: b } = data.job;
    const late = t ? findLateStart(t, a, b) : null;
    const r = late && t ? outsideBeforeAppear(t, a, b) : null;
    if (!late || !r) { setToast(`Object #${num} không xuất hiện muộn.`); return; }
    const msg = `• Object #${num} xuất hiện từ frame ${late.first} (không phải frame ${a}).\n`
      + `• Giữ nguyên ID #${num}, KHÔNG tạo ID mới: chỉ thêm keyframe outside ở mọi frame ${a}–${late.first - 1}.\n\n`
      + 'Không xóa ID nào. Chỉ nằm trong nháp tới khi bạn upload.';
    if (!await askConfirm({ title: `Outside phía trước · object #${num}`, message: msg, confirmLabel: 'Thêm outside' })) return;
    dispatch({ t: 'track', idx: num - 1, track: r.track, frames: r.frames });
    shiftStore.edit(data.job.id, num);
    setToast(`Object #${num}: đã thêm ${r.frames.length} keyframe outside (frame ${a}–${late.first - 1}), giữ ID. Nằm trong nháp, chưa upload.`);
  };
  const lockBaseline = async () => {
    if (!data) return;
    const ids = data.ann.tracks.map((t) => t.id).filter((x): x is number => typeof x === 'number' && !madeIds.includes(x)); // object do tool tạo không phải ID gốc
    if (!await askConfirm({ title: 'Khóa danh sách ID gốc', message: `Khóa ${ids.length} ID hiện có trên server của job này.\n• Các ID này KHÔNG bao giờ xóa được bằng tool, chỉ chỉnh sửa.\n• Object nằm ngoài danh sách (vẽ thêm trên CVAT hoặc tạo trên tool) được coi là object ngoài và được phép xóa.\n\nChỉ khóa khi trên server lúc này toàn là object gốc (chưa có object vẽ thêm cần xóa).`, confirmLabel: 'Khóa danh sách' })) return;
    lockStore.lock(data.job.id, ids);
    setToast(`Đã khóa ${ids.length} ID gốc.`);
  };
  const unlockBaseline = async () => {
    if (!data) return;
    if (!await askConfirm({ title: 'Mở khóa danh sách ID gốc', message: 'Mở khóa: chỉ object do tool tạo mới xóa được (như trước khi khóa). Object ngoài danh sách không còn xóa được cho tới khi khóa lại.', confirmLabel: 'Mở khóa' })) return;
    lockStore.unlock(data.job.id);
  };
  const deleteMade = async (r: { num: number; id: number; made: 'draft' | 'server' | null }) => {
    if (!data || r.made === null) return;
    if (r.made === 'draft') {
      if (!await askConfirm({ title: `Xóa object #${r.num}`, message: 'Object do tool tạo, đang trong nháp.\nChưa có gì trên CVAT nên không ảnh hưởng server.', confirmLabel: 'Xóa khỏi nháp', danger: true })) return;
      dispatch({ t: 'removeTrack', idx: r.num - 1 });
      if (selectedNum !== null && selectedNum >= r.num) setSelectedNum(selectedNum > r.num ? selectedNum - 1 : null);
      setToast(`Đã xóa object #${r.num} khỏi nháp. (Hoàn tác / làm lại bị làm mới.)`);
      return;
    }
    if (draft.edited.size) { setToast('Hãy upload hoặc bỏ nháp trước khi xóa object trên CVAT (ID hiển thị sẽ đổi nên nháp không còn đúng).'); return; }
    setDeleting([r.id]);
  };

  const reload = async () => {
    if (draft.edited.size && !await askConfirm({ title: 'Tải lại dữ liệu job', message: `Có ${draft.edited.size} frame đã sửa chưa upload.
Tải lại sẽ bỏ nháp.`, confirmLabel: 'Bỏ nháp và tải lại', danger: true })) return;
    post({ type: 'load' });
  };

  const settingsTabs: { id: Tab; label: string }[] = [
    { id: 'dyn', label: 'Dynamic size' }, { id: 'thr', label: 'Threshold' }, { id: 'cam', label: 'Camera' },
    { id: 'color', label: 'Màu sắc' }, { id: 'keys', label: 'Phím tắt' }, { id: 'job', label: 'Thông tin job' },
  ];
  const inSettings = settingsTabs.some((x) => x.id === tab);
  if (inSettings) lastSettings.current = tab;

  const tabBtn = (t: Tab, label: string) => (
    <button
      role="tab" aria-selected={tab === t}
      onClick={() => (t === 'review' ? openReview() : t === 'ref' ? openRef() : setTab(t))}
      disabled={(t === 'review' || t === 'ref') && !ready}
      title={(t === 'review' || t === 'ref') && !ready ? 'Mở được khi đã tải xong point cloud mọi frame và tính xong mặt đường / trôi box' : t === 'ref' ? `Reflection mode của object #${selectedNum} (frame đang chọn ở Batch Review)` : undefined}
      className={tab === t ? 'cvla-tab cvla-tab-on' : 'cvla-tab'}
    >
      {label}
    </button>
  );
  const loadedFrames = passView.total - passView.loading - passView.failed;
  const loading = !!data && passView.pending > 0 && doneJob !== data.job.id;

  return (
    <div ref={rootRef} className={skin === 'dark' ? 'cvla-root cvla-dark' : skin === 'gray' ? 'cvla-root cvla-gray' : 'cvla-root'} style={{ font: '13px/1.4 system-ui', padding: 10, color: '#111' }}>
      <style>{STYLE}</style>
      <ConfirmHost />
      {tutorial && <Tutorial onClose={() => setTutorial(false)} />}
      <div className="cvla-head">
        <div className="cvla-bar">
          <b>CVAT 3D Assistant · v{VERSION}</b>
          <ShiftBadge onOpen={() => setTab('shift')} />
          <div className="cvla-tabs" role="tablist" aria-label="Chức năng">
            {tabBtn('objects', 'Bảng object')}
            {tabBtn('review', 'Batch Review')}
            {refS.on && refNum !== null && tabBtn('ref', `Ref #${refNum}`)}
            {tabBtn('shift', 'Ca / KPI')}
            {tabBtn('qc', 'QC')}
            <button
              role="tab" aria-selected={inSettings} className={inSettings ? 'cvla-tab cvla-tab-on' : 'cvla-tab'}
              onClick={() => setTab(lastSettings.current)} title="Dynamic size, Threshold, Camera, Màu sắc, Phím tắt, Thông tin job"
            >Cài đặt</button>
          </div>
          <span className="cvla-spacer" />
          {data && (loading || passView.failed > 0) && (
            <button
              className="cvla-loadchip" onClick={() => setShowProgress((v) => !v)}
              title={loading ? `Đã tải ${loadedFrames}/${passView.total} frame${passView.failed ? `, ${passView.failed} frame lỗi` : ''}. Bấm để xem chi tiết.` : `${passView.failed} frame tải lỗi`}
            >
              {loading && <progress value={loadedFrames} max={Math.max(1, passView.total - passView.failed)} />}
              {loading ? `${loadedFrames}/${passView.total}` : null}
              {passView.failed > 0 && <span className="cvla-badge"><Icon name="warn" size={11} /> {passView.failed}</span>}
            </button>
          )}
          {data && (
            <span className={draft.edited.size ? 'cvla-draftchip cvla-draftchip-on' : 'cvla-draftchip'}>
              Nháp: <b>{draft.edited.size}</b> frame <Help text="Các chỉnh sửa chỉ nằm trong bộ nhớ (và bản lưu cục bộ để F5 không mất) cho tới khi bạn bấm Upload lên CVAT." />
              <button className="cvla-iconbtn cvla-iconbtn-b" disabled={!draft.undo.length} onClick={() => dispatch({ t: 'undo' })} title="Hoàn tác" aria-label="Hoàn tác"><Icon name="undo" /></button>
              <button className="cvla-iconbtn cvla-iconbtn-b" disabled={!draft.redo.length} onClick={() => dispatch({ t: 'redo' })} title="Làm lại" aria-label="Làm lại"><Icon name="redo" /></button>
              <span className="cvla-menuwrap">
                <button className="cvla-iconbtn cvla-iconbtn-b" disabled={!draft.edited.size} onClick={() => setMenu(menu === 'more' ? null : 'more')} title="Thao tác khác với nháp" aria-label="Thao tác khác với nháp" aria-expanded={menu === 'more'}><Icon name="more" /></button>
                {menu === 'more' && (
                  <><div className="cvla-backdrop" onClick={() => setMenu(null)} />
                  <div className="cvla-menu" ref={menuRef} style={{ minWidth: 190 }}>
                    <button className="cvla-danger" onClick={async () => {
                      setMenu(null);
                      if (await askConfirm({ title: 'Bỏ nháp', message: `Bỏ toàn bộ chỉnh sửa chưa upload (${draft.edited.size} frame)?\nChưa có gì lên CVAT nên server không bị ảnh hưởng.`, confirmLabel: 'Bỏ nháp', danger: true })) dispatch({ t: 'reset', baseline: data.ann });
                    }}><Icon name="trash" />Bỏ toàn bộ nháp</button>
                  </div></>
                )}
              </span>
              <button className={draft.edited.size ? 'cvla-primary' : undefined} onClick={() => setUploading(true)} style={{ fontWeight: 700 }}>
                <Icon name="upload" />Upload lên CVAT…{draft.edited.size ? <span className="cvla-badge">{draft.edited.size}</span> : null}
              </button>
            </span>
          )}
          <button onClick={() => focusRef.current()} disabled={selectedNum === null} title="Thu nhỏ tool và đưa camera 3D của CVAT lại gần object đang chọn (như bấm đúp vào object trong CVAT). Phím F."><Icon name="focus" />Focus</button>
          <span className="cvla-menuwrap">
            <button className="cvla-iconbtn cvla-iconbtn-b" onClick={() => setMenu(menu === 'settings' ? null : 'settings')} title="Đồng bộ, giao diện, tải point cloud" aria-label="Tùy chọn nhanh" aria-expanded={menu === 'settings'}><Icon name="settings" size={16} /></button>
            {menu === 'settings' && (
              <><div className="cvla-backdrop" onClick={() => setMenu(null)} />
              <div className="cvla-menu" ref={menuRef}>
                <h4>Đồng bộ với CVAT</h4>
                <label title="Khi bạn chọn một object trong giao diện CVAT, tool tự chọn object đó và nhảy tới frame hiện tại của CVAT">
                  <input type="checkbox" checked={sync} onChange={(e) => setSync(e.target.checked)} /> Theo object đang chọn trong CVAT
                </label>
                <label title="Khi bạn chọn object trong tool, giao diện CVAT chuyển focus sang object đó (đổi frame nếu object không có ở frame hiện tại)">
                  <input type="checkbox" checked={pushOut} onChange={(e) => setPushOut(e.target.checked)} /> Chọn trong tool thì CVAT nhảy theo
                </label>
                <h4>Giao diện</h4>
                <span className="cvla-seg" role="group" aria-label="Giao diện">
                  {(Object.keys(THEME_LABEL) as Theme[]).map((t) => (
                    <button key={t} className={theme === t ? 'cvla-seg-on' : undefined} aria-pressed={theme === t} onClick={() => setTheme(t)}>{THEME_LABEL[t]}</button>
                  ))}
                </span>
                {data && (
                  <>
                    <h4>Point cloud</h4>
                    <select
                      value={lmode}
                      title={`Cách tải point cloud: ${LOAD_MODES.find((x) => x.id === lmode)?.title ?? ''} Đổi xong áp dụng cho các frame chưa tải.`}
                      onChange={(e) => { const v = e.target.value as LoadMode; setLmode(v); setLoadMode(v); if (data) configureLoading(data.job.start_frame, data.job.stop_frame, chunkSrcRef.current); }}
                    >
                      {LOAD_MODES.map((x) => <option key={x.id} value={x.id}>Tải: {x.label}</option>)}
                    </select>
                    <button onClick={() => { setMenu(null); reloadClouds(); }} title="Chỉ tải lại các frame lỗi (frame đang tải thì giữ nguyên)"><Icon name="reload" />Tải lại frame lỗi{passView.failed ? <span className="cvla-badge">{passView.failed}</span> : null}</button>
                    <button onClick={() => { setMenu(null); void reloadAllClouds(); }} title="Bỏ hết point cloud đã tải và tải lại cả job từ máy chủ"><Icon name="reload" />Tải lại tất cả {data.job.stop_frame - data.job.start_frame + 1} frame</button>
                  </>
                )}
                <h4>Trợ giúp</h4>
                <button onClick={() => { setMenu(null); setTutorial(true); }} title="Xem lại hướng dẫn dùng tool">Hướng dẫn sử dụng</button>
                <h4>Dữ liệu job</h4>
                <button onClick={() => { setMenu(null); void reload(); }} title="Đọc lại nhãn của job từ CVAT (bỏ nháp chưa upload)"><Icon name="reload" />Tải lại dữ liệu từ CVAT</button>
              </div></>
            )}
          </span>
        </div>
        {inSettings && (
          <div className="cvla-bar">
            <span className="cvla-subtabs" role="tablist" aria-label="Cài đặt">
              {settingsTabs.map((x) => (
                <button key={x.id} role="tab" aria-selected={tab === x.id} className={tab === x.id ? 'cvla-subtab cvla-subtab-on' : 'cvla-subtab'} onClick={() => setTab(x.id)}>{x.label}</button>
              ))}
            </span>
          </div>
        )}
        {data && (tab === 'dyn' || tab === 'thr' || tab === 'cam') && <SettingsIO jobId={data.job.id} labels={data.labels} />}
      </div>
      <ShiftBanner pending={draft.edited.size} onUpload={() => setUploading(true)} />
      {restorable && data && (
        <Notice
          tone="info"
          actions={<>
            <button className="cvla-primary" onClick={() => {
              const r = applyDraft(restorable, data.ann);
              dispatch({ t: 'restore', work: r.work, edited: r.edited });
              restorableRef.current = null; setRestorable(null);
              setToast(r.skipped.length ? `Đã khôi phục nháp; bỏ qua object ${r.skipped.join(', ')} (ID không còn khớp).` : 'Đã khôi phục bản nháp.');
            }}>Khôi phục</button>
            <button onClick={() => { kv.remove(draftKey(data.job.id)); restorableRef.current = null; setRestorable(null); }}>Bỏ bản nháp</button>
          </>}
        >
          Có <b>bản nháp chưa upload</b> từ lần trước ({new Date(restorable.savedAt).toLocaleString()}): {restorable.edited.length} frame đã sửa, {Object.keys(restorable.tracks).length} object.
        </Notice>
      )}
      {draftNote && <Notice tone="warn" onClose={() => setDraftNote('')}>{draftNote}</Notice>}
      {deleting && data && (
        <DeleteDialog
          job={data.job} baseline={data.ann} labels={data.labels} ids={deleting} allowed={deletable.all}
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
            shiftStore.upload({ time: new Date().toISOString(), jobId: data.job.id, tracks, origin: hostScope() || undefined });
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
        <Notice tone="info">
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <progress value={reloadSt.total - reloadSt.left} max={reloadSt.total} style={{ width: 160 }} />
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              Đang tải lại: <b>{reloadSt.total - reloadSt.left}/{reloadSt.total}</b> frame đã về
              {reloadSt.chunks.map((c) => (
                <span key={c.k}> · chunk {c.k}: {c.got === 0 ? `chờ máy chủ dựng (${c.secs} s, thường 20–30 s)` : `đang nhận ${c.got}/${c.count} file (${c.secs} s)`}</span>
              ))}
              {reloadSt.chunks.length === 0 ? ' · đang tải từng frame' : ''}
            </span>
          </div>
        </Notice>
      )}
      {!storeHealth.ok && (
        <Notice tone="error">
          Tool KHÔNG lưu được dữ liệu ({storeHealth.reason === 'orphan' ? 'extension vừa được Reload / cập nhật trong khi cửa sổ tool này còn mở'
            : storeHealth.reason === 'quota' ? 'kho của extension đã đầy' : storeHealth.detail}): ca / KPI, bản nháp, ghi chú QC… từ giờ sẽ mất khi tải lại.{' '}
          {storeHealth.reason === 'orphan' ? 'Hãy tải lại tab CVAT (F5) rồi bấm lại biểu tượng extension trước khi làm tiếp.' : 'Hãy xoá bớt ca cũ ở tab Ca / KPI hoặc bản nháp không dùng, rồi tải lại tab.'}
        </Notice>
      )}
      {/* Chỉ hiện ở lần tải / tính đầu của job (tải lại có thanh riêng ở trên): sau đó sửa box làm vài frame tính lại (kể cả phải tải lại
          point cloud đã bị đẩy khỏi bộ nhớ) thì tính ngầm, ô chưa đủ có viền vàng. Khi đã mở được Batch Review thì chi tiết gọn vào chip
          trên thanh đầu (bấm chip để xem), không chèn thêm dòng đẩy cả tool xuống rồi lùi lại (giật). */}
      {data && loading && (!ready || showProgress) && (
        <Notice
          tone="info" onClose={ready ? () => setShowProgress(false) : undefined}
          actions={<button onClick={retryFailedNow} title="Tải lại các frame lỗi ngay (frame đang tải thì giữ nguyên)"><Icon name="reload" />Tải lại</button>}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <progress value={passView.loading > 0 ? loadedFrames : passView.total - passView.pending - passView.failed} max={Math.max(1, passView.total - passView.failed)} style={{ width: 160 }} />
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>
              Đã tải <b>{loadedFrames}/{passView.total}</b> frame
              {passView.loading > 0
                ? <> (còn <b>{passView.loading}</b> đang tải; mặt đường và ít điểm tính sau khi tải xong)</>
                : <> · {ready ? 'đang tính phần còn lại' : 'đang tính'}: đã tính xong <b>{passView.total - passView.pending - passView.failed}/{passView.total}</b> frame (mặt đường, ít điểm)</>}{passView.failed ? ` · ${passView.failed} frame tải lỗi, bỏ qua` : ''} · trôi box: đã tính.{' '}
              {ready ? <>Ô có <span style={PENDING_STYLE}>viền vàng</span>: số liệu chưa đủ, tự cập nhật khi tải xong.</> : `Batch Review mở được khi ${Math.min(UNLOCK_FRAMES, passView.total)} frame đầu tải xong.`}
            </span>
          </div>
        </Notice>
      )}
      {data && passView.failed > 0 && (
        <Notice
          tone="warn"
          actions={<button onClick={() => { autoRetry.current = 0; retryFailedNow(); }}><Icon name="reload" />Tải lại các frame lỗi</button>}
        >
          <b>{passView.failed}</b> frame tải lỗi (thường do máy chủ báo bận), nên chưa có số liệu mặt đường / ít điểm của các frame đó.{' '}
          <span style={{ opacity: .75 }}>{autoRetry.current < 3 ? `Tự thử lại sau 20 giây (đã thử ${autoRetry.current}/3).` : 'Đã tự thử 3 lần; bấm nút để thử tiếp.'}</span>
        </Notice>
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
      {state.kind === 'error' && <Notice tone="error">Lỗi: {state.message}</Notice>}
      {data && data.removedIds.length > 0 && (
        <Notice tone="error" actions={<button onClick={() => { post({ type: 'ackRemoved', ids: data.removedIds }); setState((s) => (s.kind === 'ok' ? { kind: 'ok', data: { ...s.data, removedIds: [] } } : s)); }} title="Dùng khi ID biến mất là do bạn chủ động (ví dụ merge / xóa trong CVAT). Chỉ quên ID đó trong tool, không đổi gì trên CVAT.">Đã biết, bỏ cảnh báo</button>}>CẢNH BÁO: ID đã biến mất so với lần đọc trước: {data.removedIds.join(', ')}</Notice>
      )}
      {data && work && tab === 'objects' && (
        <ObjectTable
          jobId={data.job.id} locked={lockedIds} onLock={lockBaseline} onUnlock={unlockBaseline} onRelocate={(n) => { void relocateLate(n); }} onDelete={deleteMade} flagsOf={objectFlags} onOutside={(n, k) => { void outsideFlagged(n, k); }} onAcceptHints={acceptHints} onIgnoreMotion={ignoreMotionAll} onOpenAt={openAtFrame} rows={rows} hints={attrHints} overlapFrames={overlapFrames} overlapPairs={overlapPairs} incomplete={passView.incomplete}
          tracks={work.tracks} labels={data.labels} start={data.job.start_frame} stop={data.job.stop_frame} cvatFrame={focus?.frame ?? null}
          selectedNum={selectedNum} onSelect={selectFromTool}
          onOpen={(num) => {
            // Bấm đúp ở bảng object: cửa sổ Batch Review luôn bắt đầu ở frame 0 (frame đầu job), không theo frame CVAT đang mở.
            selectFromTool(num);
            setStartFrame(data.job.start_frame);
            openAtRef.current = data.job.start_frame;
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
      {data && work && (tab === 'review' || tab === 'ref') && (
        <BatchReview
          key={tab} refView={tab === 'ref'} onOpenRef={openRef} onCloseRef={() => setTab('review')} openAt={openAtRef.current}
          overlaps={overlaps} ignoredOverlaps={overlapsIgnored} drift={driftAll}
          labels={data.labels} job={data.job} ann={work} rows={rows} selectedNum={selectedNum} setSelectedNum={selectFromTool}
          onSel={(f) => { selFrameRef.current = f; }}
          onHoverFrame={(f) => { hoverFrameRef.current = f; }}
          onFocusFrame={(f) => { selFrameRef.current = f; hoverFrameRef.current = f; focusRef.current(); }}
          onView={(f) => {
            viewFrames.current = f;
            if (f.length) setStartFrame(f[0]!);
          }} initialFrame={tab === 'ref' ? refFrame : startFrame} edited={draft.edited} focus={focus}
          onEdit={(idx, frame, cub, sizeAll) => { dispatch({ t: 'edit', idx, frame, cub, sizeAll }); shiftStore.edit(data.job.id, idx + 1); }}
          onTrack={(idx, track, frames) => { dispatch({ t: 'track', idx, track, frames }); shiftStore.edit(data.job.id, idx + 1); }}
          onSplit={(idx, resume) => {
            const t = work.tracks[idx];
            if (resume < 0) {
              const o = t ? outsideBeforeAppear(t, data.job.start_frame, data.job.stop_frame) : null;
              if (!o) return null;
              dispatch({ t: 'track', idx, track: o.track, frames: o.frames });
              shiftStore.edit(data.job.id, idx + 1);
              return idx + 1;
            }
            const r = !t ? null : splitTrack(t, resume, data.job.stop_frame);
            if (!r) return null;
            dispatch({ t: 'split', idx, oldTrack: r.oldTrack, newTrack: r.newTrack, frames: r.frames });
            shiftStore.edit(data.job.id, idx + 1);
            return work.tracks.length + 1; // số thứ tự (ID hiển thị) của object mới: nằm cuối danh sách
          }}
        />
      )}
      {data && work && tab === 'dyn' && <DynSizePanel jobId={data.job.id} labels={data.labels} tracks={work.tracks} />}
      {data && work && tab === 'thr' && <ThresholdPanel jobId={data.job.id} labels={data.labels} tracks={work.tracks} />}
      {data && tab === 'cam' && <CameraTab start={data.job.start_frame} stop={data.job.stop_frame} />}
      {tab === 'color' && <ColorPanel />}
      {tab === 'shift' && <ShiftPanel />}
      {tab === 'keys' && <KeysPanel map={keymap} setMap={setKeymap} />}
      {data && tab === 'job' && <JobInfo s={summarize(data.job, data.labels, data.ann)} />}
      {/* thông báo thoáng qua: dính ở đáy khung nhìn, không chèn vào luồng trang nên không đẩy nội dung */}
      {(doneNote || toast) && (
        <div className="cvla-toasts">
          {doneNote && <Notice tone="success" onClose={() => setDoneNote('')}><b>Đã tải xong.</b> {doneNote}</Notice>}
          {toast && <Notice tone="success" onClose={() => setToast('')}>{toast}</Notice>}
        </div>
      )}
    </div>
  );
}
