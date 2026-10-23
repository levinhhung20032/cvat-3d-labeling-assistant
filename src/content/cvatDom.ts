/**
 * Đọc trạng thái chọn của giao diện CVAT từ DOM (chỉ đọc, không thao tác gì lên giao diện).
 * Đã kiểm trên CVAT 2.77.1: object đang chọn/được kích hoạt có class
 * `cvat-objects-sidebar-state-active-item`, ID hiển thị là chữ đầu tiên trong mục; frame hiện tại nằm
 * trong ô nhập của `.cvat-player-frame-selector`. Tên class phụ thuộc phiên bản CVAT.
 */
export function parseInt10(text: string | null | undefined): number | null {
  const t = text?.trim();
  return t && /^\d+$/.test(t) ? Number(t) : null;
}

export function readCvatState(doc: Document = document): { num: number | null; frame: number | null } {
  const active = doc.querySelector('.cvat-objects-sidebar-state-active-item');
  const num = parseInt10(active?.querySelector('span.ant-typography')?.textContent);
  const input = doc.querySelector<HTMLInputElement>('.cvat-player-frame-selector input');
  return { num, frame: parseInt10(input?.value) };
}

const itemOf = (num: number, doc: Document) =>
  [...doc.querySelectorAll('.cvat-objects-sidebar-state-item')].find(
    (e) => parseInt10(e.querySelector('span.ant-typography')?.textContent) === num,
  ) ?? null;

/**
 * Kích hoạt object `num` trong giao diện CVAT như khi rê chuột lên mục của nó trong danh sách bên phải
 * (CVAT kích hoạt/tô sáng object theo cách này). Trả false nếu object không có trong danh sách ở frame hiện tại.
 */
export function activateObject(num: number, doc: Document = document): boolean {
  const el = itemOf(num, doc);
  if (!el) return false;
  el.scrollIntoView({ block: 'nearest' });
  el.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
  el.dispatchEvent(new MouseEvent('mouseenter'));
  return true;
}

/** Đổi frame hiện tại của CVAT bằng ô nhập frame (như người dùng gõ số rồi Enter). */
export function gotoFrame(frame: number, doc: Document = document): boolean {
  const input = doc.querySelector<HTMLInputElement>('.cvat-player-frame-selector input');
  if (!input) return false;
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (!set) return false;
  // Phải focus ô nhập: nếu ô không đang được focus thì CVAT KHÔNG đổi frame dù có gửi Enter (đã thử trên CVAT 2.77.1).
  input.focus({ preventScroll: true });
  set.call(input, String(frame));
  input.dispatchEvent(new Event('input', { bubbles: true }));
  const key = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true };
  input.dispatchEvent(new KeyboardEvent('keydown', key));
  input.dispatchEvent(new KeyboardEvent('keyup', key));
  return true;
}

/** Trả focus bàn phím về trang sau khi đổi frame (tránh để ô nhập frame của CVAT hứng phím gõ). */
export function blurFrameInput(doc: Document = document): void {
  const input = doc.querySelector<HTMLInputElement>('.cvat-player-frame-selector input');
  if (input && doc.activeElement === input) input.blur();
}
