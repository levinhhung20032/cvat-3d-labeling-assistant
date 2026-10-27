import { describe, expect, it } from 'vitest';
import { resolveDyn, attrRuleKey, ruleValues, type DynRule } from '../src/shared/dynrule';
import type { LabelSpec } from '../src/shared/attributes';
import { shape, track } from './fixtures';

const spec: LabelSpec = {
  id: 1, name: 'Two-wheels',
  attrs: [
    { id: 10, name: 'rider state', input: 'checkbox', mutable: true, def: 'false', values: [] },
    { id: 11, name: 'note', input: 'text', mutable: false, def: '', values: [] },
  ],
};
const withRider = (vals: [number, string][]) => {
  const t = track(1, vals.map(([f]) => shape(f, false)));
  t.shapes.forEach((s, i) => { s.attributes = [{ spec_id: 10, value: vals[i]![1] }]; });
  return t;
};
const rules = (o: Record<string, DynRule>) => o;

describe('dynamic size theo attribute', () => {
  it("chỉ checkbox / select / radio mới đặt luật được · không có luật thì theo class", () => {
    expect(ruleValues(spec.attrs[0]!)).toEqual(['true', 'false']);
    expect(ruleValues(spec.attrs[1]!)).toEqual([]);
    expect(resolveDyn(withRider([[0, 'false']]), spec, true, {})).toEqual({ dyn: true, by: 'class' });
    expect(resolveDyn(withRider([[0, 'false']]), spec, false, {})).toEqual({ dyn: false, by: 'class' });
  });
  it("rider state = false → static, = true → dynamic; có cả hai giá trị thì dynamic thắng", () => {
    const r = rules({ [attrRuleKey('Two-wheels', 'rider state', 'false')]: 'static', [attrRuleKey('Two-wheels', 'rider state', 'true')]: 'dyn' });
    expect(resolveDyn(withRider([[0, 'false'], [5, 'false']]), spec, true, r)).toMatchObject({ dyn: false, by: 'attr', value: 'false' });
    expect(resolveDyn(withRider([[0, 'true']]), spec, false, r)).toMatchObject({ dyn: true, by: 'attr', value: 'true' });
    expect(resolveDyn(withRider([[0, 'false'], [5, 'true']]), spec, false, r)).toMatchObject({ dyn: true, by: 'attr' });
  });
});
