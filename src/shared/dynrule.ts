import { getAttr, type LabelSpec } from './attributes';
import { sortedShapes } from './interp';
import type { CvatTrack } from './types';

/** Luật theo giá trị attribute: 'dyn' = dynamic size, 'static' = một size cho cả object. */
export type DynRule = 'dyn' | 'static';
export const attrRuleKey = (label: string, attr: string, value: string) => `${label}|${attr}=${value}`;

export interface DynSource { dyn: boolean; by: 'class' | 'attr'; attr?: string; value?: string }

/** Các giá trị rời rạc có thể đặt luật cho một attribute (select / radio / checkbox). Text, số: không đặt luật. */
export function ruleValues(a: { input: string; values: string[] }): string[] {
  if (a.input === 'checkbox') return ['true', 'false'];
  if (a.input === 'select' || a.input === 'radio') return a.values;
  return [];
}

/**
 * Dynamic size của MỘT object theo class và theo attribute của chính object đó (chưa tính công tắc riêng từng object).
 * Xét mọi giá trị attribute mà object có ở các keyframe: có giá trị nào được đặt 'dyn' thì dynamic (an toàn hơn vì cho phép size đổi),
 * không thì có giá trị đặt 'static' thì static, còn lại theo class.
 */
export function resolveDyn(track: CvatTrack, spec: LabelSpec | undefined, classOn: boolean, rules: Record<string, DynRule>): DynSource {
  if (spec && Object.keys(rules).length) {
    const frames = [...new Set(sortedShapes(track).filter((s) => !s.outside).map((s) => s.frame))];
    let hit: DynSource | null = null;
    for (const a of spec.attrs) {
      if (!ruleValues(a).length) continue;
      const vals = new Set<string>();
      for (const f of frames) vals.add(getAttr(track, f, a) ?? a.def);
      if (!frames.length) vals.add(getAttr(track, 0, a) ?? a.def);
      for (const v of vals) {
        const r = rules[attrRuleKey(spec.name, a.name, v)];
        if (r === 'dyn') return { dyn: true, by: 'attr', attr: a.name, value: v };
        if (r === 'static' && !hit) hit = { dyn: false, by: 'attr', attr: a.name, value: v };
      }
    }
    if (hit) return hit;
  }
  return { dyn: classOn, by: 'class' };
}
