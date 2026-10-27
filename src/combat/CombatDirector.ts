// Runs combat inside the game: input → CombatSim → player/camera/HUD/audio, and turns
// fights into world events so the Belief Engine hears about them. One instance per Game.

import * as THREE from 'three';
import { CombatSim, CAMPS, CAMP_RESPAWN_MIN, STAMINA_COST, type CombatEvent, type Enemy } from '../sim/combat.js';
import { recordEvent, log, type WitnessInput } from '../sim/BeliefEngine.js';
import type { GameState } from '../sim/types.js';
import type { InputState } from '../input/Input.js';
import type { PlayerController, CameraRig } from '../player/PlayerController.js';
import type { SpiritBody } from '../player/SpiritBody.js';
import type { AudioEngine } from '../audio/AudioEngine.js';
import type { UI } from '../ui/UI.js';
import type { CollisionWorld } from '../world/Colliders.js';
import { CombatView } from './CombatView.js';
import { PLACES } from '../world/layout.js';

export interface CombatHost {
  scene: THREE.Scene;
  player: PlayerController;
  rig: CameraRig;
  body: SpiritBody;
  audio: AudioEngine;
  ui: UI;
  collision: CollisionWorld;
  ground(x: number, z: number): number;
  getState(): GameState;
  witnesses(at: THREE.Vector3, visibility: number, audible?: boolean): WitnessInput[];
  touch(): boolean;
}

const GOLD = new THREE.Color('#fff2c0');

export class CombatDirector {
  sim: CombatSim;
  view: CombatView;
  lockId: string | null = null;
  private hitstop = 0;
  private spawnTimer = 0;
  private hintTimer = 0;
  private wasCharged = false;
  private defeatT = -1;
  private defeatAt = new THREE.Vector3();
  private swingYaw = 0;
  /** Last few combat events, for the developer panel and tests. */
  recent: string[] = [];

  constructor(private h: CombatHost) {
    this.sim = new CombatSim({
      resolve: (x, z, r) => { const res = h.collision.resolve(x, z, r, h.ground(x, z)); return { x: res.x, z: res.z }; },
      seed: Math.floor(Math.random() * 1e9),
    });
    this.view = new CombatView(h.scene, (x, z) => h.ground(x, z));
  }

  /** The night must be over before the forest wakes. */
  active(state: GameState): boolean { return state.flags['flood_phase'] === 'resolved'; }

  /** While the spirit is coming apart, gameplay input is ignored. */
  get blocking(): boolean { return this.defeatT >= 0; }

  /** Time scale for this frame (hit-stop on impacts). */
  timeScale(): number { return this.hitstop > 0 ? 0.08 : 1; }

  lockTarget(): Enemy | null {
    return this.lockId ? this.sim.enemies.find((e) => e.id === this.lockId && e.phase !== 'dead') ?? null : null;
  }

  /** Remove every enemy (new game, load, title). Camps refill on their own. */
  clearAll(): void {
    this.sim.remove(() => true);
    this.view.clear();
    this.lockId = null;
    this.sim.hp = this.sim.maxHp; this.sim.defeated = false; this.sim.attack = null; this.sim.charging = false; this.sim.holdTime = null;
    this.defeatT = -1; this.h.body.dissolve = 0;
    this.spawnTimer = 0;
    this.h.rig.lockTarget = null;
  }

  // ─── before the movement controller runs ───────────────────────────────────

  /** Filter/consume input for combat and set up the controller's combat hooks. */
  preUpdate(dt: number, input: InputState, state: GameState): InputState {
    const p = this.h.player;
    this.hitstop = Math.max(0, this.hitstop - dt);
    if (this.blocking) {
      p.moveScale = 0; p.yawLock = p.yaw; p.faceTarget = null;
      return { ...input, jump: false, dodge: false, ability: false, interact: false, interactHeld: false };
    }
    if (!this.active(state)) { p.moveScale = 1; p.yawLock = null; p.faceTarget = null; return input; }

    // lock-on toggle
    if (input.lockOn) {
      if (this.lockId) this.lockId = null;
      else {
        const c = this.sim.lockCandidate({ x: p.pos.x, z: p.pos.z }, this.h.rig.yaw + Math.PI, 22);
        this.lockId = c?.id ?? null;
        if (c) this.h.audio.sfx('telegraph');
      }
    }
    this.validateLock();

    // dodge cancels the tail of an attack, never its hit window
    let dodge = input.dodge;
    if (dodge && this.sim.busy) { if (this.sim.cancelable) this.sim.cancelAttack(); else dodge = false; }
    if (dodge) { this.sim.charging = false; this.sim.holdTime = null; }

    // attacks
    this.sim.facing = p.yaw;
    const stamina = p.exhaustedNow ? 0 : p.stamina;
    const evs = this.sim.input(dt, input.attackHeld && !dodge, input.attackTap, input.heavyTap, stamina);
    for (const e of evs) this.handle(e, state, input);
    const c = this.sim.chargeLevel;
    if (c >= 1 && !this.wasCharged) { this.h.audio.sfx('charged'); this.h.body.triggerPulse(); }
    this.wasCharged = c >= 1;

    // controller hooks
    const lock = this.lockTarget();
    p.faceTarget = lock ? { x: lock.pos.x, z: lock.pos.z } : null;
    if (this.sim.busy) { p.moveScale = 0; p.yawLock = this.swingYaw; }
    else if (this.sim.charging) { p.moveScale = 0.3; p.yawLock = null; }
    else { p.moveScale = 1; p.yawLock = null; }
    const busy = this.sim.busy || this.sim.charging;
    return { ...input, dodge, jump: input.jump && !busy, sprint: input.sprint && !busy };
  }

  // ─── after the movement controller ran ─────────────────────────────────────

  update(dt: number, time: number, state: GameState, playing: boolean): void {
    const p = this.h.player;
    if (this.defeatT >= 0) this.updateDefeat(dt, state);
    if (playing && this.active(state)) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) { this.spawnTimer = 2; this.refillCamps(state); }
      this.sim.facing = p.yaw;
      const evs = this.sim.update(dt, { pos: { x: p.pos.x, z: p.pos.z }, invulnerable: p.invulnerable > 0 || this.blocking });
      for (const e of evs) this.handle(e, state);
    }
    this.validateLock();
    const lock = this.lockTarget();
    this.h.rig.lockTarget = lock && playing ? this.view.centerOf(lock) : null;
    this.view.update(this.sim, dt, time, p.pos, p.yaw, this.h.body.tint);
    if (this.hintTimer > 0) { this.hintTimer -= dt; if (this.hintTimer <= 0) this.h.ui.combatHint(null); }
  }

  /** HUD: essence, enemy bars, reticle, charge ring. */
  hud(camera: THREE.Camera, visible: boolean): void {
    const ui = this.h.ui;
    ui.essence(this.sim.hp, this.sim.maxHp, visible && this.sim.engaged);
    ui.charge(this.sim.chargeLevel + (this.sim.charging ? 0.001 : 0));
    const lock = this.lockTarget();
    const P = this.h.player.pos;
    const bars = visible ? this.sim.enemies
      .filter((e) => e.phase !== 'dead' && (e.aware > 0.5 || e.hp < e.def.hp || e === lock) && Math.hypot(e.pos.x - P.x, e.pos.z - P.z) < 32)
      .map((e) => ({ id: e.id, pos: this.view.headOf(e), hp: e.hp, max: e.def.hp, name: e === lock ? e.def.name : null, stagger: e.phase === 'stagger' })) : [];
    ui.enemyBars(bars, camera);
    ui.reticle(visible && lock ? this.view.centerOf(lock) : null, camera);
  }

  /** Belief-born powers also work on enemies. */
  ability(id: string, at: THREE.Vector3, yaw: number, state: GameState): void {
    if (!this.active(state)) return;
    const c = { x: at.x, z: at.z };
    let evs: CombatEvent[] = [];
    if (id === 'ward') { evs = this.sim.areaEffect(c, 5, { damage: 10, poise: 100, knock: 4 }); this.sim.heal(20); }
    else if (id === 'howl') evs = this.sim.areaEffect(c, 10, { damage: 6, poise: 100, knock: 2.5 });
    else if (id === 'rend') evs = this.sim.areaEffect(c, 5.5, { damage: 45, poise: 60, knock: 1.5, facing: yaw, arc: 0.8 });
    for (const e of evs) this.handle(e, state);
  }

  // ─── events ────────────────────────────────────────────────────────────────

  private handle(e: CombatEvent, state: GameState, input?: InputState): void {
    const h = this.h, p = h.player;
    const tag = e.type === 'swing' ? `swing:${e.attack.kind}${e.attack.kind === 'heavy' ? e.attack.charge.toFixed(2) : e.attack.step}`
      : e.type === 'enemyHit' ? `hit:${e.enemy.id}:${e.damage.toFixed(0)}${e.staggered ? ':stagger' : ''}`
      : 'enemy' in e ? `${e.type}:${e.enemy.id}` : e.type;
    this.recent.push(`${state.worldTime.toFixed(1)} ${tag}`);
    if (this.recent.length > 24) this.recent.shift();
    switch (e.type) {
      case 'swing': {
        const a = e.attack;
        p.spend(a.kind === 'heavy' ? STAMINA_COST.heavy : STAMINA_COST.light);
        // aim: lock target, else a nearby enemy, else where the stick points, else straight ahead
        let base = p.yaw;
        if (input && Math.hypot(input.moveX, input.moveY) > 0.3) {
          const cy = h.rig.yaw;
          const fx = -Math.sin(cy), fz = -Math.cos(cy);
          const wx = fx * input.moveY + -fz * input.moveX, wz = fz * input.moveY + fx * input.moveX;
          base = Math.atan2(wx, wz);
        }
        this.swingYaw = this.sim.aimYaw({ x: p.pos.x, z: p.pos.z }, base, this.lockId);
        p.yaw = this.swingYaw;
        this.sim.facing = this.swingYaw;
        p.push(Math.sin(this.swingYaw), Math.cos(this.swingYaw), a.lunge, a.kind === 'heavy' ? 0.2 : 0.13);
        h.body.strike(a.kind === 'heavy', a.step, a.dur);
        this.view.slash(p.pos, this.swingYaw, a, h.body.tint);
        h.audio.sfx(a.kind === 'heavy' ? 'swing_heavy' : 'swing');
        if (a.kind === 'heavy') h.rig.shake = Math.max(h.rig.shake, 0.25 + a.charge * 0.3);
        break;
      }
      case 'alert':
        if (Math.hypot(e.enemy.pos.x - p.pos.x, e.enemy.pos.z - p.pos.z) < 22) h.audio.sfx('alert');
        if (!state.flags['combat_tutorial']) {
          state.flags['combat_tutorial'] = true;
          this.hintTimer = 9;
          h.ui.combatHint(h.touch()
            ? 'Tap Strike · hold it for a heavy blow · ◎ to lock on · Dodge through red'
            : 'K or click to strike · hold K for a heavy blow · T to lock on · Q to dodge through red');
        }
        break;
      case 'telegraph': h.audio.sfx('telegraph'); break;
      case 'strike': break;
      case 'enemyHit': {
        const at = this.view.centerOf(e.enemy);
        this.view.sparks(at, e.heavy ? 22 : 12, e.staggered ? GOLD : h.body.tint.clone().lerp(GOLD, 0.6), e.heavy ? 8 : 5.5);
        h.audio.sfx(e.heavy ? 'hit_heavy' : 'hit');
        this.hitstop = Math.max(this.hitstop, e.heavy ? 0.09 : 0.045);
        h.rig.shake = Math.max(h.rig.shake, e.heavy ? 0.55 : 0.22);
        if (e.staggered) { h.audio.sfx('stagger'); this.view.ring(at.clone().setY(at.y - 0.6), GOLD, 2.2); }
        break;
      }
      case 'enemyDied': this.onEnemyDied(e.enemy, state); break;
      case 'playerHit':
        p.push(e.knock.x, e.knock.z, 7.5, 0.2, false);
        h.body.hurt();
        h.ui.hurtFlash(e.damage / 25);
        h.audio.sfx('hurt');
        h.rig.shake = Math.max(h.rig.shake, 0.85);
        this.hitstop = Math.max(this.hitstop, 0.07);
        this.view.sparks(new THREE.Vector3(p.pos.x, p.pos.y + 1.2, p.pos.z), 10, new THREE.Color('#ff4a3a'), 4);
        break;
      case 'dodged':
        h.body.triggerPulse();
        this.view.sparks(new THREE.Vector3(p.pos.x, p.pos.y + 1, p.pos.z), 8, h.body.tint, 3);
        break;
      case 'playerDefeated': this.beginDefeat(state); break;
    }
  }

  private onEnemyDied(en: Enemy, state: GameState): void {
    const h = this.h;
    const at = this.view.centerOf(en);
    this.view.sparks(at, 30, new THREE.Color(en.kind === 'wraith' ? '#b89cff' : '#ffb070'), 7);
    this.view.ring(at.clone().setY(at.y - 0.7), h.body.tint, 3.5);
    h.audio.sfx('enemy_die');
    if (en.kind === 'hound') h.audio.sfx('bell_crack');
    h.body.triggerPulse();
    if (this.lockId === en.id) {
      const next = this.sim.lockCandidate({ x: h.player.pos.x, z: h.player.pos.z }, h.rig.yaw + Math.PI, 12, en.id);
      this.lockId = next?.id ?? null;
    }
    // fights in the dark are glimpsed, not seen: witnesses get the deed at reduced clarity
    const vis = Math.min(1, h.body.visibility * 0.85);
    const pos = { x: en.pos.x, y: at.y, z: en.pos.z };
    recordEvent(state, en.kind === 'wraith' ? 'wraith_banished' : 'hound_slain', pos, { enemy: en.kind, camp: en.camp }, h.witnesses(at, vis));
    const campLeft = this.sim.alive.some((o) => o.camp === en.camp);
    if (!campLeft) {
      state.flags[`camp_${en.camp}`] = state.worldTime;
      const camp = CAMPS.find((c) => c.id === en.camp);
      if (camp) log(state, 'world', `It is quiet at ${camp.label} again — for now.`);
    }
  }

  private beginDefeat(state: GameState): void {
    this.defeatT = 0;
    this.lockId = null;
    this.defeatAt.copy(this.h.player.pos);
    this.h.audio.sfx('defeat');
    this.h.ui.combatHint(null);
    this.h.ui.toast('world', 'Your shape comes apart in the dark…');
    recordEvent(state, 'spirit_fell', { x: this.defeatAt.x, y: this.defeatAt.y, z: this.defeatAt.z }, {}, this.h.witnesses(this.defeatAt, this.h.body.visibility));
  }

  private updateDefeat(dt: number, state: GameState): void {
    this.defeatT += dt;
    const t = this.defeatT;
    const b = this.h.body;
    if (t < 1.6) b.dissolve = Math.min(1, t / 1.2);
    else if (t < 1.7) {
      // gather again where people keep candles for you, or where you first woke
      const shrine = !!state.flags['river_shrine_built'];
      const x = shrine ? PLACES.riverShrine.x + 2 : PLACES.start.x, z = shrine ? PLACES.riverShrine.z + 2 : PLACES.start.z;
      this.h.player.teleport(x, z, Math.PI * 0.5);
      this.h.rig.snapBehind(this.h.player);
      this.sim.reset();
    } else {
      b.dissolve = Math.max(0, 1 - (t - 1.7) / 1.3);
      if (t > 3.1) {
        b.dissolve = 0; this.defeatT = -1;
        log(state, 'world', 'You gather yourself out of mist and moonlight. Whatever was hunting you has gone back to its place.');
      }
    }
  }

  private validateLock(): void {
    if (!this.lockId) return;
    const t = this.lockTarget();
    const p = this.h.player.pos;
    if (!t || Math.hypot(t.pos.x - p.x, t.pos.z - p.z) > 26) this.lockId = null;
  }

  private refillCamps(state: GameState): void {
    const P = this.h.player.pos;
    let woke = false;
    for (const camp of CAMPS) {
      if (this.sim.enemies.some((e) => e.camp === camp.id)) continue;
      const cleared = state.flags[`camp_${camp.id}`];
      if (typeof cleared === 'number' && state.worldTime - cleared < CAMP_RESPAWN_MIN) continue;
      // never pop enemies into view right next to the player
      if (Math.hypot(P.x - camp.at.x, P.z - camp.at.z) < 26) continue;
      for (const s of camp.spawns) this.sim.spawn(s.kind, { x: camp.at.x + s.dx, z: camp.at.z + s.dz }, camp.id);
      woke = true;
    }
    if (woke && !state.flags['forest_woke']) {
      state.flags['forest_woke'] = true;
      log(state, 'world', 'With the flood gone, hollow shapes have begun to gather at the forest edge across the river.');
    }
  }
}

