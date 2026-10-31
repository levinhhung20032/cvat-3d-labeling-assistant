import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { getAttr, matchValue, parseLabelSpecs, setAttrAll, setAttrForward, setAttrFrom, setAttrStatic } from '../src/shared/attributes';
import { animalSpecies, obstacleType, pedestrianAge, pedestrianPose, rideState, riderInside, suggestAttributes, vehicleType } from '../src/shared/attrSuggest';
import { stateAt } from '../src/shared/interp';
import type { CvatAnnotations, CvatLabel, CvatShape, CvatTrack } from '../src/shared/types';
import { shape, track } from './fixtures';

// Đặc tả nhãn đúng như một job thật (đã đọc từ CVAT)
const LABELS: CvatLabel[] = [
  { id: 12871, name: 'vehicles', attributes: [{ id: 1816, name: 'type', input_type: 'radio', mutable: false, default_value: 'car', values: ['car', 'truck', 'bus', 'van', 'contruction', 'pickup', 'Trailer', 'Tricycle', 'Stroller', 'Wheelchair', 'other'] }] },
  { id: 12872, name: 'pedestrian', attributes: [
    { id: 1817, name: 'age', input_type: 'select', mutable: false, default_value: 'child', values: ['child', 'adult'] },
    { id: 1818, name: 'pose', input_type: 'select', mutable: true, default_value: 'standing', values: ['standing', 'sitting', 'bending'] }] },
  { id: 12873, name: 'two-wheels', attributes: [{ id: 1819, name: 'ride_state', input_type: 'checkbox', mutable: true, default_value: 'false', values: ['false'] }] },
  { id: 12874, name: 'Animal', attributes: [{ id: 1820, name: 'species', input_type: 'select', mutable: false, default_value: 'cat', values: ['cat', 'dog', 'cow', 'buffalow', 'other'] }] },
  { id: 12875, name: 'Obstacle', attributes: [{ id: 1821, name: 'type', input_type: 'select', mutable: false, default_value: 'brick', values: ['brick', 'traffic barrier', 'traffic cone', 'sack', 'trash_bag', 'container', 'metal_sheet', 'wood', 'pole', 'other', 'charging_point'] }] },
];
const SPECS = parseLabelSpecs(LABELS);

const box = (frame: number, L: number, W: number, H: number, x = 10, outside = false): CvatShape => {
  const s = shape(frame, outside);
  s.points[0] = x; s.points[6] = L; s.points[7] = W; s.points[8] = H;
  return s;
};
const trk = (labelId: number, L: number, W: number, H: number, attrs: { spec_id: number; value: string }[] = []): CvatTrack => ({
  ...track(1, [box(0, L, W, H), box(5, L, W, H)]), label_id: labelId, attributes: attrs,
});
const hints = (t: CvatTrack, frame = 0, peds: ReturnType<typeof ped>[] = []) => {
  const lab = LABELS.find((l) => l.id === t.label_id)!;
  return suggestAttributes({ track: t, label: lab.name, spec: SPECS.get(t.label_id)!, frame, box: stateAt(t, frame).cuboid, pedestrians: peds });
};
const ped = (x: number, y: number, z: number) => ({ x, y, z, rx: 0, ry: 0, yaw: 0, sx: 0.8, sy: 0.8, sz: 1.7 });

describe('đọc / ghi attribute', () => {
  const age = SPECS.get(12872)!.attrs[0]!;
  const pose = SPECS.get(12872)!.attrs[1]!;
  it("attribute tĩnh nằm ở cấp track, đặt không đổi ID · attribute mutable lấy từ keyframe gần nhất ≤ frame", () => {
    {
    const t = trk(12872, 0.8, 0.8, 1.7, [{ spec_id: 1817, value: 'child' }]);
    expect(getAttr(t, 0, age)).toBe('child');
    const r = setAttrStatic(t, age, 'adult')!;
    expect(getAttr(r.track, 0, age)).toBe('adult');
    expect(r.track.id).toBe(1);
    expect(setAttrStatic(r.track, age, 'adult')).toBeNull(); // không đổi
    expect(t.attributes).toEqual([{ spec_id: 1817, value: 'child' }]); // không sửa bản gốc
  }
    {
    const t = trk(12872, 0.8, 0.8, 1.7);
    t.shapes[0]!.attributes = [{ spec_id: 1818, value: 'standing' }];
    t.shapes[1]!.attributes = [{ spec_id: 1818, value: 'sitting' }];
    expect(getAttr(t, 3, pose)).toBe('standing');
    expect(getAttr(t, 5, pose)).toBe('sitting');
    expect(getAttr(t, 9, pose)).toBe('sitting');
  }
  });
  it("đặt mutable từ frame f: tạo keyframe giữ nguyên hình dạng, các keyframe sau không đổi · đặt mutable cho cả track; frame outside không đặt được", () => {
    {
    const t = trk(12872, 0.8, 0.8, 1.7);
    t.shapes[0]!.attributes = [{ spec_id: 1818, value: 'standing' }];
    t.shapes[1]!.attributes = [{ spec_id: 1818, value: 'standing' }];
    const r = setAttrFrom(t, pose, 2, 'bending')!;
    expect(r.frames).toEqual([2]);
    expect(r.track.shapes.map((s) => s.frame)).toEqual([0, 2, 5]);
    expect(getAttr(r.track, 1, pose)).toBe('standing');
    expect(getAttr(r.track, 2, pose)).toBe('bending');
    expect(getAttr(r.track, 4, pose)).toBe('bending');
    expect(getAttr(r.track, 5, pose)).toBe('standing');
    expect(stateAt(r.track, 2).cuboid!.x).toBeCloseTo(stateAt(t, 2).cuboid!.x);
  }
    {
    const t = trk(12872, 0.8, 0.8, 1.7);
    t.shapes.push(box(8, 0.8, 0.8, 1.7, 10, true));
    const r = setAttrAll(t, pose, 'sitting')!;
    expect(getAttr(r.track, 0, pose)).toBe('sitting');
    expect(getAttr(r.track, 5, pose)).toBe('sitting');
    expect(r.track.shapes[2]!.attributes ?? []).toEqual([]);
    expect(setAttrFrom(t, pose, 9, 'sitting')).toBeNull();
  }
  });
  it('khớp giá trị theo danh sách hợp lệ (bỏ khác biệt hoa thường / gạch)', () => {
    const species = SPECS.get(12874)!.attrs[0]!;
    expect(matchValue(species, 'buffalo')).toBe('buffalow');
    expect(matchValue(SPECS.get(12875)!.attrs[0]!, 'traffic_cone')).toBe('traffic cone');
    expect(matchValue(SPECS.get(12871)!.attrs[0]!, 'trailer')).toBe('Trailer');
    expect(matchValue(species, 'zebra')).toBeNull();
  });
});

describe('quy tắc theo kích thước', () => {
  it("xe: các cỡ điển hình · người đi bộ: tuổi theo chiều cao, tư thế theo tỉ lệ so với chiều cao đứng", () => {
    {
    expect(vehicleType({ L: 4.5, W: 1.9, H: 1.55 }).v).toBe('car');
    expect(vehicleType({ L: 5.76, W: 2.38, H: 2.71 }).v).toBe('truck');
    expect(vehicleType({ L: 5.1, W: 2.1, H: 2.15 }).v).toBe('van');
    expect(vehicleType({ L: 11.5, W: 2.5, H: 3.4 }).v).toBe('bus' === 'bus' ? 'trailer' : '');
    expect(vehicleType({ L: 9.5, W: 2.5, H: 3.0 }).v).toBe('bus');
    expect(vehicleType({ L: 1.0, W: 0.6, H: 1.0 }).v).toBe('stroller');
    expect(vehicleType({ L: 2.4, W: 1.2, H: 1.6 }).v).toBe('tricycle');
  }
    {
    expect(pedestrianAge({ L: 0.8, W: 0.8, H: 1.1 }).v).toBe('child');
    expect(pedestrianAge({ L: 0.8, W: 0.8, H: 1.7 }).v).toBe('adult');
    expect(pedestrianPose(1.7, 1.7)!.v).toBe('standing');
    expect(pedestrianPose(1.3, 1.7)!.v).toBe('bending');
    expect(pedestrianPose(1.0, 1.7)!.v).toBe('sitting');
  }
  });
  it("xe hai bánh: có người lái khi người đi bộ nằm trong box hoặc box cao · động vật và vật cản", () => {
    {
    const bike = { x: 10, y: 0, z: 0.8, rx: 0, ry: 0, yaw: 0, sx: 1.8, sy: 0.7, sz: 1.6 };
    expect(riderInside(bike, [ped(10.2, 0.1, 0.9)])).toBe(true);
    expect(riderInside(bike, [ped(13, 0, 0.9)])).toBe(false);
    expect(rideState(1.6, false)!.v).toBe('true');
    expect(rideState(1.0, false)!.v).toBe('false');
    expect(rideState(1.25, false)).toBeNull();
    expect(rideState(1.0, true)!.v).toBe('true');
  }
    {
    expect(animalSpecies({ L: 0.5, W: 0.25, H: 0.3 }).v).toBe('cat');
    expect(animalSpecies({ L: 0.9, W: 0.4, H: 0.6 }).v).toBe('dog');
    expect(animalSpecies({ L: 2.1, W: 0.8, H: 1.4 }).v).toBe('buffalo');
    expect(obstacleType({ L: 0.3, W: 0.3, H: 0.7 }).v).toBe('traffic cone');
    expect(obstacleType({ L: 2.0, W: 0.3, H: 0.9 }).v).toBe('traffic barrier');
    expect(obstacleType({ L: 1.5, W: 1.0, H: 0.05 }).v).toBe('metal_sheet');
  }
  });
});

describe('suggestAttributes', () => {
  it("xe đang để mặc định \"car\" nhưng là xe tải: gợi ý truck · xe đúng là car: không gợi ý", () => {
    {
    const h = hints(trk(12871, 5.76, 2.38, 2.71));
    expect(h).toHaveLength(1);
    expect(h[0]).toMatchObject({ suggested: 'truck', effective: 'car', scope: 'track' });
    expect(h[0]!.reason).toMatch(/cao/);
  }
    {
    expect(hints(trk(12871, 4.82, 1.97, 1.56, [{ spec_id: 1816, value: 'car' }]))).toEqual([]);
  }
  });
  it("người đi bộ đang để \"child\" nhưng cao 1,63 m: gợi ý adult; mặc định \"child\" của nhãn cũng bị bắt · xe hai bánh có người đi bộ nằm trong box nhưng ride_state chưa bật", () => {
    {
    expect(hints(trk(12872, 0.8, 0.8, 1.63, [{ spec_id: 1817, value: 'child' }]))[0]).toMatchObject({ suggested: 'adult', current: 'child' });
    const none = hints(trk(12872, 0.8, 0.8, 1.7)).find((x) => x.spec.name === 'age')!;
    expect(none).toMatchObject({ suggested: 'adult', current: undefined, effective: 'child' });
  }
    {
    const t = trk(12873, 1.8, 0.7, 1.0);
    const h = hints(t, 0, [ped(10.1, 0, 0.5)]);
    expect(h[0]).toMatchObject({ suggested: 'true', confidence: 'cao', scope: 'frame' });
  }
  });
  it("checkbox ride_state: \"true\" hợp lệ dù spec của job chỉ liệt kê [\"false\"] · frame outside: không gợi ý attribute theo frame", () => {
    {
    const h = hints(trk(12873, 1.8, 0.7, 1.6));
    expect(h[0]).toMatchObject({ suggested: 'true', effective: 'false', confidence: 'vừa' });
    const t = trk(12873, 1.8, 0.7, 1.6);
    t.shapes.forEach((s) => { s.attributes = [{ spec_id: 1819, value: 'true' }]; });
    expect(hints(t)).toEqual([]);
    expect(matchValue(SPECS.get(12873)!.attrs[0]!, 'true')).toBe('true');
  }
    {
    const t = trk(12872, 0.8, 0.8, 1.7, [{ spec_id: 1817, value: 'adult' }]);
    t.shapes.push(box(8, 0.8, 0.8, 1.7, 10, true));
    expect(hints(t, 9).find((x) => x.spec.name === 'pose')).toBeUndefined();
  }
  });
});

const file = 'backups/backup_sample.json';
describe.skipIf(!existsSync(file))('gợi ý trên job thật 1001', () => {
  const ann = (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : { tracks: [] }) as CvatAnnotations;
  const all = ann.tracks.flatMap((t, i) => {
    const first = t.shapes.find((s) => !s.outside);
    if (!first) return [];
    return hints(t, first.frame).map((h) => ({ num: i + 1, name: h.spec.name, cur: h.effective, sug: h.suggested }));
  });
  it("bắt xe #52 (cao 2,71 m) và hai người đi bộ bị gán \"child\" (#45, #46) · không gợi ý bừa: phần lớn xe cỡ car giữ nguyên", () => {
    {
    expect(all).toContainEqual({ num: 52, name: 'type', cur: 'car', sug: 'truck' });
    expect(all).toContainEqual({ num: 45, name: 'age', cur: 'child', sug: 'adult' });
    expect(all).toContainEqual({ num: 46, name: 'age', cur: 'child', sug: 'adult' });
  }
    {
    const veh = all.filter((a) => a.name === 'type');
    expect(veh.length).toBeLessThanOrEqual(5);
  }
  });
});

describe('setAttrForward (đồng bộ attribute về sau)', () => {
  const pose = SPECS.get(12872)!.attrs.find((a) => a.name === 'pose')!;
  const withPose = (frame: number, value: string | null, outside = false): CvatShape => {
    const s = box(frame, 0.8, 0.8, 1.7, 10, outside);
    s.attributes = value === null ? [] : [{ spec_id: pose.id, value }];
    return s;
  };
  const trkPose = (): CvatTrack => ({ ...track(1, [withPose(0, 'standing'), withPose(3, 'sitting'), withPose(6, 'standing'), withPose(9, 'bending')]), label_id: 12872 });
  it("ghi đè mọi keyframe sau frame đang chọn, không đụng các frame trước · tạo keyframe ở frame chưa phải keyframe và các keyframe sau ghi đè", () => {
    {
    const r = setAttrForward(trkPose(), pose, 3, 'bending')!;
    expect([...r.frames].sort((a, b) => a - b)).toEqual([3, 6]); // frame 3 được đặt, frame 6 bị ghi đè, frame 9 đã đúng
    expect(getAttr(r.track, 0, pose)).toBe('standing');
    expect(getAttr(r.track, 3, pose)).toBe('bending');
    expect(getAttr(r.track, 6, pose)).toBe('bending');
    expect(getAttr(r.track, 9, pose)).toBe('bending');
  }
    {
    const r = setAttrForward(trkPose(), pose, 4, 'sitting')!;
    expect(r.track.shapes.some((s) => s.frame === 4)).toBe(true);
    expect(getAttr(r.track, 4, pose)).toBe('sitting');
    expect(getAttr(r.track, 7, pose)).toBe('sitting');
    expect(getAttr(r.track, 9, pose)).toBe('sitting');
    expect(getAttr(r.track, 3, pose)).toBe('sitting');
  }
  });
  it("không có gì đổi hoặc attribute không đổi theo frame → null · frame không có box (outside) → null", () => {
    {
    const t: CvatTrack = { ...track(1, [withPose(0, 'standing'), withPose(5, 'standing')]), label_id: 12872 };
    expect(setAttrForward(t, pose, 0, 'standing')).toBeNull();
    const stat = SPECS.get(12872)!.attrs.find((a) => a.name === 'age')!;
    expect(setAttrForward(t, stat, 0, 'adult')).toBeNull();
  }
    {
    const t: CvatTrack = { ...track(1, [withPose(0, 'standing'), withPose(3, null, true)]), label_id: 12872 };
    expect(setAttrForward(t, pose, 3, 'sitting')).toBeNull();
  }
  });
});
