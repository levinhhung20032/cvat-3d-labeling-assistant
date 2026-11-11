/**
 * Vẽ điểm bằng GPU (WebGL): MỘT khung vẽ WebGL dùng chung cho mọi ô; mỗi ô vẽ điểm vào khung đó rồi chép sang canvas 2D của ô
 * (sau đó phần box, đường kẻ… vẫn vẽ bằng canvas 2D). Việc chiếu điểm, cắt theo lát cắt, tô màu theo độ cao và tô hồng điểm lọt ra ngoài
 * box đều làm trong shader nên phóng to / kéo / đổi cỡ không còn tốn CPU theo số điểm. Không có WebGL (hoặc bị tắt) thì
 * `drawPointsGpu` trả false và `render.ts` quay về cách vẽ canvas 2D cũ.
 */
import type { Local } from './render';

export interface GpuParams {
  view: 0 | 1 | 2; // 0 trên, 1 bên, 2 trước
  size: number; // px CSS của ô
  half: number;
  zClip: number; slab: number; slabFront: number; colorHalf: number;
  dot: number; // px CSS
  pan: [number, number, number]; // tâm khung nhìn (u, v, w) khi dời bằng chuột phải; [0, 0, 0] = tâm box
  color: [number, number, number] | null; // màu cố định (0–1); null = tô theo độ cao
  alpha: number; // độ đậm 0–1 (điểm chồng nhau thì đậm dần)
  /** Tô hồng điểm nằm ngay sát ngoài box (cảnh báo lệch). */
  misfit: { cu: number; cv: number; cw: number; sx: number; sy: number; sz: number } | null;
  /** Tô màu riêng cho điểm nằm trong box (box đã xoay dyaw quanh tâm). */
  inBox: { cu: number; cv: number; cw: number; sx: number; sy: number; sz: number; dyaw: number; color: [number, number, number] } | null;
}

const BUCKETS = 8;
const VERT = `
attribute vec3 a_pos;
uniform float u_view, u_size, u_half, u_zClip, u_slab, u_slabFront, u_colorHalf, u_dotPx, u_dpr, u_misfit, u_useSolid, u_alpha, u_inOn, u_inCs, u_inSn;
uniform vec3 u_bc, u_bs, u_pan, u_solid, u_inBc, u_inBs, u_inCol;
varying vec4 v_col;
vec3 hsl2rgb(float h, float s, float l) {
  float c = (1.0 - abs(2.0 * l - 1.0)) * s;
  float hp = h / 60.0;
  float x = c * (1.0 - abs(mod(hp, 2.0) - 1.0));
  vec3 r = hp < 1.0 ? vec3(c, x, 0.0) : hp < 2.0 ? vec3(x, c, 0.0) : hp < 3.0 ? vec3(0.0, c, x) : hp < 4.0 ? vec3(0.0, x, c) : hp < 5.0 ? vec3(x, 0.0, c) : vec3(c, 0.0, x);
  return r + vec3(l - c * 0.5);
}
void main() {
  vec3 p = a_pos;
  vec3 q = p - u_pan; // trục lên màn hình theo khung nhìn đã dời; lát cắt (trục còn lại) vẫn quanh box
  float vis;
  vec2 s;
  float k = u_size / (2.0 * u_half), c = u_size * 0.5;
  if (u_view < 0.5) {
    vis = step(abs(q.x), u_half) * step(abs(q.y), u_half) * step(abs(p.z), u_zClip);
    s = vec2(c - q.y * k, c - q.x * k);
  } else if (u_view < 1.5) {
    vis = step(abs(q.x), u_half) * step(abs(q.z), u_half) * step(abs(p.y), u_slab);
    s = vec2(c + q.x * k, c - q.z * k);
  } else {
    vis = step(abs(q.y), u_half) * step(abs(q.z), u_half) * step(abs(p.x), u_slabFront);
    s = vec2(c + q.y * k, c - q.z * k);
  }
  gl_Position = vis > 0.5 ? vec4(s.x / u_size * 2.0 - 1.0, 1.0 - s.y / u_size * 2.0, 0.0, 1.0) : vec4(2.0, 2.0, 2.0, 1.0);
  gl_PointSize = u_dotPx;
  float t = (p.z + u_colorHalf) / (2.0 * u_colorHalf);
  float b = min(${BUCKETS - 1}.0, max(0.0, floor(t * ${BUCKETS}.0)));
  vec3 col = u_useSolid > 0.5 ? u_solid : hsl2rgb(220.0 - b * 200.0 / ${BUCKETS - 1}.0, 0.8, 0.55);
  if (u_inOn > 0.5) {
    vec3 d = p - u_inBc;
    float lu = u_inCs * d.x + u_inSn * d.y, lv = -u_inSn * d.x + u_inCs * d.y;
    if (abs(lu) <= u_inBs.x * 0.5 && abs(lv) <= u_inBs.y * 0.5 && abs(d.z) <= u_inBs.z * 0.5) col = u_inCol;
  }
  if (u_misfit > 0.5) {
    float du = abs(p.x - u_bc.x) - u_bs.x * 0.5, dv = abs(p.y - u_bc.y) - u_bs.y * 0.5, dw = p.z - u_bc.z - u_bs.z * 0.5;
    if ((du > 0.0 || dv > 0.0 || dw > 0.0) && du < 0.6 && dv < 0.6 && dw < 0.6 && p.z - u_bc.z > -u_bs.z * 0.5 + 0.2) col = vec3(1.0, 0.169, 0.839);
  }
  v_col = vec4(col * u_alpha, u_alpha); // nhân sẵn alpha (premultiplied) cho phép trộn ONE, ONE_MINUS_SRC_ALPHA
}`;
const FRAG = `precision mediump float;
varying vec4 v_col;
void main() { gl_FragColor = v_col; }`;

interface Gl {
  canvas: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  u: Record<string, WebGLUniformLocation | null>;
  aPos: number;
  buffers: Map<Local, WebGLBuffer>;
}

let state: Gl | null = null;
let failed = false;
let lost = false;
const disabled = () => { try { return localStorage.getItem('cvla-gpu') === '0'; } catch { return false; } };

function init(): Gl | null {
  if (state) return lost ? null : state;
  if (failed || disabled() || typeof document === 'undefined') return null;
  try {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = 256;
    const gl = canvas.getContext('webgl', { antialias: false, alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: false, powerPreference: 'high-performance' });
    if (!gl) throw new Error('no webgl');
    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) ?? 'shader');
      return s;
    };
    const prog = gl.createProgram()!;
    gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
    gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
    const u: Record<string, WebGLUniformLocation | null> = {};
    for (const n of ['u_view', 'u_size', 'u_half', 'u_zClip', 'u_slab', 'u_slabFront', 'u_colorHalf', 'u_dotPx', 'u_dpr', 'u_misfit', 'u_inOn', 'u_inCs', 'u_inSn', 'u_inBc', 'u_inBs', 'u_inCol', 'u_bc', 'u_bs', 'u_pan', 'u_useSolid', 'u_solid', 'u_alpha']) u[n] = gl.getUniformLocation(prog, n);
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); lost = true; });
    canvas.addEventListener('webglcontextrestored', () => { lost = false; state = null; });
    state = { canvas, gl, prog, u, aPos: gl.getAttribLocation(prog, 'a_pos'), buffers: new Map() };
    return state;
  } catch (e) {
    failed = true;
    console.warn('[CVLA] không dùng được WebGL, vẽ điểm bằng canvas 2D', e);
    return null;
  }
}

/** Đang vẽ điểm bằng GPU hay không (để hiện trên giao diện). */
export const gpuActive = () => !!state && !lost && !failed;
export const gpuTried = () => state !== null || failed;

const MAX_BUFFERS = 40;
function bufferOf(g: Gl, loc: Local): WebGLBuffer {
  const hit = g.buffers.get(loc);
  if (hit) { g.buffers.delete(loc); g.buffers.set(loc, hit); return hit; }
  const data = new Float32Array(loc.n * 3);
  for (let i = 0; i < loc.n; i++) { data[i * 3] = loc.u[i]!; data[i * 3 + 1] = loc.v[i]!; data[i * 3 + 2] = loc.w[i]!; }
  const buf = g.gl.createBuffer()!;
  g.gl.bindBuffer(g.gl.ARRAY_BUFFER, buf);
  g.gl.bufferData(g.gl.ARRAY_BUFFER, data, g.gl.STATIC_DRAW);
  g.buffers.set(loc, buf);
  while (g.buffers.size > MAX_BUFFERS) {
    const [oldKey, oldBuf] = g.buffers.entries().next().value as [Local, WebGLBuffer];
    g.gl.deleteBuffer(oldBuf);
    g.buffers.delete(oldKey);
  }
  return buf;
}

/** Vẽ điểm của `loc` vào (0,0,size,size) của ctx (đã có phép biến đổi dpr). Trả false nếu không dùng được GPU. */
export function drawPointsGpu(ctx: CanvasRenderingContext2D, loc: Local, p: GpuParams): boolean {
  const g = init();
  if (!g || lost) return false;
  try {
    const dpr = ctx.getTransform().a || 1;
    const px = Math.max(1, Math.round(p.size * dpr));
    const { gl, canvas } = g;
    if (canvas.width !== px || canvas.height !== px) { canvas.width = px; canvas.height = px; }
    gl.viewport(0, 0, px, px);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    if (loc.n > 0) {
      gl.useProgram(g.prog);
      gl.bindBuffer(gl.ARRAY_BUFFER, bufferOf(g, loc));
      gl.enableVertexAttribArray(g.aPos);
      gl.vertexAttribPointer(g.aPos, 3, gl.FLOAT, false, 0, 0);
      const u = g.u;
      gl.uniform1f(u.u_view!, p.view); gl.uniform1f(u.u_size!, p.size); gl.uniform1f(u.u_half!, p.half);
      gl.uniform1f(u.u_zClip!, p.zClip); gl.uniform1f(u.u_slab!, p.slab); gl.uniform1f(u.u_slabFront!, p.slabFront);
      gl.uniform1f(u.u_colorHalf!, p.colorHalf); gl.uniform1f(u.u_dotPx!, Math.max(1, p.dot * dpr)); gl.uniform1f(u.u_dpr!, dpr);
      gl.uniform1f(u.u_misfit!, p.misfit ? 1 : 0);
      gl.uniform3f(u.u_bc!, p.misfit?.cu ?? 0, p.misfit?.cv ?? 0, p.misfit?.cw ?? 0);
      gl.uniform3f(u.u_bs!, p.misfit?.sx ?? 0, p.misfit?.sy ?? 0, p.misfit?.sz ?? 0);
      const ib = p.inBox;
      gl.uniform1f(u.u_inOn!, ib ? 1 : 0);
      gl.uniform1f(u.u_inCs!, ib ? Math.cos(ib.dyaw) : 1); gl.uniform1f(u.u_inSn!, ib ? Math.sin(ib.dyaw) : 0);
      gl.uniform3f(u.u_inBc!, ib?.cu ?? 0, ib?.cv ?? 0, ib?.cw ?? 0);
      gl.uniform3f(u.u_inBs!, ib?.sx ?? 0, ib?.sy ?? 0, ib?.sz ?? 0);
      gl.uniform3f(u.u_inCol!, ib?.color[0] ?? 0, ib?.color[1] ?? 0, ib?.color[2] ?? 0);
      gl.uniform3f(u.u_pan!, p.pan[0], p.pan[1], p.pan[2]);
      gl.uniform1f(u.u_useSolid!, p.color ? 1 : 0);
      gl.uniform3f(u.u_solid!, p.color?.[0] ?? 0, p.color?.[1] ?? 0, p.color?.[2] ?? 0);
      gl.uniform1f(u.u_alpha!, Math.min(1, Math.max(0.05, p.alpha)));
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.drawArrays(gl.POINTS, 0, loc.n);
    }
    ctx.drawImage(canvas, 0, 0, p.size, p.size);
    return true;
  } catch (e) {
    failed = true;
    console.warn('[CVLA] lỗi WebGL, quay về canvas 2D', e);
    return false;
  }
}
