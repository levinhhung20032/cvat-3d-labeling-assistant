import { useSyncExternalStore } from 'react';
import type { CvatTrack } from '../shared/types';

/**
 * ID hiển thị của CVAT (clientID) không đổi khi tạo / xóa object nên dần lệch khỏi thứ tự trong mảng tracks.
 * Bảng này lưu cặp [ID server của track → ID hiển thị trong CVAT] đọc từ chính giao diện CVAT; chưa đọc được thì coi như trùng thứ tự.
 */
let map = new Map<number, number>();
let version = 0;
const subs = new Set<() => void>();

export function setCvatIds(pairs: [number, number][]): void {
  map = new Map(pairs);
  version++;
  subs.forEach((f) => f());
}
export const hasCvatIds = () => map.size > 0;
export const useCvatIdVersion = () => useSyncExternalStore((f) => { subs.add(f); return () => { subs.delete(f); }; }, () => version);

/** ID hiển thị trong CVAT của object thứ `num` (đếm từ 1) của tracks. */
export function clientIdOf(tracks: readonly CvatTrack[], num: number): number {
  const t = tracks[num - 1];
  return (t?.id !== undefined ? map.get(t.id) : undefined) ?? num;
}
/** Ngược lại: ID hiển thị trong CVAT → số thứ tự object (null nếu không có object nào mang ID đó). */
export function numOfClientId(tracks: readonly CvatTrack[], clientId: number): number | null {
  if (!map.size) return clientId >= 1 && clientId <= tracks.length ? clientId : null;
  const i = tracks.findIndex((t) => t.id !== undefined && map.get(t.id) === clientId);
  return i >= 0 ? i + 1 : null;
}
