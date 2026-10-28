import { describe, expect, it } from 'vitest';
import { jobOrigin, matchesPattern, originPattern, parseOrigin, patternOrigin } from '../src/shared/hosts';

describe('tên miền CVAT người dùng tự thêm', () => {
  it('nhận tên miền trần hoặc dán nguyên URL của trang CVAT → origin https chuẩn', () => {
    expect(parseOrigin('cvat-b.example.com')).toBe('https://cvat-b.example.com');
    expect(parseOrigin('https://cvat-b.example.com/jobs')).toBe('https://cvat-b.example.com');
    expect(parseOrigin('  https://CVAT-B.example.com/tasks/1/jobs/2?x=1#y ')).toBe('https://cvat-b.example.com');
  });
  it('từ chối http, IP, ký tự đại diện, cổng riêng, kèm tài khoản, tên miền không hợp lệ, chuỗi rỗng', () => {
    for (const bad of ['http://cvat-b.example.com', '10.0.0.5', 'https://*.example.com', 'https://cvat.example.com:8443', 'https://u:p@cvat.example.com', 'localhost', 'cvat', 'javascript:alert(1)', 'file:///c:/x', '']) {
      expect(parseOrigin(bad)).toBeNull();
    }
  });
  it('mẫu quyền ↔ origin: chỉ nhận mẫu cụ thể, không nhận mẫu đại diện', () => {
    expect(originPattern('https://cvat-b.example.com')).toBe('https://cvat-b.example.com/*');
    expect(patternOrigin('https://cvat-b.example.com/*')).toBe('https://cvat-b.example.com');
    expect(patternOrigin('https://*/*')).toBeNull();
    expect(patternOrigin('http://cvat.example.com/*')).toBeNull();
  });
  it('match pattern: host cụ thể chỉ khớp đúng host đó; "https://*/*" khớp mọi trang https', () => {
    expect(matchesPattern('https://cvat-a.example.com/*', 'https://cvat-a.example.com/tasks/1/jobs/2')).toBe(true);
    expect(matchesPattern('https://cvat-a.example.com/*', 'https://cvat-b.example.com/tasks/1/jobs/2')).toBe(false);
    expect(matchesPattern('https://cvat-a.example.com/*', 'https://cvat-a.example.com.evil.com/x')).toBe(false);
    expect(matchesPattern('https://*/*', 'https://anything.example/x')).toBe(true);
  });
  it('trang job: chỉ /tasks/<id>/jobs/<id> trên https', () => {
    expect(jobOrigin('https://cvat-b.example.com/tasks/12/jobs/34')).toBe('https://cvat-b.example.com');
    expect(jobOrigin('https://cvat-b.example.com/jobs')).toBeNull();
    expect(jobOrigin('http://cvat-b.example.com/tasks/12/jobs/34')).toBeNull();
    expect(jobOrigin(undefined)).toBeNull();
  });
});
