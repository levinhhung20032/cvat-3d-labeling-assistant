/**
 * Kiểm tra bản mới trên GitHub Releases của dự án. Chỉ chạy khi người dùng bấm nút; chỉ một request GET công khai,
 * không gửi dữ liệu nhãn, cookie hay thông tin người dùng (credentials: 'omit', không referrer). Chủ dự án duyệt 2026-10-24.
 */
export const RELEASES_API = 'https://api.github.com/repos/levinhhung20032/cvat-3d-labeling-assistant/releases/latest';

/** "v1.2.3" / "1.2.3" → [1, 2, 3]; sai định dạng → null. */
export function parseVersion(v: string): number[] | null {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(v.trim());
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}

/** >0: a mới hơn b; <0: cũ hơn; 0: bằng nhau; null nếu một bên không hợp lệ. */
export function compareVersions(a: string, b: string): number | null {
  const x = parseVersion(a), y = parseVersion(b);
  if (!x || !y) return null;
  for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
  return 0;
}

export type UpdateResult =
  | { kind: 'uptodate'; current: string; latest: string }
  | { kind: 'newer'; current: string; latest: string; url: string; notes: string }
  | { kind: 'unreachable'; message: string } // repo private / chưa có release / bị giới hạn tốc độ
  | { kind: 'error'; message: string };

type Fetch = (url: string, init: RequestInit) => Promise<Pick<Response, 'ok' | 'status' | 'json'>>;

export async function checkUpdate(current: string, doFetch: Fetch = (u, i) => fetch(u, i)): Promise<UpdateResult> {
  let res;
  try {
    res = await doFetch(RELEASES_API, { method: 'GET', headers: { Accept: 'application/vnd.github+json' }, credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch (e) { return { kind: 'error', message: `Không kết nối được tới GitHub: ${String(e)}` }; }
  if (res.status === 404) return { kind: 'unreachable', message: 'Không đọc được release: repo chưa có bản phát hành nào, hoặc repo đang ở chế độ private (API công khai không truy cập được).' };
  if (res.status === 403 || res.status === 429) return { kind: 'unreachable', message: 'GitHub từ chối tạm thời (giới hạn số lần gọi). Thử lại sau.' };
  if (!res.ok) return { kind: 'error', message: `GitHub trả về mã ${res.status}.` };
  let body: { tag_name?: unknown; html_url?: unknown; body?: unknown };
  try { body = (await res.json()) as typeof body; } catch { return { kind: 'error', message: 'Phản hồi của GitHub không đọc được.' }; }
  const tag = typeof body.tag_name === 'string' ? body.tag_name : '';
  const cmp = compareVersions(tag, current);
  if (cmp === null) return { kind: 'error', message: `Tên bản "${tag}" hoặc phiên bản hiện tại "${current}" không đúng dạng x.y.z.` };
  if (cmp <= 0) return { kind: 'uptodate', current, latest: tag };
  // Chỉ nhận liên kết về chính repo này (không tin đường dẫn lạ trong phản hồi).
  const url = typeof body.html_url === 'string' && body.html_url.startsWith('https://github.com/levinhhung20032/cvat-3d-labeling-assistant/')
    ? body.html_url : 'https://github.com/levinhhung20032/cvat-3d-labeling-assistant/releases';
  return { kind: 'newer', current, latest: tag, url, notes: typeof body.body === 'string' ? body.body.slice(0, 1500) : '' };
}
