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

export const angDiff = (a: number, b: number) => {
  const d = Math.abs((((a - b) % 360) + 540) % 360 - 180);
  return d;
};

/** Camera xếp theo độ phù hợp: góc rộng trong vùng nhìn trước, rồi fisheye, rồi còn lại theo độ lệch. */
export function rankCameras(azimuthDeg: number, cams: CameraCfg[] = DEFAULT_CAMERAS): CameraCfg[] {
  const diff = (c: CameraCfg) => angDiff(azimuthDeg, c.yaw);
  const tier = (c: CameraCfg) => (diff(c) <= c.halfFov ? (c.lens === 'wide' ? 0 : 1) : 2);
  return [...cams].sort((a, b) => tier(a) - tier(b) || diff(a) - diff(b));
}

