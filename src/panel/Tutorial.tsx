import { useEffect, useRef, useState, type ReactNode } from 'react';
import { kv } from './storage';
import { useViewportOverlay } from './overlay';

/** Hướng dẫn dùng lần đầu: hiện một lần khi mở tool, bỏ qua được, xem lại ở menu ⚙ → "Hướng dẫn sử dụng". Nhớ cục bộ đã xem. */
const KEY = 'cvla-tutorial-done';
export const tutorialSeen = (): boolean => { try { return kv.get(KEY) === '1'; } catch { return true; } };
const markSeen = () => { try { kv.set(KEY, '1'); } catch { /* bỏ qua */ } };

const STEPS: { title: string; body: ReactNode }[] = [
  {
    title: 'Chào mừng',
    body: (
      <>
        <p>Tool giúp <b>xem lại và sửa nhãn cuboid 3D</b> trên point cloud, chạy ngay trong tab job CVAT, dùng phiên đăng nhập sẵn có của bạn.</p>
        <ul>
          <li>Dữ liệu <b>không rời khỏi tab</b>: không gửi đi đâu ngoài chính máy chủ CVAT của bạn.</li>
          <li>Mọi chỉnh sửa nằm trong <b>nháp</b> cho tới khi bạn tự bấm Upload.</li>
          <li>Hướng dẫn này gồm vài bước ngắn. Bỏ qua được, xem lại lúc nào cũng được ở <b>⚙ → Hướng dẫn sử dụng</b>.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Bảng object',
    body: (
      <>
        <p>Tab <b>Bảng object</b> liệt kê mọi object của job kèm các cột lỗi, khoảng cách tới xe, attribute…</p>
        <ul>
          <li><b>Bấm 1 lần</b> để chọn dòng (CVAT chọn theo), <b>bấm đúp</b> để mở Batch Review từ frame đầu.</li>
          <li>Rê chuột lên mã lỗi để xem số frame lỗi; dùng các ô lọc phía trên để thu hẹp danh sách.</li>
          <li>ID gạch chân là object đã mở xem.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Batch Review',
    body: (
      <>
        <p><b>Batch Review</b> hiện nhiều frame cạnh nhau, mỗi frame có 3 view Trên / Bên / Trước của object đang chọn.</p>
        <ul>
          <li>Cửa sổ frame: chọn khoảng a → b, số frame tuỳ chỉnh, ◀ ▶ để lật cửa sổ.</li>
          <li>Kéo box để chỉnh; kéo góc để đổi 2 cạnh cùng lúc. Ở frame có chồng lấn, kéo box cam nét đứt để dời luôn object kia (giữ Shift nếu muốn kéo nó ở vùng chồng lên box đang xét).</li>
          <li>Các <b>nhóm điều khiển</b> phía trên sắp xếp tuỳ ý: kéo ⠿ để chuyển, ⧉ để mở ở cửa sổ riêng, ▴ để ẩn cả thanh, ↺ để về bố cục mặc định.</li>
          <li>Bấm đúp tiêu đề frame (hoặc phím <code>`</code>) để thu nhỏ tool và đưa camera CVAT tới object.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Keyframe và Outside',
    body: (
      <>
        <ul>
          <li><b>🔒 / 🔓</b> khoá hoặc mở khoá frame đang chọn thành keyframe; <b>🔓 KF giữa</b> mở khoá các keyframe ở giữa phạm vi.</li>
          <li><b>Outside</b> có 3 chế độ: từ frame đang chọn, cả cửa sổ hiện tại, hoặc chọn khoảng. Muốn bỏ một object thì đặt outside, không xoá.</li>
          <li><b>Mọi frame outside đều phải có keyframe</b>; thiếu thì không upload được.</li>
          <li>Outside liên tục từ 6 frame trở lên: tool gợi ý <b>✂ tách ID</b> (object mới nằm cuối danh sách).</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Cảnh báo và ngưỡng',
    body: (
      <>
        <p>Nhóm <b>QC &amp; cảnh báo</b> liệt kê lỗi theo object, bấm một đoạn để nhảy tới frame đó; có thể Ignore hoặc đánh dấu Fixed.</p>
        <ul>
          <li>Tool <b>không kèm sẵn con số ngưỡng nào</b>. Bạn tự thêm rule ở <b>Cài đặt → Threshold</b> (đối tượng · thuộc tính · quy tắc · ngưỡng). Chưa có rule thì chưa có cảnh báo.</li>
          <li>Có thể <b>xuất / nạp setting.json</b> để lưu hoặc chia sẻ cài đặt của riêng bạn (không chứa dữ liệu nhãn).</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Nháp và Upload',
    body: (
      <>
        <ul>
          <li>Chỉnh sửa chỉ nằm trong <b>nháp</b> (lưu cục bộ để F5 không mất). Dùng Hoàn tác / Làm lại hoặc ⋯ để bỏ nháp.</li>
          <li><b>Upload lên CVAT</b> luôn có bước xem lại: mặc định chạy thử, không gửi gì; chỉ khi bạn xác nhận mới ghi thật.</li>
          <li>Tool <b>không bao giờ xoá hay đổi ID</b> object có sẵn. Chỉ object do chính tool tạo mới xoá được, và phải xác nhận.</li>
          <li>Sau khi upload, tool nạp lại dữ liệu từ CVAT để đối chiếu.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Ca, KPI và QC',
    body: (
      <>
        <ul>
          <li><b>Ca / KPI</b>: tool theo dõi ca làm việc và số frame đã upload; chỉ tiêu sửa được trong tab này.</li>
          <li><b>QC</b>: ghi chú từng frame, xuất Excel gồm đúng 3 cột <code>ID, frame, note</code>, nhập lại ghi chú, đối chiếu với file QC.</li>
        </ul>
      </>
    ),
  },
  {
    title: 'Mẹo nhỏ',
    body: (
      <>
        <ul>
          <li><b>⚙</b> ở góc trên: đồng bộ chọn object với CVAT, đổi giao diện (tự động / tối / xám / sáng), chế độ tải point cloud, tải lại frame lỗi.</li>
          <li>Tab <b>Cài đặt</b> gom Dynamic size, Threshold, Camera, Màu sắc, Phím tắt, Thông tin job.</li>
          <li>Nhấn <b>Esc</b> ở tab bất kỳ để quay về Bảng object; riêng tab Ref thì Esc về Batch Review (Esc vẫn đóng menu hoặc hộp thoại đang mở trước).</li>
          <li>Rê chuột lên dấu <b>?</b> hoặc nút bất kỳ để đọc giải thích.</li>
          <li>Xem lại hướng dẫn này: <b>⚙ → Hướng dẫn sử dụng</b>.</li>
        </ul>
      </>
    ),
  },
];

export function Tutorial({ onClose }: { onClose: () => void }) {
  const [i, setI] = useState(0);
  const last = i === STEPS.length - 1;
  const nextRef = useRef<HTMLButtonElement>(null);
  const done = () => { markSeen(); onClose(); };
  const backRef = useRef<HTMLDivElement>(null);
  useViewportOverlay(backRef, true);
  useEffect(() => { nextRef.current?.focus({ preventScroll: true }); }, [i]);
  const s = STEPS[i]!;
  return (
    <div ref={backRef} className="cvla-modal-back" onMouseDown={(e) => { if (e.target === e.currentTarget) done(); }}>
      <div
        className="cvla-modal cvla-tutorial" role="dialog" aria-modal="true" aria-label="Hướng dẫn sử dụng"
        onKeyDown={(e) => {
          if (e.key === 'Escape') { e.stopPropagation(); done(); }
          else if (e.key === 'ArrowRight' && !last) setI(i + 1);
          else if (e.key === 'ArrowLeft' && i > 0) setI(i - 1);
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
          <b className="cvla-modal-title">{s.title}</b>
          <span style={{ opacity: .65, fontSize: 12 }}>{i + 1} / {STEPS.length}</span>
        </div>
        <div className="cvla-tutorial-body">{s.body}</div>
        <div className="cvla-tutorial-dots" role="tablist" aria-label="Các bước">
          {STEPS.map((x, k) => (
            <button key={x.title} role="tab" aria-selected={k === i} aria-label={`Bước ${k + 1}: ${x.title}`} className={k === i ? 'cvla-dot cvla-dot-on' : 'cvla-dot'} onClick={() => setI(k)} />
          ))}
        </div>
        <div className="cvla-modal-actions" style={{ justifyContent: 'space-between' }}>
          <button onClick={done} title="Đóng hướng dẫn; xem lại ở ⚙ → Hướng dẫn sử dụng">{last ? 'Đóng' : 'Bỏ qua'}</button>
          <span style={{ display: 'inline-flex', gap: 8 }}>
            <button disabled={i === 0} onClick={() => setI(i - 1)}>Trước</button>
            <button ref={nextRef} className="cvla-primary" onClick={() => (last ? done() : setI(i + 1))}>{last ? 'Xong' : 'Tiếp'}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
