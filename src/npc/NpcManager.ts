// NPC presence in the world: where people stand, how they move, and how their
// beliefs and fears show in their bodies (fleeing, praying, aiming, calling out).

import * as THREE from 'three';
import { NpcFigure, STYLES } from './NpcFigure.js';
import { NPCS } from '../sim/content.js';
import type { GameState } from '../sim/types.js';
import { PLACES, heightAt, riverX } from '../world/layout.js';
import type { CollisionWorld } from '../world/Colliders.js';

export interface NpcActor {
  id: string;
  fig: NpcFigure;
  pos: THREE.Vector3;
  yaw: number;
  goal: THREE.Vector2 | null;
  override: THREE.Vector3 | null;   // story-controlled position (e.g. Mio being carried)
  bark: string | null;
}

export class NpcManager {
  actors = new Map<string, NpcActor>();
  group = new THREE.Group();
  mioRockTop = 0;

  constructor(scene: THREE.Scene, private collision: CollisionWorld, private deck: (x: number, z: number) => number | null, lanternLights: boolean) {
    for (const n of NPCS) {
      const fig = new NpcFigure(STYLES[n.id]!, lanternLights && n.id === 'hana');
      const a: NpcActor = { id: n.id, fig, pos: new THREE.Vector3(n.spawn.x, 0, n.spawn.z), yaw: 0, goal: null, override: null, bark: null };
      this.actors.set(n.id, a);
      this.group.add(fig.root);
    }
    scene.add(this.group);
  }

  groundAt(x: number, z: number): number {
    const d = this.deck(x, z);
    return Math.max(heightAt(x, z), d ?? -Infinity);
  }

  /** Where each person wants to be, given the state of the world. */
  private anchorFor(state: GameState, id: string, cons: Set<string>): { x: number; z: number; gesture: NpcFigure['gesture'] } {
    const f = state.flags;
    const resolved = f['flood_phase'] === 'resolved';
    if (!resolved) {
      switch (id) {
        case 'hana': return { x: riverX(26) - 0.5, z: 26, gesture: 'call' };
        case 'daichi': return { x: riverX(10) - 8.6, z: 8.5, gesture: 'call' };
        case 'aiko': return { x: riverX(12) + 8.0, z: 13.5, gesture: 'call' };
        case 'takeshi': return { x: PLACES.torii.x + 3, z: 23.5, gesture: 'wave' };
        case 'genzo': return { x: 50, z: 21, gesture: 'none' };
        case 'rei': return { x: 63, z: 43, gesture: 'none' };
        case 'mio': return { x: PLACES.mioRock.x, z: PLACES.mioRock.z, gesture: 'cower' };
      }
    }
    const rs = PLACES.riverShrine;
    const shrine = cons.has('river_shrine');
    switch (id) {
      case 'mio': return shrine ? { x: rs.x + 1.6, z: rs.z - 0.6, gesture: 'pray' } : { x: 41, z: 17.5, gesture: 'none' };
      case 'hana': return shrine ? { x: rs.x + 1.8, z: rs.z + 0.9, gesture: 'pray' } : { x: PLACES.torii.x + 1.5, z: 27.5, gesture: 'none' };
      case 'aiko': return { x: PLACES.mill.x + 3.6, z: PLACES.mill.z + 3.5, gesture: f['mill_damaged'] ? 'cower' : 'none' };
      case 'daichi': return cons.has('daichi_hostile') ? { x: riverX(26) - 10, z: 23.5, gesture: 'aim' } : { x: riverX(6) - 9, z: 4, gesture: 'none' };
      case 'takeshi': return f['bridge_broken'] ? { x: riverX(26) + 9, z: 24.5, gesture: 'none' } : { x: 49, z: 24, gesture: 'none' };
      case 'genzo': return cons.has('warden_bells') ? { x: PLACES.gate.x - 1.5, z: PLACES.gate.z - 2, gesture: 'pray' } : { x: 52, z: 20, gesture: 'none' };
      case 'rei': return f['rei_departed'] ? { x: PLACES.pass.x, z: PLACES.pass.z, gesture: 'none' } : { x: 63, z: 43, gesture: 'none' };
    }
    return { x: 50, z: 26, gesture: 'none' };
  }

  /** Snap everyone to their anchors (after loading a save). */
  placeAll(state: GameState, cons: Set<string>): void {
    for (const a of this.actors.values()) {
      const an = this.anchorFor(state, a.id, cons);
      a.pos.set(an.x, this.groundAt(an.x, an.z), an.z);
      a.goal = null;
    }
  }

  update(dt: number, state: GameState, cons: Set<string>, player: THREE.Vector3, playerVisible: boolean, waterRise: number): void {
    for (const a of this.actors.values()) {
      const npc = state.npcs[a.id]!;
      a.fig.root.visible = npc.present;
      if (!npc.present) continue;
      const an = this.anchorFor(state, a.id, cons);
      let gesture = an.gesture;
      let speed = 1.7;
      const toPlayer = new THREE.Vector2(player.x - a.pos.x, player.z - a.pos.z);
      const dPlayer = toPlayer.length();
      let target = new THREE.Vector2(an.x, an.z);
      // fear: keep away from the spirit
      if (playerVisible && npc.fear > 0.45 && dPlayer < 9 && a.override === null && a.id !== 'mio') {
        const away = toPlayer.clone().normalize().multiplyScalar(-11);
        target = new THREE.Vector2(a.pos.x + away.x, a.pos.z + away.y);
        speed = 3.6;
        gesture = dPlayer < 4 ? 'cower' : 'none';
      }
      if (a.override) {
        a.pos.lerp(a.override, Math.min(1, dt * 3));
        a.fig.walk = 0;
      } else if (a.id === 'mio' && state.flags['flood_phase'] !== 'resolved') {
        a.pos.set(an.x, this.mioRockTop, an.z);
        a.fig.walk = 0;
      } else {
        const d = new THREE.Vector2(target.x - a.pos.x, target.y - a.pos.z);
        const dist = d.length();
        if (dist > 0.4) {
          d.normalize().multiplyScalar(Math.min(dist, speed * dt));
          let nx = a.pos.x + d.x, nz = a.pos.z + d.y;
          const r = this.collision.resolve(nx, nz, 0.3, a.pos.y);
          nx = r.x; nz = r.z;
          a.pos.x = nx; a.pos.z = nz;
          a.yaw = turnToward(a.yaw, Math.atan2(d.x, d.y), dt * 8);
          a.fig.walk = Math.min(1, a.fig.walk + dt * 4);
          if (gesture !== 'cower') gesture = 'none';
        } else {
          a.fig.walk = Math.max(0, a.fig.walk - dt * 4);
          // face the spirit when it can be perceived and is near; otherwise face the river/anchor focus
          if (playerVisible && dPlayer < 12 && state.form.stage > 0) a.yaw = turnToward(a.yaw, Math.atan2(toPlayer.x, toPlayer.y), dt * 4);
          else if (state.flags['flood_phase'] !== 'resolved' && a.id !== 'mio') a.yaw = turnToward(a.yaw, Math.atan2(PLACES.mioRock.x - a.pos.x, PLACES.mioRock.z - a.pos.z), dt * 3);
          else if (gesture === 'pray') a.yaw = turnToward(a.yaw, Math.atan2(PLACES.riverShrine.x - a.pos.x, PLACES.riverShrine.z - a.pos.z), dt * 3);
        }
        a.pos.y = this.groundAt(a.pos.x, a.pos.z);
      }
      if (a.id === 'mio' && state.flags['flood_phase'] !== 'resolved') {
        // sway with the current as the flood climbs
        a.fig.root.rotation.z = Math.sin(state.playTime * 2.4) * 0.05 * waterRise;
      }
      a.fig.gesture = gesture;
      a.fig.root.position.copy(a.pos);
      a.fig.root.rotation.y = a.yaw;
      a.fig.update(dt);
    }
  }

  nearest(p: THREE.Vector3, maxDist: number, state: GameState): NpcActor | null {
    let best: NpcActor | null = null; let bd = maxDist;
    for (const a of this.actors.values()) {
      if (!state.npcs[a.id]!.present) continue;
      const d = Math.hypot(a.pos.x - p.x, a.pos.z - p.z);
      if (d < bd) { bd = d; best = a; }
    }
    return best;
  }
}

function turnToward(cur: number, target: number, k: number): number {
  let d = target - cur;
  d = Math.atan2(Math.sin(d), Math.cos(d));
  return cur + d * Math.min(1, k);
}
