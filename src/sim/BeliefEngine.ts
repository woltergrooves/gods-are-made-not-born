// The Belief Engine.
// Deeds become events, events are interpreted by witnesses, testimonies become rumors,
// rumors travel along social links (and are trusted, inflated or rejected), and the
// aggregate of what a region believes decides what the spirit *is*.
// Deterministic and data-driven: same inputs always produce the same world.

import {
  ASPECTS, DOMAINS, emptyBelief,
  type Aspect, type AspectVec, type Belief, type BeliefState, type DomainVec,
  type GameState, type RegionId, type Rumor, type Testimony, type Vec3, type WorldEvent,
} from './types.js';
import { EVENT_DEFS, NPC_BY_ID, NPCS, type Reading } from './content.js';

export const RUMOR_HALF_LIFE_MIN = 240;   // freshness falls with age
export const SHARE_RATE = 0.09;           // link progress per world-minute at trust 1
export const REJECT_THRESHOLD = 0.18;

export interface WitnessInput { id: string; distance: number; visibility: number }

export function createBeliefState(): BeliefState {
  const npc: Record<string, Belief> = {};
  for (const n of NPCS) npc[n.id] = emptyBelief();
  return {
    npc,
    regions: {
      amahara: { population: 140, awareness: 0, folk: emptyBelief('The village has not heard of you.') },
      kurogane: { population: 5200, awareness: 0, folk: emptyBelief('Kurogane has never heard of you.') },
    },
    events: [], testimonies: [], rumors: [], exposure: {}, nextId: 1,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

/** Saturating push: beliefs approach ±1 but never exceed it. */
export function applyPush(b: Belief, aspects: Partial<AspectVec>, domains: Partial<DomainVec>, scale: number): void {
  for (const a of ASPECTS) {
    const d = (aspects[a] ?? 0) * scale;
    if (!d) continue;
    const v = b.aspects[a];
    b.aspects[a] = clamp(d > 0 ? v + d * (1 - Math.max(0, v)) : v + d * (1 + Math.min(0, v)), -1, 1);
  }
  for (const k of DOMAINS) {
    const d = (domains[k] ?? 0) * scale;
    if (!d) continue;
    const v = b.domains[k];
    b.domains[k] = clamp(d > 0 ? v + d * (1 - Math.max(0, v)) : v + d * (1 + Math.min(0, v)), -1, 1);
  }
}

function dotAspects(a: Partial<AspectVec>, b: Partial<AspectVec>): number {
  let s = 0;
  for (const k of ASPECTS) s += (a[k] ?? 0) * (b[k] ?? 0);
  return s;
}
function norm(a: Partial<AspectVec>): number { return Math.sqrt(dotAspects(a, a)); }
export function cosine(a: Partial<AspectVec>, b: Partial<AspectVec>): number {
  const n = norm(a) * norm(b);
  return n < 1e-6 ? 0 : dotAspects(a, b) / n;
}

/** Diminishing returns for the same witness seeing the same kind of deed. */
export function diminishing(timesSeen: number): number { return 1 / (1 + 0.8 * timesSeen); }

export function clarityFor(distance: number, range: number, visibility: number): number {
  return clamp(visibility * (1 - Math.pow(clamp(distance / range, 0, 1), 1.3)), 0.05, 1);
}

/** Pick the reading a particular witness arrives at. Deterministic. */
export function chooseReading(readings: Reading[], witnessId: string, clarity: number, prior: Belief): Reading {
  const def = NPC_BY_ID[witnessId];
  let best = readings[0]!; let bestScore = -Infinity;
  for (const r of readings) {
    if (r.onlyFor && !r.onlyFor.includes(witnessId)) continue;
    const temperament = def ? dotAspects(def.predisposition, r.aspects) : 0;
    const priorPull = dotAspects(prior.aspects, r.aspects) * 0.6;
    const score = r.base + r.clarityBias * clarity + temperament * (1.6 - clarity) + priorPull
      + (r.onlyFor ? 0.9 : 0);
    if (score > bestScore) { bestScore = score; best = r; }
  }
  return best;
}

export function log(state: GameState, kind: GameState['journal'][number]['kind'], text: string): void {
  state.journal.push({ time: state.worldTime, kind, text });
  if (state.journal.length > 200) state.journal.splice(0, state.journal.length - 200);
}

const fill = (t: string, name: string) => t.replace(/\{name\}/g, name);

/**
 * Record a deed in the world and let every witness interpret it.
 * Returns the event and the testimonies it produced.
 */
export function recordEvent(
  state: GameState, type: string, location: Vec3,
  facts: WorldEvent['facts'], witnesses: WitnessInput[],
): { event: WorldEvent; testimonies: Testimony[] } {
  const def = EVENT_DEFS[type];
  if (!def) throw new Error(`Unknown event type ${type}`);
  const bs = state.belief;
  const id = `evt_${String(bs.nextId++).padStart(4, '0')}_${type}`;
  const seen = witnesses.filter((w) => w.distance <= def.range && w.visibility > 0 && state.npcs[w.id]?.present !== false);
  const event: WorldEvent = { id, type, time: state.worldTime, location, facts, witnesses: seen.map((w) => w.id) };
  bs.events.push(event);
  const out: Testimony[] = [];

  for (const w of seen) {
    const npcDef = NPC_BY_ID[w.id];
    const belief = bs.npc[w.id] ?? (bs.npc[w.id] = emptyBelief());
    const clarity = clarityFor(w.distance, def.range, w.visibility);
    const reading = chooseReading(def.readings, w.id, clarity, belief);
    const key = `${w.id}|${type}`;
    const times = bs.exposure[key] ?? 0;
    bs.exposure[key] = times + 1;
    const impact = def.magnitude * (0.35 + 0.65 * clarity) * diminishing(times);
    applyPush(belief, reading.aspects, reading.domains, impact);
    belief.conviction = clamp(belief.conviction + impact * 0.6, 0, 1);
    belief.summary = reading.summary;

    const npc = state.npcs[w.id];
    if (npc) {
      const warm = (reading.aspects.guardian ?? 0) + (reading.aspects.mercy ?? 0) * 0.8;
      const cold = (reading.aspects.terror ?? 0) + (reading.aspects.destruction ?? 0) * 0.6 + (reading.aspects.vengeance ?? 0) * 0.5;
      npc.relationship = clamp(npc.relationship + (warm - cold) * impact * 0.6, -1, 1);
      npc.fear = clamp(npc.fear + cold * impact * 0.7 - warm * impact * 0.2, 0, 1);
      npc.mood = npc.fear > 0.55 ? (npcDef && npcDef.skepticism > 0.7 ? 'hostile' : 'alarmed')
        : npc.relationship > 0.35 ? 'devoted' : npc.relationship < -0.25 ? 'hostile' : 'curious';
      if (!npc.memory.includes(`${type}:${reading.id}`)) npc.memory.push(`${type}:${reading.id}`);
    }

    const name = npcDef?.name ?? w.id;
    const t: Testimony = { eventId: id, witness: w.id, readingId: reading.id, clarity, text: fill(reading.testimony, name) };
    bs.testimonies.push(t);
    out.push(t);
    if (times > 0) log(state, 'belief', `${name} has seen this before. It moves them less each time.`);
    log(state, 'belief', t.text);

    const exaggeration = npcDef?.exaggeration ?? 1;
    const rumor: Rumor = {
      id: `rum_${String(bs.nextId++).padStart(4, '0')}`,
      eventId: id, readingId: reading.id, originator: w.id,
      aspects: { ...reading.aspects }, domains: { ...reading.domains },
      heat: { [w.id]: impact * exaggeration },
      bornAt: state.worldTime, holders: [w.id], rejectedBy: [], progress: {},
      text: reading.rumor,
    };
    bs.rumors.push(rumor);
  }
  if (seen.length === 0) log(state, 'world', 'No one saw what you did. The valley will remember it differently — or not at all.');
  return { event, testimonies: out };
}

export function freshness(r: Rumor, now: number): number {
  return Math.pow(0.5, Math.max(0, now - r.bornAt) / RUMOR_HALF_LIFE_MIN);
}

function linksOf(holder: string): Record<string, number> {
  if (holder.startsWith('folk:')) return {};
  const def = NPC_BY_ID[holder];
  if (!def) return {};
  const links: Record<string, number> = { ...def.links };
  // Everyone gossips with the common folk of the region they are in.
  const folkKey = `folk:${def.region}`;
  links[folkKey] = Math.max(links[folkKey] ?? 0, 0.35 + def.credibility * 0.3);
  return links;
}

function canReceive(state: GameState, target: string, from: string): boolean {
  if (target.startsWith('folk:')) {
    const region = target.slice(5) as RegionId;
    if (region === 'kurogane') return from === 'rei' && state.flags['rei_departed'] === true;
    return true;
  }
  const npc = state.npcs[target];
  return !!npc && npc.present;
}

/** Advance rumor propagation by dt world-minutes. */
export function tickRumors(state: GameState, dtMin: number): void {
  const bs = state.belief;
  for (const r of bs.rumors) {
    const fresh = freshness(r, state.worldTime);
    if (fresh < 0.05) continue;
    for (const holder of [...r.holders]) {
      const travelling = holder === 'rei' && state.flags['rei_departed'] === true;
      if (!travelling && !holder.startsWith('folk:') && state.npcs[holder] && !state.npcs[holder]!.present) continue;
      for (const [target, trust] of Object.entries(linksOf(holder))) {
        if (r.holders.includes(target) || r.rejectedBy.includes(target)) continue;
        if (!canReceive(state, target, holder)) continue;
        const key = `${holder}>${target}`;
        const p = (r.progress[key] ?? 0) + SHARE_RATE * trust * dtMin;
        r.progress[key] = p;
        if (p >= 1) deliver(state, r, holder, target, trust, fresh);
      }
    }
  }
}

function deliver(state: GameState, r: Rumor, from: string, to: string, trust: number, fresh: number): void {
  const bs = state.belief;
  const fromDef = NPC_BY_ID[from];
  const cred = fromDef?.credibility ?? 0.5;
  const heat = r.heat[from] ?? 0.3;
  const fromName = fromDef?.name ?? from;

  if (to.startsWith('folk:')) {
    const region = bs.regions[to.slice(5) as RegionId];
    const acceptance = trust * cred;
    applyPush(region.folk, r.aspects, r.domains, heat * acceptance * fresh * 0.8);
    region.folk.conviction = clamp(region.folk.conviction + heat * acceptance * 0.3, 0, 1);
    const before = region.awareness;
    region.awareness = clamp(region.awareness + 0.5 * acceptance * (1 - region.awareness), 0, 1);
    region.folk.summary = `People repeat: “${r.text}”`;
    r.holders.push(to);
    r.heat[to] = heat * acceptance;
    if (to === 'folk:kurogane') log(state, 'rumor', `Rei carried a story over the pass to Kurogane: “${r.text}”`);
    else if (before < 0.25 && region.awareness >= 0.25) log(state, 'rumor', `The village is talking: “${r.text}”`);
    return;
  }

  const toDef = NPC_BY_ID[to];
  const belief = bs.npc[to] ?? (bs.npc[to] = emptyBelief());
  const toName = toDef?.name ?? to;
  const skept = toDef?.skepticism ?? 0.5;
  const own = bs.testimonies.find((t) => t.witness === to && t.eventId === r.eventId);

  let acceptance: number;
  if (own) {
    // First-hand memory beats hearsay.
    acceptance = own.readingId === r.readingId ? 0.25 : trust * cred * (1 - skept) * 0.3;
  } else {
    const consistency = cosine(r.aspects, belief.aspects);
    acceptance = trust * cred * (1 - skept * (consistency < 0 ? 1 : 0.5)) + 0.15 * consistency;
  }

  if (acceptance < REJECT_THRESHOLD) {
    r.rejectedBy.push(to);
    log(state, 'rumor', own
      ? `${toName} dismissed ${fromName}’s version — ${toName} was there and saw it differently.`
      : `${toName} refused to believe ${fromName}: “${r.text}”`);
    return;
  }
  const scale = heat * acceptance * fresh * 0.7;
  applyPush(belief, r.aspects, r.domains, scale);
  belief.conviction = clamp(belief.conviction + scale * 0.5, 0, 1);
  if (!own && belief.conviction < 0.5) belief.summary = `Heard from ${fromName}: “${r.text}”`;
  r.holders.push(to);
  r.heat[to] = heat * acceptance * (toDef?.exaggeration ?? 1);
  const npc = state.npcs[to];
  if (npc) {
    const cold = (r.aspects.terror ?? 0) + (r.aspects.destruction ?? 0) * 0.6;
    const warm = (r.aspects.guardian ?? 0) + (r.aspects.mercy ?? 0) * 0.8;
    npc.relationship = clamp(npc.relationship + (warm - cold) * scale * 0.4, -1, 1);
    npc.fear = clamp(npc.fear + cold * scale * 0.4, 0, 1);
  }
  log(state, 'rumor', `${fromName} told ${toName}: “${r.text}”${(toDef?.exaggeration ?? 1) > 1.3 ? ' (it grew in the telling)' : ''}`);
}

/** What a region, taken as a whole, believes the spirit is. */
export function regionalBelief(state: GameState, region: RegionId): Belief {
  const bs = state.belief;
  const out = emptyBelief();
  const rs = bs.regions[region];
  let total = 0;
  const add = (b: Belief, w: number) => {
    if (w <= 0) return;
    total += w;
    for (const a of ASPECTS) out.aspects[a] += b.aspects[a] * w;
    for (const d of DOMAINS) out.domains[d] += b.domains[d] * w;
    out.conviction += b.conviction * w;
  };
  // The folk count for their numbers, scaled by how many have actually heard.
  add(rs.folk, Math.sqrt(rs.population) * rs.awareness);
  for (const n of NPCS) {
    if (n.region !== region) continue;
    const b = bs.npc[n.id];
    if (b) add(b, 3 * n.credibility * (0.3 + b.conviction));
  }
  if (total > 0) {
    for (const a of ASPECTS) out.aspects[a] /= total;
    for (const d of DOMAINS) out.domains[d] /= total;
    out.conviction /= total;
  }
  return out;
}

export function topAspects(b: Belief, min = 0.12): Aspect[] {
  return [...ASPECTS].filter((a) => b.aspects[a] >= min).sort((x, y) => b.aspects[y] - b.aspects[x]);
}
