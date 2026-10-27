// Phase 4 combat acceptance test in a real (headless) browser, driven by real key presses:
// flood resolved → camps wake → lock on → telegraph shown before damage → light combo and
// charged heavy → wraith banished (belief event) → get hit → defeat → respawn → touch HUD.
// Usage: node scripts/combat-test.mjs [outDir]
import { createRequire } from 'node:module';
import { createServer } from 'node:http';
import { readFileSync, existsSync, mkdirSync } from 'node:fs';
import { extname, join } from 'node:path';
const require = createRequire(import.meta.url);
let pw;
try { pw = require('playwright'); } catch { pw = require('/opt/node22/lib/node_modules/playwright'); }
const out = process.argv[2] ?? 'test-output';
mkdirSync(out, { recursive: true });
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json', '.webmanifest': 'application/manifest+json' };
const server = createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = join('dist', p);
  if (!existsSync(f)) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'content-type': types[extname(f)] ?? 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(5196);
const browser = await pw.chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const ok = (cond, msg) => { console.log(`${cond ? 'PASS' : 'FAIL'} ${msg}`); if (!cond) process.exitCode = 1; };
const errors = [];

async function open(ctxOpts) {
  const ctx = await browser.newContext(ctxOpts);
  const page = await ctx.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto('http://localhost:5196/?quality=low');
  await page.waitForFunction(() => window.__game?.mode === 'title', null, { timeout: 180000 });
  await page.evaluate(() => document.querySelector('button[data-act="new"]').click());
  await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 120000 });
  // skip the flood night: rescue Mio, then wait for the world to settle
  await page.evaluate(() => window.__game.resolveFlood('rescue'));
  await page.waitForFunction(() => window.__game.state.flags.flood_phase === 'resolved', null, { timeout: 60000 });
  return { ctx, page };
}

const touchOnly = process.env.TOUCH_ONLY === '1';
const { page } = touchOnly ? { page: null } : await open({ viewport: { width: 960, height: 540 } });
const shot = (n) => page.screenshot({ path: `${out}/${n}.png`, timeout: 240000 });
const g = (fn, arg) => page.evaluate(fn, arg);

if (!touchOnly) {
// camps wake once the player is away from them
await g(() => window.__game.player.teleport(30, 20, 0));
await page.waitForFunction(() => window.__game.combat.sim.enemies.length >= 5, null, { timeout: 30000 });
const roster = await g(() => window.__game.combat.sim.enemies.map((e) => `${e.kind}@${e.camp}`));
ok(roster.filter((r) => r.startsWith('wraith')).length === 3 && roster.filter((r) => r.startsWith('hound')).length === 2, `camps populated: ${roster.join(', ')}`);

// walk up to the forest-edge wraith and let it notice us
await g(() => { const G = window.__game; G.player.teleport(-20, 20, Math.PI); G.rig.snapBehind(G.player); G.rig.yaw = 0; });
await page.waitForFunction(() => window.__game.combat.sim.enemies.some((e) => e.camp === 'forest_edge' && e.phase !== 'idle'), null, { timeout: 30000 });
ok(true, 'wraith noticed the spirit');

// lock on with T
await page.keyboard.press('KeyT');
await page.waitForTimeout(400);
const lock = await g(() => window.__game.combat.lockId);
ok(!!lock && lock.startsWith('wraith'), `locked on to ${lock}`);

// wait for a telegraph, capture it, and confirm no damage lands during the wind-up
await page.waitForFunction(() => window.__game.combat.sim.enemies.some((e) => e.phase === 'windup'), null, { timeout: 30000 });
const tele = await g(() => { const c = window.__game.combat; const e = c.sim.enemies.find((x) => x.phase === 'windup'); return { hp: c.sim.hp, t: e.t, windup: e.attack.windup, decals: c.view.teles.size, atk: e.attack.id }; });
ok(tele.decals > 0, `telegraph drawn on the ground for "${tele.atk}" (${tele.windup}s wind-up)`);
await shot('combat-01-telegraph');
ok(tele.hp === 100, 'no damage before the wind-up ends');

// stand still and take the hit
await page.waitForFunction(() => window.__game.combat.sim.hp < 100 || window.__game.combat.sim.enemies.every((e) => e.phase !== 'windup' && e.phase !== 'strike'), null, { timeout: 15000 });
await page.waitForTimeout(150);
const hp1 = await g(() => window.__game.combat.sim.hp);
ok(hp1 < 100, `standing in the red hurts (essence ${hp1}/100)`);
await shot('combat-02-hurt');

// fight: light combo taps with K until the wraith is gone; dodge (Q) whenever it winds up
const kills0 = await g(() => window.__game.state.belief.events.filter((e) => e.type === 'wraith_banished').length);
let swings = 0;
for (let i = 0; i < 160; i++) {
  const s = await g(() => { const c = window.__game.combat; const w = c.sim.enemies.find((e) => e.camp === 'forest_edge'); const P = window.__game.player.pos; return { alive: !!w && w.phase !== 'dead', winding: !!w && w.phase === 'windup' && w.t > w.attack.windup * 0.55, d: w ? Math.hypot(w.pos.x - P.x, w.pos.z - P.z) : 0, hp: c.sim.hp }; });
  if (!s.alive) break;
  if (s.hp < 35) await g(() => window.__game.combat.sim.heal(60)); // keep the test about hitting, not dying
  if (s.winding) { await page.keyboard.press('KeyQ'); await page.waitForTimeout(260); continue; }
  if (s.d > 2.6) { await page.keyboard.down('KeyW'); await page.waitForTimeout(160); await page.keyboard.up('KeyW'); continue; }
  await page.keyboard.press('KeyK'); swings++;
  await page.waitForTimeout(170);
}
await page.waitForTimeout(600);
const after = await g(() => ({ w: window.__game.combat.sim.enemies.filter((e) => e.camp === 'forest_edge' && e.phase !== 'dead').length, ev: window.__game.state.belief.events.filter((e) => e.type === 'wraith_banished'), flag: window.__game.state.flags.camp_forest_edge, journal: window.__game.state.journal.slice(-6).map((j) => j.text) }));
ok(after.w === 0, `wraith banished with ${swings} key-press strikes`);
ok(after.ev.length > kills0, `belief event recorded (${after.ev.map((e) => `${e.id} seen by ${e.witnesses.join('+') || 'no one'}`).join('; ')})`);
ok(typeof after.flag === 'number', 'cleared camp remembered in save flags');
console.log('journal:', after.journal.join(' | '));
await shot('combat-03-banished');

// heavy: hold K for a full charge next to a hound; it must stagger
const houndId = await g(() => { const G = window.__game; const h = G.combat.sim.enemies.find((e) => e.kind === 'hound'); G.player.teleport(h.pos.x, h.pos.z - 2.2, 0); G.player.yaw = 0; G.combat.sim.enemies.forEach((o) => { o.cooldown = 99; }); h.phase = 'chase'; h.cooldown = 99; h.flinch = 999; h.yaw = Math.PI; /* hold it in place for the test */ G.combat.lockId = h.id; return h.id; });
await page.keyboard.down('KeyK');
// wait on game time, not wall time: software rendering runs at a few frames per second
await page.waitForFunction(() => window.__game.combat.sim.chargeLevel > 0.95, null, { timeout: 60000 }).catch(() => {});
const charging = await g(() => ({ c: window.__game.combat.sim.chargeLevel, on: window.__game.combat.sim.charging }));
await shot('combat-04-charge');
await page.keyboard.up('KeyK');
await page.waitForFunction((id) => window.__game.combat.sim.enemies.some((e) => e.id === id && e.hp < e.def.hp), houndId, { timeout: 30000 }).catch(() => {});
const heavy = await g((id) => { const h = window.__game.combat.sim.enemies.find((e) => e.id === id); return h ? { hp: h.hp, phase: h.phase, log: window.__game.combat.recent.slice(-4).join(', ') } : null; }, houndId);
console.log('combat log:', heavy?.log);
ok(charging.on && charging.c > 0.9, `held K charges a heavy (${charging.c.toFixed(2)})`);
ok(!!heavy && heavy.phase === 'stagger', `charged heavy connected and broke poise (hound ${heavy ? heavy.hp.toFixed(0) : '?'}/85, ${heavy?.phase})`);
await shot('combat-04b-stagger');

// defeat and respawn
await g(() => { const c = window.__game.combat; c.sim.hp = 1; c.sim.enemies.forEach((e) => { e.cooldown = 0; }); });
await page.waitForFunction(() => window.__game.combat.blocking || window.__game.combat.sim.defeated, null, { timeout: 30000 });
await page.waitForTimeout(700);
await shot('combat-05-defeat');
await page.waitForFunction(() => !window.__game.combat.blocking, null, { timeout: 20000 });
const res = await g(() => ({ hp: window.__game.combat.sim.hp, fell: window.__game.state.belief.events.some((e) => e.type === 'spirit_fell'), pos: window.__game.player.pos.toArray().map((v) => +v.toFixed(1)) }));
ok(res.hp === 100 && res.fell, `defeat → respawn at ${res.pos} with full essence; the fall became a world event`);

// save/load keeps cleared camps and doesn't carry live enemies
await page.keyboard.press('Escape'); await page.waitForTimeout(300);
await page.click('#pause button[data-act="save"]'); await page.waitForTimeout(300);
await page.click('#slot-list button:nth-child(1)'); await page.waitForTimeout(1000);
await page.reload();
await page.waitForFunction(() => window.__game?.mode === 'title', null, { timeout: 180000 });
await page.click('button[data-act="load"]'); await page.waitForTimeout(400);
await page.click('#slot-list button:nth-child(2)');
await page.waitForFunction(() => window.__game.mode === 'play', null, { timeout: 60000 });
await page.waitForTimeout(3000);
const loaded = await g(() => ({ flag: window.__game.state.flags.camp_forest_edge, edge: window.__game.combat.sim.enemies.filter((e) => e.camp === 'forest_edge').length }));
ok(typeof loaded.flag === 'number' && loaded.edge === 0, 'after reload the cleared camp stays quiet');

}

// touch layout
console.log('touch test: opening mobile context');
const t = await open({ viewport: { width: 844, height: 390 }, hasTouch: true, isMobile: true, deviceScaleFactor: 1 });
await t.page.evaluate(() => window.__game.player.teleport(30, 20, 0));
await t.page.waitForFunction(() => window.__game.combat.sim.enemies.length >= 5, null, { timeout: 30000 });
await t.page.evaluate(() => { const G = window.__game; G.player.teleport(-20, 19, Math.PI); G.rig.snapBehind(G.player); });
await t.page.waitForTimeout(1500);
await t.page.tap('#b-lock');
await t.page.waitForTimeout(300);
await t.page.tap('#b-attack');
await t.page.waitForTimeout(800);
const touch = await t.page.evaluate(() => { const r = (id) => document.getElementById(id).getBoundingClientRect(); const b = ['b-attack', 'b-interact', 'b-jump', 'b-dodge', 'b-ability', 'b-lock'].map((id) => [id, r(id)]); let overlap = false; for (let i = 0; i < b.length; i++) for (let j = i + 1; j < b.length; j++) { const A = b[i][1], B = b[j][1]; const d = Math.hypot(A.x + A.width / 2 - B.x - B.width / 2, A.y + A.height / 2 - B.y - B.height / 2); if (d < A.width / 2 + B.width / 2 + 4) overlap = true; } /* buttons are circles: need a 4px gap */ return { overlap, inView: b.every(([, x]) => x.left >= 0 && x.right <= innerWidth && x.top >= 0 && x.bottom <= innerHeight), lock: window.__game.combat.lockId }; });
ok(!touch.overlap && touch.inView, 'touch buttons fit on an iPhone-sized landscape screen without overlapping');
ok(!!touch.lock, `◎ button locks on (${touch.lock})`);
await t.page.screenshot({ path: `${out}/combat-06-touch.png`, timeout: 240000 });

ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors.slice(0, 5).join(' | ') : ''}`);
await browser.close();
server.close();
