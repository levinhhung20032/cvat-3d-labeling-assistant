import { PALETTE_LIGHT } from './palette.gen';

/**
 * Giao diện tối / xám không dùng bộ lọc CSS nữa: mọi màu giao diện là biến --cvla-c-<mã> (mã = màu sáng gốc),
 * giá trị tối / xám được tính ở đây bằng đúng phép biến đổi của bộ lọc cũ (đảo màu, hue-rotate 180°, rồi sáng / tương phản),
 * nên diện mạo giữ nguyên nhưng canvas / ảnh không còn bị đảo qua đảo lại. Muốn chỉnh riêng một màu tối: thêm vào DARK_OVERRIDE.
 */
export type Rgba = { r: number; g: number; b: number; a: number };

export function parseColor(s: string): Rgba | null {
  const t = s.trim().toLowerCase();
  let m = /^#([0-9a-f]{3,8})$/.exec(t);
  if (m) {
    let h = m[1]!;
    if (h.length === 3 || h.length === 4) h = [...h].map((x) => x + x).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    const n = (i: number) => parseInt(h.slice(i, i + 2), 16);
    return { r: n(0), g: n(2), b: n(4), a: h.length === 8 ? n(6) / 255 : 1 };
  }
  m = /^rgba?\(([^)]*)\)$/.exec(t);
  if (m) {
    const p = m[1]!.split(',').map((x) => parseFloat(x));
    if (p.length < 3 || p.length > 4 || p.some((x) => !Number.isFinite(x))) return null;
    return { r: p[0]!, g: p[1]!, b: p[2]!, a: p[3] ?? 1 };
  }
  return null;
}

const clamp = (x: number) => Math.min(255, Math.max(0, x));
type Step = (c: [number, number, number]) => [number, number, number];
const invert: Step = ([r, g, b]) => [255 - r, 255 - g, 255 - b];
// hue-rotate(180deg): cos = -1, sin = 0 trong ma trận chuẩn của CSS.
const hue180: Step = ([r, g, b]) => [
  clamp(-0.574 * r + 1.43 * g + 0.144 * b),
  clamp(0.426 * r + 0.43 * g + 0.144 * b),
  clamp(0.426 * r + 1.43 * g - 0.856 * b),
];
const brightness = (k: number): Step => ([r, g, b]) => [clamp(r * k), clamp(g * k), clamp(b * k)];
const contrast = (k: number): Step => ([r, g, b]) => [clamp((r - 127.5) * k + 127.5), clamp((g - 127.5) * k + 127.5), clamp((b - 127.5) * k + 127.5)];

export type Skin = 'dark' | 'gray';
const CHAIN: Record<Skin, Step[]> = {
  dark: [invert, hue180, brightness(0.92)],
  gray: [invert, hue180, contrast(0.6), brightness(1.5)],
};

/** Màu tối / xám dùng riêng, thay cho kết quả tự tính (rỗng = tự tính hết). */
export const DARK_OVERRIDE: Readonly<Record<string, string>> = {};

export function skinColor(light: string, skin: Skin): string {
  const o = DARK_OVERRIDE[light];
  if (o) return o;
  const c = parseColor(light);
  if (!c) return light;
  // Bóng đổ / lớp phủ đen giữ đen (bộ lọc cũ làm chúng thành trắng, không ai mong muốn).
  if (c.r === 0 && c.g === 0 && c.b === 0 && c.a < 1) return light;
  let v: [number, number, number] = [c.r, c.g, c.b];
  for (const s of CHAIN[skin]) v = s(v);
  const [r, g, b] = v.map((x) => Math.round(x)) as [number, number, number];
  if (c.a >= 1) return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `rgba(${r},${g},${b},${+c.a.toFixed(3)})`;
}

/** CSS khai báo biến màu cho từng giao diện (dán vào STYLE). */
export function themeCss(): string {
  const decl = (skin: Skin) => PALETTE_LIGHT.map(([k, v]) => `${k}:${skinColor(v, skin)};`).join('');
  return `
.cvla-root.cvla-dark, .cvla-skin.cvla-dark { color-scheme: dark; ${decl('dark')} }
.cvla-root.cvla-gray, .cvla-skin.cvla-gray { color-scheme: dark; ${decl('gray')} }
/* ô nhập: nền / chữ lấy từ biến để theo giao diện (trình duyệt tự đặt trắng / đen thì không đảo được nữa) */
.cvla-root input:not([type=checkbox]):not([type=radio]):not([type=color]):not([type=range]), .cvla-root select, .cvla-root textarea { background-color: var(--cvla-c-ffffff, #fff); color: var(--cvla-c-111111, #111); }
.cvla-root button { color: var(--cvla-c-111111, #111); }
`;
}
