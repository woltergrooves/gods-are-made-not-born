import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CombatSim, ENEMY_DEFS, LIGHT_COMBO, HEAVY_HOLD, CHARGE_TIME, type CombatEvent, type V2 } from '../src/sim/combat.js';
import { createGameState } from '../src/sim/GameState.js';
import { recordEvent } from '../src/sim/BeliefEngine.js';

const DT = 1 / 60;

function run(sim: CombatSim, seconds: number, player: V2, inv = false): CombatEvent[] {
  const all: CombatEvent[] = [];
  for (let t = 0; t < seconds; t += DT) all.push(...sim.update(DT, { pos: player, invulnerable: inv }));
  return all;
}

test('every enemy attack is telegraphed before it can deal damage', () => {
  const sim = new CombatSim({ seed: 3 });
  sim.spawn('wraith', { x: 0, z: 2 });
  const player = { x: 0, z: 0 };
  const events: { t: number; e: CombatEvent }[] = [];
  for (let t = 0; t < 8; t += DT) for (const e of sim.update(DT, { pos: player, invulnerable: false })) events.push({ t, e });
  const firstTele = events.find((x) => x.e.type === 'telegraph');
  const firstHit = events.find((x) => x.e.type === 'playerHit');
  assert.ok(firstTele, 'enemy telegraphed');
  assert.ok(firstHit, 'enemy eventually connected');
  const atk = (firstTele!.e as Extract<CombatEvent, { type: 'telegraph' }>).attack;
  assert.ok(firstHit!.t - firstTele!.t >= atk.windup - 1e-6, `hit came ${(firstHit!.t - firstTele!.t).toFixed(2)}s after telegraph (wind-up ${atk.windup}s)`);
  assert.ok(sim.hp < sim.maxHp);
});

test('dodge i-frames avoid an attack', () => {
  const sim = new CombatSim({ seed: 3 });
  sim.spawn('wraith', { x: 0, z: 2 });
  const ev = run(sim, 6, { x: 0, z: 0 }, true);
  assert.equal(sim.hp, sim.maxHp);
  assert.ok(ev.some((e) => e.type === 'dodged'));
});

test('only one enemy holds the attack token at a time', () => {
  const sim = new CombatSim({ seed: 11 });
  for (let i = 0; i < 4; i++) sim.spawn(i % 2 ? 'hound' : 'wraith', { x: Math.cos(i * 1.6) * 3, z: Math.sin(i * 1.6) * 3 });
  for (let t = 0; t < 20; t += DT) {
    sim.update(DT, { pos: { x: 0, z: 0 }, invulnerable: true });
    const attacking = sim.enemies.filter((e) => e.phase === 'windup' || e.phase === 'strike');
    assert.ok(attacking.length <= 1, `${attacking.length} enemies attacking at once`);
  }
});

test('light combo chains three steps and the finisher hits hardest', () => {
  const sim = new CombatSim({ seed: 1 });
  const e = sim.spawn('hound', { x: 0, z: 1.6 });
  e.phase = 'stagger'; // hold it still
  sim.facing = 0;
  const swings: number[] = [];
  for (let t = 0; t < 2; t += DT) {
    for (const ev of sim.input(DT, false, true, false, 100)) if (ev.type === 'swing') swings.push(ev.attack.step);
    for (const ev of sim.update(DT, { pos: { x: 0, z: 0 }, invulnerable: true })) if (ev.type === 'swing') swings.push(ev.attack.step);
    e.phase = 'chase'; e.flinch = 1; e.cooldown = 99;
  }
  assert.deepEqual(swings.slice(0, 3), [0, 1, 2]);
  assert.ok(LIGHT_COMBO[2]!.damage > LIGHT_COMBO[0]!.damage);
});

test('holding attack charges a heavy that breaks poise and interrupts a wind-up', () => {
  const sim = new CombatSim({ seed: 2 });
  const e = sim.spawn('wraith', { x: 0, z: 1.8 });
  sim.facing = 0;
  // let it start winding up
  for (let t = 0; t < 4 && e.phase !== 'windup'; t += DT) sim.update(DT, { pos: { x: 0, z: 0 }, invulnerable: true });
  assert.equal(e.phase, 'windup');
  e.t = -5; // freeze its wind-up while we charge (test only)
  let swing: CombatEvent | undefined;
  const hold = HEAVY_HOLD + CHARGE_TIME;
  for (let t = 0; t < hold; t += DT) sim.input(DT, true, false, false, 100);
  assert.ok(sim.chargeLevel > 0.95, 'fully charged');
  swing = sim.input(DT, false, false, false, 100).find((x) => x.type === 'swing');
  assert.ok(swing && swing.type === 'swing' && swing.attack.kind === 'heavy');
  const ev = run(sim, 0.6, { x: 0, z: 0 }, true);
  const hit = ev.find((x) => x.type === 'enemyHit');
  assert.ok(hit && hit.type === 'enemyHit' && hit.staggered, 'heavy staggered the wraith');
  assert.equal(e.phase === 'stagger' || e.phase === 'chase', true);
});

test('enemies die, and leashed enemies give up and return home', () => {
  const sim = new CombatSim({ seed: 5 });
  const a = sim.spawn('wraith', { x: 0, z: 2 });
  const out = sim.areaEffect({ x: 0, z: 0 }, 4, { damage: 999, poise: 0, knock: 0 });
  assert.ok(out.some((e) => e.type === 'enemyDied' && e.enemy === a));
  const b = sim.spawn('hound', { x: 0, z: 0 });
  run(sim, 1.5, { x: 0, z: 6 }, true);
  assert.notEqual(b.phase, 'idle');
  run(sim, 6, { x: 0, z: ENEMY_DEFS.hound.leash + 30 }, true);
  assert.ok(b.phase === 'return' || b.phase === 'idle');
});

test('defeat is reported once and reset restores the fight', () => {
  const sim = new CombatSim({ seed: 9 });
  sim.spawn('hound', { x: 0, z: 2 });
  sim.hp = 10;
  const ev = run(sim, 10, { x: 0, z: 0 });
  assert.equal(ev.filter((e) => e.type === 'playerDefeated').length, 1);
  assert.ok(sim.defeated);
  sim.reset();
  assert.equal(sim.hp, sim.maxHp);
  assert.ok(!sim.defeated);
  assert.ok(sim.alive.every((e) => e.phase === 'idle' && e.hp === e.def.hp));
});

test('killing a hound in front of witnesses changes what the valley believes', () => {
  const s = createGameState(4, 0);
  const before = s.belief.npc['daichi']!.conviction;
  recordEvent(s, 'hound_slain', { x: 0, y: 0, z: 0 }, { enemy: 'hound' }, [{ id: 'daichi', distance: 6, visibility: 1 }]);
  assert.ok(s.belief.npc['daichi']!.conviction > before);
  assert.ok(s.belief.testimonies.some((t) => t.witness === 'daichi'));
});

test('getting hit cancels a charge, and the held button does not fire a stray light attack', () => {
  const sim = new CombatSim({ seed: 3 });
  sim.spawn('wraith', { x: 0, z: 2 });
  let swings = 0, hit = false;
  for (let t = 0; t < 10 && !hit; t += DT) {
    for (const e of sim.input(DT, true, false, false, 100)) if (e.type === 'swing') swings++;
    for (const e of sim.update(DT, { pos: { x: 0, z: 0 }, invulnerable: false })) if (e.type === 'playerHit') hit = true;
  }
  assert.ok(hit, 'the wraith connected while we were charging');
  assert.equal(sim.charging, false);
  for (let i = 0; i < 5; i++) sim.input(DT, true, false, false, 100);
  const released = sim.input(DT, false, false, false, 100);
  assert.equal(released.filter((e) => e.type === 'swing').length, 0, 'no attack on release');
  assert.equal(swings, 0);
  // the next press works normally again
  const tap = sim.input(DT, false, true, false, 100);
  assert.equal(tap.filter((e) => e.type === 'swing').length, 1);
});
