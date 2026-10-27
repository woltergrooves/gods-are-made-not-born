// Procedural enemy figures. Same rule as the villagers: original, hand-built geometry with a
// tiny rig, readable silhouettes first. Each figure exposes `pose()` so the combat view can
// show wind-ups (the telegraph) clearly: raised claws, flaring eyes, a crouch before a pounce.

import * as THREE from 'three';
import type { Enemy } from '../sim/combat.js';

export interface EnemyFigure {
  root: THREE.Group;
  /** Height of the "head" above the root, for health bars and lock-on. */
  readonly top: number;
  update(e: Enemy, dt: number, time: number, speed: number): void;
  dispose(): void;
}

const VERMILION = new THREE.Color('#ff3a2a');

/** A hollow robe with a pale mask where a face should be. Floats; long reaching arms. */
export class WraithFigure implements EnemyFigure {
  root = new THREE.Group();
  readonly top = 2.25;
  private body = new THREE.Group();
  private armL = new THREE.Group();
  private armR = new THREE.Group();
  private eyes: THREE.Mesh[] = [];
  private robeMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshBasicMaterial;
  private maskMat: THREE.MeshStandardMaterial;
  private aura: THREE.Points;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private bob = Math.random() * 10;

  constructor() {
    this.robeMat = new THREE.MeshStandardMaterial({ color: '#18131c', roughness: 0.95, emissive: new THREE.Color('#2a1640'), emissiveIntensity: 0.45, side: THREE.DoubleSide, transparent: true, opacity: 0.94 });
    this.maskMat = new THREE.MeshStandardMaterial({ color: '#ddd5c4', roughness: 0.45, emissive: new THREE.Color('#000000') });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: '#ff4636' });
    const clawMat = new THREE.MeshStandardMaterial({ color: '#0d0a0e', roughness: 0.4, metalness: 0.2, emissive: new THREE.Color('#3a1030'), emissiveIntensity: 0.5 });
    this.mats.push(this.robeMat, this.maskMat, this.eyeMat, clawMat);

    // tattered robe: a lathe whose hem is torn into uneven strips
    const prof: THREE.Vector2[] = [];
    for (let i = 0; i <= 14; i++) { const t = i / 14; prof.push(new THREE.Vector2(0.05 + Math.sin(Math.min(1, t * 1.15) * Math.PI * 0.5) * 0.62 * (0.45 + t * 0.55), 1.95 - t * 1.75)); }
    const robeGeo = new THREE.LatheGeometry(prof, 28);
    const pos = robeGeo.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i);
      if (y < 0.75) {
        const a = Math.atan2(pos.getZ(i), pos.getX(i));
        const tear = (Math.sin(a * 7) * 0.5 + 0.5) * (Math.sin(a * 13 + 1.7) * 0.5 + 0.5);
        pos.setY(i, y + tear * (0.75 - y) * 0.9);
      }
    }
    robeGeo.computeVertexNormals();
    const robe = new THREE.Mesh(robeGeo, this.robeMat);
    robe.castShadow = true;
    this.body.add(robe);
    // hood
    const hoodGeo = new THREE.SphereGeometry(0.34, 16, 12, 0, Math.PI * 2, 0, Math.PI * 0.62);
    const hood = new THREE.Mesh(hoodGeo, this.robeMat);
    hood.position.set(0, 1.92, -0.04);
    hood.scale.set(1, 1.15, 1.05);
    this.body.add(hood);
    // mask: a shallow shell, two slit eyes, no mouth
    const maskGeo = new THREE.SphereGeometry(0.23, 16, 12, -Math.PI * 0.42, Math.PI * 0.84, Math.PI * 0.15, Math.PI * 0.62);
    const mask = new THREE.Mesh(maskGeo, this.maskMat);
    mask.position.set(0, 1.86, 0.1);
    mask.scale.set(1, 1.25, 0.8);
    this.body.add(mask);
    const eyeGeo = new THREE.BoxGeometry(0.085, 0.018, 0.02);
    this.geos.push(robeGeo, hoodGeo, maskGeo, eyeGeo);
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(eyeGeo, this.eyeMat);
      e.position.set(s * 0.075, 1.9, 0.29);
      e.rotation.z = s * -0.25;
      this.eyes.push(e);
      this.body.add(e);
    }
    // long arms ending in claws, pivoting at the shoulders
    const armGeo = new THREE.CylinderGeometry(0.045, 0.075, 1.05, 6);
    armGeo.translate(0, -0.52, 0);
    const clawGeo = new THREE.ConeGeometry(0.035, 0.32, 5);
    clawGeo.translate(0, -0.16, 0);
    this.geos.push(armGeo, clawGeo);
    for (const [g, s] of [[this.armL, -1], [this.armR, 1]] as const) {
      g.position.set(s * 0.38, 1.62, 0.02);
      const arm = new THREE.Mesh(armGeo, this.robeMat);
      g.add(arm);
      for (let c = -1; c <= 1; c++) {
        const claw = new THREE.Mesh(clawGeo, clawMat);
        claw.position.set(c * 0.05, -1.02, 0.02);
        claw.rotation.set(0.25, 0, c * 0.25);
        g.add(claw);
      }
      this.body.add(g);
    }
    // faint drifting motes
    const n = 26, ap = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) ap.set([(Math.random() - 0.5) * 1.4, Math.random() * 2.2, (Math.random() - 0.5) * 1.4], i * 3);
    const ag = new THREE.BufferGeometry(); ag.setAttribute('position', new THREE.BufferAttribute(ap, 3));
    const am = new THREE.PointsMaterial({ color: '#8a5cff', size: 0.09, transparent: true, opacity: 0.55, blending: THREE.AdditiveBlending, depthWrite: false });
    this.aura = new THREE.Points(ag, am);
    this.geos.push(ag); this.mats.push(am);
    this.body.add(this.aura);
    this.root.add(this.body);
  }

  update(e: Enemy, dt: number, time: number, speed: number): void {
    this.bob += dt;
    const hover = 0.35 + Math.sin(this.bob * 1.7) * 0.08;
    this.body.position.y = hover;
    this.root.rotation.y = e.yaw;
    const atk = e.attack;
    let raise = 0, swing = 0, lean = Math.min(0.25, speed * 0.05), eye = 1;
    if (e.phase === 'windup' && atk) {
      const k = Math.min(1, e.t / atk.windup);
      raise = k; eye = 1 + k * 2.5 + (k > 0.7 ? Math.sin(time * 40) * 0.6 : 0);
      lean = -0.18 * k;
    } else if (e.phase === 'strike') {
      raise = 1; swing = Math.min(1, e.t / Math.max(0.05, atk?.active ?? 0.2)); lean = 0.45; eye = 3;
    } else if (e.phase === 'recover') {
      swing = 1 - Math.min(1, e.t / 0.5); lean = 0.3 * swing;
    } else if (e.phase === 'stagger') {
      lean = -0.35 + Math.sin(e.t * 18) * 0.08; eye = 0.3;
    }
    const sway = Math.sin(time * 1.6 + this.bob) * 0.12;
    const lunge = atk?.id === 'lunge';
    // wind-up raises the claws high behind the mask; the strike rakes them down and forward
    this.armL.rotation.set(-raise * 2.3 + swing * (lunge ? 2.0 : 2.9) + sway, 0, -0.25 - raise * 0.35);
    this.armR.rotation.set(-raise * 2.3 + swing * (lunge ? 2.0 : 2.9) - sway, 0, 0.25 + raise * 0.35);
    this.body.rotation.x = lean;
    this.eyes.forEach((m) => m.scale.set(1 + (eye - 1) * 0.35, Math.max(0.3, eye), 1));
    this.eyeMat.color.copy(VERMILION).multiplyScalar(0.7 + eye * 0.35);
    // hit flash & death dissolve
    this.robeMat.emissive.setRGB(0.16 + e.flash * 1.2, 0.09 + e.flash * 1.1, 0.25 + e.flash * 1.1);
    this.maskMat.emissive.setScalar(e.flash * 0.8);
    if (e.phase === 'dead') {
      const k = Math.min(1, e.t / 1.6);
      this.robeMat.opacity = 0.94 * (1 - k);
      this.body.scale.set(1 + k * 0.4, 1 - k * 0.85, 1 + k * 0.4);
      this.body.position.y = hover - k * 0.3;
      this.armL.rotation.z = -0.25 - k * 1.2; this.armR.rotation.z = 0.25 + k * 1.2;
    }
    const ap = this.aura.geometry.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < ap.count; i++) { let y = ap.getY(i) + dt * 0.35; if (y > 2.4) y = 0; ap.setY(i, y); }
    ap.needsUpdate = true;
  }

  dispose(): void { this.geos.forEach((g) => g.dispose()); this.mats.forEach((m) => m.dispose()); }
}

/** A lean ash-grey hound with a cracked bronze bell at its throat that never rings. */
export class HoundFigure implements EnemyFigure {
  root = new THREE.Group();
  readonly top = 1.45;
  private body = new THREE.Group();
  private head = new THREE.Group();
  private jaw: THREE.Mesh;
  private legs: THREE.Group[] = [];
  private tail = new THREE.Group();
  private bell: THREE.Mesh;
  private furMat: THREE.MeshStandardMaterial;
  private bellMat: THREE.MeshStandardMaterial;
  private eyeMat: THREE.MeshBasicMaterial;
  private geos: THREE.BufferGeometry[] = [];
  private mats: THREE.Material[] = [];
  private gait = Math.random() * 10;

  constructor() {
    this.furMat = new THREE.MeshStandardMaterial({ color: '#4a423d', roughness: 1, emissive: new THREE.Color('#000000'), transparent: true, opacity: 1 });
    const darkMat = new THREE.MeshStandardMaterial({ color: '#1a1614', roughness: 0.9 });
    this.bellMat = new THREE.MeshStandardMaterial({ color: '#8a6630', roughness: 0.35, metalness: 0.85, emissive: new THREE.Color('#000000') });
    this.eyeMat = new THREE.MeshBasicMaterial({ color: '#ff7a2a' });
    this.mats.push(this.furMat, darkMat, this.bellMat, this.eyeMat);

    // torso: deep chest, tucked waist
    const chestGeo = new THREE.SphereGeometry(0.36, 14, 10); chestGeo.scale(0.85, 1, 1.25);
    const hipGeo = new THREE.SphereGeometry(0.27, 12, 9); hipGeo.scale(0.85, 0.95, 1.2);
    const chest = new THREE.Mesh(chestGeo, this.furMat); chest.position.set(0, 0.86, 0.32); chest.castShadow = true;
    const hip = new THREE.Mesh(hipGeo, this.furMat); hip.position.set(0, 0.84, -0.36); hip.castShadow = true;
    const waistGeo = new THREE.CylinderGeometry(0.21, 0.25, 0.6, 10); waistGeo.rotateX(Math.PI / 2);
    const waist = new THREE.Mesh(waistGeo, this.furMat); waist.position.set(0, 0.86, -0.02);
    this.body.add(chest, hip, waist);
    // spine ridge: ragged spikes of fur
    const spikeGeo = new THREE.ConeGeometry(0.05, 0.2, 4);
    for (let i = 0; i < 7; i++) {
      const sp = new THREE.Mesh(spikeGeo, darkMat);
      sp.position.set(0, 1.15 - Math.abs(i - 2) * 0.03, 0.45 - i * 0.14);
      sp.rotation.x = -0.6;
      this.body.add(sp);
    }
    // head: long narrow skull and a separate jaw
    const skullGeo = new THREE.BoxGeometry(0.26, 0.24, 0.5);
    const snoutGeo = new THREE.BoxGeometry(0.17, 0.13, 0.3);
    const jawGeo = new THREE.BoxGeometry(0.15, 0.06, 0.38); jawGeo.translate(0, 0, 0.17);
    const earGeo = new THREE.ConeGeometry(0.06, 0.2, 4);
    const eyeGeo = new THREE.SphereGeometry(0.03, 6, 5);
    this.geos.push(chestGeo, hipGeo, waistGeo, spikeGeo, skullGeo, snoutGeo, jawGeo, earGeo, eyeGeo);
    this.head.position.set(0, 1.12, 0.66);
    const skull = new THREE.Mesh(skullGeo, this.furMat); skull.position.set(0, 0.04, 0.1);
    const snout = new THREE.Mesh(snoutGeo, darkMat); snout.position.set(0, -0.02, 0.45);
    this.jaw = new THREE.Mesh(jawGeo, darkMat); this.jaw.position.set(0, -0.1, 0.18);
    this.head.add(skull, snout, this.jaw);
    for (const s of [-1, 1]) {
      const ear = new THREE.Mesh(earGeo, darkMat); ear.position.set(s * 0.09, 0.22, -0.02); ear.rotation.set(-0.4, 0, s * 0.2);
      const eye = new THREE.Mesh(eyeGeo, this.eyeMat); eye.position.set(s * 0.1, 0.07, 0.3);
      this.head.add(ear, eye);
    }
    this.body.add(this.head);
    // the silent bell — cracked bronze on a rope collar
    const bellProf = [new THREE.Vector2(0.001, 0.0), new THREE.Vector2(0.05, -0.01), new THREE.Vector2(0.075, -0.08), new THREE.Vector2(0.09, -0.17), new THREE.Vector2(0.11, -0.2), new THREE.Vector2(0.001, -0.2)];
    const bellGeo = new THREE.LatheGeometry(bellProf, 14);
    const collarGeo = new THREE.TorusGeometry(0.17, 0.025, 5, 16);
    this.geos.push(bellGeo, collarGeo);
    this.bell = new THREE.Mesh(bellGeo, this.bellMat);
    this.bell.position.set(0, 0.86, 0.68);
    const collar = new THREE.Mesh(collarGeo, darkMat); collar.position.set(0, 0.98, 0.6); collar.rotation.x = 1.2;
    this.body.add(this.bell, collar);
    // legs pivot at hip/shoulder
    const legGeo = new THREE.CylinderGeometry(0.06, 0.04, 0.8, 6); legGeo.translate(0, -0.4, 0);
    const pawGeo = new THREE.BoxGeometry(0.1, 0.05, 0.16); pawGeo.translate(0, -0.8, 0.04);
    this.geos.push(legGeo, pawGeo);
    for (const [x, z] of [[-0.18, 0.4], [0.18, 0.4], [-0.16, -0.42], [0.16, -0.42]] as const) {
      const g = new THREE.Group(); g.position.set(x, 0.82, z);
      g.add(new THREE.Mesh(legGeo, this.furMat), new THREE.Mesh(pawGeo, darkMat));
      this.legs.push(g); this.body.add(g);
    }
    // tail
    const tailGeo = new THREE.ConeGeometry(0.07, 0.6, 6); tailGeo.translate(0, -0.3, 0);
    this.geos.push(tailGeo);
    this.tail.position.set(0, 0.95, -0.6); this.tail.add(new THREE.Mesh(tailGeo, this.furMat));
    this.body.add(this.tail);
    this.root.add(this.body);
  }

  update(e: Enemy, dt: number, time: number, speed: number): void {
    this.gait += dt * (2 + speed * 1.6);
    this.root.rotation.y = e.yaw;
    const atk = e.attack;
    let crouch = 0, jawOpen = 0.05, pitch = 0, legSwing = Math.min(1, speed / 4) * 0.7, hop = 0, bellGlow = 0.0;
    if (e.phase === 'windup' && atk) {
      const k = Math.min(1, e.t / atk.windup);
      crouch = atk.id === 'pounce' ? k * 0.32 : k * 0.12;
      pitch = atk.id === 'pounce' ? -0.12 * k : 0.15 * k;
      jawOpen = 0.1 + k * 0.45;
      bellGlow = k;
      legSwing = 0.05;
    } else if (e.phase === 'strike' && atk) {
      const k = Math.min(1, e.t / atk.active);
      if (atk.id === 'pounce') { hop = Math.sin(k * Math.PI) * 1.7; pitch = -0.4 + k * 0.7; }
      else { pitch = 0.3; }
      jawOpen = 0.7 - k * 0.6; bellGlow = 1;
      legSwing = 0.2;
    } else if (e.phase === 'stagger') {
      pitch = -0.25 + Math.sin(e.t * 20) * 0.06; crouch = 0.1; legSwing = 0;
    } else if (e.phase === 'alert') {
      jawOpen = 0.35; pitch = -0.1;
    }
    this.body.position.y = -crouch + hop + Math.abs(Math.sin(this.gait * 2)) * 0.04 * legSwing;
    this.body.rotation.x = pitch;
    this.jaw.rotation.x = jawOpen;
    this.head.rotation.x = -pitch * 0.5;
    this.legs.forEach((l, i) => { l.rotation.x = Math.sin(this.gait * 2 + (i % 2 === 0 ? 0 : Math.PI) + (i > 1 ? Math.PI * 0.5 : 0)) * legSwing + (crouch > 0 ? (i < 2 ? -crouch : crouch) * 1.2 : 0); });
    this.tail.rotation.x = -0.6 + Math.sin(time * 6) * 0.1;
    this.tail.rotation.z = Math.sin(time * 3 + this.gait) * 0.25;
    this.bell.rotation.z = Math.sin(this.gait * 2) * 0.3 * legSwing;
    this.bellMat.emissive.setRGB(bellGlow * 0.9 + e.flash, bellGlow * 0.12 + e.flash * 0.9, e.flash * 0.8);
    this.eyeMat.color.setRGB(1, 0.48 - bellGlow * 0.3, 0.16);
    // a faint ember rim so the hound reads against the night, brighter as it winds up
    this.furMat.emissive.setRGB(0.07 + bellGlow * 0.12 + e.flash * 0.9, 0.035 + e.flash * 0.9, 0.025 + e.flash * 0.9);
    if (e.phase === 'dead') {
      const k = Math.min(1, e.t / 1.4);
      this.body.rotation.z = k * 1.45;
      this.body.position.y = -k * 0.45;
      this.furMat.opacity = 1 - Math.max(0, (k - 0.4) / 0.6);
    }
  }

  dispose(): void { this.geos.forEach((g) => g.dispose()); this.mats.forEach((m) => m.dispose()); }
}
