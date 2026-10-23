import { describe, expect, it } from 'vitest';
import { RuleViolationError, planUpload } from '../src/shared/plan';
import { CvatClient } from '../src/content/cvatClient';
import { ann, shape, track } from './fixtures';

describe('planUpload', () => {
  it('không đổi gì → không có payload (khứ hồi rỗng)', () => {
    const a = ann(track(1, [shape(0), shape(1)]));
    expect(planUpload(a, structuredClone(a), 1)).toEqual({ update: null, create: null });
  });
  it('sửa 1 track → chỉ update track đó, kèm version baseline', () => {
    const base = ann(track(1, [shape(0)]), track(2, [shape(0)]));
    const work = structuredClone(base);
    work.tracks[1]!.shapes[0]!.points[0] = 1.5;
    const plan = planUpload(base, work, 0);
    expect(plan.update?.tracks.map((t) => t.id)).toEqual([2]);
    expect(plan.update?.version).toBe(7);
    expect(plan.create).toBeNull();
  });
  it('track mới (không id) vào create', () => {
    const base = ann(track(1, [shape(0)]));
    const work = structuredClone(base);
    work.tracks.push(track(undefined, [shape(0)]));
    expect(planUpload(base, work, 0).create?.tracks).toHaveLength(1);
  });
  it('ném lỗi khi vi phạm luật', () => {
    const base = ann(track(1, [shape(0)]));
    expect(() => planUpload(base, ann(), 0)).toThrow(RuleViolationError);
  });
});

describe('CvatClient', () => {
  const payload = { version: 1, tags: [], shapes: [], tracks: [] };
  it('dry-run mặc định: không gọi fetch', async () => {
    let calls = 0;
    const c = new CvatClient({ origin: 'https://x.test', fetchImpl: (async () => { calls++; return new Response('{}'); }) as typeof fetch });
    const r = await c.write(5, 'update', payload);
    expect(r.sent).toBe(false);
    expect(calls).toBe(0);
  });
  it('từ chối action=delete', async () => {
    const c = new CvatClient({ origin: 'https://x.test', dryRun: false });
    await expect(c.write(5, 'delete' as never, payload)).rejects.toThrow();
  });
  it('ghi thật dùng PATCH + credentials include, không có DELETE/PUT', async () => {
    const seen: { url: string; init?: RequestInit }[] = [];
    const c = new CvatClient({
      origin: 'https://x.test',
      dryRun: false,
      fetchImpl: (async (url: string, init?: RequestInit) => { seen.push({ url, init }); return new Response('{}'); }) as typeof fetch,
    });
    await c.write(5, 'update', payload);
    expect(seen[0]!.url).toBe('https://x.test/api/jobs/5/annotations?action=update');
    expect(seen[0]!.init?.method).toBe('PATCH');
    expect(seen[0]!.init?.credentials).toBe('include');
  });
});

describe('CvatClient GET', () => {
  it('không đặt header Accept (CVAT 2.77.1 trả 406 với application/json)', async () => {
    const seen: RequestInit[] = [];
    const c = new CvatClient({
      origin: 'https://x.test',
      fetchImpl: (async (_u: string, init?: RequestInit) => { seen.push(init ?? {}); return new Response('{"id":1}'); }) as typeof fetch,
    });
    await c.getJob(1);
    expect(seen[0]!.headers).toBeUndefined();
    expect(seen[0]!.credentials).toBe('include');
  });
});
