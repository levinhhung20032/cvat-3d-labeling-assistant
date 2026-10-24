import { api } from '../shared/api';

/**
 * Lưu tùy chọn giao diện (phím tắt, ca làm việc, danh sách bỏ qua…).
 * - Chế độ iframe: localStorage của trang extension.
 * - Chế độ nhúng trong trang CVAT: KHÔNG được dùng localStorage (đó là kho của trang CVAT, trang đọc được) →
 *   bộ nhớ đệm đồng bộ, nạp sẵn từ `storage.local` của extension và ghi xuống đó (khóa có tiền tố `ui:`).
 */
const PREFIX = 'ui:';
let mem: Map<string, string> | null = null;

/** Gọi một lần trước khi vẽ panel ở chế độ nhúng. */
export async function useExtensionStorage(): Promise<void> {
  const all = (await api.storage.local.get(null)) as Record<string, unknown>;
  mem = new Map(
    Object.entries(all)
      .filter(([k]) => k.startsWith(PREFIX))
      .map(([k, v]) => [k.slice(PREFIX.length), String(v)]),
  );
}

export const kv = {
  get(key: string): string | null {
    if (mem) return mem.get(key) ?? null;
    return localStorage.getItem(key);
  },
  set(key: string, value: string): void {
    if (mem) {
      mem.set(key, value);
      void api.storage.local.set({ [PREFIX + key]: value });
    } else localStorage.setItem(key, value);
  },
};
