// Authored, data-driven content for the Amahara vertical slice.
// Characters, their temperaments, and how different minds can read the same deed.

import type { Aspect, AspectVec, Domain, DomainVec, FactionId, RegionId } from './types.js';

export interface NpcDef {
  id: string;
  name: string;
  title: string;
  faction: FactionId;
  region: RegionId;
  /** How much others trust what this person says (0..1). */
  credibility: number;
  /** Resistance to hearsay (0..1). */
  skepticism: number;
  /** How much they inflate a story when retelling (1 = faithful). */
  exaggeration: number;
  /** Temperament: which readings come naturally to them when the facts are unclear. */
  predisposition: Partial<AspectVec>;
  /** Who they talk to, and how much they trust them (0..1). */
  links: Record<string, number>;
  spawn: { x: number; z: number };
  goal: string;
}

export const NPCS: NpcDef[] = [
  {
    id: 'hana', name: 'Hana', title: 'Shrine Keeper', faction: 'lantern_keepers', region: 'amahara',
    credibility: 0.75, skepticism: 0.3, exaggeration: 1.0,
    predisposition: { guardian: 0.5, mercy: 0.4, nature: 0.2, terror: -0.2 },
    links: { takeshi: 0.7, mio: 0.6, aiko: 0.7, rei: 0.5, daichi: 0.35 },
    spawn: { x: 34, z: 22 },
    goal: 'Prove that spirits and people can share the valley.',
  },
  {
    id: 'daichi', name: 'Daichi', title: 'Hunter', faction: 'none', region: 'amahara',
    credibility: 0.65, skepticism: 0.8, exaggeration: 1.15,
    predisposition: { terror: 0.6, vengeance: 0.3, destruction: 0.2, guardian: -0.3 },
    links: { takeshi: 0.6, genzo: 0.6, aiko: 0.4, hana: 0.3 },
    spawn: { x: 14, z: 2 },
    goal: 'Find out what has been taking people in the forest — and end it.',
  },
  {
    id: 'mio', name: 'Mio', title: 'Child of the Mill', faction: 'none', region: 'amahara',
    credibility: 0.35, skepticism: 0.05, exaggeration: 1.5,
    predisposition: { guardian: 0.7, trickster: 0.3, nature: 0.2 },
    links: { aiko: 0.95, hana: 0.7, rei: 0.6, takeshi: 0.3 },
    spawn: { x: 5.5, z: 14 },
    goal: 'Prove that the river spirit from her grandmother’s stories is real.',
  },
  {
    id: 'takeshi', name: 'Takeshi', title: 'Village Elder', faction: 'none', region: 'amahara',
    credibility: 0.85, skepticism: 0.6, exaggeration: 0.9,
    predisposition: { wanderer: 0.3, guardian: 0.1, terror: 0.1 },
    links: { hana: 0.6, daichi: 0.6, genzo: 0.5, aiko: 0.6, rei: 0.4 },
    spawn: { x: 52, z: 30 },
    goal: 'Keep Amahara alive through another bad season, whatever the gods want.',
  },
  {
    id: 'aiko', name: 'Aiko', title: 'Miller', faction: 'none', region: 'amahara',
    credibility: 0.6, skepticism: 0.45, exaggeration: 1.1,
    predisposition: { mercy: 0.3, guardian: 0.2, terror: 0.2 },
    links: { mio: 0.9, hana: 0.6, takeshi: 0.6, daichi: 0.4, rei: 0.4 },
    spawn: { x: 30, z: 6 },
    goal: 'Keep her daughter and her mill out of the river’s reach.',
  },
  {
    id: 'rei', name: 'Rei', title: 'Wandering Storyteller', faction: 'none', region: 'amahara',
    credibility: 0.55, skepticism: 0.35, exaggeration: 1.6,
    predisposition: { trickster: 0.4, wanderer: 0.3, terror: 0.15, guardian: 0.15 },
    links: { mio: 0.5, hana: 0.5, takeshi: 0.4, aiko: 0.4, 'folk:kurogane': 0.8 },
    spawn: { x: 64, z: 44 },
    goal: 'Carry the best story in the valley to the cities beyond the pass.',
  },
  {
    id: 'genzo', name: 'Genzo', title: 'Bell Warden Envoy', faction: 'bell_wardens', region: 'amahara',
    credibility: 0.7, skepticism: 0.85, exaggeration: 1.05,
    predisposition: { terror: 0.4, destruction: 0.3, trickster: 0.3, guardian: -0.2, mercy: -0.2 },
    links: { daichi: 0.6, takeshi: 0.5 },
    spawn: { x: 60, z: 18 },
    goal: 'Stop a new god from feeding on Amahara before it grows teeth.',
  },
];

export const NPC_BY_ID: Record<string, NpcDef> = Object.fromEntries(NPCS.map((n) => [n.id, n]));

export const FACTIONS: Record<Exclude<FactionId, 'none'>, { name: string; creed: string }> = {
  lantern_keepers: { name: 'The Lantern Keepers', creed: 'A god who is fed with care can learn care.' },
  bell_wardens: { name: 'The Bell Wardens', creed: 'Devotion is food. Ration it, or be eaten.' },
};

// ─── Event interpretations ──────────────────────────────────────────────────

export interface Reading {
  id: string;
  aspects: Partial<AspectVec>;
  domains: Partial<DomainVec>;
  /** Authored base plausibility. */
  base: number;
  /** Positive: favoured by clear sight. Negative: a misreading favoured by poor sight. */
  clarityBias: number;
  /** Only available to some witnesses. */
  onlyFor?: string[];
  testimony: string;   // first-hand, "{name}" substituted
  /** Per-witness override when the witness is part of the scene (e.g. the rescued child). */
  testimonyBy?: Record<string, string>;
  rumor: string;       // how it sounds when retold
  summary: string;     // the witness's new understanding of the spirit
}

export interface EventDef {
  type: string;
  magnitude: number;
  /** Max distance (m) at which a witness can see anything. */
  range: number;
  readings: Reading[];
}

export const EVENT_DEFS: Record<string, EventDef> = {
  flood_rescue: {
    type: 'flood_rescue', magnitude: 1.0, range: 60,
    readings: [
      {
        id: 'saviour', aspects: { guardian: 0.8, mercy: 0.4 }, domains: { water: 0.5 }, base: 0.6, clarityBias: 0.6,
        testimony: '{name} saw a pale light lift Mio out of the flood and set her on the bank.',
        testimonyBy: { mio: 'Mio felt hands made of light lift her out of the water. She is sure it was the river spirit from Grandmother\u2019s songs.' },
        rumor: 'A river spirit pulled the miller’s girl from the flood with its own hands.',
        summary: 'Believes you are a guardian of the river.',
      },
      {
        id: 'abductor', aspects: { terror: 0.8, trickster: 0.3 }, domains: { water: 0.4, shadow: 0.3 }, base: 0.2, clarityBias: -0.5,
        testimony: '{name} saw a shape seize Mio in the water. From where they stood it looked like it was dragging her away — until it let go.',
        rumor: 'Something in the river tried to take the miller’s girl. It only let go because people were watching.',
        summary: 'Believes you tried to take Mio, and failed.',
      },
      {
        id: 'old_spirit', aspects: { nature: 0.6, guardian: 0.3 }, domains: { spirits: 0.5, water: 0.3 }, base: 0.25, clarityBias: 0.0,
        testimony: '{name} is certain it was the old river spirit from the shrine songs, come back after a hundred years.',
        rumor: 'The old river spirit of Amahara has woken up again.',
        summary: 'Believes you are the old river spirit reborn.',
      },
    ],
  },
  flood_weir_shattered: {
    type: 'flood_weir_shattered', magnitude: 1.1, range: 80,
    readings: [
      {
        id: 'stormbreaker', aspects: { guardian: 0.5, destruction: 0.6 }, domains: { storm: 0.5, water: 0.3 }, base: 0.5, clarityBias: 0.5,
        testimony: '{name} saw the old weir burst apart. The flood drained away from Mio — and tore the bridge loose on its way.',
        rumor: 'A spirit split the weir like kindling to save the village. It took the bridge as payment.',
        summary: 'Believes you saved the village by breaking it.',
      },
      {
        id: 'wrecker', aspects: { destruction: 0.8, terror: 0.4 }, domains: { storm: 0.6 }, base: 0.2, clarityBias: -0.4,
        testimony: '{name} only saw the weir explode and the bridge go under. Whatever did that was not trying to help.',
        rumor: 'A storm-god smashed the weir and the bridge in a single blow.',
        summary: 'Believes you are a destroyer that came with the storm.',
      },
    ],
  },
  flood_ignored: {
    type: 'flood_ignored', magnitude: 0.6, range: 45,
    readings: [
      {
        id: 'watcher', aspects: { wanderer: 0.7, terror: 0.2 }, domains: { spirits: 0.3 }, base: 0.5, clarityBias: 0.4,
        testimony: '{name} saw a cold light drifting at the edge of the water while Mio screamed. It only watched.',
        rumor: 'There is a spirit at the river that watches children drown and does nothing.',
        summary: 'Believes you are an indifferent wanderer.',
      },
      {
        id: 'cause', aspects: { terror: 0.6, vengeance: 0.4 }, domains: { water: 0.5, storm: 0.3 }, base: 0.2, clarityBias: -0.5,
        testimony: '{name} is sure the light at the river *was* the flood — it brought the water and waited to see who it could take.',
        rumor: 'The flood had a face. It was watching from the bank.',
        summary: 'Believes you caused the flood.',
      },
    ],
  },
  flood_howl: {
    type: 'flood_howl', magnitude: 1.2, range: 90,
    readings: [
      {
        id: 'dread', aspects: { terror: 0.9, vengeance: 0.2 }, domains: { storm: 0.4, shadow: 0.4 }, base: 0.6, clarityBias: 0.3,
        testimony: '{name} heard the spirit howl over the storm. Lanterns went out. People ran.',
        rumor: 'A god howled over Amahara during the flood. Bar your doors.',
        summary: 'Fears you as a god of dread.',
      },
      {
        id: 'river_scolded', aspects: { guardian: 0.7, trickster: 0.3 }, domains: { storm: 0.3, water: 0.3 }, base: 0.0, clarityBias: -0.2,
        onlyFor: ['mio'],
        testimony: '{name} thinks the spirit roared at the river to frighten it away from her.',
        rumor: 'Mio says the spirit roared at the flood and the river was scared of it.',
        summary: 'Believes you scared the flood away to protect her.',
      },
    ],
  },
  ward_shown: {
    type: 'ward_shown', magnitude: 0.35, range: 30,
    readings: [
      {
        id: 'blessing', aspects: { guardian: 0.6, mercy: 0.3 }, domains: { spirits: 0.3 }, base: 0.5, clarityBias: 0.4,
        testimony: '{name} felt a warm light pass over them. The rain stopped touching them for a moment.',
        rumor: 'The river spirit blesses people who stand near it.',
        summary: 'Has felt your blessing.',
      },
      {
        id: 'omen', aspects: { terror: 0.4, trickster: 0.3 }, domains: { illusion: 0.3 }, base: 0.15, clarityBias: -0.3,
        testimony: '{name} saw a ring of light open in the air. Omens are never good.',
        rumor: 'Strange lights have been seen around the village.',
        summary: 'Treats your lights as an omen.',
      },
    ],
  },
  howl_used: {
    type: 'howl_used', magnitude: 0.45, range: 40,
    readings: [
      {
        id: 'menace', aspects: { terror: 0.8 }, domains: { shadow: 0.4 }, base: 0.6, clarityBias: 0.3,
        testimony: '{name} was driven back by a howl that came from nowhere.',
        rumor: 'The spirit threatens anyone who comes close.',
        summary: 'Is frightened of you.',
      },
    ],
  },
  ember_rend: {
    type: 'ember_rend', magnitude: 0.4, range: 40,
    readings: [
      {
        id: 'ruin', aspects: { destruction: 0.8 }, domains: { ash: 0.5 }, base: 0.6, clarityBias: 0.3,
        testimony: '{name} watched something split apart in a burst of embers.',
        rumor: 'The spirit breaks whatever it touches.',
        summary: 'Has seen what you destroy.',
      },
    ],
  },
  // ── Combat (Phase 4): fights in the dark are seen badly, and told worse ──
  wraith_banished: {
    type: 'wraith_banished', magnitude: 0.55, range: 50,
    readings: [
      {
        id: 'protector', aspects: { guardian: 0.6, destruction: 0.2 }, domains: { spirits: 0.4 }, base: 0.5, clarityBias: 0.5,
        testimony: '{name} saw the spirit tear a hollow wraith apart at the edge of the trees. Whatever it is, it hunts the things that hunt us.',
        rumor: 'The new spirit kills the hollow ones that come out of the forest.',
        summary: 'Believes you hunt the things that prey on the valley.',
      },
      {
        id: 'devourer', aspects: { terror: 0.5, destruction: 0.4 }, domains: { shadow: 0.4 }, base: 0.25, clarityBias: -0.45,
        testimony: '{name} only saw two shapes in the dark, and one of them swallowed the other.',
        rumor: 'Something in the forest is eating the other spirits. It grows bigger every night.',
        summary: 'Believes you feed on lesser spirits to grow.',
      },
      {
        id: 'spirit_war', aspects: { wanderer: 0.4, vengeance: 0.3 }, domains: { spirits: 0.3 }, base: 0.2, clarityBias: 0.0,
        testimony: '{name} thinks the spirits are fighting over the valley like dogs over a bone.',
        rumor: 'The spirits are at war in the forest. Keep the children inside.',
        summary: 'Believes you are one side of a war between spirits.',
      },
    ],
  },
  hound_slain: {
    type: 'hound_slain', magnitude: 0.7, range: 50,
    readings: [
      {
        id: 'bell_avenger', aspects: { guardian: 0.5, vengeance: 0.4 }, domains: { spirits: 0.3 }, base: 0.45, clarityBias: 0.45,
        testimony: '{name} saw the spirit kill one of the silent hounds — the ones with dead bells at their throats.',
        rumor: 'The spirit is hunting the Bell-Eater’s hounds.',
        summary: 'Believes you are fighting whatever is eating the bells.',
      },
      {
        id: 'beast', aspects: { destruction: 0.6, terror: 0.3 }, domains: { wildlife: 0.4 }, base: 0.3, clarityBias: -0.4,
        testimony: '{name} heard snarling and bronze cracking in the dark. When it stopped, only the spirit was standing.',
        rumor: 'The spirit tore a hound in half with its bare hands.',
        summary: 'Believes you are a beast wearing a god’s shape.',
      },
    ],
  },
  spirit_fell: {
    type: 'spirit_fell', magnitude: 0.4, range: 45,
    readings: [
      {
        id: 'wounded_god', aspects: { wanderer: 0.4, mercy: 0.2 }, domains: { spirits: 0.2 }, base: 0.5, clarityBias: 0.3,
        testimony: '{name} saw the spirit come apart under the claws of something from the forest. Can a god be wounded?',
        rumor: 'The new spirit can bleed. Whatever it is, it is not all-powerful.',
        summary: 'Believes you can be hurt — and can fail.',
      },
      {
        id: 'trick', aspects: { trickster: 0.5 }, domains: { illusion: 0.4 }, base: 0.25, clarityBias: -0.3,
        testimony: '{name} swears the spirit only pretended to fall, then reappeared somewhere else.',
        rumor: 'You cannot kill the river spirit. It scatters like mist and gathers again.',
        summary: 'Believes you cannot truly be killed.',
      },
    ],
  },
};

/** Aspect -> visual part on the spirit body. */
export const ASPECT_PARTS: Partial<Record<Aspect, { part: string; threshold: number; ability?: string }>> = {
  guardian: { part: 'halo', threshold: 0.28, ability: 'ward' },
  terror: { part: 'horns', threshold: 0.28, ability: 'howl' },
  destruction: { part: 'embers', threshold: 0.24, ability: 'rend' },
  mercy: { part: 'petals', threshold: 0.24 },
  wanderer: { part: 'veil', threshold: 0.26 },
  trickster: { part: 'masks', threshold: 0.3 },
};

export const HYBRIDS: { needs: Aspect[]; title: string; id: string }[] = [
  { needs: ['guardian', 'terror'], title: 'The Dreaded Warden', id: 'dreaded_warden' },
  { needs: ['guardian', 'destruction'], title: 'The Breaker of Floods', id: 'flood_breaker' },
  { needs: ['terror', 'destruction'], title: 'The Ruin-Howl', id: 'ruin_howl' },
  { needs: ['wanderer', 'terror'], title: 'The Watcher on the Bank', id: 'bank_watcher' },
  { needs: ['guardian', 'mercy'], title: 'The Gentle Current', id: 'gentle_current' },
];

export const SINGLE_TITLES: Partial<Record<Aspect, string>> = {
  guardian: 'The River Guardian',
  terror: 'The Howling Dark',
  destruction: 'The Weir-Breaker',
  wanderer: 'The Pale Wanderer',
  mercy: 'The Merciful Light',
  trickster: 'The Lantern Trickster',
  nature: 'The Old River Spirit',
  vengeance: 'The Grudge of the River',
};

export const DOMAIN_NAMES: Record<Domain, string> = {
  water: 'Water', storm: 'Storms', ash: 'Fire & Ash', shadow: 'Shadow',
  spirits: 'Spirits', wildlife: 'Wildlife', illusion: 'Illusion',
};
