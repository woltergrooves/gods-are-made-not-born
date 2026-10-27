import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGameState, applyFloodOutcome, stepWorld, activeConsequences, deriveForm } from '../src/sim/GameState.js';
import { recordEvent, regionalBelief, diminishing } from '../src/sim/BeliefEngine.js';
import type { GameState } from '../src/sim/types.js';

function floodWith(type: string, outcome: 'rescue' | 'weir' | 'howl' | 'ignored', dist: Record<string, number>): GameState {
  const s = createGameState(1, 0);
  const witnesses = Object.entries(dist).map(([id, distance]) => ({ id, distance, visibility: 1 }));
  recordEvent(s, type, { x: 6, y: 0, z: 12 }, { outcome }, witnesses);
  applyFloodOutcome(s, outcome);
  return s;
}

test('same rescue is read differently by different witnesses', () => {
  const s = floodWith('flood_rescue', 'rescue', { hana: 8, mio: 0, daichi: 45 });
  const readings = Object.fromEntries(s.belief.testimonies.map((t) => [t.witness, t.readingId]));
  assert.equal(readings['hana'], 'saviour');
  assert.equal(readings['mio'], 'saviour');
  assert.equal(readings['daichi'], 'abductor', 'a distant sceptic misreads the rescue');
  assert.ok(s.belief.npc['hana']!.aspects.guardian > 0.3);
  assert.ok(s.belief.npc['daichi']!.aspects.terror > 0.2);
});

test('a close, clear view can override a sceptic’s temperament', () => {
  const s = floodWith('flood_rescue', 'rescue', { daichi: 2 });
  assert.equal(s.belief.testimonies[0]!.readingId, 'saviour');
});

test('Mio misunderstands the howl as protection (contradictory belief)', () => {
  const s = floodWith('flood_howl', 'howl', { mio: 5, hana: 10, daichi: 20 });
  const r = Object.fromEntries(s.belief.testimonies.map((t) => [t.witness, t.readingId]));
  assert.equal(r['mio'], 'river_scolded');
  assert.equal(r['hana'], 'dread');
});

test('diminishing returns for repeated deeds before the same witness', () => {
  assert.ok(diminishing(0) > diminishing(1) && diminishing(1) > diminishing(4));
  const s = createGameState(1, 0);
  const deltas: number[] = [];
  for (let i = 0; i < 5; i++) {
    const before = s.belief.npc['takeshi']!.aspects.terror;
    recordEvent(s, 'howl_used', { x: 0, y: 0, z: 0 }, {}, [{ id: 'takeshi', distance: 5, visibility: 1 }]);
    deltas.push(s.belief.npc['takeshi']!.aspects.terror - before);
  }
  for (let i = 1; i < deltas.length; i++) assert.ok(deltas[i]! < deltas[i - 1]!, `gain ${i} should shrink`);
  assert.ok(s.belief.npc['takeshi']!.aspects.terror < 1);
});

test('rumors propagate over time, change listeners and reach the folk', () => {
  const s = floodWith('flood_rescue', 'rescue', { hana: 6, mio: 0 });
  assert.equal(s.belief.npc['takeshi']!.conviction, 0);
  for (let i = 0; i < 120; i++) stepWorld(s, 1);
  assert.ok(s.belief.npc['takeshi']!.conviction > 0, 'Takeshi heard about it second-hand');
  assert.ok(s.belief.regions.amahara.awareness > 0.2, 'village is talking');
  assert.ok(s.journal.some((j) => j.kind === 'rumor'));
});

test('eyewitness rejects a contradicting rumor', () => {
  const s = floodWith('flood_rescue', 'rescue', { hana: 6, mio: 0, daichi: 45 });
  for (let i = 0; i < 400; i++) stepWorld(s, 1);
  const daichiRumor = s.belief.rumors.find((r) => r.originator === 'daichi')!;
  assert.ok(daichiRumor.rejectedBy.includes('hana') || !daichiRumor.holders.includes('hana'));
});

test('Rei carries stories to Kurogane only after she leaves', () => {
  const s = floodWith('flood_rescue', 'rescue', { hana: 6, mio: 0, rei: 30 });
  for (let i = 0; i < 30; i++) stepWorld(s, 1);
  assert.equal(s.belief.regions.kurogane.awareness, 0);
  for (let i = 0; i < 200; i++) stepWorld(s, 1);
  assert.equal(s.flags['rei_departed'], true);
  assert.ok(s.belief.regions.kurogane.awareness > 0, 'Kurogane heard the story');
});

test('different flood outcomes produce different worlds and forms', () => {
  const rescue = floodWith('flood_rescue', 'rescue', { hana: 8, mio: 0, aiko: 15, daichi: 45 });
  const howl = floodWith('flood_howl', 'howl', { hana: 10, mio: 5, aiko: 15, daichi: 20, takeshi: 40, genzo: 50 });
  const weir = floodWith('flood_weir_shattered', 'weir', { hana: 20, mio: 15, aiko: 25, daichi: 30 });
  for (const s of [rescue, howl, weir]) for (let i = 0; i < 60; i++) stepWorld(s, 1);
  const ids = (s: GameState) => activeConsequences(s).map((c) => c.id);
  assert.ok(ids(rescue).includes('river_shrine'));
  assert.ok(ids(weir).includes('bridge_broken'));
  assert.ok(ids(howl).includes('warden_bells'));
  assert.ok(rescue.form.parts.includes('halo'), `rescue parts ${rescue.form.parts}`);
  assert.ok(howl.form.parts.includes('horns'), `howl parts ${howl.form.parts}`);
  assert.ok(weir.form.parts.includes('embers'), `weir parts ${weir.form.parts}`);
  assert.notEqual(rescue.form.title, howl.form.title);
  assert.ok(weir.form.hybrid, `weir should be hybrid, got ${weir.form.title}`);
  (globalThis as any).console.log('titles:', rescue.form.title, '|', howl.form.title, '|', weir.form.title);
});

test('nobody watching means no belief', () => {
  const s = createGameState(1, 0);
  recordEvent(s, 'flood_rescue', { x: 0, y: 0, z: 0 }, {}, [{ id: 'hana', distance: 500, visibility: 1 }]);
  assert.equal(regionalBelief(s, 'amahara').aspects.guardian, 0);
  assert.equal(deriveForm(s).stage, 0);
});
