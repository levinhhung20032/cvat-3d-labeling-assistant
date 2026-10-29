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
