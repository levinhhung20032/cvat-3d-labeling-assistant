import { layoutStore, useFrameLayout, type FrameLayout } from './layoutStore';

const OPTIONS: { id: FrameLayout; name: string; desc: string }[] = [
  { id: 'h', name: 'Ngang', desc: 'Các frame nằm cạnh nhau, mỗi frame là một cột với 3 view Trên / Bên / Trước xếp dọc (mặc định).' },
  { id: 'v', name: 'Dọc', desc: 'Các frame xếp từ trên xuống, mỗi frame là một hàng với 3 view Trên | Bên | Trước nằm ngang; trang cuộn dọc.' },
];

/** Tab Hiển thị (Cài đặt): cách xếp các frame trong Batch Review. Đổi là áp ngay. */
export function ViewPanel() {
  const layout = useFrameLayout();
  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Cách xếp các frame trong Batch Review</div>
      {OPTIONS.map((o) => (
        <label key={o.id} style={{ display: 'block', padding: '4px 0' }}>
          <input type="radio" name="cvla-frame-layout" checked={layout === o.id} onChange={() => layoutStore.save(o.id)} /> <b>{o.name}</b>
          <div style={{ marginLeft: 22, fontSize: 12, color: '#555' }}>{o.desc}</div>
        </label>
      ))}
      <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>Chỉ đổi cách hiển thị, không đụng dữ liệu nhãn. Trang Ref luôn xếp các view nằm ngang.</div>
    </div>
  );
}
