# Roadmap

Status legend: **TESTED** (implemented + verified by automated or browser test) · **IMPLEMENTED** (in the build, not yet verified on a real device) · **PLANNED** · **BLOCKED**

## Phase 0 — Foundation
- TESTED · TypeScript project, build (`npm run build`), unit tests (`npm test`, 14 passing)
- TESTED · Separate project `gods-are-made-not-born`; Berlin Metro Life untouched
- IMPLEMENTED · GitHub Actions CI workflow, `vercel.json`
- BLOCKED · GitHub repository — needs an empty repo created by the owner (no repo-creation access from the build machine)
- BLOCKED · Vercel preview — waits on the GitHub repo (project will be git-connected, preview branches only, no production publish)

## Phase 1 — Visual foundation
- TESTED (headless Chromium) · Amahara Valley: height-field terrain, river with flood shader, waterfall, cedars/pines/maples/bamboo/ferns/grass, rocks, village of 7 houses, torii, stone & paper lanterns, arched bridge, mill with turning wheel, weir, abandoned hill shrine, storm sky, mountain layers, rain, lightning, mist, spirit motes
- TESTED · Third-person controller (acceleration, run, rush, jump with coyote/buffer, dodge with i-frames, stamina), collision, slope limits, water hover
- TESTED · Camera: orbit, non-inverted default, terrain + collider avoidance, auto-follow
- IMPLEMENTED · Touch controls (dynamic left joystick, right-side look, Act/Power/Jump/Dodge, safe areas, portrait warning) — **needs testing on a real iPhone/iPad**
- TESTED · Loading screen, title, pause, save/load slots, settings, journal
- IMPLEMENTED · Quality presets + dynamic resolution
- PLANNED · Real character animation (current NPCs are procedural rigged figures — a coherent placeholder style, not final art)
- PLANNED · Lock-on (arrives with combat)
- PLANNED · WebGPU path (current renderer is WebGL2 only)

## Phase 2 — Belief Engine
- TESTED · Events with IDs, witnesses, clarity by distance/visibility, temperament-driven readings (same deed → different beliefs)
- TESTED · Rumor propagation along social links with trust, credibility, skepticism, exaggeration, freshness decay, rejection by eyewitnesses
- TESTED · Regional belief (named NPCs + folk weighted by population × awareness); Rei carries stories to Kurogane after she leaves
- TESTED · Diminishing returns per witness/deed type
- TESTED · Developer panel (` key or Settings)

## Phase 3 — Divine evolution
- TESTED · Form derived from regional belief: halo, horns, embers, petals, veil, masks; hybrids (Gentle Current, Breaker of Floods, Dreaded Warden, Ruin-Howl, Watcher on the Bank)
- TESTED · Abilities unlocked by belief: Guardian's Ward, Dread Howl, Ember Rend (currently belief-generating deeds, not yet combat moves)

## Phase 4 — Combat
- PLANNED · Light/heavy attacks, lock-on, two enemy types (forest wraith, Bell Warden hound?), telegraphs, hit reactions

## Phase 5 — Living world
- IMPLEMENTED · NPC anchors per world state, fear/fleeing, praying at the river shrine, Daichi aiming when hostile, barks, belief-driven dialogue
- TESTED · Persistent consequences: river shrine, broken bridge, broken weir, damaged mill, warden bells, shuttered village vs. devotional lanterns
- PLANNED · Time-of-day schedules, faction reputation actions

## Phase 6 — First chapter
- TESTED · Intro cinematic, the Flood of Amahara with 4 outcomes (rescue / shatter weir / howl / do nothing), each persisting
- IMPLEMENTED · Abandoned shrine lore (the silent bell)
- PLANNED · Forest exploration content, mountain path, the Bell-Eater boss (destroy / spare / bind)

## Phase 7–8 — Polish, expansion
- PLANNED
