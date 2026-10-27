# Roadmap

Status legend: **TESTED** (implemented + verified by automated or browser test) · **IMPLEMENTED** (in the build, not yet verified on a real device) · **PLANNED** · **BLOCKED**

## Phase 0 — Foundation
- TESTED · TypeScript project, build (`npm run build`), unit tests (`npm test`, 23 passing)
- TESTED · Separate project `gods-are-made-not-born`; Berlin Metro Life untouched
- IMPLEMENTED · GitHub Actions CI workflow, `vercel.json`
- TESTED · GitHub repository woltergrooves/gods-are-made-not-born, work on branch `develop`
- TESTED · Vercel project `gods-are-made-not-born` (team Wolter), git-connected; Vercel build passes with TypeScript 5 and serves the game

## Phase 1 — Visual foundation
- TESTED (headless Chromium) · Amahara Valley: height-field terrain, river with flood shader, waterfall, cedars/pines/maples/bamboo/ferns/grass, rocks, village of 7 houses, torii, stone & paper lanterns, arched bridge, mill with turning wheel, weir, abandoned hill shrine, storm sky, mountain layers, rain, lightning, mist, spirit motes
- TESTED · Third-person controller (acceleration, run, rush, jump with coyote/buffer, dodge with i-frames, stamina), collision, slope limits, water hover
- TESTED · Camera: orbit, non-inverted default, terrain + collider avoidance, auto-follow
- IMPLEMENTED · Touch controls (dynamic left joystick, right-side look, Act/Power/Jump/Dodge, safe areas, portrait warning) — **needs testing on a real iPhone/iPad**
- TESTED · Loading screen, title, pause, save/load slots, settings, journal
- IMPLEMENTED · Quality presets + dynamic resolution
- PLANNED · Real character animation (current NPCs are procedural rigged figures — a coherent placeholder style, not final art)
- TESTED · Lock-on camera (see Phase 4)
- PLANNED · WebGPU path (current renderer is WebGL2 only)

## Phase 2 — Belief Engine
- TESTED · Events with IDs, witnesses, clarity by distance/visibility, temperament-driven readings (same deed → different beliefs)
- TESTED · Rumor propagation along social links with trust, credibility, skepticism, exaggeration, freshness decay, rejection by eyewitnesses
- TESTED · Regional belief (named NPCs + folk weighted by population × awareness); Rei carries stories to Kurogane after she leaves
- TESTED · Diminishing returns per witness/deed type
- TESTED · Developer panel (` key or Settings)

## Phase 3 — Divine evolution
- TESTED · Form derived from regional belief: halo, horns, embers, petals, veil, masks; hybrids (Gentle Current, Breaker of Floods, Dreaded Warden, Ruin-Howl, Watcher on the Bank)
- TESTED · Abilities unlocked by belief: Guardian's Ward, Dread Howl, Ember Rend — still belief-generating deeds, and now also combat moves (Ward: knock back + heal, Howl: stagger everything near, Rend: heavy cone)

## Phase 4 — Combat
- TESTED · Combat rules in a pure, unit-tested sim (`src/sim/combat.ts`, 9 tests): 3-step light combo with input buffering, hold-to-charge heavy, poise & stagger, hit-stop, dodge-cancel after the hit window, stamina costs
- TESTED · Two enemy types, original procedural figures: **Hollow Wraith** (floating robe & mask; rake + long lunge) and **Silent Hound** (ash hound with a cracked silent bell; bite + pounce)
- TESTED · Every enemy attack is telegraphed on the ground (arc / line / landing circle that fills and blinks before the hit); unit test proves no damage before the wind-up ends
- TESTED · Attack token: only one enemy attacks at a time; the others circle and wait
- TESTED · Lock-on (T / ◎ / R3): reticle, name + health bar, camera frames spirit and target, auto-retarget on kill
- TESTED · Hit reactions both ways: sparks, flash, knockback, camera shake, hurt vignette, essence bar with damage ghost
- TESTED · Defeat → the spirit dissolves and re-gathers at the river shrine (or where it woke); enemies return to their posts
- TESTED · Three camps (forest edge, cedar hollow, shrine steps) wake only after the flood night; cleared camps are saved and repopulate after 90 world minutes
- TESTED · Fights feed the Belief Engine: `wraith_banished`, `hound_slain`, `spirit_fell` — witnesses read them differently (protector / devourer / spirit war, bell-avenger / beast, wounded god / trickster)
- TESTED (headless Chromium, real key presses) · `scripts/combat-test.mjs`: camps wake, lock-on, telegraph before damage, light combo kills, charged heavy staggers, belief event, defeat & respawn, save/reload, touch HUD fits an iPhone landscape screen
- IMPLEMENTED · Touch combat: Strike (tap / hold for heavy), ◎ lock-on — **needs testing on a real iPhone/iPad**
- PLANNED · Tuning pass after real-device play (damage, wind-up lengths, camera distance), enemy variety, parry/perfect-dodge reward

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
