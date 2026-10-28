/**
 * Máy chủ CVAT mà tool được chạy (chủ dự án duyệt 2026-10-28: người dùng tự thêm tên miền trong trang Cài đặt, không cần sửa code).
 * Danh sách chính là các quyền host người dùng đã cấp cho extension: host mặc định trong manifest + các tên miền đã bấm "Thêm"
 * (mỗi tên miền một hộp hỏi của trình duyệt). Chỉ https, chỉ đúng một tên miền cụ thể (không ký tự đại diện, không cổng riêng).
 */

/** Đường dẫn trang job của CVAT: /tasks/<id>/jobs/<id>. */
export const JOB_PATH = /^\/tasks\/\d+\/jobs\/\d+/;

const HOSTNAME = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/i;

/**
 * Chuỗi người dùng nhập (tên miền, hoặc dán nguyên URL bất kỳ của trang CVAT) → origin https chuẩn, ví dụ
 * "cvat-b.example.com/jobs" → "https://cvat-b.example.com". null nếu không hợp lệ (http, IP, ký tự đại diện, cổng riêng…).
 */
export function parseOrigin(input: string): string | null {
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try { u = new URL(s); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !HOSTNAME.test(u.hostname)) return null;
  return u.origin;
}

/** Mẫu quyền host của một origin. */
export const originPattern = (origin: string) => `${origin}/*`;

/** Origin của một mẫu quyền cụ thể "https://host/*"; null với mẫu có ký tự đại diện (vd "https://*\/*") hoặc không phải https. */
export function patternOrigin(pattern: string): string | null {
  const m = /^https:\/\/([^/*:]+)\/\*$/.exec(pattern);
  return m ? `https://${m[1]}` : null;
}

/** URL có khớp mẫu match pattern ("https://host/*", "https://*\/*") không — '*' khớp chuỗi bất kỳ. */
export function matchesPattern(pattern: string, url: string): boolean {
  const re = new RegExp(`^${pattern.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\/]/g, '\\$&')).join('.*')}$`);
  return re.test(url);
}

/** Trang job CVAT trên https (chưa xét tên miền đã được thêm hay chưa). */
export function jobOrigin(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' && JOB_PATH.test(u.pathname) ? u.origin : null;
  } catch { return null; }
}
