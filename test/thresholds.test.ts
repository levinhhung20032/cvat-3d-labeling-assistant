import { afterEach, describe, expect, it } from 'vitest';
import { serializeCuboid } from '../src/shared/cuboid';
import { DEFAULT_DRIFT } from '../src/shared/drift';
import { DEFAULT_FIT } from '../src/shared/fit';
import { DEFAULT_GROUND } from '../src/shared/ground';
import { DEFAULT_MOTION } from '../src/shared/motion';
import { allowedIou, DEFAULT_OVERLAP } from '../src/shared/overlap';
import { ATTRS_OF, SIZE_SYNC, trackIssues } from '../src/shared/qcrules';
import { findLongOutsideGaps, splitConfig } from '../src/shared/splitId';
import { cmp, effectiveRules, METRICS, METRIC_BY_ID, newRuleId, parseRules, validRule, BIG, type MetricId, type Op, type Rule, type Target } from '../src/shared/alertRules';
import { applyPersisted, backgroundConfigKey, FIELDS, installRules, resetAll, setValue, toPersisted } from '../src/shared/thresholds';
import { dynDefaultFor, dynForJob, mergeDynSettings, parseSettings } from '../src/shared/settings';
import { shape, track } from './fixtures';
import type { CvatTrack } from '../src/shared/types';

afterEach(() => { resetAll(); installRules([], 0); SIZE_SYNC.fn = null; ATTRS_OF.fn = null; });

const rule = (metric: MetricId, op: Op, value: number | null, target: Target = { t: 'all' }): Rule => ({ id: newRuleId(), metric, op, value, target });
const cub = (sx: number, sy: number, sz: number, z = 0.8, x = 10, yaw = 0) => serializeCuboid({ x, y: 0, z, rx: 0, ry: 0, yaw, sx, sy, sz }, Array(16).fill(0));
const boxTrack = (sx: number, sy: number, sz: number, z = 0.8): CvatTrack =>
  track(1, [0, 1, 2].map((f) => ({ ...shape(f, false), points: cub(sx, sy, sz, z) })));
const kinds = (t: CvatTrack, label: string, num?: number) => [...trackIssues(t, label, [0, 1, 2], undefined, num).values()].flat().map((i) => i.kind);

describe('mặc định: không rule thì không báo', () => {
  it('box rất lạ (to, cao, xa, xoay, scale đổi) không bị báo; ngưỡng các bước tính ở mức tắt', () => {
    const t = track(1, [0, 1, 2].map((f) => ({ ...shape(f, false), points: cub(30 + f, 9, 9, 40 + f, 500, f * 2) })));
    for (const label of ['Vehicle', 'Pedestrian', 'Cyclist']) expect(kinds(t, label, 1)).toEqual([]);
    expect(allowedIou('Vehicle')).toBe(1);
    expect(DEFAULT_MOTION.defaultBase).toBe(BIG);
    expect(DEFAULT_DRIFT.minHold).toBe(BIG);
    expect(DEFAULT_FIT.minInside).toBe(0);
    expect(DEFAULT_GROUND.floatTol).toBe(BIG);
    expect(splitConfig.minFrames).toBe(BIG);
  });
});

describe('rule trên từng box: đối tượng, thuộc tính, quy tắc, ngưỡng', () => {
  it('K: Dài > 5.5 cho class Vehicle; class khác và giá trị trong ngưỡng không bị báo; xoá rule thì hết báo', () => {
    const r = rule('length', '>', 5.5, { t: 'class', name: 'vehicle' }); // không phân biệt hoa thường
    installRules([r], 1);
    expect(kinds(boxTrack(6.5, 1.8, 1.6), 'Vehicle')).toEqual(['K', 'K', 'K']);
    expect(kinds(boxTrack(5.5, 1.8, 1.6), 'Vehicle')).toEqual([]);
    expect(kinds(boxTrack(6.5, 1.8, 1.6), 'Pedestrian')).toEqual([]);
    installRules([], 1);
    expect(kinds(boxTrack(6.5, 1.8, 1.6), 'Vehicle')).toEqual([]);
  });

  it('cùng mã lỗi nhiều rule: một lỗi mỗi frame, gộp thông báo', () => {
    installRules([rule('length', '>', 5), rule('width', '>', 1)], 1);
    const m = trackIssues(boxTrack(6, 2, 1.6), 'Bus', [0], undefined, 1).get(0)!;
    expect(m.length).toBe(1);
    expect(m[0]!.message).toContain('Dài');
    expect(m[0]!.message).toContain('Rộng');
  });

  it('Z, D, H dùng đúng thuộc tính', () => {
    installRules([rule('z', '<', -3), rule('z', '>', 3), rule('distance', '>', 8), rule('yawJump', '>', 40)], 1);
    expect(kinds(boxTrack(4, 1.8, 1.6, 0.8), 'Vehicle')).toEqual(['D', 'D', 'D']);
    expect(kinds(boxTrack(4, 1.8, 1.6, 5), 'Vehicle')).toContain('Z');
    const t = track(1, [0, 1].map((f) => ({ ...shape(f, false), points: cub(4, 1.8, 1.6, 0.8, 1, f * 1.5) })));
    expect([...trackIssues(t, 'Vehicle', [0, 1], undefined, 1).values()].flat().map((i) => i.kind)).toEqual(['H']);
  });

  it('quy tắc >, >=, <, <=, =, != cho kết quả đúng ở biên', () => {
    expect([cmp(5, '>', 5), cmp(5, '>=', 5), cmp(5, '<', 5), cmp(5, '<=', 5), cmp(5, '=', 5), cmp(5, '!=', 5)]).toEqual([false, true, false, true, true, false]);
    expect([cmp(6, '>', 5), cmp(4, '<', 5), cmp(6, '=', 5), cmp(6, '!=', 5)]).toEqual([true, true, false, true]);
    installRules([rule('width', '=', 1.8)], 1);
    expect(kinds(boxTrack(4, 1.8, 1.6), 'Vehicle')).toEqual(['K', 'K', 'K']);
    expect(kinds(boxTrack(4, 1.9, 1.6), 'Vehicle')).toEqual([]);
  });

  it('rule theo object chỉ đúng ở job của nó; rule chưa nhập ngưỡng chưa có hiệu lực', () => {
    const bus = boxTrack(11, 2.5, 3.2);
    installRules([rule('length', '>', 9, { t: 'object', job: 7, num: 3 })], 7);
    expect(kinds(bus, 'Vehicle', 3)).toContain('K');
    expect(kinds(bus, 'Vehicle', 4)).toEqual([]);
    installRules([rule('length', '>', 9, { t: 'object', job: 7, num: 3 })], 8);
    expect(kinds(bus, 'Vehicle', 3)).toEqual([]);
    installRules([rule('length', '>', null)], 7);
    expect(kinds(bus, 'Vehicle', 3)).toEqual([]);
  });

  it('S chỉ xét object Dynamic size TẮT và dùng rule; chưa biết Dynamic thì không xét', () => {
    const t = track(1, [0, 1, 2].map((f) => ({ ...shape(f, false), points: cub(4 + f * 0.1, 1.8, 1.6) })));
    installRules([rule('sizeDev', '>', 0.01)], 1);
    expect(kinds(t, 'Vehicle')).not.toContain('S'); // không giả định class nào
    SIZE_SYNC.fn = (_t, label) => label === 'Cyclist';
    expect(kinds(t, 'Cyclist')).toContain('S');
    expect(kinds(t, 'Vehicle')).not.toContain('S');
  });

  it('S = size không đồng bộ: ngưỡng là dung sai, chỉ quy tắc > / >=; size giống nhau ở mọi frame thì không báo', () => {
    expect(METRIC_BY_ID.get('sizeDev')!.ops).toEqual(['>', '>=']);
    expect(validRule(rule('sizeDev', '<', 0.01))).toBe(false);
    SIZE_SYNC.fn = () => true;
    installRules([rule('sizeDev', '>', 0.01)], 1);
    expect(kinds(boxTrack(4, 1.8, 1.6), 'Vehicle')).toEqual([]);
    const t = track(1, [0, 1, 2].map((f) => ({ ...shape(f, false), points: cub(f === 2 ? 4.3 : 4, 1.8, 1.6) })));
    expect([...trackIssues(t, 'Vehicle', [0, 1, 2], undefined, 1)].map(([f, l]) => [f, l.map((i) => i.kind)])).toEqual([[2, ['S']]]);
  });
});

describe('ưu tiên rule: một object > class · attribute > class > tất cả object', () => {
  const attrs = (o: Record<string, string>) => { ATTRS_OF.fn = () => o; };
  it('rule class thắng rule tất cả cùng thuộc tính + cùng chiều; chiều ngược lại vẫn áp', () => {
    installRules([rule('length', '>', 2), rule('length', '>', 5.5, { t: 'class', name: 'Vehicle' }), rule('length', '<', 3)], 1);
    expect(kinds(boxTrack(4, 1.8, 1.6), 'Vehicle')).toEqual([]); // 4 > 2 nhưng rule của Vehicle (> 5.5) ghi đè
    expect(kinds(boxTrack(4, 1.8, 1.6), 'Pedestrian')).toEqual(['K', 'K', 'K']); // Pedestrian không có rule riêng
    expect(kinds(boxTrack(2.5, 1.8, 1.6), 'Vehicle')).toEqual(['K', 'K', 'K']); // < 3 của "tất cả" vẫn áp
  });

  it('rule theo attribute thắng rule class; khác giá trị attribute thì về rule class', () => {
    installRules([rule('length', '>', 5.5, { t: 'class', name: 'Vehicle' }), rule('length', '>', 12, { t: 'attr', name: 'Vehicle', attr: 'type', value: 'truck' })], 1);
    attrs({ type: 'truck' });
    expect(kinds(boxTrack(8, 2.4, 3), 'Vehicle')).toEqual([]);
    attrs({ type: 'car' });
    expect(kinds(boxTrack(8, 2.4, 3), 'Vehicle')).toEqual(['K', 'K', 'K']);
    const m = trackIssues(boxTrack(8, 2.4, 3), 'Vehicle', [0], undefined, 1).get(0)![0]!.message;
    expect(m).toContain('rule Vehicle');
  });

  it('khớp rule của hai attribute khác nhau: xét từ class', () => {
    const rs = [
      rule('height', '>', 1.9, { t: 'class', name: 'Pedestrian' }),
      rule('height', '>', 1.4, { t: 'attr', name: 'Pedestrian', attr: 'age', value: 'child' }),
      rule('height', '>', 1.2, { t: 'attr', name: 'Pedestrian', attr: 'pose', value: 'sitting' }),
    ];
    const ctx = { job: 1, label: 'Pedestrian', attrs: { age: 'child', pose: 'sitting' } };
    expect(effectiveRules(rs, ctx).map((r) => r.target.t)).toEqual(['class']);
    expect(effectiveRules(rs, { ...ctx, attrs: { age: 'child', pose: 'standing' } }).map((r) => r.value)).toEqual([1.4]);
    expect(effectiveRules([rs[1]!, rs[2]!], ctx)).toEqual([]); // không có rule class, không có rule "tất cả": không báo
  });

  it('rule một object cao nhất; rule theo attribute lưu / đọc lại được, trường lạ bị bỏ', () => {
    const own = rule('length', '>', 20, { t: 'object', job: 1, num: 1 });
    installRules([rule('length', '>', 5, { t: 'attr', name: 'Vehicle', attr: 'type', value: 'truck' }), own], 1);
    attrs({ type: 'truck' });
    expect(kinds(boxTrack(8, 2.4, 3), 'Vehicle', 1)).toEqual([]);
    expect(kinds(boxTrack(8, 2.4, 3), 'Vehicle', 2)).toEqual(['K', 'K', 'K']);
    const raw = JSON.parse(JSON.stringify([{ ...rule('length', '>', 5, { t: 'attr', name: 'Vehicle', attr: 'type', value: 'truck' }), extra: 1 }]));
    raw[0].target.junk = 'x';
    expect(parseRules(raw)[0]!.target).toEqual({ t: 'attr', name: 'Vehicle', attr: 'type', value: 'truck' });
    expect(validRule({ ...raw[0], target: { t: 'attr', name: 'Vehicle', attr: '', value: 'x' } })).toBe(false);
  });
});

describe('rule → cấu hình các bước tính', () => {
  it('IoU / đi xa: rule class ưu tiên hơn rule "tất cả"; tên class tuỳ ý theo job', () => {
    installRules([rule('iou', '>', 0.5), rule('iou', '>', 0.1, { t: 'class', name: 'Cyclist' }), rule('motionDev', '>', 2), rule('motionDev', '>', 0.7, { t: 'class', name: 'Cyclist' })], 1);
    expect(allowedIou('Pedestrian')).toBe(0.5);
    expect(allowedIou('Cyclist')).toBe(0.1);
    expect(DEFAULT_OVERLAP.defaultAllowed).toBe(0.5);
    expect(DEFAULT_MOTION.defaultBase).toBe(2);
    expect(DEFAULT_MOTION.base['cyclist']).toBe(0.7);
  });

  it('T, lệch / ít điểm, mặt đường, tách ID: > và >= khác nhau ở số nguyên; nhiều rule lấy mức chặt', () => {
    installRules([rule('holdFrames', '>=', 4), rule('holdFrames', '>', 2), rule('ptsOutside', '>', 9), rule('ptsInside', '<=', 5), rule('floatGap', '>', 0.12), rule('sinkGap', '>=', 0.04), rule('outsideGap', '>=', 7)], 1);
    expect(DEFAULT_DRIFT.minHold).toBe(3);
    expect(DEFAULT_FIT.minShell).toBe(10);
    expect(DEFAULT_FIT.minInside).toBe(6);
    expect(DEFAULT_GROUND.floatTol).toBe(0.12);
    expect(DEFAULT_GROUND.sinkTol).toBe(0.04);
    expect(splitConfig.minFrames).toBe(7);
    const t = track(1, [{ ...shape(0, false), points: cub(1, 1, 1) }, shape(1, true), { ...shape(7, false), points: cub(1, 1, 1) }]);
    expect(findLongOutsideGaps(t, 0, 9).length).toBe(0); // 6 frame outside < 7
    installRules([rule('outsideGap', '>=', 6)], 1);
    expect(findLongOutsideGaps(t, 0, 9).length).toBe(1);
  });

  it('số liệu nền đổi (lệch / ít điểm / mặt đường) thì mã cấu hình đổi; ngưỡng trôi box thì không', () => {
    const a = backgroundConfigKey();
    installRules([rule('holdFrames', '>=', 3)], 1);
    expect(backgroundConfigKey()).toBe(a);
    installRules([rule('ptsInside', '<', 6)], 1);
    expect(backgroundConfigKey()).not.toBe(a);
  });
});

describe('kiểm tra rule và lưu', () => {
  it('rule hợp lệ: thuộc tính / quy tắc / đối tượng phải được phép, ngưỡng trong khoảng', () => {
    expect(validRule(rule('length', '>', 5, { t: 'class', name: 'Bus' }))).toBe(true);
    expect(validRule(rule('length', '>', null))).toBe(true);
    expect(validRule(rule('iou', '<', 0.5))).toBe(false); // IoU chỉ có > / >=
    expect(validRule(rule('holdFrames', '>=', 3, { t: 'class', name: 'Bus' }))).toBe(false); // chỉ áp cho tất cả
    expect(validRule(rule('holdFrames', '>=', 2.5))).toBe(false); // phải là số nguyên
    expect(validRule(rule('iou', '>', 2))).toBe(false);
    expect(validRule({ id: 'x', metric: 'khong', op: '>', value: 1, target: { t: 'all' } })).toBe(false);
    expect(parseRules('hỏng')).toEqual([]);
    const good = rule('z', '>', 3);
    expect(parseRules([good, good, { bad: 1 }, rule('z', '??' as Op, 1)])).toEqual([good]);
  });

  it('mỗi thuộc tính có khoảng hợp lệ và id duy nhất', () => {
    expect(new Set(METRICS.map((m) => m.id)).size).toBe(METRICS.length);
    for (const m of METRICS) { expect(m.ops.length).toBeGreaterThan(0); expect(m.min).toBeLessThan(m.max); }
  });

  it('tham số kỹ thuật: chỉ lưu giá trị khác mặc định; nạp lại đúng; hỏng thì bỏ', () => {
    expect(toPersisted()).toEqual({ n: {} });
    expect(setValue('T.hold', 0.02)).toBe(true);
    expect(setValue('T.hold', 99)).toBe(false);
    expect(setValue('khong.ton.tai', 1)).toBe(false);
    const saved = JSON.parse(JSON.stringify(toPersisted()));
    expect(saved).toEqual({ n: { 'T.hold': 0.02 } });
    resetAll();
    applyPersisted(saved);
    expect(DEFAULT_DRIFT.holdTol).toBe(0.02);
    applyPersisted({ n: { 'T.hold': 'x', 'F.ratio': -1 } });
    expect(toPersisted()).toEqual({ n: {} });
    applyPersisted('hỏng'); applyPersisted(null);
    for (const f of FIELDS) { expect(f.def).toBeGreaterThanOrEqual(f.min); expect(f.def).toBeLessThanOrEqual(f.max); }
  });
});

describe('file setting.json và class của job', () => {
  it('không giả định class: tên lạ mặc định dynamic; tên có trong setting (không phân biệt hoa thường) theo setting', () => {
    const s = { classes: { Bus: false }, attrRules: {} };
    expect(dynDefaultFor('Cyclist')).toBe(true);
    expect(dynDefaultFor('Vehicle')).toBe(true);
    expect(dynDefaultFor('bus', s)).toBe(false);
    expect(dynDefaultFor('BUS', s)).toBe(false);
    expect(dynDefaultFor('Car', s)).toBe(true);
  });

  it('parseSettings: gồm tham số, rule, ký hiệu, Dynamic size; bỏ phần hỏng, không ném lỗi', () => {
    for (const bad of [null, 5, 'x', [], { dynamicSize: 3, rules: 'a' }]) expect(() => parseSettings(bad)).not.toThrow();
    const good = rule('length', '>', 5, { t: 'class', name: 'Bus' });
    const s = parseSettings({ params: { 'T.hold': 0.02, 'F.ratio': 'x' }, rules: [good, { bad: 1 }], symbols: { M: 'W', Q: 'x' }, dynamicSize: { classes: { Bus: false, Car: 'no' }, attrRules: { 'Bus|door=open': 'static', sai: 'dyn' } } });
    expect(s.params).toEqual({ 'T.hold': 0.02 });
    expect(s.rules).toEqual([good]);
    expect(s.symbols).toEqual({ M: 'W' });
    expect(s.dynamicSize.classes).toEqual({ Bus: false });
    expect(s.dynamicSize.attrRules).toEqual({ 'Bus|door=open': 'static' });
  });

  it('merge / áp theo job: chỉ ghi đè class của job; class khác giữ nguyên', () => {
    const base = { classes: { Vehicle: false, Obstacle: false }, attrRules: { 'Vehicle|x=1': 'static' as const } };
    const m = mergeDynSettings(base, ['Bus', 'Obstacle'], { Bus: false, Obstacle: true }, { 'Bus|door=open': 'static' });
    expect(m.classes).toEqual({ Vehicle: false, Bus: false, Obstacle: true });
    expect(m.attrRules).toEqual({ 'Vehicle|x=1': 'static', 'Bus|door=open': 'static' });
    expect(dynForJob(m, ['bus']).classes).toEqual({ bus: false });
    expect(dynForJob(m, ['bus']).attrRules).toEqual({ 'bus|door=open': 'static' });
  });
});
