import { describe, expect, it } from 'vitest';
import { strToU8, Zip, ZipPassThrough, zipSync } from 'fflate';
import { entryBuffer, ZipStreamReader, type ZipEntry } from '../src/shared/zipStream';
import { CvatClient } from '../src/content/cvatClient';

/** Zip giống chunk point cloud của CVAT (đã xem trên cvat-b): không nén, tên 000000.pcd, 000001.pcd… */
const frames = (n: number) => Array.from({ length: n }, (_, i) => {
  const u = new Uint8Array(1000 + i * 37);
  for (let j = 0; j < u.length; j++) u[j] = (i * 31 + j) & 255;
  return u;
});
const chunkZip = (data: Uint8Array[], level: 0 | 6 = 0) =>
  zipSync(Object.fromEntries(data.map((d, i) => [`${String(i).padStart(6, '0')}.pcd`, [d, { level }]])));

/** Đưa zip vào bộ đọc theo từng mẩu `step` byte (mô phỏng mạng trả về từng đoạn). */
function readAll(zip: Uint8Array, step: number): ZipEntry[] {
  const out: ZipEntry[] = [];
  const r = new ZipStreamReader((e) => out.push(e));
  for (let o = 0; o < zip.length && !r.finished; o += step) r.push(zip.subarray(o, o + step));
  r.end();
  return out;
}

describe('đọc zip theo luồng (chunk point cloud)', () => {
  const data = frames(5);
  const zip = chunkZip(data);
  for (const step of [1, 7, 30, 1000, 1 << 20]) {
    it(`mẩu ${step} byte: đủ 5 file, đúng tên, đúng thứ tự, đúng từng byte`, () => {
      const got = readAll(zip, step);
      expect(got.map((e) => e.name)).toEqual(['000000.pcd', '000001.pcd', '000002.pcd', '000003.pcd', '000004.pcd']);
      got.forEach((e, i) => expect(new Uint8Array(entryBuffer(e))).toEqual(data[i]));
    });
  }
  it('mục nén deflate cũng đọc được (giải nén đúng)', () => {
    const got = readAll(chunkZip(data, 6), 4096);
    expect(got.every((e) => e.method === 8)).toBe(true);
    got.forEach((e, i) => expect(new Uint8Array(entryBuffer(e))).toEqual(data[i]));
  });
  it('buffer chuyển sang panel vừa khít (không kéo theo dữ liệu thừa)', () => {
    const buf = entryBuffer(readAll(zip, 64)[2]!);
    expect(buf.byteLength).toBe(data[2]!.length);
  });
  it('zip bị cắt giữa chừng → lỗi', () => {
    const r = new ZipStreamReader(() => {});
    r.push(zip.subarray(0, zip.length >> 1));
    expect(() => r.end()).toThrow(/cắt cụt/);
  });
  it('zip ghi kích thước ở cuối mục (data descriptor) → lỗi, không đọc sai', () => {
    const parts: Uint8Array[] = [];
    const z = new Zip((_e, d) => { if (d) parts.push(d); });
    const f = new ZipPassThrough('000000.pcd');
    z.add(f);
    f.push(strToU8('abc'), true);
    z.end();
    const all = new Uint8Array(parts.reduce((a, p) => a + p.length, 0));
    let o = 0;
    for (const p of parts) { all.set(p, o); o += p.length; }
    expect(() => new ZipStreamReader(() => {}).push(all)).toThrow(/data descriptor/);
  });
  it('không phải zip → lỗi', () => {
    expect(() => new ZipStreamReader(() => {}).push(strToU8('<html>error</html>'))).toThrow(/zip hỏng/);
  });
});

/** Response giả có thân là luồng, trả zip theo từng mẩu. */
const streamResponse = (bytes: Uint8Array, step = 777, status = 200) =>
  new Response(new ReadableStream<Uint8Array>({
    start(c) { for (let o = 0; o < bytes.length; o += step) c.enqueue(bytes.slice(o, o + step)); c.close(); },
  }), { status });

describe('CvatClient: tải chunk theo luồng và kiểm chứng đánh số', () => {
  const data = frames(4);
  const zip = chunkZip(data);
  const mk = (onUrl: (u: URL) => Response) => {
    const urls: string[] = [];
    const client = new CvatClient({
      origin: 'https://cvat.test', sleep: async () => {},
      fetchImpl: async (input) => { const u = new URL(String(input)); urls.push(u.search); return onUrl(u); },
    });
    return { client, urls };
  };
  const serve = (u: URL, frameData = data) => (u.searchParams.get('type') === 'chunk'
    ? streamResponse(zip)
    : new Response(frameData[Number(u.searchParams.get('number')) - 100]!.slice()));

  it('đọc đủ file theo thứ tự, đối chiếu frame đầu, dùng index theo job', async () => {
    const { client, urls } = mk((u) => serve(u));
    const got: number[] = [];
    const n = await client.streamChunkChecked(7, 0, 100, 4, (i, buf) => { expect(new Uint8Array(buf)).toEqual(data[i]); got.push(i); });
    expect(n).toBe(4);
    expect(got).toEqual([0, 1, 2, 3]);
    expect(urls.some((s) => s.includes('type=chunk') && s.includes('index=0') && s.includes('quality=original'))).toBe(true);
    expect(urls.some((s) => s.includes('type=frame') && s.includes('number=100'))).toBe(true);
  });
  it('file đầu không trùng frame đối chiếu → lỗi, không gửi frame nào', async () => {
    const shifted = [data[1]!, data[2]!, data[3]!, data[0]!];
    const { client } = mk((u) => serve(u, shifted));
    const got: number[] = [];
    await expect(client.streamChunkChecked(7, 0, 100, 4, (i) => got.push(i))).rejects.toThrow(/không trùng frame 100/);
    expect(got).toEqual([]);
  });
  it('số file khác dự kiến → lỗi', async () => {
    const { client } = mk((u) => serve(u));
    await expect(client.streamChunkChecked(7, 0, 100, 5, () => {})).rejects.toThrow(/dự kiến 5/);
    await expect(client.streamChunkChecked(7, 0, 100, 3, () => {})).rejects.toThrow(/nhiều hơn 3/);
  });
  it('máy chủ đang dựng chunk (503) → chờ rồi thử lại', async () => {
    let calls = 0;
    const { client } = mk((u) => (u.searchParams.get('type') === 'chunk' && ++calls <= 2 ? new Response('', { status: 503 }) : serve(u)));
    expect(await client.streamChunkChecked(7, 0, 100, 4, () => {})).toBe(4);
    expect(calls).toBe(3);
  });
  it('lỗi không phải "bận" (vd 400: máy chủ không hiểu index) → báo lỗi ngay để quay về tải từng frame', async () => {
    let calls = 0;
    const { client } = mk((u) => (u.searchParams.get('type') === 'chunk' ? (calls++, new Response('', { status: 400 })) : serve(u)));
    await expect(client.streamChunkChecked(7, 0, 100, 4, () => {})).rejects.toThrow(/400/);
    expect(calls).toBe(1);
  });
  it('cỡ chunk: lấy data_chunk_size của job, không có thì đọc meta', async () => {
    const { client } = mk((u) => (u.pathname.endsWith('/data/meta') ? new Response(JSON.stringify({ chunk_size: 72 })) : new Response('', { status: 404 })));
    expect(await client.getChunkSize({ id: 1, task_id: 1, start_frame: 0, stop_frame: 9, data_chunk_size: 36 })).toBe(36);
    expect(await client.getChunkSize({ id: 1, task_id: 1, start_frame: 0, stop_frame: 9 })).toBe(72);
  });
});
