import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export type NoticeTone = 'info' | 'success' | 'warn' | 'error';
const ICON: Record<NoticeTone, IconName> = { info: 'info', success: 'check', warn: 'warn', error: 'error' };

/**
 * Hộp thông báo dùng chung (thay cho các hộp tự tô màu): 4 mức. `error` và `warn` có role="alert" (đọc ngay),
 * mức còn lại role="status". `onClose` có thì hiện nút đóng; không có thì hộp không tắt được (cảnh báo chặn).
 */
export function Notice({ tone = 'info', onClose, actions, children, className }: {
  tone?: NoticeTone; onClose?: () => void; actions?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <div className={`cvla-notice cvla-notice-${tone}${className ? ` ${className}` : ''}`} role={tone === 'error' || tone === 'warn' ? 'alert' : 'status'}>
      <span className="cvla-notice-ico"><Icon name={ICON[tone]} size={15} /></span>
      <div className="cvla-notice-body">{children}</div>
      {actions && <div className="cvla-notice-actions">{actions}</div>}
      {onClose && <button className="cvla-iconbtn" onClick={onClose} aria-label="Đóng" title="Đóng"><Icon name="close" size={12} /></button>}
    </div>
  );
}
