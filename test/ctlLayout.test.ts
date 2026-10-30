import { describe, expect, it } from 'vitest';
import { DEFAULT_LAYOUT, GROUP_IDS, moveGroup, parseLayout, resizeSplit, setRowHeight } from '../src/panel/ctlLayout';

const flat = (l: ReturnType<typeof parseLayout>) => l.flatMap((r) => r.ids).sort();

describe('bố cục nhóm điều khiển', () => {
  it('parseLayout: hỏng thì về mặc định, mỗi nhóm đúng một lần, nhóm thiếu thêm ở hàng cuối', () => {
    expect(parseLayout(null)).toBe(DEFAULT_LAYOUT);
    const l = parseLayout([{ ids: ['3', '3', 'x', '4'], w: [2, 9, 9, -1], h: 5 }, { ids: [] }, 'rác']);
    expect(l[0]).toEqual({ ids: ['3', '4'], w: [2, 0.1], h: 40 });
    expect(l[1]!.ids).toEqual(['5', '1', '6', '2']);
    expect(flat(l)).toEqual([...GROUP_IDS].sort());
  });

  it('moveGroup: trái / phải chèn cùng hàng, trên / dưới thành hàng mới, hàng rỗng bị bỏ', () => {
    const a = moveGroup(DEFAULT_LAYOUT, '2', '3', 'l');
    expect(a[0]!.ids).toEqual(['2', '3', '4']);
    expect(a[2]!.ids).toEqual(['6']);
    const b = moveGroup(a, '6', '5', 'b');
    expect(b.map((r) => r.ids)).toEqual([['2', '3', '4'], ['5', '1'], ['6']]);
    const c = moveGroup(b, '6', '1', 't');
    expect(c.map((r) => r.ids)).toEqual([['2', '3', '4'], ['6'], ['5', '1']]);
    expect(moveGroup(c, '1', '1', 'l')).toBe(c);
    expect(flat(c)).toEqual([...GROUP_IDS].sort());
  });

  it('resizeSplit: chỉ đổi hai nhóm kề nhau, tổng giữ nguyên, có bề rộng tối thiểu', () => {
    const l = [{ ids: ['a', 'b', 'c'], w: [1, 1, 2], h: null }];
    const r = resizeSplit(l, 0, 0, 0.125);
    expect(r[0]!.w).toEqual([1.5, 0.5, 2]);
    const s = resizeSplit(l, 0, 0, 5);
    expect(s[0]!.w[1]).toBeCloseTo(0.32);
    expect(s[0]!.w[0]! + s[0]!.w[1]!).toBeCloseTo(2);
  });

  it('setRowHeight: kẹp trong giới hạn, null = theo nội dung', () => {
    expect(setRowHeight(DEFAULT_LAYOUT, 1, 10)[1]!.h).toBe(40);
    expect(setRowHeight(DEFAULT_LAYOUT, 1, null)[1]!.h).toBeNull();
  });
});
