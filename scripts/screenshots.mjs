// Renders a set of reference views for visual review. Usage: node scripts/screenshots.mjs outDir [quality] [w] [h]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const [out = 'shots', quality = 'medium', W = '960', H = '540'] = process.argv.slice(2);
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname); if (p.endsWith('/')) p += 'index.html';
  const f = join('dist', p); if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' }); res.end(readFileSync(f));
}).listen(5197);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: +W, height: +H } });
page.on('pageerror', (e) => console.log('pageerror', e.message));
await page.goto(`http://localhost:5197/?quality=${quality}`);
await page.waitForFunction(() => window.__game?.mode === 'title', null, { timeout: 240000 });
await page.click('button[data-act="new"]');
await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 240000 });
const views = {
  start: null,
  village: { c: [16, 4.5, 31], t: [48, 4, 22], p: [12, 26] },
  mio: { c: [1, 2.2, 18], t: [9, 1, 12], p: [3, 16] },
  shrine: { c: [-55, 18.5, -56], t: [-62, 16, -72], p: [-57, -60] },
  waterfall: { c: [-6, 4, -95], t: [-1, 8, -124], p: [-4, -98] },
  forest: { c: [-46, 4.5, 10], t: [-30, 4, 28], p: [-44, 12] },
};
for (const [name, v] of Object.entries(views)) {
  if (v) await page.evaluate((v) => { const g = window.__game; g.player.teleport(v.p[0], v.p[1], 0); g.rig.cinematic = { from: new g.camera.position.constructor(...v.c), to: new g.camera.position.constructor(...v.c), lookFrom: new g.camera.position.constructor(...v.t), lookTo: new g.camera.position.constructor(...v.t), t: 0, dur: 9999 }; }, v);
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${out}/${quality}-${name}.png`, timeout: 300000 });
  console.log('shot', name);
}
await browser.close(); server.close();
