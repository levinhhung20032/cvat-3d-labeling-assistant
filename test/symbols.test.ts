import { describe, expect, it } from 'vitest';
import { parseSymbols, symbolOf, validSymbol, SYMBOL_DEFAULTS } from '../src/shared/symbols';

describe('ký hiệu lỗi', () => {
  it('mặc định: đi xa bất thường = Y, các mã khác giữ nguyên', () => {
    expect(symbolOf({}, 'M')).toBe('Y');
    expect(symbolOf({}, 'S')).toBe('S');
    expect(symbolOf({}, 'khac')).toBe('khac');
  });
  it('hợp lệ: 1–3 ký tự không khoảng trắng, không trùng loại khác (đổi lại chính mình được)', () => {
    expect(validSymbol({}, 'K', 'K1')).toBe(true);
    expect(validSymbol({}, 'K', '')).toBe(false);
    expect(validSymbol({}, 'K', 'abcd')).toBe(false);
    expect(validSymbol({}, 'K', 'a b')).toBe(false);
    expect(validSymbol({}, 'K', 'Y')).toBe(false); // đang là ký hiệu của M
    expect(validSymbol({ M: 'W' }, 'K', 'Y')).toBe(true);
    expect(validSymbol({}, 'M', 'Y')).toBe(true);
  });
  it('outside liên tục mặc định là T, không để trống', () => {
    expect(symbolOf({}, 'X')).toBe('T');
    expect(validSymbol({}, 'X', '')).toBe(false);
  });
  it('trôi box mặc định là Dr, không để trống', () => {
    expect(symbolOf({}, 'T')).toBe('Dr');
    expect(validSymbol({}, 'T', '')).toBe(false);
  });
  it('đọc dữ liệu lưu: bỏ khoá lạ, giá trị sai và trùng', () => {
    expect(parseSymbols({ M: 'W', K: 'W', Q: 'x', S: 5, Z: 'Z' })).toEqual({ K: 'W' }); // trùng: giữ cái đọc trước
    expect(parseSymbols('x')).toEqual({});
    expect(SYMBOL_DEFAULTS.M).toBe('Y');
  });
});

describe('ký hiệu lỗi NULL (đáy lơ lửng / chìm)', () => {
  it('mặc định rỗng, điền được 1–3 ký tự, để trống là NULL', () => {
    for (const k of ['G'] as const) {
      expect(symbolOf({}, k)).toBe('');
      expect(validSymbol({}, k, '')).toBe(true);
      expect(validSymbol({}, k, 'T1')).toBe(true);
      expect(validSymbol({ [k]: 'Q' }, k, '')).toBe(true);
    }
    expect(validSymbol({}, 'K', '')).toBe(false); // mã có sẵn không được để trống
    expect(validSymbol({}, 'G', 'K')).toBe(false); // trùng mã khác
    expect(symbolOf({ G: 'LL' }, 'G')).toBe('LL');
  });
  it('outside liên tục mặc định là T, không để trống', () => {
    expect(symbolOf({}, 'X')).toBe('T');
    expect(validSymbol({}, 'X', '')).toBe(false);
  });
  it('trôi box mặc định là Dr, không để trống', () => {
    expect(symbolOf({}, 'T')).toBe('Dr');
    expect(validSymbol({}, 'T', '')).toBe(false);
  });
  it('đọc dữ liệu lưu: nhận mã mới, bỏ giá trị rỗng', () => {
    expect(parseSymbols({ T: 'TB', G: '', X: 'X1' })).toEqual({ T: 'TB', X: 'X1' });
  });
});
