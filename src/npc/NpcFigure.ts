// Stylised, hand-built villager figures with a small procedural rig (body, head, sleeves).
// These are original procedural models — a coherent placeholder art style, not final character art.

import * as THREE from 'three';

export interface FigureStyle {
  robe: string; robe2: string; obi: string; skin: string; hair: string;
  height: number;
  hat?: 'kasa' | 'traveler' | 'none';
  hairStyle?: 'bun' | 'short' | 'bald' | 'tied' | 'scarf';
  prop?: 'lantern' | 'bow' | 'cane' | 'pack' | 'staff' | 'none';
}

export const STYLES: Record<string, FigureStyle> = {
  hana: { robe: '#e9e2d4', robe2: '#9b1f1b', obi: '#9b1f1b', skin: '#e2c2a2', hair: '#141016', height: 1.62, hairStyle: 'tied', prop: 'lantern' },
  daichi: { robe: '#4a4234', robe2: '#2b2a22', obi: '#5d3b22', skin: '#c99a76', hair: '#1a1410', height: 1.78, hat: 'kasa', hairStyle: 'short', prop: 'bow' },
  mio: { robe: '#b8332b', robe2: '#e7b13f', obi: '#e7b13f', skin: '#ecc8a8', hair: '#120e10', height: 1.12, hairStyle: 'bun', prop: 'none' },
  takeshi: { robe: '#3a3f4f', robe2: '#22252e', obi: '#6b5a3a', skin: '#cfa888', hair: '#c9c6c0', height: 1.6, hairStyle: 'bald', prop: 'cane' },
  aiko: { robe: '#4b5d6e', robe2: '#d8d2c4', obi: '#2f3a44', skin: '#ddb796', hair: '#1a1416', height: 1.58, hairStyle: 'scarf', prop: 'none' },
  rei: { robe: '#6b4f6a', robe2: '#c9a24a', obi: '#2a1d2a', skin: '#d9b08f', hair: '#2a1a14', height: 1.66, hat: 'traveler', hairStyle: 'tied', prop: 'pack' },
  genzo: { robe: '#d8d4ca', robe2: '#26262a', obi: '#26262a', skin: '#cda082', hair: '#18161a', height: 1.74, hairStyle: 'bald', prop: 'staff' },
};

export class NpcFigure {
  root = new THREE.Group();
  body = new THREE.Group();
  head = new THREE.Group();
  armL = new THREE.Group();
  armR = new THREE.Group();
  lanternLight: THREE.PointLight | null = null;
  private t = Math.random() * 10;
  walk = 0;           // 0..1 blend
  gesture: 'none' | 'call' | 'pray' | 'aim' | 'cower' | 'wave' = 'none';
  private g = 0;      // gesture blend

  constructor(public style: FigureStyle, lanternLight: boolean) {
    const H = style.height;
    const s = H / 1.65;
    const mat = (c: string, rough = 0.9, extra: THREE.MeshStandardMaterialParameters = {}) => new THREE.MeshStandardMaterial({ color: c, roughness: rough, ...extra });
    const robeMat = mat(style.robe), robe2 = mat(style.robe2), obi = mat(style.obi), skin = mat(style.skin, 0.7), hair = mat(style.hair, 0.6);

    // robe (kimono silhouette via lathe)
    const prof: THREE.Vector2[] = [
      new THREE.Vector2(0.001, 1.38), new THREE.Vector2(0.17, 1.36), new THREE.Vector2(0.22, 1.26), new THREE.Vector2(0.2, 1.0),
      new THREE.Vector2(0.18, 0.86), new THREE.Vector2(0.21, 0.5), new THREE.Vector2(0.26, 0.08), new THREE.Vector2(0.27, 0.0),
    ];
    const robe = new THREE.Mesh(new THREE.LatheGeometry(prof, 14), robeMat);
    robe.scale.set(1, 1, 0.78);
    this.body.add(robe);
    // hem / underlayer
    const hem = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.285, 0.12, 14, 1, true), robe2);
    hem.scale.z = 0.8; hem.position.y = 0.06;
    this.body.add(hem);
    // collar (V)
    const collar = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 4, 12, Math.PI), robe2);
    collar.rotation.set(Math.PI / 2 + 0.6, 0, Math.PI);
    collar.position.set(0, 1.3, 0.06);
    this.body.add(collar);
    const obiM = new THREE.Mesh(new THREE.CylinderGeometry(0.205, 0.205, 0.16, 14), obi);
    obiM.scale.z = 0.8; obiM.position.y = 0.94;
    this.body.add(obiM);

    // head
    const headM = new THREE.Mesh(new THREE.SphereGeometry(0.135, 16, 12), skin);
    headM.scale.set(0.92, 1.05, 0.95);
    this.head.add(headM);
    const eyeMat = new THREE.MeshBasicMaterial({ color: '#1a1214' });
    for (const x of [-0.045, 0.045]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.014, 6, 4), eyeMat);
      e.position.set(x, 0.01, 0.123); e.scale.set(1.3, 0.7, 0.5);
      this.head.add(e);
    }
    const hs = style.hairStyle ?? 'short';
    if (hs !== 'bald') {
      const cap = new THREE.Mesh(new THREE.SphereGeometry(0.142, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.55), hair);
      cap.rotation.x = -0.35; cap.position.y = 0.02;
      this.head.add(cap);
      if (hs === 'bun') { const b = new THREE.Mesh(new THREE.SphereGeometry(0.07, 10, 8), hair); b.position.set(0, 0.15, -0.06); this.head.add(b); }
      if (hs === 'tied') { const b = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.02, 0.32, 6), hair); b.position.set(0, -0.08, -0.14); b.rotation.x = 0.2; this.head.add(b); }
      if (hs === 'scarf') { const b = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 8, 0, Math.PI * 2, 0, Math.PI * 0.5), mat('#c9b48a')); b.rotation.x = -0.25; b.position.y = 0.025; this.head.add(b); }
    } else if (style.hair !== '#18161a') {
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.12, 0.03, 5, 14, Math.PI * 1.2), hair);
      ring.rotation.set(Math.PI / 2, 0, Math.PI * 0.9); ring.position.set(0, -0.01, -0.02);
      this.head.add(ring);
    }
    if (style.hat === 'kasa') {
      const kasa = new THREE.Mesh(new THREE.ConeGeometry(0.42, 0.2, 16, 1, true), mat('#b59a62', 1, { side: THREE.DoubleSide }));
      kasa.position.y = 0.14; this.head.add(kasa);
    } else if (style.hat === 'traveler') {
      const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.38, 0.03, 16), mat('#3a2e22'));
      const crown = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.15, 0.14, 12), mat('#3a2e22'));
      brim.position.y = 0.1; crown.position.y = 0.17;
      this.head.add(brim, crown);
    }
    this.head.position.y = 1.5;
    this.body.add(this.head);

    // sleeves (furisode-like) on shoulder pivots
    for (const [arm, side] of [[this.armL, -1], [this.armR, 1]] as const) {
      const sleeve = new THREE.Mesh(new THREE.CylinderGeometry(0.075, 0.12, 0.5, 8), robeMat);
      sleeve.position.y = -0.24;
      const cuff = new THREE.Mesh(new THREE.CylinderGeometry(0.121, 0.121, 0.06, 8, 1, true), robe2);
      cuff.position.y = -0.47;
      const hand = new THREE.Mesh(new THREE.SphereGeometry(0.045, 8, 6), skin);
      hand.position.y = -0.53;
      arm.add(sleeve, cuff, hand);
      arm.position.set(side * 0.22, 1.33, 0);
      arm.rotation.z = side * 0.12;
      this.body.add(arm);
    }

    // props
    if (style.prop === 'lantern') {
      const lan = new THREE.Mesh(new THREE.SphereGeometry(0.12, 10, 8), new THREE.MeshStandardMaterial({ color: '#e8b070', emissive: new THREE.Color('#ff9a40'), emissiveIntensity: 2.5 }));
      lan.scale.y = 1.3; lan.position.set(0, -0.72, 0.05);
      this.armR.add(lan);
      if (lanternLight) {
        this.lanternLight = new THREE.PointLight('#ffa050', 4, 10, 2);
        this.lanternLight.position.copy(lan.position);
        this.armR.add(this.lanternLight);
      }
    } else if (style.prop === 'bow') {
      const curve = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, -0.7, 0), new THREE.Vector3(0, 0, -0.28), new THREE.Vector3(0, 0.7, 0));
      const bow = new THREE.Mesh(new THREE.TubeGeometry(curve, 12, 0.018, 5), mat('#2a1a12', 0.5));
      bow.position.set(0.05, 1.05, -0.2); bow.rotation.z = 0.5;
      bow.name = 'bow';
      this.body.add(bow);
    } else if (style.prop === 'cane') {
      const cane = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.025, 1.05, 6), mat('#4a3424'));
      cane.position.set(0, -0.95, 0.06);
      this.armR.add(cane);
    } else if (style.prop === 'pack') {
      const pack = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.5, 0.22), mat('#5a4430'));
      pack.position.set(0, 1.12, -0.24);
      this.body.add(pack);
    } else if (style.prop === 'staff') {
      const staff = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 1.8, 6), mat('#2b2622'));
      staff.position.set(0, -0.3, 0.06);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(0.1, 0.012, 4, 12), new THREE.MeshStandardMaterial({ color: '#8a7240', metalness: 0.8, roughness: 0.3 }));
      ring.position.set(0, 0.62, 0.06);
      this.armR.add(staff, ring);
    }

    this.body.scale.setScalar(s);
    this.root.add(this.body);
    this.root.traverse((o) => { if ((o as THREE.Mesh).isMesh) { o.castShadow = true; } });
  }

  update(dt: number): void {
    this.t += dt;
    const t = this.t;
    const w = this.walk;
    const targetG = this.gesture === 'none' ? 0 : 1;
    this.g += (targetG - this.g) * Math.min(1, dt * 4);
    const breathe = Math.sin(t * 1.6) * 0.008;
    const step = Math.sin(t * 9) * w;
    this.body.position.y = Math.abs(step) * 0.035 + breathe;
    this.body.rotation.z = step * 0.04;
    let lx = step * 0.5, rx = -step * 0.5, lz = -0.12, rz = 0.12;
    let headX = 0;
    switch (this.gesture) {
      case 'call': rx = -2.4 + Math.sin(t * 7) * 0.25; rz = 0.25; headX = -0.25; break;
      case 'wave': rx = -2.6; rz = 0.3 + Math.sin(t * 9) * 0.35; break;
      case 'pray': lx = rx = -1.1; lz = 0.55; rz = -0.55; headX = 0.35; break;
      case 'aim': lx = -1.55; rx = -1.35; lz = -0.15; rz = 0.6; break;
      case 'cower': lx = rx = -1.9; lz = 0.5; rz = -0.5; headX = 0.5; this.body.rotation.x = 0.25 * this.g; break;
    }
    if (this.gesture !== 'cower') this.body.rotation.x *= 0.9;
    const k = this.g;
    this.armL.rotation.x += (lerp(step * 0.5, lx, k) - this.armL.rotation.x) * Math.min(1, dt * 10);
    this.armR.rotation.x += (lerp(-step * 0.5, rx, k) - this.armR.rotation.x) * Math.min(1, dt * 10);
    this.armL.rotation.z += (lerp(-0.12, lz, k) - this.armL.rotation.z) * Math.min(1, dt * 10);
    this.armR.rotation.z += (lerp(0.12, rz, k) - this.armR.rotation.z) * Math.min(1, dt * 10);
    this.head.rotation.x += (headX * k - this.head.rotation.x) * Math.min(1, dt * 6);
    if (this.lanternLight) this.lanternLight.intensity = 3.6 + Math.sin(t * 13) * 0.3 + Math.sin(t * 7.3) * 0.3;
  }
}

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }
