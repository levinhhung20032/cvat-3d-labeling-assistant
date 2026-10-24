import { describe, expect, it } from 'vitest';
import { checkUpdate, compareVersions, parseVersion } from '../src/shared/update';

const resp = (status: number, json: unknown = {}) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });

describe('so sánh phiên bản', () => {
  it('đọc v1.2.3 và 1.2.3, từ chối định dạng khác', () => {
    expect(parseVersion('v1.2.3')).toEqual([1, 2, 3]);
    expect(parseVersion('1.0.0')).toEqual([1, 0, 0]);
    expect(parseVersion('latest')).toBeNull();
    expect(parseVersion('1.2')).toBeNull();
  });
  it('so từng thành phần theo số, không theo chữ', () => {
    expect(compareVersions('1.10.0', '1.9.0')! > 0).toBe(true);
    expect(compareVersions('v1.0.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.0.1', '1.0.0')! < 0).toBe(true);
    expect(compareVersions('x', '1.0.0')).toBeNull();
  });
});

describe('checkUpdate', () => {
  it('gửi request ẩn danh (không cookie, không referrer)', async () => {
    let init: RequestInit | undefined;
    await checkUpdate('1.0.0', async (_u, i) => { init = i; return { ok: true, status: 200, json: async () => ({ tag_name: 'v1.0.0' }) }; });
    expect(init).toMatchObject({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer' });
  });
  it('bản mới hơn → newer, chỉ nhận link về đúng repo', async () => {
    const ok = await checkUpdate('1.0.0', resp(200, { tag_name: 'v1.1.0', html_url: 'https://github.com/levinhhung20032/cvat-3d-labeling-assistant/releases/tag/v1.1.0', body: 'ghi chú' }));
    expect(ok).toMatchObject({ kind: 'newer', latest: 'v1.1.0', notes: 'ghi chú' });
    const bad = await checkUpdate('1.0.0', resp(200, { tag_name: 'v1.1.0', html_url: 'https://evil.example/x' }));
    expect(bad.kind === 'newer' && bad.url).toBe('https://github.com/levinhhung20032/cvat-3d-labeling-assistant/releases');
  });
  it('cùng hoặc cũ hơn → uptodate', async () => {
    expect((await checkUpdate('1.0.0', resp(200, { tag_name: 'v1.0.0' }))).kind).toBe('uptodate');
    expect((await checkUpdate('1.2.0', resp(200, { tag_name: 'v1.0.0' }))).kind).toBe('uptodate');
  });
  it('404 (private / chưa có release) và 403 → unreachable; lỗi mạng → error', async () => {
    expect((await checkUpdate('1.0.0', resp(404))).kind).toBe('unreachable');
    expect((await checkUpdate('1.0.0', resp(403))).kind).toBe('unreachable');
    expect((await checkUpdate('1.0.0', async () => { throw new Error('offline'); })).kind).toBe('error');
    expect((await checkUpdate('1.0.0', resp(200, { tag_name: 'abc' }))).kind).toBe('error');
  });
});
