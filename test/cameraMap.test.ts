import { describe, expect, it } from 'vitest';
import { buildCameras, camKey, emptyBank, materializeSetup, makeCameraPreset, parseCameraBank, parseCameraPreset, rankCameras, suggestDir, yawToUi } from '../src/shared/cameras';
import { parseSettings, pickParts, presentParts, SETTINGS_PARTS } from '../src/shared/settings';
import type { CameraSetup } from '../src/shared/cameras';

const ALL_PARTS = SETTINGS_PARTS.map((p) => p.id);
const setup = (o: Partial<CameraSetup> = {}): CameraSetup => ({ count: 8, map: {}, over: {}, flip: false, ...o });

describe('ánh xạ camera', () => {
  it('đề xuất hướng theo số thứ tự image_N và theo từ khóa trong tên', () => {
    expect(suggestDir('image_1.jpg', 8)).toBe('front');
    expect(suggestDir('image_3.jpg', 8)).toBe('left');
    expect(suggestDir('cam_rear_left.jpg', 8)).toBe('back-left');
    expect(suggestDir('Front.PNG', 6)).toBe('front');
    expect(suggestDir('mystery.jpg', 8)).toBe('');
    expect(suggestDir('image_7.jpg', 6)).toBe(''); // bộ 6 chỉ có 6 camera
  });
  it('gán tay thắng đề xuất; sửa tay góc nhìn thắng đề xuất theo hướng', () => {
    const files = ['image_0.jpg', 'image_1.jpg'];
    const c = buildCameras(files, setup({ map: { [camKey('image_0.jpg')]: 'left' }, over: { image_0: { yaw: 100 } } }));
    expect(c[0]).toMatchObject({ dir: 'left', yaw: 100, lens: 'fisheye', suggested: false });
    expect(c[1]).toMatchObject({ dir: 'front', yaw: 0, suggested: true });
  });
  it('bộ 6 camera dùng góc nhìn riêng; camera chưa gán xếp cuối', () => {
    const c = buildCameras(['a.jpg', 'front.jpg'], setup({ count: 6 }));
    expect(c[0]!.dir).toBe('');
    expect(c[1]!.yaw).toBe(0);
    expect(rankCameras(0, c)[0]!.key).toBe('front');
    expect(rankCameras(0, c)[1]!.key).toBe('a');
  });
  it('đảo trái ↔ phải đổi dấu yaw; giao diện la bàn + = phải', () => {
    const f = ['image_3.jpg'];
    expect(buildCameras(f, setup())[0]!.yaw).toBe(90);
    expect(buildCameras(f, setup({ flip: true }))[0]!.yaw).toBe(-90);
    expect(yawToUi(90)).toBe(-90);
    expect(yawToUi(0)).toBe(0);
    expect(Object.is(buildCameras(['image_1.jpg'], setup({ flip: true }))[0]!.yaw, 0)).toBe(true);
  });
  it('mặc định của tool: đủ hai bộ 6 và 8 camera với hướng, yaw, ống kính, FOV', () => {
    const b = emptyBank();
    expect(Object.keys(b.sets[8].map)).toHaveLength(8);
    expect(Object.keys(b.sets[6].map)).toHaveLength(6);
    expect(b.sets[8].over.image_3).toEqual({ yaw: 90, lens: 'fisheye', halfFov: 90 });
    expect(b.sets[6].map.image_0).toBe('back');
    expect(b.sets[6].over.image_3).toEqual({ yaw: 0, lens: 'wide', halfFov: 50 });
  });
  it('bank: xuất rồi nạp lại giống hệt, luôn đủ cả hai bộ; nhận dạng cũ một bộ; bỏ bộ hỏng', () => {
    const b = emptyBank();
    b.active = 6;
    b.sets[6] = setup({ count: 6, flip: true, map: { a: 'front' }, over: { a: { yaw: 30, lens: 'wide', halfFov: 60 } } });
    const out = makeCameraPreset(b);
    expect(Object.keys(out.sets)).toEqual(['6', '8']);
    expect(out.sets[8].over.image_7).toBeDefined(); // bộ 8 vẫn đủ dù chưa đụng tới
    const back = parseCameraBank(JSON.parse(JSON.stringify(out)));
    expect(back.active).toBe(6);
    expect(back.sets[6].flip).toBe(true);
    expect(back.sets[6].over.a).toEqual({ yaw: 30, lens: 'wide', halfFov: 60 });
    expect(back.sets[8]).toEqual(out.sets[8]);
    const old = parseCameraBank({ count: 6, flip: true, map: { x: 'front' }, over: {} }); // dạng cũ một bộ
    expect(old.active).toBe(6);
    expect(old.sets[6].map).toEqual({ x: 'front' });
    expect(old.sets[8]).toEqual(emptyBank().sets[8]);
    const half = parseCameraBank({ active: 8, sets: { 6: { count: 6, map: { a: 'front' } }, 8: 'hỏng' } });
    expect(half.sets[6].map).toEqual({ a: 'front' });
    expect(half.sets[8]).toEqual(emptyBank().sets[8]);
    expect(() => parseCameraBank({ count: 7 })).toThrow();
    expect(() => parseCameraBank('x')).toThrow();
  });
  it('phần camera: từ chối giá trị lạ, kẹp giá trị ngoài miền', () => {
    const p = parseCameraPreset({ count: 6, map: { x: 'left', y: 'front' }, over: { z: { yaw: 999, token: 'abc' } } });
    expect(p.map).toEqual({ y: 'front' }); // 'left' không có trong bộ 6
    expect(p.over.z).toEqual({ yaw: 180 });
    expect(() => parseCameraPreset({ count: 7 })).toThrow();
  });
  it('setting.json: xuất một phần chỉ có phần đó; nhận ra phần có mặt; camera đi theo file', () => {
    const cam = emptyBank();
    const full = { ...parseSettings(null), camera: cam };
    expect(Object.keys(pickParts(full, ['camera'])).sort()).toEqual(['camera', 'version']);
    expect(Object.keys(pickParts(full, ['rules', 'symbols'])).sort()).toEqual(['params', 'rules', 'symbols', 'version']);
    const raw = (parts: Parameters<typeof pickParts>[1]) => { const f = pickParts(full, parts); if (f.camera) (f as Record<string, unknown>).camera = makeCameraPreset(f.camera); return JSON.parse(JSON.stringify(f)); };
    expect(presentParts(raw(['camera']))).toEqual(['camera']);
    expect(presentParts(raw(ALL_PARTS))).toEqual(['rules', 'symbols', 'dynamic', 'camera']);
    expect(parseSettings(raw(['camera'])).camera).toEqual(cam);
    expect(parseSettings({ camera: { count: 5 } }).camera).toBeUndefined(); // camera hỏng bị bỏ, không ném lỗi
    expect(presentParts({ camera: { count: 5 } })).toEqual([]);
    expect(presentParts('x')).toEqual([]);
  });
  it('materializeSetup ghi đủ hướng, yaw, ống kính, FOV; giữ giá trị sửa tay; chạy lại không đổi', () => {
    const files = ['image_1.jpg', 'image_3.jpg', 'mystery.jpg'];
    const s = materializeSetup(files, setup({ over: { image_3: { yaw: 100 } } }));
    expect(s.map).toEqual({ image_1: 'front', image_3: 'left', mystery: '' });
    expect(s.over.image_1).toEqual({ yaw: 0, lens: 'wide', halfFov: 50 });
    expect(s.over.image_3).toEqual({ yaw: 100, lens: 'fisheye', halfFov: 90 }); // yaw sửa tay giữ nguyên, phần còn lại lấy theo hướng
    expect(s.over.mystery).toBeUndefined();
    expect(materializeSetup(files, s)).toEqual(s);
    // đảo trái ↔ phải không làm đổi giá trị lưu (lưu trước phép đảo)
    expect(materializeSetup(files, setup({ flip: true })).over.image_3!.yaw).toBe(90);
    // xuất rồi nạp lại vẫn đủ
    expect(s.over.image_1).toEqual({ yaw: 0, lens: 'wide', halfFov: 50 });
  });
  it('bộ 6 camera: thứ tự image_N suy từ ảnh một job thật (độ tin cậy vừa)', () => {
    const d = (n: number) => suggestDir(`image_${n}.jpg`, 6);
    expect([0, 1, 2, 3, 4, 5].map(d)).toEqual(['back', 'back-left', 'back-right', 'front', 'front-left', 'front-right']);
  });
});
