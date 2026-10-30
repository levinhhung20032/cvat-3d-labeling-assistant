import { useEffect, useState } from 'react';
import { emptyBank, parseCameraBank, type CameraBank, type CameraSetup } from '../shared/cameras';
import { kv } from './storage';

const KEY = 'cvla-camsetup';
const listeners = new Set<() => void>();

/** Cấu hình ánh xạ camera (cả bộ 6 và bộ 8), lưu cục bộ theo máy chủ. Đọc được cả dạng cũ (một bộ). */
export function loadCameraBank(): CameraBank {
  try {
    const raw = kv.get(KEY);
    if (raw) return parseCameraBank(JSON.parse(raw));
  } catch { /* hỏng: dùng mặc định */ }
  return emptyBank();
}
export function saveCameraBank(b: CameraBank): void {
  kv.set(KEY, JSON.stringify(b));
  listeners.forEach((l) => l());
}
/** Bộ đang dùng, và hàm ghi lại. Mọi nơi dùng hook này cập nhật cùng lúc (tab Camera, Batch Review, nút nạp setting). */
export function useCameraBank(): [CameraBank, (b: CameraBank) => void] {
  const [bank, setBank] = useState<CameraBank>(loadCameraBank);
  useEffect(() => {
    const l = () => setBank(loadCameraBank());
    listeners.add(l);
    return () => { listeners.delete(l); };
  }, []);
  return [bank, saveCameraBank];
}
export const activeSetup = (b: CameraBank): CameraSetup => b.sets[b.active];

/** Công tắc bật / tắt lưu cục bộ (không thuộc setting.json); mọi nơi dùng cùng khoá cập nhật cùng lúc. */
function flagHook(key: string, def: boolean): () => [boolean, (on: boolean) => void] {
  const listeners = new Set<() => void>();
  const load = () => { try { const v = kv.get(key); return v === '1' ? true : v === '0' ? false : def; } catch { return def; } };
  return () => {
    const [on, setOn] = useState(load);
    useEffect(() => {
      const l = () => setOn(load());
      listeners.add(l);
      return () => { listeners.delete(l); };
    }, []);
    const set = (v: boolean) => { try { kv.set(key, v ? '1' : '0'); } catch { /* bỏ qua */ } listeners.forEach((l) => l()); };
    return [on, set];
  };
}
/** Hiện ảnh camera trong Batch Review (tab Camera). Tắt thì không tải ảnh camera. */
export const useCameraShow = flagHook('cvla-cam-show', true);
/** Ảnh camera tách ra cửa sổ nổi nhỏ (kéo, đổi cỡ được) thay vì nằm dưới các cột frame. */
export const useCameraPop = flagHook('cvla-cam-pop', false);

/** Vị trí và cỡ cửa sổ nổi của ảnh camera (px, trong khung tool). */
export interface PopGeo { x: number; y: number; w: number; h: number }
const GEO_KEY = 'cvla-cam-pop-geo';
export function loadPopGeo(): PopGeo | null {
  try {
    const g = JSON.parse(kv.get(GEO_KEY) ?? 'null') as Partial<PopGeo> | null;
    if (g && [g.x, g.y, g.w, g.h].every((v) => typeof v === 'number' && Number.isFinite(v))) return g as PopGeo;
  } catch { /* hỏng: dùng mặc định */ }
  return null;
}
export const savePopGeo = (g: PopGeo) => { try { kv.set(GEO_KEY, JSON.stringify(g)); } catch { /* bỏ qua */ } };
