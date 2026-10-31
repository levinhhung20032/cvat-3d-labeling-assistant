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
let P: typeof import('../src/panel/passStore');
let S: typeof import('../src/panel/storage');
beforeAll(async () => {
  S = await import('../src/panel/storage');
  await S.useExtensionStorage('https://cvat-a.example.com');
  P = await import('../src/panel/passStore');
});

const box = { x: 10, y: 2, z: 0.8, rx: 0, ry: 0, yaw: 0.3, sx: 4.5, sy: 1.9, sz: 1.6 };

describe('lưu kết quả tính của cả job (tab CVAT tải lại không phải tính lại từ đầu)', () => {
  it('chữ ký box: giống hệt thì trùng, đổi vị trí / hướng / kích thước thì khác', () => {
    expect(P.sigOf(box)).toBe(P.sigOf({ ...box }));
    for (const k of ['x', 'y', 'z', 'yaw', 'sx', 'sy', 'sz'] as const) expect(P.sigOf({ ...box, [k]: box[k] + 0.01 })).not.toBe(P.sigOf(box));
  });

  it('lưu rồi đọc lại đúng từng (frame, object)', () => {
    const res = new Map([[3, new Map([[1, { sig: P.sigOf(box), sparse: true, n: 4 }], [2, { sig: 'abc', sparse: false, n: 31 }]])]]);
    P.savePass('cvla-pass:1001', res);
    const back = P.loadPass('cvla-pass:1001');
    expect(back.get(3)?.get(1)).toEqual({ sig: P.sigOf(box), sparse: true, n: 4 });
    expect(back.get(3)?.get(2)).toEqual({ sig: 'abc', sparse: false, n: 31 });
  });

  it('kết quả của phiên bản thuật toán khác (hoặc hỏng) thì bỏ, tính lại', () => {
    S.kv.set('cvla-pass:77', JSON.stringify({ v: 'cũ', frames: { 0: [[1, 'x', 1]] } }));
    expect(P.loadPass('cvla-pass:77').size).toBe(0);
    S.kv.set('cvla-pass:78', '{hỏng');
    expect(P.loadPass('cvla-pass:78').size).toBe(0);
  });

  it('chỉ giữ PASS_KEEP_JOBS (10) job gần nhất', () => {
    const res = new Map([[0, new Map([[1, { sig: 's', sparse: false, n: 12 }]])]]);
    for (let j = 1; j <= P.PASS_KEEP_JOBS + 3; j++) P.savePass(`cvla-pass:${2000 + j}`, res);
    expect(S.kv.get('cvla-pass:2001')).toBeNull(); // cũ nhất đã bị xóa
    expect(S.kv.get(`cvla-pass:${2000 + P.PASS_KEEP_JOBS + 3}`)).not.toBeNull();
    expect((JSON.parse(S.kv.get('cvla-passidx')!) as string[]).length).toBe(P.PASS_KEEP_JOBS);
  });
});
