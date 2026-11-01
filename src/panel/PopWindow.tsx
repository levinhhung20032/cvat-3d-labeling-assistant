import { useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { STYLE } from './styles';

/**
 * Cửa sổ rời (pop out): mở một cửa sổ trình duyệt nhỏ và vẽ `children` vào đó bằng portal, nên vẫn là cùng một cây React
 * (số liệu, nút bấm vẫn sống, không sao chép trạng thái). Đóng cửa sổ (hoặc đổi tab trong tool) thì `onClose` được gọi.
 * Trình duyệt chỉ cho mở khi gọi trong lúc xử lý một cú bấm; không mở được thì `onFail`.
 */
export function PopWindow({ title, rootClass, width, height, onClose, onFail, children }: {
  title: string; rootClass: string; width: number; height: number; onClose: () => void; onFail: () => void; children: ReactNode;
}) {
  const [host, setHost] = useState<HTMLElement | null>(null);
  useEffect(() => {
    const w = window.open('', '_blank', `popup=yes,width=${Math.round(width)},height=${Math.round(height)}`);
    if (!w) { onFail(); return; }
    w.document.title = title;
    w.document.body.style.margin = '0';
    const style = w.document.createElement('style');
    style.textContent = STYLE;
    w.document.head.appendChild(style);
    const root = w.document.createElement('div');
    root.className = rootClass;
    root.style.cssText = 'font: 13px/1.4 system-ui; padding: 8px; color: #111;';
    w.document.body.appendChild(root);
    setHost(root);
    const t = window.setInterval(() => { if (w.closed) onClose(); }, 500);
    return () => { window.clearInterval(t); try { w.close(); } catch { /* bỏ qua */ } };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return host ? createPortal(children, host) : null;
}
