import { inflateSync } from 'fflate';

/**
 * Đọc file zip THEO LUỒNG: mỗi khi một mục (file) trong zip đã đủ dữ liệu thì gọi `onEntry`, không cần giữ cả file zip trong bộ nhớ.
 * Dùng cho chunk point cloud của CVAT (`/api/jobs/<id>/data?type=chunk`): đã xác minh trên cvat-b 2026-10-28 là zip không nén
 * (method 0), cờ 0 (kích thước ghi sẵn trong header từng mục), tên file 000000.pcd, 000001.pcd… theo thứ tự frame.
 * Không hỗ trợ mục ghi kích thước ở cuối (data descriptor, cờ bit 3) hay ZIP64 → báo lỗi để bên gọi quay về tải từng frame.
 */
export interface ZipEntry {
  name: string;
  method: number; // 0 = không nén, 8 = deflate
  data: Uint8Array; // dữ liệu như nằm trong zip (chưa giải nén nếu method 8)
  size: number; // kích thước sau giải nén
}

const LOCAL = 0x04034b50, CENTRAL = 0x02014b50, END = 0x06054b50;

export class ZipStreamReader {
  private head = new Uint8Array(64);
  private headLen = 0;
  private cur: { name: string; method: number; size: number; data: Uint8Array; filled: number } | null = null;
  private done = false;
  /** Số mục đã đọc xong. */
  count = 0;

  constructor(private onEntry: (e: ZipEntry) => void) {}

  /** Đã tới thư mục trung tâm của zip: hết các mục, phần còn lại của luồng không cần đọc. */
  get finished() { return this.done; }

  push(chunk: Uint8Array): void {
    let off = 0;
    while (off < chunk.length && !this.done) {
      const cur = this.cur;
      if (cur) {
        const k = Math.min(chunk.length - off, cur.data.length - cur.filled);
        cur.data.set(chunk.subarray(off, off + k), cur.filled);
        cur.filled += k;
        off += k;
        if (cur.filled === cur.data.length) this.finish();
        continue;
      }
      // Gom header của mục kế tiếp: 4 byte chữ ký, rồi đủ 30 byte, rồi thêm tên + trường phụ.
      off = this.fill(chunk, off, 4);
      if (this.headLen < 4) return;
      const sig = this.u32(0);
      if (sig === CENTRAL || sig === END) { this.done = true; this.headLen = 0; return; }
      if (sig !== LOCAL) throw new Error(`zip hỏng: chữ ký ${sig.toString(16)} ở mục ${this.count}`);
      off = this.fill(chunk, off, 30);
      if (this.headLen < 30) return;
      const flags = this.u16(6), method = this.u16(8), comp = this.u32(18), size = this.u32(22), nl = this.u16(26), xl = this.u16(28);
      if (flags & 8) throw new Error('zip ghi kích thước ở cuối mục (data descriptor): không đọc theo luồng được');
      if (flags & 1) throw new Error('zip có mã hoá');
      if (comp === 0xffffffff || size === 0xffffffff) throw new Error('zip ZIP64: chưa hỗ trợ');
      if (method !== 0 && method !== 8) throw new Error(`zip nén kiểu ${method}: chưa hỗ trợ`);
      off = this.fill(chunk, off, 30 + nl + xl);
      if (this.headLen < 30 + nl + xl) return;
      const name = new TextDecoder().decode(this.head.subarray(30, 30 + nl));
      this.headLen = 0;
      this.cur = { name, method, size, data: new Uint8Array(comp), filled: 0 };
      if (comp === 0) this.finish();
    }
  }

  /** Gọi khi luồng kết thúc: lỗi nếu zip bị cắt giữa chừng. */
  end(): void {
    if (this.cur || this.headLen > 0) throw new Error(`zip bị cắt cụt (sau ${this.count} mục)`);
  }

  private finish() {
    const c = this.cur!;
    this.cur = null;
    this.count++;
    this.onEntry({ name: c.name, method: c.method, data: c.data, size: c.size });
  }

  /** Chép từ chunk vào bộ đệm header cho tới khi đủ `target` byte (hoặc hết chunk); trả vị trí đọc mới. */
  private fill(chunk: Uint8Array, off: number, target: number): number {
    if (this.headLen >= target) return off;
    if (this.head.length < target) { const h = new Uint8Array(Math.max(target, this.head.length * 2)); h.set(this.head.subarray(0, this.headLen)); this.head = h; }
    const k = Math.min(target - this.headLen, chunk.length - off);
    this.head.set(chunk.subarray(off, off + k), this.headLen);
    this.headLen += k;
    return off + k;
  }
  private u16(o: number) { return this.head[o]! | (this.head[o + 1]! << 8); }
  private u32(o: number) { return (this.head[o]! | (this.head[o + 1]! << 8) | (this.head[o + 2]! << 16) | (this.head[o + 3]! << 24)) >>> 0; }
}

/** Nội dung (đã giải nén) của một mục, dạng ArrayBuffer vừa khít để chuyển (transfer) sang panel. */
export function entryBuffer(e: ZipEntry): ArrayBuffer {
  const u = e.method === 8 ? inflateSync(e.data, { out: new Uint8Array(e.size) }) : e.data;
  if (u.length !== e.size) throw new Error(`zip: ${e.name} giải nén ra ${u.length} byte, header ghi ${e.size}`);
  return u.byteOffset === 0 && u.byteLength === u.buffer.byteLength ? (u.buffer as ArrayBuffer) : (u.slice().buffer as ArrayBuffer);
}
