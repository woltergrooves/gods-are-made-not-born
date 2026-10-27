import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveManager, MemoryStorage, decode, encode, migrate } from '../src/save/SaveCore.js';
import { createGameState, applyFloodOutcome, stepWorld } from '../src/sim/GameState.js';
import { recordEvent } from '../src/sim/BeliefEngine.js';

test('round-trip keeps beliefs, flags, form and world damage', async () => {
  const s = createGameState(7, 0);
  recordEvent(s, 'flood_weir_shattered', { x: 0, y: 0, z: 0 }, {}, [{ id: 'hana', distance: 10, visibility: 1 }, { id: 'mio', distance: 12, visibility: 1 }]);
  applyFloodOutcome(s, 'weir');
  for (let i = 0; i < 40; i++) stepWorld(s, 1);
  const mgr = new SaveManager(new MemoryStorage());
  await mgr.save(s, 'slot1', 'test');
  const loaded = (await mgr.load('slot1'))!;
  assert.equal(loaded.recovered, false);
  assert.deepEqual(loaded.state.belief.npc['hana'], s.belief.npc['hana']);
  assert.equal(loaded.state.flags['bridge_broken'], true);
  assert.deepEqual(loaded.state.form, s.form);
});

test('corrupted save falls back to backup instead of wiping progress', async () => {
  const store = new MemoryStorage();
  const mgr = new SaveManager(store);
  const s = createGameState(7, 0);
  s.flags['marker'] = 'first';
  await mgr.save(s, 'slot2', 'one');
  s.flags['marker'] = 'second';
  await mgr.save(s, 'slot2', 'two');
  const raw = store.map.get('gamnb:slot2')!;
  store.map.set('gamnb:slot2', raw.slice(0, raw.length / 2)); // truncated write
  const loaded = (await mgr.load('slot2'))!;
  assert.equal(loaded.recovered, true);
  assert.equal(loaded.state.flags['marker'], 'first');
  const list = await mgr.list();
  assert.ok(list.find((l) => l.slot === 'slot2')?.recovered);
});

test('checksum catches tampering', () => {
  const text = encode(createGameState(1, 0), 'slot1', 'x');
  const bad = text.replace('"worldTime":0', '"worldTime":99');
  assert.throws(() => decode(bad));
});

test('old schema-0 saves migrate forward', () => {
  const s = createGameState(1, 0) as any;
  delete s.abilities; delete s.settings; s.schemaVersion = 0;
  const m = migrate(s);
  assert.equal(m.schemaVersion, 1);
  assert.deepEqual(m.abilities, []);
  assert.equal(m.settings.invertY, false);
});

test('saves from a newer game version are refused, not overwritten', () => {
  const s = createGameState(1, 0) as any;
  s.schemaVersion = 99;
  assert.throws(() => migrate(s));
});
