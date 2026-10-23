/**
 * Một giao diện cho cả hai trình duyệt: Firefox có `browser` (promise), Edge / Chrome có `chrome`.
 * `__FIREFOX__` được đặt lúc build (Vite `define`); khi chạy test (không qua build) coi là false.
 */
export const api: typeof chrome = (globalThis as unknown as { browser?: typeof chrome }).browser ?? chrome;

declare const __FIREFOX__: boolean;
export const IS_FIREFOX = typeof __FIREFOX__ !== 'undefined' && __FIREFOX__;
