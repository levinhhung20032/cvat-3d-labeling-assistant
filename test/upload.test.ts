import { describe, expect, it } from 'vitest';
import { runRevert, runUpload, type LogEntry, type UploadDeps, type UploadReq } from '../src/content/uploader';
import { buildUploadPlan, covers, normalizeTrack, sameTrack } from '../src/shared/upload';
import { missingOutsideKeyframes } from '../src/shared/rules';
import type { CvatAnnotations, CvatShape, CvatTrack } from '../src/shared/types';

let sid = 1000;
const sh = (frame: number, outside = false, x = 0): CvatShape => ({
  id: ++sid, type: 'cuboid', frame, outside, occluded: false, z_order: 0, rotation: 0,
  points: [x, 0, 0, 0, 0, 0, 4, 2, 1.5, 0, 0, 0, 0, 0, 0, 0], attributes: [],
});
const tr = (id: number, shapes: CvatShape[]): CvatTrack => ({
  id, label_id: 1, frame: shapes[0]!.frame, group: 0, source: 'manual', attributes: [], elements: [], shapes,
});
const ann = (...tracks: CvatTrack[]): CvatAnnotations => ({ version: 0, tags: [], shapes: [], tracks });
const STOP = 9;

/** CVAT giả: GET trả trạng thái, PATCH update thay track theo id và cấp id cho shape mới. */
function fakeServer(initial: CvatAnnotations) {
  let state = structuredClone(initial);
  const calls: { n: number }[] = [];
  let log: LogEntry[] = [];
  const deps: UploadDeps = {
    jobId: 1,
    read: async () => structuredClone(state),
    write: async (p) => {
      calls.push({ n: p.tracks.length });
      for (const t of p.tracks) {
        const copy = structuredClone(t);
        for (const s of copy.shapes) if (s.id === undefined) s.id = ++sid;
        const i = state.tracks.findIndex((x) => x.id === t.id);
        if (i < 0) throw new Error('track không tồn tại');
        state.tracks[i] = copy;
      }
    },
    loadLog: async () => structuredClone(log),
    saveLog: async (l) => { log = structuredClone(l); },
  };
  return { deps, calls, get state() { return state; }, set state(v) { state = v; }, get log() { return log; } };
}

const reqFor = (base: CvatAnnotations, working: CvatAnnotations, real: boolean): UploadReq => {
  const plan = buildUploadPlan(base, working, STOP);
  expect(plan.blockers).toEqual([]);
  return { real, changed: plan.changed, expected: plan.expected, baselineIds: base.tracks.map((t) => t.id!), stopFrame: STOP };
};

describe('chuẩn hóa & kế hoạch', () => {
  it('điền keyframe outside thiếu và giữ nguyên rx/ry (box nghiêng theo mặt đường)', () => {
    const t = tr(1, [sh(0), sh(3, true)]);
    t.shapes[0]!.points[3] = 0.02;
    const n = normalizeTrack(t, STOP);
    expect(missingOutsideKeyframes(n.track, STOP)).toEqual([]);
    expect(n.outsideFilled).toBe(6); // 4..9
    expect(n.track.shapes[0]!.points[3]).toBe(0.02);
    expect(n.track.shapes.filter((s) => s.id === undefined).length).toBe(6);
  });
  it('không sửa gì → không có gì để gửi (track đã đủ keyframe)', () => {
    const base = ann(tr(1, [sh(0), sh(3, true), sh(4, true), sh(5, true), sh(6, true), sh(7, true), sh(8, true), sh(9, true)]));
    const plan = buildUploadPlan(base, structuredClone(base), STOP);
    expect(plan.changed).toEqual([]);
    expect(plan.blockers).toEqual([]);
  });
  it('track không sửa nhưng thiếu keyframe outside: không gửi, chỉ đếm; includeOthers thì gửi', () => {
    const base = ann(tr(1, [sh(0), sh(3, true)]), tr(2, [sh(0), sh(1, false, 5)]));
    const w = structuredClone(base);
    w.tracks[1]!.shapes[1]!.points[0] = 6;
    const plan = buildUploadPlan(base, w, STOP);
    expect(plan.changed.map((t) => t.id)).toEqual([2]);
    expect(plan.others).toEqual({ tracks: 1, frames: 6 });
    expect(buildUploadPlan(base, w, STOP, true).changed.map((t) => t.id)).toEqual([1, 2]);
  });
  it('đếm thêm / gỡ / sửa keyframe', () => {
    const base = ann(tr(1, [sh(0), sh(5), sh(9)]));
    const w = structuredClone(base);
    w.tracks[0]!.shapes = [w.tracks[0]!.shapes[0]!, { ...w.tracks[0]!.shapes[2]!, points: [1, 0, 0, 0, 0, 0, 4, 2, 1.5, 0, 0, 0, 0, 0, 0, 0] }, { ...sh(3), id: undefined }];
    const d = buildUploadPlan(base, w, STOP).diffs[0]!;
    expect(d).toMatchObject({ added: 1, removed: 1, modified: 1 });
  });
  it('chặn khi ID biến mất', () => {
    const base = ann(tr(1, [sh(0)]), tr(2, [sh(0)]));
    const plan = buildUploadPlan(base, ann(structuredClone(base.tracks[0]!)), STOP);
    expect(plan.blockers.map((b) => b.rule)).toContain('id-removed');
  });
});

describe('runUpload', () => {
  const base = () => ann(
    tr(1, [sh(0), sh(5)]), tr(2, [sh(0), sh(3, true), sh(4, true), sh(5, true), sh(6, true), sh(7, true), sh(8, true), sh(9, true)]), tr(3, [sh(0)]),
  );
  const edit = (b: CvatAnnotations) => { const w = structuredClone(b); w.tracks[0]!.shapes[1]!.points[0] = 2.5; return w; };

  it('chạy thử không gửi gì', async () => {
    const b = base(); const s = fakeServer(b);
    const r = await runUpload(s.deps, reqFor(b, edit(b), false));
    expect(r).toMatchObject({ ok: true, stage: 'dry-run', sent: false, batches: 1 });
    expect(s.calls).toHaveLength(0);
    expect(sameTrack(s.state.tracks[0]!, b.tracks[0]!)).toBe(true);
  });
  it('ghi thật: chỉ track đã sửa đổi, đọc lại khớp, có nhật ký', async () => {
    const b = base(); const s = fakeServer(b);
    const r = await runUpload(s.deps, reqFor(b, edit(b), true));
    expect(r).toMatchObject({ ok: true, stage: 'done', sent: true });
    expect(s.calls).toEqual([{ n: 1 }]);
    expect(s.state.tracks[0]!.shapes[1]!.points[0]).toBe(2.5);
    expect(sameTrack(s.state.tracks[1]!, b.tracks[1]!)).toBe(true);
    expect(sameTrack(s.state.tracks[2]!, b.tracks[2]!)).toBe(true);
    expect(s.state.tracks.map((t) => t.id)).toEqual([1, 2, 3]);
    expect(s.log).toHaveLength(1);
    expect(s.log[0]!.verified).toBe(true);
    expect(s.log[0]!.pre[0]!.shapes[1]!.points[0]).toBe(0);
  });
  it('xung đột: server đã bị sửa từ lúc đọc → dừng, không ghi', async () => {
    const b = base(); const s = fakeServer(b);
    const req = reqFor(b, edit(b), true);
    s.state.tracks[0]!.shapes[0]!.points[1] = 9; // ai đó sửa xen vào
    const r = await runUpload(s.deps, req);
    expect(r).toMatchObject({ ok: false, stage: 'conflict', conflicts: [1] });
    expect(s.calls).toHaveLength(0);
    expect(s.log).toHaveLength(0);
  });
  it('ID đã mất trên server: dừng', async () => {
    const b = base(); const s = fakeServer(b);
    const req = reqFor(b, edit(b), true);
    s.state.tracks = s.state.tracks.filter((t) => t.id !== 3);
    const r = await runUpload(s.deps, req);
    expect(r).toMatchObject({ ok: false, stage: 'conflict', conflicts: [3] });
    expect(s.calls).toHaveLength(0);
  });
  it('chặn khi còn thiếu keyframe outside hoặc rx/ry vượt ±30° trong dữ liệu gửi', async () => {
    const b = base(); const s = fakeServer(b);
    const req = reqFor(b, edit(b), true);
    req.changed[0]!.shapes.push({ ...sh(6, true) }); // outside ở 6, thiếu 7..9
    expect((await runUpload(s.deps, req)).stage).toBe('rules');
    const req2 = reqFor(b, edit(b), true);
    req2.changed[0]!.shapes[0]!.points[4] = 0.7; // > 30°
    expect((await runUpload(s.deps, req2)).stage).toBe('rules');

    expect(s.calls).toHaveLength(0);
  });
  it('box nghiêng nhẹ (trong ±30°) được phép gửi', async () => {
    const b = base(); const s = fakeServer(b);
    const req = reqFor(b, edit(b), true);
    req.changed[0]!.shapes[0]!.points[4] = 0.1;
    expect((await runUpload(s.deps, req)).stage).not.toBe('rules');
  });
  it('chia lô 10 track', async () => {
    const b = ann(...Array.from({ length: 25 }, (_, i) => tr(i + 1, [sh(0), sh(5)])));
    const w = structuredClone(b);
    w.tracks.forEach((t) => { t.shapes[1]!.points[0] = 1; });
    const s = fakeServer(b);
    const r = await runUpload(s.deps, reqFor(b, w, true));
    expect(r.ok).toBe(true);
    expect(s.calls.map((c) => c.n)).toEqual([10, 10, 5]);
  });
  it('không bao giờ có hành động ngoài update (deps.write chỉ nhận payload update)', async () => {
    const b = base(); const s = fakeServer(b);
    await runUpload(s.deps, reqFor(b, edit(b), true));
    expect(Object.keys(s.deps)).not.toContain('delete');
  });
  it('đọc lại không khớp: báo lỗi verify', async () => {
    const b = base(); const s = fakeServer(b);
    const orig = s.deps.write;
    s.deps.write = async (p) => { await orig(p); s.state.tracks[0]!.shapes[1]!.points[0] = 99; }; // server ghi sai
    const r = await runUpload(s.deps, reqFor(b, edit(b), true));
    expect(r).toMatchObject({ ok: false, stage: 'verify' });
  });
});

describe('runRevert', () => {
  const b = () => ann(tr(1, [sh(0), sh(5)]), tr(2, [sh(0)]));
  const w = (a: CvatAnnotations) => { const x = structuredClone(a); x.tracks[0]!.shapes[1]!.points[0] = 3; return x; };

  it('hoàn nguyên về đúng trạng thái trước, rồi không hoàn nguyên lần hai', async () => {
    const base = b(); const s = fakeServer(base);
    await runUpload(s.deps, reqFor(base, w(base), true));
    const dry = await runRevert(s.deps, false);
    expect(dry).toMatchObject({ ok: true, stage: 'dry-run' });
    const r = await runRevert(s.deps, true);
    expect(r).toMatchObject({ ok: true, stage: 'done' });
    expect(s.state.tracks[0]!.shapes[1]!.points[0]).toBe(0);
    expect(covers(s.state.tracks[0]!, base.tracks[0]!)).toBe(true);
    expect((await runRevert(s.deps, true)).ok).toBe(false);
  });
  it('server đã đổi tiếp sau lần upload: không tự hoàn nguyên', async () => {
    const base = b(); const s = fakeServer(base);
    await runUpload(s.deps, reqFor(base, w(base), true));
    s.state.tracks[0]!.shapes[0]!.points[1] = 7;
    const r = await runRevert(s.deps, true);
    expect(r).toMatchObject({ ok: false, stage: 'conflict' });
  });
});

describe('khoá hết thành keyframe khi upload (bake)', () => {
  const base = () => ann(tr(1, [sh(0, false, 0), sh(5, false, 10)]), tr(2, [sh(0), sh(9)]));
  const edit = (b: CvatAnnotations) => { const w = structuredClone(b); w.tracks[0]!.shapes[1]!.points[0] = 12; return w; };

  it('bật bake: mọi frame có box của object đã sửa thành keyframe, track khác không bị động', () => {
    const b = base();
    const plan = buildUploadPlan(b, edit(b), STOP, false, true);
    expect(plan.changed.map((t) => t.id)).toEqual([1]);
    expect(plan.changed[0]!.shapes.map((s) => s.frame)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(plan.diffs[0]).toMatchObject({ baked: 8, added: 0, modified: 1 });
  });
  it('bake giữ nguyên đường đi: giá trị từng frame như trước khi khoá', async () => {
    const { stateAt } = await import('../src/shared/interp');
    const b = base();
    const w = edit(b);
    const plan = buildUploadPlan(b, w, STOP, false, true);
    for (let f = 0; f <= STOP; f++) {
      const a = stateAt(w.tracks[0]!, f).cuboid!, c = stateAt(plan.changed[0]!, f).cuboid!;
      expect(c.x).toBeCloseTo(a.x, 9);
      expect(stateAt(plan.changed[0]!, f).status).toBe('key');
    }
  });
  it('tắt bake (mặc định): không thêm keyframe', () => {
    const b = base();
    const plan = buildUploadPlan(b, edit(b), STOP);
    expect(plan.changed[0]!.shapes).toHaveLength(2);
    expect(plan.diffs[0]!.baked).toBe(0);
  });
  it('bake + outside: frame outside có keyframe riêng, không bake vào frame outside', () => {
    const b = ann(tr(1, [sh(0), sh(3, false, 3), sh(6, true)]));
    const w = structuredClone(b);
    w.tracks[0]!.shapes[1]!.points[0] = 9;
    const plan = buildUploadPlan(b, w, STOP, false, true);
    const t = plan.changed[0]!;
    expect(t.shapes.filter((s) => s.outside).map((s) => s.frame)).toEqual([6, 7, 8, 9]);
    expect(t.shapes.filter((s) => !s.outside).map((s) => s.frame)).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.diffs[0]!.outsideFilled).toBe(3);
  });
  it('upload qua server giả vẫn đọc lại khớp', async () => {
    const b = base(); const s = fakeServer(b);
    const plan = buildUploadPlan(b, edit(b), STOP, false, true);
    const r = await runUpload(s.deps, { real: true, changed: plan.changed, expected: plan.expected, baselineIds: [1, 2], stopFrame: STOP });
    expect(r).toMatchObject({ ok: true, stage: 'done' });
    expect(s.state.tracks[0]!.shapes).toHaveLength(10);
  });
});
