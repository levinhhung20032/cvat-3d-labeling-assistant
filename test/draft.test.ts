import { describe, expect, it } from 'vitest';
import { applyDraft, buildDraft, checkDraft } from '../src/shared/draft';
import { ann, shape, track } from './fixtures';

const base = () => ann(track(11, [shape(0), shape(5)]), track(12, [shape(0)]), track(13, [shape(2)]));
const edit = (b: ReturnType<typeof base>) => {
  const t = { ...b.tracks[1]!, shapes: [...b.tracks[1]!.shapes, shape(3)] };
  return { ...b, tracks: [b.tracks[0]!, t, b.tracks[2]!] };
};

describe('bản nháp', () => {
  it("chỉ lưu track đã sửa và khôi phục đúng, giữ ID · chưa sửa gì thì không có nháp", () => {
    {
    const b = base(), w = edit(b);
    const d = buildDraft(7, b, w, new Set(['2:3']))!;
    expect(Object.keys(d.tracks)).toEqual(['1']);
    const chk = checkDraft(JSON.stringify(d), 7, b);
    expect(chk.ok).toBe(true);
    const r = applyDraft(JSON.parse(JSON.stringify(d)), b);
    expect(r.work.tracks[1]!.shapes.map((s) => s.frame)).toEqual([0, 3]);
    expect(r.work.tracks[0]).toBe(b.tracks[0]);
    expect([...r.edited]).toEqual(['2:3']);
    expect(r.work.tracks.map((t) => t.id)).toEqual([11, 12, 13]);
  }
    {
    const b = base();
    expect(buildDraft(7, b, b, new Set())).toBeNull();
  }
  });
  it("CVAT đã đổi version → không áp dụng nháp · job khác / dữ liệu hỏng / không có", () => {
    {
    const b = base(), d = buildDraft(7, b, edit(b), new Set(['2:3']))!;
    const chk = checkDraft(JSON.stringify(d), 7, { ...b, version: b.version + 1 });
    expect(chk.ok).toBe(false);
    if (!chk.ok) expect(chk.reason).toBe('server-changed');
  }
    {
    const b = base(), d = buildDraft(7, b, edit(b), new Set(['2:3']))!;
    expect(checkDraft(JSON.stringify(d), 8, b)).toMatchObject({ ok: false, reason: 'other-job' });
    expect(checkDraft('{oops', 7, b)).toMatchObject({ ok: false, reason: 'invalid' });
    expect(checkDraft(null, 7, b)).toMatchObject({ ok: false, reason: 'none' });
  }
  });
  it('track đổi ID so với baseline thì bỏ qua track đó', () => {
    const b = base(), d = buildDraft(7, b, edit(b), new Set(['2:3']))!;
    const other = { ...b, tracks: [b.tracks[0]!, { ...b.tracks[1]!, id: 99 }, b.tracks[2]!] };
    const r = applyDraft(d, other);
    expect(r.skipped).toEqual([2]);
    expect(r.edited.size).toBe(0);
    expect(r.work.tracks[1]!.shapes.length).toBe(1);
  });
});
