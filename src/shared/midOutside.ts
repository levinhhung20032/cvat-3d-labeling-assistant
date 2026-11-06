/**
 * Outside ở giữa (mã nội bộ W, hiện chữ T): object có box ở nhiều frame, trong đó có đoạn frame "ít điểm" (lỗi P)
 * nằm GIỮA hai frame không ít điểm. Đoạn ít điểm ở đầu / cuối track không tính (đó là phần outside đầu / cuối đã có sẵn công cụ).
 * `present`: các frame có box (tăng dần); `sparse(f)`: frame f ít điểm. Trả về các frame ít điểm nằm giữa.
 */
export function middleSparse(present: readonly number[], sparse: (f: number) => boolean): number[] {
  let first = -1, last = -1;
  for (let i = 0; i < present.length; i++) if (!sparse(present[i]!)) { if (first < 0) first = i; last = i; }
  if (first < 0) return [];
  const out: number[] = [];
  for (let i = first + 1; i < last; i++) if (sparse(present[i]!)) out.push(present[i]!);
  return out;
}
