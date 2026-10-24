import { api } from '../shared/api';

/**
 * Lưu tùy chọn giao diện, ca làm việc, danh sách bỏ qua, bản nháp chưa upload…
 * Mọi chế độ đều dùng `storage.local` của extension (nạp sẵn vào bộ nhớ đệm đồng bộ lúc khởi động, ghi xuống ngay khi đổi):
 * - bền qua F5 và qua Reload extension; không phụ thuộc localStorage của iframe (trình duyệt có thể chặn / phân vùng
 *   localStorage của iframe bên thứ ba, khiến ca làm việc bị mất mỗi lần tải lại);
 * - ở chế độ nhúng trong trang CVAT cũng không dùng localStorage (đó là kho của trang CVAT, trang đọc được).
 * Khóa có tiền tố `ui:`. Dữ liệu cũ trong localStorage (nếu còn đọc được) được chép sang một lần.
 */
const PREFIX = 'ui:';
let mem: Map<string, string> | null = null;

/** Gọi một lần trước khi vẽ panel (cả chế độ iframe và chế độ nhúng). */
export async function useExtensionStorage(): Promise<void> {
  const all = (await api.storage.local.get(null)) as Record<string, unknown>;
  mem = new Map(
    Object.entries(all)
      .filter(([k]) => k.startsWith(PREFIX))
      .map(([k, v]) => [k.slice(PREFIX.length), String(v)]),
  );
  // Chuyển dữ liệu cũ từ localStorage của trang extension (chỉ chế độ iframe; có thể không truy cập được).
  try {
    if (typeof localStorage !== 'undefined' && location.protocol.endsWith('-extension:')) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('cvla-') && !mem.has(k)) {
          const v = localStorage.getItem(k);
          if (v !== null) { mem.set(k, v); void api.storage.local.set({ [PREFIX + k]: v }); }
        }
      }
    }
  } catch { /* localStorage bị chặn: bỏ qua */ }
}

export const kv = {
  get(key: string): string | null {
    if (mem) return mem.get(key) ?? null;
    try { return localStorage.getItem(key); } catch { return null; } // chỉ khi chưa khởi tạo (kiểm thử)
  },
  set(key: string, value: string): void {
    if (mem) {
      mem.set(key, value);
      void api.storage.local.set({ [PREFIX + key]: value });
    } else {
      try { localStorage.setItem(key, value); } catch { /* bỏ qua */ }
    }
  },
  remove(key: string): void {
    if (mem) {
      mem.delete(key);
      void api.storage.local.remove(PREFIX + key);
    } else {
      try { localStorage.removeItem(key); } catch { /* bỏ qua */ }
    }
  },
};
