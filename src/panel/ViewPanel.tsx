import { layoutStore, useFrameLayout, type FrameLayout } from './layoutStore';
import { VIEW3D_LIMITS, view3dStore, useView3d } from './view3dStore';

const OPTIONS: { id: FrameLayout; name: string; desc: string }[] = [
  { id: 'h', name: 'Ngang', desc: 'Các frame nằm cạnh nhau, mỗi frame là một cột với 3 view Trên / Bên / Trước xếp dọc (mặc định).' },
  { id: 'v', name: 'Dọc', desc: 'Các frame xếp từ trên xuống, mỗi frame là một hàng với 3 view Trên | Bên | Trước nằm ngang; trang cuộn dọc.' },
];

/** Tab Hiển thị (Cài đặt): cách xếp các frame trong Batch Review. Đổi là áp ngay. */
export function ViewPanel() {
  const layout = useFrameLayout();
  const v3 = useView3d();
  return (
    <div style={{ maxWidth: 560 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>Cách xếp các frame trong Batch Review</div>
      {OPTIONS.map((o) => (
        <label key={o.id} style={{ display: 'block', padding: '4px 0' }}>
          <input type="radio" name="cvla-frame-layout" checked={layout === o.id} onChange={() => layoutStore.save(o.id)} /> <b>{o.name}</b>
          <div style={{ marginLeft: 22, fontSize: 12, color: '#555' }}>{o.desc}</div>
        </label>
      ))}
      <div style={{ fontWeight: 700, margin: '14px 0 4px' }}>View 3D (cửa sổ phụ, mở bằng nút 🧊 hoặc phím Q ở Batch Review)</div>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }} title="Chỉ lấy point và box nằm trong khoảng này quanh tâm box đang chọn. Nhỏ hơn thì nhẹ và thấy rõ hơn.">
        Bán kính không gian
        <input type="range" min={VIEW3D_LIMITS.radius.min} max={VIEW3D_LIMITS.radius.max} step={1} value={v3.radius} onChange={(e) => view3dStore.save({ radius: Number(e.target.value) })} />
        <b>{v3.radius} m</b>
        <button type="button" disabled={v3.radius === VIEW3D_LIMITS.radius.def} onClick={() => view3dStore.save({ radius: VIEW3D_LIMITS.radius.def })} style={{ padding: '0 5px' }} title={`Về mặc định ${VIEW3D_LIMITS.radius.def} m`}>↺</button>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }} title="Thêm vùng nhỏ quanh xe (ego, gốc toạ độ) vào view 3D, kèm dấu ego chỉ hướng trước. 0 = không tải vùng này (dấu ego vẫn hiện).">
        Vùng quanh ego
        <input type="range" min={VIEW3D_LIMITS.egoRadius.min} max={VIEW3D_LIMITS.egoRadius.max} step={1} value={v3.egoRadius} onChange={(e) => view3dStore.save({ egoRadius: Number(e.target.value) })} />
        <b>{v3.egoRadius === 0 ? 'tắt' : `${v3.egoRadius} m`}</b>
        <button type="button" disabled={v3.egoRadius === VIEW3D_LIMITS.egoRadius.def} onClick={() => view3dStore.save({ egoRadius: VIEW3D_LIMITS.egoRadius.def })} style={{ padding: '0 5px' }} title={`Về mặc định ${VIEW3D_LIMITS.egoRadius.def} m`}>↺</button>
      </label>
      <label style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '3px 0' }}>
        Cỡ điểm
        <input type="range" min={VIEW3D_LIMITS.pointSize.min} max={VIEW3D_LIMITS.pointSize.max} step={0.5} value={v3.pointSize} onChange={(e) => view3dStore.save({ pointSize: Number(e.target.value) })} />
        <b>{v3.pointSize} px</b>
      </label>
      <div style={{ marginTop: 8, fontSize: 12, color: '#555' }}>Chỉ đổi cách hiển thị, không đụng dữ liệu nhãn. Trang Ref luôn xếp các view nằm ngang.</div>
    </div>
  );
}
