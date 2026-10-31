import type { Cuboid } from '../shared/cuboid';
import type { Mat3 } from '../shared/rot';
import { drawPointsGpu } from './gpu';
import { cornerInView, handleOffset, isTilted, type LocalBox, type View } from '../shared/edit';
import type { Status } from '../shared/interp';
import type { PointCloud } from '../shared/pcd';
import { DEFAULT_GROUND } from '../shared/ground';
import { pooledGround, pwWOf, roadOf, segOf } from './groundSeg';

export type { View };

/** Điểm trong hệ tọa độ của object: u dọc hướng box, v sang trái, w lên. */
export interface Local { u: Float32Array; v: Float32Array; w: Float32Array; n: number; g?: Uint8Array; pwW?: number | null; pool?: { u: Float32Array; v: Float32Array; w: Float32Array; n: number; ownOk?: boolean } | null; pwRoad?: { a: number; b: number; c: number; rms: number; n: number } | null }

/** `f`: số frame của point cloud — có thì (mức 4, G.pwPool > 0) gộp thêm điểm mặt đất của các frame lân cận vào `pool`; `pool` ép bật / tắt. */
export function localize(pc: PointCloud, c: Cuboid, half: number, f?: number, pool: boolean = DEFAULT_GROUND.pw >= 4): Local {
  const cos = Math.cos(c.yaw), sin = Math.sin(c.yaw);
  const u = new Float32Array(pc.count), v = new Float32Array(pc.count), w = new Float32Array(pc.count);
  const seg = segOf(pc); // Patchwork++ (null khi tắt): nhãn mặt đất đi theo từng điểm
  const g = seg ? new Uint8Array(pc.count) : undefined;
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
    u[n] = a; v[n] = b; w[n] = dz; if (g) g[n] = seg!.label[i]!; n++;
  }
  const road = roadOf(seg, c);
  const pooled = pool && seg && f !== undefined && DEFAULT_GROUND.pwPool > 0 ? pooledGround(f, c, DEFAULT_GROUND.pwPool, DEFAULT_GROUND.pwFarRadius) : null;
  return { u, v, w, n, g: g?.subarray(0, n), pwW: road ? road.c : pwWOf(seg, c), pwRoad: road, pool: pooled };
}

/** Quay điểm đã lọc (hệ yaw) sang khung nhìn căn theo box nghiêng. */
export function rotateLocal(l: Local, m: Mat3): Local {
  const u = new Float32Array(l.n), v = new Float32Array(l.n), w = new Float32Array(l.n);
  for (let i = 0; i < l.n; i++) {
    const a = l.u[i]!, b = l.v[i]!, c = l.w[i]!;
    u[i] = m[0] * a + m[1] * b + m[2] * c; v[i] = m[3] * a + m[4] * b + m[5] * c; w[i] = m[6] * a + m[7] * b + m[8] * c;
  }
  return { u, v, w, n: l.n, g: l.g, pwW: l.pwW, pwRoad: l.pwRoad };
}

export const STATUS_COLOR: Record<Status, string> = {
  key: '#22c55e', interp: '#38bdf8', hold: '#f59e0b',
  'outside-key': '#ef4444', outside: '#ef4444', none: '#9ca3af',
};

const BUCKETS = 8;
const PALETTE = Array.from({ length: BUCKETS }, (_, i) => `hsl(${220 - (i * 200) / (BUCKETS - 1)} 80% 55%)`);

/**
 * Mặt phẳng Oxy của ego (z = 0 trong tọa độ thế giới, mặt đường dưới xe) viết trong hệ của khung nhìn: nu·u + nv·v + nw·w = d.
 * Box không nghiêng: [0, 0, 1, −z của box]. Box nghiêng (khung nhìn quay bởi m): [m[2], m[5], m[8], −z của box].
 */
export type EgoPlane = [number, number, number, number];
/** Độ cao w của mặt phẳng ego tại vị trí s trên trục ngang của ô (u ở view Bên, v ở view Trước; trục còn lại lấy 0, giữa lát cắt). */
/** Nhãn tên mặt đường: chữ 10px như nhãn view (Trên / Bên / Trước), nền xám (85% đục) để chữ không lẫn vào point cloud. `right`: x là mép phải của nhãn. */
function surfaceTag(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, side: 'above' | 'below', color: string, right = false): void {
  ctx.save();
  ctx.setLineDash([]);
  ctx.font = '10px system-ui, sans-serif';
  const w = ctx.measureText(text).width + 6, h = 12;
  const left = right ? x - w : x, top = side === 'above' ? y - h : y;
  ctx.fillStyle = 'rgba(70, 74, 80, 0.85)';
  ctx.fillRect(left, top, w, h);
  ctx.fillStyle = color;
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + 3, top + h / 2 + 0.5);
  ctx.restore();
}
export const egoPlaneW = (p: EgoPlane, view: View, s: number): number => (p[3] - (view === 'side' ? p[0] : p[1]) * s) / p[2];

/** Chiếu điểm (u, v, w) của object lên ô. */
const project = (view: View, u: number, v: number, w: number, k: number, c: number): [number, number] =>
  view === 'top' ? [c - v * k, c - u * k] : view === 'side' ? [c + u * k, c - w * k] : [c + v * k, c - w * k];

/**
 * Dời khung nhìn (giữ chuột phải kéo): tâm ô là điểm (u, v, w) này trong hệ của object thay vì tâm box. Dùng chung cho cả 3 view và
 * mọi frame — kéo ở view Trên dời u / v, view Bên dời u / w, view Trước dời v / w — nên các view luôn khớp nhau.
 */
export interface Pan { u: number; v: number; w: number }
export const NO_PAN: Pan = { u: 0, v: 0, w: 0 };
const VIEW_LABEL: Record<View, string> = { top: 'Trên', side: 'Bên', front: 'Trước' };
/** Màu của ref mode: box ảo, mặt phản chiếu và điểm lấy đối xứng. */
export const REF_COLOR = '#c084fc';

/** Độ lệch trên màn hình (px) do dời khung nhìn: hình vẽ khi chưa dời cộng thêm (ox, oy). */
export function panOffset(view: View, pan: Pan, k: number): [number, number] {
  return view === 'top' ? [pan.v * k, pan.u * k] : view === 'side' ? [-pan.u * k, pan.w * k] : [-pan.v * k, pan.w * k];
}
/** Kéo chuột (dx, dy, mét theo màn hình: sang phải / xuống dưới) thì hình đi theo chuột. */
export function panBy(view: View, p: Pan, dx: number, dy: number): Pan {
  return view === 'top' ? { ...p, u: p.u + dy, v: p.v + dx } : view === 'side' ? { ...p, u: p.u - dx, w: p.w + dy } : { ...p, v: p.v - dx, w: p.w + dy };
}
/** Giới hạn dời: không ra ngoài vùng điểm đã lọc (lim = 0 thì về giữa). */
export function clampPan(p: Pan, lim: number): Pan {
  const c = (x: number) => Math.min(lim, Math.max(-lim, x)) || 0; // || 0: bỏ -0
  return { u: c(p.u), v: c(p.v), w: c(p.w) };
}

/** Thông số cảnh KHÔNG phụ thuộc mức zoom (để phóng to / thu nhỏ chỉ đổi khung nhìn, không đổi tập điểm được vẽ). */
export interface Scene { zClip: number; slab: number; colorHalf: number; slabFront?: number; point?: PointStyle }
/** Kiểu vẽ điểm (nhóm Hiển thị): màu cố định (null = tô theo độ cao), độ đậm 0–1, hệ số cỡ điểm. Điểm lọt ngoài box vẫn tô hồng. */
export interface PointStyle { color: string | null; alpha: number; scale: number }
/** '#rrggbb' → [r, g, b] trong 0–1 (sai định dạng: null). */
export function hexRgb(hex: string): [number, number, number] | null {
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  return m ? [parseInt(m[1]!, 16) / 255, parseInt(m[2]!, 16) / 255, parseInt(m[3]!, 16) / 255] : null;
}

/**
 * Điểm có được vẽ ở khung nhìn nửa-rộng `half` không. Hai trục lên màn hình chỉ bị cắt theo khung (đổi theo zoom — vùng nhìn
 * lớn hơn thì thấy thêm điểm ở rìa, đúng như kỳ vọng); trục còn lại dùng ngưỡng cố định của `scene`, nên cùng một vùng
 * nhìn thấy cùng một tập điểm ở mọi mức zoom.
 */
export function pointVisible(view: View, u: number, v: number, w: number, half: number, scene: Scene, pan: Pan = NO_PAN): boolean {
  // Dời khung nhìn chỉ dời hai trục lên màn hình; lát cắt theo trục còn lại vẫn tính quanh box.
  const pu = u - pan.u, pv = v - pan.v, pw = w - pan.w;
  if (view === 'top') return Math.abs(pu) <= half && Math.abs(pv) <= half && Math.abs(w) <= scene.zClip;
  if (view === 'side') return Math.abs(pu) <= half && Math.abs(pw) <= half && Math.abs(v) <= scene.slab;
  return Math.abs(pv) <= half && Math.abs(pw) <= half && Math.abs(u) <= (scene.slabFront ?? scene.slab);
}

/** Vẽ khung 12 cạnh của một box (đã xoay dyaw quanh tâm). */
function wire(ctx: CanvasRenderingContext2D, view: View, b: LocalBox, k: number, c: number, color: string, width: number, dash: number[]) {
  const cs = Math.cos(b.dyaw), sn = Math.sin(b.dyaw);
  const p = (a: number, bb: number, w: number) => project(view, b.cu + a * cs - bb * sn, b.cv + a * sn + bb * cs, b.cw + w, k, c);
  const hu = b.sx / 2, hv = b.sy / 2, hw = b.sz / 2;
  const corner = (i: number) => p(i & 1 ? hu : -hu, i & 2 ? hv : -hv, i & 4 ? hw : -hw);
  ctx.save();
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.setLineDash(dash);
  ctx.beginPath();
  for (let i = 0; i < 8; i++) for (const bit of [1, 2, 4]) {
    if (i & bit) continue;
    const [x1, y1] = corner(i), [x2, y2] = corner(i | bit);
    ctx.moveTo(x1, y1); ctx.lineTo(x2, y2);
  }
  ctx.stroke();
  ctx.restore();
}

export function drawView(
  ctx: CanvasRenderingContext2D, size: number, view: View, loc: Local | null,
  box: LocalBox | null, half: number, status: Status, active = false, misfit = false, ghost: LocalBox | null = null, ground: number | null = null, mark: { u: number; v: number; w: number } | null = null,
  scene: Scene = { zClip: half, slab: half * 0.5, colorHalf: half }, overlays: LocalBox[] = [], tiltBase: Pick<Cuboid, 'rx' | 'ry' | 'yaw'> | null = null,
  groundMarks: { u: number; v: number; w: number; used: boolean }[] = [], contactW: number | null = null, pan: Pan = NO_PAN, egoPlane: EgoPlane | null = null,
  reflect: { pts: Local | null; plane: number } | null = null, // ref mode: điểm lật từ box ảo về box chính + độ cao w của mặt phản chiếu
  pwPlane: EgoPlane | null = null, // mặt đường Patchwork++ gợi ý (tím), cùng dạng với egoPlane
) {
  ctx.fillStyle = '#0b0f14';
  ctx.fillRect(0, 0, size, size);
  const k = size / (2 * half), c = size / 2;
  const ps = scene.point;
  const alpha = ps?.alpha ?? 1;
  const solid = ps?.color ?? null;
  const dot = Math.max(1.5, size / 110) * (ps?.scale ?? 1);
  const [ox, oy] = panOffset(view, pan, k);
  // GPU (WebGL) nếu có: chiếu, cắt lát, tô màu và tô hồng điểm lọt ngoài box đều làm trong shader; không thì vẽ bằng canvas 2D như cũ.
  const gpuDone = !!loc && drawPointsGpu(ctx, loc, {
    view: view === 'top' ? 0 : view === 'side' ? 1 : 2, size, half, zClip: scene.zClip, slab: scene.slab, slabFront: scene.slabFront ?? scene.slab,
    colorHalf: scene.colorHalf, dot, pan: [pan.u, pan.v, pan.w], color: solid ? hexRgb(solid) : null, alpha, misfit: misfit && box && box.dyaw === 0 ? { cu: box.cu, cv: box.cv, cw: box.cw, sx: box.sx, sy: box.sy, sz: box.sz } : null,
  });
  ctx.globalAlpha = alpha;
  if (loc && !gpuDone) {
    const buckets: number[][] = Array.from({ length: BUCKETS }, () => []);
    const shell: number[] = [];
    for (let i = 0; i < loc.n; i++) {
      // loc được lọc ở phạm vi lớn nhất. Hai trục lên màn hình chỉ bị cắt theo khung nhìn (zoom); trục còn lại
      // (độ cao ở view Trên, bề dày lát cắt ở view Bên / Trước) dùng ngưỡng CỐ ĐỊNH theo object, không đổi theo zoom.
      const lu = loc.u[i]!, lv = loc.v[i]!, lw = loc.w[i]!;
      if (!pointVisible(view, lu, lv, lw, half, scene, pan)) continue;
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
      ctx.fillStyle = b === BUCKETS ? '#ff2bd6' : solid ?? PALETTE[b]!;
      for (const i of idx) {
        const [x, y] = project(view, loc.u[i]!, loc.v[i]!, loc.w[i]!, k, c);
        ctx.fillRect(x + ox - dot / 2, y + oy - dot / 2, dot, dot);
      }
    });
  }
  if (reflect?.pts) {
    // Ref mode: điểm lấy đối xứng từ box ảo, vẽ chồng lên điểm thật bằng màu tím.
    const r = reflect.pts;
    ctx.fillStyle = REF_COLOR;
    for (let i = 0; i < r.n; i++) {
      if (!pointVisible(view, r.u[i]!, r.v[i]!, r.w[i]!, half, scene, pan)) continue;
      const [x, y] = project(view, r.u[i]!, r.v[i]!, r.w[i]!, k, c);
      ctx.fillRect(x + ox - dot / 2, y + oy - dot / 2, dot, dot);
    }
  }
  ctx.globalAlpha = 1;
  // Mọi thứ còn lại (box, mặt đường, dấu…) vẽ theo khung nhìn đã dời; khung + nhãn view vẽ sau cùng, đứng yên.
  ctx.save();
  ctx.translate(ox, oy);
  shapes();
  ctx.restore();
  frameOf(ctx, size, view, ox !== 0 || oy !== 0);

  function shapes() {
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
    if (egoPlane && view !== 'top') {
      // mặt đường của ego (mặt phẳng Oxy, z = 0) kéo dài hết ô: vàng chấm; box ở trên / dưới vạch này bao nhiêu thì cao / thấp hơn mặt đường ego bấy nhiêu
      const x0 = -ox, x1 = size - ox;
      const yAt = (x: number) => c - egoPlaneW(egoPlane, view, (x - c) / k) * k;
      ctx.save();
      ctx.strokeStyle = '#ffd400';
      ctx.fillStyle = '#ffd400';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([2, 4]);
      ctx.beginPath(); ctx.moveTo(x0, yAt(x0)); ctx.lineTo(x1, yAt(x1)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      surfaceTag(ctx, 'ego', x0 + 4, yAt(x0) - 2, 'above', '#ffd400');
    }
    if (pwPlane && view !== 'top') {
      // mặt đường do Patchwork++ gợi ý (fit từ các điểm mặt đất quanh box, gộp cả frame lân cận): tím nét đứt dài, nghiêng theo mặt phẳng fit
      const x0 = -ox, x1 = size - ox;
      const yAt = (x: number) => c - egoPlaneW(pwPlane, view, (x - c) / k) * k;
      ctx.save();
      ctx.strokeStyle = REF_COLOR;
      ctx.fillStyle = REF_COLOR;
      ctx.lineWidth = 1.8;
      ctx.setLineDash([9, 4]);
      ctx.beginPath(); ctx.moveTo(x0, yAt(x0)); ctx.lineTo(x1, yAt(x1)); ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
      surfaceTag(ctx, 'patchwork++', x0 + 4, yAt(x0) + 2, 'below', REF_COLOR);
    }
    if (ground !== null && view !== 'top') {
      // mặt đường ước lượng (xanh lá nét đứt) để so với đáy box
      const gy = c - ground * k;
      ctx.save();
      ctx.strokeStyle = '#7cfc00';
      ctx.lineWidth = 1.5;
      ctx.setLineDash([5, 4]);
      ctx.beginPath(); ctx.moveTo(-ox, gy); ctx.lineTo(size - ox, gy); ctx.stroke();
      ctx.restore();
      surfaceTag(ctx, 'local', size - ox - 4, gy - 2, 'above', '#7cfc00', true);
    }
    if (reflect && view !== 'top') {
      // mặt phản chiếu (ref mode): tím nét gạch dài
      const ry = c - reflect.plane * k;
      ctx.save();
      ctx.strokeStyle = REF_COLOR;
      ctx.lineWidth = 1.5;
      ctx.setLineDash([8, 4]);
      ctx.beginPath(); ctx.moveTo(-ox, ry); ctx.lineTo(size - ox, ry); ctx.stroke();
      ctx.restore();
    }
    if (view !== 'top' && (groundMarks.length || contactW !== null)) {
      // mặt đường đo được ở từng cung quanh box (vạch xanh lá đậm: cung đã dùng, xám: tầng bị loại như vỉa hè) và lớp tiếp xúc dưới gầm (xanh lơ)
      ctx.save();
      ctx.lineWidth = 3;
      for (const m of groundMarks) {
        const [x, y] = project(view, m.u, m.v, m.w, k, c);
        ctx.strokeStyle = m.used ? '#7cfc00' : '#9aa4b2';
        ctx.beginPath(); ctx.moveTo(x - 6, y); ctx.lineTo(x + 6, y); ctx.stroke();
      }
      if (contactW !== null) {
        const [x, y] = project(view, 0, 0, contactW, k, c);
        ctx.strokeStyle = '#00e5ff';
        ctx.beginPath(); ctx.moveTo(x - 9, y); ctx.lineTo(x + 9, y); ctx.stroke();
      }
      ctx.restore();
    }
    for (const o of overlays) wire(ctx, view, o, k, c, o.color ?? '#ff8c00', 2, [4, 3]); // box của object khác đang chồng lấn
    if (!box) return;

    // 8 đỉnh của box (đã xoay dyaw quanh tâm) rồi nối 12 cạnh.
    const cos = Math.cos(box.dyaw), sin = Math.sin(box.dyaw);
    const tilted = tiltBase !== null && isTilted(tiltBase, box); // box nghiêng theo mặt đường (roll / pitch ≠ 0)
    const pt = (a: number, b: number, w: number) => {
      const [x, y, z] = tilted ? cornerInView(tiltBase!, box, [a, b, w]) : [a * cos - b * sin, a * sin + b * cos, w];
      return project(view, box.cu + x, box.cv + y, box.cw + z, k, c);
    };
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
}

/** Viền + nhãn tên view ở góc trên trái, để phân biệt 3 view xếp chồng trong một cột frame. */
function frameOf(ctx: CanvasRenderingContext2D, size: number, view: View, panned: boolean) {
  ctx.save();
  ctx.setLineDash([]);
  ctx.strokeStyle = '#5b6b80';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  const text = VIEW_LABEL[view] + (panned ? ' · đã dời' : '');
  ctx.font = '10px system-ui, sans-serif';
  ctx.fillStyle = 'rgba(11, 15, 20, 0.75)';
  ctx.fillRect(1, 1, ctx.measureText(text).width + 8, 14);
  ctx.fillStyle = panned ? '#fbbf24' : '#cbd5e1';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, 5, 8);
  ctx.restore();
}
