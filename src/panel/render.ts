import type { Cuboid } from '../shared/cuboid';
import { handleOffset, type LocalBox, type View } from '../shared/edit';
import type { Status } from '../shared/interp';
import type { PointCloud } from '../shared/pcd';

export type { View };

/** Điểm trong hệ tọa độ của object: u dọc hướng box, v sang trái, w lên. */
export interface Local { u: Float32Array; v: Float32Array; w: Float32Array; n: number }

export function localize(pc: PointCloud, c: Cuboid, half: number): Local {
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
  const u = new Float32Array(pc.count), v = new Float32Array(pc.count), w = new Float32Array(pc.count);
  let n = 0;
  const p = pc.xyz;
  for (let i = 0; i < pc.count; i++) {
    const dx = p[i * 3]! - c.x;
    if (dx > half * 1.5 || dx < -half * 1.5) continue;
    const dy = p[i * 3 + 1]! - c.y;
    if (dy > half * 1.5 || dy < -half * 1.5) continue;
    const dz = p[i * 3 + 2]! - c.z;
    if (dz > half || dz < -half) continue;
    const a = dx * cos + dy * sin;
    const b = -dx * sin + dy * cos;
    if (a > half || a < -half || b > half || b < -half) continue;
    u[n] = a; v[n] = b; w[n] = dz; n++;
  }
  return { u, v, w, n };
}

export const STATUS_COLOR: Record<Status, string> = {
  key: '#22c55e', interp: '#38bdf8', hold: '#f59e0b',
  'outside-key': '#ef4444', outside: '#ef4444', none: '#9ca3af',
};

const BUCKETS = 8;
const PALETTE = Array.from({ length: BUCKETS }, (_, i) => `hsl(${220 - (i * 200) / (BUCKETS - 1)} 80% 55%)`);

/** Chiếu điểm (u, v, w) của object lên ô. */
const project = (view: View, u: number, v: number, w: number, k: number, c: number): [number, number] =>
  view === 'top' ? [c - v * k, c - u * k] : view === 'side' ? [c + u * k, c - w * k] : [c + v * k, c - w * k];

/** Thông số cảnh KHÔNG phụ thuộc mức zoom (để phóng to / thu nhỏ chỉ đổi khung nhìn, không đổi tập điểm được vẽ). */
export interface Scene { zClip: number; slab: number; colorHalf: number }

/**
 * Điểm có được vẽ ở khung nhìn nửa-rộng `half` không. Hai trục lên màn hình chỉ bị cắt theo khung (đổi theo zoom — vùng nhìn
 * lớn hơn thì thấy thêm điểm ở rìa, đúng như kỳ vọng); trục còn lại dùng ngưỡng cố định của `scene`, nên cùng một vùng
 * nhìn thấy cùng một tập điểm ở mọi mức zoom.
 */
export function pointVisible(view: View, u: number, v: number, w: number, half: number, scene: Scene): boolean {
  if (view === 'top') return Math.abs(u) <= half && Math.abs(v) <= half && Math.abs(w) <= scene.zClip;
  if (view === 'side') return Math.abs(u) <= half && Math.abs(w) <= half && Math.abs(v) <= scene.slab;
  return Math.abs(v) <= half && Math.abs(w) <= half && Math.abs(u) <= scene.slab;
}

export function drawView(
  ctx: CanvasRenderingContext2D, size: number, view: View, loc: Local | null,
  box: LocalBox | null, half: number, status: Status, active = false, misfit = false, ghost: LocalBox | null = null, ground: number | null = null, mark: { u: number; v: number; w: number } | null = null,
  scene: Scene = { zClip: half, slab: half * 0.5, colorHalf: half },
) {
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, size, size);
  const k = size / (2 * half), c = size / 2;
  const dot = Math.max(1.5, size / 110);
  if (loc) {
    const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
    const shell: number[] = [];
    for (let i = 0; i < loc.n; i++) {
      // loc được lọc ở phạm vi lớn nhất. Hai trục lên màn hình chỉ bị cắt theo khung nhìn (zoom); trục còn lại
      // (độ cao ở view Trên, bề dày lát cắt ở view Bên / Trước) dùng ngưỡng CỐ ĐỊNH theo object, không đổi theo zoom.
      const lu = loc.u[i]!, lv = loc.v[i]!, lw = loc.w[i]!;
      if (!pointVisible(view, lu, lv, lw, half, scene)) continue;
      if (misfit && box && box.dyaw === 0) {
        // điểm nằm ngay sát ngoài box (trừ lớp sát đáy) → tô hồng để so sánh với box
        const du = Math.abs(loc.u[i]! - box.cu) - box.sx / 2, dv = Math.abs(loc.v[i]! - box.cv) - box.sy / 2;
        const dw = loc.w[i]! - box.cw - box.sz / 2;
        if ((du > 0 || dv > 0 || dw > 0) && du < 0.6 && dv < 0.6 && dw < 0.6 && loc.w[i]! - box.cw > -box.sz / 2 + 0.2) { shell.push(i); continue; }
      }
      const t = (lw + scene.colorHalf) / (2 * scene.colorHalf); // thang màu theo độ cao, không đổi theo zoom
      buckets[Math.min(BUCKETS - 1, Math.max(0, Math.floor(t * BUCKETS)))]!.push(i);
    }
    buckets.push(shell); // nhóm cuối: điểm lọt ra ngoài box
    buckets.forEach((idx, b) => {
      ctx.fillStyle = b === BUCKETS ? '#ff2bd6' : PALETTE[b]!;
      for (const i of idx) {
        const [x, y] = project(view, loc.u[i]!, loc.v[i]!, loc.w[i]!, k, c);
        ctx.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }
    });
  }
  if (mark) {
    // vị trí DỰ ĐOÁN từ chuyển động các frame trước (dấu × cam, nối bằng nét đứt tới tâm box) để thấy box đã đi xa bao nhiêu
    const [mx, my] = project(view, mark.u, mark.v, mark.w, k, c);
    ctx.save();
    ctx.strokeStyle = '#ff9f1a';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.moveTo(c, c); ctx.lineTo(mx, my); ctx.stroke();
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.moveTo(mx - 6, my - 6); ctx.lineTo(mx + 6, my + 6); ctx.moveTo(mx - 6, my + 6); ctx.lineTo(mx + 6, my - 6);
    ctx.stroke();
    ctx.restore();
  }
  if (ground !== null && view !== 'top') {
    // mặt đường ước lượng (xanh lá nét đứt) để so với đáy box
    const gy = c - ground * k;
    ctx.save();
    ctx.strokeStyle = '#7cfc00';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 4]);
    ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(size, gy); ctx.stroke();
    ctx.restore();
  }
  if (!box) return;

  // 8 đỉnh của box (đã xoay dyaw quanh tâm) rồi nối 12 cạnh.
  const cos = Math.cos(box.dyaw), sin = Math.sin(box.dyaw);
  const pt = (a: number, b: number, w: number) =>
    project(view, box.cu + a * cos - b * sin, box.cv + a * sin + b * cos, box.cw + w, k, c);
  const hu = box.sx / 2, hv = box.sy / 2, hw = box.sz / 2;
  const corner = (i: number) => pt(i & 1 ? hu : -hu, i & 2 ? hv : -hv, i & 4 ? hw : -hw);
  ctx.strokeStyle = STATUS_COLOR[status];
  ctx.lineWidth = active ? 2.5 : 2;
  ctx.beginPath();
  for (let i = 0; i < 8; i++) {
    for (const bit of [1, 2, 4]) {
      if (i & bit) continue;
      const [x1, y1] = corner(i), [x2, y2] = corner(i | bit);
      ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
    }
  }
  ctx.stroke();

  if (ghost) {
    // box gợi ý: nét đứt xanh lơ
    const gc = Math.cos(ghost.dyaw), gs = Math.sin(ghost.dyaw);
    const gp = (a: number, b: number, w: number) =>
      project(view, ghost.cu + a * gc - b * gs, ghost.cv + a * gs + b * gc, ghost.cw + w, k, c);
    const gu = ghost.sx / 2, gv = ghost.sy / 2, gw = ghost.sz / 2;
    const gcorner = (i: number) => gp(i & 1 ? gu : -gu, i & 2 ? gv : -gv, i & 4 ? gw : -gw);
    ctx.save();
    ctx.strokeStyle = '#00e5ff';
    ctx.lineWidth = 2;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      for (const bit of [1, 2, 4]) {
        if (i & bit) continue;
        const [x1, y1] = gcorner(i), [x2, y2] = gcorner(i | bit);
        ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  // Mũi tên đỏ chỉ hướng box (+u); trên view Trên, đầu mũi tên là tay nắm xoay.
  ctx.strokeStyle = ctx.fillStyle = '#ff2d2d';
  ctx.lineWidth = 2;
  const [cx, cy] = pt(0, 0, 0);
  if (view === 'front') {
    ctx.beginPath(); ctx.arc(cx, cy, 4, 0, Math.PI * 2); ctx.fill();
  } else {
    const [tx, ty] = pt(hu + handleOffset(k), 0, 0);
    ctx.beginPath(); ctx.moveTo(cx, cy); ctx.lineTo(tx, ty); ctx.stroke();
    ctx.beginPath(); ctx.arc(tx, ty, view === 'top' && active ? 6 : 3, 0, Math.PI * 2);
    if (view === 'top') { ctx.fillStyle = '#fff'; ctx.fill(); ctx.stroke(); } else ctx.fill();
  }
}
