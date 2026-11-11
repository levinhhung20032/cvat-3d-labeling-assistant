import { useSyncExternalStore } from 'react';
import { kv, whenStorageReady } from './storage';

/** Cài đặt view 3D (cửa sổ phụ): bán kính không gian quanh box, bán kính vùng quanh ego (0 = tắt) và cỡ điểm. Chỉ là tuỳ chọn hiển thị, lưu cục bộ. */
export interface View3dSettings { radius: number; pointSize: number; egoRadius: number }
export const VIEW3D_LIMITS = { radius: { min: 3, max: 60, def: 15 }, pointSize: { min: 1, max: 6, def: 2 }, egoRadius: { min: 0, max: 20, def: 3 } } as const;
const KEY = 'cvla-view3d';
const clamp = (v: unknown, lim: { min: number; max: number; def: number }) => (typeof v === 'number' && Number.isFinite(v) ? Math.min(lim.max, Math.max(lim.min, v)) : lim.def);
const read = (): View3dSettings => {
  try {
    const r = JSON.parse(kv.get(KEY) ?? '{}') as Partial<View3dSettings>;
    return { radius: clamp(r.radius, VIEW3D_LIMITS.radius), pointSize: clamp(r.pointSize, VIEW3D_LIMITS.pointSize), egoRadius: clamp(r.egoRadius, VIEW3D_LIMITS.egoRadius) };
  } catch { return { radius: VIEW3D_LIMITS.radius.def, pointSize: VIEW3D_LIMITS.pointSize.def, egoRadius: VIEW3D_LIMITS.egoRadius.def }; }
};
let cur = read();
const ls = new Set<() => void>();
const set = (v: View3dSettings) => { cur = v; ls.forEach((l) => l()); };
whenStorageReady(() => set(read()));

export const view3dStore = {
  get: () => cur,
  save(p: Partial<View3dSettings>) {
    const next = { radius: clamp(p.radius ?? cur.radius, VIEW3D_LIMITS.radius), pointSize: clamp(p.pointSize ?? cur.pointSize, VIEW3D_LIMITS.pointSize), egoRadius: clamp(p.egoRadius ?? cur.egoRadius, VIEW3D_LIMITS.egoRadius) };
    try { kv.set(KEY, JSON.stringify(next)); } catch { /* bỏ qua */ }
    set(next);
  },
};
export const useView3d = (): View3dSettings => useSyncExternalStore((cb) => { ls.add(cb); return () => { ls.delete(cb); }; }, () => cur);
