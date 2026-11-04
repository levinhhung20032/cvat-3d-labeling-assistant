import { describe, expect, it } from 'vitest';
import { runDelete, runUpload, type LogEntry, type UploadDeps, type UploadReq } from '../src/content/uploader';
import { CvatClient } from '../src/content/cvatClient';
import { buildUploadPlan } from '../src/shared/upload';
import { applyDraft, buildDraft, checkDraft } from '../src/shared/draft';
import { buildRows } from '../src/shared/table';
import type { CvatAnnotations, CvatShape, CvatTrack } from '../src/shared/types';

let sid = 5000, tid = 100;
const sh = (frame: number, outside = false, x = 0): CvatShape => ({
  type: 'cuboid', frame, outside, occluded: false, z_order: 0, rotation: 0, points: [x, 0, 0, 0, 0, 0, 4, 2, 1.5, 0, 0, 0, 0, 0, 0, 0], attributes: [],
});
const withIds = (t: CvatTrack): CvatTrack => ({ ...t, id: t.id ?? ++tid, shapes: t.shapes.map((s) => ({ ...s, id: s.id ?? ++sid })) });
const tr = (id: number | undefined, shapes: CvatShape[]): CvatTrack => ({ ...(id ? { id } : {}), label_id: 1, frame: shapes[0]!.frame, group: 0, source: 'manual', attributes: [], elements: [], shapes });
const ann = (...tracks: CvatTrack[]): CvatAnnotations => ({ version: 0, tags: [], shapes: [], tracks });
const STOP = 9;

function fakeServer(initial: CvatAnnotations) {
  let state = structuredClone(initial);
  const writes: { action: string; n: number }[] = [];
  const deleted: number[][] = [];
  let log: LogEntry[] = [];
  const deps: UploadDeps = {
    jobId: 1,
    read: async () => structuredClone(state),
    write: async (p, action = 'update') => {
      writes.push({ action, n: p.tracks.length });
      for (const t of p.tracks) {
        if (action === 'create') { state.tracks.push(withIds(structuredClone(t))); continue; }
        const i = state.tracks.findIndex((x) => x.id === t.id);
        if (i < 0) throw new Error('track không tồn tại');
        state.tracks[i] = withIds(structuredClone(t));
      }
    },
    deleteOwn: async (tracks, allowed) => {
      for (const t of tracks) if (!allowed.has(t.id!)) throw new Error('từ chối');
      deleted.push(tracks.map((t) => t.id!));
      state.tracks = state.tracks.filter((x) => !tracks.some((t) => t.id === x.id));
    },
    loadLog: async () => structuredClone(log),
    saveLog: async (l) => { log = structuredClone(l); },
  };
  return { deps, writes, deleted, get state() { return state; } };
}

const base = () => ann(withIds(tr(undefined, [sh(0), sh(5)])), withIds(tr(undefined, [sh(0), sh(5)])));
const planWithNew = (b: CvatAnnotations) => {
  const w = structuredClone(b);
  w.tracks.push(tr(undefined, [sh(2, false, 7), sh(3, false, 8), sh(4, true, 8)]));
  return { w, plan: buildUploadPlan(b, w, STOP) };
};

describe('kế hoạch có object mới do tool tạo', () => {
  it('track không id nằm sau mọi track của CVAT thì thành created, keyframe outside được điền', () => {
    const b = base();
    const { plan } = planWithNew(b);
    expect(plan.blockers).toEqual([]);
    expect(plan.changed).toEqual([]);
    expect(plan.created).toHaveLength(1);
    expect(plan.created[0]!.id).toBeUndefined();
    expect(plan.created[0]!.shapes.map((s) => s.frame)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.createdInfo[0]).toMatchObject({ index: 2, outsideFilled: 5 });
  });
  it('track không id nằm GIỮA danh sách (làm lệch ID cũ) thì bị chặn', () => {
    const b = base();
    const w = structuredClone(b);
    w.tracks.splice(1, 0, tr(undefined, [sh(1)]));
    expect(buildUploadPlan(b, w, STOP).blockers.length).toBeGreaterThan(0);
  });
});

describe('upload tạo object mới', () => {
  it('chạy thử không gửi gì; chạy thật gửi create, đọc lại khớp, trả ID mới', async () => {
    const b = base();
    const { plan } = planWithNew(b);
    const req: UploadReq = { real: false, changed: plan.changed, created: plan.created, expected: plan.expected, baselineIds: b.tracks.map((t) => t.id!), stopFrame: STOP };
    const s = fakeServer(b);
    const dry = await runUpload(s.deps, req);
    expect(dry).toMatchObject({ ok: true, sent: false });
    expect(s.writes).toEqual([]);
    const r = await runUpload(s.deps, { ...req, real: true });
    expect(r).toMatchObject({ ok: true, stage: 'done' });
    expect(s.writes).toEqual([{ action: 'create', n: 1 }]);
    expect(r.createdIds).toHaveLength(1);
    expect(s.state.tracks).toHaveLength(3);
    expect(s.state.tracks[2]!.id).toBe(r.createdIds![0]);
  });
  it('object mới mang sẵn id bị từ chối', async () => {
    const b = base();
    const { plan } = planWithNew(b);
    const bad = { ...plan.created[0]!, id: 1 };
    const r = await runUpload(fakeServer(b).deps, { real: true, changed: [], created: [bad], expected: [], baselineIds: [], stopFrame: STOP });
    expect(r.ok).toBe(false);
  });
});

describe('xóa object do tool tạo', () => {
  const setup = async () => {
    const b = base();
    const { plan } = planWithNew(b);
    const s = fakeServer(b);
    const r = await runUpload(s.deps, { real: true, changed: [], created: plan.created, expected: [], baselineIds: b.tracks.map((t) => t.id!), stopFrame: STOP });
    return { s, b, newId: r.createdIds![0]! };
  };
  it('ID không có trong sổ (object có sẵn trên server) bị từ chối, server không đổi', async () => {
    const { s, b, newId } = await setup();
    const existing = b.tracks[0]!.id!;
    const before = JSON.stringify(s.state);
    const r = await runDelete(s.deps, { real: true, ids: [existing], madeIds: [newId], baselineIds: [...b.tracks.map((t) => t.id!), newId] });
    expect(r.ok).toBe(false);
    expect(s.deleted).toEqual([]);
    expect(JSON.stringify(s.state)).toBe(before);
  });
  it('ID nằm trong danh sách ID gốc đã khóa bị từ chối dù có mặt trong madeIds', async () => {
    const { s, b, newId } = await setup();
    const existing = b.tracks[0]!.id!;
    const before = JSON.stringify(s.state);
    const r = await runDelete(s.deps, { real: true, ids: [existing], madeIds: [newId, existing], lockedIds: [existing], baselineIds: [...b.tracks.map((t) => t.id!), newId] });
    expect(r.ok).toBe(false);
    expect(s.deleted).toEqual([]);
    expect(JSON.stringify(s.state)).toBe(before);
  });
  it('chạy thử không xóa; xóa thật chỉ bỏ đúng object do tool tạo và các track khác giữ nguyên', async () => {
    const { s, b, newId } = await setup();
    const req = { real: false, ids: [newId], madeIds: [newId], baselineIds: [...b.tracks.map((t) => t.id!), newId] };
    expect((await runDelete(s.deps, req)).sent).toBe(false);
    expect(s.state.tracks).toHaveLength(3);
    const r = await runDelete(s.deps, { ...req, real: true });
    expect(r).toMatchObject({ ok: true, stage: 'done', deletedIds: [newId] });
    expect(s.state.tracks.map((t) => t.id)).toEqual(b.tracks.map((t) => t.id));
  });
  it('trộn ID có sẵn với ID do tool tạo: từ chối cả lô', async () => {
    const { s, b, newId } = await setup();
    const r = await runDelete(s.deps, { real: true, ids: [newId, b.tracks[1]!.id!], madeIds: [newId], baselineIds: [...b.tracks.map((t) => t.id!), newId] });
    expect(r.ok).toBe(false);
    expect(s.state.tracks).toHaveLength(3);
  });
  it('CvatClient.deleteOwn chỉ nhận ID trong sổ, và write vẫn từ chối delete', async () => {
    const seen: string[] = [];
    const c = new CvatClient({ origin: 'https://x.test', dryRun: false, fetchImpl: (async (u: string) => { seen.push(u); return new Response('{}'); }) as typeof fetch });
    await expect(c.deleteOwn(1, [{ id: 9, label_id: 1, frame: 0, shapes: [] }], new Set([5]))).rejects.toThrow();
    await expect(c.write(1, 'delete' as never, { version: 0, tags: [], shapes: [], tracks: [] })).rejects.toThrow();
    expect(seen).toEqual([]);
    await c.deleteOwn(1, [{ id: 5, label_id: 1, frame: 0, shapes: [] }], new Set([5]));
    expect(seen).toEqual(['https://x.test/api/jobs/1/annotations?action=delete']);
  });
});

describe('nháp có object mới và cờ do tool tạo', () => {
  it('lưu / khôi phục object mới; bỏ khi số track trên CVAT đã đổi', () => {
    const b = base();
    const { w } = planWithNew(b);
    const edited = new Set(['3:2', '3:3']);
    const d = buildDraft(1, b, w, edited)!;
    expect(d.added).toHaveLength(1);
    expect(checkDraft(JSON.stringify(d), 1, b).ok).toBe(true);
    const r = applyDraft(d, b);
    expect(r.work.tracks).toHaveLength(3);
    expect(r.edited.has('3:2')).toBe(true);
    const moved = ann(...b.tracks, withIds(tr(undefined, [sh(0)])));
    expect(checkDraft(JSON.stringify(d), 1, moved).ok).toBe(false);
  });
  it('bảng object đánh dấu draft / server / null', () => {
    const b = base();
    const { w } = planWithNew(b);
    const rows = buildRows(w, [], 0, STOP, undefined, undefined, new Set([b.tracks[1]!.id!]));
    expect(rows.map((r) => r.made)).toEqual([null, 'server', 'draft']);
  });
});
