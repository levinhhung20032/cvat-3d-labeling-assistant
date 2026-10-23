import { describe, expect, it } from 'vitest';
import { actionFor, assign, comboOf, defaultKeymap, normalizeKeymap, prettyCombo, unassign } from '../src/shared/keymap';

const ev = (key: string, mods: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean; metaKey: boolean }> = {}) =>
  ({ key, ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...mods });

describe('keymap', () => {
  it('chuẩn hóa tổ hợp phím', () => {
    expect(comboOf(ev('z', { ctrlKey: true }))).toBe('ctrl+z');
    expect(comboOf(ev('K', { shiftKey: true }))).toBe('shift+k');
    expect(comboOf(ev('+', { shiftKey: true }))).toBe('+'); // ký hiệu: bỏ shift
    expect(comboOf(ev('ArrowLeft'))).toBe('ArrowLeft');
    expect(comboOf(ev('ArrowLeft', { shiftKey: true }))).toBe('shift+ArrowLeft');
    expect(comboOf(ev(' '))).toBe('Space');
  });
  it('phím bổ trợ đứng một mình không phải tổ hợp', () => {
    expect(comboOf(ev('Control', { ctrlKey: true }))).toBeNull();
    expect(comboOf(ev('Shift', { shiftKey: true }))).toBeNull();
  });
  it('tra action theo phím mặc định', () => {
    const m = defaultKeymap();
    expect(actionFor(m, 'k')).toBe('kf.toggle');
    expect(actionFor(m, '=')).toBe('zoom.in');
    expect(actionFor(m, 'ctrl+z')).toBe('undo');
    expect(actionFor(m, 'q')).toBeNull();
  });
  it('gán phím mới; phím đang dùng cho action khác thì chuyển sang', () => {
    const r = assign(defaultKeymap(), 'kf.toggle', 'ctrl+z');
    expect(r.stolenFrom).toBe('undo');
    expect(r.map['kf.toggle']).toContain('ctrl+z');
    expect(r.map['undo']).not.toContain('ctrl+z');
  });
  it('gán thêm phím cho cùng action không tính là lấy phím', () => {
    const r = assign(defaultKeymap(), 'kf.toggle', 'q');
    expect(r.stolenFrom).toBeNull();
    expect(r.map['kf.toggle']).toEqual(['k', 'q']);
  });
  it('bỏ phím và đọc dữ liệu lưu hỏng', () => {
    expect(unassign(defaultKeymap(), 'zoom.in', '=')['zoom.in']).toEqual(['+']);
    expect(normalizeKeymap('rác')).toEqual(defaultKeymap());
    expect(normalizeKeymap({ undo: ['ctrl+u'], zoom: 3 }).undo).toEqual(['ctrl+u']);
    expect(normalizeKeymap({ undo: [1] }).undo).toEqual(['ctrl+z']);
  });
  it('phím `: bật tắt cửa sổ, không cần Shift, mặc định đã gán', () => {
    expect(comboOf(ev('`'))).toBe('`');
    expect(comboOf(ev('~', { shiftKey: true }))).toBe('~');
    expect(actionFor(defaultKeymap(), '`')).toBe('window.toggle');
    expect(comboOf(ev('`', { ctrlKey: true }))).toBe('ctrl+`');
  });
  it('hiển thị dễ đọc', () => {
    expect(prettyCombo('ctrl+z')).toBe('Ctrl+Z');
    expect(prettyCombo('ArrowLeft')).toBe('←');
    expect(prettyCombo('+')).toBe('+');
    expect(prettyCombo('ctrl++')).toBe('Ctrl++');
  });
});
