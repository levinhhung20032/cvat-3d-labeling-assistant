import { beforeAll, describe, expect, it } from 'vitest';

// Giả lập storage.local + manifest của extension (api.ts đọc globalThis.chrome lúc nạp module).
const disk: Record<string, unknown> = {};
let quotaLeft = Infinity; // số byte còn trống của kho giả (giả lập kho đầy)
const size = () => Object.values(disk).reduce<number>((n, v) => n + String(v).length, 0);
const runtime: { id?: string; getManifest: () => unknown } = { id: 'test-ext', getManifest: () => ({ host_permissions: ['https://cvat-a.example.com/*'] }) };
(globalThis as unknown as { chrome: unknown }).chrome = {
  storage: { local: {
    get: async (k: string | null) => (k === null ? { ...disk } : { [k]: disk[k] }),
    set: async (o: Record<string, unknown>) => {
      const add = Object.values(o).reduce<number>((n, v) => n + String(v).length, 0);
      if (size() + add > quotaLeft) throw new Error('QUOTA_BYTES quota exceeded');
      Object.assign(disk, o);
    },
    remove: async (k: string | string[]) => { for (const x of Array.isArray(k) ? k : [k]) delete disk[x]; },
  } },
  runtime,
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

  it('kho đầy: tự xoá kết quả tính lưu sẵn (tính lại được) rồi ghi lại; vẫn không đủ thì báo lỗi, không mất lặng lẽ', async () => {
    S.kv.set('cvla-pass:1', 'x'.repeat(500));
    await new Promise((r) => setTimeout(r, 0));
    expect(disk['ui:cvla-pass:1']).toBeDefined();
    quotaLeft = size() + 100;
    S.kv.set('cvla-shifts', 'y'.repeat(300)); // không đủ chỗ → xoá cvla-pass:1 → ghi được
    await new Promise((r) => setTimeout(r, 0));
    expect(disk['ui:cvla-pass:1']).toBeUndefined();
    expect(disk['ui:cvla-shifts']).toBe('y'.repeat(300));
    expect(S.storageHealth().ok).toBe(true);
    S.kv.set('cvla-big', 'z'.repeat(5000)); // không còn gì để xoá
    await new Promise((r) => setTimeout(r, 0));
    expect(S.storageHealth()).toMatchObject({ ok: false, reason: 'quota' });
    quotaLeft = Infinity;
    S.kv.set('cvla-theme', 'light'); // ghi được lại: hết báo lỗi
    await new Promise((r) => setTimeout(r, 0));
    expect(S.storageHealth().ok).toBe(true);
  });

  it('extension vừa Reload (phiên cũ mất runtime.id): báo ngay, không ghi nữa', async () => {
    let n = 0;
    const off = S.onStorageHealth(() => n++);
    delete runtime.id;
    S.kv.set('cvla-theme', 'dark');
    expect(S.storageHealth()).toMatchObject({ ok: false, reason: 'orphan' });
    expect(n).toBe(1);
    expect(disk['ui:cvla-theme']).toBe('light');
    off();
    runtime.id = 'test-ext';
  });
});
