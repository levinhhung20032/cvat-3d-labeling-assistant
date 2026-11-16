import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PALETTE_LIGHT } from '../src/panel/palette.gen';
import { parseColor, skinColor, themeCss } from '../src/panel/theme';

describe('theme', () => {
  it('parseColor đọc hex 3 / 6 chữ số và rgba', () => {
    expect(parseColor('#fff')).toEqual({ r: 255, g: 255, b: 255, a: 1 });
    expect(parseColor('#1f2937')).toEqual({ r: 31, g: 41, b: 55, a: 1 });
    expect(parseColor('rgba(0,0,0,.45)')).toEqual({ r: 0, g: 0, b: 0, a: 0.45 });
    expect(parseColor('đỏ')).toBeNull();
  });
  it('tối: trắng thành đen, #111 thành xám sáng như bộ lọc cũ', () => {
    expect(skinColor('#fff', 'dark')).toBe('#000000');
    expect(skinColor('#111', 'dark')).toBe('#dbdbdb');
  });
  it('xám sáng hơn tối ở nền trắng', () => {
    expect(skinColor('#fff', 'gray')).not.toBe('#000000');
  });
  it('bóng đổ đen giữ nguyên', () => {
    expect(skinColor('rgba(0,0,0,.45)', 'dark')).toBe('rgba(0,0,0,.45)');
  });
  it('mọi biến màu dùng trong panel đều có trong bảng màu (chạy node scripts/gen-palette.mjs nếu lỗi)', () => {
    const have = new Set(PALETTE_LIGHT.map(([k]) => k));
    const used = new Set<string>();
    for (const f of readdirSync('src/panel')) {
      if (!/\.(ts|tsx)$/.test(f) || f === 'palette.gen.ts') continue;
      for (const m of readFileSync(`src/panel/${f}`, 'utf8').matchAll(/var\((--cvla-c-[a-z0-9-]+),/g)) used.add(m[1]!);
    }
    expect([...used].filter((k) => !have.has(k))).toEqual([]);
  });
  it('mọi màu trong bảng đều đọc được và CSS có đủ biến cho tối / xám', () => {
    for (const [, v] of PALETTE_LIGHT) expect(parseColor(v), v).not.toBeNull();
    const css = themeCss();
    expect(css).toContain('.cvla-root.cvla-dark');
    expect(css.split('--cvla-c-ffffff:').length).toBe(3);
  });
});
