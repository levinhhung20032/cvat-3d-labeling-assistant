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
  const xyz = new Float32Array(count * 3);
  const rgb = ic >= 0 ? new Uint32Array(count) : null;
  // Đường nhanh: dữ liệu little-endian căn hàng 4 byte (máy x86/ARM) ⇒ đọc thẳng bằng Float32Array, không qua DataView từng điểm.
  const littleEndian = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  if (littleEndian && !rgb && start % 4 === 0 && stride % 4 === 0 && sizes[ix] === 4 && sizes[iy] === 4 && sizes[iz] === 4) {
    const f32 = new Float32Array(buf, start, (count * stride) / 4);
    const w = stride / 4, ox = offsets[ix]! / 4, oy = offsets[iy]! / 4, oz = offsets[iz]! / 4;
    for (let i = 0, j = 0; i < count; i++, j += w) { xyz[i * 3] = f32[j + ox]!; xyz[i * 3 + 1] = f32[j + oy]!; xyz[i * 3 + 2] = f32[j + oz]!; }
    return { count, xyz, rgb };
  }
  const dv = new DataView(buf, start);
  for (let i = 0; i < count; i++) {
    const o = i * stride;
    xyz[i * 3] = dv.getFloat32(o + offsets[ix]!, true);
    xyz[i * 3 + 1] = dv.getFloat32(o + offsets[iy]!, true);
    xyz[i * 3 + 2] = dv.getFloat32(o + offsets[iz]!, true);
    if (rgb) rgb[i] = dv.getUint32(o + offsets[ic]!, true);
  }
  return { count, xyz, rgb };
}
