import { useState } from 'react';
import { checkUpdate, type UpdateResult } from '../shared/update';

/** Nút "Kiểm tra cập nhật": chỉ chạy khi bấm, đọc GitHub Releases công khai của dự án (không gửi dữ liệu nào). */
export function UpdateCheck({ version }: { version: string }) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<UpdateResult | null>(null);
  const run = async () => { setBusy(true); setRes(await checkUpdate(version)); setBusy(false); };
  return (
    <span style={{ marginLeft: 8, fontWeight: 400 }}>
      <button onClick={run} disabled={busy} title="Hỏi GitHub Releases của dự án xem có bản mới không (chỉ khi bạn bấm; không gửi dữ liệu nào)">
        {busy ? 'Đang kiểm tra…' : '⟳ Kiểm tra cập nhật'}
      </button>
      {res?.kind === 'uptodate' && <span style={{ marginLeft: 6, color: '#060' }}>✔ Đang dùng bản mới nhất ({res.latest})</span>}
      {res?.kind === 'newer' && (
        <span style={{ marginLeft: 6, color: '#a05a00' }} title={res.notes}>
          ⬆ Có bản mới <b>{res.latest}</b> (đang dùng v{res.current}){' '}
          <a href={res.url} target="_blank" rel="noopener noreferrer">mở trang tải</a>
          {' '}— tải bản dựng, chép đè vào đúng thư mục cũ, bấm Reload ở trang extension rồi F5 tab CVAT.
        </span>
      )}
      {res?.kind === 'unreachable' && <span style={{ marginLeft: 6, color: '#666' }}>{res.message}</span>}
      {res?.kind === 'error' && <span style={{ marginLeft: 6, color: '#b00' }}>{res.message}</span>}
    </span>
  );
}
