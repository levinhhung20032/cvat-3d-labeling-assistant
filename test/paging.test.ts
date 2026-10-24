import { describe, expect, it } from 'vitest';
import { pageCount, pageFrames, pageOf, windowCount, windowFrames } from '../src/shared/table';
import { conflictOf, defaultKeymap, duplicateCombos } from '../src/shared/keymap';
import { pointVisible, type Scene } from '../src/panel/render';

const all = Array.from({ length: 60 }, (_, i) => i);

describe('phân trang frame', () => {
  it('mặc định (6 frame, chung 1) trùng với cửa sổ cũ', () => {
    expect(pageCount(60, 6, 1)).toBe(windowCount(0, 59));
    for (const k of [0, 1, 11]) expect(pageFrames(all, k, 6, 1)).toEqual(windowFrames(k, 0, 59));
  });
  it('số frame tùy chọn, trang cuối bị cắt', () => {
    expect(pageFrames(all, 0, 4, 1)).toEqual([0, 1, 2, 3]);
    expect(pageFrames(all, 1, 4, 1)).toEqual([3, 4, 5, 6]);
    expect(pageFrames(all, pageCount(60, 4, 1) - 1, 4, 1).at(-1)).toBe(59);
  });
  it('chế độ chỉ keyframe: không chung frame', () => {
    const keys = [0, 7, 9, 20, 33, 40, 41];
    expect(pageCount(keys.length, 3, 0)).toBe(3);
    expect(pageFrames(keys, 1, 3, 0)).toEqual([20, 33, 40]);
    expect(pageFrames(keys, 2, 3, 0)).toEqual([41]);
  });
  it('pageOf giữ đúng frame khi đổi cách chia', () => {
    expect(pageOf(all, 11, 6, 1)).toBe(2);
    expect(pageOf([0, 7, 9, 20], 8, 2, 0)).toBe(0);
    expect(pageOf([0, 7, 9, 20], 20, 2, 0)).toBe(1);
  });
});

describe('xung đột phím', () => {
  it('phát hiện phím đã dùng bởi thao tác khác và phím có sẵn của trình duyệt', () => {
    const m = defaultKeymap();
    expect(conflictOf(m, 'kf.toggle', 'o').action).toBe('outside.from');
    expect(conflictOf(m, 'kf.toggle', 'k').action).toBeNull();
    expect(conflictOf(m, 'kf.toggle', 'ctrl+w').reserved).not.toBeNull();
    expect(conflictOf(m, 'kf.toggle', 'j')).toEqual({ action: null, reserved: null });
  });
  it('liệt kê phím trùng', () => {
    expect(duplicateCombos(defaultKeymap())).toEqual([]);
    expect(duplicateCombos({ a: ['x'], b: ['x'], c: ['y'] })).toEqual([['x', ['a', 'b']]]);
  });
});

describe('lát cắt view Bên / Trước', () => {
  const scene: Scene = { zClip: 8, colorHalf: 8, slab: 1.5, slabFront: 3 };
  it('bỏ điểm ở xa hai bên (tường) và dùng ngưỡng riêng cho view Trước', () => {
    expect(pointVisible('side', 0, 1.4, 0, 8, scene)).toBe(true);
    expect(pointVisible('side', 0, 4, 0, 8, scene)).toBe(false);
    expect(pointVisible('front', 2.5, 0, 0, 8, scene)).toBe(true);
    expect(pointVisible('front', 3.5, 0, 0, 8, scene)).toBe(false);
  });
});
