import { describe, expect, it } from 'vitest';
import { parseInt10 } from '../src/content/cvatDom';

describe('cvatDom', () => {
  it('đọc số nguyên từ chữ trong giao diện CVAT', () => {
    expect(parseInt10(' 50 ')).toBe(50);
    expect(parseInt10('7')).toBe(7);
    expect(parseInt10('')).toBeNull();
    expect(parseInt10('abc')).toBeNull();
    expect(parseInt10('1.5')).toBeNull();
    expect(parseInt10(null)).toBeNull();
  });
});
