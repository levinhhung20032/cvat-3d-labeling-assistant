import { afterEach, describe, expect, it } from 'vitest';
import { serializeCuboid } from '../src/shared/cuboid';
import { newRuleId, type MetricId, type Rule } from '../src/shared/alertRules';
import { DEFAULT_MOTION, motionJump } from '../src/shared/motion';
import { SURROUND, trackIssues } from '../src/shared/qcrules';
import { surroundBottom } from '../src/shared/surround';
import { installRules, resetAll } from '../src/shared/thresholds';
import { shape, track } from './fixtures';

afterEach(() => { resetAll(); installRules([], 0); SURROUND.fn = null; });
const rule = (metric: MetricId, value: number, t: Rule['target'] = { t: 'all' }): Rule => ({ id: newRuleId(), metric, op: '>', value, target: t });
const cub = (x: number, z: number, sz = 1.6) => serializeCuboid({ x, y: 0, z, rx: 0, ry: 0, yaw: 0, sx: 4, sy: 2, sz }, Array(16).fill(0));

describe('surroundBottom (Z1)', () => {
  it('trung vị đáy các box trong bán kính; thiếu box thì null', () => {
    const o = (x: number, z: number) => ({ x, y: 0, z, sz: 2 });
    expect(surroundBottom({ x: 0, y: 0 }, [o(1, 1), o(2, 1.1), o(3, 5)], { radius: 10, minBoxes: 2 })!.bottom).toBeCloseTo(0.1);
    expect(surroundBottom({ x: 0, y: 0 }, [o(1, 1), o(50, 1)], { radius: 10, minBoxes: 2 })).toBeNull();
  });
});

describe('Z1 trong trackIssues', () => {
  const t = track(1, [0, 1].map((f) => ({ ...shape(f, false), points: cub(10, 3.0) }))); // đáy 2.2
  it('đáy lệch quá ngưỡng so với box xung quanh: báo Z1; không rule hoặc không đủ box: không báo', () => {
    SURROUND.fn = () => 0; // đáy xung quanh = 0
    expect([...trackIssues(t, 'Vehicle', [0, 1], undefined, 1).values()]).toEqual([]);
    installRules([rule('botDev', 1)], 1);
    expect([...trackIssues(t, 'Vehicle', [0, 1], undefined, 1).values()].flat().map((i) => i.kind)).toEqual(['Z1', 'Z1']);
    installRules([rule('botDev', 3)], 1);
    expect(trackIssues(t, 'Vehicle', [0, 1], undefined, 1).size).toBe(0);
    SURROUND.fn = () => null;
    installRules([rule('botDev', 1)], 1);
    expect(trackIssues(t, 'Vehicle', [0, 1], undefined, 1).size).toBe(0);
  });
});

describe('Y báo cả đổi độ cao', () => {
  const line = (zOf: (i: number) => number) => track(1, Array.from({ length: 8 }, (_, i) => ({ ...shape(i, false), points: cub(10 + i * 0.5, zOf(i)) })));
  const t = line((i) => (i < 6 ? 1 : 2.5));
  it('mặc định không báo; có rule motionDz thì báo ở frame nhảy độ cao', () => {
    expect(motionJump(t, 6, 'Vehicle')).toBeNull();
    installRules([rule('motionDz', 0.5)], 1);
    const w = motionJump(t, 6, 'Vehicle')!;
    expect(w.vertical).toBe(true);
    expect(w.horizontal).toBe(false);
    expect(w.dz).toBeCloseTo(1.5);
    expect(motionJump(t, 5, 'Vehicle')).toBeNull();
    expect(DEFAULT_MOTION.zDefault).toBe(0.5);
  });
});
