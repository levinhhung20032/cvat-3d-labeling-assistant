import { describe, expect, it } from 'vitest';
import { stateAt } from '../src/shared/interp';
import { bakeKeyframes, removeInnerKeyframes, removeKeyframe, toggleKeyframe } from '../src/shared/keyframes';
import { shape, track } from './fixtures';
import type { CvatShape } from '../src/shared/types';

const at = (frame: number, x: number, outside = false): CvatShape => {
  const s = shape(frame, outside);
  s.points[0] = x; s.points[6] = 4; s.points[7] = 2; s.points[8] = 1.5;
  return s;
};

describe('gỡ / bật keyframe', () => {
  const t = track(1, [at(0, 0), at(2, 3), at(4, 8), at(6, 12), at(8, 0, true)]);
  it("gỡ keyframe giữa: frame về nội suy · không gỡ keyframe đầu tiên, keyframe outside, hoặc frame không phải keyframe", () => {
    {
    const r = removeKeyframe(t, 4)!;
    expect(r.track.shapes.map((s) => s.frame)).toEqual([0, 2, 6, 8]);
    expect(stateAt(r.track, 4).status).toBe('interp');
    expect(r.track.id).toBe(1);
  }
    {
    expect(removeKeyframe(t, 0)).toBeNull();
    expect(removeKeyframe(t, 8)).toBeNull();
    expect(removeKeyframe(t, 3)).toBeNull();
  }
  });
  it("toggle: frame nội suy → thành keyframe với giá trị đang hiển thị · toggle: keyframe → gỡ; frame outside → null", () => {
    {
    const r = toggleKeyframe(t, 5)!;
    expect(stateAt(r.track, 5).status).toBe('key');
    expect(stateAt(r.track, 5).cuboid!.x).toBeCloseTo(stateAt(t, 5).cuboid!.x);
  }
    {
    expect(toggleKeyframe(t, 2)!.track.shapes).toHaveLength(4);
    expect(toggleKeyframe(t, 9)).toBeNull();
  }
  });
});

describe('mở khoá KF ở giữa', () => {
  const t = track(1, [at(0, 0), at(2, 3), at(4, 8), at(6, 12), at(7, 0, true), at(9, 5)]);
  it("gỡ mọi KF nằm hẳn bên trong, giữ hai đầu mút · không gỡ keyframe outside nằm trong khoảng", () => {
    {
    const r = removeInnerKeyframes(t, 0, 6);
    expect(r.frames).toEqual([2, 4]);
    expect(r.track.shapes.map((s) => s.frame)).toEqual([0, 6, 7, 9]);
  }
    {
    const r = removeInnerKeyframes(t, 6, 9);
    expect(r.frames).toEqual([]);
    expect(r.track.shapes.map((s) => s.frame)).toContain(7);
  }
  });
  it("khoảng không có KF giữa: không đổi · đảo thứ tự đầu/cuối vẫn đúng", () => {
    {
    const r = removeInnerKeyframes(t, 0, 2);
    expect(r.frames).toEqual([]);
    expect(r.track).toBe(t);
  }
    {
    expect(removeInnerKeyframes(t, 6, 0).frames).toEqual([2, 4]);
  }
  });
});

describe('khoá tất cả thành KF', () => {
  const t = track(1, [at(0, 0), at(4, 8), at(6, 0, true)]);
  it("mọi frame có box trong khoảng thành keyframe, giá trị không đổi · không chạm frame outside", () => {
    {
    const r = bakeKeyframes(t, 0, 5);
    expect(r.frames).toEqual([1, 2, 3, 5]);
    for (let f = 0; f <= 5; f++) {
      const a = stateAt(t, f), b = stateAt(r.track, f);
      expect(b.status).toBe('key');
      expect(b.cuboid!.x).toBeCloseTo(a.cuboid!.x, 9);
    }
    expect(stateAt(r.track, 6).status).toBe('outside-key');
  }
    {
    expect(bakeKeyframes(t, 6, 10).frames).toEqual([]);
  }
  });
  it('shape mới không có id, track giữ nguyên id', () => {
    t.shapes.forEach((sh, i) => { sh.id = 100 + i; });
    const r = bakeKeyframes(t, 0, 5);
    expect(r.track.id).toBe(1);
    expect(r.track.shapes.filter((s) => s.id === undefined).length).toBe(4);
    expect(r.track.shapes.filter((s) => s.id !== undefined).length).toBe(3);
  });
});

import { restoreFrom, setOutsideFrom, setOutsideRange } from '../src/shared/keyframes';
import { missingOutsideKeyframes } from '../src/shared/rules';
import { normalizeTrack } from '../src/shared/upload';

describe('outside', () => {
  const STOP = 9;
  const t = () => track(1, [at(0, 0), at(4, 8), at(8, 16)]);

  it("O: outside từ frame f tới keyframe kế tiếp, giữ ID track · khi upload, mỗi frame outside được điền keyframe riêng (luật 2)", () => {
    {
    const r = setOutsideFrom(t(), 2)!;
    expect(r.frames).toEqual([2]);
    expect(r.track.id).toBe(1);
    expect(stateAt(r.track, 2).status).toBe('outside-key');
    expect(stateAt(r.track, 3).status).toBe('outside');
    expect(stateAt(r.track, 4).status).toBe('key');
  }
    {
    const r = setOutsideFrom(t(), 2)!;
    expect(missingOutsideKeyframes(r.track, STOP)).toEqual([3]);
    expect(missingOutsideKeyframes(normalizeTrack(r.track, STOP).track, STOP)).toEqual([]);
  }
  });
  it("keyframe đầu tiên đặt outside được (track bắt đầu bằng outside, giữ ID); frame không có box → null · O lần nữa trên frame outside: đưa trở lại bằng box gần nhất", () => {
    {
    const r = setOutsideFrom(t(), 0)!;
    expect(r.track.id).toBe(1);
    expect(stateAt(r.track, 0).status).toBe('outside-key');
    expect(stateAt(r.track, 2).status).toBe('outside');
    expect(missingOutsideKeyframes(normalizeTrack(r.track, STOP).track, STOP)).toEqual([]);
    const back = restoreFrom(r.track, 0, STOP)!;
    expect(stateAt(back.track, 0).status).toBe('key');
    expect(setOutsideFrom(setOutsideFrom(t(), 2)!.track, 3)).toBeNull();
  }
    {
    const out = setOutsideFrom(t(), 2)!.track;
    const back = restoreFrom(out, 2, STOP)!;
    expect(stateAt(back.track, 2).status).toBe('key');
    expect(stateAt(back.track, 2).cuboid).not.toBeNull();
  }
  });
  it("trở lại ở giữa đoạn outside: box từ f, tới keyframe kế · frame có box không thể \"trở lại\"", () => {
    {
    const out = setOutsideFrom(t(), 1)!.track; // outside 1..3
    const back = restoreFrom(out, 3, STOP)!;
    expect(stateAt(back.track, 3).cuboid).not.toBeNull();
    expect(stateAt(back.track, 2).status).toBe('outside');
  }
    {
    expect(restoreFrom(t(), 2, STOP)).toBeNull();
  }
  });
  it("outside cả khoảng: mỗi frame một keyframe outside, frame sau khoảng giữ nguyên · outside cả khoảng gồm cả frame 0", () => {
    {
    const base = t();
    const r = setOutsideRange(base, 1, 2, STOP)!;
    expect(r.frames).toEqual([1, 2, 3]);
    expect(stateAt(r.track, 1).status).toBe('outside-key');
    expect(stateAt(r.track, 2).status).toBe('outside-key');
    expect(stateAt(r.track, 3).status).toBe('key');
    expect(missingOutsideKeyframes(r.track, STOP)).toEqual([]);
  }
    {
    const r = setOutsideRange(t(), 0, 1, STOP)!;
    expect(stateAt(r.track, 0).status).toBe('outside-key');
    expect(stateAt(r.track, 1).status).toBe('outside-key');
    expect(missingOutsideKeyframes(normalizeTrack(r.track, STOP).track, STOP)).toEqual([]);
  }
  });
});
