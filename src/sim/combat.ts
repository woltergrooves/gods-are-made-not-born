// Combat simulation. Pure data and rules — no rendering, no DOM — so it can be unit tested
// and stays independent of the engine. The game layer feeds it the player's position and
// reads back events (telegraphs, hits, deaths) to drive visuals, audio and the Belief Engine.
//
// Design rules this file enforces:
//  - Every enemy attack is telegraphed: no damage can happen before its wind-up has finished.
//  - Only one enemy attacks at a time (an attack token), so groups stay readable on a phone.
//  - Light hits chip and build pressure; heavy hits break poise and interrupt wind-ups.
//  - Dodging (player i-frames) beats every attack.

export interface V2 { x: number; z: number }

export type EnemyKind = 'wraith' | 'hound';
export type EnemyPhase = 'idle' | 'alert' | 'chase' | 'windup' | 'strike' | 'recover' | 'stagger' | 'return' | 'dead';
export type TelegraphShape = 'arc' | 'line' | 'circle';

export interface EnemyAttackDef {
  id: string;
  windup: number;      // seconds of readable warning
  active: number;      // seconds the hit can land
  recover: number;     // seconds the enemy is open afterwards
  range: number;       // reach (m) — for 'circle' the landing radius
  arc: number;         // half-angle (radians) for 'arc'; half-width (m) for 'line'
  damage: number;
  dash: number;        // metres travelled during the active window
  shape: TelegraphShape;
  minDist: number;     // only chosen when the player is between minDist..maxDist
  maxDist: number;
  cooldown: number;
}

export interface EnemyDef {
  kind: EnemyKind;
  name: string;
  hp: number;
  poise: number;
  radius: number;
  speed: number;
  aggro: number;       // notices the player within this distance
  leash: number;       // gives up when the player is this far from its home
  hover: number;       // preferred distance while waiting for its turn
  attacks: EnemyAttackDef[];
}

export const ENEMY_DEFS: Record<EnemyKind, EnemyDef> = {
  // A hollow robe with a mask where a face should be. Slow, floats, reaches far.
  wraith: {
    kind: 'wraith', name: 'Hollow Wraith', hp: 60, poise: 26, radius: 0.55, speed: 3.0,
    aggro: 15, leash: 34, hover: 4.2,
    attacks: [
      { id: 'rake', windup: 0.75, active: 0.18, recover: 0.75, range: 2.6, arc: 0.95, damage: 14, dash: 0.8, shape: 'arc', minDist: 0, maxDist: 3.2, cooldown: 1.4 },
      { id: 'lunge', windup: 1.0, active: 0.32, recover: 1.0, range: 1.4, arc: 0.75, damage: 20, dash: 6.5, shape: 'line', minDist: 3.2, maxDist: 8, cooldown: 2.4 },
    ],
  },
  // A lean ash-grey hound with a cracked, silent bell at its throat. Fast, circles, pounces.
  hound: {
    kind: 'hound', name: 'Silent Hound', hp: 85, poise: 40, radius: 0.6, speed: 6.4,
    aggro: 18, leash: 40, hover: 5.5,
    attacks: [
      { id: 'bite', windup: 0.5, active: 0.15, recover: 0.6, range: 2.2, arc: 0.7, damage: 15, dash: 1.2, shape: 'arc', minDist: 0, maxDist: 2.8, cooldown: 1.1 },
      { id: 'pounce', windup: 0.9, active: 0.42, recover: 0.9, range: 2.3, arc: 0, damage: 24, dash: 0, shape: 'circle', minDist: 4, maxDist: 9.5, cooldown: 2.6 },
    ],
  },
};

export interface Enemy {
  id: string;
  kind: EnemyKind;
  def: EnemyDef;
  camp: string;
  home: V2;
  pos: V2;
  yaw: number;           // facing, radians (atan2(dx, dz) convention, same as the player)
  hp: number;
  poise: number;
  phase: EnemyPhase;
  t: number;             // time in current phase
  attack: EnemyAttackDef | null;
  aimDir: V2;            // locked strike direction (unit)
  aimPoint: V2;          // locked landing point (circle attacks)
  strikeFrom: V2;
  hitDone: boolean;
  cooldown: number;
  flinch: number;        // brief freeze after taking a hit
  flash: number;         // 0..1 hit flash for visuals
  sinceHit: number;
  circleDir: 1 | -1;
  aware: number;         // 0..1 how engaged (for HUD)
}

export type PlayerAttackKind = 'light' | 'heavy';

export interface PlayerAttack {
  kind: PlayerAttackKind;
  step: number;          // 0..2 combo step for light attacks
  t: number;
  dur: number;
  activeFrom: number;
  activeTo: number;
  damage: number;
  poise: number;
  range: number;
  arc: number;
  lunge: number;         // m/s forward push at the start
  charge: number;        // heavy only, 0..1
  hit: string[];
}

export const LIGHT_COMBO = [
  { dur: 0.40, activeFrom: 0.09, activeTo: 0.20, damage: 11, poise: 8, range: 2.4, arc: 1.05, lunge: 4.5 },
  { dur: 0.42, activeFrom: 0.09, activeTo: 0.21, damage: 11, poise: 8, range: 2.4, arc: 1.05, lunge: 4.5 },
  { dur: 0.62, activeFrom: 0.19, activeTo: 0.32, damage: 19, poise: 18, range: 2.8, arc: 1.3, lunge: 6.5 },
];
export const HEAVY = { dur: 0.72, activeFrom: 0.26, activeTo: 0.40, base: 22, perCharge: 28, poiseBase: 30, poisePerCharge: 30, range: 3.0, arc: 1.45, lunge: 5.5 };
export const HEAVY_HOLD = 0.28;      // hold attack this long to start charging a heavy
export const CHARGE_TIME = 0.9;      // seconds to a full charge
export const STAMINA_COST = { light: 9, heavy: 20 };
export const PLAYER_MAX_HP = 100;
const HURT_IFRAMES = 0.75;

export interface PlayerView {
  pos: V2;
  invulnerable: boolean; // dodge i-frames from the movement controller
}

export type CombatEvent =
  | { type: 'alert'; enemy: Enemy }
  | { type: 'telegraph'; enemy: Enemy; attack: EnemyAttackDef }
  | { type: 'strike'; enemy: Enemy; attack: EnemyAttackDef }
  | { type: 'swing'; attack: PlayerAttack }
  | { type: 'enemyHit'; enemy: Enemy; damage: number; heavy: boolean; staggered: boolean; at: V2 }
  | { type: 'enemyDied'; enemy: Enemy }
  | { type: 'playerHit'; enemy: Enemy; damage: number; knock: V2 }
  | { type: 'dodged'; enemy: Enemy }
  | { type: 'playerDefeated' };

export interface CombatOptions {
  /** Pushes a circle out of world colliders. Defaults to no collision. */
  resolve?: (x: number, z: number, r: number) => V2;
  seed?: number;
}

export class CombatSim {
  enemies: Enemy[] = [];
  hp = PLAYER_MAX_HP;
  maxHp = PLAYER_MAX_HP;
  attack: PlayerAttack | null = null;
  /** Seconds the attack button has been held (null when not held). */
  holdTime: number | null = null;
  charging = false;
  hurt = 0;              // post-hit i-frames
  defeated = false;
  /** Enemy currently allowed to attack. */
  token: string | null = null;
  private buffered = false;
  /** Set when a hit interrupts a held button: ignore it until it is let go. */
  private holdVoid = false;
  private comboStep = 0;
  private comboReset = 0;
  private nextId = 1;
  private rng: () => number;
  private resolve: (x: number, z: number, r: number) => V2;

  constructor(opts: CombatOptions = {}) {
    this.resolve = opts.resolve ?? ((x, z) => ({ x, z }));
    this.rng = mulberry32(opts.seed ?? 99);
  }

  spawn(kind: EnemyKind, at: V2, camp = 'none'): Enemy {
    const def = ENEMY_DEFS[kind];
    const e: Enemy = {
      id: `${kind}_${this.nextId++}`, kind, def, camp, home: { ...at }, pos: { ...at }, yaw: this.rng() * Math.PI * 2,
      hp: def.hp, poise: def.poise, phase: 'idle', t: this.rng() * 2, attack: null,
      aimDir: { x: 0, z: 1 }, aimPoint: { ...at }, strikeFrom: { ...at }, hitDone: false,
      cooldown: 0.8 + this.rng(), flinch: 0, flash: 0, sinceHit: 99, circleDir: this.rng() < 0.5 ? 1 : -1, aware: 0,
    };
    this.enemies.push(e);
    return e;
  }

  get alive(): Enemy[] { return this.enemies.filter((e) => e.phase !== 'dead'); }
  get engaged(): boolean { return this.enemies.some((e) => e.phase !== 'dead' && e.phase !== 'idle' && e.phase !== 'return'); }

  /** True while the player is committed to an attack and cannot steer freely. */
  get busy(): boolean { return !!this.attack; }
  /** After the hit window the player may cancel recovery into a dodge. */
  get cancelable(): boolean { return !this.attack || this.attack.t >= this.attack.activeTo; }

  // ─── Player input ──────────────────────────────────────────────────────────

  /**
   * Feed the attack button each frame. Tap → light attack (combo); hold → charge a heavy,
   * released when the button lets go. `heavyTap` fires an uncharged heavy immediately.
   */
  input(dt: number, attackHeld: boolean, attackTap: boolean, heavyTap: boolean, stamina: number): CombatEvent[] {
    const out: CombatEvent[] = [];
    if (this.defeated) { this.holdTime = null; this.charging = false; return out; }
    if (this.holdVoid) {
      if (!attackHeld) this.holdVoid = false;
      return out;
    }
    if (heavyTap) { const a = this.beginHeavy(0.35, stamina); if (a) out.push({ type: 'swing', attack: a }); }
    if (attackTap) { const a = this.requestLight(stamina); if (a) out.push({ type: 'swing', attack: a }); }
    if (attackHeld) {
      this.holdTime = (this.holdTime ?? 0) + dt;
      if (!this.charging && this.holdTime >= HEAVY_HOLD && !this.attack) this.charging = true;
    } else if (this.holdTime !== null) {
      const held = this.holdTime;
      this.holdTime = null;
      if (this.charging) {
        this.charging = false;
        const charge = Math.min(1, (held - HEAVY_HOLD) / CHARGE_TIME);
        const a = this.beginHeavy(charge, stamina);
        if (a) out.push({ type: 'swing', attack: a });
      } else {
        const a = this.requestLight(stamina);
        if (a) out.push({ type: 'swing', attack: a });
      }
    }
    return out;
  }

  get chargeLevel(): number {
    if (!this.charging || this.holdTime === null) return 0;
    return Math.min(1, (this.holdTime - HEAVY_HOLD) / CHARGE_TIME);
  }

  /** Start (or buffer) the next light attack. Returns the attack if one started now. */
  requestLight(stamina: number): PlayerAttack | null {
    if (this.attack) {
      // buffer the next combo step once the current swing is underway
      if (this.attack.kind === 'light' && this.attack.t > 0.1) this.buffered = true;
      return null;
    }
    if (stamina <= 0) return null;
    const step = this.comboReset > 0 ? this.comboStep : 0;
    return this.startLight(step);
  }

  private startLight(step: number): PlayerAttack {
    const s = LIGHT_COMBO[step]!;
    this.attack = { kind: 'light', step, t: 0, ...s, charge: 0, hit: [] };
    this.comboStep = (step + 1) % LIGHT_COMBO.length;
    this.buffered = false;
    return this.attack;
  }

  beginHeavy(charge: number, stamina: number): PlayerAttack | null {
    if (this.attack || stamina <= 0) return null;
    const c = Math.max(0, Math.min(1, charge));
    this.attack = {
      kind: 'heavy', step: 0, t: 0, dur: HEAVY.dur, activeFrom: HEAVY.activeFrom, activeTo: HEAVY.activeTo,
      damage: HEAVY.base + HEAVY.perCharge * c, poise: HEAVY.poiseBase + HEAVY.poisePerCharge * c,
      range: HEAVY.range + c * 0.6, arc: HEAVY.arc, lunge: HEAVY.lunge, charge: c, hit: [],
    };
    this.comboStep = 0; this.comboReset = 0; this.buffered = false;
    return this.attack;
  }

  /** Abort the current swing (e.g. cancelled into a dodge). */
  cancelAttack(): void { this.attack = null; this.buffered = false; }

  /** Pick a facing for a new attack: the lock target, else a nearby enemy roughly in front. */
  aimYaw(from: V2, yaw: number, lockId: string | null): number {
    const lock = lockId ? this.enemies.find((e) => e.id === lockId && e.phase !== 'dead') : null;
    if (lock) return Math.atan2(lock.pos.x - from.x, lock.pos.z - from.z);
    let best: Enemy | null = null, bestScore = Infinity;
    for (const e of this.alive) {
      const d = dist(from, e.pos);
      if (d > 4.8) continue;
      const a = Math.abs(angleDiff(Math.atan2(e.pos.x - from.x, e.pos.z - from.z), yaw));
      if (a > 1.35) continue;
      const score = d + a * 2;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best ? Math.atan2(best.pos.x - from.x, best.pos.z - from.z) : yaw;
  }

  /** Best lock-on candidate: close and near the camera's forward direction. */
  lockCandidate(from: V2, viewYaw: number, maxDist = 20, exclude: string | null = null): Enemy | null {
    let best: Enemy | null = null, bestScore = Infinity;
    for (const e of this.alive) {
      if (e.id === exclude) continue;
      const d = dist(from, e.pos);
      if (d > maxDist) continue;
      const a = Math.abs(angleDiff(Math.atan2(e.pos.x - from.x, e.pos.z - from.z), viewYaw));
      const score = d * 0.12 + a;
      if (score < bestScore) { bestScore = score; best = e; }
    }
    return best;
  }

  /** Area powers (Ward, Howl, Rend). Facing/arc optional for cones. */
  areaEffect(center: V2, radius: number, fx: { damage: number; poise: number; knock: number; facing?: number; arc?: number }): CombatEvent[] {
    const out: CombatEvent[] = [];
    for (const e of this.alive) {
      const d = dist(center, e.pos);
      if (d > radius + e.def.radius) continue;
      if (fx.facing !== undefined && fx.arc !== undefined) {
        const a = Math.abs(angleDiff(Math.atan2(e.pos.x - center.x, e.pos.z - center.z), fx.facing));
        if (a > fx.arc && d > 1.2) continue;
      }
      const dir = d > 0.01 ? { x: (e.pos.x - center.x) / d, z: (e.pos.z - center.z) / d } : { x: 0, z: 1 };
      this.damageEnemy(e, fx.damage, fx.poise, fx.poise >= 40, out);
      if (e.phase !== 'dead' && fx.knock > 0) this.shove(e, dir, fx.knock);
    }
    return out;
  }

  heal(amount: number): void { this.hp = Math.min(this.maxHp, this.hp + amount); }

  /** Respawn: full health, every enemy back at its post. */
  reset(): void {
    this.hp = this.maxHp; this.defeated = false; this.hurt = 1.5; this.attack = null; this.token = null;
    this.holdTime = null; this.charging = false;
    for (const e of this.alive) { e.pos = { ...e.home }; e.hp = e.def.hp; e.poise = e.def.poise; this.setPhase(e, 'idle'); e.aware = 0; }
  }

  remove(pred: (e: Enemy) => boolean): void {
    this.enemies = this.enemies.filter((e) => !pred(e));
    if (this.token && !this.enemies.some((e) => e.id === this.token)) this.token = null;
  }

  // ─── Simulation step ──────────────────────────────────────────────────────

  update(dt: number, pv: PlayerView): CombatEvent[] {
    const out: CombatEvent[] = [];
    this.hurt = Math.max(0, this.hurt - dt);
    this.comboReset = Math.max(0, this.comboReset - dt);
    this.updatePlayerAttack(dt, pv, out);
    for (const e of this.enemies) this.updateEnemy(e, dt, pv, out);
    // tidy up dissolved enemies
    this.enemies = this.enemies.filter((e) => !(e.phase === 'dead' && e.t > 2.2));
    if (this.token && !this.enemies.some((e) => e.id === this.token && (e.phase === 'windup' || e.phase === 'strike'))) this.token = null;
    return out;
  }

  private updatePlayerAttack(dt: number, pv: PlayerView, out: CombatEvent[]): void {
    const a = this.attack;
    if (!a) return;
    a.t += dt;
    if (a.t >= a.activeFrom && a.t <= a.activeTo + dt) {
      for (const e of this.alive) {
        if (a.hit.includes(e.id)) continue;
        const d = dist(pv.pos, e.pos);
        if (d > a.range + e.def.radius) continue;
        const ang = Math.abs(angleDiff(Math.atan2(e.pos.x - pv.pos.x, e.pos.z - pv.pos.z), this.facing));
        if (ang > a.arc && d > e.def.radius + 0.6) continue;
        a.hit.push(e.id);
        this.damageEnemy(e, a.damage, a.poise, a.kind === 'heavy', out);
        if (e.phase !== 'dead') {
          const dir = d > 0.01 ? { x: (e.pos.x - pv.pos.x) / d, z: (e.pos.z - pv.pos.z) / d } : { x: Math.sin(this.facing), z: Math.cos(this.facing) };
          this.shove(e, dir, a.kind === 'heavy' ? 2.2 : 0.6);
        }
      }
    }
    if (a.kind === 'light' && this.buffered && a.t >= a.activeTo && a.step < LIGHT_COMBO.length - 1) {
      const next = this.startLight(a.step + 1);
      out.push({ type: 'swing', attack: next });
      return;
    }
    if (a.t >= a.dur) {
      this.attack = null;
      this.comboReset = a.kind === 'light' && a.step < LIGHT_COMBO.length - 1 ? 0.45 : 0;
      if (this.comboReset === 0) this.comboStep = 0;
      this.buffered = false;
    }
  }

  /** Player facing used for hit arcs; the game sets it from the controller each frame. */
  facing = 0;

  private damageEnemy(e: Enemy, damage: number, poise: number, heavy: boolean, out: CombatEvent[]): void {
    if (e.phase === 'dead') return;
    const staggeredAlready = e.phase === 'stagger';
    const dmg = damage * (staggeredAlready ? 1.35 : 1);
    e.hp -= dmg;
    e.poise -= poise;
    e.flash = 1;
    e.sinceHit = 0;
    e.aware = 1;
    let staggered = false;
    if (e.hp <= 0) {
      e.hp = 0;
      this.setPhase(e, 'dead');
      if (this.token === e.id) this.token = null;
      out.push({ type: 'enemyHit', enemy: e, damage: dmg, heavy, staggered: false, at: { ...e.pos } });
      out.push({ type: 'enemyDied', enemy: e });
      return;
    }
    if (e.poise <= 0 && !staggeredAlready) {
      staggered = true;
      e.poise = e.def.poise;
      if (this.token === e.id) this.token = null;
      this.setPhase(e, 'stagger');
    } else if (e.phase === 'idle' || e.phase === 'alert' || e.phase === 'return') {
      this.setPhase(e, 'chase');
    } else if (e.phase !== 'windup' && e.phase !== 'strike' && e.phase !== 'stagger') {
      e.flinch = heavy ? 0.35 : 0.18;
    }
    out.push({ type: 'enemyHit', enemy: e, damage: dmg, heavy, staggered, at: { ...e.pos } });
  }

  private shove(e: Enemy, dir: V2, metres: number): void {
    const r = this.resolve(e.pos.x + dir.x * metres, e.pos.z + dir.z * metres, e.def.radius);
    e.pos.x = r.x; e.pos.z = r.z;
  }

  private setPhase(e: Enemy, p: EnemyPhase): void { e.phase = p; e.t = 0; }

  private updateEnemy(e: Enemy, dt: number, pv: PlayerView, out: CombatEvent[]): void {
    e.t += dt;
    e.flash = Math.max(0, e.flash - dt * 5);
    e.sinceHit += dt;
    e.cooldown = Math.max(0, e.cooldown - dt);
    if (e.phase === 'dead') return;
    if (e.sinceHit > 2.2) e.poise = Math.min(e.def.poise, e.poise + dt * 14);
    if (e.flinch > 0) { e.flinch -= dt; return; }
    const P = pv.pos;
    const toP = { x: P.x - e.pos.x, z: P.z - e.pos.z };
    const dP = Math.hypot(toP.x, toP.z);
    const yawToP = Math.atan2(toP.x, toP.z);
    const homeD = dist(P, e.home);
    const def = e.def;
    const canHunt = !this.defeated;

    switch (e.phase) {
      case 'idle': {
        e.aware = Math.max(0, e.aware - dt);
        // drift around home
        const wob = e.t * 0.35;
        const goal = { x: e.home.x + Math.sin(wob) * 2.2, z: e.home.z + Math.cos(wob * 0.8) * 2.2 };
        this.moveToward(e, goal, def.speed * 0.25, dt);
        if (canHunt && dP < def.aggro && homeD < def.leash) { this.setPhase(e, 'alert'); out.push({ type: 'alert', enemy: e }); }
        break;
      }
      case 'alert':
        e.aware = 1;
        this.turnToward(e, yawToP, dt, 6);
        if (e.t > 0.55) this.setPhase(e, 'chase');
        break;
      case 'return': {
        e.aware = Math.max(0, e.aware - dt * 0.5);
        this.moveToward(e, e.home, def.speed * 0.8, dt);
        e.hp = Math.min(def.hp, e.hp + dt * 20);
        if (dist(e.pos, e.home) < 1.2) this.setPhase(e, 'idle');
        else if (canHunt && dP < def.aggro * 0.6 && homeD < def.leash) this.setPhase(e, 'chase');
        break;
      }
      case 'chase': {
        if (!canHunt || homeD > def.leash || dP > def.aggro * 2.2) { this.setPhase(e, 'return'); break; }
        e.aware = 1;
        const myTurn = this.token === null || this.token === e.id;
        if (myTurn && e.cooldown <= 0) {
          const options = def.attacks.filter((a) => dP >= a.minDist && dP <= a.maxDist);
          if (options.length) {
            const atk = options[Math.floor(this.rng() * options.length)]!;
            this.token = e.id;
            e.attack = atk;
            e.hitDone = false;
            this.setPhase(e, 'windup');
            this.aim(e, P);
            out.push({ type: 'telegraph', enemy: e, attack: atk });
            break;
          }
        }
        // close in, or hover and circle while another enemy has the token
        const want = myTurn && e.cooldown <= 0.3 ? Math.min(...def.attacks.map((a) => a.maxDist)) * 0.7 : def.hover;
        const side = { x: -toP.z / (dP || 1) * e.circleDir, z: toP.x / (dP || 1) * e.circleDir };
        const radial = dP - want;
        const vx = (toP.x / (dP || 1)) * Math.max(-1, Math.min(1, radial)) + side.x * (dP < want + 1.5 ? 0.55 : 0.15);
        const vz = (toP.z / (dP || 1)) * Math.max(-1, Math.min(1, radial)) + side.z * (dP < want + 1.5 ? 0.55 : 0.15);
        const vl = Math.hypot(vx, vz);
        const sp = def.speed * (myTurn ? 1 : 0.6);
        if (vl > 0.05) this.step(e, { x: (vx / vl) * sp * Math.min(1, vl), z: (vz / vl) * sp * Math.min(1, vl) }, dt);
        this.turnToward(e, yawToP, dt, 8);
        if (this.rng() < dt * 0.25) e.circleDir = e.circleDir === 1 ? -1 : 1;
        break;
      }
      case 'windup': {
        const atk = e.attack!;
        // track the player for most of the wind-up, then commit — the last moment is the dodge cue
        if (e.t < atk.windup * 0.7) { this.aim(e, P); this.turnToward(e, yawToP, dt, 10); }
        if (e.t >= atk.windup) {
          this.setPhase(e, 'strike');
          e.strikeFrom = { ...e.pos };
          out.push({ type: 'strike', enemy: e, attack: atk });
        }
        break;
      }
      case 'strike': {
        const atk = e.attack!;
        const k = Math.min(1, e.t / atk.active);
        if (atk.shape === 'circle') {
          // leap along a parabola to the locked landing point; damage on landing
          e.pos.x = e.strikeFrom.x + (e.aimPoint.x - e.strikeFrom.x) * k;
          e.pos.z = e.strikeFrom.z + (e.aimPoint.z - e.strikeFrom.z) * k;
          if (k >= 1 && !e.hitDone) {
            e.hitDone = true;
            if (dist(P, e.aimPoint) <= atk.range) this.tryHitPlayer(e, atk, pv, out);
          }
        } else {
          if (atk.dash > 0) this.step(e, { x: e.aimDir.x * atk.dash / atk.active, z: e.aimDir.z * atk.dash / atk.active }, dt);
          if (!e.hitDone && this.inStrikeZone(e, atk, P)) { e.hitDone = true; this.tryHitPlayer(e, atk, pv, out); }
        }
        if (e.t >= atk.active) {
          this.setPhase(e, 'recover');
          if (this.token === e.id) this.token = null;
          e.cooldown = atk.cooldown * (0.8 + this.rng() * 0.4);
        }
        break;
      }
      case 'recover':
        if (e.t >= (e.attack?.recover ?? 0.6)) { e.attack = null; this.setPhase(e, 'chase'); }
        break;
      case 'stagger':
        e.attack = null;
        if (e.t >= 1.15) this.setPhase(e, 'chase');
        break;
    }
  }

  private aim(e: Enemy, P: V2): void {
    const dx = P.x - e.pos.x, dz = P.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
    e.aimDir = { x: dx / d, z: dz / d };
    const atk = e.attack;
    if (atk?.shape === 'circle') {
      const reach = Math.min(d, atk.maxDist);
      e.aimPoint = { x: e.pos.x + e.aimDir.x * reach, z: e.pos.z + e.aimDir.z * reach };
    }
  }

  /** Is the player inside the attack's committed hit zone right now? */
  inStrikeZone(e: Enemy, atk: EnemyAttackDef, P: V2): boolean {
    const dx = P.x - e.pos.x, dz = P.z - e.pos.z;
    if (atk.shape === 'line') {
      const along = dx * e.aimDir.x + dz * e.aimDir.z;
      const across = Math.abs(-dx * e.aimDir.z + dz * e.aimDir.x);
      return along > -0.5 && along < atk.range + 0.6 && across < atk.arc + 0.45;
    }
    const d = Math.hypot(dx, dz);
    if (d > atk.range + 0.45) return false;
    const a = Math.abs(angleDiff(Math.atan2(dx, dz), Math.atan2(e.aimDir.x, e.aimDir.z)));
    return a <= atk.arc || d < 0.9;
  }

  private tryHitPlayer(e: Enemy, atk: EnemyAttackDef, pv: PlayerView, out: CombatEvent[]): void {
    if (pv.invulnerable || this.hurt > 0 || this.defeated) { if (pv.invulnerable) out.push({ type: 'dodged', enemy: e }); return; }
    this.hp = Math.max(0, this.hp - atk.damage);
    this.hurt = HURT_IFRAMES;
    this.attack = null;               // getting hit interrupts your swing
    if (this.holdTime !== null) this.holdVoid = true;
    this.charging = false; this.holdTime = null;
    const dx = pv.pos.x - e.pos.x, dz = pv.pos.z - e.pos.z, d = Math.hypot(dx, dz) || 1;
    out.push({ type: 'playerHit', enemy: e, damage: atk.damage, knock: { x: dx / d, z: dz / d } });
    if (this.hp <= 0) {
      this.defeated = true;
      this.token = null;
      out.push({ type: 'playerDefeated' });
    }
  }

  private moveToward(e: Enemy, goal: V2, speed: number, dt: number): void {
    const dx = goal.x - e.pos.x, dz = goal.z - e.pos.z, d = Math.hypot(dx, dz);
    if (d < 0.05) return;
    const s = Math.min(speed, d / Math.max(dt, 1e-4));
    this.step(e, { x: (dx / d) * s, z: (dz / d) * s }, dt);
    this.turnToward(e, Math.atan2(dx, dz), dt, 5);
  }

  private step(e: Enemy, v: V2, dt: number): void {
    let nx = e.pos.x + v.x * dt, nz = e.pos.z + v.z * dt;
    // keep enemies from stacking on top of each other
    for (const o of this.enemies) {
      if (o === e || o.phase === 'dead') continue;
      const ox = nx - o.pos.x, oz = nz - o.pos.z, od = Math.hypot(ox, oz), min = e.def.radius + o.def.radius;
      if (od < min && od > 0.001) { nx = o.pos.x + (ox / od) * min; nz = o.pos.z + (oz / od) * min; }
    }
    const r = this.resolve(nx, nz, e.def.radius);
    e.pos.x = r.x; e.pos.z = r.z;
  }

  private turnToward(e: Enemy, yaw: number, dt: number, rate: number): void {
    e.yaw += angleDiff(yaw, e.yaw) * Math.min(1, dt * rate);
  }
}

// ─── helpers ─────────────────────────────────────────────────────────────────

export function dist(a: V2, b: V2): number { return Math.hypot(a.x - b.x, a.z - b.z); }
export function angleDiff(a: number, b: number): number { const d = a - b; return Math.atan2(Math.sin(d), Math.cos(d)); }

function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ─── Encounters in Amahara ───────────────────────────────────────────────────
// Camps only wake once the flood night is over. A cleared camp stays quiet for a while
// (tracked in save flags), then something new crawls out of the dark.

export interface Camp { id: string; label: string; at: V2; spawns: { kind: EnemyKind; dx: number; dz: number }[] }

export const CAMPS: Camp[] = [
  { id: 'forest_edge', label: 'the forest edge across the river', at: { x: -20, z: 12 }, spawns: [{ kind: 'wraith', dx: 0, dz: 0 }] },
  { id: 'cedar_hollow', label: 'the cedar hollow on the shrine path', at: { x: -38, z: -22 }, spawns: [{ kind: 'wraith', dx: -2, dz: 1 }, { kind: 'wraith', dx: 2.5, dz: -1.5 }] },
  { id: 'shrine_steps', label: 'the steps below the old shrine', at: { x: -51, z: -48 }, spawns: [{ kind: 'hound', dx: -1.5, dz: 0 }, { kind: 'hound', dx: 2, dz: 2 }] },
];

/** World minutes before a cleared camp repopulates. */
export const CAMP_RESPAWN_MIN = 90;
