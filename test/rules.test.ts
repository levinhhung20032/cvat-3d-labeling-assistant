import { describe, expect, it } from 'vitest';
import { checkIdsNotRemoved, missingOutsideKeyframes, validateUpload } from '../src/shared/rules';
import { ann, shape, track } from './fixtures';

describe('ID biến mất', () => {
  it('chặn khi ID baseline không còn', () => {
    const v = checkIdsNotRemoved([1, 2, 3], [1, 3]);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatchObject({ rule: 'id-removed', trackId: 2 });
  });
  it('cho qua khi ID tăng thêm', () => {
    expect(checkIdsNotRemoved([1], [1, 2])).toEqual([]);
  });
  it('validateUpload chặn merge kiểu CVAT (2 ID cũ → 1 ID mới)', () => {
    const base = ann(track(1, [shape(0)]), track(2, [shape(0)]));
    const work = ann(track(3, [shape(0)]));
    const rules = validateUpload(base, work, 5).map((v) => v.rule);
    expect(rules.filter((r) => r === 'id-removed')).toHaveLength(2);
  });
});

describe('frame outside phải có keyframe', () => {
  it('outside ở frame 3 rồi không còn shape nào → thiếu 4..stop', () => {
    const t = track(1, [shape(0), shape(3, true)]);
    expect(missingOutsideKeyframes(t, 6)).toEqual([4, 5, 6]);
  });
  it('đủ keyframe outside ở mọi frame → không thiếu', () => {
    const t = track(1, [shape(0), shape(3, true), shape(4, true), shape(5, true)]);
    expect(missingOutsideKeyframes(t, 5)).toEqual([]);
  });
  it('outside rồi xuất hiện lại: chỉ khoảng giữa phải có keyframe', () => {
    const t = track(1, [shape(0), shape(2, true), shape(5)]);
    expect(missingOutsideKeyframes(t, 9)).toEqual([3, 4]);
  });
  it('outside ở ngay frame cuối job → không thiếu', () => {
    expect(missingOutsideKeyframes(track(1, [shape(0), shape(9, true)]), 9)).toEqual([]);
  });
  it('validateUpload chặn track thiếu keyframe outside', () => {
    const a = ann(track(1, [shape(0), shape(2, true)]));
    expect(validateUpload(a, a, 5).map((v) => v.rule)).toEqual(['outside-missing-keyframe']);
  });
});
