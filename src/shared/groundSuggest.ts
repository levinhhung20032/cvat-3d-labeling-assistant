import type { GroundKind, GroundResult } from './ground';

/** Gợi ý chọn nguồn mặt đường cho một frame của một object. */
export interface GroundAdvice {
  kind: GroundKind;
  reason: string; // vì sao gợi ý nguồn này
  conflict: boolean; // đo riêng và Patchwork++ cùng đủ tin nhưng lệch nhau quá `agree`: nên xem cả 3 bằng mắt
  dzCm: Partial<Record<GroundKind, number>>; // đáy box phải dời bao nhiêu cm để chạm mặt đường của từng nguồn (âm = hạ xuống)
  detail: string; // văn bản cho tooltip
}

const LABEL: Record<GroundKind, string> = { measured: 'đo riêng', ego: 'ego z=0', pw: 'Patchwork++' };
const usable = (g: GroundResult | null | undefined): g is GroundResult => !!g && g.confident && !g.ambiguous && !g.inconsistent;
const fmtCm = (m: number) => `${m >= 0 ? '+' : '−'}${Math.round(Math.abs(m) * 100)} cm`;

/**
 * Thứ tự ưu tiên: đo riêng (đo trực tiếp quanh object, chắc nhất khi đường rõ) → Patchwork++ (lấp ca xa / thưa / bị che) → ego z=0 (chỉ là mốc
 * chung của cả cảnh, dùng khi hai cách kia không đo được). Không nguồn nào được coi là đúng tuyệt đối: nếu đo riêng và Patchwork++ cùng đủ tin
 * mà lệch nhau hơn `agree` (m) thì vẫn gợi ý đo riêng nhưng đánh dấu `conflict` để người dùng so bằng mắt (ví dụ đường ướt có lớp phản chiếu).
 */
export function adviseGround(c: Partial<Record<GroundKind, GroundResult | null>>, agree: number): GroundAdvice {
  const dzCm: Partial<Record<GroundKind, number>> = {};
  for (const k of ['measured', 'pw', 'ego'] as const) { const g = c[k]; if (g) dzCm[k] = Math.round(g.dz * 100); }
  const m = usable(c.measured) ? c.measured : null;
  const p = usable(c.pw) ? c.pw : null;
  const conflict = !!m && !!p && Math.abs(m.groundW - p.groundW) > agree;
  let kind: GroundKind, reason: string;
  if (m) {
    kind = 'measured';
    reason = conflict ? `đo riêng đủ tin nhưng lệch Patchwork++ ${fmtCm(m.groundW - p!.groundW)}: nên so bằng mắt (bật "hiện cả 3")` : 'đo riêng đủ tin';
  } else if (p) {
    kind = 'pw';
    reason = 'không đo riêng được (thưa / xa / bị che / mơ hồ), Patchwork++ đủ tin';
  } else {
    kind = 'ego';
    reason = 'không có nguồn đo nào đủ tin ở frame này, chỉ còn mốc ego z=0';
  }
  const parts = (['measured', 'pw', 'ego'] as const).map((k) => {
    const g = c[k];
    if (!g) return `${LABEL[k]}: không đo được`;
    return `${LABEL[k]}: ${fmtCm(g.dz)}${k === 'ego' || usable(g) ? '' : ' (chưa đủ tin)'}`;
  });
  return { kind, reason, conflict, dzCm, detail: `Gợi ý ${LABEL[kind]}: ${reason}.\nĐáy box so với mặt đường: ${parts.join(' · ')}` };
}
