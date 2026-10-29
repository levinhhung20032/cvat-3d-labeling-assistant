import { afterEach, describe, expect, it } from 'vitest';
import { serializeCuboid } from '../src/shared/cuboid';
import { DEFAULT_DRIFT } from '../src/shared/drift';
import { DEFAULT_FIT } from '../src/shared/fit';
import { DEFAULT_GROUND } from '../src/shared/ground';
import { DEFAULT_OVERLAP, allowedIou } from '../src/shared/overlap';
import { DEFAULT_QC_RULES, SIZE_OVERRIDES, trackIssues } from '../src/shared/qcrules';
import { findLongOutsideGaps, splitConfig, SPLIT_OUTSIDE_FRAMES } from '../src/shared/splitId';
import {
  applyPersisted, backgroundConfigKey, FIELDS, getSize, resetAll, resetSection, sectionChanged, setSizeRange, setSync, setValue, sizeChanged, syncGroups, toPersisted,
} from '../src/shared/thresholds';
import { shape, track } from './fixtures';
import type { CvatTrack } from '../src/shared/types';

afterEach(() => { resetAll(); SIZE_OVERRIDES.clear(); });

const cub = (sx: number, sy: number, sz: number, z = 0.8) => serializeCuboid({ x: 10, y: 0, z, rx: 0, ry: 0, yaw: 0, sx, sy, sz }, Array(16).fill(0));
const boxTrack = (sx: number, sy: number, sz: number, z = 0.8): CvatTrack =>
  track(1, [0, 1, 2].map((f) => ({ ...shape(f, false), points: cub(sx, sy, sz, z) })));
const kinds = (t: CvatTrack, label: string, num?: number) => [...trackIssues(t, label, [0, 1, 2], DEFAULT_QC_RULES, num).values()].flat().map((i) => i.kind);

describe('ngưỡng chỉnh tay', () => {
  it('mặc định khớp cấu hình gốc; đổi một ngưỡng thì luật dùng ngay, đặt lại thì về như cũ', () => {
    expect(kinds(boxTrack(4.4, 1.8, 1.6), 'Vehicle')).toEqual([]);
    expect(setValue('Z.max', 0.5)).toBe(true);
    expect(kinds(boxTrack(4.4, 1.8, 1.6), 'Vehicle')).toEqual(['Z', 'Z', 'Z']);
    expect(sectionChanged('Z')).toBe(true);
    resetSection('Z');
    expect(DEFAULT_QC_RULES.zMax).toBe(3);
    expect(sectionChanged('Z')).toBe(false);
  });

  it('giá trị ngoài khoảng / không phải số nguyên (với ô nguyên) / z thấp nhất > cao nhất bị từ chối, giữ giá trị cũ', () => {
    expect(setValue('H.deg', 0)).toBe(false);
    expect(setValue('H.deg', Number.NaN)).toBe(false);
    expect(setValue('T.minHold', 3.5)).toBe(false);
    expect(setValue('Z.min', 9)).toBe(false);
    expect(setValue('khong.ton.tai', 1)).toBe(false);
    expect(DEFAULT_QC_RULES.maxRotationJumpDeg).toBe(40);
    expect(DEFAULT_DRIFT.minHold).toBe(3);
    expect(DEFAULT_QC_RULES.zMin).toBe(-3);
  });

  it('mỗi nhóm ngưỡng ghi đúng vào cấu hình của nó (O, T, đi xa, lệch, đáy, tách ID)', () => {
    setValue('O.vehicle', 0.3); expect(allowedIou('Vehicle')).toBe(0.3);
    setValue('O.area', 0.5); expect(DEFAULT_OVERLAP.minArea).toBe(0.5);
    setValue('T.supMin', 9); expect(DEFAULT_DRIFT.supportMin).toBe(9);
    setValue('F.minInside', 10); expect(DEFAULT_FIT.minInside).toBe(10);
    setValue('G.float', 0.2); expect(DEFAULT_GROUND.floatTol).toBe(0.2);
    setValue('X.split', 3); expect(splitConfig.minFrames).toBe(3);
    expect(SPLIT_OUTSIDE_FRAMES).toBe(6);
  });

  it('ngưỡng tách ID đổi thì findLongOutsideGaps (tham số mặc định) dùng ngưỡng mới', () => {
    const t = track(1, [{ ...shape(0, false), points: cub(1, 1, 1) }, shape(1, true), { ...shape(5, false), points: cub(1, 1, 1) }]);
    expect(findLongOutsideGaps(t, 0, 9)).toEqual([]); // 4 frame outside < 6
    setValue('X.split', 4);
    expect(findLongOutsideGaps(t, 0, 9).length).toBe(1);
  });

  it('số liệu nền (lệch / ít điểm / mặt đường) đổi ngưỡng thì mã cấu hình đổi (để bỏ kết quả đã tính)', () => {
    const a = backgroundConfigKey();
    setValue('T.hold', 0.01);
    expect(backgroundConfigKey()).toBe(a); // ngưỡng trôi box không ảnh hưởng số liệu nền
    setValue('F.ratio', 0.5);
    expect(backgroundConfigKey()).not.toBe(a);
  });
});

describe('K: kích thước theo class và theo object', () => {
  it('đổi khoảng của class áp cho mọi object của class (đồng bộ); đặt lại về mặc định', () => {
    const t = boxTrack(6.5, 1.8, 1.6); // xe dài 6.5 > 5.5
    expect(kinds(t, 'Vehicle')).toEqual(['K', 'K', 'K']);
    expect(setSizeRange('vehicle', 'length', 3.2, 7)).toBe(true);
    expect(sizeChanged('vehicle')).toBe(true);
    expect(kinds(t, 'Vehicle')).toEqual([]);
    resetSection('K');
    expect(getSize('vehicle').length).toEqual([3.2, 5.5]);
    expect(kinds(t, 'Vehicle')).toEqual(['K', 'K', 'K']);
  });

  it('khoảng sai (nhỏ nhất > lớn nhất, âm, không phải số) bị từ chối', () => {
    expect(setSizeRange('vehicle', 'width', 2.5, 1)).toBe(false);
    expect(setSizeRange('vehicle', 'width', -1, 1)).toBe(false);
    expect(setSizeRange('vehicle', 'width', Number.NaN, 1)).toBe(false);
    expect(getSize('vehicle').width).toEqual([1.6, 2.2]);
  });

  it('ngưỡng riêng của object ưu tiên hơn class, chỉ áp cho object đó; class chưa có ngưỡng (Animal) cũng dùng được', () => {
    const bus = boxTrack(11, 2.5, 3.2);
    expect(kinds(bus, 'Vehicle', 7)).toContain('K');
    SIZE_OVERRIDES.set(7, { length: [8, 13], width: [2, 3], height: [2.5, 3.5] });
    expect(kinds(bus, 'Vehicle', 7)).toEqual([]);
    expect(kinds(bus, 'Vehicle', 8)).toContain('K'); // object khác vẫn theo class
    expect(kinds(bus, 'Animal', 7)).toEqual([]);
    SIZE_OVERRIDES.set(9, { length: [0.1, 0.5], width: [0.1, 0.5], height: [0.1, 0.5] });
    const msg = [...trackIssues(bus, 'Animal', [0], DEFAULT_QC_RULES, 9).values()].flat()[0]!.message;
    expect(msg).toContain('riêng của object');
    expect(kinds(bus, 'Animal', 5)).toEqual([]); // không ngưỡng riêng, class chưa có ngưỡng: không báo K
  });

  it('S: chọn class áp dụng; tắt Vehicle thì không báo scale không đồng bộ', () => {
    const t = track(1, [0, 1, 2].map((f) => ({ ...shape(f, false), points: cub(4 + f * 0.1, 1.8, 1.6) })));
    expect(kinds(t, 'Vehicle')).toContain('S');
    setSync('vehicle', false);
    expect(syncGroups()).toEqual([]);
    expect(kinds(t, 'Vehicle')).not.toContain('S');
    resetSection('S');
    expect(syncGroups()).toEqual(['vehicle']);
  });
});

describe('lưu và nạp', () => {
  it('chỉ lưu giá trị khác mặc định; nạp lại đúng; dữ liệu hỏng / ngoài khoảng bị bỏ từng phần', () => {
    expect(toPersisted()).toEqual({ n: {}, size: {} });
    setValue('D.max', 120); setValue('O.pedestrian', 0.2); setSizeRange('two_wheel', 'length', 1.2, 2.4); setSync('pedestrian', true);
    const saved = JSON.parse(JSON.stringify(toPersisted()));
    expect(Object.keys(saved.n).sort()).toEqual(['D.max', 'O.pedestrian']);
    expect(saved.size.two_wheel.length).toEqual([1.2, 2.4]);
    resetAll();
    expect(DEFAULT_QC_RULES.maxDistance).toBe(80);
    applyPersisted(saved);
    expect(DEFAULT_QC_RULES.maxDistance).toBe(120);
    expect(allowedIou('Pedestrian')).toBe(0.2);
    expect(getSize('two_wheel').length).toEqual([1.2, 2.4]);
    expect(syncGroups()).toEqual(['vehicle', 'pedestrian']);

    applyPersisted({ n: { 'D.max': -5, 'H.deg': 'x', 'Z.min': 1, 'Z.max': 0 }, size: { vehicle: { length: [9, 1], width: [1, 2] } }, sync: 5 });
    expect(DEFAULT_QC_RULES.maxDistance).toBe(80);
    expect(DEFAULT_QC_RULES.maxRotationJumpDeg).toBe(40);
    expect(getSize('vehicle').length).toEqual([3.2, 5.5]);
    expect(getSize('vehicle').width).toEqual([1, 2]); // phần hợp lệ vẫn được nạp
    applyPersisted('hỏng'); applyPersisted(null);
    expect(toPersisted()).toEqual({ n: {}, size: {} });
  });

  it('mọi ô có mặc định nằm trong khoảng cho phép (giá trị gốc luôn hợp lệ)', () => {
    for (const f of FIELDS) { expect(f.def).toBeGreaterThanOrEqual(f.min); expect(f.def).toBeLessThanOrEqual(f.max); }
  });
});
