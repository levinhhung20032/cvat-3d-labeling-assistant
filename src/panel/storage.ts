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
const PER_HOST = [/^cvla-(draft|made|dyn|bak|dynclass|dynattr|pass|throbj|seen|gsrc):/, /^cvla-(qc|ignore|qcimp|qcmarks|passidx|resume|camsetup)$/];
const isPerHost = (key: string) => PER_HOST.some((r) => r.test(key));
let scope = ''; // '' = máy chủ mặc định
let mem: Map<string, string> | null = null;
const readyCbs: (() => void)[] = [];

/**
 * Máy chủ sở hữu dữ liệu lưu theo khóa CŨ (`ui:<khóa>`, trước khi dữ liệu được tách theo máy chủ). Chỉ là nhãn để dữ liệu sẵn có không bị
 * mất; KHÔNG phải quyền host (manifest không còn host mặc định 2026-10-29, mọi máy chủ đều do người dùng tự thêm ở trang Cài đặt).
 */
// Chỉ có trên máy đã dùng bản cũ: đặt trong src/panel/legacyOrigin.local.ts (không đưa lên git) `export const LEGACY_DATA_ORIGIN = '<origin>';`.
// Không có file thì null: cài mới chưa từng có khóa cũ, mọi dữ liệu theo job đi theo máy chủ người dùng thêm.
const legacyMods = import.meta.glob('./legacyOrigin.local.ts', { eager: true }) as Record<string, { LEGACY_DATA_ORIGIN?: string }>;
export const LEGACY_DATA_ORIGIN: string | null = Object.values(legacyMods)[0]?.LEGACY_DATA_ORIGIN ?? null;
/** Origin dùng khóa cũ: host đầu tiên trong host_permissions của manifest nếu có, không thì máy chủ sở hữu dữ liệu cũ. */
export function defaultOrigin(): string | null {
  try { return patternOrigin(api.runtime.getManifest().host_permissions?.[0] ?? '') ?? LEGACY_DATA_ORIGIN; } catch { return LEGACY_DATA_ORIGIN; }
}
/** Phạm vi kho của máy chủ đang mở ('' = máy chủ dữ liệu cũ): phân biệt job / ID trùng số giữa hai máy chủ trong KPI. */
export const hostScope = () => scope;
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
  watchStorage();
}

// ---------- tình trạng lưu (KPI / nháp mất khi cập nhật tool, 2026-10-30) ----------
/**
 * Lỗi ghi vào kho trước đây bị bỏ qua lặng lẽ, nên dữ liệu (ca / KPI, nháp…) chỉ còn trong bộ nhớ và mất khi tải lại:
 * - `orphan`: extension vừa Reload / cập nhật trong khi cửa sổ tool cũ còn mở trên trang (chế độ nhúng): phiên cũ không còn ghi được gì;
 * - `quota`: kho của extension đầy (đã tự xoá kết quả tính lưu sẵn, vẫn không đủ chỗ);
 * - `error`: lỗi ghi khác.
 */
export type StorageHealth = { ok: true } | { ok: false; reason: 'orphan' | 'quota' | 'error'; detail: string };
let health: StorageHealth = { ok: true };
const healthCbs = new Set<() => void>();
export const storageHealth = (): StorageHealth => health;
export const onStorageHealth = (cb: () => void) => { healthCbs.add(cb); return () => { healthCbs.delete(cb); }; };
const setHealth = (h: StorageHealth) => {
  if (h.ok === health.ok && (h.ok || (!health.ok && h.reason === health.reason))) return;
  if (!health.ok && health.reason === 'orphan') return; // phiên mồ côi không bao giờ hồi lại
  health = h;
  healthCbs.forEach((cb) => cb());
};
/** Còn kết nối với extension không (Reload / cập nhật extension làm phiên cũ mất `runtime.id`). */
const alive = () => { try { return !!api.runtime?.id; } catch { return false; } };
const orphaned = () => setHealth({ ok: false, reason: 'orphan', detail: 'extension vừa được Reload / cập nhật' });

/** Kết quả tính lưu sẵn (tính lại được): xoá đầu tiên khi kho đầy. */
const isCache = (key: string) => key.startsWith('cvla-pass:') || key === 'cvla-passidx';
function persist(op: () => Promise<unknown> | void, retried = false): void {
  if (!alive()) { orphaned(); return; }
  const fail = (e: unknown) => {
    const msg = String((e as Error)?.message ?? e);
    if (!alive() || /context invalidated/i.test(msg)) { orphaned(); return; }
    if (/quota/i.test(msg)) {
      if (!retried && mem) {
        const drop = [...mem.keys()].filter(isCache);
        if (drop.length) {
          for (const k of drop) mem.delete(k);
          try { void api.storage.local.remove(drop.map((k) => storageKey(k)))?.catch?.(() => undefined); } catch { /* bỏ qua */ }
          persist(op, true);
          return;
        }
      }
      setHealth({ ok: false, reason: 'quota', detail: msg });
      return;
    }
    setHealth({ ok: false, reason: 'error', detail: msg });
  };
  try {
    const p = op();
    if (p && typeof (p as Promise<unknown>).then === 'function') (p as Promise<unknown>).then(() => { if (!health.ok && health.reason !== 'orphan') setHealth({ ok: true }); }, fail);
  } catch (e) { fail(e); }
}

/** Đổi ở phiên khác (tab CVAT khác) của các khóa đang theo dõi: cập nhật bộ nhớ đệm rồi báo cho store. */
const externalCbs = new Map<string, Set<() => void>>();
export function onExternalChange(key: string, cb: () => void): () => void {
  let set = externalCbs.get(key);
  if (!set) externalCbs.set(key, (set = new Set()));
  set.add(cb);
  return () => { set!.delete(cb); };
}
let watching = false;
function watchStorage() {
  if (watching) return;
  watching = true;
  try {
    api.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local' || !mem) return;
      for (const key of externalCbs.keys()) {
        const ch = changes[storageKey(key)];
        if (!ch) continue;
        const v = ch.newValue === undefined ? null : String(ch.newValue);
        if (v === (mem.get(key) ?? null)) continue; // chính phiên này vừa ghi
        if (v === null) mem.delete(key); else mem.set(key, v);
        externalCbs.get(key)!.forEach((cb) => cb());
      }
    });
  } catch { /* không theo dõi được: mỗi phiên vẫn gộp khi ghi */ }
  if (typeof window !== 'undefined') {
    const t = window.setInterval(() => { if (!alive()) { orphaned(); window.clearInterval(t); } }, 3000);
  }
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
      persist(() => api.storage.local.set({ [storageKey(key)]: value }));
    } else {
      try { testStore()?.setItem(key, value); } catch { /* bỏ qua */ }
    }
  },
  remove(key: string): void {
    if (mem) {
      mem.delete(key);
      persist(() => api.storage.local.remove(storageKey(key)));
    } else {
      try { testStore()?.removeItem(key); } catch { /* bỏ qua */ }
    }
  },
};
