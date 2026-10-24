import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { cpSync, rmSync } from 'node:fs';

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

// Panel (React) chạy trong iframe của extension.
await build({
  configFile: false,
  publicDir: false,
  base: './',
  plugins: [react()],
  logLevel: 'warn',
  define,
  build: { outDir: out, emptyOutDir: false, rollupOptions: { input: 'panel.html' } },
});

cpSync(firefox ? 'public/manifest.firefox.json' : 'public/manifest.json', `${out}/manifest.json`);
console.log(`Build xong → ${out}/`);
