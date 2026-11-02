import { useLayoutEffect, type RefObject } from 'react';

/**
 * Lớp phủ toàn khung nhìn (hộp thoại) trong chế độ tối / xám: cả panel bị `filter` nên `position: fixed` thành định vị theo panel
 * (không theo khung nhìn): hộp nằm ở giữa cả trang dài, ngoài tầm nhìn, và focus() kéo trang cuộn tới đó. Khi panel có filter,
 * đặt lớp phủ theo đúng khung nhìn hiện tại (cập nhật khi cuộn / đổi cỡ); không có filter thì để nguyên `fixed` trong CSS.
 */
export function useViewportOverlay(ref: RefObject<HTMLElement | null>, active: boolean) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!active || !el) return;
    const root = el.closest('.cvla-root') as HTMLElement | null;
    const view = el.ownerDocument.defaultView;
    if (!root || !view) return;
    const place = () => {
      if (view.getComputedStyle(root).filter === 'none') { el.style.cssText = ''; return; }
      const r = root.getBoundingClientRect();
      Object.assign(el.style, { position: 'absolute', inset: 'auto', left: `${-r.left}px`, top: `${-r.top}px`, width: `${view.innerWidth}px`, height: `${view.innerHeight}px` });
    };
    place();
    view.addEventListener('scroll', place, true);
    view.addEventListener('resize', place);
    return () => { view.removeEventListener('scroll', place, true); view.removeEventListener('resize', place); };
  }, [ref, active]);
}
