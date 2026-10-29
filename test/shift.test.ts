import { describe, expect, it } from 'vitest';
import { changedFrames, computeKpi, firstSeen, kpiText, lockedOutsideKeys, outsideFrames, shiftName, uniqueShiftName, type Shift, type ShiftTrackRec } from '../src/shared/shift';
import { shape, track } from './fixtures';
import { serializeCuboid } from '../src/shared/cuboid';

describe('tên ca', () => {
  it("sáng 21/10 → Oct21AM; chiều → PM; không đệm số 0 · trùng tên thì thêm hậu tố", () => {
    {
    expect(shiftName(new Date(2026, 9, 21, 8, 30))).toBe('Oct21AM');
    expect(shiftName(new Date(2026, 9, 21, 12, 0))).toBe('Oct21PM');
    expect(shiftName(new Date(2026, 9, 21, 23, 59))).toBe('Oct21PM');
    expect(shiftName(new Date(2026, 0, 5, 0, 5))).toBe('Jan5AM');
    expect(shiftName(new Date(2026, 11, 31, 11, 59))).toBe('Dec31AM');
  }
    {
    expect(uniqueShiftName('Oct21AM', [])).toBe('Oct21AM');
    expect(uniqueShiftName('Oct21AM', ['Oct21AM'])).toBe('Oct21AM#2');
    expect(uniqueShiftName('Oct21AM', ['Oct21AM', 'Oct21AM#2'])).toBe('Oct21AM#3');
  }
  });
});

describe('outsideFrames', () => {
  it('đếm frame outside theo cách CVAT hiển thị', () => {
    const t = track(1, [shape(0), shape(3, true), shape(6)]);
    expect(outsideFrames(t, 0, 9)).toEqual([3, 4, 5]);
  });
});

const rec = (num: number, over: Partial<ShiftTrackRec> = {}): ShiftTrackRec => ({
  num, id: 100 + num, label: 'vehicles', added: 0, removed: 0, modified: 0, baked: 0, outsideFilled: 0, outsideBefore: [], outsideAfter: [], ...over,
});
const base = (): Shift => ({ name: 'Oct21AM', start: '2026-10-21T01:00:00.000Z', end: '2026-10-21T03:30:00.000Z', uploads: [], accepted: 0, ignored: 0, edits: 0, touched: [] });

describe('KPI ca', () => {
  it('ca rỗng', () => {
    const k = computeKpi(base());
    expect(k.totals.objects).toBe(0);
    expect(k.durationMin).toBe(150);
    expect(kpiText(k)).toContain('Oct21AM');
  });
  it('object đã tác động, frame outside mới / đưa trở lại, keyframe', () => {
    const s = base();
    s.uploads.push({
      time: '2026-10-21T02:00:00.000Z', jobId: 9999,
      tracks: [
        rec(5, { added: 2, baked: 10, outsideBefore: [3, 4], outsideAfter: [3, 4, 5, 6, 7] }),
        rec(9, { modified: 3, label: 'pedestrian', outsideBefore: [8], outsideAfter: [] }),
      ],
    });
    const k = computeKpi(s);
    expect(k.totals.objects).toBe(2);
    expect(k.byLabel).toEqual({ vehicles: 1, pedestrian: 1 });
    expect(k.totals.outsideNow).toBe(5);
    expect(k.totals.outsideNew).toBe(3);
    expect(k.totals.outsideRestored).toBe(1);
    expect(k.totals.added).toBe(2);
    expect(k.totals.baked).toBe(10);
    expect(k.totals.modified).toBe(3);
  });
  it("nhiều lần upload cùng object: cộng dồn đếm, outside lấy đầu → cuối · object sửa mà chưa upload nằm ở mục chưa upload", () => {
    {
    const s = base();
    s.uploads.push(
      { time: 't1', jobId: 1, tracks: [rec(5, { added: 1, outsideBefore: [], outsideAfter: [3] })] },
      { time: 't2', jobId: 1, tracks: [rec(5, { added: 2, outsideBefore: [3], outsideAfter: [3, 4] })] },
    );
    const k = computeKpi(s);
    expect(k.objects).toHaveLength(1);
    expect(k.objects[0]).toMatchObject({ uploads: 2, added: 3, outsideNow: 2, outsideNew: 2 });
    expect(k.uploads).toBe(2);
  }
    {
    const s = base();
    s.touched = ['9999:5', '9999:7'];
    s.uploads.push({ time: 't', jobId: 9999, tracks: [rec(5)] });
    const k = computeKpi(s);
    expect(k.pending).toEqual(['9999:7']);
    expect(kpiText(k)).toContain('CHƯA upload: 7');
  }
  });
  it('ca đang chạy: thời lượng tính tới hiện tại', () => {
    const s = { ...base(), end: null };
    expect(computeKpi(s, new Date('2026-10-21T01:45:00.000Z')).durationMin).toBe(45);
  });
});

describe('changedFrames (KPI: mọi frame đã thay đổi)', () => {
  const c = (x: number) => ({ x, y: 0, z: 0, rx: 0, ry: 0, yaw: 0, sx: 4, sy: 2, sz: 1.5 });
  const mk = (frames: [number, number, boolean?][]) =>
    track(1, frames.map(([f, x, out]) => ({ ...shape(f, !!out), points: serializeCuboid(c(x), Array(16).fill(0)) })));
  it("sửa 1 keyframe làm các frame nội suy kề đổi theo, không tính frame ngoài khoảng · khoá thêm keyframe giữ nguyên giá trị thì không tính", () => {
    {
    const before = mk([[0, 0], [4, 4], [8, 8]]);
    const after = mk([[0, 0], [4, 5], [8, 8]]);
    expect(changedFrames(before, after, 0, 8)).toEqual([1, 2, 3, 4, 5, 6, 7]);
  }
    {
    const before = mk([[0, 0], [4, 4]]);
    const after = mk([[0, 0], [2, 2], [4, 4]]);
    expect(changedFrames(before, after, 0, 4)).toEqual([]);
  }
  });
  it('đặt outside và lưu outside thành keyframe riêng đều tính', () => {
    const before = mk([[0, 0], [2, 2, true]]);
    const after = mk([[0, 0], [2, 2, true], [3, 2, true]]);
    expect(changedFrames(before, after, 0, 4)).toEqual([3]);
    expect(changedFrames(mk([[0, 0], [4, 4]]), mk([[0, 0], [2, 1, true], [4, 4]]), 0, 4)).toEqual([1, 2, 3]);
  });
});

describe('KPI = Σ frame từ lúc ID xuất hiện (cả outside) + KF outside khoá − trùng', () => {
  it('firstSeen bỏ keyframe outside đầu track · lockedOutsideKeys chỉ lấy keyframe outside mới', () => {
    expect(firstSeen(track(1, [shape(0, true), shape(4), shape(9, true)]), 0, 20)).toBe(4);
    expect(firstSeen(track(1, [shape(0, true)]), 0, 20)).toBeNull();
    expect(firstSeen(track(1, [shape(0)]), 3, 20)).toBe(3);
    const before = track(1, [shape(0), shape(5, true)]);
    const after = track(1, [shape(0, true), shape(2), shape(5, true), shape(6, true), shape(7, true)]);
    expect(lockedOutsideKeys(before, after, 0, 20)).toEqual([0, 6, 7]);
  });
  it('cộng theo ID, trừ KF outside nằm trong khoảng đã tính, gộp nhiều lần upload cùng ID', () => {
    const s = base();
    s.uploads.push(
      // ID 5: xuất hiện từ frame 4, job hết ở 19 → 16 frame; khoá outside 0, 1 (trước lúc xuất hiện) và 10 (trùng)
      { time: 't1', jobId: 1, tracks: [rec(5, { firstSeen: 4, stop: 19, outsideKeys: [0, 1, 10] })] },
      // ID 5 upload lần 2: khoá lại frame 1 (trùng lần trước) và 12 (trùng khoảng)
      { time: 't2', jobId: 1, tracks: [rec(5, { firstSeen: 4, stop: 19, outsideKeys: [1, 12] }), rec(7, { firstSeen: 15, stop: 19, outsideKeys: [] })] },
    );
    const k = computeKpi(s);
    expect(k.objects.find((o) => o.num === 5)).toMatchObject({ span: 16, outsideLocked: 4, dup: 2, kpi: 18 });
    expect(k.objects.find((o) => o.num === 7)).toMatchObject({ span: 5, kpi: 5 });
    expect(k.totals.kpi).toBe(23);
    expect(kpiText(k)).toContain('KPI: 23 frame');
  });
  it('ID không còn xuất hiện: chỉ tính KF outside khoá · ca cũ (chưa ghi khoảng xuất hiện) lấy số frame đã thay đổi', () => {
    const s = base();
    s.uploads.push({ time: 't', jobId: 1, tracks: [rec(3, { firstSeen: null, stop: 19, outsideKeys: [0, 5] }), rec(4, { changedFrames: [1, 2, 3] })] });
    const k = computeKpi(s);
    expect(k.objects.map((o) => o.kpi)).toEqual([2, 3]);
  });
});
