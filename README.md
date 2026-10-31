# CVAT 3D Labeling Assistant

Extension cho trình duyệt **Edge / Chrome** (và bản thử cho Firefox) giúp **kiểm tra và sửa nhãn hộp 3D (cuboid) trên point cloud** ngay trong trang job của CVAT. Tool dùng chính phiên đăng nhập CVAT của bạn, không cần tải dữ liệu về máy, không gửi dữ liệu đi đâu khác.

> ⚠️ Bạn đang làm việc trên **dữ liệu thật**. Mọi thay đổi nằm trong **bản nháp** cho tới khi bạn bấm **Upload lên CVAT**, và có màn hình xem lại cùng nhật ký để hoàn nguyên.

## Bắt đầu nhanh

1. **Cài:** tải file `cvat-3d-labeling-assistant-<phiên bản>.zip` ở trang **Releases**, giải nén. Mở `edge://extensions` → bật **Developer mode** → **Load unpacked** → chọn thư mục vừa giải nén.
2. **Thêm máy chủ CVAT:** tool không có sẵn máy chủ nào. Mở một job (`https://<máy-chủ>/tasks/<id>/jobs/<id>`), bấm biểu tượng extension: trang **Cài đặt** tự mở với tên miền điền sẵn → **Thêm** → đồng ý khi trình duyệt hỏi quyền → bấm biểu tượng extension lần nữa để bật tool.
3. **Nhập ngưỡng cảnh báo:** vào tab **Threshold** và thêm rule cho các lỗi bạn muốn tool báo (xem [Threshold](#threshold-ngưỡng-cảnh-báo)). Chưa có rule thì tool không báo lỗi nào.
4. **Làm việc:** bấm **Vào ca**, chọn một dòng trong **Bảng object** để mở **Batch Review**, sửa trực tiếp trên các hình chiếu, rồi bấm **⬆ Upload lên CVAT…** khi xong.
5. **Cập nhật:** giải nén bản mới **đè vào đúng thư mục cũ**, bấm **Reload** ở `edge://extensions`, rồi F5 tab CVAT.

## Tool làm được gì

| Nhóm | Mô tả ngắn |
| --- | --- |
| **Bảng object** | Danh sách object của job kèm số frame, cảnh báo, khoảng cách tới xe, attribute (dấu **!** cạnh attribute = object có gợi ý đổi attribute); lọc và sắp xếp; dòng tên cột luôn hiện khi cuộn xuống. |
| **Batch Review** | Xem một object qua nhiều frame cùng lúc, 3 hình chiếu (Trên / Bên / Trước). Kéo thả để dời, đổi kích thước, xoay box; zoom bằng con lăn, giữ chuột phải kéo để dời khung nhìn. |
| **Keyframe & outside** | Khoá / mở khoá keyframe, đánh dấu outside (box được lưu lại để trả về đúng chỗ cũ). |
| **Cảnh báo & gợi ý** | Box lệch khỏi cụm điểm (có box gợi ý, bấm A để nhận), trôi box, đi xa bất thường, chồng lấn, đáy box lơ lửng / chìm so với mặt đường, ít điểm, outside quá lâu (có nút tách ID). |
| **Mặt đường** | Mỗi frame chọn đúng 1 nguồn mặt đường cho Ground snap / lock: **local** (đo riêng quanh object), **ego** (z = 0) hoặc **patchwork++**; công tắc *hiện cả 3* để so sánh; hệ thống gợi ý nguồn (xem [mục dưới](#mặt-đường-local--ego--patchwork)). |
| **Threshold** | Bạn tự đặt các rule cảnh báo; xuất / nạp toàn bộ cài đặt ra file `setting.json`. |
| **Dynamic size** | Chọn class nào được đổi kích thước theo từng frame, class nào dùng một kích thước cho cả object. |
| **QC** | Ghi chú QC theo (ID, frame) và xuất Excel; **đối chiếu file báo cáo QC** (xem [mục dưới](#đối-chiếu-file-qc-qc-comparison)). |
| **Thuộc tính** | Xem và sửa attribute, có gợi ý theo kích thước box. |
| **Upload** | Màn hình xem lại → ghi lên CVAT → đọc lại để so khớp; có nhật ký hoàn nguyên. |
| **Ca làm việc / KPI** | Tự chia ca sáng / chiều / OT theo giờ, thống kê số object và frame đã sửa. |
| **Giao diện & màu sắc** | Cửa sổ nổi kéo được, giao diện sáng / tối / xám, phím tắt tuỳ chỉnh; tab **Màu sắc** chỉnh màu point, nền view, vạch mặt đường, viền frame (có khung xem trước, bấm Lưu mới đổi). |

Tool tải sẵn point cloud của cả job ngầm ở nền (có thanh tiến độ); nút **↻ Tải lại frame** dùng khi có frame bị lỗi. Bản nháp được lưu trong trình duyệt nên F5 không mất.

## Mặt đường: local / ego / patchwork++

Ground snap (phím `G`), tự bám mặt đất khi kéo (`gr lock`) và lỗi đáy lơ lửng / chìm đều cần một **mặt đường**. Tool có ba nguồn, chọn **đúng một** cho mỗi frame ở ô chọn đầu cột frame (ô chung ở nhóm *Gợi ý & mặt đất* là mặc định cho frame chưa chọn riêng):

| Nguồn | Cách dựng |
| --- | --- |
| **local** | Đo riêng cho object ở đúng frame đó: lớp thấp nhất có mật độ ở 8 cung quanh box, kèm bằng chứng dưới gầm; không dự đoán từ frame khác. Mặc định. |
| **ego** | Mặt phẳng z = 0 của hệ ego (mặt đường dưới xe). Luôn có, chỉ là mốc chung của cả cảnh. |
| **patchwork++** | Mặt phẳng fit từ các điểm Patchwork++ gán là mặt đất quanh box (thử nghiệm, dành cho ca xa / thưa / bị che). |

- Đổi nguồn ở một frame **không ảnh hưởng frame khác**; lựa chọn được nhớ theo object và frame.
- **hiện cả 3**: vẽ cả ba vạch (local xanh lá, ego vàng chấm, patchwork++ tím nét đứt) để so sánh; Ground snap / lock vẫn dùng đúng nguồn đã chọn.
- **sg road** (gợi ý mặt đường): mỗi frame đo cả ba nguồn rồi gợi ý một nguồn (local nếu đủ tin → patchwork++ → ego) bằng chip 💡 ở đầu cột; chip ⚠ khi local và patchwork++ cùng đủ tin nhưng lệch nhau nhiều (nên xem bằng mắt, ví dụ đường ướt có lớp phản chiếu). Nút **💡 Áp gợi ý** chọn nguồn gợi ý cho các frame đang hiện, không dời box nào. Bật gợi ý sẽ chạy Patchwork++ cho các frame đang hiện.
- Patchwork++ là phần **thử nghiệm**: chưa dùng trong cảnh báo lỗi G mặc định, và chưa đánh giá trên đường khô. Mã Patchwork++ đóng gói kèm theo giấy phép BSD-2 (xem `THIRD_PARTY_NOTICES.txt`).

## Màu sắc

Tab **Màu sắc** chỉnh: màu point (cố định hoặc theo độ cao), nền các view, màu vạch local / ego / patchwork++, và màu viền frame / box theo trạng thái (keyframe, nội suy, giữ nguyên, outside, chưa có box). Khung **Xem trước** vẽ một cảnh mẫu bằng đúng hàm vẽ của Batch Review. Các thay đổi chỉ là bản nháp cho tới khi bấm **💾 Lưu**; có **Hủy thay đổi** và **↺ Mặc định**. Màu lưu cục bộ trong extension, không có trong `setting.json`.

## Threshold (ngưỡng cảnh báo)

Tool **không kèm sẵn con số ngưỡng nào**. Mỗi loại lỗi là một danh sách **rule** do bạn đặt; chưa có rule thì lỗi đó không được báo. Mỗi rule chọn bằng 4 ô:

| Đối tượng | Thuộc tính | Quy tắc | Ngưỡng |
| --- | --- | --- | --- |
| Class: *Car* | Dài | `>` | *6* |
| Tất cả object | Khoảng cách tới xe | `>` | *70* |

(Bảng trên chỉ là **ví dụ minh hoạ**, không phải giá trị khuyến nghị.) Rule đầu nghĩa là: "với class Car, nếu chiều dài lớn hơn 6 thì báo lỗi K". Bấm **＋ Thêm rule** để thêm, **✕** để xoá.

- **Đối tượng:** tất cả, một class (danh sách lấy từ nhãn của job đang mở), hoặc một object cụ thể.
- **Quy tắc:** `>`, `>=`, `<`, `<=`, `=`, `!=`. Một số thuộc tính chỉ cho các quy tắc hợp lý (ví dụ IoU chỉ có `>`, `>=`).
- **Mã lỗi:** S (kích thước không đồng bộ), K (kích thước), Z (độ cao), H (đổi hướng), D (quá xa), O (chồng lấn), T (trôi box), Y (đi xa bất thường), và lệch / ít điểm, đáy lơ lửng / chìm, outside liên tục. Chữ ký hiệu ở đầu mỗi mục **sửa được**.
- **S** chỉ xét object có Dynamic size đang **tắt** (xem tab Dynamic size).
- **Xuất setting.json / Nạp setting.json…** lưu hoặc nạp toàn bộ cài đặt (rule, ký hiệu, Dynamic size). Đây là file riêng của bạn, **đừng đưa lên GitHub công khai** (đã nằm trong `.gitignore`).

## Đối chiếu file QC (QC comparison)

Tính năng này so file báo cáo QC (.xlsx) với kết quả tool tự phát hiện, để biết lỗi nào QC đã chỉ ra mà còn lỗi, đã hết, hoặc bạn đã bỏ qua / sửa.

**Cách tool đọc file** (toàn bộ diễn ra trong trình duyệt, file không được gửi đi đâu):

1. Bạn chọn file `.xlsx` trong tab **QC** (tối đa 20 MB; chỉ nhận `.xlsx`, không nhận `.xls` hay `.csv`).
2. Tool mở file và tìm **tab (sheet) tên `Matrix`** (không phân biệt hoa thường). Không có tab này thì báo lỗi.
3. Trong tab đó, tool tìm **dòng tiêu đề** có ô đầu tiên là `Track ID`.
4. Các ô tiêu đề còn lại trên dòng đó phải là **số frame** (0, 1, 2…). Mỗi dòng bên dưới là một object, ô đầu là ID object.
5. Ô nào có chữ **S, K, Z, H, O, D** (viết hoa hay thường đều được) thì tool ghi nhận một lỗi tại (object, frame) đó. Ô trống là không có lỗi.

Ví dụ một tab `Matrix` hợp lệ (số liệu minh hoạ tự tạo):

| Track ID | 0 | 1 | 2 | 3 | 4 |
| --- | --- | --- | --- | --- | --- |
| 1 |  | K | K |  |  |
| 2 |  |  | Z |  |  |
| 7 | S |  |  | H |  |
| 12 |  | O | O |  | D |

Đọc bảng: object 1 bị lỗi K ở frame 1 và 2; object 2 lỗi Z ở frame 2; object 7 lỗi S ở frame 0 và H ở frame 3; object 12 lỗi O ở frame 1, 2 và D ở frame 4.

**Lưu ý về định dạng:**

- Tên tab phải là `Matrix`, ô đầu của dòng tiêu đề phải là `Track ID`, các ô tiêu đề frame phải là số nguyên. File có cấu trúc khác (đổi tên tab, thêm dòng gộp ô trong bảng, ghi frame dạng `f12`…) sẽ không đọc được: hãy chỉnh lại file cho đúng dạng trên.
- Chỉ 6 mã S K Z H O D được đọc từ file. Mỗi ô nên chỉ chứa các chữ mã này (ví dụ `K` hoặc `SK`); chữ khác trong ô có thể bị nhận nhầm thành mã.
- Mã trong file luôn là mã gốc (S K Z H O D). Nếu bạn đã đổi ký hiệu hiển thị ở Threshold, màn hình đối chiếu hiện cả hai, ví dụ `L (K)`; việc đối chiếu vẫn dùng mã gốc. Nên giữ nguyên 6 mã này cho dễ đọc.
- Phần "tool tự phát hiện" dùng các rule ở tab Threshold. **Chưa có rule thì tool không phát hiện gì**, mọi lỗi trong file sẽ hiện "đã hết". Hãy nạp rule (ví dụ nạp `setting.json`) trước khi đối chiếu.

## An toàn dữ liệu

- **Không xoá, không đổi ID** object có sẵn. Ngoại lệ duy nhất: tool có thể tạo object mới từ gợi ý và chỉ xoá được chính những object do nó tạo (có xác nhận và kiểm tra lại).
- **Mọi frame outside đều có keyframe**; thiếu thì tool tự điền trước khi gửi.
- **Quyền riêng tư:** không xin quyền `cookies`, không đọc hay lưu mật khẩu / token. Tool chỉ chạy trên các máy chủ CVAT bạn tự thêm, trình duyệt hỏi quyền cho từng tên miền.
- **Dữ liệu không rời tab:** không telemetry, không tải thư viện từ mạng khi chạy, không gửi gì tới nơi khác ngoài CVAT. Hai thứ tool cho xuất ra file: Excel ghi chú QC (3 cột `ID, frame, note`) và `setting.json` (chỉ cài đặt, không có dữ liệu nhãn).
- Thay đổi được ghi qua chức năng chuẩn của CVAT dưới tài khoản của bạn.

## Phím tắt mặc định (đổi được ở tab *Phím tắt*)

| Phím | Tác dụng |
| --- | --- |
| `←` `→` | Cửa sổ frame trước / sau |
| `↑` `↓` | Object trước / sau |
| `K` | Khoá / mở khoá keyframe |
| `O` | Đánh dấu outside / đưa object trở lại |
| `G` | Đáy box chạm mặt đường |
| `A` / `I` | Chấp nhận / bỏ qua gợi ý sửa box |
| `F` | Thu nhỏ tool, zoom cận cảnh object trong CVAT |
| `Ctrl+Z` `Ctrl+Y` | Hoàn tác / làm lại |
| `` ` `` | Thu nhỏ / mở lại cửa sổ tool |

`K`, `O`, `G`, `A`, `I` tác dụng lên cột frame đang trỏ chuột, nếu không thì frame đã chọn.

## Giới hạn đã biết

- Tool dựa vào cách CVAT **2.77.1** hoạt động bên trong; đổi phiên bản CVAT có thể phải sửa tool.
- Bản Firefox chỉ là bản thử, chưa chạy thử trong Firefox thật.
- **Trôi box** chỉ bắt box giữ nguyên toạ độ so với xe khi xe đang chạy, không bắt box nhích chậm quanh vị trí đúng.
- Gợi ý attribute theo kích thước box chưa kiểm trên dữ liệu thật cho Animal / Obstacle.
- Mặt đường **patchwork++** và hệ thống gợi ý mặt đường là thử nghiệm; đo trên đường ướt (có lớp phản chiếu) thì cả local lẫn patchwork++ đều có thể sai, nên so bằng mắt.

## Dành cho người phát triển

Cần Node.js 20+. Trên Windows chạy `build.bat` (tự cài Node.js, `npm install`, `npm run build`).

```bash
npm install
npm run build           # Edge / Chrome → dist/
npm run build:firefox   # Firefox → dist-firefox/
npm test                # test với dữ liệu tổng hợp, không cần CVAT
npm run typecheck
```

TypeScript + Vite, giao diện React trong iframe của extension, WebGL cho hình chiếu điểm. Content script là nơi duy nhất gọi API CVAT; panel nói chuyện với content script qua `postMessage` có kiểm tra nguồn. Mã nguồn nằm trong `src/` (`content`, `panel`, `shared`, `background`, `options`), test trong `test/`. Thư mục `backups/` chứa dữ liệu cục bộ và không bao giờ được commit.
