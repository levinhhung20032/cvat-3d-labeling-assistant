import { beforeAll, describe, expect, it } from 'vitest';

// Giả lập storage.local + manifest của extension (api.ts đọc globalThis.chrome lúc nạp module).
const disk: Record<string, unknown> = {};
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: {
    get: async (k: string | null) => (k === null ? { ...disk } : { [k]: disk[k] }),
    set: async (o: Record<string, unknown>) => { Object.assign(disk, o); },
    remove: async (k: string) => { delete disk[k]; },
  } },
  runtime: { getManifest: () => ({ host_permissions: ['https://cvat-a.example.com/*'] }) },
};
let S: typeof import('../src/panel/storage');
beforeAll(async () => { S = await import('../src/panel/storage'); });

describe('kho lưu trữ khi có nhiều máy chủ CVAT', () => {
  it('store nạp ở cấp module được gọi lại khi kho sẵn sàng (chế độ nhúng: module nạp trước kho)', async () => {
    const calls: string[] = [];
    S.whenStorageReady(() => calls.push('early'));
    expect(calls).toEqual([]);
    disk['ui:cvla-theme'] = 'dark';
    disk['ui:cvla-made:9999'] = '[10]';
    disk['ui:cvla-qc'] = '{"9999:1:0":"ghi chú"}';
    await S.useExtensionStorage('https://cvat-a.example.com');
    expect(calls).toEqual(['early']);
    S.whenStorageReady(() => calls.push('late'));
    expect(calls).toEqual(['early', 'late']);
  });

  it('máy chủ mặc định giữ nguyên khóa cũ: đọc được dữ liệu sẵn có', () => {
    expect(S.defaultOrigin()).toBe('https://cvat-a.example.com');
    expect(S.kv.get('cvla-made:9999')).toBe('[10]');
    expect(S.kv.get('cvla-qc')).toBe('{"9999:1:0":"ghi chú"}');
  });

  it('máy chủ khác: dữ liệu theo job (sổ object do tool tạo, ghi chú QC…) KHÔNG lọt sang, ghi vào khóa riêng; tùy chọn cá nhân dùng chung', async () => {
    await S.useExtensionStorage('https://cvat-b.example.com');
    expect(S.kv.get('cvla-made:9999')).toBeNull(); // job 9999 của máy chủ kia không phải job này: không được coi là object do tool tạo
    expect(S.kv.get('cvla-qc')).toBeNull();
    expect(S.kv.get('cvla-theme')).toBe('dark');
    S.kv.set('cvla-made:9999', '[99]');
    S.kv.set('cvla-theme', 'gray');
    await Promise.resolve();
    expect(disk['ui@https://cvat-b.example.com|cvla-made:9999']).toBe('[99]');
    expect(disk['ui:cvla-made:9999']).toBe('[10]'); // máy chủ mặc định không bị đụng
    expect(disk['ui:cvla-theme']).toBe('gray');
    expect(S.storageKey('cvla-draft:5', 'https://cvat-b.example.com')).toBe('ui@https://cvat-b.example.com|cvla-draft:5');
    expect(S.storageKey('cvla-keymap', 'https://cvat-b.example.com')).toBe('ui:cvla-keymap');
  });

  it('quay lại máy chủ mặc định: thấy lại đúng dữ liệu của nó', async () => {
    await S.useExtensionStorage('https://cvat-a.example.com');
    expect(S.kv.get('cvla-made:9999')).toBe('[10]');
    expect(S.kv.get('cvla-theme')).toBe('gray');
  });
});
