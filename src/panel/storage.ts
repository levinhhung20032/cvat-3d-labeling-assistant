import { api } from '../shared/api';
import { patternOrigin } from '../shared/hosts';

/**
 * Lưu tùy chọn giao diện, ca làm việc, danh sách bỏ qua, bản nháp chưa upload…
 * Mọi chế độ đều dùng `storage.local` của extension (nạp sẵn vào bộ nhớ đệm đồng bộ lúc khởi động, ghi xuống ngay khi đổi):
 * - bền qua F5 và qua Reload extension; không phụ thuộc localStorage của iframe (trình duyệt có thể chặn / phân vùng
 *   localStorage của iframe bên thứ ba, khiến ca làm việc bị mất mỗi lần tải lại);
 * - ở chế độ nhúng trong trang CVAT KHÔNG BAO GIỜ dùng localStorage (đó là kho của trang CVAT, trang đọc được).
 * Khóa có tiền tố `ui:`. Dữ liệu cũ trong localStorage (nếu còn đọc được) được chép sang một lần.
 *
 * Nhiều máy chủ CVAT (2026-10-28): dữ liệu gắn với JOB (bản nháp, sổ object do tool tạo, ghi chú QC, danh sách bỏ qua…) được tách
 * theo máy chủ — số job / ID database của hai máy chủ có thể trùng nhau, và sổ object do tool tạo là căn cứ DUY NHẤT để được xóa.
 * Máy chủ mặc định (host trong manifest) giữ nguyên khóa cũ `ui:<khóa>` để không mất dữ liệu sẵn có; máy chủ khác dùng
 * `ui@<origin>|<khóa>`. Tùy chọn cá nhân (giao diện, phím tắt, ca làm việc / KPI…) dùng chung mọi máy chủ.
 */
const PREFIX = 'ui:';
const PER_HOST = [/^cvla-(draft|made|dyn|bak|dynclass|dynattr|pass):/, /^cvla-(qc|ignore|qcimp|qcmarks|passidx|resume)$/];
const isPerHost = (key: string) => PER_HOST.some((r) => r.test(key));
let scope = ''; // '' = máy chủ mặc định
let mem: Map<string, string> | null = null;
const readyCbs: (() => void)[] = [];

/** Origin của máy chủ mặc định: host đầu tiên trong host_permissions của manifest. */
export function defaultOrigin(): string | null {
  try { return patternOrigin(api.runtime.getManifest().host_permissions?.[0] ?? ''); } catch { return null; }
}
/** Khóa thật trong storage.local của một khóa logic, theo máy chủ đang dùng. */
export const storageKey = (key: string, hostScope = scope) => (hostScope && isPerHost(key) ? `ui@${hostScope}|${key}` : PREFIX + key);

/** Các store đọc dữ liệu ngay lúc module được nạp: đăng ký hàm nạp lại, chạy khi kho đã sẵn sàng (ngay lập tức nếu đã sẵn sàng). */
export function whenStorageReady(cb: () => void): void {
  if (mem) cb(); else readyCbs.push(cb);
}

/** Gọi một lần trước khi vẽ panel (cả chế độ iframe và chế độ nhúng). `cvatOrigin`: máy chủ CVAT của tab đang mở tool. */
export async function useExtensionStorage(cvatOrigin?: string): Promise<void> {
  scope = cvatOrigin && cvatOrigin !== defaultOrigin() ? cvatOrigin : '';
  const all = (await api.storage.local.get(null)) as Record<string, unknown>;
  const next = new Map<string, string>();
  const own = `ui@${scope}|`;
  for (const [k, v] of Object.entries(all)) {
    if (scope && k.startsWith(own)) next.set(k.slice(own.length), String(v));
    else if (k.startsWith(PREFIX)) {
      const key = k.slice(PREFIX.length);
      if (!scope || !isPerHost(key)) next.set(key, String(v)); // dữ liệu theo job của máy chủ mặc định không lọt sang máy chủ khác
    }
  }
  mem = next;
  // Chuyển dữ liệu cũ từ localStorage của trang extension (chỉ chế độ iframe; có thể không truy cập được).
  try {
    if (typeof localStorage !== 'undefined' && location.protocol.endsWith('-extension:')) {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k && k.startsWith('cvla-') && !mem.has(k)) {
          const v = localStorage.getItem(k);
          if (v !== null) { mem.set(k, v); void api.storage.local.set({ [storageKey(k)]: v }); }
        }
      }
    }
  } catch { /* localStorage bị chặn: bỏ qua */ }
  readyCbs.splice(0).forEach((cb) => cb());
}

/** Chỉ khi chạy thử ngoài trình duyệt (kiểm thử): chưa khởi tạo thì dùng localStorage. Trong trang https (CVAT) thì không bao giờ. */
const testStore = () => (typeof location === 'undefined' || location.protocol !== 'https:') && typeof localStorage !== 'undefined' ? localStorage : null;

export const kv = {
  get(key: string): string | null {
    if (mem) return mem.get(key) ?? null;
    try { return testStore()?.getItem(key) ?? null; } catch { return null; }
  },
  set(key: string, value: string): void {
    if (mem) {
      mem.set(key, value);
      void api.storage.local.set({ [storageKey(key)]: value });
    } else {
      try { testStore()?.setItem(key, value); } catch { /* bỏ qua */ }
    }
  },
  remove(key: string): void {
    if (mem) {
      mem.delete(key);
      void api.storage.local.remove(storageKey(key));
    } else {
      try { testStore()?.removeItem(key); } catch { /* bỏ qua */ }
    }
  },
};
