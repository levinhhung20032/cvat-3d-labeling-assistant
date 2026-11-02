/**
 * Điểm gắn của bản DEV. Bản chính (`npm run build`) dùng đúng file này: không làm gì cả.
 * Bản DEV (`npm run build:dev`, thư mục dist-dev) dùng `src/dev/hooks.local.ts` nếu có (file đó nằm trong .gitignore, không commit,
 * không có trong gói phát hành); xem build.mjs (bí danh `dev-hooks`). Hai file phải xuất cùng các hàm.
 */

/** Ép panel chạy ở chế độ nhúng trong trang (dùng khi iframe của extension hiện trắng, ví dụ trình duyệt đang bị điều khiển tự động). */
export const devForceInPage = (): boolean => false;

/** Gọi một lần khi content script khởi động. */
export function devContentStart(): void { /* bản chính: không làm gì */ }

/** Gọi một lần khi service worker khởi động. */
export function devBackgroundStart(): void { /* bản chính: không làm gì */ }
