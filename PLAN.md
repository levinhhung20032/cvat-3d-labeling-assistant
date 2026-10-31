# Kế hoạch Extension Edge hỗ trợ gán nhãn CVAT

Cập nhật 22/10/2026

## Mục tiêu & phạm vi

Extension Edge (Manifest V3) mở một bảng làm việc ngay trong tab job CVAT, đọc nhãn của job đó qua phiên đăng nhập sẵn có, cho review và sửa nhanh, rồi đẩy lại vào chính job — không cần tải dữ liệu về máy.

**Môi trường:** CVAT 2.77.1 tự host tại `https://cvat-a.example.com`, dữ liệu point cloud, nhãn cuboid 3D. Hệ tọa độ gắn với ego: Ox (đỏ) hướng trước, Oy (xanh lá) hướng trái, Oz (xanh dương) hướng lên, đơn vị mét, gốc ở mặt đất dưới xe.

**Trong phạm vi bản đầu**

- Đọc nhãn của job đang mở (shapes, tracks, keyframe) vào bộ nhớ dưới dạng JSON.
- Batch Review: 6 frame mỗi lượt (0–5, 5–10, 10–15…) và danh sách toàn bộ frame.
- Sửa trực tiếp: kéo thả cuboid trên view, bật/tắt keyframe từng frame, gỡ keyframe ở giữa một khoảng, lưu mọi chỉnh sửa thành keyframe.
- Nội suy tốt hơn nội suy tuyến tính của CVAT, kèm chế độ dynamic size bật/tắt theo nhãn.
- Đề xuất cuboid; đề xuất được chấp nhận chỉ nằm trong nháp tới khi người dùng duyệt upload.
- Upload về job qua đúng API mà giao diện CVAT dùng khi bấm Save.

Bổ sung: bảng object, ảnh 8 camera, đề xuất kích thước cho vật cố định size, tìm mặt đường ở vùng xa, đề xuất outside, cảnh báo cuboid vô lý, merge và tách ID theo luật riêng của tool, kiểm tra tự động theo guideline gán nhãn.

**Ngoài phạm vi**

- Tải ảnh, point cloud hay file nhãn ra máy; export dataset.
- Đọc cookie, token, mật khẩu hay hồ sơ người dùng.
- Chạy trên tab hoặc job khác ngoài tab CVAT đang bật extension.
- Gửi dữ liệu tới bất kỳ máy chủ nào ngoài chính máy chủ CVAT.
- Che giấu hay giả lập nguồn gốc thay đổi (giả header, giả nhịp thao tác người).

## Nguyên tắc thiết kế

Extension chỉ mượn phiên đăng nhập đang có của tab: mọi request xuất phát từ chính trang CVAT, nên CVAT ghi nhận đó là thao tác lưu bình thường của tài khoản người dùng — giống hệt khi bấm Save.

- **Kích hoạt theo tab.** Chỉ chèn script khi người dùng bật extension trên tab có URL dạng `/tasks/<id>/jobs/<id>` trên host cvat-a.example.com. Quyền: `activeTab`, `scripting`, `storage`, `host_permissions` chỉ gồm https://cvat-a.example.com/\*.
- **Không chạm thông tin đăng nhập.** Không xin quyền `cookies`, không lưu token. Request dùng `fetch` cùng origin với `credentials: 'include'` để trình duyệt tự gắn session. Nếu CVAT yêu cầu header CSRF, chỉ lấy giá trị tại thời điểm gửi như giao diện CVAT vẫn làm, không lưu, không gửi đi đâu khác.
- **Chỉ lấy dữ liệu của job.** Không gọi endpoint người dùng hay hồ sơ; chỉ các endpoint job, nhãn, annotation và frame (xem phần Lớp kết nối CVAT).
- **Dữ liệu không rời tab.** Frame và nhãn chỉ nằm trong bộ nhớ. Không có nút export file, không telemetry, không tải thư viện từ CDN lúc chạy — mọi thư viện đóng gói sẵn trong extension.
- **Không ghi đè ngầm.** Mọi upload đi qua màn hình diff và cần người dùng xác nhận.
- **Minh bạch về nguồn thay đổi.** Thay đổi được ghi dưới tài khoản người dùng qua API chuẩn của CVAT; extension không thêm cơ chế che giấu hay giả lập hành vi.

## Luật bất biến về ID và outside

Các luật này được kiểm tra ở mọi thao tác và một lần nữa ngay trước upload; vi phạm thì chặn upload, không có nút bỏ qua.

1. **Không xóa, không merge kiểu CVAT.** Không ID nào bị xóa hay bị thay bằng ID khác. Merge của CVAT xóa 2 ID cũ rồi tạo 1 ID mới nên bị cấm hoàn toàn. Lớp ghi của tool không có code gửi `action=delete`; diff thấy ID nào biến mất thì dừng upload.
2. **Mọi frame outside đều có keyframe.** Không chỉ frame đầu tiên object ra ngoài: mỗi frame outside phải có keyframe với `outside = true`, tới frame object xuất hiện lại hoặc tới cuối job. Tool tự điền khi lưu và hiện số frame còn thiếu trên bảng object.
3. **Muốn bỏ một object** thì đặt outside cho các frame liên quan, không xóa.

Mỗi lần đọc job, tool so danh sách ID với lần đọc trước (chỉ lưu danh sách ID theo job). Nếu có ID biến mất, ví dụ do ai đó dùng merge trong giao diện CVAT, tool cảnh báo đỏ và liệt kê ID đã mất.

## Kiến trúc tổng thể

Sơ đồ kiến trúc (dạng chữ):

- **Tab CVAT đang mở job (Edge)** chứa:
    - **Giao diện overlay (iframe của extension):** Batch Review 6 frame, danh sách, kéo thả cuboid, bật/tắt keyframe. ⇄ Content script; ⇄ Engine.
    - **Content script (cầu nối):** nhận diện job, gọi API CVAT bằng phiên đăng nhập sẵn có. Điểm DUY NHẤT gọi `GET/PATCH /api/jobs/:id…` tới máy chủ CVAT.
    - **Engine (Web Worker):** nội suy, dynamic size, đề xuất cuboid, tính diff. ⇄ Kho nháp.
    - **Kho nháp:** `chrome.storage.session` / IndexedDB theo job, xóa sau upload.
- **Service worker:** chỉ bật/tắt theo tab và giữ cấu hình host; chèn content script khi người dùng bật. Không chạm dữ liệu nhãn.
- **Máy chủ CVAT:** chỉ nhận request từ content script.

Content script là điểm duy nhất gọi API CVAT, bằng chính phiên của tab. Giao diện và engine chạy trong iframe của extension nhúng vào tab, nên không bị CSP của trang chặn Worker/WASM; service worker chỉ bật/tắt theo tab và giữ cấu hình host, không chạm dữ liệu nhãn.

- **Công nghệ dự kiến:** TypeScript + Vite đóng gói Manifest V3; giao diện React; point cloud vẽ bằng three.js (WebGL); engine trong Web Worker; ONNX Runtime Web (nếu dùng) chỉ thêm ở giai đoạn đề xuất.
- **Giao tiếp iframe ↔ content script** qua `postMessage`, kiểm tra origin và một mã phiên ngẫu nhiên sinh mỗi lần bật.

## Lớp kết nối CVAT

Đọc bằng GET, ghi bằng PATCH theo diff (create / update / delete) thay vì PUT thay toàn bộ, để chỉ chạm đúng phần đã sửa. Annotation của job gồm `tags`, `shapes` và `tracks`; mỗi track chứa danh sách shape theo frame với cờ `keyframe` và `outside` ([tài liệu API](https://www.mintlify.com/cvat-ai/cvat/api/annotations)).

| Việc | Endpoint | Ghi chú |
| --- | --- | --- |
| Thông tin job | `GET /api/jobs/{id}` | khoảng frame, task, chiều dữ liệu 2D/3D |
| Nhãn và thuộc tính | `GET /api/labels?job_id={id}` | id nhãn, loại shape, attribute |
| Đọc annotation | `GET /api/jobs/{id}/annotations` | `version`, `tags`, `shapes`, `tracks` |
| Meta frame | `GET /api/jobs/{id}/data/meta` | kích thước, frame bị xóa |
| Đọc frame | `GET /api/jobs/{id}/data?type=frame&number=N` | trả point cloud của frame — xác minh định dạng (PCD/BIN, nén) ở giai đoạn 0 |
| Ghi thay đổi | `PATCH /api/jobs/{id}/annotations?action=…` | `create`, `update`, `delete` |

- Từ bản 2.42, PATCH/PUT bắt buộc có id khi update và không có id khi create ([changelog CVAT](https://www.cvat.ai/resources/changelog/digest-july-2025)) — lớp ghi phải tách rõ object mới (id tạm) và object sẵn có.
- Sửa một track = gửi lại cả track với danh sách shape mới qua `action=update`.
- Có lớp adapter theo phiên bản CVAT, vì tên trường và luật kiểm tra thay đổi giữa các bản.
- Mọi endpoint và cơ chế CSRF trong bảng sẽ được xác minh trên bản CVAT thực tế bằng cách quan sát request của chính giao diện CVAT ở giai đoạn 0.

**Cuboid 3D:** CVAT mô tả cuboid point cloud bằng vị trí, góc quay và kích thước; định dạng Datumaro 3D tách thành ba trường `position`, `rotation`, `scale` ([ví dụ](https://github.com/cvat-ai/cvat/issues/5775)). Trong REST API ba nhóm này nằm chung mảng `points`; thứ tự và độ dài mảng sẽ xác minh trên một track thật ở giai đoạn 0. 8 ảnh camera đi kèm (image\_0 đến image\_7) cũng đọc qua endpoint data của job — cần xác minh.

## Mô hình dữ liệu nội bộ

Tool giữ hai lớp: **baseline** (bản chụp đúng như CVAT trả về lúc đọc) và **working** (bản đang sửa); mọi tính năng chỉ ghi vào working, diff giữa hai lớp là thứ được upload.

| Đối tượng | Trường chính | Ghi chú |
| --- | --- | --- |
| Track | id CVAT hoặc id tạm, `label_id`, cờ dynamic size, các khoảng outside | id tạm cho object mới, đổi sang id thật sau upload |
| Keyframe | frame, trạng thái cuboid, attribute của frame đó, nguồn (`cvat` / `edited` / `suggested`) | chỉ keyframe mới được lưu; frame khác là nội suy |
| Trạng thái cuboid | vị trí (x, y, z), yaw (rz; rx, ry khóa bằng 0), kích thước (sx, sy, sz) | định dạng `points` thật xác minh từ job mẫu |
| Đề xuất | track, frame, cuboid, độ tin cậy, trạng thái chờ/chấp nhận/từ chối | chấp nhận → thành keyframe nguồn `suggested` |
| Cấu hình nhãn | dynamic size mặc định, ngưỡng sai số khi bake | lưu theo host + dự án |

- Frame không phải keyframe luôn được tính lại từ keyframe, không lưu riêng, để tránh dữ liệu mâu thuẫn.
- Có ngăn xếp undo/redo trên lớp working.
- Khi đọc, tool ghi lại `version` của annotation để phát hiện xung đột trước khi ghi.

## Chế độ Batch Review

Chọn một object ID, tool hiện 6 frame liên tiếp, mỗi frame đủ 3 hình chiếu quanh object; cửa sổ trượt bước 5 nên frame cuối nhóm này là frame đầu nhóm sau (0–5, 5–10, 10–15…), giúp thấy chuyển động liền mạch giữa các lượt.

**Bố cục:** 6 cột frame × 3 hàng hình chiếu (trên, bên, trước), thêm một hàng ảnh camera nhìn thấy object. Mọi ô cùng tỉ lệ và căn tâm theo object để so trực tiếp giữa các frame.

- **Cửa sổ thứ k** = frame 5k đến 5k+5, cắt tại frame cuối của job; số frame và bước trượt để trong cấu hình.
- **Chọn theo object ID:** chọn ở bảng object hoặc bấm vào box; ←/→ đổi cửa sổ, ↑/↓ sang ID kế tiếp, K bật/tắt keyframe ở ô đang chọn.
- **Danh sách frame** ở cột bên: đánh dấu frame đã sửa, có đề xuất, có cảnh báo; bấm để nhảy tới cửa sổ chứa frame đó.
- **Hiệu năng:** mỗi ô chỉ dựng các điểm trong vùng quanh object nên 18 ô vẫn nhẹ; tải trước cửa sổ kế tiếp, cache LRU.
- **Ký hiệu:** keyframe CVAT, keyframe vừa sửa, frame nội suy, frame outside, đề xuất và cảnh báo có màu/viền khác nhau; mọi view hiện mũi tên đỏ chỉ hướng box.

**Bảng object** — mỗi hàng một ID, sắp xếp và lọc được; bấm hàng để mở Batch Review của ID đó.

| Cột | Nội dung |
| --- | --- |
| ID | ID hiển thị như trong CVAT, kèm nhãn |
| Frame được gán | số frame object có box (không outside) |
| Frame outside | số frame object ở trạng thái outside |
| Outside thiếu keyframe | số frame outside chưa có keyframe — phải bằng 0 mới được upload |
| Khoảng frame | frame đầu và frame cuối có box |
| Cảnh báo | số frame có cuboid vô lý, không tính cảnh báo đã bỏ qua |

**Ảnh camera:** task có 8 ảnh RGB `image_0` … `image_7`. Tool tự chọn camera nhìn thấy object theo góc phương vị của tâm cuboid, atan2(y, x) — 0° là phía trước, +90° là bên trái, và cho đổi tay sang camera khác.

| Ảnh | Hướng | Yaw ước lượng | Ống kính | Dấu hiệu nhận ra trên ảnh mẫu |
| --- | --- | --- | --- | --- |
| image\_0 | sau | 180° | góc rộng | thân sau xe ở đáy ảnh; dãy nhà mái vòm bên phải ảnh, tức phía sau-trái của xe |
| image\_1 | trước | 0° | góc rộng, qua kính lái | đường có dải phân cách phía trước, hàng rào công trường Masteri bên phải |
| image\_2 | trái trước | ≈ +45° | góc rộng | đường phía trước (khớp image\_1) ở mép phải ảnh, công viên ở giữa |
| image\_3 | trái | ≈ +90° | fisheye | nhà mái vòm bên trái ảnh (phía sau), công viên bên phải ảnh (phía trước) |
| image\_4 | trái sau | ≈ +110° | fisheye | cùng cảnh image\_3 nhưng xoay khoảng 20° về phía sau; thấy gương trái |
| image\_5 | phải trước | ≈ −45° | góc rộng | cổng Masteri và hàng rào công trường, nối tiếp mép phải image\_1 |
| image\_6 | phải | ≈ −90° | fisheye | cổng Masteri bên trái ảnh (phía trước), đường kéo về phía sau ở bên phải ảnh |
| image\_7 | phải sau | ≈ −110° | fisheye | cùng cảnh image\_6 nhưng xoay về phía sau; thấy gương phải |

Ánh xạ image\_0 … image\_7 khớp với ảnh mẫu thực tế. Yaw là ước lượng từ ảnh, sai số khoảng ±15°, và lưu trong cấu hình để chỉnh được. Bốn camera bên hông (3, 4, 6, 7) là fisheye phủ gần 180° nên vùng nhìn chồng lấn nhiều. Vì vậy tool không chia vùng cố định mà xếp camera theo độ lệch giữa góc phương vị của object và yaw của camera: ưu tiên camera góc rộng (0, 1, 2, 5) khi object nằm trong vùng nhìn của chúng vì ít méo, nếu không thì dùng camera fisheye gần nhất, kèm một camera dự phòng để đổi nhanh.

**Tự hiệu chỉnh hướng camera**

Yaw và vùng nhìn ngang của từng camera được tính lại từ chính các object đã gán, không cần file calibration.

1. Chọn một camera; tool gợi ý 3–5 object đã gán nằm rải đều trong vùng nhìn của camera đó, ưu tiên object ở xa để giảm sai lệch do camera và lidar không đặt cùng một chỗ.
2. Người dùng bấm vào tâm từng object trên ảnh.
3. Biết góc phương vị của từng object (tính từ tâm cuboid), tool fit yaw và vùng nhìn ngang của camera: mô hình pinhole cho camera góc rộng (0, 1, 2, 5), mô hình equidistant cho fisheye (3, 4, 6, 7).
4. Tool hiện sai số còn lại của từng điểm, loại điểm lệch bất thường; người dùng xem rồi lưu vào cấu hình.
5. Sau khi lưu, ảnh camera hiện một vạch dọc đánh dấu phương của object đang chọn, nên dù chưa có calibration đầy đủ vẫn tìm nhanh được object trên ảnh.

Kết quả lưu cục bộ theo host + dự án, dùng chung cho mọi job cùng bộ cảm biến; chạy lại khi bộ gắn camera thay đổi.

Chiếu cuboid lên ảnh chỉ làm được khi có thông số calibration camera (camera 3, 4, 6, 7 cần mô hình fisheye); nếu không có, ảnh chỉ để đối chiếu.

## Chỉnh sửa trực tiếp & keyframe

Mọi thao tác sửa trên một frame tự biến frame đó thành keyframe nguồn `edited` (giống CVAT), và mọi thao tác keyframe đều có xem trước nội suy trước khi áp dụng.

- **Kéo thả bằng chuột:** kéo thân để dời, kéo tay nắm ở mặt để đổi kích thước, kéo tay nắm góc để xoay. Thao tác trên ba hình chiếu (trên, bên, trước) như CVAT, vì kéo thả trực tiếp trong khung 3D phối cảnh khó chính xác; xoay yaw trên hình chiếu từ trên.
- **Bật/tắt keyframe từng frame:** tắt thì giá trị frame đó trở về nội suy từ hai keyframe gần nhất; bật thì giá trị hiện tại được giữ cố định.
- **Gỡ keyframe ở giữa:** chọn một khoảng (ví dụ 1–4 hoặc 6–10), tool gỡ mọi keyframe nằm hẳn bên trong và giữ hai đầu mút, rồi hiện đường nội suy mới để duyệt.
- **Lưu tất cả thành keyframe:** biến mọi frame đã sửa (và tùy chọn: đề xuất đã chấp nhận) thành keyframe. Có thêm lệnh "bake" một khoảng: ghi kết quả nội suy của tool thành keyframe để CVAT hiển thị đúng như trong tool.
- **Undo/redo** cho mọi thao tác, kể cả thao tác theo khoảng.

## Merge và tách ID

Cả hai thao tác chỉ thêm box và đặt outside, không bao giờ xóa ID, và luôn có xem trước cùng diff trước khi áp dụng. Attribute thay đổi theo frame (như pose, ride\_state) được giữ đúng giá trị ở từng frame.

**Merge B vào A** — dùng khi prelabel mất track ID A rồi gán tiếp chính vật đó thành ID B.

1. Chọn ID A (giữ lại) và ID B (nguồn). Tool kiểm tra: cùng class, vị trí và vận tốc liên tục giữa frame cuối của A và frame đầu của B, khoảng trống dưới 6 frame. Không đạt thì cảnh báo và đề xuất giữ hai ID riêng, theo nguyên tắc của guideline là nghi ngờ thì tạo ID mới.
2. Mọi box của B được chép vào A thành keyframe ở đúng frame đó; track A kéo dài tới frame cuối của B.
3. B giữ nguyên ID; mọi frame từng có box của B chuyển thành outside có keyframe.
4. Khoảng trống giữa frame cuối của A và frame đầu của B: mọi frame đều đánh outside có keyframe.
5. Nếu A và B cùng có box ở một frame, tool dừng và cho chọn box giữ lại ở từng frame.
6. Nhãn hoặc attribute khác nhau giữa A và B được hiện ra để chọn trước khi áp dụng.

**Tách ID** — dùng khi một ID outside liên tục từ N frame trở lên (mặc định N = 6 theo guideline, người dùng chỉnh được) rồi xuất hiện lại.

1. Bảng object đánh dấu các ID có đoạn outside từ N frame trở lên; dưới N frame thì giữ ID và đánh outside.
2. Phần sau đoạn outside thành ID mới, tạo ở cuối danh sách; ID cũ giữ phần trước và outside có keyframe từ đó tới cuối job.
3. Áp dụng cho từng ID hoặc cho mọi ID vượt ngưỡng, có xem trước.

## Nội suy cải tiến & dynamic size

CVAT chỉ lưu keyframe và tự nội suy tuyến tính giữa chúng, nên nội suy tốt hơn chỉ có tác dụng trên CVAT khi tool "bake" kết quả thành một số keyframe tối thiểu đủ để đường tuyến tính của CVAT bám sát đường của tool.

**Thuật toán đề xuất**

1. **Vị trí tâm:** spline Catmull-Rom dạng centripetal hoặc PCHIP (nội suy bậc ba đơn điệu, không vượt lố) qua các keyframe; chỉ có hai keyframe thì dùng tuyến tính.
2. **Góc quay:** mở góc (unwrap) để luôn đi đường ngắn nhất qua ±180°; roll và pitch luôn khóa bằng 0 vì box là 7-DoF, chỉ nội suy yaw.
3. **Kích thước:** dynamic size tắt → một kích thước cố định cho cả track (trung vị các keyframe, hoặc giá trị người dùng khóa); bật → nội suy PCHIP từng chiều, kẹp trong khoảng min–max của các keyframe.
4. **Làm mượt tùy chọn:** bộ lọc Kalman vận tốc không đổi + làm mượt RTS khi keyframe tay bị rung.
5. **Outside/occluded:** không nội suy xuyên qua đoạn object ra khỏi khung.
6. **Bake thích ứng:** dựng đường tuyến tính CVAT từ các keyframe hiện có, chèn keyframe tại frame lệch lớn nhất so với đường của tool, lặp tới khi mọi frame nằm trong ngưỡng sai số (ngưỡng cấu hình theo nhãn).

**Dynamic size mặc định theo nhãn** — chỉnh được trong cấu hình và ghi đè được cho từng track.

| Class | Dynamic size | Lý do |
| --- | --- | --- |
| Vehicle (kể cả stroller) | Tắt | thân xe cứng, kích thước không đổi |
| Two-wheels | Bật | tư thế người lái làm hộp thay đổi |
| Pedestrian | Bật | vung tay, cúi, ngồi làm hộp thay đổi |
| Animal | Bật | con vật đổi tư thế |
| Obstacle | Tắt | vật cản không đổi hình dạng |

## Đề xuất cuboid

Đề xuất chạy hoàn toàn trong trình duyệt, hiện dạng hộp mờ; chỉ khi người dùng chấp nhận mới vào nháp, và nháp chỉ lên CVAT khi người dùng duyệt upload.

**Ba mức, làm dần**

1. **Ngoại suy chuyển động** (rẻ, có ngay): từ các keyframe gần nhất dự đoán frame tiếp theo theo vận tốc không đổi.
2. **Tinh chỉnh theo dữ liệu frame:**
   - 3D: lấy điểm trong vùng dự đoán nới rộng, loại mặt đất (RANSAC mặt phẳng), gom cụm, fit hộp (L-shape hoặc PCA cho góc quay), giữ kích thước cố định nếu dynamic size tắt.
   - Hiện ảnh camera nhìn thấy object để kiểm tra nhanh; chiếu cuboid lên ảnh nếu có calibration (chỉ để hiển thị, không dùng để fit).
3. **Mô hình nhỏ đóng gói sẵn** (tùy chọn, làm sau): ONNX Runtime Web chạy trong extension, không gọi máy chủ ngoài.

**Thao tác với đề xuất**

- Mỗi đề xuất có độ tin cậy; lọc ẩn đề xuất dưới ngưỡng.
- Chấp nhận (A), từ chối (R), chỉnh rồi chấp nhận, hoặc chấp nhận cả cửa sổ 6 frame.
- Đề xuất đã chấp nhận thành keyframe nguồn `suggested`, có thể gỡ lại bất cứ lúc nào trước upload.

**Tìm mặt đường ở vùng xa**

Ở xa lidar, điểm mặt đường thưa nên đáy cuboid dễ lơ lửng hoặc chìm. Tool ước lượng mặt đường rồi đề xuất đặt đáy cuboid lên đó:

1. Vùng gần: chia lưới trên mặt xy, lấy điểm thấp nhất mỗi ô làm ứng viên mặt đất.
2. Fit mặt đường theo từng dải khoảng cách (RANSAC mặt phẳng từng đoạn), cho phép độ dốc đổi dần.
3. Ngoại suy ra vùng xa, kết hợp các điểm mặt đất thưa còn sót ở vùng xa nếu có.
4. Gốc tọa độ nằm trên mặt đất dưới xe nên z = 0 là mốc mặt đường quanh ego; độ cao đáy của chính track ở các frame liền kề dùng làm ràng buộc liên tục theo thời gian (tọa độ theo ego nên không cộng dồn điểm giữa các frame).
5. Kết quả là một đề xuất như mọi đề xuất khác: người dùng chấp nhận hoặc bỏ.

**Đề xuất outside**

Khi số điểm lidar trong cuboid dự đoán dưới ngưỡng (mặc định 6 điểm theo guideline) ở nhiều frame liên tiếp, tool đề xuất chuyển các frame đó thành outside có keyframe. Người dùng chấp nhận hoặc từ chối theo từng frame hay cả đoạn.

## Đề xuất kích thước cho vật cố định size

Với nhãn tắt dynamic size (Vehicle, Obstacle), tool quét mọi frame của track, chấm độ rõ của point cloud theo từng chiều, rồi lấy dài, rộng, cao từ những frame tốt nhất cho chiều đó — mỗi chiều có thể đến từ một frame khác nhau.

1. **Cắt điểm theo frame:** ở mỗi frame có box, lấy điểm trong box nới rộng một biên nhỏ, bỏ điểm mặt đường và điểm thuộc box khác, rồi đưa về hệ tọa độ riêng của object (tâm và yaw của box ở frame đó).
2. **Chấm điểm từng chiều** theo số điểm, khoảng cách tới lidar, mức bị che và góc nhìn:
   - dài: rõ khi thấy hông vật và cả hai đầu;
   - rộng: rõ khi thấy mặt trước hoặc mặt sau;
   - cao: rõ khi có điểm cả ở nóc lẫn sát mặt đường.
3. **Đo từng chiều** ở các frame điểm cao bằng độ trải điểm theo trục đó, dùng phân vị cao để bỏ nhiễu thay vì min–max, không cộng biên, để box sát đúng phần vật quan sát được: bao trọn mà không dư thừa.
4. **Ghép nhiều frame:** mỗi chiều lấy từ frame tốt nhất cho riêng chiều đó, ví dụ frame rõ nhất cho cao và rộng nhưng chiều dài lấy từ frame khác thấy trọn hông. Một frame chỉ thấy một phần vật cho số đo nhỏ hơn thật, nên tool ưu tiên frame thấy trọn chiều thay vì lấy trung bình.
5. **Cộng dồn khi không frame nào đủ rõ:** gộp điểm của nhiều frame vào hệ tọa độ của object (theo pose box từng frame, tinh chỉnh nhẹ bằng ICP) rồi fit hộp bao trên đám điểm gộp.
6. **Kiểm tra hợp lý:** so với khoảng kích thước điển hình của nhãn (cấu hình được); lệch nhiều thì cảnh báo thay vì đề xuất.

**Hiển thị và áp dụng**

- Dài × rộng × cao đề xuất, kèm độ tin cậy và frame nguồn của từng chiều; bấm để nhảy tới frame đó trong Batch Review.
- Khi chấp nhận, size mới áp cho mọi keyframe của track. Tâm box được dời sao cho mặt gần lidar nhất và đáy trên mặt đường giữ nguyên, phần thay đổi dồn về phía khuất, để mặt đang khớp với điểm không bị lệch.
- Chạy cho một ID hoặc cho mọi ID thuộc nhãn kích thước cố định; kết quả vào nháp như mọi đề xuất khác.

## Cảnh báo cuboid vô lý

Cuboid vi phạm được tô màu cảnh báo ngay trên giao diện chính (viền đỏ trên view, ô frame đỏ, cột Cảnh báo trên bảng object), kèm danh sách để nhảy tới từng chỗ.

| Tình huống | Cách phát hiện | Gợi ý xử lý |
| --- | --- | --- |
| Một cụm điểm bị gán 2 object | hai cuboid cùng frame chồng nhau trên hình chiếu từ trên từ 30% diện tích box nhỏ hơn trở lên, hoặc dùng chung phần lớn điểm, trừ các cặp class được phép chồng (phần Kiểm tra theo guideline) | merge B vào A, hoặc đặt outside cho box thừa |
| Ego đã đi xa nhưng box vẫn còn | khoảng cách tâm box tới gốc tọa độ ego vượt 30 m (mặc định, cấu hình được), hoặc không còn điểm nào trong box qua nhiều frame | đề xuất outside cho đoạn đó |
| Kích thước nhảy ở nhãn kích thước cố định | lệch so với kích thước cố định của track | khóa lại kích thước |
| Góc yaw đổi đột ngột | thay đổi giữa hai frame liền kề vượt ngưỡng | sửa keyframe hoặc nội suy lại |
| Frame outside thiếu keyframe | so khoảng outside với danh sách keyframe | tự điền khi lưu |

Mọi ngưỡng cấu hình được theo nhãn.

**Bỏ qua cảnh báo:** mỗi cảnh báo có nút Ignore cho một frame, một đoạn frame, hoặc cả cặp object chồng lấn. Cảnh báo đã bỏ qua mất màu và chuyển sang danh sách "Đã bỏ qua", bật lại được bất cứ lúc nào. Danh sách này chỉ lưu cục bộ theo job, không upload lên CVAT. Riêng "frame outside thiếu keyframe" không bỏ qua được vì là luật bất biến.

## Kiểm tra theo guideline

Các luật dưới đây lấy từ guideline gán nhãn của dự án, chạy liên tục khi làm việc và chạy lại toàn bộ ngay trước màn hình diff. Luật mức "chặn" phải sửa xong mới upload được; luật mức "cảnh báo" bỏ qua được.

| Luật | Cách kiểm tra | Mức |
| --- | --- | --- |
| Attribute bắt buộc theo class | thiếu `vehicle.subtype`, `age_group`, `pose`, `ride_state`, `animal.species` hoặc `obstacle.type` ở frame có box | chặn |
| Frame outside có keyframe | so khoảng outside với danh sách keyframe | chặn |
| Box chỉ xoay quanh trục z (7-DoF) | roll hoặc pitch khác 0 | chặn, tool tự đưa về 0 khi lưu |
| Hướng box theo hướng di chuyển | yaw lệch quá 5° (mặc định, càng nhỏ càng tốt) so với hướng quỹ đạo đã làm mượt; chỉ xét khi vật đang di chuyển rõ, vì vật đứng yên không có hướng quỹ đạo; kèm đề xuất yaw theo quỹ đạo | cảnh báo |
| Đáy box nằm trên mặt đường | đáy lơ lửng hoặc chìm so với mặt đường ước lượng | cảnh báo |
| Tối thiểu 6 điểm | box có dưới 6 điểm lidar | cảnh báo, kèm đề xuất outside |
| Track đã kết thúc không có box sau đó | ID outside từ 6 frame trở lên rồi lại có box | cảnh báo, kèm đề xuất tách ID |
| Chuyển trạng thái xuống xe | Pedestrian mới xuất hiện sát Two-wheels mà xe vẫn `with_rider` ở cùng frame | cảnh báo |
| Chồng lấn theo cặp class | theo bảng bên dưới | cảnh báo |

Tên nhãn và attribute được đọc từ cấu hình nhãn thật của job trên CVAT rồi ánh xạ sang luật, không dựa vào chữ trong guideline, vì guideline có chỗ viết khác nhau (`rider_state` / `ride_state`, Motorcycle / Two-wheels).

**Chồng lấn theo cặp class**

| Cặp class | Được chồng | Lý do |
| --- | --- | --- |
| Pedestrian – Pedestrian | Có | nhóm người đứng sát nhau |
| Pedestrian – Vehicle stroller | Có | người đẩy xe nôi, trẻ em ngồi trong xe nôi |
| Vehicle – Obstacle | Có | cửa xe mở được gán Obstacle riêng |
| Pedestrian – Two-wheels `with_rider` | Không | người lái đã nằm trong box xe |
| Các cặp còn lại | Không |  |

"Không" nghĩa là tô màu cảnh báo, vẫn bỏ qua được bằng nút Ignore.

## Nháp, đồng bộ & upload

Rủi ro lớn nhất là giao diện CVAT đang giữ bản nhãn cũ trong bộ nhớ: nếu người dùng bấm Save trong CVAT sau khi tool đã upload, bản cũ có thể ghi đè. Vì vậy luồng upload bắt đầu bằng kiểm tra xung đột và kết thúc bằng tải lại tab.

1. **Trước khi mở tool:** nhắc người dùng Save trong CVAT để không còn thay đổi chưa lưu.
2. **Khi đọc:** chụp baseline và ghi `version` của annotation.
3. **Khi sửa:** mọi thay đổi vào nháp; nháp lưu trong `chrome.storage.session` (mất khi đóng trình duyệt) hoặc IndexedDB theo host + job, có nút xóa nháp.
4. **Trước upload:** đọc lại annotation; khác baseline thì báo xung đột và cho chọn giữ bản nào theo từng track.
5. **Màn hình diff:** kết quả Kiểm tra theo guideline, số track tạo / sửa, số frame chuyển outside, keyframe thêm / bớt, danh sách theo frame; người dùng xác nhận.
6. **Upload:** chạy lại kiểm tra luật bất biến, rồi PATCH chỉ với update và create — không bao giờ gửi delete, chia lô nhỏ, thử lại khi lỗi mạng; ánh xạ id tạm sang id thật trả về.
7. **Sau upload:** đọc lại để so khớp, xóa nháp, rồi yêu cầu tải lại tab CVAT để giao diện nạp dữ liệu mới.

## Lộ trình triển khai

Lộ trình (mỗi giai đoạn chỉ mở khi qua cổng của giai đoạn trước):

| Giai đoạn | Sản phẩm | Cổng chuyển giai đoạn |
| --- | --- | --- |
| 0 · Khảo sát và POC kết nối | Xác minh API, CSRF, định dạng cuboid; dry-run. Sửa rồi trả lại 1 keyframe, chỉ dùng update | Khứ hồi khớp 100%, không tạo track thử |
| 1 · Khung extension + Batch Review | 6 frame × 3 view theo object ID, bảng object. Ảnh 8 camera, tự hiệu chỉnh hướng; chỉ đọc | Nhãn hiển thị trùng khớp với giao diện CVAT |
| 2 · Chỉnh sửa, keyframe, upload | Kéo thả, keyframe, kp cho mọi frame outside. Luật cấm xóa ID, kiểm tra guideline, diff | Dry-run + đọc lại xác minh, không lệch dữ liệu |
| 3 · Nội suy, dynamic size, merge/tách ID | Spline, yaw, kích thước cố định; bake keyframe. Merge B vào A, tách ID khi outside quá ngưỡng | Sai số thấp hơn nội suy tuyến tính của CVAT |
| 4 · Đề xuất và cảnh báo | Đề xuất size, fit cuboid, mặt đường xa, outside. Cảnh báo box chồng nhau, box ngoài tầm lidar | Đo được thời gian thao tác giảm trên job thật |
| 5 · Đóng gói và dùng thật | Cài Edge: Developer mode + Load unpacked. Hướng dẫn sử dụng, cấu hình nhãn theo dự án | Dùng trên job thật, theo dõi lỗi |

Giai đoạn 0 là cổng quan trọng nhất: nếu đọc/ghi khứ hồi chưa khớp tuyệt đối thì chưa làm tính năng nào khác. Giai đoạn 1 chỉ đọc nên an toàn để dùng thử sớm; từ giai đoạn 2 trở đi mới ghi lên CVAT. Thời lượng từng giai đoạn sẽ ước tính sau khi chốt câu hỏi 2D hay 3D.

**Giai đoạn 0 trên dữ liệu thật**

Môi trường máy chủ thử được coi là dữ liệu thật, nên giai đoạn 0 chỉ ghi ở mức tối thiểu và trả lại được:

- **Dry-run mặc định:** tool dựng payload và hiện ra để kiểm tra, không gửi cho tới khi người dùng bật ghi thật.
- **Chỉ test bằng update, không create:** trên một job được giao cho bạn, chụp giá trị gốc của một keyframe, sửa một giá trị nhỏ, đọc lại, rồi ghi trả giá trị gốc và đọc lại để so khớp. Không tạo track thử, vì luật cấm xóa ID nghĩa là track thử sẽ nằm lại vĩnh viễn.
- **Không có job sandbox:** create, merge và tách ID được kiểm thử trước bằng dữ liệu tổng hợp và dry-run trên job thật (chỉ xem diff, không gửi). Lần ghi thật đầu tiên của mỗi thao tác chỉ làm khi thao tác đó vốn cần cho công việc, có xem diff và đọc lại xác minh ngay sau khi ghi.
- **Nhật ký ghi:** mọi lần ghi ở giai đoạn 0 lưu cục bộ payload và giá trị trước/sau để đối chiếu khi cần.

## Cài đặt trên Edge

Extension được cài bằng Developer mode và Load unpacked, không qua cửa hàng add-on.

1. Giải nén bản build vào một thư mục cố định trên máy.
2. Mở `edge://extensions` và bật **Developer mode**.
3. Bấm **Load unpacked**, chọn thư mục đó.
4. Mở job trên cvat-a.example.com, bấm biểu tượng extension để bật trên tab.

- **Cập nhật:** chép đè bản build mới vào đúng thư mục cũ rồi bấm **Reload** trên thẻ extension. Giữ nguyên đường dẫn thư mục để ID extension không đổi, nhờ vậy cấu hình, hiệu chỉnh camera và danh sách cảnh báo đã bỏ qua vẫn còn.
- Không xóa hay di chuyển thư mục sau khi cài, vì Edge chạy extension trực tiếp từ đó.
- Số phiên bản ghi trong manifest và hiện trên giao diện tool để biết đang chạy bản nào.

## Rủi ro & câu hỏi cần chốt

Đã chốt loại dữ liệu và phiên bản CVAT; các câu còn lại chủ yếu ảnh hưởng cấu hình và kiểm thử, có thể chốt song song với giai đoạn 0.

**Câu hỏi cần chốt**

- [x] Loại dữ liệu: point cloud, nhãn cuboid 3D.
- [x] CVAT 2.77.1 tự host tại https://cvat-a.example.com.
- [x] 8 ảnh camera image\_0 … image\_7, hướng ghi ở phần Batch Review.
- [x] Hệ tọa độ theo ego: Ox trước, Oy trái, Oz lên, mét, gốc ở mặt đất.
- [x] Merge: khoảng trống giữa A và B đánh outside có keyframe.
- [x] Cảnh báo chồng lấn có tùy chọn bỏ qua.
- [x] Nhãn theo guideline: 5 class Vehicle, Two-wheels, Pedestrian, Animal, Obstacle kèm attribute; stroller là Vehicle.
- [x] Dynamic size: bật cho Two-wheels, Pedestrian, Animal; tắt cho Vehicle, Obstacle.
- [x] Outside từ 6 frame trở lên thì tách ID; box tối thiểu 6 điểm.
- [ ] Lấy được file thông số calibration (intrinsic, extrinsic) của 8 camera không? Có thì chiếu được cuboid lên ảnh.
- [ ] Ngưỡng đã chốt: tầm xa 30 m, lệch yaw so với quỹ đạo 5°, chồng box 30% (phần giao trên hình chiếu từ trên so với box nhỏ hơn), không cộng biên khi đề xuất size.
- [ ] Môi trường: coi máy chủ thử là dữ liệu thật (đã chốt). Không có job sandbox (đã chốt).
- [ ] Cài lên Edge: Developer mode + Load unpacked (đã chốt).
- [ ] Quy định của dự án gán nhãn có cho phép công cụ hỗ trợ trên trình duyệt không?

**Rủi ro kỹ thuật**

| Rủi ro | Hậu quả | Giảm thiểu |
| --- | --- | --- |
| Giao diện CVAT giữ bản cũ rồi Save đè | mất chỉnh sửa | kiểm tra version trước khi ghi, bắt buộc tải lại tab sau upload |
| API khác nhau giữa các bản CVAT | upload lỗi | adapter theo phiên bản, test khứ hồi ở giai đoạn 0 |
| CSP của trang CVAT chặn Worker/WASM | engine không chạy | chạy giao diện và engine trong iframe của extension, không trong trang |
| Render 6 view point cloud nặng | giật, treo tab | giảm mật độ điểm ở lưới, WebGL, cache giới hạn |
| Bake lệch so với ý người làm | nhãn sai | xem trước + diff trước upload, ngưỡng cấu hình theo nhãn |

## Kiểm thử & nghiệm thu

Mốc nghiệm thu quan trọng nhất: đọc rồi ghi lại mà không sửa gì thì nhãn trên CVAT phải giữ nguyên tuyệt đối.

- [ ] **Khứ hồi rỗng:** đọc → upload không thay đổi → đọc lại, so khớp từng giá trị.
- [ ] **Unit test engine:** góc quay qua ±180°, kích thước cố định khi dynamic size tắt, không nội suy xuyên đoạn outside, bake tái tạo đúng trong ngưỡng.
- [ ] **Test tích hợp:** bằng dữ liệu tổng hợp và dry-run trên job thật — tạo / sửa track, bật/tắt keyframe, gỡ keyframe theo khoảng, chấp nhận đề xuất.
- [ ] **Test xung đột:** sửa trong giao diện CVAT khi tool đang mở → tool phát hiện trước khi ghi.
- [ ] **Kiểm tra quyền riêng tư:** tab Network chỉ có request tới host CVAT; manifest không có quyền `cookies`; storage không chứa token.
- [ ] **Hiệu năng:** chuyển cửa sổ 6 frame mượt trên máy làm việc thực tế.

**Kiểm thử luật và tính năng mới**

- [ ] **Luật ID:** log request của mọi phiên test không có `action=delete`; số ID sau mọi thao tác không giảm.
- [ ] **Outside:** sau khi lưu, mọi frame outside của mọi ID đều có keyframe.
- [ ] **Merge B vào A:** A có đủ box của B, B còn nguyên ID và outside ở mọi frame đó; trường hợp A và B trùng frame bị chặn để chọn.
- [ ] **Tách ID:** ID mới nằm cuối danh sách, ID cũ outside có keyframe tới cuối job.
- [ ] **Cảnh báo:** job mẫu có sẵn box chồng nhau và box ngoài tầm lidar đều bị tô màu; ignore xong thì hết màu và bật lại được.

* [ ] **Đề xuất kích thước:** trên vài xe đã gán tay chuẩn, size đề xuất sai lệch trong ngưỡng chấp nhận; frame nguồn của từng chiều mở đúng khi bấm.

- [ ] **Kiểm tra theo guideline:** job mẫu cố ý thiếu attribute, box dưới 6 điểm, yaw ngược hướng di chuyển, đáy lơ lửng, người chồng lên xe đang with\_rider — tool bắt đủ, đúng mức chặn hay cảnh báo; nhóm người chồng nhau và người đẩy stroller không bị báo.

## Nguồn

- [CVAT API — Annotations](https://www.mintlify.com/cvat-ai/cvat/api/annotations)
- [CVAT Digest, July 2025 (bản 2.41–2.42)](https://www.cvat.ai/resources/changelog/digest-july-2025)
- [CVAT — giao diện annotation](https://docs.cvat.ai/docs/manual/basics/cvat-annotation-interface/_print)
