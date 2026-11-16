// Quét src/panel tìm mọi var(--cvla-c-…, <màu>) và ghi src/panel/palette.gen.ts (danh sách màu sáng gốc).
// Chạy lại sau khi thêm màu mới: node scripts/gen-palette.mjs
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
const dir = 'src/panel';
const found = new Map();
for (const f of readdirSync(dir)) {
  if (!/\.(ts|tsx)$/.test(f) || f === 'palette.gen.ts') continue;
  const s = readFileSync(`${dir}/${f}`, 'utf8');
  for (const m of s.matchAll(/var\((--cvla-c-[a-z0-9-]+),\s*(#[0-9a-fA-F]{3,8}|rgba?\([^)]*\))\)/g)) found.set(m[1], m[2].replace(/\s+/g, ''));
}
const rows = [...found].sort((a, b) => a[0].localeCompare(b[0])).map(([k, v]) => `  ['${k}', '${v}'],`);
writeFileSync(`${dir}/palette.gen.ts`, `// Tạo bởi scripts/gen-palette.mjs, không sửa tay. [tên biến, màu sáng gốc]\nexport const PALETTE_LIGHT: ReadonlyArray<readonly [string, string]> = [\n${rows.join('\n')}\n];\n`);
console.log(rows.length, 'màu');
