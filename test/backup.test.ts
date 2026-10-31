import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildRows } from '../src/shared/table';
import { planUpload } from '../src/shared/plan';
import type { CvatAnnotations } from '../src/shared/types';

// Chỉ chạy khi có bản backup cục bộ (backups/ không vào git).
const file = 'backups/backup_sample.json';

describe.skipIf(!existsSync(file))('trên backup job thật', () => {
  const ann = () => JSON.parse(readFileSync(file, 'utf8')) as CvatAnnotations;
  it('bảng object khớp số liệu khảo sát (75 track, 733 frame outside thiếu keyframe)', () => {
    const rows = buildRows(ann(), [], 0, 59);
    expect(rows).toHaveLength(75);
    expect(rows.reduce((n, r) => n + r.missing, 0)).toBe(733);
    expect(rows.filter((r) => r.missing > 0)).toHaveLength(39);
  });
  it('khứ hồi rỗng bị chặn đúng vì thiếu keyframe outside (luật 2)', () => {
    expect(() => planUpload(ann(), ann(), 59)).toThrow(/outside/);
  });
});
