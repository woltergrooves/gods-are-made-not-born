// Headless browser smoke test: loads the game, plays the opening, takes screenshots.
// Usage: node scripts/browser-test.mjs [outDir] [quality]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2] ?? 'test-output';
const quality = process.argv[3] ?? 'medium';
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.map': 'application/json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join('dist', p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(5199);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
const logs = [];
page.on('console', (m) => logs.push(`[${m.type()}] ${m.text()}`));
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const t0 = Date.now();
await page.goto(`http://localhost:5199/?quality=${quality}`);
await page.waitForFunction(() => !document.getElementById('title').classList.contains('hidden') || !document.getElementById('fatal').classList.contains('hidden'), null, { timeout: 180000 });
console.log('loaded in', ((Date.now() - t0) / 1000).toFixed(1), 's');
await page.waitForTimeout(1500);
console.log(await page.evaluate(() => ({ fatal: document.getElementById('fatal-msg').textContent, label: document.getElementById('load-label').textContent }))); await page.screenshot({ path: `${out}/01-title.png`, timeout: 180000 });
await page.click('button[data-act="new"]');
await page.waitForTimeout(4500);
await page.screenshot({ path: `${out}/02-intro.png`, timeout: 180000 });
await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 60000 });
await page.waitForTimeout(1500);
await page.screenshot({ path: `${out}/03-play-start.png`, timeout: 180000 });
const info = await page.evaluate(() => { const g = window.__game; return { fps: g.renderer.fps, calls: g.renderer.renderer.info.render.calls, tris: g.renderer.renderer.info.render.triangles, pos: g.player.pos.toArray() }; });
console.log('render info', JSON.stringify(info));
console.log(logs.filter((l) => /error|warn/i.test(l)).slice(0, 30).join('\n'));
await browser.close();
server.close();
