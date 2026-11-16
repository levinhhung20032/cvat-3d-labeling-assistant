import { createContext, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { kv } from './storage';
import { PopWindow } from './PopWindow';
import { DEFAULT_LAYOUT, moveGroup, parseLayout, resizeSplit, setRowHeight, type CtlLayout, type DropSide } from './ctlLayout';

/**
 * Khu nhóm điều khiển ở đầu tab Batch Review do người dùng tự sắp: kéo ⠿ ở tiêu đề nhóm để chuyển nhóm (thả vào nửa trái / phải
 * của nhóm khác để đứng cạnh, mép trên / dưới để thành hàng mới), kéo vạch giữa hai nhóm để đổi bề rộng, kéo vạch dưới hàng để
 * đổi chiều cao. Nhớ theo người dùng (cục bộ).
 */
const KEY = 'cvla-ctl-layout';
const load = (): CtlLayout => { try { return parseLayout(JSON.parse(kv.get(KEY) ?? 'null')); } catch { return DEFAULT_LAYOUT; } };
const isDefault = (l: CtlLayout) => JSON.stringify(l) === JSON.stringify(DEFAULT_LAYOUT);

/** Nút kéo ⠿ của nhóm `id` (Group gắn vào tiêu đề); null ngoài khu bố cục. */
export const GripCtx = createContext<((id: string) => ReactNode) | null>(null);
/** Nút ⧉ (mở cửa sổ rời) của nhóm `id`; trong cửa sổ rời là nút "Đưa về". null ngoài khu bố cục. */
export const PopCtx = createContext<((id: string) => ReactNode) | null>(null);
const HIDE_KEY = 'cvla-ctl-hidden';

const GAP = 6;
const DROP_BAR: Record<DropSide, React.CSSProperties> = {
  l: { left: 0, top: 0, bottom: 0, width: 4 },
  r: { right: 0, top: 0, bottom: 0, width: 4 },
  t: { left: 0, right: 0, top: 0, height: 4 },
  b: { left: 0, right: 0, bottom: 0, height: 4 },
};

export function ControlLayout({ groups }: { groups: Record<string, ReactNode> }) {
  const [lay, setLay] = useState(load);
  const live = useRef(lay);
  live.current = lay;
  const save = (l: CtlLayout) => {
    setLay(l);
    try { if (isDefault(l)) kv.remove(KEY); else kv.set(KEY, JSON.stringify(l)); } catch { /* bỏ qua */ }
  };
  const dragId = useRef<string | null>(null);
  const [drop, setDrop] = useState<{ id: string; side: DropSide } | null>(null);
  const wraps = useRef(new Map<string, HTMLDivElement>());
  const [hidden, setHiddenState] = useState(() => { try { return kv.get(HIDE_KEY) === '1'; } catch { return false; } });
  const setHidden = (v: boolean) => { setHiddenState(v); try { if (v) kv.set(HIDE_KEY, '1'); else kv.remove(HIDE_KEY); } catch { /* bỏ qua */ } };
  const [popped, setPopped] = useState<string[]>([]); // nhóm đang ở cửa sổ rời
  const [popFail, setPopFail] = useState(false);
  const popSize = useRef(new Map<string, { w: number; h: number }>());
  const rootRef = useRef<HTMLDivElement>(null);
  const popOut = (id: string) => {
    const r = wraps.current.get(id)?.getBoundingClientRect();
    popSize.current.set(id, { w: Math.max(360, Math.min(900, (r?.width ?? 480) + 40)), h: Math.max(160, Math.min(700, (r?.height ?? 200) + 60)) });
    setPopFail(false);
    setPopped((p) => (p.includes(id) ? p : [...p, id]));
  };
  const popBack = (id: string) => setPopped((p) => p.filter((x) => x !== id));
  const popBtn = (id: string) => (
    <button className="cvla-iconbtn" style={{ padding: '0 3px' }} onClick={() => popOut(id)} title="Mở nhóm này ở cửa sổ riêng để dùng độc lập (kéo sang màn hình khác được). Đóng cửa sổ thì nhóm về chỗ cũ." aria-label="Mở cửa sổ riêng">⧉</button>
  );
  const backBtn = (id: string) => (
    <button className="cvla-iconbtn" style={{ padding: '0 3px' }} onClick={() => popBack(id)} title="Đưa nhóm về lại chỗ cũ trong tool" aria-label="Đưa về">⮌ Đưa về</button>
  );

  const grip = (id: string) => (
    <span
      draggable className="cvla-grip"
      title="Kéo để chuyển nhóm: thả vào nửa trái / phải của nhóm khác để đứng cạnh, mép trên / dưới để thành hàng riêng"
      onDragStart={(e) => {
        dragId.current = id;
        e.dataTransfer.effectAllowed = 'move';
        e.dataTransfer.setData('text/plain', `cvla-group-${id}`);
        const el = wraps.current.get(id);
        if (el) e.dataTransfer.setDragImage(el, 12, 8);
      }}
      onDragEnd={() => { dragId.current = null; setDrop(null); }}
    >⠿</span>
  );

  const sideOf = (e: DragEvent, el: HTMLElement): DropSide => {
    const r = el.getBoundingClientRect();
    const edge = Math.min(24, r.height * 0.3);
    if (e.clientY - r.top < edge) return 't';
    if (r.bottom - e.clientY < edge) return 'b';
    return e.clientX - r.left < r.width / 2 ? 'l' : 'r';
  };
  const onOver = (e: DragEvent<HTMLDivElement>, id: string) => {
    const src = dragId.current;
    if (!src) return;
    if (src === id) { if (drop) setDrop(null); return; }
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const side = sideOf(e, e.currentTarget);
    if (drop?.id !== id || drop.side !== side) setDrop({ id, side });
  };
  const onDrop = (e: DragEvent<HTMLDivElement>, id: string) => {
    const src = dragId.current;
    if (!src) return;
    e.preventDefault();
    save(moveGroup(lay, src, id, sideOf(e, e.currentTarget)));
    dragId.current = null;
    setDrop(null);
  };

  /** Kéo vạch (giữ chuột): cập nhật bố cục khi di chuyển, lưu khi thả. */
  const dragBar = (e: RPointerEvent<HTMLDivElement>, step: (dx: number, dy: number, base: CtlLayout) => CtlLayout) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const el = e.currentTarget;
    const x0 = e.clientX, y0 = e.clientY, base = lay;
    el.setPointerCapture(e.pointerId);
    const move = (ev: PointerEvent) => setLay(step(ev.clientX - x0, ev.clientY - y0, base));
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
      el.removeEventListener('pointercancel', up);
      save(live.current);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  };

  const rootClass = () => (rootRef.current?.closest('.cvla-root')?.className ?? 'cvla-root');
  const isDef = isDefault(lay);

  return (
    <GripCtx.Provider value={grip}>
     <PopCtx.Provider value={popBtn}>
      <div ref={rootRef} style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'flex-end', flexWrap: 'wrap', margin: '0 0 4px' }}>
        {popFail && <span style={{ color: 'var(--cvla-c-bb0000, #b00)', fontSize: 11 }}>Trình duyệt chặn cửa sổ rời: hãy cho phép cửa sổ bật lên cho trang này.</span>}
        <button onClick={() => save(DEFAULT_LAYOUT)} disabled={isDef} style={{ fontSize: 11, padding: '0 6px' }} title="Đưa các nhóm điều khiển về vị trí và kích thước mặc định">↺ Bố cục mặc định</button>
        <button onClick={() => setHidden(!hidden)} style={{ fontSize: 11, padding: '0 6px' }} aria-pressed={hidden} title={hidden ? 'Hiện lại thanh công cụ (các nhóm điều khiển)' : 'Ẩn thanh công cụ để dành chỗ cho bảng frame (cửa sổ rời vẫn giữ)'}>{hidden ? '▾ Hiện thanh công cụ' : '▴ Ẩn thanh công cụ'}</button>
      </div>
      {popped.map((id) => (
        <PopWindow
          key={id} title={`Nhóm ${id} · CVAT 3D Assistant`} rootClass={rootClass()} width={popSize.current.get(id)?.w ?? 520} height={popSize.current.get(id)?.h ?? 260}
          onClose={() => popBack(id)} onFail={() => { popBack(id); setPopFail(true); }}
        >
          <GripCtx.Provider value={null}>
            <PopCtx.Provider value={backBtn}>{groups[id]}</PopCtx.Provider>
          </GripCtx.Provider>
        </PopWindow>
      ))}
      {!hidden && <div style={{ marginBottom: 6 - GAP }}>
        {lay.map((row, r) => (
          <div key={row.ids.join(',')}>
            <div style={{
              display: 'grid', alignItems: 'stretch',
              gridTemplateColumns: row.ids.map((_, i) => `minmax(0, ${row.w[i]}fr)`).join(` ${GAP}px `),
              gridTemplateRows: row.h === null ? undefined : `${row.h}px`,
            }}>
              {row.ids.flatMap((id, i) => [
                ...(i > 0 ? [
                  <div
                    key={`s${id}`} className="cvla-split cvla-split-v"
                    title="Kéo để đổi bề rộng hai nhóm hai bên; nhấp đúp: chia đều cả hàng"
                    onPointerDown={(e) => {
                      const w = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect().width || 1;
                      dragBar(e, (dx, _dy, base) => resizeSplit(base, r, i - 1, dx / w));
                    }}
                    onDoubleClick={() => save(lay.map((x, k) => (k === r ? { ...x, w: x.w.map(() => 1) } : x)))}
                  />,
                ] : []),
                <div
                  key={id} style={{ minWidth: 0, minHeight: 0, position: 'relative' }}
                  ref={(el) => { if (el) wraps.current.set(id, el); else wraps.current.delete(id); }}
                  onDragOver={(e) => onOver(e, id)} onDrop={(e) => onDrop(e, id)}
                >
                  {popped.includes(id)
                    ? <div style={{ border: '1px dashed var(--cvla-c-9aa4b2, #9aa4b2)', borderRadius: 4, padding: '4px 8px', height: '100%', boxSizing: 'border-box', fontSize: 12 }}>Đang ở cửa sổ riêng {backBtn(id)}</div>
                    : groups[id]}
                  {drop?.id === id && <div style={{ position: 'absolute', background: 'var(--cvla-c-2563eb, #2563eb)', zIndex: 3, pointerEvents: 'none', ...DROP_BAR[drop.side] }} />}
                </div>,
              ])}
            </div>
            <div
              className="cvla-split cvla-split-h"
              title={row.h === null ? 'Kéo để đổi chiều cao hàng (đang theo nội dung)' : `Kéo để đổi chiều cao hàng (${row.h} px); nhấp đúp: theo nội dung`}
              onPointerDown={(e) => {
                const h0 = (e.currentTarget.previousElementSibling as HTMLElement).getBoundingClientRect().height;
                dragBar(e, (_dx, dy, base) => setRowHeight(base, r, h0 + dy));
              }}
              onDoubleClick={() => save(setRowHeight(lay, r, null))}
            />
          </div>
        ))}
      </div>}
     </PopCtx.Provider>
    </GripCtx.Provider>
  );
}
