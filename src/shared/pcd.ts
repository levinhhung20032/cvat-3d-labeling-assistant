export interface PointCloud {
  count: number;
  xyz: Float32Array; // x,y,z xen kẽ
  rgb: Uint32Array | null;
}

/** Đọc PCD v0.7 nhị phân (đã thấy: FIELDS x y z rgb, SIZE 4 4 4 4, DATA binary). */
export function parsePcd(buf: ArrayBuffer, keepRgb = true): PointCloud {
  const bytes = new Uint8Array(buf);
  const head = new TextDecoder().decode(bytes.subarray(0, Math.min(bytes.length, 2048)));
  const m = /DATA\s+(\w+)\n/.exec(head);
  if (!m || m[1] !== 'binary') throw new Error('Chỉ hỗ trợ PCD binary');
  const field = (k: string) => new RegExp(`^${k}\\s+(.+)$`, 'm').exec(head)?.[1]?.trim().split(/\s+/);
  const fields = field('FIELDS');
  const sizes = field('SIZE')?.map(Number);
  const count = Number(field('POINTS')?.[0]);
  if (!fields || !sizes || !count) throw new Error('Header PCD không hợp lệ');
  const offsets: number[] = [];
  let stride = 0;
  for (const s of sizes) { offsets.push(stride); stride += s; }
  const ix = fields.indexOf('x');
  const iy = fields.indexOf('y');
  const iz = fields.indexOf('z');
  if (ix < 0 || iy < 0 || iz < 0) throw new Error('Thiếu trường x/y/z');
  const ic = keepRgb ? fields.indexOf('rgb') : -1;
  const start = m.index + m[0].length;
  if (bytes.length < start + count * stride) throw new Error('PCD bị cắt cụt');
  const dv = new DataView(buf, start);
  const xyz = new Float32Array(count * 3);
  const rgb = ic >= 0 ? new Uint32Array(count) : null;
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    xyz[i * 3] = dv.getFloat32(o + offsets[ix]!, true);
    xyz[i * 3 + 1] = dv.getFloat32(o + offsets[iy]!, true);
    xyz[i * 3 + 2] = dv.getFloat32(o + offsets[iz]!, true);
    if (rgb) rgb[i] = dv.getUint32(o + offsets[ic]!, true);
  }
  return { count, xyz, rgb };
}
