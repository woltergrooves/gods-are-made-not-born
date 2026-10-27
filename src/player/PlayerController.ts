// Third-person spirit movement: acceleration, run/sprint, jump, dodge with i-frames,
// stamina, terrain/bridge/water surfaces and collision.

import * as THREE from 'three';
import type { InputState } from '../input/Input.js';
import { heightAt, normalAt, WORLD } from '../world/layout.js';
import type { CollisionWorld } from '../world/Colliders.js';

export interface Surfaces {
  ground(x: number, z: number): number;
  water(x: number, z: number): number | null;   // water surface y if over deep water
}

export class PlayerController {
  pos = new THREE.Vector3();
  vel = new THREE.Vector3();
  yaw = 0;
  grounded = true;
  stamina = 100;
  maxStamina = 100;
  dodgeTime = 0;
  dodgeCooldown = 0;
  invulnerable = 0;
  overWater = false;
  private coyote = 0;
  private jumpBuffer = 0;
  private dodgeDir = new THREE.Vector3();
  private exhausted = false;
  readonly radius = 0.45;
  onDodge: (() => void) | null = null;
  onJump: (() => void) | null = null;
  onLand: ((impact: number) => void) | null = null;

  constructor(private collision: CollisionWorld, private surfaces: Surfaces) {}

  teleport(x: number, z: number, yaw: number): void {
    this.pos.set(x, this.surfaces.ground(x, z) + 0.05, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
  }

  get speed(): number { return Math.hypot(this.vel.x, this.vel.z); }

  update(dt: number, input: InputState, camYaw: number): void {
    dt = Math.min(dt, 1 / 20);
    const fwd = new THREE.Vector3(-Math.sin(camYaw), 0, -Math.cos(camYaw));
    const right = new THREE.Vector3(-fwd.z, 0, fwd.x);
    const wish = fwd.multiplyScalar(input.moveY).add(right.multiplyScalar(input.moveX));
    const mag = Math.min(1, wish.length());
    if (mag > 0.01) wish.normalize();

    // stamina
    const sprinting = input.sprint && mag > 0.3 && !this.exhausted && this.grounded;
    if (sprinting) this.stamina -= 20 * dt;
    else this.stamina += (this.grounded ? 26 : 10) * dt;
    this.stamina = Math.max(0, Math.min(this.maxStamina, this.stamina));
    if (this.stamina <= 0) this.exhausted = true;
    if (this.exhausted && this.stamina > 35) this.exhausted = false;

    let top = mag < 0.6 ? 4.0 * (mag / 0.6) : 6.4;
    if (sprinting) top = 10.2;
    if (this.overWater) top *= 0.6;

    // dodge
    this.dodgeCooldown -= dt; this.invulnerable -= dt;
    if (input.dodge && this.dodgeCooldown <= 0 && this.stamina >= 18) {
      this.stamina -= 22;
      this.dodgeTime = 0.3; this.dodgeCooldown = 0.5; this.invulnerable = 0.24;
      this.dodgeDir.copy(mag > 0.1 ? wish : new THREE.Vector3(Math.sin(this.yaw), 0, Math.cos(this.yaw)).multiplyScalar(-1));
      this.onDodge?.();
    }

    const hv = new THREE.Vector3(this.vel.x, 0, this.vel.z);
    if (this.dodgeTime > 0) {
      this.dodgeTime -= dt;
      const k = Math.max(0, this.dodgeTime / 0.3);
      hv.copy(this.dodgeDir).multiplyScalar(7 + 13 * k);
    } else {
      const target = wish.clone().multiplyScalar(top * (mag > 0.01 ? 1 : 0));
      const accel = this.grounded ? (mag > 0.01 ? 16 : 12) : 5;
      hv.lerp(target, 1 - Math.exp(-accel * dt));
    }

    // turn toward movement
    if (hv.lengthSq() > 0.2) {
      const targetYaw = Math.atan2(hv.x, hv.z);
      let d = targetYaw - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * (this.dodgeTime > 0 ? 20 : 11));
    }

    // jump (buffered, with coyote time)
    this.jumpBuffer -= dt; this.coyote -= dt;
    if (input.jump) this.jumpBuffer = 0.15;
    if (this.jumpBuffer > 0 && (this.grounded || this.coyote > 0)) {
      this.vel.y = 8.6; this.grounded = false; this.coyote = 0; this.jumpBuffer = 0;
      this.onJump?.();
    }
    this.vel.y -= (this.vel.y > 0 ? 22 : 30) * dt;

    // slope limits: spirits don't scale cliffs
    let nx = this.pos.x + hv.x * dt, nz = this.pos.z + hv.z * dt;
    const n = normalAt(nx, nz);
    const groundHere = this.surfaces.ground(this.pos.x, this.pos.z);
    const groundNext = this.surfaces.ground(nx, nz);
    if (n[1] < 0.6 && groundNext > groundHere + 0.05) {
      // remove the uphill component
      const up = new THREE.Vector3(-n[0], 0, -n[2]).normalize();
      const along = hv.dot(up);
      if (along > 0) hv.addScaledVector(up, -along * 1.05);
      nx = this.pos.x + hv.x * dt; nz = this.pos.z + hv.z * dt;
    }
    const res = this.collision.resolve(nx, nz, this.radius, this.pos.y);
    nx = Math.max(WORLD.minX + 6, Math.min(WORLD.maxX - 6, res.x));
    nz = Math.max(WORLD.minZ + 6, Math.min(WORLD.maxZ - 6, res.z));
    if (res.hit) { hv.multiplyScalar(0.85); }
    this.vel.x = (nx - this.pos.x) / dt; this.vel.z = (nz - this.pos.z) / dt;
    if (this.dodgeTime <= 0) { this.vel.x = hv.x; this.vel.z = hv.z; if (res.hit) { this.vel.x = (nx - this.pos.x) / dt; this.vel.z = (nz - this.pos.z) / dt; } }
    this.pos.x = nx; this.pos.z = nz;

    // vertical: ground, bridge deck or (for a spirit) the water surface
    let floor = this.surfaces.ground(nx, nz);
    const water = this.surfaces.water(nx, nz);
    this.overWater = water !== null && water > floor;
    if (water !== null) floor = Math.max(floor, water + 0.15);
    this.pos.y += this.vel.y * dt;
    if (this.pos.y <= floor) {
      if (!this.grounded && this.vel.y < -6) this.onLand?.(Math.min(1, -this.vel.y / 18));
      this.pos.y = floor; this.vel.y = 0;
      this.grounded = true; this.coyote = 0.12;
    } else if (this.pos.y > floor + 0.08) {
      if (this.grounded && this.vel.y <= 0 && this.pos.y - floor < 0.6) { this.pos.y = floor; } // stick to slopes/steps
      else this.grounded = false;
    }
  }
}

export class CameraRig {
  yaw = 0;
  elevation = 0.32;
  distance = 6.8;
  private curDist = 6.8;
  private target = new THREE.Vector3();
  private idle = 0;
  cinematic: { from: THREE.Vector3; to: THREE.Vector3; lookFrom: THREE.Vector3; lookTo: THREE.Vector3; t: number; dur: number } | null = null;
  shake = 0;

  constructor(public camera: THREE.PerspectiveCamera, private collision: CollisionWorld) {}

  update(dt: number, input: InputState, player: PlayerController, playerMoving: boolean): void {
    const cam = this.camera;
    if (this.cinematic) {
      const c = this.cinematic;
      c.t += dt;
      const k = Math.min(1, c.t / c.dur);
      const e = k * k * (3 - 2 * k);
      cam.position.lerpVectors(c.from, c.to, e);
      cam.lookAt(new THREE.Vector3().lerpVectors(c.lookFrom, c.lookTo, e));
      if (k >= 1) this.cinematic = null;
      return;
    }
    const looked = Math.abs(input.lookX) + Math.abs(input.lookY) > 0.0005;
    this.yaw -= input.lookX;
    this.elevation = Math.max(-0.3, Math.min(1.15, this.elevation + input.lookY));
    this.idle = looked ? 0 : this.idle + dt;
    // gentle auto-follow behind the spirit while moving and not steering the camera
    if (playerMoving && this.idle > 1.6) {
      const behind = player.yaw + Math.PI;
      let d = behind - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * Math.min(1, dt * 0.8) * Math.min(1, (this.idle - 1.6) * 0.5);
    }
    const goal = new THREE.Vector3(player.pos.x, player.pos.y + 1.55, player.pos.z);
    this.target.lerp(goal, 1 - Math.exp(-14 * dt));
    const ce = Math.cos(this.elevation), se = Math.sin(this.elevation);
    const dir = new THREE.Vector3(Math.sin(this.yaw) * ce, se, Math.cos(this.yaw) * ce);
    // collision: terrain samples + colliders
    let allowed = this.distance;
    const steps = 14;
    for (let i = 1; i <= steps; i++) {
      const d = (i / steps) * this.distance;
      const p = this.target.clone().addScaledVector(dir, d);
      if (heightAt(p.x, p.z) + 0.45 > p.y) { allowed = Math.max(1.2, d - this.distance / steps); break; }
    }
    const far = this.target.clone().addScaledVector(dir, allowed);
    const t = this.collision.rayBlocks(this.target.x, this.target.y, this.target.z, far.x, far.y, far.z);
    allowed = Math.max(1.2, allowed * t);
    this.curDist += (allowed - this.curDist) * (allowed < this.curDist ? 1 - Math.exp(-25 * dt) : 1 - Math.exp(-3 * dt));
    cam.position.copy(this.target).addScaledVector(dir, this.curDist);
    const minY = heightAt(cam.position.x, cam.position.z) + 0.35;
    if (cam.position.y < minY) cam.position.y = minY;
    if (this.shake > 0) {
      this.shake = Math.max(0, this.shake - dt * 2.5);
      cam.position.x += (Math.random() - 0.5) * this.shake * 0.25;
      cam.position.y += (Math.random() - 0.5) * this.shake * 0.25;
    }
    cam.lookAt(this.target);
  }

  snapBehind(player: PlayerController): void {
    this.yaw = player.yaw + Math.PI;
    this.target.set(player.pos.x, player.pos.y + 1.55, player.pos.z);
    this.curDist = this.distance;
  }
}
