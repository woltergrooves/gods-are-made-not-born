# Gods Are Made, Not Born

*A god is not born. A god is believed into existence.*

An original Japanese-inspired dark-fantasy action RPG for the browser (iPhone/iPad first, desktop for development).
You begin as a nameless spirit. What villagers *believe* you did — not what you actually did — gives you a body, a title and powers.

## Run it

```bash
npm install          # only TypeScript is needed
npm run build        # tsc → dist/js, static files → dist/
npm test             # Belief Engine, save system and combat unit tests (node:test)
npx http-server dist # or any static server
```

Browser tests (need Playwright + Chromium installed locally):

```bash
node scripts/acceptance-test.mjs out rescue   # also: weir | howl | ignored
node scripts/combat-test.mjs out              # Phase 4 fights, driven by real key presses + touch HUD check
node scripts/screenshots.mjs out medium
```

URL options: `?quality=low|medium|high`, `?autostart`.

## Controls

| | Touch (landscape) | Keyboard / mouse | Gamepad |
|---|---|---|---|
| Move | left thumb (push to edge = rush) | WASD / arrows, Shift = rush | left stick, LB/L3 = rush |
| Camera | drag right side | drag mouse | right stick |
| Act / hold | Act button | E | X / □ |
| Power | Power button | F | Y / △ |
| Strike (tap) · Heavy (hold, release) | Strike button | K or click · hold K, or L / right-click | RB · hold RB, or RT |
| Lock on / release | ◎ button | T or middle-click | R3 |
| Jump · Dodge | buttons | Space · Q | A · B |
| Pause · Journal · Dev panel | top-left buttons | Esc · J/Tab · ` (backquote) | |

## Architecture

```
src/sim/        pure simulation (no DOM, unit-tested)
  types.ts        serialisable state: beliefs, rumors, NPCs, form
  content.ts      data: characters, temperaments, event readings, aspect→part map
  BeliefEngine.ts events → witnesses → readings → rumors → propagation → regional belief
  GameState.ts    new game, divine form derivation, consequences, flood outcomes, world step
  dialogue.ts     belief-driven dialogue and barks
src/save/        versioned envelope, checksum, migrations, backup recovery (storage injected)
src/platform/    IndexedDB adapter (localStorage fallback)
src/world/       height field, terrain, river/waterfall shaders, vegetation, architecture, weather, sky
src/player/      controller (run/sprint/jump/dodge/stamina), camera rig with collision, modular spirit body
src/npc/         procedural villager figures + behaviour (anchors, fear, prayer, aiming)
src/sim/combat.ts  combat rules: player combo/heavy, enemy AI, telegraphs, attack token, camps (unit-tested)
src/combat/      enemy figures, ground telegraphs, strike FX, CombatDirector (input → sim → camera/HUD/audio/beliefs)
src/game/        lifecycle, frame loop, the Flood of Amahara, interactions, abilities
src/ui/          HUD, touch buttons, menus, journal, settings, developer panel
src/audio/       procedural WebAudio soundscape
```

Rule: visual code reads `activeConsequences(state)` and `state.form`; it never decides outcomes.

## Tech note

The brief recommended Babylon.js + Vite. The build machine used for this first slice could not reach npm/CDNs (only GitHub),
so the engine is **three.js r186**, vendored from its GitHub build into `public/vendor/three` (MIT), with plain `tsc` and native ES
modules. Everything engine-specific lives in `src/world`, `src/player`, `src/npc` and `src/render`; the simulation is engine-agnostic.
See `docs/ROADMAP.md` for status and `docs/ASSETS.md` for licences.
