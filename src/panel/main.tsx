// Nạp kho lưu trữ của extension trước (ca làm việc, bản nháp, tùy chọn), rồi mới nạp và vẽ panel: các store (ca làm việc,
// danh sách bỏ qua…) đọc dữ liệu ngay lúc module được nạp, nên module panel phải được nạp SAU khi kho sẵn sàng.
import { useExtensionStorage } from './storage';

void useExtensionStorage(new URLSearchParams(location.hash.slice(1)).get('origin') ?? undefined) // máy chủ CVAT của trang cha
  .catch(() => { /* không đọc được: panel vẫn chạy, chỉ không nhớ giữa các lần mở */ })
  .then(() => import('./mount'))
  .then(({ mountPanel }) => { mountPanel(document.getElementById('root')!); });
