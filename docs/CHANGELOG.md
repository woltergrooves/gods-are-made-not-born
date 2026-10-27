# Changelog

## 0.2.0 — Phase 4: combat (2026-10-27)
- Combat simulation (`src/sim/combat.ts`): light 3-hit combo with buffering, hold-to-charge heavy, poise/stagger, hit-stop, dodge-cancel, stamina costs, one-attacker-at-a-time token.
- Enemies: Hollow Wraith (rake, lunge) and Silent Hound (bite, pounce), procedural original figures with readable wind-up poses.
- Ground telegraphs for every enemy attack (arc, line, landing circle).
- Lock-on with reticle, enemy name and health bar; camera keeps spirit and target in frame.
- Player essence (health), hurt feedback, defeat and respawn at the river shrine.
- Three enemy camps that wake after the flood; cleared camps persist in saves and repopulate later.
- Belief-born powers (Ward, Howl, Rend) affect enemies.
- Fights become world events the villagers interpret: wraith_banished, hound_slain, spirit_fell.
- Touch HUD: Strike button (tap/hold) and ◎ lock-on; keyboard K/L/T and mouse clicks; gamepad RB/RT/R3.
- Witness toasts are grouped (one toast + "…and N more") instead of one per witness.
- Tests: 9 new unit tests (23 total); new browser test `scripts/combat-test.mjs`.

## 0.1.0 — first playable slice (2026-10-27)
- Project foundation, build, unit tests, CI workflow.
- Belief Engine: events, witnesses, readings, rumors, regional belief, diminishing returns, developer panel.
- Save system: IndexedDB, 3 manual slots + autosave, checksums, backup recovery, schema migrations.
- Amahara Valley environment (procedural, original), weather, procedural audio.
- Spirit player with modular, belief-driven body; touch / keyboard / gamepad input.
- Seven NPCs (Hana, Daichi, Mio, Takeshi, Aiko, Rei, Genzo), two factions.
- The Flood of Amahara: 4 persistent outcomes.
- Acceptance test (headless Chromium): new game → move → rescue → beliefs → visible shrine → save → full reload → load → consequence persists. PASS.
