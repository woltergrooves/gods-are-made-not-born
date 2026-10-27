// Authored dialogue that reads from beliefs, moods, memories and world flags.
// What someone says to you depends on what they think you are — not on a quest script.

import { NPC_BY_ID } from './content.js';
import { topAspects } from './BeliefEngine.js';
import type { GameState } from './types.js';

export interface DialogueLine { speaker: string; text: string; mood: string }

export function dialogueFor(state: GameState, id: string): DialogueLine[] {
  const def = NPC_BY_ID[id];
  const npc = state.npcs[id];
  const b = state.belief.npc[id];
  if (!def || !npc || !b) return [];
  const name = def.name;
  const f = state.flags;
  const resolved = f['flood_phase'] === 'resolved';
  const top = topAspects(b, 0.15);
  const L = (text: string) => ({ speaker: name, text, mood: npc.mood });
  const out: DialogueLine[] = [];

  if (state.form.stage === 0 && b.conviction < 0.15) {
    // They cannot really perceive a spirit nobody believes in yet.
    const unseen: Record<string, string> = {
      hana: 'Hana pauses and pulls her shawl tighter. “Someone there? …No. Just the storm.”',
      daichi: 'Daichi’s eyes pass straight through you. He spits into the rain and checks his bowstring.',
      mio: 'Mio squints right at you, almost smiling, then the thunder makes her look away.',
      takeshi: 'Takeshi mutters a count of houses under his breath. He does not notice you.',
      aiko: 'Aiko shivers. “The river is wrong tonight,” she says to no one.',
      rei: 'Rei hums an old tune, and for a moment the words seem to be about you. Then they aren’t.',
      genzo: 'Genzo’s bell-staff gives a single dull note as you pass. He frowns at the empty air.',
    };
    return [{ speaker: '', text: unseen[id] ?? `${name} cannot see you.`, mood: npc.mood }];
  }

  if (!resolved) {
    const flood: Record<string, string> = {
      hana: '“If you are a spirit — any spirit — the child is on the rock. Please.”',
      daichi: '“Stay back from the water, thing. I’ve buried enough people this year.”',
      aiko: '“Mio! MIO! Somebody — anybody — she’s on the rock!”',
      takeshi: '“The old weir is holding the whole river against that rock. If it breaks, the bridge goes too.”',
      genzo: '“Do not bargain with it. Whatever it saves, it will want paid for.”',
      rei: '“Whatever you do next, someone will tell it wrong. That someone is usually me.”',
      mio: '“River spirit? Is that you? I knew you were real!”',
    };
    out.push(L(flood[id] ?? '“…”'));
    return out;
  }

  const opener = b.summary;
  out.push({ speaker: '', text: `${name} — ${opener}`, mood: npc.mood });

  const lines: Record<string, () => string> = {
    hana: () => {
      if (f['flood_outcome'] === 'rescue') return '“We built you a shrine. It’s small. Stones from the river you pulled her out of. A god should have somewhere to be thanked.”';
      if (f['flood_outcome'] === 'weir') return '“You saved her and you broke the bridge. The Lantern Keepers will say both are true. I am trying to.”';
      if (f['flood_outcome'] === 'howl') return '“I went into the water because no one else would. You were too busy being terrible. …Mio thinks you did it for her.”';
      return '“You were there. You watched. I keep telling myself spirits don’t understand. I’m not sure I believe it.”';
    },
    daichi: () => {
      if (npc.mood === 'hostile' || npc.fear > 0.3) return '“One more step and I find out whether arrows work on you.”';
      if (f['flood_outcome'] === 'ignored') return '“I pulled her out with my own hands. Where were you, god? Watching?”';
      if (top.includes('guardian')) return '“I saw what you did up close. That doesn’t mean I trust you. It means I’m watching you.”';
      return '“Things that live in rivers take children. That’s what they do.”';
    },
    mio: () => {
      if (top.includes('guardian')) return '“Grandmother said the river spirit had gold eyes! Do you want a rice ball? I saved you one.”';
      if (top.includes('terror')) return '“You’re scary now. …But I’m not scared. Much.”';
      return '“Are you staying? Please stay.”';
    },
    takeshi: () => {
      if (f['bridge_broken']) return '“The bridge took three summers to raise. I don’t care what you are — the village will need help rebuilding it.”';
      if (f['mill_damaged']) return '“No mill means no flour by winter. I’ll remember that, spirit.”';
      if (top.includes('terror')) return '“I won’t pretend to worship you. I will keep my people out of your way. Is that enough?”';
      return '“A spirit that helps is a spirit that can be asked for help again. I hope you understand that’s what worries me.”';
    },
    aiko: () => {
      if (f['mio_saved_by'] === 'spirit') return '“You gave me my daughter back. Whatever you need from this family, ask.”';
      if (f['mio_saved_by'] === 'daichi') return '“Daichi brought her back. Not you.”';
      return '“She’s alive. I keep saying it so I’ll believe it.”';
    },
    rei: () => {
      if (f['rei_departed']) return '“The pass is waiting. Shall I tell them you were kind, or that you were magnificent? It’s the same story to a city.”';
      return `“They’re calling you ${state.form.title} already. Give it a week and they’ll argue over what that means.”`;
    },
    genzo: () => {
      if (f['genzo_mobilised']) return '“Every bell on that gate is a promise: you will not feed on this village unseen.”';
      return '“A god is a debt the faithful don’t know they owe. I am here to read the ledger.”';
    },
  };
  out.push(L(lines[id]?.() ?? '“…”'));
  return out;
}

/** Short barks shown as floating speech above NPCs. */
export function barkFor(state: GameState, id: string): string | null {
  const npc = state.npcs[id];
  if (!npc) return null;
  const phase = state.flags['flood_phase'];
  if (phase === 'pending' || phase === 'active') {
    const barks: Record<string, string[]> = {
      aiko: ['Mio! Hold on!', 'Someone help her!', 'The water’s still rising!'],
      hana: ['Mio, don’t let go!', 'Spirits of the river, hear me!', 'Ring the bell! Ring it!'],
      daichi: ['Stay on the rock, girl!', 'The current’s too strong…'],
      takeshi: ['Everyone away from the bank!', 'The weir won’t hold much longer.'],
      mio: ['Mama!', 'I’m scared!', 'River spirit, please…'],
      genzo: ['Do not call on it!'],
      rei: ['What a night for a story…'],
    };
    const l = barks[id];
    return l ? l[Math.floor(state.playTime / 4 + id.length) % l.length]! : null;
  }
  if (npc.mood === 'hostile') return ['Keep away.', 'I see you.', 'Not one step closer.'][Math.floor(state.playTime / 5) % 3]!;
  if (npc.mood === 'devoted') return ['Thank you…', 'River guardian.', 'Bless this house.'][Math.floor(state.playTime / 6 + id.length) % 3]!;
  if (npc.fear > 0.45) return ['Don’t look at it!', 'Inside, quickly!'][Math.floor(state.playTime / 5) % 2]!;
  return null;
}
