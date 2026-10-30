import { createContext, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { kv } from './storage';
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

  return (
    <GripCtx.Provider value={grip}>
      <div style={{ marginBottom: 6 - GAP }}>
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
                  {groups[id]}
                  {drop?.id === id && <div style={{ position: 'absolute', background: '#2563eb', zIndex: 3, pointerEvents: 'none', ...DROP_BAR[drop.side] }} />}
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
      </div>
      {!isDefault(lay) && (
        <div style={{ textAlign: 'right', margin: '-2px 0 4px' }}>
          <button onClick={() => save(DEFAULT_LAYOUT)} style={{ fontSize: 11, padding: '0 6px' }} title="Đưa các nhóm điều khiển về vị trí và kích thước mặc định">↺ Bố cục mặc định</button>
        </div>
      )}
    </GripCtx.Provider>
  );
}
