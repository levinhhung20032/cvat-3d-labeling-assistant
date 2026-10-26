/** Cuộn panel để phần tử hiện đầy đủ ngay dưới thanh đầu dính (tiêu đề + tab); dùng cho hộp thoại mở ra khi người dùng đang cuộn xuống. */
export function scrollIntoPanel(el: HTMLElement | null, block: 'start' | 'nearest' = 'start') {
  if (!el) return;
  const head = document.querySelector<HTMLElement>('.cvla-head');
  el.style.scrollMarginTop = `${(head?.getBoundingClientRect().height ?? 0) + 8}px`;
  el.scrollIntoView({ block, behavior: 'smooth' });
  if (block === 'start') { el.tabIndex = -1; el.style.outline = 'none'; el.focus({ preventScroll: true }); } // trả focus bàn phím cho hộp thoại
}
