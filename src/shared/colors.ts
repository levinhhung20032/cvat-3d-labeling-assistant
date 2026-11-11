/** Màu do người dùng chọn ở tab Màu sắc (chỉ đổi cách hiển thị, không đụng dữ liệu nhãn). */
export interface ColorSettings {
  point: string; // màu point: '#rrggbb' hoặc '' (tô theo độ cao)
  pointIn: string; // màu point nằm TRONG box: '#rrggbb' hoặc '' (tắt, giữ màu point thường)
  viewBg: string; // nền các view Trên / Bên / Trước
  groundLocal: string; // vạch mặt đường local (đo riêng)
  groundEgo: string; // vạch mặt đường ego (z = 0)
  groundPw: string; // vạch mặt đường patchwork++
  frameKey: string; // viền frame: keyframe
  frameInterp: string; // nội suy
  frameHold: string; // giữ nguyên
  frameOutside: string; // outside
  frameNone: string; // chưa có box
}

export const DEFAULT_COLORS: ColorSettings = {
  point: '', pointIn: '', viewBg: '#0b0f14',
  groundLocal: '#7cfc00', groundEgo: '#ffd400', groundPw: '#c084fc',
  frameKey: '#22c55e', frameInterp: '#38bdf8', frameHold: '#f59e0b', frameOutside: '#ef4444', frameNone: '#9ca3af',
};

export const COLOR_KEYS = Object.keys(DEFAULT_COLORS) as (keyof ColorSettings)[];

export const isHex = (v: unknown): v is string => typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v);

/** Đọc từ dữ liệu lưu / nạp: trường nào sai định dạng hoặc thiếu thì lấy mặc định; trường lạ bị bỏ. `point` và `pointIn` cho phép chuỗi rỗng. */
export function parseColors(raw: unknown): ColorSettings {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const out = { ...DEFAULT_COLORS };
  for (const k of COLOR_KEYS) {
    const v = r[k];
    if (isHex(v)) out[k] = v.toLowerCase();
    else if ((k === 'point' || k === 'pointIn') && v === '') out[k] = '';
  }
  return out;
}

export const sameColors = (a: ColorSettings, b: ColorSettings): boolean => COLOR_KEYS.every((k) => a[k] === b[k]);
