/** Chiều cao thanh đầu dính (tiêu đề + tab); tìm trong cùng document / Shadow DOM với phần tử (chế độ nhúng). */
const headHeight = (el: HTMLElement) => (el.getRootNode() as Document | ShadowRoot).querySelector<HTMLElement>('.cvla-head')?.getBoundingClientRect().height ?? 0;

/**
 * Cuộn ngay (không hiệu ứng) để phần tử nằm ở đầu vùng nhìn, ngay dưới thanh đầu dính; không đổi focus.
 * `extra`: chiều cao các hàng dính khác nằm dưới thanh đầu (vd. dòng tên cột của bảng object) để phần tử không bị chúng che.
 */
export function scrollToTopOfPanel(el: HTMLElement | null, extra = 0) {
  if (!el) return;
  el.style.scrollMarginTop = `${headHeight(el) + extra + 4}px`;
  el.scrollIntoView({ block: 'start' });
}

/** Cuộn panel để phần tử hiện đầy đủ ngay dưới thanh đầu dính (tiêu đề + tab); dùng cho hộp thoại mở ra khi người dùng đang cuộn xuống. */
export function scrollIntoPanel(el: HTMLElement | null, block: 'start' | 'nearest' = 'start') {
  if (!el) return;
  el.style.scrollMarginTop = `${headHeight(el) + 8}px`;
  el.scrollIntoView({ block, behavior: 'smooth' });
  if (block === 'start') { el.tabIndex = -1; el.style.outline = 'none'; el.focus({ preventScroll: true }); } // trả focus bàn phím cho hộp thoại
}
