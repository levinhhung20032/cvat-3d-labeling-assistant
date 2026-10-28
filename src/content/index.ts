import { api } from '../shared/api';
import { CONTENT_SOURCE, PANEL_SOURCE, type ContentMessage, type PanelMessage } from '../shared/protocol';
import { comboOf } from '../shared/keymap';
import { checkIdsNotRemoved, trackIds } from '../shared/rules';
import { CvatClient } from './cvatClient';
import { activateObject, blurFrameInput, gotoFrame, readCvatState } from './cvatDom';
import { runDelete, runRevert, runUpload, type LogEntry, type UploadDeps } from './uploader';
import type { InPagePanel } from '../panel/inpage';

declare global {
  interface Window {
    __cvla?: { toggle: () => void; dispose: () => void };
  }
}

const JOB_URL = /\/tasks\/\d+\/jobs\/(\d+)/;
const log = (...a: unknown[]) => console.info('[CVLA]', ...a); // vết chẩn đoán: mở Console và lọc "[CVLA]"
const TITLE_H = 28;
/** Thuộc tính đánh dấu cửa sổ tool trong DOM (DOM dùng chung giữa các phiên / bản extension, còn biến JS thì không). */
const HOST_ATTR = 'data-cvla-host';
/** Sự kiện DOM báo cho phiên tool đang chạy (kể cả của bản extension cũ trước khi Reload) tự đóng và dọn dẹp. */
const TAKEOVER = 'cvla-takeover';

type Out = ContentMessage extends infer M ? (M extends unknown ? Omit<M, 'source' | 'session'> : never) : never;

interface Geo { x: number; y: number; w: number; h: number; max: boolean; min: boolean }

const clamp = (v: number, a: number, b: number) => Math.min(b, Math.max(a, v));

function defaultGeo(): Geo {
  const w = Math.min(520, window.innerWidth);
  return { x: window.innerWidth - w, y: 0, w, h: window.innerHeight, max: false, min: false };
}

function main() {
  // Bấm biểu tượng extension: nếu đã có phiên tool đang chạy (cùng bản, hoặc bản trước khi Reload extension) thì ĐÓNG phiên đó
  // và mở phiên mới, để không bao giờ có hai cửa sổ tool cùng lúc.
  document.dispatchEvent(new CustomEvent(TAKEOVER));
  window.__cvla?.dispose();
  document.querySelectorAll(`[${HOST_ATTR}]`).forEach((el) => el.remove()); // cửa sổ mồ côi của phiên không còn phản hồi
  const jobId = Number(JOB_URL.exec(location.pathname)?.[1]);
  if (!jobId) return;

  const session = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) =>
    b.toString(16).padStart(2, '0'),
  ).join('');
  // Dạng "moz-extension://uuid" / "chrome-extension://id", lấy từ chuỗi URL (URL.origin có thể trả "null" với scheme lạ).
  const extOrigin = api.runtime.getURL('/').replace(/\/+$/, '');
  const geoKey = `geo:${location.origin}`;
  const client = new CvatClient({
    origin: location.origin,
    dryRun: true,
    // Đọc cookie csrftoken đúng lúc gửi như giao diện CVAT; không giữ lại.
    getCsrf: () => /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? null,
  });

  // Upload: client GHI chỉ được tạo khi có yêu cầu ghi thật (dry-run là mặc định); chỉ có create/update, không có delete.
  const logKey = `log:${location.origin}:${jobId}`;
  let writer: CvatClient | null = null;
  let busy = false;
  const uploadDeps: UploadDeps = {
    jobId,
    read: () => client.getAnnotations(jobId),
    write: (payload, action = 'update') => {
      writer ??= new CvatClient({
        origin: location.origin, dryRun: false,
        getCsrf: () => /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? null,
      });
      return writer.write(jobId, action, payload);
    },
    deleteOwn: (tracks, allowed) => {
      writer ??= new CvatClient({
        origin: location.origin, dryRun: false,
        getCsrf: () => /(?:^|;\s*)csrftoken=([^;]+)/.exec(document.cookie)?.[1] ?? null,
      });
      return writer.deleteOwn(jobId, tracks, allowed);
    },
    loadLog: async () => ((await api.storage.local.get(logKey))[logKey] as LogEntry[] | undefined) ?? [],
    saveLog: (list) => api.storage.local.set({ [logKey]: list }),
  };

  let host: HTMLDivElement | null = null;
  let frame: HTMLIFrameElement | null = null;
  let body: HTMLElement | null = null; // phần thân cửa sổ: iframe, hoặc vùng chứa panel ở chế độ nhúng
  let inPage: InPagePanel | null = null;
  let titleEl: HTMLSpanElement | null = null;
  let gotReady = false;
  let watchdog = 0;
  let toggleCombos: string[] = ['`']; // phím thu nhỏ / mở cửa sổ; panel gửi lại khi người dùng đổi phím
  let geo = defaultGeo();
  let poll = 0;
  let lastSync = '';

  const send = (m: Out, transfer: Transferable[] = []) => {
    const msg = { source: CONTENT_SOURCE, session, ...m } as ContentMessage;
    if (inPage) inPage.deliver(msg);
    else frame?.contentWindow?.postMessage(msg, extOrigin, transfer);
  };
  const setStatus = (text: string | null) => { if (titleEl) titleEl.textContent = 'CVAT 3D Assistant · ' + (text ?? 'kéo để di chuyển'); };
  const focusPanel = () => { if (inPage) inPage.focus(); else frame?.contentWindow?.focus(); };

  async function load() {
    send({ type: 'loading' });
    try {
      const job = await client.getJob(jobId);
      const [labels, annotations] = await Promise.all([client.getLabels(jobId), client.getAnnotations(jobId)]);
      const key = `ids:${location.origin}:${jobId}`;
      const stored = (await api.storage.local.get(key))[key] as number[] | undefined;
      const now = trackIds(annotations);
      const removedIds = stored ? checkIdsNotRemoved(stored, now).map((v) => v.trackId!) : [];
      // Chỉ lưu danh sách ID từng thấy (hợp của các lần đọc) để cảnh báo ID biến mất không tự tắt.
      await api.storage.local.set({ [key]: [...new Set([...(stored ?? []), ...now])] });
      send({ type: 'data', job, labels, annotations, removedIds });
    } catch (e) {
      send({ type: 'error', message: String(e) });
    }
  }

  async function binary(kind: 'frame' | 'context', n: number, reqId: number) {
    try {
      const buf = await (kind === 'frame' ? client.getFrame(jobId, n) : client.getContextImages(jobId, n));
      send({ type: 'binary', reqId, buf }, [buf]);
    } catch (e) {
      send({ type: 'binary', reqId, buf: null, error: String(e) });
    }
  }

  // ---------- cửa sổ nổi: kéo, đổi cỡ, thu nhỏ / phóng to / đóng luôn nằm ở thanh tiêu đề ----------
  function persist() {
    try { void api.storage.local.set({ [geoKey]: geo }); } catch { /* extension vừa được Reload */ }
  }

  function applyGeo() {
    if (!host || !body) return;
    const vw = window.innerWidth, vh = window.innerHeight;
    // Thu nhỏ (collapse) chỉ gập thành thanh tiêu đề ở vị trí cũ và GIỮ cờ toàn màn hình: mở lại thì về đúng kích thước trước đó.
    if (geo.min) {
      geo.w = clamp(geo.w, 320, vw);
      geo.x = clamp(geo.x, -geo.w + 120, vw - 120); // luôn còn thanh tiêu đề trong tầm nhìn để kéo lại
      geo.y = clamp(geo.y, 0, vh - TITLE_H);
      Object.assign(host.style, { left: `${geo.x}px`, top: `${geo.y}px`, width: `${geo.w}px`, height: `${TITLE_H}px`, resize: 'none' });
    } else if (geo.max) {
      Object.assign(host.style, { left: '0px', top: '0px', width: `${vw}px`, height: `${vh}px`, resize: 'none' });
    } else {
      geo.w = clamp(geo.w, 320, vw);
      geo.h = clamp(geo.h, 200, vh);
      geo.x = clamp(geo.x, -geo.w + 120, vw - 120);
      geo.y = clamp(geo.y, 0, vh - TITLE_H);
      Object.assign(host.style, { left: `${geo.x}px`, top: `${geo.y}px`, width: `${geo.w}px`, height: `${geo.h}px`, resize: 'both' });
    }
    body.style.display = geo.min ? 'none' : 'block';
  }

  function show() {
    host = document.createElement('div');
    host.setAttribute(HOST_ATTR, session);
    host.style.cssText =
      'position:fixed;z-index:2147483647;display:flex;flex-direction:column;overflow:hidden;min-width:320px;' +
      'background:#fff;box-shadow:0 4px 18px rgba(0,0,0,.45);border:1px solid #1f2937;border-radius:4px;';

    const bar = document.createElement('div');
    bar.style.cssText =
      `flex:none;height:${TITLE_H}px;display:flex;align-items:center;justify-content:space-between;` +
      'background:#1f2937;color:#fff;font:600 12px system-ui;padding-left:8px;cursor:move;user-select:none;';
    const title = document.createElement('span');
    titleEl = title;
    setStatus(null);
    const btns = document.createElement('span');
    const mk = (label: string, tip: string, on: () => void) => {
      const b = document.createElement('button');
      b.textContent = label;
      b.title = tip;
      b.style.cssText = 'width:34px;height:28px;border:0;background:transparent;color:#fff;font:14px system-ui;cursor:pointer;';
      b.onmouseenter = () => { b.style.background = label === '✕' ? '#dc2626' : '#374151'; };
      b.onmouseleave = () => { b.style.background = 'transparent'; };
      b.onpointerdown = (e) => e.stopPropagation();
      b.onclick = on;
      return b;
    };
    btns.append(
      mk('—', 'Thu nhỏ / khôi phục (giữ nguyên kích thước trước đó)', () => { geo.min = !geo.min; applyGeo(); persist(); }),
      mk('▢', 'Phóng to toàn màn hình / khôi phục', () => { geo.max = !geo.max; if (geo.max) geo.min = false; applyGeo(); persist(); }),
      mk('✕', 'Đóng', hide),
    );
    bar.append(title, btns);

    // kéo cửa sổ bằng thanh tiêu đề
    let drag: { px: number; py: number; x: number; y: number } | null = null;
    bar.onpointerdown = (e) => {
      if ((geo.max && !geo.min) || e.button !== 0) return;
      bar.setPointerCapture(e.pointerId);
      drag = { px: e.clientX, py: e.clientY, x: geo.x, y: geo.y };
    };
    bar.onpointermove = (e) => {
      if (!drag) return;
      geo.x = drag.x + e.clientX - drag.px;
      geo.y = drag.y + e.clientY - drag.py;
      applyGeo();
    };
    bar.onpointerup = () => { if (drag) { drag = null; persist(); } };
    bar.ondblclick = () => { geo.max = !geo.max; applyGeo(); persist(); };

    gotReady = false;
    inPage = null;
    frame = document.createElement('iframe');
    frame.src = `${api.runtime.getURL('panel.html')}#session=${session}&origin=${encodeURIComponent(location.origin)}`;
    frame.style.cssText = 'flex:1;width:100%;border:0;background:#fff;min-height:0;';
    body = frame;
    frame.addEventListener('load', () => log('khung tool đã tải xong'));
    host.append(bar, frame);
    document.documentElement.append(host);
    log('đã tạo khung tool', { src: frame.src.split('#')[0], extOrigin, pageOrigin: location.origin });
    // Nếu khung không gửi "ready" (bị trình duyệt / chính sách của trang chặn, hoặc tin nhắn bị chặn âm thầm) thì chuyển sang
    // chế độ nhúng trực tiếp trong trang thay vì để cửa sổ trống.
    window.clearTimeout(watchdog);
    watchdog = window.setTimeout(() => { if (!gotReady && host) void fallbackToInPage('khung tool không gửi "ready" sau 5 giây'); }, 5000);

    // nhớ kích thước khi người dùng kéo góc dưới phải
    new ResizeObserver(() => {
      if (!host || geo.max || geo.min) return;
      const w = host.offsetWidth, h = host.offsetHeight;
      if (Math.abs(w - geo.w) > 1 || Math.abs(h - geo.h) > 1) { geo.w = w; geo.h = h; persist(); }
    }).observe(host);

    applyGeo();
    lastSync = '';
    poll = window.setInterval(syncFromCvat, 300);
  }

  /** Cửa sổ đang đóng → mở lại; đang mở → thu nhỏ; đang thu nhỏ → khôi phục (trả focus bàn phím cho tool). */
  function toggleWindow() {
    if (!host) { show(); return; }
    geo.min = !geo.min; // giữ nguyên cờ toàn màn hình: thu nhỏ rồi mở lại về đúng kích thước cũ
    applyGeo();
    persist();
    if (!geo.min) focusPanel();
  }

  function hide() {
    window.clearInterval(poll);
    window.clearTimeout(watchdog);
    inPage?.destroy();
    host?.remove();
    host = null;
    frame = null;
    body = null;
    inPage = null;
    titleEl = null;
  }

  /** Dự phòng: dựng panel thẳng trong trang (Shadow DOM) khi khung của extension không hoạt động. */
  async function fallbackToInPage(reason: string) {
    if (!host || inPage) return;
    log('KHUNG KHÔNG PHẢN HỒI:', reason, '→ chuyển sang chế độ nhúng trong trang');
    setStatus('khung bị chặn → chế độ nhúng');
    frame?.remove();
    frame = null;
    const container = document.createElement('div');
    container.style.cssText = 'flex:1;width:100%;min-height:0;position:relative;';
    host.append(container);
    body = container;
    applyGeo();
    try {
      const { mountInPage } = await import('../panel/inpage');
      inPage = await mountInPage(container, session, handlePanel);
      log('đã nhúng panel trong trang');
    } catch (e) {
      log('nhúng trong trang thất bại', e);
      setStatus('lỗi nhúng panel: ' + String(e));
    }
  }

  /** Panel xin rộng hơn khi vào Batch Review: nới cửa sổ, không đổi vị trí nếu còn vừa màn hình. */
  function ensureWide() {
    if (!host) return;
    if (geo.max) { geo.min = false; applyGeo(); persist(); return; } // đang toàn màn hình: chỉ mở lại nếu đang thu nhỏ
    const vw = window.innerWidth, vh = window.innerHeight;
    geo.min = false;
    geo.w = Math.max(geo.w, Math.min(vw - 20, 1400));
    geo.h = Math.max(geo.h, Math.min(vh, 800));
    geo.x = clamp(geo.x, 0, Math.max(0, vw - geo.w));
    applyGeo();
    persist();
  }

  // ---------- đồng bộ: object/frame đang chọn trong giao diện CVAT → tool ----------
  function syncFromCvat() {
    const s = readCvatState();
    const key = `${s.num}|${s.frame}`;
    if (key === lastSync) return;
    lastSync = key;
    send({ type: 'cvat', num: s.num, frame: s.frame });
  }

  /** Tool chọn object → giao diện CVAT chuyển focus sang đúng object đó (đổi frame trước nếu object không có ở frame hiện tại). */
  let focusSeq = 0; // lệnh chọn mới hủy lệnh cũ còn đang chờ (tránh kích hoạt nhầm object cũ)
  async function focusInCvat(num: number, targetFrame: number | null, zoom = false, minimize = false) {
    const my = ++focusSeq;
    const stale = () => my !== focusSeq;
    const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
    if (minimize && host) { geo.min = true; applyGeo(); persist(); } // nhường chỗ để thấy giao diện CVAT
    if (targetFrame !== null) {
      // Luôn gửi lệnh đổi frame (không dựa vào số trong ô nhập: ô có thể đang hiện số vừa gõ mà CVAT chưa đổi frame).
      gotoFrame(targetFrame);
      await wait(300);
      if (stale()) return;
    }
    for (let i = 0; i < 40; i++) {
      if (stale()) return;
      if (activateObject(num)) break;
      await wait(250); // danh sách object của CVAT cập nhật sau khi đổi frame (nạp point cloud có thể mất vài giây)
    }
    if (zoom) {
      // Camera 3D của CVAT lại gần object như khi bấm đúp vào nó (hàm focus của chính CVAT). Cần chạy trong ngữ cảnh trang
      // nên nhờ service worker; đợi tới khi CVAT vẽ xong object ở frame hiện tại.
      // Chỉ zoom khi CVAT đã ĐỔI SANG đúng frame cần xem và đã vẽ xong object (trạng thái frame đọc từ chính CVAT),
      // để không zoom vào vị trí của frame cũ. Đợi tối đa ~14 giây vì nạp point cloud mất vài giây.
      let done = false, reason = '';
      // Đợi tối đa ~45 giây: CVAT nạp frame mới mất vài giây, lâu hơn khi server đang bận (tool cũng tạm dừng tải nền trong lúc này).
      for (let i = 0; i < 130 && !done; i++) {
        if (stale()) return;
        try {
          const r = (await api.runtime.sendMessage({ type: 'cvla-focus3d', num, frame: targetFrame })) as { ok?: boolean; reason?: string } | undefined;
          done = !!r?.ok;
          reason = r?.reason ?? (r ? '' : 'no-response');
        } catch (e) { reason = `send-error: ${String(e)}`; break; }
        if (!done) await wait(350);
      }
      if (!done && !stale()) {
        log('Focus: không zoom được vào object', num, 'lý do:', reason);
        send({ type: 'focusFailed', num, reason });
      }
      if (done && !stale()) {
        await wait(500);
        if (stale()) return; // CVAT vẽ lại object sau khi đổi frame; gọi thêm một lần cho chắc
        try { await api.runtime.sendMessage({ type: 'cvla-focus3d', num, frame: targetFrame }); } catch { /* bỏ qua */ }
      }
    }
    blurFrameInput();
    if (!minimize) focusPanel(); // trả focus bàn phím cho tool để phím tắt vẫn hoạt động
  }

  async function rpcUpload(reqId: number, run: () => Promise<unknown>) {
    if (busy) { send({ type: 'rpc', reqId, result: { ok: false, stage: 'rules', sent: false, message: 'Đang có một thao tác ghi khác chạy.', conflicts: [], batches: 0 } }); return; }
    busy = true;
    try { send({ type: 'rpc', reqId, result: await run() }); }
    catch (e) { send({ type: 'rpc', reqId, result: { ok: false, stage: 'write', sent: false, message: String(e), conflicts: [], batches: 0 } }); }
    finally { busy = false; }
  }

  function onMessage(ev: MessageEvent) {
    // Chỉ kiểm origin của extension + mã phiên ngẫu nhiên. Không so ev.source với contentWindow vì Firefox bọc
    // đối tượng cửa sổ khác nhau giữa content script và trang nên phép so sánh có thể sai.
    const m = ev.data as PanelMessage | undefined;
    if (m?.source !== PANEL_SOURCE) return;
    if (ev.origin !== extOrigin || !frame) { log('bỏ qua tin nhắn từ panel: origin', ev.origin, 'mong đợi', extOrigin); return; }
    if (m.session !== session) { log('bỏ qua tin nhắn từ panel: sai mã phiên'); return; }
    handlePanel(m);
  }

  function handlePanel(m: PanelMessage) {
    if (m.type === 'ready') {
      gotReady = true;
      window.clearTimeout(watchdog);
      log('panel sẵn sàng, chế độ', inPage ? 'nhúng trong trang' : 'khung (iframe)');
      lastSync = '';
      void load();
    }
    else if (m.type === 'load') void load();
    else if (m.type === 'close') hide();
    else if (m.type === 'resize') { if (m.wide) ensureWide(); }
    else if (m.type === 'binary') void binary(m.kind, m.n, m.reqId);
    else if (m.type === 'reloadCvat') { try { void api.runtime.sendMessage({ type: 'cvla-reload' }); } catch { /* bỏ qua */ } }
    else if (m.type === 'toggleWindow') toggleWindow();
    else if (m.type === 'hotkeys') toggleCombos = m.toggle;
    else if (m.type === 'dblOpen') dblOpen = m.on;
    else if (m.type === 'cvatFocus') void focusInCvat(m.num, m.frame, !!m.zoom, !!m.minimize);
    else if (m.type === 'upload') void rpcUpload(m.reqId, () => runUpload(uploadDeps, m.req));
    else if (m.type === 'deleteOwn') void rpcUpload(m.reqId, () => runDelete(uploadDeps, m.req));
    else if (m.type === 'revert') void rpcUpload(m.reqId, () => runRevert(uploadDeps, m.real));
    else if (m.type === 'revertInfo') {
      void uploadDeps.loadLog().then((log) => {
        const last = log[log.length - 1];
        send({ type: 'rpc', reqId: m.reqId, result: { last: last ? { time: last.time, tracks: last.ids.length, reverted: last.reverted, verified: last.verified } : null } });
      });
    }
  }

  // Bấm đúp vào object trong CVAT (khung 3D hoặc danh sách object) → mở rộng tool và hiện object đó.
  // Chọn đơn (một cú bấm) không tự mở rộng.
  const FOCUS_TARGETS = '.cvat-canvas3d-perspective, .cvat-canvas3d-orthographic-view, .cvat-objects-sidebar-state-item';
  let dblOpen = true; // panel báo theo ô "CVAT → tool"
  const onDblClick = (e: MouseEvent) => {
      if (!dblOpen || !host || !(e.target instanceof Element) || host.contains(e.target) || !e.target.closest(FOCUS_TARGETS)) return;
      // CVAT kích hoạt object ở cú bấm đầu; chờ giao diện cập nhật rồi đọc object đang kích hoạt.
      window.setTimeout(() => {
        const s = readCvatState();
        if (!host || s.num === null) return;
        geo.min = false;
        ensureWide();
        send({ type: 'cvatDbl', num: s.num, frame: s.frame });
      }, 250);
  };
  document.addEventListener('dblclick', onDblClick, true);

  // Phím bật tắt cửa sổ (mặc định `) hoạt động ngay trên trang CVAT; bỏ qua khi đang gõ vào ô nhập của trang.
  const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName))) return;
      const combo = comboOf(e);
      if (!combo || !toggleCombos.includes(combo)) return;
      e.preventDefault();
      e.stopPropagation();
      toggleWindow();
  };
  document.addEventListener('keydown', onKeyDown, true);

  window.addEventListener('message', onMessage);
  window.addEventListener('resize', applyGeo);
  /** Đóng cửa sổ và gỡ mọi thứ phiên này đã gắn vào trang (để phiên mới thay thế, không để trùng). */
  const dispose = () => {
    hide();
    document.removeEventListener('dblclick', onDblClick, true);
    document.removeEventListener('keydown', onKeyDown, true);
    document.removeEventListener(TAKEOVER, dispose);
    window.removeEventListener('message', onMessage);
    window.removeEventListener('resize', applyGeo);
    if (window.__cvla?.dispose === dispose) delete window.__cvla;
  };
  document.addEventListener(TAKEOVER, dispose);
  window.__cvla = { toggle: () => (host ? hide() : show()), dispose };

  void (async () => {
    try {
      const saved = (await api.storage.local.get(geoKey))[geoKey] as Geo | undefined;
      if (saved && typeof saved.w === 'number') geo = { ...defaultGeo(), ...saved };
    } catch { /* dùng mặc định */ }
    show();
  })();
}

main();
