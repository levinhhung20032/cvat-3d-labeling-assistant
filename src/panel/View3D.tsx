import { useEffect, useMemo, useRef, useState } from 'react';
import type { Cuboid } from '../shared/cuboid';
import type { Status } from '../shared/interp';
import { boxEdges, boxInView, defaultOrbit, egoMarker, gatherAround, gatherEgoArea, heightColor, orbitMatrix, projectPoint, yawVsEgoDeg, ORBIT_EL_MAX, type Mat4, type Orbit } from '../shared/view3d';
import { comboOf } from '../shared/keymap';
import { useViewportOverlay } from './overlay';
import { pointClouds } from './stores';
import { useColors } from './colorStore';
import { hexRgb, statusColor } from './render';
import { useCurrentKeymap } from './actions';
import { useView3d } from './view3dStore';

export interface View3dOther { num: number; id: number; label: string; cub: Cuboid }
export interface View3dProps {
  num: number; id: number; label: string; frame: number; cub: Cuboid; status: Status; others: View3dOther[];
  onClose: () => void;
}

const VERT = `attribute vec3 a_pos; attribute vec3 a_col; uniform mat4 u_mvp; uniform float u_size; varying vec3 v_col;
void main() { gl_Position = u_mvp * vec4(a_pos, 1.0); gl_PointSize = u_size; v_col = a_col; }`;
const FRAG = `precision mediump float; varying vec3 v_col; void main() { gl_FragColor = vec4(v_col, 1.0); }`;

interface GlState { gl: WebGLRenderingContext; prog: WebGLProgram; pts: WebGLBuffer; lines: WebGLBuffer; nPts: number; nLine: number }

/**
 * View 3D: cửa sổ phụ nổi trong trang (không phải tab), nền làm mờ, xoay được, chỉ gồm point cloud trong bán kính (Cài đặt › Hiển thị) quanh box đang chọn
 * ở frame đang chọn, cùng box của các object khác. Chỉ để xem; không đổi dữ liệu nhãn. Vẽ khi cần (xoay / zoom / dữ liệu đổi), không vẽ liên tục.
 */
export function View3D(p: View3dProps) {
  const backRef = useRef<HTMLDivElement>(null);
  useViewportOverlay(backRef, true);
  // Cửa sổ phụ trong trang: chiếm 70% khung nhìn, căn giữa, nền phía sau làm mờ. Bấm ra ngoài (vùng mờ), Esc hoặc Q để đóng.
  return (
    <div ref={backRef} className="cvla-modal-back cvla-v3-back" onMouseDown={(e) => { if (e.target === e.currentTarget) p.onClose(); }}>
      <div className="cvla-v3" role="dialog" aria-modal="true" aria-label={`View 3D object #${p.id} frame ${p.frame}`}>
        <Scene3D {...p} />
      </div>
    </div>
  );
}

function Scene3D({ id, label, frame, cub, status, others, onClose }: View3dProps) {
  const colors = useColors();
  const { radius, pointSize, egoRadius } = useView3d();
  const keymap = useCurrentKeymap();
  const wrap = useRef<HTMLDivElement>(null);
  const glCv = useRef<HTMLCanvasElement>(null);
  const ovCv = useRef<HTMLCanvasElement>(null);
  const gs = useRef<GlState | null>(null);
  const orbit = useRef<Orbit>(defaultOrbit(radius));
  const mvp = useRef<Mat4 | null>(null);
  const raf = useRef(0);
  const [tick, setTick] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [pcVer, setPcVer] = useState(0);
  useEffect(() => pointClouds.subscribe(() => setPcVer((x) => x + 1)), []);
  const pc = pointClouds.peek(frame);

  // Dữ liệu: điểm trong bán kính + màu, và các cạnh box.
  const scene = useMemo(() => {
    if (!pc) return null;
    const g1 = gatherAround(pc.xyz, pc.count, cub, radius);
    const g2 = gatherEgoArea(pc.xyz, pc.count, cub, egoRadius, radius); // vùng nhỏ quanh ego (bỏ phần đã nằm trong vùng quanh box)
    const g = { n: g1.n + g2.n, pos: new Float32Array((g1.n + g2.n) * 3), inBox: new Uint8Array(g1.n + g2.n) };
    g.pos.set(g1.pos); g.pos.set(g2.pos, g1.n * 3); g.inBox.set(g1.inBox); g.inBox.set(g2.inBox, g1.n);
    const solid = colors.point ? hexRgb(colors.point) : null;
    const inCol = colors.pointIn ? hexRgb(colors.pointIn) : null;
    const buf = new Float32Array(g.n * 6);
    let inside = 0;
    const span = Math.max(2, Math.min(radius, 8));
    for (let i = 0; i < g.n; i++) {
      const c = inCol && g.inBox[i] ? inCol : solid ?? heightColor((g.pos[i * 3 + 2]! + span) / (2 * span));
      if (g.inBox[i]) inside++;
      buf.set([g.pos[i * 3]!, g.pos[i * 3 + 1]!, g.pos[i * 3 + 2]!, c[0], c[1], c[2]], i * 6);
    }
    const main = hexRgb(statusColor(status)) ?? [0.13, 0.77, 0.37];
    const other = [0.8, 0.84, 0.9];
    const segs: number[] = [];
    const addBox = (e: Float32Array, col: number[]) => { for (let i = 0; i < e.length; i += 3) segs.push(e[i]!, e[i + 1]!, e[i + 2]!, col[0]!, col[1]!, col[2]!); };
    addBox(boxEdges({ cu: 0, cv: 0, cw: 0, yaw: 0, sx: cub.sx, sy: cub.sy, sz: cub.sz }), main);
    const ego = egoMarker(cub);
    for (let i = 0; i < ego.lines.length; i++) segs.push(ego.lines[i]!);
    const tags: { x: number; y: number; z: number; text: string; kind: 'main' | 'other' }[] = [{ x: 0, y: 0, z: cub.sz / 2, text: `▶ #${id}`, kind: 'main' }];
    for (const o of others) {
      // box trong tầm quanh box đang chọn, hoặc quanh ego (vùng ego) dù xa box đang chọn
      const nearEgo = egoRadius > 0 && Math.hypot(o.cub.x, o.cub.y) <= egoRadius + Math.max(o.cub.sx, o.cub.sy) / 2;
      const b = boxInView(cub, o.cub, radius, nearEgo);
      if (!b) continue;
      addBox(boxEdges(b), other);
      tags.push({ x: b.cu, y: b.cv, z: b.cw + b.sz / 2, text: `#${o.id}`, kind: 'other' });
    }
    return { buf, n: g.n, nEgo: g2.n, egoDist: ego.dist, egoIcon: ego.icon, egoAhead: ego.ahead, yawDeg: yawVsEgoDeg(cub.yaw), inside, lines: Float32Array.from(segs), tags };
  }, [pc, cub, radius, egoRadius, status, others, colors.point, colors.pointIn, id, pcVer]);

  const draw = () => {
    raf.current = 0;
    const s = gs.current, cv = glCv.current, ov = ovCv.current;
    if (!s || !cv || !ov) return;
    const { gl } = s;
    const w = cv.width, h = cv.height;
    gl.viewport(0, 0, w, h);
    const bg = hexRgb(colors.viewBg) ?? [0.04, 0.06, 0.08];
    gl.clearColor(bg[0], bg[1], bg[2], 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    const m = orbitMatrix(orbit.current, w / Math.max(1, h), radius);
    mvp.current = m;
    gl.useProgram(s.prog);
    gl.uniformMatrix4fv(gl.getUniformLocation(s.prog, 'u_mvp'), false, m);
    const dpr = w / Math.max(1, cv.clientWidth);
    const aPos = gl.getAttribLocation(s.prog, 'a_pos'), aCol = gl.getAttribLocation(s.prog, 'a_col');
    const bind = (buf: WebGLBuffer) => {
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(aPos); gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 24, 0);
      gl.enableVertexAttribArray(aCol); gl.vertexAttribPointer(aCol, 3, gl.FLOAT, false, 24, 12);
    };
    gl.uniform1f(gl.getUniformLocation(s.prog, 'u_size'), Math.max(1, pointSize * dpr));
    if (s.nPts) { bind(s.pts); gl.drawArrays(gl.POINTS, 0, s.nPts); }
    if (s.nLine) { bind(s.lines); gl.drawArrays(gl.LINES, 0, s.nLine); }
    // nhãn ID (2D)
    const ctx = ov.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, ov.width, ov.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.font = '12px system-ui, sans-serif';
    ctx.textBaseline = 'bottom';
    const cw = ov.width / dpr, ch = ov.height / dpr;
    if (scene) {
      // biểu tượng ego nổi: mũi tên đỏ xoay theo hướng trước của ego trên màn hình
      const q0 = projectPoint(m, scene.egoIcon[0], scene.egoIcon[1], scene.egoIcon[2], cw, ch);
      const q1 = projectPoint(m, scene.egoAhead[0], scene.egoAhead[1], scene.egoAhead[2], cw, ch);
      if (q0) {
        ctx.save();
        ctx.translate(q0[0], q0[1]);
        const dx = q1 ? q1[0] - q0[0] : 0, dy = q1 ? q1[1] - q0[1] : 0;
        if (Math.hypot(dx, dy) > 3) {
          ctx.rotate(Math.atan2(dy, dx));
          ctx.beginPath(); ctx.moveTo(16, 0); ctx.lineTo(-10, -10); ctx.lineTo(-4, 0); ctx.lineTo(-10, 10); ctx.closePath();
        } else { ctx.beginPath(); ctx.arc(0, 0, 8, 0, Math.PI * 2); } // đang nhìn dọc theo hướng ego: chỉ hiện chấm
        ctx.fillStyle = '#ef4444'; ctx.fill(); ctx.lineWidth = 2; ctx.strokeStyle = '#fff'; ctx.stroke();
        ctx.restore();
        ctx.fillStyle = 'rgba(220,38,38,0.92)'; ctx.fillRect(q0[0] - 17, q0[1] - 34, 34, 15);
        ctx.fillStyle = '#fff'; ctx.fillText('EGO', q0[0] - 13, q0[1] - 22);
      }
      // góc quay của box so với ego, ở góc dưới trái khung: kim đỏ = hướng trước của ego (lên), kim xanh = hướng của box
      const cx0 = 62, cy0 = ch - 62, R0 = 38;
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(8, ch - 128, 150, 120);
      ctx.strokeStyle = 'rgba(255,255,255,0.6)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(cx0, cy0, R0, 0, Math.PI * 2); ctx.stroke();
      const needle = (angCcw: number, col: string, len: number) => {
        ctx.save(); ctx.translate(cx0, cy0); ctx.rotate(-angCcw);
        ctx.strokeStyle = col; ctx.fillStyle = col; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -len); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, -len - 7); ctx.lineTo(-5, -len + 3); ctx.lineTo(5, -len + 3); ctx.closePath(); ctx.fill();
        ctx.restore();
      };
      needle(0, '#ef4444', R0 - 8);
      needle((scene.yawDeg * Math.PI) / 180, '#22c55e', R0 - 8);
      ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = '#fff'; ctx.textBaseline = 'alphabetic';
      ctx.fillText('trước', cx0 - 13, cy0 - R0 - 3);
      ctx.font = 'bold 12px system-ui, sans-serif';
      ctx.fillText(`yaw so với ego`, 12, ch - 14 - 0);
      ctx.fillStyle = '#86efac';
      ctx.fillText(`${scene.yawDeg >= 0 ? '+' : ''}${scene.yawDeg.toFixed(1)}°`, 112, cy0 + 4);
      ctx.font = '12px system-ui, sans-serif'; ctx.textBaseline = 'bottom';
    }
    for (const t of scene?.tags ?? []) {
      const q = projectPoint(m, t.x, t.y, t.z, ov.width / dpr, ov.height / dpr);
      if (!q) continue;
      const wd = ctx.measureText(t.text).width + 6;
      ctx.fillStyle = t.kind === 'main' ? 'rgba(34,197,94,0.9)' : 'rgba(70,74,80,0.85)';
      ctx.fillRect(q[0] - wd / 2, q[1] - 16, wd, 15);
      ctx.fillStyle = '#fff';
      ctx.fillText(t.text, q[0] - wd / 2 + 3, q[1] - 2);
    }
  };
  const drawRef = useRef(draw);
  drawRef.current = draw;
  const schedule = () => {
    if (raf.current) return;
    const win = wrap.current?.ownerDocument.defaultView ?? window;
    raf.current = win.requestAnimationFrame(() => drawRef.current());
  };
  const scheduleRef = useRef(schedule);
  scheduleRef.current = schedule;

  // Khởi tạo WebGL một lần (một ngữ cảnh riêng cho cửa sổ này).
  useEffect(() => {
    const cv = glCv.current;
    if (!cv) return;
    try {
      const gl = cv.getContext('webgl', { antialias: true, alpha: false });
      if (!gl) throw new Error('Trình duyệt không cho tạo WebGL');
      const sh = (type: number, src: string) => {
        const x = gl.createShader(type)!;
        gl.shaderSource(x, src); gl.compileShader(x);
        if (!gl.getShaderParameter(x, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(x) ?? 'shader');
        return x;
      };
      const prog = gl.createProgram()!;
      gl.attachShader(prog, sh(gl.VERTEX_SHADER, VERT));
      gl.attachShader(prog, sh(gl.FRAGMENT_SHADER, FRAG));
      gl.linkProgram(prog);
      if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog) ?? 'link');
      gs.current = { gl, prog, pts: gl.createBuffer()!, lines: gl.createBuffer()!, nPts: 0, nLine: 0 };
      setTick((x) => x + 1);
    } catch (e) { setErr(e instanceof Error ? e.message : 'WebGL lỗi'); }
    return () => {
      const s = gs.current;
      if (s) { s.gl.deleteBuffer(s.pts); s.gl.deleteBuffer(s.lines); s.gl.deleteProgram(s.prog); s.gl.getExtension('WEBGL_lose_context')?.loseContext(); }
      gs.current = null;
      const win = wrap.current?.ownerDocument.defaultView;
      if (raf.current && win) win.cancelAnimationFrame(raf.current);
    };
  }, []);

  // Đẩy dữ liệu lên GPU rồi vẽ lại.
  useEffect(() => {
    const s = gs.current;
    if (!s || !scene) { scheduleRef.current(); return; }
    const { gl } = s;
    gl.bindBuffer(gl.ARRAY_BUFFER, s.pts); gl.bufferData(gl.ARRAY_BUFFER, scene.buf, gl.STATIC_DRAW); s.nPts = scene.n;
    gl.bindBuffer(gl.ARRAY_BUFFER, s.lines); gl.bufferData(gl.ARRAY_BUFFER, scene.lines, gl.STATIC_DRAW); s.nLine = scene.lines.length / 6;
    scheduleRef.current();
  }, [scene, tick, colors.viewBg, pointSize]);

  // Đổi bán kính: camera lùi / tiến theo cho vừa không gian mới.
  useEffect(() => { orbit.current = { ...orbit.current, dist: defaultOrbit(radius).dist }; scheduleRef.current(); }, [radius]);

  // Kích thước, chuột, phím.
  useEffect(() => {
    const el = wrap.current, ov = ovCv.current, cv = glCv.current;
    if (!el || !ov || !cv) return;
    const win = el.ownerDocument.defaultView ?? window;
    const fit = () => {
      const dpr = Math.min(2, win.devicePixelRatio || 1);
      const w = Math.max(50, el.clientWidth), h = Math.max(50, el.clientHeight);
      for (const c of [cv, ov]) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); c.style.width = `${w}px`; c.style.height = `${h}px`; }
      scheduleRef.current();
    };
    fit();
    const RO = (win as unknown as { ResizeObserver?: typeof ResizeObserver }).ResizeObserver ?? ResizeObserver;
    const ro = new RO(fit);
    ro.observe(el);
    let drag: { x: number; y: number } | null = null;
    const down = (e: PointerEvent) => { drag = { x: e.clientX, y: e.clientY }; ov.setPointerCapture(e.pointerId); };
    const move = (e: PointerEvent) => {
      if (!drag) return;
      const o = orbit.current;
      orbit.current = { ...o, az: o.az - (e.clientX - drag.x) * 0.008, el: Math.max(-ORBIT_EL_MAX, Math.min(ORBIT_EL_MAX, o.el + (e.clientY - drag.y) * 0.008)) };
      drag = { x: e.clientX, y: e.clientY };
      scheduleRef.current();
    };
    const up = () => { drag = null; };
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const o = orbit.current;
      orbit.current = { ...o, dist: Math.min(radius * 6, Math.max(1.5, o.dist * Math.exp(e.deltaY * 0.0012))) };
      scheduleRef.current();
    };
    const dbl = () => { orbit.current = defaultOrbit(radius); scheduleRef.current(); };
    ov.addEventListener('pointerdown', down); ov.addEventListener('pointermove', move); ov.addEventListener('pointerup', up); ov.addEventListener('pointercancel', up);
    ov.addEventListener('wheel', wheel, { passive: false }); ov.addEventListener('dblclick', dbl);
    return () => {
      ro.disconnect();
      ov.removeEventListener('pointerdown', down); ov.removeEventListener('pointermove', move); ov.removeEventListener('pointerup', up); ov.removeEventListener('pointercancel', up);
      ov.removeEventListener('wheel', wheel); ov.removeEventListener('dblclick', dbl);
    };
  }, [radius]);

  // Phím mở / đóng (cùng phím đã gán) hoặc Esc, khi cửa sổ 3D đang được focus.
  useEffect(() => {
    const doc = wrap.current?.ownerDocument; // cửa sổ nằm trong trang: nghe phím ở document của tool
    if (!doc) return;
    const onKey = (e: KeyboardEvent) => {
      const combo = comboOf(e);
      if (e.key === 'Escape' || (combo && (keymap['view3d.toggle'] ?? []).includes(combo))) { e.preventDefault(); onClose(); }
    };
    doc.addEventListener('keydown', onKey);
    return () => doc.removeEventListener('keydown', onKey);
  }, [keymap, onClose]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap', fontSize: 12, marginBottom: 4 }}>
        <b>#{id} {label} · frame {frame}</b>
        <span>bán kính {radius} m</span>
        {scene && <span>{scene.n.toLocaleString()} điểm ({scene.inside.toLocaleString()} trong box{scene.nEgo ? `, ${scene.nEgo.toLocaleString()} quanh ego` : ''})</span>}
        {scene && <span title="Biểu tượng ego nổi (mũi tên đỏ) chỉ hướng trước của xe; vòng trắng trên mặt đất dưới xe, đường xám nối tới tâm box. Góc dưới trái: kim đỏ = hướng ego, kim xanh = hướng box">ego cách box {scene.egoDist.toFixed(1)} m</span>}
        <span style={{ color: '#667' }}>kéo chuột: xoay · lăn: zoom · bấm đúp: về mặc định</span>
        <button onClick={() => { orbit.current = defaultOrbit(radius); scheduleRef.current(); }} style={{ marginLeft: 'auto' }}>⟲ Góc nhìn mặc định</button>
        <button onClick={onClose}>Đóng (Q)</button>
      </div>
      {err && <div style={{ color: '#b00' }}>Không dựng được view 3D: {err}</div>}
      {!pc && !err && <div style={{ color: '#a05a00' }}>Point cloud của frame {frame} chưa tải xong; sẽ tự hiện khi tải xong.</div>}
      <div ref={wrap} style={{ position: 'relative', flex: 1, minHeight: 0, background: colors.viewBg }}>
        <canvas ref={glCv} style={{ position: 'absolute', inset: 0 }} />
        <canvas ref={ovCv} style={{ position: 'absolute', inset: 0, cursor: 'grab', touchAction: 'none' }} />
      </div>
    </div>
  );
}
