import { useState } from 'react';

/** Ô / mục có số liệu CHƯA đủ (còn frame đang tải ngầm hoặc chưa tính): viền vàng nét đứt; tự trở lại bình thường khi xong. */
export const PENDING_STYLE: React.CSSProperties = { outline: '2px dashed #d4a017', outlineOffset: -2, background: 'rgba(250, 204, 21, 0.16)' };

/** Dấu (?) nhỏ: rê chuột để đọc hướng dẫn dài, thay cho dòng chữ chiếm chỗ cố định trên giao diện. */
export function Help({ text }: { text: string }) {
  return <span className="cvla-help" title={text} aria-label={text}>?</span>;
}

/**
 * Thanh trượt có số: nhấp đúp vào thanh để về mặc định, bấm vào con số để gõ giá trị trực tiếp (Enter áp dụng, Esc hủy).
 */
export function Slider({ value, min, max, step, def, unit = '', decimals = 0, disabled = false, onChange, title, width }: {
  value: number; min: number; max: number; step: number; def: number; unit?: string; decimals?: number; disabled?: boolean; width?: number;
  onChange: (v: number) => void; title?: string;
}) {
  const [edit, setEdit] = useState<string | null>(null);
  const commit = () => {
    if (edit === null) return;
    const n = Number(edit.replace(',', '.'));
    setEdit(null);
    if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n)));
  };
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }} title={title ?? 'Nhấp đúp vào thanh để về mặc định; bấm vào số để gõ giá trị'}>
      <input
        type="range" min={min} max={max} step={step} value={value} disabled={disabled} style={width ? { width } : undefined}
        onChange={(e) => onChange(Number(e.target.value))}
        onDoubleClick={() => { if (!disabled) onChange(def); }}
      />
      {edit === null ? (
        <button
          type="button" disabled={disabled} className="cvla-num"
          onClick={() => setEdit(value.toFixed(decimals))}
        >{value.toFixed(decimals)}{unit}</button>
      ) : (
        <input
          autoFocus value={edit} size={5} style={{ width: 54 }}
          onChange={(e) => setEdit(e.target.value)}
          onFocus={(e) => e.target.select()}
          onBlur={commit}
          onKeyDown={(e) => { if (e.key === 'Enter') commit(); else if (e.key === 'Escape') setEdit(null); }}
        />
      )}
    </span>
  );
}

/** Thẻ thống kê nhỏ (nhãn + giá trị), tô màu khi cần chú ý. */
export function Pill({ children, tone = 'plain', title }: { children: React.ReactNode; tone?: 'plain' | 'warn' | 'bad' | 'class'; title?: string }) {
  return <span className={`cvla-pill cvla-pill-${tone}`} title={title}>{children}</span>;
}
