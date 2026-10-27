// Renders the combat simulation: enemy figures, ground telegraphs, the spirit's strikes,
// impact sparks and the charge glow. Reads CombatSim state; never decides anything.

import * as THREE from 'three';
import type { CombatSim, Enemy, EnemyAttackDef, PlayerAttack, V2 } from '../sim/combat.js';
import { WraithFigure, HoundFigure, type EnemyFigure } from './EnemyFigures.js';

interface Tele { mesh: THREE.Group; fill: THREE.Mesh; edge: THREE.Mesh; enemy: Enemy; atk: EnemyAttackDef }
interface Fx { obj: THREE.Object3D; t: number; dur: number; kind: 'slash' | 'spark' | 'ring'; vel?: Float32Array; spin?: number; grow?: number }

const TELE_COLOR = new THREE.Color('#ff3a24');

export class CombatView {
  private figures = new Map<string, { fig: EnemyFigure; last: V2 }>();
  private teles = new Map<string, Tele>();
  private fx: Fx[] = [];
  private teleFillMat: THREE.MeshBasicMaterial;
  private teleEdgeMat: THREE.MeshBasicMaterial;
  private sparkMat: THREE.PointsMaterial;
  private chargeOrb: THREE.Mesh;
  private chargeMat: THREE.MeshBasicMaterial;

  constructor(private scene: THREE.Scene, private ground: (x: number, z: number) => number) {
    this.teleFillMat = new THREE.MeshBasicMaterial({ color: TELE_COLOR, transparent: true, opacity: 0.38, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    this.teleEdgeMat = new THREE.MeshBasicMaterial({ color: TELE_COLOR, transparent: true, opacity: 0.22, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4 });
    this.sparkMat = new THREE.PointsMaterial({ color: '#ffe2b0', size: 0.14, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    this.chargeMat = new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
    this.chargeOrb = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 2), this.chargeMat);
    this.chargeOrb.visible = false;
    scene.add(this.chargeOrb);
  }

  /** World position of an enemy's head (for bars, reticle and the camera lock). */
  headOf(e: Enemy): THREE.Vector3 {
    const f = this.figures.get(e.id);
    return new THREE.Vector3(e.pos.x, this.ground(e.pos.x, e.pos.z) + (f?.fig.top ?? 1.8) + 0.25, e.pos.z);
  }
  centerOf(e: Enemy): THREE.Vector3 {
    const f = this.figures.get(e.id);
    return new THREE.Vector3(e.pos.x, this.ground(e.pos.x, e.pos.z) + (f?.fig.top ?? 1.8) * 0.55, e.pos.z);
  }

  update(sim: CombatSim, dt: number, time: number, playerPos: THREE.Vector3, playerYaw: number, tint: THREE.Color): void {
    const seen = new Set<string>();
    for (const e of sim.enemies) {
      seen.add(e.id);
      let f = this.figures.get(e.id);
      if (!f) {
        const fig = e.kind === 'wraith' ? new WraithFigure() : new HoundFigure();
        this.scene.add(fig.root);
        f = { fig, last: { ...e.pos } };
        this.figures.set(e.id, f);
      }
      const speed = Math.hypot(e.pos.x - f.last.x, e.pos.z - f.last.z) / Math.max(dt, 1e-4);
      f.last = { ...e.pos };
      f.fig.root.position.set(e.pos.x, this.ground(e.pos.x, e.pos.z), e.pos.z);
      f.fig.update(e, dt, time, speed);
      this.updateTelegraph(e, time);
    }
    for (const [id, f] of this.figures) if (!seen.has(id)) { this.scene.remove(f.fig.root); f.fig.dispose(); this.figures.delete(id); this.dropTele(id); }

    // charge glow gathers at the spirit's core while a heavy is held
    const c = sim.chargeLevel;
    this.chargeOrb.visible = sim.charging;
    if (sim.charging) {
      this.chargeOrb.position.set(playerPos.x + Math.sin(playerYaw) * 0.35, playerPos.y + 1.25, playerPos.z + Math.cos(playerYaw) * 0.35);
      this.chargeOrb.scale.setScalar(0.3 + c * 0.8 + (c >= 1 ? Math.sin(time * 30) * 0.08 : 0));
      this.chargeMat.color.copy(tint).lerp(new THREE.Color('#ffffff'), c * 0.6);
      this.chargeMat.opacity = 0.25 + c * 0.5;
    }
    this.updateFx(dt);
  }

  // ─── telegraphs ────────────────────────────────────────────────────────────

  private updateTelegraph(e: Enemy, time: number): void {
    const active = (e.phase === 'windup' || e.phase === 'strike') && e.attack;
    if (!active) { this.dropTele(e.id); return; }
    const atk = e.attack!;
    let t = this.teles.get(e.id);
    if (!t || t.atk !== atk) { this.dropTele(e.id); t = this.makeTele(e, atk); this.teles.set(e.id, t); }
    const k = e.phase === 'windup' ? Math.min(1, e.t / atk.windup) : 1;
    // follow the committed aim; the fill grows until the hit lands
    const center = atk.shape === 'circle' ? e.aimPoint : e.phase === 'strike' ? e.strikeFrom : e.pos;
    t.mesh.position.set(center.x, this.ground(center.x, center.z) + 0.08, center.z);
    t.mesh.rotation.y = Math.atan2(e.aimDir.x, e.aimDir.z);
    if (atk.shape === 'line') t.fill.scale.set(1, k, 1);
    else t.fill.scale.setScalar(Math.max(0.02, k));
    const blink = k > 0.7 && e.phase === 'windup' ? 0.5 + 0.5 * Math.sin(time * 38) : 1;
    (t.fill.material as THREE.MeshBasicMaterial).opacity = (0.16 + k * 0.3) * blink;
    (t.edge.material as THREE.MeshBasicMaterial).opacity = 0.3 + k * 0.35;
  }

  private makeTele(e: Enemy, atk: EnemyAttackDef): Tele {
    const g = new THREE.Group();
    let fillGeo: THREE.BufferGeometry, edgeGeo: THREE.BufferGeometry;
    if (atk.shape === 'arc') {
      const r = atk.range + 0.2;
      fillGeo = new THREE.CircleGeometry(r, 32, Math.PI / 2 - atk.arc, atk.arc * 2);
      edgeGeo = new THREE.RingGeometry(r - 0.08, r, 32, 1, Math.PI / 2 - atk.arc, atk.arc * 2);
    } else if (atk.shape === 'line') {
      const len = atk.dash + atk.range + 0.4, w = (atk.arc + 0.3) * 2;
      fillGeo = new THREE.PlaneGeometry(w, len); fillGeo.translate(0, len / 2, 0);
      const edge = new THREE.PlaneGeometry(w + 0.16, len + 0.16); edge.translate(0, len / 2, 0);
      edgeGeo = edge;
    } else {
      fillGeo = new THREE.CircleGeometry(atk.range, 36);
      edgeGeo = new THREE.RingGeometry(atk.range - 0.09, atk.range, 36);
    }
    // geometry is authored in the XY plane with +Y as "forward"; lay it flat so +Y → +Z
    fillGeo.rotateX(-Math.PI / 2); fillGeo.scale(1, 1, -1);
    edgeGeo.rotateX(-Math.PI / 2); edgeGeo.scale(1, 1, -1);
    const fill = new THREE.Mesh(fillGeo, this.teleFillMat.clone());
    const edge = new THREE.Mesh(edgeGeo, this.teleEdgeMat.clone());
    fill.renderOrder = 3; edge.renderOrder = 3;
    if (atk.shape === 'line') edge.position.y = -0.01;
    g.add(edge, fill);
    this.scene.add(g);
    return { mesh: g, fill, edge, enemy: e, atk };
  }

  private dropTele(id: string): void {
    const t = this.teles.get(id);
    if (!t) return;
    this.scene.remove(t.mesh);
    for (const m of [t.fill, t.edge]) { m.geometry.dispose(); (m.material as THREE.Material).dispose(); }
    this.teles.delete(id);
  }

  // ─── strikes & impacts ─────────────────────────────────────────────────────

  /** A crescent of light sweeping through the attack arc. */
  slash(at: THREE.Vector3, yaw: number, a: PlayerAttack, tint: THREE.Color): void {
    const heavy = a.kind === 'heavy';
    const r = a.range * (heavy ? 1.0 : 0.95);
    const geo = new THREE.RingGeometry(r * 0.45, r, 40, 1, Math.PI / 2 - a.arc, a.arc * 2);
    geo.rotateX(-Math.PI / 2); geo.scale(1, 1, -1);
    const col = tint.clone().lerp(new THREE.Color('#ffffff'), heavy ? 0.45 : 0.3);
    const mat = new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(at.x, at.y + (heavy ? 0.9 : 1.15), at.z);
    // alternate the tilt per combo step so the strikes read as left / right / overhead
    m.rotation.order = 'YXZ';
    m.rotation.y = yaw;
    m.rotation.z = heavy ? 0 : a.step === 0 ? 0.45 : a.step === 1 ? -0.45 : 0.1;
    m.rotation.x = heavy ? 0.08 : a.step === 2 ? 0.35 : 0;
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, dur: heavy ? 0.32 : 0.2, kind: 'slash', spin: (a.step === 1 ? -1 : 1) * (heavy ? 0.6 : 1.4) });
    if (heavy) this.ring(new THREE.Vector3(at.x + Math.sin(yaw) * 1.6, at.y + 0.1, at.z + Math.cos(yaw) * 1.6), col, 2.5 + a.charge * 2);
  }

  ring(at: THREE.Vector3, color: THREE.Color, grow: number): void {
    const geo = new THREE.RingGeometry(0.85, 1, 40); geo.rotateX(-Math.PI / 2);
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide });
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(at);
    this.scene.add(m);
    this.fx.push({ obj: m, t: 0, dur: 0.45, kind: 'ring', grow });
  }

  /** Impact burst of sparks. `color` defaults to warm white. */
  sparks(at: THREE.Vector3, n = 14, color?: THREE.Color, speed = 6): void {
    const pos = new Float32Array(n * 3), vel = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      pos.set([at.x, at.y, at.z], i * 3);
      const a = Math.random() * Math.PI * 2, u = Math.random() * 2 - 1, s = speed * (0.4 + Math.random() * 0.8);
      const r = Math.sqrt(1 - u * u);
      vel.set([Math.cos(a) * r * s, Math.abs(u) * s * 0.8 + 1.5, Math.sin(a) * r * s], i * 3);
    }
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = this.sparkMat.clone();
    if (color) mat.color.copy(color);
    const p = new THREE.Points(geo, mat);
    p.frustumCulled = false;
    this.scene.add(p);
    this.fx.push({ obj: p, t: 0, dur: 0.45, kind: 'spark', vel });
  }

  private updateFx(dt: number): void {
    this.fx = this.fx.filter((f) => {
      f.t += dt;
      const k = f.t / f.dur;
      const o = f.obj as THREE.Mesh | THREE.Points;
      const mat = o.material as THREE.MeshBasicMaterial | THREE.PointsMaterial;
      if (f.kind === 'slash') {
        o.rotation.y += (f.spin ?? 1) * dt * 2.5;
        o.scale.setScalar(0.85 + k * 0.3);
        mat.opacity = 0.9 * (1 - k) * (1 - k);
      } else if (f.kind === 'ring') {
        o.scale.setScalar(0.3 + k * (f.grow ?? 3));
        mat.opacity = 0.8 * (1 - k);
      } else {
        const p = (o.geometry.attributes['position'] as THREE.BufferAttribute);
        const v = f.vel!;
        for (let i = 0; i < p.count; i++) {
          v[i * 3 + 1]! -= 14 * dt;
          p.setXYZ(i, p.getX(i) + v[i * 3]! * dt, p.getY(i) + v[i * 3 + 1]! * dt, p.getZ(i) + v[i * 3 + 2]! * dt);
        }
        p.needsUpdate = true;
        mat.opacity = 1 - k;
      }
      if (k >= 1) { this.scene.remove(o); o.geometry.dispose(); mat.dispose(); return false; }
      return true;
    });
  }

  clear(): void {
    for (const [, f] of this.figures) { this.scene.remove(f.fig.root); f.fig.dispose(); }
    this.figures.clear();
    for (const id of [...this.teles.keys()]) this.dropTele(id);
  }
}
