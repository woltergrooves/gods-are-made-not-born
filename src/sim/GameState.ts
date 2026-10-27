// Game state creation, divine form derivation and world consequences.

import { createBeliefState, log, regionalBelief, topAspects, tickRumors } from './BeliefEngine.js';
import { ASPECT_PARTS, HYBRIDS, NPCS, SINGLE_TITLES, NPC_BY_ID } from './content.js';
import { DOMAINS, type Domain, type FormState, type GameState, type NpcState, type RegionId } from './types.js';

export const SCHEMA_VERSION = 1;

export const PLAYER_START = { x: -34, y: 0, z: 30, yaw: Math.PI * 0.55 };

export function createGameState(seed = 1337, now = Date.now()): GameState {
  const npcs: Record<string, NpcState> = {};
  for (const n of NPCS) {
    npcs[n.id] = {
      id: n.id, region: n.region, relationship: 0, fear: 0, mood: 'calm',
      present: true, x: n.spawn.x, z: n.spawn.z, memory: [],
    };
  }
  const state: GameState = {
    schemaVersion: SCHEMA_VERSION,
    seed, createdAt: now, playTime: 0, worldTime: 0,
    player: { ...PLAYER_START },
    belief: createBeliefState(),
    npcs,
    flags: { flood_phase: 'pending' },
    abilities: [],
    form: { stage: 0, title: 'Nameless', parts: [], dominant: [], domains: [], hybrid: null },
    journal: [],
    settings: { quality: 'medium', invertY: false, sensitivity: 1, debug: false },
  };
  log(state, 'system', 'A storm over Amahara Valley. Something without a name opens its eyes.');
  return state;
}

/** Turn what the current region believes into a body. */
export function deriveForm(state: GameState, region: RegionId = 'amahara'): FormState {
  const b = regionalBelief(state, region);
  const parts: string[] = [];
  for (const [aspect, spec] of Object.entries(ASPECT_PARTS)) {
    if (spec && b.aspects[aspect as keyof typeof b.aspects] >= spec.threshold) parts.push(spec.part);
  }
  const dominant = topAspects(b).slice(0, 3);
  const domains = [...DOMAINS].filter((d) => b.domains[d] >= 0.15)
    .sort((x, y) => b.domains[y] - b.domains[x]).slice(0, 2) as Domain[];
  let hybrid: string | null = null;
  let title = 'Nameless';
  for (const h of HYBRIDS) {
    if (h.needs.every((a) => b.aspects[a] >= (ASPECT_PARTS[a]?.threshold ?? 0.25) * 0.85)) { hybrid = h.id; title = h.title; break; }
  }
  if (!hybrid && dominant[0]) title = SINGLE_TITLES[dominant[0]] ?? 'Nameless';
  const faith = dominant.reduce((s, a) => s + b.aspects[a], 0) * (0.5 + b.conviction);
  const stage: FormState['stage'] = faith < 0.12 ? 0 : faith < 0.55 ? 1 : 2;
  if (stage === 0) title = 'Nameless';
  return { stage, title, parts: stage === 0 ? [] : parts, dominant, domains, hybrid };
}

/** Recompute form and unlock abilities. Returns true if the form visibly changed. */
export function refreshForm(state: GameState): boolean {
  const prev = state.form;
  const next = deriveForm(state);
  const changed = prev.title !== next.title || prev.stage !== next.stage || prev.parts.join() !== next.parts.join();
  state.form = next;
  for (const [, spec] of Object.entries(ASPECT_PARTS)) {
    if (spec?.ability && next.parts.includes(spec.part) && !state.abilities.includes(spec.ability)) {
      state.abilities.push(spec.ability);
      log(state, 'form', `Belief has given you a new power: ${abilityName(spec.ability)}.`);
    }
  }
  if (changed && next.stage > 0) {
    log(state, 'form', `The valley’s stories reshape you. They have begun to call you ${next.title}.`);
  }
  return changed;
}

export function abilityName(id: string): string {
  return ({ ward: 'Guardian’s Ward', howl: 'Dread Howl', rend: 'Ember Rend' } as Record<string, string>)[id] ?? id;
}

// ─── Consequences ───────────────────────────────────────────────────────────
// Set pieces in the world are switched on by persistent flags AND by belief.
// The renderer only reads this list; it never decides anything itself.

export interface Consequence { id: string; description: string }

export function activeConsequences(state: GameState): Consequence[] {
  const out: Consequence[] = [];
  const f = state.flags;
  const b = regionalBelief(state, 'amahara');
  const reverence = b.aspects.guardian + b.aspects.mercy * 0.7 + b.aspects.nature * 0.5;
  const dread = b.aspects.terror + b.aspects.destruction * 0.5 + b.aspects.vengeance * 0.5;

  if (f['bridge_broken']) out.push({ id: 'bridge_broken', description: 'The red bridge was torn away by the drained flood.' });
  if (f['mill_damaged']) out.push({ id: 'mill_damaged', description: 'The mill wheel was smashed by the flood.' });
  const shrineReady = state.playTime >= ((f['shrine_ready_at'] as number | undefined) ?? 0);
  if (f['river_shrine_built'] || (f['flood_phase'] === 'resolved' && reverence > 0.3 && shrineReady)) {
    out.push({ id: 'river_shrine', description: 'Villagers have raised a small shrine to you by the river.' });
  }
  if (dread > 0.32 && dread > reverence) out.push({ id: 'village_shuttered', description: 'Doors are barred and lanterns burn blue against you.' });
  else if (reverence > 0.25) out.push({ id: 'village_warm', description: 'Lanterns are hung for you along the paths.' });
  if ((state.npcs['daichi']?.fear ?? 0) > 0.3 || (state.npcs['daichi']?.relationship ?? 0) < -0.2) {
    out.push({ id: 'daichi_hostile', description: 'Daichi keeps an arrow nocked whenever you are near.' });
  }
  if (f['genzo_mobilised']) out.push({ id: 'warden_bells', description: 'The Bell Wardens have hung warding bells at the village gate.' });
  return out;
}

// ─── The Flood of Amahara ───────────────────────────────────────────────────

export type FloodOutcome = 'rescue' | 'weir' | 'howl' | 'ignored';

/** Apply the persistent world-side results of the flood (beliefs come from recordEvent). */
export function applyFloodOutcome(state: GameState, outcome: FloodOutcome): void {
  const f = state.flags;
  f['flood_phase'] = 'resolved';
  f['flood_outcome'] = outcome;
  const mio = state.npcs['mio']!;
  const daichi = state.npcs['daichi']!;
  switch (outcome) {
    case 'rescue':
      f['mio_saved_by'] = 'spirit';
      f['shrine_pending'] = true;
      log(state, 'world', 'Mio is safe on the bank. By the time the rain thins, Hana and Mio are stacking river stones into a shrine.');
      break;
    case 'weir':
      f['mio_saved_by'] = 'hana';
      f['bridge_broken'] = true;
      log(state, 'world', 'The weir is gone. The water fell away from Mio’s rock — and took the red bridge with it.');
      break;
    case 'howl':
      f['mio_saved_by'] = 'hana';
      f['genzo_mobilised'] = true;
      log(state, 'world', 'Your howl rolled across the valley. In the panic Hana waded in for Mio. Genzo has started hanging bells at the gate.');
      break;
    case 'ignored':
      f['mio_saved_by'] = 'daichi';
      f['mill_damaged'] = true;
      daichi.relationship = Math.min(daichi.relationship, -0.3);
      if (!daichi.memory.includes('saved_mio')) daichi.memory.push('saved_mio');
      log(state, 'world', 'Daichi dragged Mio out himself. The mill wheel did not survive the night. Everyone remembers who was watching.');
      break;
  }
  mio.x = 8; mio.z = 20; // on the bank now
  // Devotion takes a little while to turn into stones and candles.
  f['shrine_ready_at'] = state.playTime + 14;
  // The storyteller leaves over the pass a while after the flood — carrying whatever she heard.
  f['rei_departs_at'] = state.worldTime + 25;
}

/** Per-frame simulation step (dt in real seconds). */
export const WORLD_MINUTES_PER_SECOND = 0.5;

export function stepWorld(state: GameState, dtSeconds: number): { formChanged: boolean } {
  state.playTime += dtSeconds;
  const dtMin = dtSeconds * WORLD_MINUTES_PER_SECOND;
  state.worldTime += dtMin;
  const f = state.flags;
  if (typeof f['rei_departs_at'] === 'number' && state.worldTime >= (f['rei_departs_at'] as number) && !f['rei_departed']) {
    f['rei_departed'] = true;
    log(state, 'world', 'Rei shouldered her pack and left over the mountain pass, toward Kurogane.');
  }
  if (f['rei_departed'] && state.npcs['rei']!.present && state.worldTime >= (f['rei_departs_at'] as number) + 20) {
    state.npcs['rei']!.present = false;
  }
  if (f['shrine_pending'] && state.playTime >= (f['shrine_ready_at'] as number)) {
    f['shrine_pending'] = false;
    f['river_shrine_built'] = true;
    log(state, 'world', 'Hana and Mio have finished a small shrine of river stones on the bank. Candles are lit for you.');
  }
  tickRumors(state, dtMin);
  // Fear and warmth settle slowly over time.
  for (const n of Object.values(state.npcs)) n.fear = Math.max(0, n.fear - dtMin * 0.0015);
  return { formChanged: refreshForm(state) };
}

export function npcName(id: string): string { return NPC_BY_ID[id]?.name ?? id; }
