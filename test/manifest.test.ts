import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

interface Manifest {
  manifest_version: number; name: string; version: string;
  permissions: string[]; host_permissions: string[]; optional_host_permissions?: string[];
  options_ui?: { page: string; open_in_tab?: boolean };
  background: { service_worker?: string; scripts?: string[] };
  content_scripts?: unknown;
  web_accessible_resources?: { resources: string[]; matches: string[] }[];
  content_security_policy: { extension_pages: string };
  browser_specific_settings?: { gecko?: { id: string; strict_min_version: string; data_collection_permissions?: { required: string[] } } };
}
const load = (f: string) => JSON.parse(readFileSync(f, 'utf8')) as Manifest;
const chromium = load('public/manifest.json');
const firefox = load('public/manifest.firefox.json');

describe.each([['Edge / Chrome', chromium], ['Firefox', firefox]] as const)('manifest %s — luật quyền riêng tư', (_n, m) => {
  it('không có host mặc định, không xin quyền cookies / tabs / history / webRequest', () => {
    expect(m.host_permissions).toEqual([]); // chủ dự án bỏ host mặc định cvat-a 2026-10-29: mọi máy chủ do người dùng tự thêm
    // Máy chủ CVAT khác: người dùng tự thêm ở trang Cài đặt (chủ dự án duyệt 2026-10-28). Chỉ là quyền TÙY CHỌN https —
    // không tên miền nào được cấp sẵn, trình duyệt hỏi người dùng cho từng tên miền.
    expect(m.optional_host_permissions).toEqual(['https://*/*']);
    expect(m.options_ui?.page).toBe('options.html');
    for (const bad of ['cookies', 'tabs', 'history', 'webRequest', 'webRequestBlocking', 'downloads', 'identity', '<all_urls>']) {
      expect(m.permissions).not.toContain(bad);
    }
    expect(m.permissions.sort()).toEqual(['activeTab', 'scripting', 'storage']);
  });
  it('không tự chèn script (chỉ chèn khi người dùng bấm biểu tượng)', () => {
    expect(m.content_scripts).toBeUndefined();
  });
  it('trang của extension không truy cập được từ trang web nào (không web_accessible_resources), CSP chặt', () => {
    expect(m.web_accessible_resources).toBeUndefined();
    expect(m.content_security_policy.extension_pages).toBe("script-src 'self'; object-src 'self'");
  });
  it('MV3', () => expect(m.manifest_version).toBe(3));
});

describe('hai manifest đồng bộ', () => {
  it('cùng tên, phiên bản, quyền', () => {
    expect(firefox.name).toBe(chromium.name);
    expect(firefox.version).toBe(chromium.version);
    expect([...firefox.permissions].sort()).toEqual([...chromium.permissions].sort());
    expect(firefox.web_accessible_resources).toEqual(chromium.web_accessible_resources);
    expect(firefox.optional_host_permissions).toEqual(chromium.optional_host_permissions);
    expect(firefox.options_ui).toEqual(chromium.options_ui);
  });
  it('khác nhau đúng chỗ cần khác: Edge dùng service worker, Firefox dùng event page + id', () => {
    expect(chromium.background.service_worker).toBe('background.js');
    expect(chromium.background.scripts).toBeUndefined();
    expect(firefox.background.scripts).toEqual(['background.js']);
    expect(firefox.background.service_worker).toBeUndefined();
    expect(firefox.browser_specific_settings?.gecko?.id).toMatch(/^[\w.-]+@[\w.-]+$/);
    expect(Number.parseInt(firefox.browser_specific_settings!.gecko!.strict_min_version, 10)).toBeGreaterThanOrEqual(128); // world MAIN
    expect(firefox.browser_specific_settings?.gecko?.data_collection_permissions?.required).toEqual(['none']);
  });
});
