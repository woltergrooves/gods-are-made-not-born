// Core simulation types. Pure data — no rendering, no DOM.
// Everything here is serialisable and lives inside the save file.

export const ASPECTS = [
  'guardian', 'terror', 'trickster', 'wanderer',
  'nature', 'destruction', 'mercy', 'vengeance',
] as const;
export type Aspect = typeof ASPECTS[number];

export const DOMAINS = [
  'water', 'storm', 'ash', 'shadow', 'spirits', 'wildlife', 'illusion',
] as const;
export type Domain = typeof DOMAINS[number];

export type AspectVec = Record<Aspect, number>;
export type DomainVec = Record<Domain, number>;

export type RegionId = 'amahara' | 'kurogane';
export type FactionId = 'lantern_keepers' | 'bell_wardens' | 'none';

/** What one mind (an NPC, or the anonymous folk of a region) believes the player is. */
export interface Belief {
  aspects: AspectVec;
  domains: DomainVec;
  /** 0..1 — how sure they are that the spirit exists at all. */
  conviction: number;
  /** Short authored summary of their current reading, shown in dialogue/journal. */
  summary: string;
}

export interface Vec3 { x: number; y: number; z: number }

export interface WorldEvent {
  id: string;          // unique, e.g. "evt_0003_flood_rescue"
  type: string;        // key into EVENT_DEFS
  time: number;        // world minutes
  location: Vec3;
  /** Facts about what *actually* happened, independent of interpretation. */
  facts: Record<string, string | number | boolean>;
  witnesses: string[];
}

export interface Testimony {
  eventId: string;
  witness: string;
  readingId: string;
  clarity: number;
  text: string;
}

export interface Rumor {
  id: string;
  eventId: string;
  readingId: string;
  originator: string;
  /** Aspect / domain push this story carries (already scaled). */
  aspects: Partial<AspectVec>;
  domains: Partial<DomainVec>;
  /** How strongly each holder tells it (exaggeration compounds per retelling). */
  heat: Record<string, number>;
  bornAt: number;          // world minutes
  holders: string[];       // NPC ids or "folk:<region>"
  rejectedBy: string[];
  /** Share progress per directed link "from>to" (0..1). */
  progress: Record<string, number>;
  text: string;
}

export interface JournalEntry {
  time: number;
  kind: 'belief' | 'rumor' | 'world' | 'form' | 'system';
  text: string;
}

export interface RegionState {
  population: number;
  /** 0..1 — fraction of the populace that has heard *anything* about the spirit. */
  awareness: number;
  folk: Belief;
}

export interface BeliefState {
  npc: Record<string, Belief>;
  regions: Record<RegionId, RegionState>;
  events: WorldEvent[];
  testimonies: Testimony[];
  rumors: Rumor[];
  /** Diminishing returns: "witness|eventType" -> times seen. */
  exposure: Record<string, number>;
  nextId: number;
}

export interface NpcState {
  id: string;
  region: RegionId;
  /** -1..1 personal relationship toward the player (separate from belief). */
  relationship: number;
  /** Fear 0..1 — drives fleeing / hiding behaviour. */
  fear: number;
  mood: 'calm' | 'alarmed' | 'devoted' | 'hostile' | 'grieving' | 'curious';
  present: boolean;
  x: number; z: number;
  /** Persistent memory tags (e.g. "saw_howl", "betrayed"). */
  memory: string[];
}

export interface FormState {
  stage: 0 | 1 | 2;            // formless, glimpsed, embodied
  title: string;
  parts: string[];             // e.g. ["halo","horns"]
  dominant: Aspect[];
  domains: Domain[];
  hybrid: string | null;
}

export interface GameState {
  schemaVersion: number;
  seed: number;
  createdAt: number;
  playTime: number;
  worldTime: number;           // minutes since 22:00 of night one
  player: { x: number; y: number; z: number; yaw: number };
  belief: BeliefState;
  npcs: Record<string, NpcState>;
  flags: Record<string, string | number | boolean>;
  abilities: string[];
  form: FormState;
  journal: JournalEntry[];
  settings: { quality: 'low' | 'medium' | 'high'; invertY: boolean; sensitivity: number; debug: boolean };
}

export function zeroAspects(): AspectVec {
  return { guardian: 0, terror: 0, trickster: 0, wanderer: 0, nature: 0, destruction: 0, mercy: 0, vengeance: 0 };
}
export function zeroDomains(): DomainVec {
  return { water: 0, storm: 0, ash: 0, shadow: 0, spirits: 0, wildlife: 0, illusion: 0 };
}
export function emptyBelief(summary = 'Has never sensed you.'): Belief {
  return { aspects: zeroAspects(), domains: zeroDomains(), conviction: 0, summary };
}
