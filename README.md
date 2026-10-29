# CVAT 3D Labeling Assistant

Extension trình duyệt (Manifest V3) giúp **review và sửa nhãn cuboid 3D trên point cloud** ngay trong tab job của CVAT (bản tự host, CVAT 2.77.1). Tool đọc và ghi nhãn **bằng chính phiên đăng nhập sẵn có của tab**, không cần tải dữ liệu về máy.

Chạy trên **Edge / Chrome** (đã dùng thử) và **Firefox 128+** (bản thử, xem [Firefox](#firefox)).

> ⚠️ Môi trường mục tiêu là **dữ liệu thật**, không có job sandbox. Mọi thao tác ghi đều đi qua màn hình xem lại, có nhật ký để hoàn nguyên. Xem [Luật an toàn](#luật-an-toàn).

## Tính năng

| Nhóm | Mô tả |
| --- | --- |
| **Batch Review** | Cửa sổ frame tự chọn (a → b, mặc định 6 frame, mỗi trang chung 1 frame với trang kề) × 3 hình chiếu (Trên / Bên / Trước, mỗi view có khung và nhãn riêng) quanh một object; zoom bằng con lăn, **giữ chuột phải kéo để dời khung nhìn** (mọi frame cùng dời), nút **⌖ Về giữa**; bấm đúp vào cột frame để thu nhỏ tool và focus camera 3D của CVAT; ID object theo đúng ID hiển thị của CVAT; mở được khi đã tải và tính xong 60 frame đầu, phần còn lại tải ngầm |
| **Bảng object** | Số frame được gán / outside / thiếu keyframe outside, cảnh báo đi xa, luật QC (rê chuột xem số frame theo từng mã, gồm cả ít điểm `P`), trôi box, chồng lấn, gợi ý thuộc tính, **khoảng cách tới ego** (tại một frame hoặc gần nhất cả track); lọc và sắp xếp; ô còn đang tải ngầm có viền vàng |
| **Chỉnh sửa trực tiếp** | Kéo thả trên 3 hình chiếu: dời, đổi kích thước (cạnh đối diện đứng yên), xoay yaw (chấm trắng hoặc giữ Alt), nghiêng box theo mặt đường dốc (Alt + kéo ở view Bên / Trước); zoom chung mọi frame; hoàn tác / làm lại |
| **Keyframe & outside** | Khoá / mở khoá từng frame, mở khoá keyframe ở giữa một khoảng, khoá tất cả thành keyframe; outside theo 3 cách: từ frame đang chọn (O), cả khoảng nhập tay, chọn khoảng bằng chuột; box được sao lưu trước khi outside để đưa trở lại đúng vị trí cũ |
| **Dynamic size** | Bật / tắt theo class (danh sách class lấy từ job), theo từng giá trị attribute, hoặc riêng từng object; tắt thì đổi size một frame là áp cho cả object (mặt đứng yên giữ nguyên) |
| **Cảnh báo & gợi ý** | Box lệch khỏi cụm điểm (kèm box gợi ý nét đứt, chấp nhận bằng A; có công tắc tắt), vật đi xa bất thường, **trôi box** (toạ độ ego của box không đổi trong khi xe chạy, tức box bị giữ nguyên thay vì bám vật; chỉ so hai frame liền nhau nên rất nhẹ, và bỏ báo khi box vẫn còn đủ điểm do vật chạy cùng vận tốc với xe), ít điểm (< 6), **đáy lơ lửng / chìm** so với mặt đường đo riêng cho từng object tại từng frame (8 cung quanh box + lớp điểm dưới gầm, báo khi cao > 10 cm / thấp > 5 cm và vượt độ bất định, chỉ trong bán kính 80 m quanh ego), **ground snap** (G, hỗ trợ mặt dốc), công tắc **hiện mặt đường ego (Oxy)** vẽ vạch z = 0 ở view Bên / Trước của mọi frame; **luật QC** S K Z H D (scale không đồng bộ, kích thước ngoài ngưỡng, z ngoài ngưỡng, đổi hướng > 40°, quá xa > 80 m), **chồng lấn** (mọi cặp có phần giao nhìn từ trên) và **outside liên tục từ 6 frame** kèm nút ✂ tách ID |
| **QC** | Hai phần riêng: **QC note** (QC mode: ghi chú theo (ID, frame), xuất Excel `ID, frame, note` và **nhập lại** file đó để chuyển ghi chú giữa các máy, có xem trước và chọn giữ / ghi đè khi trùng) và **QC comparison** (đối chiếu file báo cáo QC .xlsx, đọc sheet Matrix ngay trên máy, đánh dấu từng flag còn lỗi / đã hết / ignore / fixed) |
| **Thuộc tính (attribute)** | Hiện và sửa attribute của object; gợi ý theo kích thước box (loại xe, tuổi / tư thế người đi bộ, có người lái xe hai bánh…) |
| **Upload** | Màn hình xem lại → ghi bằng `PATCH …/annotations?action=update` chia lô → đọc lại so khớp; tự điền keyframe outside, tự khoá hết thành keyframe cho object đã tác động; nhật ký + hoàn nguyên |
| **Ca làm việc / KPI** | Ca tự động theo lịch, không cần chấm công (sáng 8:30–12:30, chiều 13:30–17:30, ngoài giờ là OT; cảnh báo 15 phút trước khi hết ca; tên ca `Oct21AM`, `Oct21PM`, `Oct21OT`…, lưu qua F5), KPI: object đã tác động, số frame đã thay đổi thật (sửa tay, nội suy, outside), số frame outside, keyframe thêm / gỡ / sửa, gợi ý chấp nhận / bỏ qua |
| **Liên kết với CVAT** | Chọn object trong CVAT → tool chọn theo; chọn trong tool → CVAT kích hoạt object (đổi frame nếu cần); bấm đúp trong CVAT mở rộng tool; nút **Focus** thu nhỏ tool và zoom cận cảnh object trong khung 3D của CVAT |
| **Giao diện** | Cửa sổ nổi kéo / đổi cỡ / thu nhỏ / phóng to; thanh đầu dính khi cuộn; **giao diện tối và xám** (nút ◐ / 🌙 / 🌫 / ☀ ở đầu panel: tự động theo hệ điều hành, tối, xám, sáng); cỡ ô tự khớp màn hình; phím tắt tùy chỉnh (cảnh báo trùng phím); ảnh camera căn giữa, có kính lúp |
| **Nháp** | Bản nháp chưa upload được lưu cục bộ để F5 không mất; sau upload tool tự tải lại tab CVAT rồi mở lại đúng tab / object / cửa sổ frame đang làm |
| **Tải nền** | Bật tool là tải point cloud cả job **theo chunk** (một request cho cả job như giao diện CVAT: job 65 frame ~33 s thay vì ~5 phút tải từng frame; kiểm chứng file đầu trùng frame 0 và đủ số file, sai thì quay về tải từng frame, tối đa 2 kết nối), có thanh tiến độ và dải **✅ Đã tải xong** ngay trong tool; nút **↻ Tải lại frame** (chỉ frame lỗi hoặc tất cả, ngắt mọi request đang treo, hiện tiến trình chunk); kết quả tính (ít điểm, mặt đường) lưu theo job nên tải lại tab không phải tính lại từ đầu, chỉ tính lại box đã đổi |
| **Nhiều máy chủ CVAT** | Thêm tên miền CVAT khác ở trang **Cài đặt** của extension (không cần sửa code); dữ liệu theo job tách riêng theo máy chủ |

## Luật an toàn

Các luật này được kiểm tra bằng code và test, không có ngoại lệ (chi tiết ở tài liệu nội bộ của dự án):

1. **Không bao giờ xóa hay đổi ID của object có sẵn.** Không có đường nào gửi `PUT` thay cả annotation; trước mỗi lần ghi, ID nào biến mất so với lúc đọc thì dừng. Ngoại lệ duy nhất (chủ dự án duyệt 2026-10-26): tool có thể tạo object mới từ gợi ý và chỉ xóa được những object do chính nó tạo (theo sổ ID, có xác nhận và đọc lại kiểm tra).
2. **Mọi frame outside đều có keyframe** (`outside: true`); thiếu thì được tự điền trước khi gửi.
3. **Góc box:** yaw là góc chính; roll/pitch (`rx`, `ry`) được phép để box nằm song song mặt đường dốc, kẹp ±30° và phải xác nhận khi upload (quy ước góc Euler XYZ của CVAT, chưa đối chiếu với dữ liệu thật — kiểm tra bằng mắt trên CVAT).
4. **Quyền riêng tư:** không xin quyền `cookies`, không đọc / lưu token hay mật khẩu; chỉ có host của CVAT (`https://cvat-a.example.com/*`; máy chủ CVAT khác do người dùng tự thêm ở trang Cài đặt, trình duyệt hỏi cấp quyền cho từng tên miền); request là `fetch` cùng origin với `credentials: 'include'`; token CSRF chỉ đọc đúng lúc gửi, không lưu.
5. **Dữ liệu không rời tab:** không export file dữ liệu nhãn, không telemetry, không tải thư viện lúc chạy, không gửi gì tới host khác ngoài CVAT. Ngoại lệ duy nhất được chủ dự án duyệt: QA/QC xuất Excel gồm đúng 3 cột `ID, frame, note`, tạo ngay trong trình duyệt.
6. Không giả header hay giả nhịp thao tác người; thay đổi ghi qua API chuẩn của CVAT dưới tài khoản người dùng.

## Cài đặt

Cần Node.js 20+. Trên Windows có thể chạy `build.bat`: tự cài Node.js (bằng `winget`) nếu chưa có, rồi `npm install` và `npm run build`.

```bash
npm install
npm run build           # Edge / Chrome → dist/
npm run build:firefox   # Firefox      → dist-firefox/
```

### Edge / Chrome

1. Mở `edge://extensions` (hoặc `chrome://extensions`) → bật **Developer mode**.
2. **Load unpacked** → chọn thư mục `dist`.
3. Mở một job dạng `https://<host>/tasks/<id>/jobs/<id>`, bấm biểu tượng extension để bật tool.
4. Cập nhật: build lại rồi bấm **Reload** trên thẻ extension (giữ nguyên thư mục để ID extension không đổi), sau đó tải lại tab CVAT.
5. Máy chủ CVAT khác (vd `https://cvat-b.example.com`): mở job trên máy chủ đó và bấm biểu tượng extension, trang **Cài đặt** tự mở với tên miền điền sẵn (hoặc vào chi tiết extension → *Extension options*) → **Thêm** → đồng ý khi trình duyệt hỏi quyền → bấm biểu tượng lần nữa. Gỡ bằng nút **Gỡ**.

### Firefox

Bản Firefox là **bản thử**: đã build và qua `web-ext lint` (0 lỗi) nhưng **chưa được chạy trong Firefox thật**.

```bash
npm run lint:firefox     # kiểm tra manifest và mã
npm run start:firefox    # mở Firefox với extension tạm (cần Firefox cài sẵn)
```

Hoặc `about:debugging` → *This Firefox* → **Load Temporary Add-on** → chọn `dist-firefox/manifest.json` (mất khi tắt Firefox). Lần bấm biểu tượng đầu tiên Firefox sẽ hỏi cấp quyền truy cập host của CVAT. Cài lâu dài cần ký (`npm run package:firefox` tạo file zip để nộp ký, loại không công khai) hoặc dùng Firefox Developer Edition / ESR. Lưu ý ký qua Mozilla nghĩa là mã nguồn extension được tải lên Mozilla.

## Cập nhật

Phiên bản hiện tại là **v1.2.0**. Tool không tự kiểm tra bản mới. Để cập nhật: lấy gói `cvat-3d-labeling-assistant-<phiên bản>.zip` ở trang Releases (hoặc `npm run build`), giải nén **đè vào đúng thư mục đang Load unpacked** (giữ ID extension), bấm **Reload** ở `edge://extensions`, rồi F5 tab CVAT.

## Sử dụng nhanh

- **Vào ca** trước khi làm để có KPI; **Ra ca** khi xong.
- Tab **Bảng object**: bấm một dòng để mở Batch Review của object đó. Hoặc nhập ID ở ô *Object ID*.
- Sửa trên các hình chiếu (kéo trong box = dời, kéo cạnh = đổi cỡ, giữ **Alt** kéo = xoay; giữ **chuột phải** kéo = dời khung nhìn, không sửa box). Mọi sửa đổi nằm trong **nháp** cho tới khi bấm **⬆ Upload lên CVAT…**.
- Sau khi upload, tool tự tải lại tab CVAT (giao diện CVAT còn giữ bản cũ, bấm Save ở đó có thể ghi đè) rồi mở lại đúng chỗ đang làm, không tính lại các số liệu đã có.

### Phím tắt mặc định (đổi được ở tab *Phím tắt*)

| Phím | Tác dụng |
| --- | --- |
| `←` `→` | Cửa sổ frame trước / sau |
| `↑` `↓` | Object trước / sau (ID ∓ 1) |
| `,` `.` | Chọn cột frame bên trái / phải |
| `K` | Khoá / mở khoá keyframe |
| `Alt+K` | Mở khoá keyframe ở giữa khoảng frame (giữ hai đầu mút) |
| `O` | Gắn keyframe outside / đưa object trở lại |
| `G` | Ground snap (đáy box chạm mặt đường) |
| `A` / `I` | Chấp nhận / bỏ qua gợi ý sửa box |
| `F` | Focus: thu nhỏ tool, zoom cận cảnh object trong CVAT |
| `+` `-` `0` | Zoom vào / ra / về vừa object (`0` cũng đưa khung nhìn về giữa) |
| `Ctrl+Z` `Ctrl+Y` | Hoàn tác / làm lại |
| `` ` `` | Thu nhỏ / mở lại cửa sổ tool (dùng được cả ở trang CVAT) |

`K`, `O`, `G`, `A`, `I` tác dụng lên **cột frame đang trỏ chuột** (viền xanh), nếu không thì frame đã chọn, và với `G` / `A` / `I` là cả cửa sổ.

## Phát triển

```bash
npm test               # vitest, dùng dữ liệu tổng hợp, không cần CVAT
npm run typecheck      # tsc --noEmit
npm run build:all      # cả hai bản
```

- **Công nghệ:** TypeScript + Vite, giao diện React trong iframe của extension (tránh CSP của trang), WebGL (dự phòng canvas 2D) cho hình chiếu điểm, `fflate` giải nén ảnh camera. Mọi thứ đóng gói sẵn, không tải gì lúc chạy.
- **Kiến trúc:** content script là điểm **duy nhất** gọi API CVAT; panel (iframe) nói chuyện với content script qua `postMessage` có kiểm tra origin và mã phiên ngẫu nhiên; background chỉ bật / tắt theo tab và chạy một hàm nhỏ trong ngữ cảnh trang để zoom camera 3D của CVAT.

```
src/
  background/   bật tắt theo tab; chạy hàm focus camera 3D trong ngữ cảnh trang
  content/      cvatClient (đọc; ghi chỉ update/create, dry-run mặc định), uploader, cửa sổ nổi, đọc / điều khiển DOM của CVAT
  panel/        giao diện React: bảng object, Batch Review, thuộc tính, upload, ca / KPI, phím tắt
  options/      trang Cài đặt: thêm / gỡ máy chủ CVAT
  shared/       logic thuần (nội suy, luật, gợi ý, ground snap, upload, KPI, keymap…) — phần lớn code test được
test/           unit test với fixtures tự tạo (không dùng dữ liệu thật)
public/         manifest.json (Edge / Chrome) và manifest.firefox.json
PLAN.md         kế hoạch đã duyệt        GUIDELINE.md  guideline gán nhãn gốc
NOTES.md        nhật ký quyết định, kết quả khảo sát và những gì chưa xác minh
```

Test dùng dữ liệu tổng hợp; một số test đối chiếu dữ liệu thật tự bỏ qua nếu không có thư mục `backups/` (thư mục này **không bao giờ được commit**, đã nằm trong `.gitignore`).

## Giới hạn đã biết

- Tool dựa vào **nội bộ của CVAT 2.77.1** (tên class trong DOM, kho trạng thái React, hàm `focus` của canvas 3D); đổi phiên bản CVAT có thể phải sửa.
- Chỉ tạo track mới khi tách ID; chưa nội suy cải tiến / bake tối thiểu, chưa có đề xuất cuboid đầy đủ (fit L-shape, mặt đường toàn cảnh); chưa chặn upload khi thiếu attribute bắt buộc.
- **Trôi box** chỉ bắt box giữ nguyên toạ độ ego khi xe chạy (thường là giữ sau keyframe cuối hoặc trước keyframe outside); không bắt box nhích chậm quanh vị trí đúng (cần ước lượng chính xác chuyển động ego, thuật toán cũ làm vậy nhưng nặng và báo sai khi job dài). Vật chạy cùng vận tốc với xe có thể bị báo nhầm ở vài frame đầu nếu số điểm trong box chưa tính xong hoặc quá thưa.
- Bản Firefox chưa chạy thử thật; tính năng điều khiển giao diện CVAT (sự kiện giả lập, tin nhắn giữa iframe và content script) là chỗ dễ khác nhau giữa trình duyệt.
- Gợi ý attribute dựa vào kích thước box (ngưỡng cố định trong code); quy tắc cho Animal / Obstacle chưa kiểm trên dữ liệu thật.

Chi tiết từng quyết định và số liệu khảo sát nằm trong [`NOTES.md`](NOTES.md).
