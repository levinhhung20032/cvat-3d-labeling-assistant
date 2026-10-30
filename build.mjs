import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, readdirSync, readFileSync, rmSync } from 'node:fs';

// node build.mjs                    → dist/          (Edge / Chrome, manifest.json)
// node build.mjs --target=firefox   → dist-firefox/  (Firefox, manifest.firefox.json)
const firefox = process.argv.includes('--target=firefox');
const out = firefox ? 'dist-firefox' : 'dist';
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

cpSync(firefox ? 'public/manifest.firefox.json' : 'public/manifest.json', `${out}/manifest.json`);
// Icon extension (PNG 16/32/48/128; icon.svg là bản gốc để vẽ lại)
for (const n of [16, 32, 48, 128]) cpSync(`public/icons/icon-${n}.png`, `${out}/icons/icon-${n}.png`);
// Giấy phép của mã bên thứ ba đóng gói kèm (Patchwork++, BSD-2: bản phân phối phải kèm thông báo bản quyền)
cpSync('public/THIRD_PARTY_NOTICES.txt', `${out}/THIRD_PARTY_NOTICES.txt`);
console.log(`Build xong → ${out}/`);
