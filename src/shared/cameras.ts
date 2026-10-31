export interface CameraCfg {
  index: number;
  name: string;
  yaw: number; // độ, so với hướng trước xe; +90 = trái
  lens: 'wide' | 'fisheye';
  halfFov: number; // độ, nửa vùng nhìn ngang ước lượng
}

// Ước lượng ±15° (PLAN.md); phải chỉnh được trong cấu hình.
export const DEFAULT_CAMERAS: CameraCfg[] = [
  { index: 0, name: 'sau', yaw: 180, lens: 'wide', halfFov: 50 },
  { index: 1, name: 'trước', yaw: 0, lens: 'wide', halfFov: 50 },
  { index: 2, name: 'trái trước', yaw: 45, lens: 'wide', halfFov: 50 },
  { index: 3, name: 'trái', yaw: 90, lens: 'fisheye', halfFov: 90 },
  { index: 4, name: 'trái sau', yaw: 110, lens: 'fisheye', halfFov: 90 },
  { index: 5, name: 'phải trước', yaw: -45, lens: 'wide', halfFov: 50 },
  { index: 6, name: 'phải', yaw: -90, lens: 'fisheye', halfFov: 90 },
  { index: 7, name: 'phải sau', yaw: -110, lens: 'fisheye', halfFov: 90 },
];

// ---- Ánh xạ tên camera trong job ↔ camera theo hướng (2026-10-29) ----
// Tên file ảnh trong job có thể khác image_N. Người dùng chọn bộ 6 hoặc 8 camera, gán từng file vào một hướng; góc nhìn (yaw, ống kính, nửa FOV)
// được TỰ ĐỀ XUẤT theo hướng và bộ camera đã chọn, vẫn sửa tay được. Các góc đều là ước lượng ±15°.

export type CamCount = 6 | 8;

export interface CamDir {
  id: string;
  name: string;
  yaw: number;
  lens: 'wide' | 'fisheye';
  halfFov: number;
}

/** Bộ 8 camera: giống DEFAULT_CAMERAS (PLAN.md). */
const DIRS_8: CamDir[] = [
  { id: 'back', name: 'sau', yaw: 180, lens: 'wide', halfFov: 50 },
  { id: 'front', name: 'trước', yaw: 0, lens: 'wide', halfFov: 50 },
  { id: 'front-left', name: 'trái trước', yaw: 45, lens: 'wide', halfFov: 50 },
  { id: 'left', name: 'trái', yaw: 90, lens: 'fisheye', halfFov: 90 },
  { id: 'back-left', name: 'trái sau', yaw: 110, lens: 'fisheye', halfFov: 90 },
  { id: 'front-right', name: 'phải trước', yaw: -45, lens: 'wide', halfFov: 50 },
  { id: 'right', name: 'phải', yaw: -90, lens: 'fisheye', halfFov: 90 },
  { id: 'back-right', name: 'phải sau', yaw: -110, lens: 'fisheye', halfFov: 90 },
];

/** Bộ 6 camera: không có camera ngang thân, mỗi bên một camera trước và một camera sau (cùng ống kính góc rộng). */
const DIRS_6: CamDir[] = [
  { id: 'front', name: 'trước', yaw: 0, lens: 'wide', halfFov: 50 },
  { id: 'front-left', name: 'trái trước', yaw: 55, lens: 'wide', halfFov: 55 },
  { id: 'back-left', name: 'trái sau', yaw: 125, lens: 'wide', halfFov: 55 },
  { id: 'back', name: 'sau', yaw: 180, lens: 'wide', halfFov: 50 },
  { id: 'back-right', name: 'phải sau', yaw: -125, lens: 'wide', halfFov: 55 },
  { id: 'front-right', name: 'phải trước', yaw: -55, lens: 'wide', halfFov: 55 },
];

export const camDirs = (count: CamCount): CamDir[] => (count === 6 ? DIRS_6 : DIRS_8);
export const UNMAPPED = '';

/** Gán mặc định theo số thứ tự file (image_0 … image_N-1) trong từng bộ. */
const DEFAULT_ORDER: Record<CamCount, string[]> = {
  8: DIRS_8.map((d) => d.id),
  // Suy từ ảnh một job thật (2026-10-29), độ tin cậy vừa: camera trái thấy thân xe ở mép trái ảnh, camera phải ở mép phải (quy luật
  // rút ra từ bảng 8 camera của PLAN.md); trước / sau suy từ giao thông đi bên phải (dải phân cách bên trái xe). Sai thì gán lại ở tab Camera.
  6: ['back', 'back-left', 'back-right', 'front', 'front-left', 'front-right'],
};

export interface CamOverride { yaw?: number; halfFov?: number; lens?: 'wide' | 'fisheye' }
export interface CameraSetup {
  count: CamCount;
  /** khóa file ảnh (tên không phần mở rộng, chữ thường) → id hướng, '' = chưa gán / bỏ qua */
  map: Record<string, string>;
  /** sửa tay góc nhìn theo khóa file; không có thì dùng đề xuất theo hướng */
  over: Record<string, CamOverride>;
  /** đảo trái ↔ phải khi camera của job bị lật so với bảng hướng (đổi dấu mọi yaw) */
  flip: boolean;
}
export const DEFAULT_SETUP: CameraSetup = { count: 8, map: {}, over: {}, flip: false };

/**
 * Yaw lưu / tính theo hệ ego (+ = trái, Oy hướng trái). Giao diện nhập theo la bàn: + = phải (cùng chiều kim đồng hồ nhìn từ trên), − = trái.
 * Hai hàm này là chỗ DUY NHẤT đổi dấu giữa giao diện và nội bộ.
 */
export const yawToUi = (yaw: number) => (yaw === 0 ? 0 : -yaw);
export const yawFromUi = (ui: number) => (ui === 0 ? 0 : -ui);

/** Hai bộ cấu hình cùng lưu (6 và 8 camera), `active` là bộ đang dùng. Chuyển bộ không làm mất cấu hình của bộ kia. */
export interface CameraBank { active: CamCount; sets: Record<CamCount, CameraSetup> }
/** Cấu hình mặc định của tool: cả hai bộ ghi đầy đủ hướng, yaw, ống kính, nửa FOV cho image_0 … image_N-1 (xem DIRS_6 / DIRS_8 / DEFAULT_ORDER). */
export const defaultSetup = (count: CamCount): CameraSetup =>
  materializeSetup(Array.from({ length: count }, (_, i) => `image_${i}.jpg`), { ...DEFAULT_SETUP, count, map: {}, over: {} });
export const emptyBank = (): CameraBank => ({ active: 8, sets: { 6: defaultSetup(6), 8: defaultSetup(8) } });

/** Đọc một bộ cấu hình: kiểm tra chặt từng trường, trường lạ bị bỏ; sai định dạng thì ném lỗi. */
export function parseCameraPreset(raw: unknown): CameraSetup {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('Phần camera không hợp lệ.');
  if (r.count !== 6 && r.count !== 8) throw new Error('Số camera phải là 6 hoặc 8.');
  const ids = new Set(camDirs(r.count).map((d) => d.id));
  const map: Record<string, string> = {};
  for (const [k, v] of Object.entries((r.map ?? {}) as Record<string, unknown>)) if (typeof v === 'string' && (v === UNMAPPED || ids.has(v))) map[k] = v;
  const over: Record<string, CamOverride> = {};
  for (const [k, v] of Object.entries((r.over ?? {}) as Record<string, Record<string, unknown>>)) {
    const o: CamOverride = {};
    if (typeof v?.yaw === 'number' && Number.isFinite(v.yaw)) o.yaw = Math.max(-180, Math.min(180, v.yaw));
    if (typeof v?.halfFov === 'number' && Number.isFinite(v.halfFov)) o.halfFov = Math.max(10, Math.min(120, v.halfFov));
    if (v?.lens === 'wide' || v?.lens === 'fisheye') o.lens = v.lens;
    over[k] = o;
  }
  return { count: r.count, flip: r.flip === true, map, over };
}

/**
 * Đọc phần camera của `setting.json`: dạng mới `{ active, sets: { "6": …, "8": … } }` hoặc dạng cũ một bộ `{ count, flip, map, over }`
 * (đưa vào đúng bộ của nó). Bộ nào hỏng thì bỏ, bộ còn lại vẫn nạp; không có bộ nào hợp lệ thì ném lỗi.
 */
export function parseCameraBank(raw: unknown): CameraBank {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== 'object' || Array.isArray(r)) throw new Error('Phần camera không hợp lệ.');
  const bank = emptyBank();
  let found = 0;
  if (r.sets && typeof r.sets === 'object') {
    for (const n of [6, 8] as const) {
      const one = (r.sets as Record<string, unknown>)[String(n)];
      if (!one || typeof one !== 'object' || Array.isArray(one)) continue; // bộ thiếu / hỏng: giữ mặc định
      try { bank.sets[n] = parseCameraPreset({ ...one, count: n }); found++; } catch { /* bộ hỏng: bỏ */ }
    }
    if (r.active === 6 || r.active === 8) bank.active = r.active;
  } else {
    const one = parseCameraPreset(r);
    bank.sets[one.count] = one; bank.active = one.count; found++;
  }
  if (!found) throw new Error('Không có bộ camera hợp lệ.');
  return bank;
}

/**
 * Phần camera để xuất: LUÔN đủ cả hai bộ (6 và 8 camera) với hướng, yaw, ống kính, nửa FOV đầy đủ. Bộ chưa từng cấu hình
 * được điền theo đề xuất mặc định (image_0 … image_N-1).
 */
export function makeCameraPreset(b: CameraBank) {
  const full = (n: CamCount) => {
    const s = b.sets[n];
    return materializeSetup(Array.from({ length: n }, (_, i) => `image_${i}.jpg`), s);
  };
  return { active: b.active, sets: { 6: full(6), 8: full(8) } };
}

/**
 * Ghi ĐẦY ĐỦ hướng, yaw, ống kính và nửa FOV của từng camera vào cấu hình (không chỉ phần sửa tay), để `setting.json` mang theo đúng
 * giá trị đang dùng chứ không phụ thuộc bảng đề xuất mặc định. Giá trị đã có (do người dùng sửa) giữ nguyên; camera chưa gán hướng chỉ ghi hướng rỗng.
 * Yaw lưu trước phép đảo trái ↔ phải (cùng nghĩa với `over.yaw`).
 */
export function materializeSetup(files: string[], setup: CameraSetup): CameraSetup {
  const map = { ...setup.map };
  const over = { ...setup.over };
  for (const c of buildCameras(files, setup)) {
    map[c.key] = c.dir;
    if (!c.dir) continue;
    const d = camDirs(setup.count).find((x) => x.id === c.dir)!;
    const o = setup.over[c.key] ?? {};
    over[c.key] = { yaw: o.yaw ?? d.yaw, lens: o.lens ?? d.lens, halfFov: o.halfFov ?? d.halfFov };
  }
  return { ...setup, map, over };
}

export const camKey = (file: string) => (file.split('/').pop() ?? file).replace(/\.[^.]+$/, '').toLowerCase();

/** Đoán hướng của một file từ tên (front/back/left/right…) hoặc số thứ tự (image_N). Không đoán được → '' (người dùng gán tay). */
export function suggestDir(file: string, count: CamCount): string {
  const k = camKey(file);
  const ids = camDirs(count).map((d) => d.id);
  const has = (re: RegExp) => re.test(k);
  const front = has(/front|fwd|forward|truoc|trước/), back = has(/back|rear|sau/);
  const left = has(/left|trai|trái/), right = has(/right|phai|phải/);
  const cand = back && left ? 'back-left' : back && right ? 'back-right' : front && left ? 'front-left' : front && right ? 'front-right'
    : front ? 'front' : back ? 'back' : left ? (count === 8 ? 'left' : 'front-left') : right ? (count === 8 ? 'right' : 'front-right') : '';
  if (cand && ids.includes(cand)) return cand;
  const m = /(\d+)$/.exec(k);
  if (m) return DEFAULT_ORDER[count][Number(m[1])] ?? '';
  return '';
}

export interface MappedCamera extends CameraCfg { key: string; dir: string; suggested: boolean }

/** Camera của các file trong frame: hướng do người dùng gán (hoặc đề xuất), góc nhìn = đề xuất theo hướng + sửa tay. */
export function buildCameras(files: string[], setup: CameraSetup): MappedCamera[] {
  const dirs = camDirs(setup.count);
  return files.map((file, index) => {
    const key = camKey(file);
    const picked = setup.map[key];
    const dir = picked !== undefined ? picked : suggestDir(file, setup.count);
    const d = dirs.find((x) => x.id === dir);
    const o = setup.over[key] ?? {};
    return {
      index, key, dir, suggested: picked === undefined,
      name: d?.name ?? file,
      yaw: ((o.yaw ?? d?.yaw ?? 0) * (setup.flip ? -1 : 1)) || 0,
      lens: o.lens ?? d?.lens ?? 'wide',
      halfFov: o.halfFov ?? d?.halfFov ?? 0, // chưa gán hướng → không vùng nhìn nào khớp, xếp cuối
    };
  });
}

export const angDiff =(a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
};

/** Camera xếp theo độ phù hợp: góc rộng trong vùng nhìn trước, rồi fisheye, rồi còn lại theo độ lệch. */
export function rankCameras<C extends CameraCfg = CameraCfg>(azimuthDeg: number, cams: C[] = DEFAULT_CAMERAS as C[]): C[] {
  const diff = (c: C) => angDiff(azimuthDeg, c.yaw);
  const tier = (c: C) => (c.halfFov <= 0 ? 3 : diff(c) <= c.halfFov ?(c.lens === 'wide' ? 0 : 1) : 2);
  return [...cams].sort((a, b) => tier(a) - tier(b) || diff(a) - diff(b));
}

