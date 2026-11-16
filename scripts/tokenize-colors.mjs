// Một lần: đổi màu viết thẳng (#hex, rgba()) trong CSS-in-JS của panel thành var(--cvla-c-<mã>, <màu gốc>).
// Bỏ qua dòng vẽ canvas (fillStyle / strokeStyle / ctx.) và tệp không phải giao diện. Chạy lại an toàn (đã là var() thì giữ nguyên).
import { readFileSync, writeFileSync } from 'node:fs';
const files = process.argv.slice(2);
const re = /var\(--cvla-c-[^)]*\)|var\(--cvla-[a-z-]+\)|#[0-9a-fA-F]{3,8}\b|rgba?\(\s*[\d.\s]+(?:,\s*[\d.\s]+){2,3}\)/g;
export function token(c) {
  if (c[0] === '#') {
    let h = c.slice(1).toLowerCase();
    if (h.length === 3) h = [...h].map((x) => x + x).join('');
    return `--cvla-c-${h}`;
  }
  const n = c.replace(/rgba?\(|\)|\s/g, '').split(',');
  return `--cvla-c-rgba-${n.join('-').replace(/\./g, 'p')}`;
}
let total = 0;
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n');
  let n = 0;
  const out = lines.map((ln) => {
    if (/fillStyle|strokeStyle|shadowColor|addColorStop|\bctx\b|POINT_SWATCHES|value=\{value \|\| /.test(ln)) return ln;
    return ln.replace(re, (m) => {
      if (m.startsWith('var(')) return m;
      n++;
      return `var(${token(m)}, ${m})`;
    });
  });
  if (n) writeFileSync(f, out.join('\n'));
  console.log(f, n); total += n;
}
console.log('total', total);
