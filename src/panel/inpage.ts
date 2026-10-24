import type { ContentMessage, PanelMessage } from '../shared/protocol';
import { setHost, type PanelHost } from './bridge';
import { useExtensionStorage } from './storage';

export interface InPagePanel {
  deliver(m: ContentMessage): void; // content → panel
  focus(): void;
  destroy(): void;
}

/**
 * Chế độ dự phòng khi iframe của extension không hoạt động (bị trình duyệt hoặc chính sách của trang chặn):
 * vẽ panel thẳng vào trang, trong Shadow DOM đóng (CSS của trang không lọt vào, mã của trang không đọc được giao diện).
 * Phím gõ trong panel được chặn lại, không lọt ra các phím tắt của CVAT. Panel và content script chạy chung một ngữ cảnh
 * nên gọi nhau trực tiếp (không cần postMessage, không phụ thuộc origin).
 */
export async function mountInPage(
  container: HTMLElement,
  session: string,
  onPanelMessage: (m: PanelMessage) => void,
): Promise<InPagePanel> {
  // Chỉ để kiểm thử tự động trong trang thử nghiệm (đặt ở thế giới của trang, content script thật không thấy cờ này).
  const open = (globalThis as { __CVLA_TEST_OPEN__?: boolean }).__CVLA_TEST_OPEN__ === true;
  const shadow = container.attachShadow({ mode: open ? 'open' : 'closed' });
  const style = document.createElement('style');
  style.textContent =
    ':host{all:initial;display:block;width:100%;height:100%}' +
    '.root{width:100%;height:100%;overflow:auto;background:#fff;color:#111;font:13px system-ui;outline:none}';
  const root = document.createElement('div');
  root.className = 'root';
  root.tabIndex = -1; // nhận focus bàn phím khi bấm vào panel
  shadow.append(style, root);
  root.addEventListener('pointerdown', (e) => {
    const t = e.target as HTMLElement;
    if (!/^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(t.tagName)) root.focus({ preventScroll: true });
  });
  // Phím gõ trong panel không được lọt ra phím tắt của CVAT.
  for (const type of ['keydown', 'keyup', 'keypress'] as const) root.addEventListener(type, (e) => e.stopPropagation());

  await useExtensionStorage();

  const listeners = new Set<(m: ContentMessage) => void>();
  const host: PanelHost = {
    mode: 'inpage',
    session,
    post: (m) => { queueMicrotask(() => onPanelMessage(m)); },
    subscribe(cb) { listeners.add(cb); return () => { listeners.delete(cb); }; },
    keyTarget: root,
    viewport: () => ({ w: root.clientWidth, h: root.clientHeight }),
    onViewport(cb) {
      const ro = new ResizeObserver(cb);
      ro.observe(root);
      return () => ro.disconnect();
    },
  };
  setHost(host);
  const { mountPanel } = await import('./mount'); // sau khi kho lưu trữ đã nạp (các store đọc dữ liệu lúc nạp module)
  const reactRoot = mountPanel(root);
  return {
    deliver: (m) => { listeners.forEach((cb) => cb(m)); },
    focus: () => root.focus({ preventScroll: true }),
    destroy: () => { reactRoot.unmount(); listeners.clear(); },
  };
}
