// First-playable acceptance test, run in a real (headless) browser:
// new game → act near Mio → beliefs change → visible consequence → save → reload → consequence persists.
// Usage: node scripts/acceptance-test.mjs [outDir] [outcome=rescue|weir|howl|ignored]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2] ?? 'test-output';
const outcome = process.argv[3] ?? 'rescue';
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join('dist', p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(5198);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, timeout: 240000 });
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };

await page.goto('http://localhost:5198/?quality=low');
await page.waitForFunction(() => window.__game?.mode === 'title', null, { timeout: 180000 });
await page.click('button[data-act="new"]');
await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 120000 });
ok(true, 'new game started and control handed to player');

// Move using real keyboard input for a moment
const before = await page.evaluate(() => window.__game.player.pos.toArray());
await page.keyboard.down('KeyW'); await page.waitForTimeout(2500); await page.keyboard.up('KeyW');
const after = await page.evaluate(() => window.__game.player.pos.toArray());
ok(Math.hypot(after[0] - before[0], after[2] - before[2]) > 0.5, `player moves with input (${before.map((v) => v.toFixed(1))} -> ${after.map((v) => v.toFixed(1))})`);

// Travel to the deed location (walking all the way is slow under software rendering)
await page.evaluate((o) => {
  const g = window.__game;
  const m = g.npcs.actors.get('mio').pos;
  const P = o === 'weir' ? { x: -1, z: -25 } : o === 'rescue' ? { x: m.x - 2.2, z: m.z + 0.5 } : { x: m.x - 9, z: m.z + 6 };
  g.player.teleport(P.x, P.z, 0);
}, outcome);
await page.waitForTimeout(1200);
const prompt = await page.evaluate(() => document.getElementById('prompt-text').textContent);
console.log('prompt:', prompt);
const holdUntil = async (key) => { await page.keyboard.down(key); const t = Date.now(); while (Date.now() - t < 120000) { await page.waitForTimeout(500); if (await page.evaluate(() => window.__game.state.flags.flood_phase !== 'pending')) break; } await page.keyboard.up(key); };
if (outcome === 'rescue' || outcome === 'weir') await holdUntil('KeyE');
else if (outcome === 'howl') { await page.keyboard.press('KeyF'); }
else { await page.evaluate(() => { window.__game.state.flags.flood_elapsed = 168; }); }
await page.waitForTimeout(1500);
console.log('after action:', JSON.stringify(await page.evaluate(() => ({ phase: window.__game.state.flags.flood_phase, seq: !!window.__game.sequence, hold: window.__game.holdProgress }))), errors.slice(0, 5));
await page.waitForFunction(() => window.__game.state.flags.flood_phase === 'resolved', null, { timeout: 120000 });
const s1 = await page.evaluate(() => {
  const g = window.__game, st = g.state;
  return { outcome: st.flags.flood_outcome, testimonies: st.belief.testimonies.map((t) => `${t.witness}:${t.readingId}`), hana: st.belief.npc.hana.aspects, form: st.form };
});
console.log(JSON.stringify(s1));
ok(s1.outcome === outcome, `flood resolved as ${outcome}`);
ok(s1.testimonies.length > 0, `witnesses interpreted the deed: ${s1.testimonies.join(', ')}`);
await page.waitForTimeout(3000);
await page.evaluate(() => { window.__game.state.playTime += 20; });
// wait on game state, not wall time: software rendering can run at a few frames per second
await page.waitForFunction((o) => {
  const sp = window.__game.valley.village.setPieces;
  return { rescue: sp.river_shrine.visible, weir: sp.bridge_broken.visible, howl: sp.warden_bells.visible, ignored: sp.mill_damaged.visible }[o];
}, outcome, { timeout: 90000 }).catch(() => {});
const visible = await page.evaluate(() => {
  const sp = window.__game.valley.village.setPieces;
  return { shrine: sp.river_shrine.visible, bridgeBroken: sp.bridge_broken.visible, bells: sp.warden_bells.visible, mill: sp.mill_damaged.visible, form: window.__game.state.form.title, parts: window.__game.state.form.parts };
});
console.log('visible:', JSON.stringify(visible));
const expected = { rescue: visible.shrine, weir: visible.bridgeBroken, howl: visible.bells, ignored: visible.mill }[outcome];
ok(expected, 'a visible world consequence appeared');
// look at the consequence
await page.evaluate((o) => {
  const g = window.__game;
  const P = o === 'weir' ? { x: 20, z: 32 } : o === 'rescue' ? { x: 16, z: 22 } : o === 'howl' ? { x: 70, z: 34 } : { x: 34, z: 14 };
  g.player.teleport(P.x, P.z, 0);
  const T = o === 'weir' ? { x: 8, z: 26 } : o === 'rescue' ? { x: 13.7, z: 18 } : o === 'howl' ? { x: 76, z: 50 } : { x: 23, z: 6 };
  g.rig.yaw = Math.atan2(P.x - T.x, P.z - T.z);
}, outcome);
await page.waitForTimeout(2500);
await shot(`${outcome}-consequence`);

// Save to slot 1 through the real menu
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.click('#pause button[data-act="save"]');
await page.waitForTimeout(400);
await page.click('#slot-list button:nth-child(1)');
await page.waitForTimeout(1200);
const savedForm = await page.evaluate(() => window.__game.state.form.title);

// Reload the page entirely, then load slot 1
await page.reload();
await page.waitForFunction(() => window.__game?.mode === 'title', null, { timeout: 180000 });
await page.click('button[data-act="load"]');
await page.waitForTimeout(500);
await page.click('#slot-list button:nth-child(2)');
await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 60000 });
await page.waitForTimeout(3000);
const s2 = await page.evaluate(() => {
  const g = window.__game, sp = g.valley.village.setPieces;
  return { outcome: g.state.flags.flood_outcome, form: g.state.form.title, shrine: sp.river_shrine.visible, bridgeBroken: sp.bridge_broken.visible, bells: sp.warden_bells.visible, mill: sp.mill_damaged.visible, hana: g.state.belief.npc.hana.aspects };
});
console.log('after reload:', JSON.stringify(s2));
ok(s2.outcome === outcome && s2.form === savedForm, `state survived a full reload (form "${s2.form}")`);
ok({ rescue: s2.shrine, weir: s2.bridgeBroken, howl: s2.bells, ignored: s2.mill }[outcome], 'consequence still visible after reload');
ok(JSON.stringify(s2.hana) === JSON.stringify(s1.hana) || s2.hana.guardian >= s1.hana.guardian - 0.001, 'stored beliefs persisted');
await shot(`${outcome}-after-reload`);
ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close();
server.close();
