import { describe, expect, it } from 'vitest';
import { DEFAULT_COLORS, parseColors, sameColors } from '../src/shared/colors';

describe('cài đặt màu', () => {
  it('thiếu hoặc rỗng thì dùng mặc định', () => {
    expect(parseColors(null)).toEqual(DEFAULT_COLORS);
    expect(parseColors({})).toEqual(DEFAULT_COLORS);
    expect(parseColors('x')).toEqual(DEFAULT_COLORS);
  });
  it('giữ màu hợp lệ (đổi sang chữ thường), bỏ màu sai định dạng và trường lạ', () => {
    const c = parseColors({ viewBg: '#112233', groundEgo: '#ABCDEF', groundPw: 'red', frameKey: '#fff', hack: '#000000' });
    expect(c.viewBg).toBe('#112233');
    expect(c.groundEgo).toBe('#abcdef');
    expect(c.groundPw).toBe(DEFAULT_COLORS.groundPw);
    expect(c.frameKey).toBe(DEFAULT_COLORS.frameKey);
    expect('hack' in c).toBe(false);
  });
  it('màu point: "" là tô theo độ cao, màu hợp lệ được giữ', () => {
    expect(parseColors({ point: '' }).point).toBe('');
    expect(parseColors({ point: '#ffffff' }).point).toBe('#ffffff');
    expect(parseColors({ point: 'nonsense' }).point).toBe('');
  });
  it('sameColors so sánh từng trường', () => {
    expect(sameColors(DEFAULT_COLORS, { ...DEFAULT_COLORS })).toBe(true);
    expect(sameColors(DEFAULT_COLORS, { ...DEFAULT_COLORS, viewBg: '#000000' })).toBe(false);
  });
});
