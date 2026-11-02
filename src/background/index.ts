// Service worker (Edge / Chrome) hoặc event page (Firefox): chỉ bật/tắt theo tab. Không chạm dữ liệu nhãn.
import { api, IS_FIREFOX } from '../shared/api';
import { jobOrigin, originPattern } from '../shared/hosts';
import { devBackgroundStart } from 'dev-hooks';

/**
 * Chạy trên trang job (/tasks/<id>/jobs/<id>) của máy chủ CVAT người dùng đã thêm: host mặc định trong manifest + tên miền đã
 * thêm ở trang Cài đặt (quyền host tùy chọn, người dùng tự cấp từng tên miền). Tên miền chưa thêm: mở Cài đặt, điền sẵn tên miền.
 */
api.action.onClicked.addListener(async (tab) => {
  const origin = jobOrigin(tab.url);
  // Firefox MV3: quyền host là TÙY CHỌN, phải xin trong chính thao tác của người dùng (gọi ngay, không await trước); hộp thoại
  // của Firefox ghi rõ tên miền. Đã được cấp thì trả về true ngay, không hỏi.
  const asked = IS_FIREFOX && origin ? api.permissions.request({ origins: [originPattern(origin)] }) : null;
  if (!tab.id || !origin) {
    await api.action.setBadgeText({ tabId: tab.id, text: '!' });
    return;
  }
  const granted = asked ? await asked : await api.permissions.contains({ origins: [originPattern(origin)] });
  if (!granted) {
    await api.action.setBadgeText({ tabId: tab.id, text: '+' });
    if (!IS_FIREFOX) await api.tabs.create({ url: api.runtime.getURL(`options.html#add=${encodeURIComponent(origin)}`) });
    return;
  }
  await api.action.setBadgeText({ tabId: tab.id, text: '' });
  await api.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
});

/**
 * Chạy trong NGỮ CẢNH TRANG CVAT (world MAIN): lấy redux store của giao diện CVAT rồi gọi hàm focus có sẵn của
 * canvas 3D (giống bấm đúp vào object). Chỉ điều khiển camera, không đọc hay sửa dữ liệu nhãn.
 */
function focusObject3d(num: number, frame: number | null): { ok: boolean; reason?: string } {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const root = document.getElementById('root') as any;
  const key = root && Object.keys(root).find((k) => k.startsWith('__reactContainer'));
  if (!key) return { ok: false, reason: 'no-root' };
  let store: any = null;
  const seen = new Set<unknown>();
  const stack: any[] = [root[key]];
  let n = 0;
  while (stack.length && !store && n++ < 5000) {
    const f = stack.pop();
    if (!f || seen.has(f)) continue;
    seen.add(f);
    const p = f.memoizedProps;
    if (p && p.store && typeof p.store.getState === 'function') { store = p.store; break; }
    if (f.child) stack.push(f.child);
    if (f.sibling) stack.push(f.sibling);
  }
  const inst = store?.getState()?.annotation?.canvas?.instance;
  if (!inst || typeof inst.focus !== 'function') return { ok: false, reason: 'no-canvas3d' };
  // Frame hiện tại của CVAT (trong redux, không phải số trong ô nhập) phải đúng frame cần xem và đã nạp xong.
  const fr = store?.getState()?.annotation?.player?.frame;
  if (frame !== null && (!fr || fr.number !== frame || fr.fetching)) return { ok: false, reason: 'wrong-frame' };
  if (!inst.view?.drawnObjects?.[num]) return { ok: false, reason: 'not-drawn' };
  inst.focus(num);
  return { ok: true };
}

// Sau upload: tải lại tab CVAT để giao diện CVAT hiện đúng dữ liệu mới (nó còn giữ bản cũ trong bộ nhớ, bấm Save sẽ ghi đè),
// rồi tự mở lại tool. Cờ chỉ có hiệu lực 60 giây và chỉ cho đúng tab đó.
const REOPEN_KEY = 'cvla-reopen';
api.tabs.onUpdated.addListener(async (tabId, info, tab) => {
  if (info.status !== 'complete' || !jobOrigin(tab.url)) return;
  const got = (await api.storage.local.get(REOPEN_KEY)) as Record<string, { tabId: number; at: number } | undefined>;
  const flag = got[REOPEN_KEY];
  if (!flag || flag.tabId !== tabId) return;
  await api.storage.local.remove(REOPEN_KEY);
  if (Date.now() - flag.at > 60_000) return;
  try { await api.scripting.executeScript({ target: { tabId }, files: ['content.js'] }); } catch { /* quyền chưa có: người dùng bấm biểu tượng để mở lại */ }
});

api.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const tabId = sender.tab?.id;
  if (msg?.type === 'cvla-reload' && sender.id === api.runtime.id && tabId !== undefined) {
    void api.storage.local.set({ [REOPEN_KEY]: { tabId, at: Date.now() } }).then(() => api.tabs.reload(tabId)).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
  if (msg?.type !== 'cvla-focus3d' || sender.id !== api.runtime.id || tabId === undefined || !Number.isInteger(msg.num)) return;
  api.scripting
    .executeScript({ target: { tabId }, world: 'MAIN', func: focusObject3d, args: [msg.num as number, Number.isInteger(msg.frame) ? (msg.frame as number) : null] })
    .then((r) => sendResponse(r[0]?.result ?? { ok: false }))
    .catch((e) => sendResponse({ ok: false, reason: String(e) }));
  return true; // trả lời bất đồng bộ
});

devBackgroundStart(); // chỉ bản DEV (build:dev); bản chính không làm gì
