/** Hộp xác nhận của tool (thay cho confirm() gốc của trình duyệt): gọi `askConfirm(...)` rồi await; `ConfirmHost` (trong App) vẽ hộp. */
export type ConfirmOpts = { title?: string; message: string; confirmLabel?: string; cancelLabel?: string; danger?: boolean };
type Pending = ConfirmOpts & { resolve: (ok: boolean) => void };

let current: Pending | null = null;
const queue: Pending[] = [];
const subs = new Set<() => void>();
const emit = () => subs.forEach((f) => f());

export const confirmStore = {
  subscribe(f: () => void) { subs.add(f); return () => { subs.delete(f); }; },
  get() { return current; },
  answer(ok: boolean) {
    const c = current;
    current = queue.shift() ?? null;
    c?.resolve(ok);
    emit();
  },
};

export function askConfirm(opts: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const p: Pending = { ...opts, resolve };
    if (current) queue.push(p); else current = p;
    emit();
  });
}
