import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

// node build.mjs                    → dist/          (Edge / Chrome, manifest.json)
// node build.mjs --target=firefox   → dist-firefox/  (Firefox, manifest.firefox.json)
// node build.mjs --target=dev       → dist-dev/      (bản DEV: một extension riêng song song với bản chính; Claude chỉ build ở đây)
const firefox = process.argv.includes('--target=firefox');
const dev = process.argv.includes('--target=dev');
// --out=<thư mục> (tuỳ chọn): build thử ra chỗ khác mà không đụng tới dist đang được nạp vào trình duyệt.
const outArg = process.argv.find((x) => x.startsWith('--out='));
const out = outArg ? outArg.slice(6) : firefox ? 'dist-firefox' : dev ? 'dist-dev' : 'dist';
// Móc DEV (tự Reload, tự chèn, ép chế độ nhúng): chỉ bản DEV nạp src/dev/hooks.local.ts (bị git bỏ qua); mọi bản khác dùng bản rỗng hooks.stub.ts.
const devHooks = dev && existsSync('src/dev/hooks.local.ts') ? 'src/dev/hooks.local.ts' : 'src/dev/hooks.stub.ts';
const alias = { 'dev-hooks': resolve(devHooks) };
// content script chứa cả React (chế độ nhúng dự phòng); thư viện đọc process.env.NODE_ENV nên phải khai báo ở build dạng lib.
const define = { __FIREFOX__: JSON.stringify(firefox), 'process.env.NODE_ENV': JSON.stringify('production') };

rmSync(out, { recursive: true, force: true });

// Content script và background: một file IIFE mỗi cái (content script không nạp được module).
for (const [name, entry] of [
  ['content', 'src/content/index.ts'],
  ['background', 'src/background/index.ts'],
]) {
  await build({
    configFile: false,
    publicDir: false,
    logLevel: 'warn',
    define,
    resolve: { alias },
    plugins: [react()], // content script chứa cả panel (chế độ nhúng dự phòng)
    build: {
      outDir: out,
      emptyOutDir: false,
      minify: false,
      rollupOptions: { output: { inlineDynamicImports: true } },
      lib: { entry, formats: ['iife'], name: `cvla_${name}`, fileName: () => `${name}.js` },
    },
  });
}

// Panel (React) chạy trong iframe của extension, và trang Cài đặt (danh sách máy chủ CVAT).
await build({
  configFile: false,
  publicDir: false,
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  define,
  build: { outDir: out, emptyOutDir: false, rollupOptions: { input: ['panel.html', 'options.html'] } },
});

// Chrome / Edge từ chối nạp content script không phải UTF-8 hợp lệ ("It isn't UTF-8 encoded"), ví dụ khi bundle chứa ký tự
// không-ký-tự như U+FFFE. Kiểm tra mọi file js đầu ra để lỗi này không lọt tới người dùng.
for (const f of readdirSync(out, { recursive: true })) {
  if (!String(f).endsWith('.js')) continue;
  const buf = readFileSync(`${out}/${f}`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch { throw new Error(`${out}/${f} không phải UTF-8 hợp lệ`); }
  if (/[￾￿]/.test(text)) throw new Error(`${out}/${f} chứa ký tự không hợp lệ (U+FFFE / U+FFFF); trình duyệt sẽ từ chối nạp`);
}

// Bản chính không bao giờ chứa móc DEV: nếu lọt chuỗi nào thì dừng build.
if (!dev) {
  for (const f of readdirSync(out, { recursive: true })) {
    if (!String(f).endsWith('.js')) continue;
    const text = readFileSync(`${out}/${f}`, 'utf8');
    for (const marker of ['cvla-dev-buildcheck', 'cvla-panel-mode']) {
      if (text.includes(marker)) throw new Error(`${out}/${f} chứa móc DEV (${marker}); bản chính không được có`);
    }
  }
}

if (dev) {
  // Bản DEV là extension khác hẳn: tên, nhãn phiên bản và tiêu đề riêng (ID extension khác vì nạp từ thư mục khác).
  const m = JSON.parse(readFileSync('public/manifest.json', 'utf8'));
  m.name = `[DEV] ${m.name}`;
  m.version_name = `${m.version}-dev.${Date.now().toString(36)}`;
  m.permissions = [...m.permissions, 'alarms']; // móc DEV tự reload cần alarm để đánh thức service worker
  m.action.default_title = '[DEV] ' + m.action.default_title;
  writeFileSync(`${out}/manifest.json`, JSON.stringify(m, null, 2));
} else {
  cpSync(firefox ? 'public/manifest.firefox.json' : 'public/manifest.json', `${out}/manifest.json`);
}
// Icon extension (PNG 16/32/48/128; icon.svg là bản gốc để vẽ lại; bản DEV dùng public/icons-dev có dải cam "DEV")
for (const n of [16, 32, 48, 128]) cpSync(`public/${dev ? 'icons-dev' : 'icons'}/icon-${n}.png`, `${out}/icons/icon-${n}.png`);
// Giấy phép của mã bên thứ ba đóng gói kèm (Patchwork++, BSD-2: bản phân phối phải kèm thông báo bản quyền)
cpSync('public/THIRD_PARTY_NOTICES.txt', `${out}/THIRD_PARTY_NOTICES.txt`);
// Mã build (thời điểm build): bản chạy thử cục bộ dùng để biết dist vừa được build lại
writeFileSync(`${out}/build-id.txt`, String(Date.now()));
console.log(`Build xong → ${out}/`);
