import { describe, expect, it } from 'vitest';
import { actionFor, assign, comboOf, defaultKeymap, normalizeKeymap, prettyCombo, unassign } from '../src/shared/keymap';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('keymap', () => {
  it("chuẩn hóa tổ hợp phím · phím bổ trợ đứng một mình không phải tổ hợp", () => {
    {
    expect(comboOf(ev('z', { ctrlKey: true }))).toBe('ctrl+z');
    expect(comboOf(ev('K', { shiftKey: true }))).toBe('shift+k');
    expect(comboOf(ev('+', { shiftKey: true }))).toBe('+'); // ký hiệu: bỏ shift
    expect(comboOf(ev('ArrowLeft'))).toBe('ArrowLeft');
    expect(comboOf(ev('ArrowLeft', { shiftKey: true }))).toBe('shift+ArrowLeft');
    expect(comboOf(ev(' '))).toBe('Space');
  }
    {
    expect(comboOf(ev('Control', { ctrlKey: true }))).toBeNull();
    expect(comboOf(ev('Shift', { shiftKey: true }))).toBeNull();
  }
  });
  it("tra action theo phím mặc định · gán phím mới; phím đang dùng cho action khác thì chuyển sang", () => {
    {
    const m = defaultKeymap();
    expect(actionFor(m, 'k')).toBe('kf.toggle');
    expect(actionFor(m, '=')).toBe('zoom.in');
    expect(actionFor(m, 'ctrl+z')).toBe('undo');
    expect(actionFor(m, 'q')).toBeNull();
  }
    {
    const r = assign(defaultKeymap(), 'kf.toggle', 'ctrl+z');
    expect(r.stolenFrom).toBe('undo');
    expect(r.map['kf.toggle']).toContain('ctrl+z');
    expect(r.map['undo']).not.toContain('ctrl+z');
  }
  });
  it("gán thêm phím cho cùng action không tính là lấy phím · bỏ phím và đọc dữ liệu lưu hỏng", () => {
    {
    const r = assign(defaultKeymap(), 'kf.toggle', 'q');
    expect(r.stolenFrom).toBeNull();
    expect(r.map['kf.toggle']).toEqual(['k', 'q']);
  }
    {
    expect(unassign(defaultKeymap(), 'zoom.in', '=')['zoom.in']).toEqual(['+']);
    expect(normalizeKeymap('rác')).toEqual(defaultKeymap());
    expect(normalizeKeymap({ undo: ['ctrl+u'], zoom: 3 }).undo).toEqual(['ctrl+u']);
    expect(normalizeKeymap({ undo: [1] }).undo).toEqual(['ctrl+z']);
  }
  });
  it("phím `: bật tắt cửa sổ, không cần Shift, mặc định đã gán · hiển thị dễ đọc", () => {
    {
    expect(comboOf(ev('`'))).toBe('`');
    expect(comboOf(ev('~', { shiftKey: true }))).toBe('~');
    expect(actionFor(defaultKeymap(), '`')).toBe('window.toggle');
    expect(comboOf(ev('`', { ctrlKey: true }))).toBe('ctrl+`');
  }
    {
    expect(prettyCombo('ctrl+z')).toBe('Ctrl+Z');
    expect(prettyCombo('ArrowLeft')).toBe('←');
    expect(prettyCombo('+')).toBe('+');
    expect(prettyCombo('ctrl++')).toBe('Ctrl++');
  }
  });
});

describe('Alt+K mở khoá keyframe ở giữa', () => {
  it("có mặc định alt+k và comboOf nhận đúng · bản lưu cũ chưa có action này vẫn nhận mặc định", () => {
    {
    expect(defaultKeymap()['kf.unlockInner']).toEqual(['alt+k']);
    expect(comboOf({ key: 'k', ctrlKey: false, altKey: true, shiftKey: false, metaKey: false })).toBe('alt+k');
    expect(actionFor(defaultKeymap(), 'alt+k')).toBe('kf.unlockInner');
    expect(actionFor(defaultKeymap(), 'k')).toBe('kf.toggle'); // K đơn vẫn là khoá / mở khoá một frame
  }
    {
    expect(normalizeKeymap({ 'kf.toggle': ['k'] })['kf.unlockInner']).toEqual(['alt+k']);
  }
  });
});
