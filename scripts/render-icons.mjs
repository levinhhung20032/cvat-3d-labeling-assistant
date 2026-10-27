// Vẽ lại public/icons/icon-{16,32,48,128}.png từ public/icons/icon.svg bằng Edge headless (nền trong suốt).
// Dùng khi đổi màu / trang trí trong icon.svg:
//   1) msedge --headless=new --remote-debugging-port=9223 --user-data-dir=<thư mục tạm> about:blank
//   2) node scripts/render-icons.mjs public/icons/icon.svg public/icons
//   3) npm run build
import fs from 'node:fs';
const PORT = 9223;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const get = async (p, init) => (await fetch(`http://127.0.0.1:${PORT}${p}`, init)).json();
function conn(url) {
  return new Promise((res) => {
    const ws = new WebSocket(url); let id = 0; const p = new Map();
    ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.id && p.has(m.id)) { p.get(m.id)(m); p.delete(m.id); } };
    ws.onopen = () => res({ send: (method, params = {}) => new Promise((ok) => { const i = ++id; p.set(i, ok); ws.send(JSON.stringify({ id: i, method, params })); }) });
  });
}
for (let i = 0; i < 40; i++) { try { await get('/json/version'); break; } catch { await sleep(500); } }
const svg = fs.readFileSync(process.argv[2], 'utf8');
const outDir = process.argv[3];
const page = await get('/json/new?about:blank', { method: 'PUT' });
const c = await conn(page.webSocketDebuggerUrl);
await c.send('Page.enable');
for (const size of [16, 32, 48, 128]) {
  await c.send('Emulation.setDeviceMetricsOverride', { width: size, height: size, deviceScaleFactor: 1, mobile: false });
  await c.send('Emulation.setDefaultBackgroundColorOverride', { color: { r: 0, g: 0, b: 0, a: 0 } });
  const sized = svg.replace('width="128" height="128"', `width="${size}" height="${size}"`);
  const html = `<!doctype html><html><body style="margin:0;background:transparent;overflow:hidden">${sized}</body></html>`;
  await c.send('Page.navigate', { url: 'data:text/html;charset=utf-8,' + encodeURIComponent(html) });
  await sleep(600);
  const shot = await c.send('Page.captureScreenshot', { format: 'png', clip: { x: 0, y: 0, width: size, height: size, scale: 1 }, fromSurface: true });
  fs.writeFileSync(`${outDir}/icon-${size}.png`, Buffer.from(shot.result.data, 'base64'));
  console.log('icon', size, shot.result.data.length);
}
process.exit(0);
