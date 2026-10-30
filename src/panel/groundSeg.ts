import type { Cuboid } from '../shared/cuboid';
import { getEgo, transform, type EgoMotion } from '../shared/ego';
import { DEFAULT_GROUND } from '../shared/ground';
import type { PointCloud } from '../shared/pcd';
import { DEFAULT_PATCHWORK, Patchwork, PW_GROUND, type PwResult } from '../shared/patchwork';

/**
 * Phân tách mặt đất (Patchwork++) theo frame, tính khi cần rồi nhớ theo point cloud. Một bộ `Patchwork` cho mỗi job (ngưỡng cao / phẳng
 * học dần qua các frame như bản gốc nên kết quả hơi phụ thuộc thứ tự frame được xét); đổi job hoặc đổi tham số thì bỏ hết và học lại.
 */
let engine: Patchwork | null = null;
let cache = new WeakMap<PointCloud, PwResult>();
let sig = '';

let forced = false;
/** Bắt buộc phân tách dù G.pw tắt (tô mặt đất, bảng so sánh). */
export function setSegForced(v: boolean) { forced = v; }

const signature = () => JSON.stringify(DEFAULT_PATCHWORK); // đổi G.pw (0↔1↔2) không cần tính lại: kết quả phân tách không đổi

/** Bỏ kết quả và ngưỡng đã học (đổi job). */
export function resetGroundSeg() { engine = null; cache = new WeakMap(); sig = ''; }

/** Kết quả phân tách của frame; null khi tính năng tắt (G.pw = 0 và không bị bắt buộc). */
export function segOf(pc: PointCloud): PwResult | null {
  if (DEFAULT_GROUND.pw <= 0 && !forced) return null;
  const s = signature();
  if (s !== sig) { engine = null; cache = new WeakMap(); sig = s; }
  const hit = cache.get(pc);
  if (hit) return hit;
  engine ??= new Patchwork({ ...DEFAULT_PATCHWORK });
  const res = engine.estimate(pc.xyz, pc.count, pc.intensity);
  cache.set(pc, res);
  return res;
}

/**
 * Gộp điểm mặt đất của các frame lân cận (±K) quanh vị trí của object: xe chạy nên vật ở xa ở frame này thường được thấy gần hơn (nhiều
 * điểm hơn) ở frame sau. Điểm mặt đất (nhãn Patchwork++) của frame g trong bán kính `radius` quanh vị trí object được đưa về hệ của frame f
 * bằng chuyển động xe đã ước lượng từ các box (ego.ts, chỉ x / y / yaw; z coi như không đổi: gốc toạ độ luôn nằm trên mặt đường), rồi viết
 * trong hệ của box tại frame f (u theo yaw, w so với tâm box). Lưới ô 5 m trên điểm mặt đất của từng frame để không quét cả 300k điểm.
 */
const CELL = 5;
const cellKey = (ix: number, iy: number) => (ix + 4096) * 8192 + (iy + 4096);
const grids = new WeakMap<PwResult, Map<number, number[]>>();
function gridOf(pc: PointCloud, seg: PwResult): Map<number, number[]> {
  let g = grids.get(seg);
  if (g) return g;
  g = new Map();
  for (let i = 0; i < pc.count; i++) {
    if (seg.label[i] !== PW_GROUND) continue;
    const k = cellKey(Math.floor(pc.xyz[i * 3]! / CELL), Math.floor(pc.xyz[i * 3 + 1]! / CELL));
    let a = g.get(k);
    if (!a) { a = []; g.set(k, a); }
    a.push(i);
  }
  grids.set(seg, g);
  return g;
}

export interface PoolFrame { pc: PointCloud; seg: PwResult }
/** Nơi lấy point cloud đã tải theo số frame (đặt từ giao diện, để tệp này không phụ thuộc kho tải / trình duyệt). */
let peekCloud: (g: number) => PointCloud | undefined = () => undefined;
export function setPoolSource(fn: (g: number) => PointCloud | undefined) { peekCloud = fn; }
/** Nguồn mặc định: point cloud đã tải + kết quả phân tách (null nếu frame chưa tải). */
const defaultFrame = (g: number): PoolFrame | null => {
  const pc = peekCloud(g);
  const seg = pc ? segOf(pc) : null;
  return pc && seg ? { pc, seg } : null;
};

export function pooledGround(
  f: number, c: Pick<Cuboid, 'x' | 'y' | 'z' | 'yaw'>, K: number, radius: number,
  ego: EgoMotion | null = getEgo(), frameOf: (g: number) => PoolFrame | null = defaultFrame,
): { u: Float32Array; v: Float32Array; w: Float32Array; n: number } | null {
  if (!ego || K <= 0) return null;
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  const us: number[] = [], vs: number[] = [], ws: number[] = [];
  const r2 = radius * radius;
  for (let g = f - K; g <= f + K; g++) {
    if (g === f) continue;
    const fr = frameOf(g);
    if (!fr) continue;
    const o = transform(ego, c.x, c.y, 0, f, g); // vị trí object trong hệ của frame g
    const t0 = transform(ego, 0, 0, 0, g, f), t1 = transform(ego, 1, 0, 0, g, f); // g → f: p_f = R·p_g + t
    if (!o || !t0 || !t1) continue;
    const rc = t1.x - t0.x, rs = t1.y - t0.y;
    const grid = gridOf(fr.pc, fr.seg);
    const xyz = fr.pc.xyz;
    for (let ix = Math.floor((o.x - radius) / CELL); ix <= Math.floor((o.x + radius) / CELL); ix++) {
      for (let iy = Math.floor((o.y - radius) / CELL); iy <= Math.floor((o.y + radius) / CELL); iy++) {
        const cell = grid.get(cellKey(ix, iy));
        if (!cell) continue;
        for (const i of cell) {
          const x = xyz[i * 3]!, y = xyz[i * 3 + 1]!;
          if ((x - o.x) ** 2 + (y - o.y) ** 2 > r2) continue;
          const dx = rc * x - rs * y + t0.x - c.x, dy = rs * x + rc * y + t0.y - c.y;
          us.push(dx * cs + dy * sn); vs.push(-dx * sn + dy * cs); ws.push(xyz[i * 3 + 2]! - c.z);
        }
      }
    }
  }
  return us.length ? { u: Float32Array.from(us), v: Float32Array.from(vs), w: Float32Array.from(ws), n: us.length } : null;
}

/** Mặt đường quanh object trong hệ của box (w = a·u + b·v + c, gốc ở tâm box, u theo yaw); null nếu không có ô mặt đất nào đủ gần. */
export function roadOf(seg: PwResult | null, c: Pick<Cuboid, 'x' | 'y' | 'z' | 'yaw'>): { a: number; b: number; c: number; rms: number; n: number } | null {
  const r = seg?.road(c.x, c.y, DEFAULT_GROUND.pwRadius, Math.tan((DEFAULT_GROUND.maxSlopeDeg * Math.PI) / 180));
  if (!r) return null;
  const cs = Math.cos(c.yaw), sn = Math.sin(c.yaw);
  return { a: r.a * cs + r.b * sn, b: -r.a * sn + r.b * cs, c: r.a * c.x + r.b * c.y + r.c - c.z, rms: r.rms, n: r.n };
}

/** Độ cao (w, so với tâm box) của mặt đất Patchwork++ dưới tâm box; null nếu không có. */
export function pwWOf(seg: PwResult | null, c: Pick<Cuboid, 'x' | 'y' | 'z'>): number | null {
  const h = seg?.heightAt(c.x, c.y);
  return h === null || h === undefined ? null : h - c.z;
}
