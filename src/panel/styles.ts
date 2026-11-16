/** CSS chung của panel (chèn bằng <style>: panel chạy trong iframe hoặc Shadow DOM). Màu của vỏ giao diện lấy từ biến --cvla-* (giá trị sáng; chế độ tối / xám vẫn do bộ lọc đảo màu bên dưới xử lý). */
export const STYLE = `
.cvla-root button { font: inherit; border: 1px solid #9aa4b2; background: #fff; border-radius: 4px; padding: 2px 8px; cursor: pointer; }
.cvla-root button:hover:not(:disabled) { background: #eaf1fb; border-color: #5b7db1; }
.cvla-root button:disabled { opacity: .45; cursor: default; }
.cvla-root input[type=text], .cvla-root input:not([type]), .cvla-root select { font: inherit; border: 1px solid #9aa4b2; border-radius: 4px; padding: 1px 4px; }
.cvla-root input:focus-visible, .cvla-root select:focus-visible, .cvla-root button:focus-visible { outline: 2px solid #2b6cb0; outline-offset: 1px; }
.cvla-root table th { font-weight: 600; background: #f1f4f8; padding: 3px 6px; }
.cvla-root table td { padding: 2px 6px; }
.cvla-root fieldset { border-radius: 6px; }
.cvla-root .cvla-tab { border-radius: 4px 4px 0 0; border-bottom: 2px solid transparent; background: #f1f4f8; }
.cvla-root .cvla-tab.cvla-tab-on { background: #1f2937; color: #fff; border-color: #1f2937; font-weight: 700; }
.cvla-root .cvla-tab.cvla-tab-on:hover:not(:disabled) { background: #1f2937; }
/* Giao diện tối: đảo màu cả panel rồi đảo ngược lại canvas / ảnh (point cloud, ảnh camera) để chúng giữ màu gốc; hue-rotate 180° giữ nguyên sắc (xanh vẫn xanh, đỏ vẫn đỏ). */
body { margin: 0; }
.cvla-root { background: #fff; min-height: 100vh; box-sizing: border-box; }
.cvla-root.cvla-dark { filter: invert(1) hue-rotate(180deg) brightness(.92); }
/* Xám: như tối nhưng giảm tương phản rồi tăng sáng, nền ra màu xám than thay vì gần đen. */
.cvla-root.cvla-gray { filter: invert(1) hue-rotate(180deg) contrast(.6) brightness(1.5); }
.cvla-root.cvla-dark canvas, .cvla-root.cvla-dark img, .cvla-root.cvla-dark video, .cvla-root.cvla-dark .cvla-lens, .cvla-root.cvla-gray canvas, .cvla-root.cvla-gray img, .cvla-root.cvla-gray video, .cvla-root.cvla-gray .cvla-lens { filter: invert(1) hue-rotate(180deg); }
/* .cvla-keep: ô mẫu màu (tab Màu sắc) giữ đúng màu người dùng chọn: bộ lọc NGHỊCH ĐẢO của bộ lọc gốc ở trên (đảo thứ tự và giá trị). */
.cvla-root.cvla-dark .cvla-keep { filter: brightness(1.087) hue-rotate(-180deg) invert(1); }
.cvla-root.cvla-gray .cvla-keep { filter: brightness(.667) contrast(1.667) hue-rotate(-180deg) invert(1); }
/* Công tắc gạt: mọi ô tick trong panel hiển thị như toggle (ô chọn dòng dùng class cvla-check để giữ dạng ô tick). */
.cvla-root input[type=checkbox]:not(.cvla-check) { appearance: none; -webkit-appearance: none; width: 30px; height: 17px; border-radius: 9px; background: #9aa4b2; position: relative; vertical-align: middle; margin: 0 4px 0 0; cursor: pointer; transition: background .15s; flex: none; }
.cvla-root input[type=checkbox]:not(.cvla-check)::after { content: ''; position: absolute; top: 2px; left: 2px; width: 13px; height: 13px; border-radius: 50%; background: #fff; transition: left .15s; box-shadow: 0 1px 2px rgba(0,0,0,.4); }
.cvla-root input[type=checkbox]:not(.cvla-check):checked { background: #2b6cb0; }
.cvla-root input[type=checkbox]:not(.cvla-check):checked::after { left: 15px; }
.cvla-root input[type=checkbox]:not(.cvla-check):disabled { opacity: .45; cursor: default; }
.cvla-root button.cvla-primary { background: #2563eb; color: #fff; border-color: #1d4ed8; }
.cvla-root button.cvla-primary:hover:not(:disabled) { background: #1d4ed8; }
.cvla-root button.cvla-shift { border-radius: 12px; padding: 1px 10px; background: #e6f4ea; border-color: #34a853; color: #14532d; font-size: 12px; }
.cvla-root button.cvla-shift-ot { background: #ede9fe; border-color: #7c3aed; color: #4c1d95; }
.cvla-root button.cvla-shift-warn { background: #fde68a; border-color: #d97706; color: #7a4100; font-weight: 700; }
.cvla-root label.cvla-filebtn { display: inline-flex; align-items: center; border: 1px solid #9aa4b2; border-radius: 4px; padding: 2px 8px; background: #fff; cursor: pointer; }
.cvla-root label.cvla-filebtn input { display: none; }
/* nhóm điều khiển của Batch Review: nút / công tắc xuống dòng nguyên khối, không gãy chữ giữa chừng */
.cvla-root fieldset.cvla-group > label, .cvla-root fieldset.cvla-group > button, .cvla-root fieldset.cvla-group button { white-space: nowrap; }
/* bố cục nhóm điều khiển (ControlLayout): nút kéo ⠿, vạch đổi rộng / cao */
.cvla-grip { cursor: grab; color: #8a94a3; padding: 0 3px 0 0; user-select: none; font-weight: 400; }
.cvla-grip:hover { color: #2563eb; }
.cvla-split { border-radius: 2px; touch-action: none; }
.cvla-split-v { cursor: col-resize; }
.cvla-split-h { cursor: row-resize; height: 6px; }
.cvla-split:hover { background: #93c5fd; }
.cvla-badge { display: inline-block; min-width: 16px; padding: 0 5px; margin-left: 6px; border-radius: 9px; background: #fff; color: #1d4ed8; font-size: 11px; line-height: 16px; text-align: center; }
.cvla-help { display: inline-block; width: 15px; height: 15px; border-radius: 50%; border: 1px solid #8a94a3; color: #5b6573; font-size: 10px; line-height: 14px; text-align: center; cursor: help; margin-left: 4px; font-weight: 700; user-select: none; }
.cvla-root button.cvla-num { border: 0; background: transparent; padding: 0 2px; min-width: 40px; text-align: left; text-decoration: underline dotted; }
.cvla-pill { display: inline-block; padding: 0 7px; border-radius: 9px; font-size: 11px; line-height: 17px; background: #e8ecf1; color: #34404f; white-space: nowrap; }
.cvla-pill-class { background: #1f2937; color: #fff; font-weight: 600; }
.cvla-pill-warn { background: #fde68a; color: #7a5200; }
.cvla-pill-bad { background: #fecaca; color: #991b1b; font-weight: 700; }
.cvla-head { position: sticky; top: 0; z-index: 20; background: #fff; padding-bottom: 4px; border-bottom: 1px solid #d5dbe3; margin: -10px -10px 8px; padding: 8px 10px 6px; }
/* biến màu (giá trị sáng) cho vỏ giao diện và các thành phần mới */
.cvla-root { --cvla-bg: #fff; --cvla-fg: #111; --cvla-border: #d5dbe3; --cvla-muted: #5b6573; --cvla-accent: #2563eb;
  --cvla-info-bg: #eef4ff; --cvla-info-bd: #7aa2e3; --cvla-ok-bg: #e8ffe8; --cvla-ok-bd: #0a0;
  --cvla-warn-bg: #fff3cd; --cvla-warn-bd: #e0b000; --cvla-warn-fg: #5a4300; --cvla-bad-bg: #ffe5e5; --cvla-bad-bd: #c00; --cvla-bad-fg: #900; }
.cvla-icon { vertical-align: -2px; flex: none; }
.cvla-root button .cvla-icon { margin-right: 4px; }
.cvla-root button.cvla-iconbtn { border: 0; background: transparent; padding: 2px 4px; line-height: 1; color: inherit; }
.cvla-root button.cvla-iconbtn .cvla-icon { margin: 0; }
.cvla-root button.cvla-iconbtn:hover:not(:disabled) { background: rgba(0,0,0,.08); }
.cvla-root button.cvla-iconbtn-b { padding: 3px 6px; }
.cvla-root button.cvla-iconbtn-b .cvla-icon { margin: 0; }
.cvla-root button.cvla-danger { background: #dc2626; color: #fff; border-color: #b91c1c; }
.cvla-root button.cvla-danger:hover:not(:disabled) { background: #b91c1c; }
/* Notice */
.cvla-notice { display: flex; align-items: flex-start; gap: 8px; padding: 5px 8px; margin: 6px 0; border: 1px solid var(--cvla-info-bd); background: var(--cvla-info-bg); border-radius: 6px; }
.cvla-notice-ico { padding-top: 1px; display: inline-flex; }
.cvla-notice-body { flex: 1; min-width: 0; }
.cvla-notice-actions { display: inline-flex; gap: 6px; flex-wrap: wrap; align-items: center; }
.cvla-notice-success { border-color: var(--cvla-ok-bd); background: var(--cvla-ok-bg); }
.cvla-notice-warn { border-color: var(--cvla-warn-bd); background: var(--cvla-warn-bg); color: var(--cvla-warn-fg); }
.cvla-notice-error { border: 2px solid var(--cvla-bad-bd); background: var(--cvla-bad-bg); color: var(--cvla-bad-fg); font-weight: 600; }
/* Thanh đầu 2 hàng */
.cvla-bar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }
.cvla-bar + .cvla-bar { margin-top: 6px; }
.cvla-spacer { flex: 1; }
.cvla-tabs { display: inline-flex; align-items: flex-end; gap: 4px; flex-wrap: wrap; }
.cvla-subtabs { display: inline-flex; gap: 2px; flex-wrap: wrap; padding: 2px; background: #f1f4f8; border-radius: 6px; }
.cvla-root .cvla-subtab { border: 0; background: transparent; border-radius: 4px; padding: 2px 10px; }
.cvla-root .cvla-subtab.cvla-subtab-on { background: #fff; box-shadow: 0 1px 2px rgba(0,0,0,.25); font-weight: 700; }
.cvla-draftchip { display: inline-flex; align-items: center; gap: 4px; padding: 2px 4px 2px 8px; border-radius: 6px; background: #eee; }
.cvla-draftchip-on { background: var(--cvla-warn-bg); }
.cvla-loadchip { display: inline-flex; align-items: center; gap: 4px; }
.cvla-loadchip progress { width: 54px; height: 8px; }
/* Menu nổi (⚙, ⋯) */
.cvla-backdrop { position: fixed; inset: 0; z-index: 39; background: transparent; }
.cvla-menuwrap { position: relative; display: inline-block; }
.cvla-menu { position: absolute; right: 0; top: calc(100% + 4px); z-index: 40; min-width: 270px; max-width: 92vw; padding: 8px 10px; border: 1px solid #9aa4b2; border-radius: 8px; background: #fff; box-shadow: 0 6px 20px rgba(0,0,0,.25); display: flex; flex-direction: column; gap: 6px; }
.cvla-menu h4 { margin: 4px 0 0; font-size: 11px; text-transform: uppercase; letter-spacing: .04em; color: var(--cvla-muted); }
.cvla-menu label { display: flex; align-items: center; }
.cvla-seg { display: inline-flex; border: 1px solid #9aa4b2; border-radius: 6px; overflow: hidden; }
.cvla-root .cvla-seg button { border: 0; border-radius: 0; border-right: 1px solid #9aa4b2; }
.cvla-root .cvla-seg button:last-child { border-right: 0; }
.cvla-root .cvla-seg button.cvla-seg-on { background: #1f2937; color: #fff; }
.cvla-toasts { position: sticky; bottom: 8px; z-index: 30; margin-top: 8px; box-shadow: 0 4px 14px rgba(0,0,0,.25); border-radius: 6px; }
.cvla-toasts .cvla-notice { margin: 0; }
.cvla-toasts .cvla-notice + .cvla-notice { margin-top: 4px; }
.cvla-tutorial { max-width: 560px; }
.cvla-tutorial-body { min-height: 190px; }
.cvla-tutorial-body p { margin: 0 0 6px; }
.cvla-tutorial-body ul { margin: 0; padding-left: 18px; display: flex; flex-direction: column; gap: 4px; }
.cvla-tutorial-body code { background: #eef1f5; border-radius: 3px; padding: 0 4px; }
.cvla-tutorial-dots { display: flex; justify-content: center; gap: 6px; }
.cvla-root button.cvla-dot { width: 9px; height: 9px; padding: 0; border-radius: 50%; border: 1px solid #9aa4b2; background: #fff; }
.cvla-root button.cvla-dot-on { background: #2563eb; border-color: #2563eb; }
.cvla-menu button { text-align: left; }
.cvla-menu hr { width: 100%; border: 0; border-top: 1px solid #d5dbe3; margin: 2px 0; }
.cvla-ctxmenu { min-width: 260px; }
/* Hộp xác nhận */
.cvla-modal-back { position: fixed; inset: 0; z-index: 100; background: rgba(0,0,0,.4); display: flex; align-items: center; justify-content: center; padding: 16px; }
.cvla-modal { background: #fff; color: #111; border-radius: 10px; padding: 14px 16px; max-width: 520px; width: 100%; box-shadow: 0 10px 40px rgba(0,0,0,.4); display: flex; flex-direction: column; gap: 10px; }
.cvla-v3-back { background: rgba(0,0,0,.35); -webkit-backdrop-filter: blur(6px); backdrop-filter: blur(6px); z-index: 120; }
.cvla-v3 { width: 70vw; height: 70vh; box-sizing: border-box; background: #fff; color: #111; border-radius: 10px; padding: 8px 10px; box-shadow: 0 10px 40px rgba(0,0,0,.5); display: flex; flex-direction: column; }
.cvla-modal-title { font-size: 15px; }
.cvla-modal-msg { white-space: pre-wrap; max-height: 50vh; overflow: auto; }
.cvla-modal-actions { display: flex; justify-content: flex-end; gap: 8px; }
`;
