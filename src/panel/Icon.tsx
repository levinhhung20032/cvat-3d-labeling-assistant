/** Bộ icon SVG nhỏ, cùng cỡ và độ dày nét (thay cho emoji: hiển thị giống nhau trên mọi máy). */
const PATHS = {
  focus: <><circle cx="8" cy="8" r="4.5" /><circle cx="8" cy="8" r="1.2" fill="currentColor" /><path d="M8 1v3M8 12v3M1 8h3M12 8h3" /></>,
  upload: <path d="M8 11V2.5M4.5 6 8 2.5 11.5 6M2.5 13.5h11" />,
  reload: <path d="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" />,
  settings: <><circle cx="8" cy="8" r="2" /><path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" /></>,
  undo: <path d="M3 6.5h6.5a3.5 3.5 0 0 1 0 7H6M3 6.5 5.5 4M3 6.5 5.5 9" />,
  redo: <path d="M13 6.5H6.5a3.5 3.5 0 0 0 0 7H10M13 6.5 10.5 4M13 6.5 10.5 9" />,
  more: <><circle cx="3.5" cy="8" r="1" fill="currentColor" /><circle cx="8" cy="8" r="1" fill="currentColor" /><circle cx="12.5" cy="8" r="1" fill="currentColor" /></>,
  info: <><circle cx="8" cy="8" r="6" /><path d="M8 7v4M8 4.8v.2" /></>,
  check: <><circle cx="8" cy="8" r="6" /><path d="m5.3 8.2 2 2 3.5-4" /></>,
  warn: <><path d="M8 2 14.5 13.5h-13z" /><path d="M8 6.5v3M8 11.5v.2" /></>,
  error: <><circle cx="8" cy="8" r="6" /><path d="m5.8 5.8 4.4 4.4M10.2 5.8l-4.4 4.4" /></>,
  clock: <><circle cx="8" cy="8" r="6" /><path d="M8 4.5V8l2.5 1.5" /></>,
  trash: <path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8.5h5.8l.6-8.5" />,
  close: <path d="m4 4 8 8M12 4l-8 8" />,
} as const;

export type IconName = keyof typeof PATHS;

export function Icon({ name, size = 14 }: { name: IconName; size?: number }) {
  return (
    <svg className="cvla-icon" width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {PATHS[name]}
    </svg>
  );
}
