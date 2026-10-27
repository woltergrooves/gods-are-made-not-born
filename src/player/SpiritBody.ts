// The player's body: a modular spirit whose parts grow from what the world believes.
// Parts are independent meshes that fade/scale in, so any combination can coexist.

import * as THREE from 'three';
import type { FormState } from '../sim/types.js';

const ASPECT_TINT: Record<string, THREE.Color> = {
  none: new THREE.Color('#9fefff'),
  guardian: new THREE.Color('#ffd585'),
  terror: new THREE.Color('#ff3d4a'),
  destruction: new THREE.Color('#ff7a2a'),
  mercy: new THREE.Color('#ffc2d8'),
  wanderer: new THREE.Color('#c8d4e8'),
  trickster: new THREE.Color('#b48cff'),
  nature: new THREE.Color('#9dffb8'),
  vengeance: new THREE.Color('#c02060'),
};

interface Part { obj: THREE.Object3D; target: number; current: number }

export class SpiritBody {
  root = new THREE.Group();
  private bodyPivot = new THREE.Group();
  private coreU: Record<string, THREE.IUniform>;
  private shroudU: Record<string, THREE.IUniform>;
  private parts: Record<string, Part> = {};
  private eyes: THREE.Mesh[] = [];
  private eyeMat: THREE.MeshBasicMaterial;
  private embers: THREE.Points;
  private trail: THREE.Points;
  private trailPos: Float32Array;
  private trailHead = 0;
  private trailTimer = 0;
  tint = ASPECT_TINT['none']!.clone();
  private tintTarget = ASPECT_TINT['none']!.clone();
  stage = 0;
  private stageVis = 0.35;
  private pulse = 0;
  private strikeT = 1;
  private strikeDur = 0.3;
  private strikeSide = 1;
  private strikeHeavy = false;
  private hurtT = 0;
  /** 0 = solid, 1 = fully dissipated (defeat). */
  dissolve = 0;
  light: THREE.PointLight;

  constructor(scene: THREE.Scene) {
    this.root.add(this.bodyPivot);
    // core
    this.coreU = { uTime: { value: 0 }, uTint: { value: this.tint }, uVis: { value: 0.5 }, uPulse: { value: 0 } };
    const coreMat = new THREE.ShaderMaterial({
      uniforms: this.coreU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vec3 p = position; p += normal * (sin(uTime*3.0 + position.y*8.0)*0.03 + sin(uTime*5.3 + position.x*11.0)*0.02);
          vP = p; vec4 mv = modelViewMatrix * vec4(p,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime, uVis, uPulse; uniform vec3 uTint; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float f = 1.0 - abs(dot(vN, vV)); float rim = pow(f, 1.8);
          float swirl = sin(vP.y * 10.0 - uTime * 3.0 + sin(vP.x * 7.0 + uTime) * 2.0) * 0.5 + 0.5;
          float core = pow(1.0 - f, 2.2);
          vec3 c = uTint * (0.5 + rim * 0.7 + swirl * 0.35) + vec3(1.0) * pow(1.0 - f, 5.0) * 0.9;
          gl_FragColor = vec4(c * (1.0 + uPulse * 2.0), (0.18 + core * 0.7 + rim * 0.2) * uVis); }`,
    });
    const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 3), coreMat);
    core.position.y = 1.25;
    this.bodyPivot.add(core);

    // shroud / veil body
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= 16; i++) { const t = i / 16; pts.push(new THREE.Vector2(0.08 + Math.sin(t * Math.PI * 0.95) * 0.55 * (1 - t * 0.35), 1.55 - t * 1.45)); }
    this.shroudU = { uTime: { value: 0 }, uTint: { value: this.tint }, uVis: { value: 0.5 }, uSpeed: { value: 0 } };
    const shroudMat = new THREE.ShaderMaterial({
      uniforms: this.shroudU, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime, uSpeed; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        void main(){ vUv = uv; vec3 p = position; float k = 1.0 - smoothstep(0.0, 1.5, p.y);
          p.x += sin(uTime * 2.2 + p.y * 4.0 + uv.x * 12.0) * 0.07 * k; p.z += cos(uTime * 1.8 + uv.x * 9.0) * 0.07 * k - uSpeed * k * k * 0.5;
          vec4 mv = modelViewMatrix * vec4(p,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform float uTime, uVis; uniform vec3 uTint; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
        float h(vec2 p){ return fract(sin(dot(p, vec2(41.3, 289.1))) * 9813.7); }
        float n(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f); return mix(mix(h(i),h(i+vec2(1,0)),f.x), mix(h(i+vec2(0,1)),h(i+vec2(1,1)),f.x), f.y); }
        void main(){ float flow = n(vec2(vUv.x * 14.0, vUv.y * 5.0 + uTime * 1.6)) * 0.6 + n(vec2(vUv.x * 30.0, vUv.y * 9.0 + uTime * 2.4)) * 0.4;
          float rim = pow(1.0 - abs(dot(vN, vV)), 1.5);
          float fade = smoothstep(0.0, 0.25, vUv.y) * smoothstep(1.0, 0.75, vUv.y);
          float a = (flow * 0.6 + rim * 0.5) * fade * uVis * 0.55;
          gl_FragColor = vec4(uTint * (0.6 + flow), a); }`,
    });
    const shroud = new THREE.Mesh(new THREE.LatheGeometry(pts, 24), shroudMat);
    this.bodyPivot.add(shroud);

    // eyes
    this.eyeMat = new THREE.MeshBasicMaterial({ color: '#e8ffff', transparent: true, opacity: 0.0 });
    for (const s of [-1, 1]) {
      const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), this.eyeMat);
      e.scale.set(1.2, 0.6, 0.6);
      e.position.set(s * 0.14, 1.32, 0.36);
      this.eyes.push(e);
      this.bodyPivot.add(e);
    }

    // halo (guardian)
    const halo = new THREE.Group();
    const haloMat = new THREE.MeshBasicMaterial({ color: '#ffd585', transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false });
    halo.add(new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.025, 6, 48), haloMat));
    for (let i = 0; i < 12; i++) {
      const tick = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.16, 0.03), haloMat);
      const a = (i / 12) * Math.PI * 2;
      tick.position.set(Math.cos(a) * 0.72, Math.sin(a) * 0.72, 0);
      tick.rotation.z = a - Math.PI / 2;
      halo.add(tick);
    }
    halo.position.set(0, 1.45, -0.35);
    this.addPart('halo', halo);

    // horns (terror)
    const horns = new THREE.Group();
    const hornMat = new THREE.MeshStandardMaterial({ color: '#120a10', emissive: new THREE.Color('#ff2a3a'), emissiveIntensity: 0.35, roughness: 0.35, metalness: 0.3 });
    for (const s of [-1, 1]) {
      const c = new THREE.CatmullRomCurve3([
        new THREE.Vector3(s * 0.18, 1.5, 0.05), new THREE.Vector3(s * 0.42, 1.85, -0.05),
        new THREE.Vector3(s * 0.5, 2.2, -0.35), new THREE.Vector3(s * 0.36, 2.42, -0.7),
      ]);
      const geo = new THREE.TubeGeometry(c, 20, 0.06, 7, false);
      const p = geo.attributes['position'] as THREE.BufferAttribute;
      // taper toward the tip
      for (let i = 0; i < p.count; i++) {
        const seg = Math.floor(i / 8) / 20;
        const centre = c.getPoint(Math.min(seg, 1));
        const k = 1 - seg * 0.85;
        p.setXYZ(i, centre.x + (p.getX(i) - centre.x) * k, centre.y + (p.getY(i) - centre.y) * k, centre.z + (p.getZ(i) - centre.z) * k);
      }
      geo.computeVertexNormals();
      horns.add(new THREE.Mesh(geo, hornMat));
    }
    this.addPart('horns', horns);

    // embers (destruction)
    const eN = 60;
    const ep = new Float32Array(eN * 3);
    for (let i = 0; i < eN; i++) ep.set([(Math.random() - 0.5) * 1.2, Math.random() * 2.2, (Math.random() - 0.5) * 1.2], i * 3);
    const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.BufferAttribute(ep, 3));
    this.embers = new THREE.Points(eg, new THREE.PointsMaterial({ color: '#ff8a3a', size: 0.16, map: glowDot(), transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.addPart('embers', this.embers);

    // petals (mercy)
    const petals = new THREE.Group();
    const petalMat = new THREE.MeshBasicMaterial({ color: '#ffd0e0', transparent: true, opacity: 0.8, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    for (let i = 0; i < 9; i++) {
      const pm = new THREE.Mesh(new THREE.CircleGeometry(0.07, 5), petalMat);
      pm.scale.set(1, 0.5, 1);
      pm.userData['a'] = (i / 9) * Math.PI * 2;
      petals.add(pm);
    }
    this.addPart('petals', petals);

    // veil (wanderer): a long trailing cloth
    const veilGeo = new THREE.PlaneGeometry(0.7, 2.2, 4, 12);
    veilGeo.translate(0, -1.1, 0);
    const veil = new THREE.Mesh(veilGeo, new THREE.MeshBasicMaterial({ color: '#b8c6dc', transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    veil.position.set(0, 1.6, -0.35);
    veil.rotation.x = 0.5;
    this.addPart('veil', veil);

    // masks (trickster)
    const masks = new THREE.Group();
    const maskMat = new THREE.MeshStandardMaterial({ color: '#e8e2d6', emissive: new THREE.Color('#b48cff'), emissiveIntensity: 0.3, roughness: 0.4, side: THREE.DoubleSide });
    for (let i = 0; i < 3; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8, 0, Math.PI * 2, 0, Math.PI / 2), maskMat);
      m.rotation.x = -Math.PI / 2;
      m.userData['a'] = (i / 3) * Math.PI * 2;
      masks.add(m);
    }
    this.addPart('masks', masks);

    // trail
    const tN = 48;
    this.trailPos = new Float32Array(tN * 3);
    const tg = new THREE.BufferGeometry(); tg.setAttribute('position', new THREE.BufferAttribute(this.trailPos, 3));
    this.trail = new THREE.Points(tg, new THREE.PointsMaterial({ color: '#9fefff', size: 0.16, map: glowDot(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.trail.frustumCulled = false;
    scene.add(this.trail);

    this.light = new THREE.PointLight('#9fefff', 3.5, 9, 2);
    this.light.position.y = 1.3;
    this.root.add(this.light);
    scene.add(this.root);
  }

  private addPart(name: string, obj: THREE.Object3D): void {
    obj.scale.setScalar(0.001);
    obj.visible = false;
    this.bodyPivot.add(obj);
    this.parts[name] = { obj, target: 0, current: 0 };
  }

  /** Visibility to mortals (0..1): feeds the Belief Engine's clarity. */
  get visibility(): number { return 0.45 + this.stage * 0.25; }

  applyForm(form: FormState): void {
    this.stage = form.stage;
    for (const [name, p] of Object.entries(this.parts)) p.target = form.parts.includes(name) ? 1 : 0;
    // tint = blend of dominant aspects
    const c = new THREE.Color(0, 0, 0);
    const doms = form.dominant.length ? form.dominant : ['none'];
    doms.forEach((a, i) => c.add((ASPECT_TINT[a] ?? ASPECT_TINT['none']!).clone().multiplyScalar(i === 0 ? 0.6 : 0.4 / Math.max(1, doms.length - 1))));
    if (form.stage === 0) c.copy(ASPECT_TINT['none']!);
    this.tintTarget.copy(c);
    const terror = form.parts.includes('horns');
    this.eyeMat.color.set(terror ? '#ff2a2a' : form.parts.includes('halo') ? '#fff2c0' : '#e8ffff');
    this.eyes.forEach((e) => e.scale.set(1.3, terror ? 0.32 : 0.6, 0.6));
  }

  triggerPulse(): void { this.pulse = 1; }

  /** Body language for a strike: twist into the swing, lean in, flare the core. */
  strike(heavy: boolean, step: number, dur: number): void {
    this.strikeT = 0; this.strikeDur = dur; this.strikeHeavy = heavy;
    this.strikeSide = heavy ? 0 : step === 1 ? -1 : 1;
    this.pulse = Math.max(this.pulse, heavy ? 0.9 : 0.35);
  }

  hurt(): void { this.hurtT = 0.5; }

  update(dt: number, time: number, speed: number, lean: number, grounded: boolean): void {
    this.coreU['uTime']!.value = time;
    this.shroudU['uTime']!.value = time;
    this.shroudU['uSpeed']!.value = Math.min(1, speed / 9);
    this.tint.lerp(this.tintTarget, Math.min(1, dt * 1.5));
    this.stageVis += ((0.4 + this.stage * 0.3) - this.stageVis) * Math.min(1, dt * 1.2);
    this.coreU['uVis']!.value = this.stageVis;
    this.shroudU['uVis']!.value = this.stageVis;
    this.pulse = Math.max(0, this.pulse - dt * 1.6);
    this.coreU['uPulse']!.value = this.pulse;
    this.hurtT = Math.max(0, this.hurtT - dt);
    const flicker = this.hurtT > 0 ? (Math.sin(time * 70) > 0 ? 0.35 : 1) : 1;
    const solid = (1 - this.dissolve) * flicker;
    this.coreU['uVis']!.value = this.stageVis * solid;
    this.shroudU['uVis']!.value = this.stageVis * solid;
    this.eyeMat.opacity += ((this.stage > 0 ? 0.95 : 0.25) - this.eyeMat.opacity) * Math.min(1, dt * 2);
    (this.trail.material as THREE.PointsMaterial).color.copy(this.tint);
    this.light.color.copy(this.tint);
    this.light.intensity = (2.2 + this.stage * 1.3) * (1 + this.pulse * 3);

    const bob = Math.sin(time * 2.1) * 0.08 * (grounded ? 1 : 0.3);
    this.bodyPivot.position.y = bob;
    this.bodyPivot.rotation.x = -Math.min(0.35, speed * 0.035);
    this.bodyPivot.rotation.z = lean * 0.25;
    this.bodyPivot.rotation.y = 0;
    if (this.strikeT < this.strikeDur) {
      this.strikeT += dt;
      const k = Math.min(1, this.strikeT / this.strikeDur);
      // anticipation → snap → settle
      const swing = k < 0.3 ? -k / 0.3 : k < 0.55 ? -1 + (k - 0.3) / 0.25 * 2 : 1 - (k - 0.55) / 0.45;
      if (this.strikeHeavy) { this.bodyPivot.rotation.x = swing * 0.55; this.bodyPivot.position.y = bob + Math.max(0, -swing) * 0.25; }
      else { this.bodyPivot.rotation.y = this.strikeSide * swing * 0.9; this.bodyPivot.rotation.x = -Math.abs(swing) * 0.3; }
    }
    if (this.hurtT > 0.3) this.bodyPivot.rotation.x = 0.35;
    const s = (0.9 + this.stage * 0.08) * (1 + this.dissolve * 0.6);
    this.bodyPivot.scale.setScalar(s);
    this.light.intensity *= 1 - this.dissolve;

    for (const [name, p] of Object.entries(this.parts)) {
      p.current += (p.target - p.current) * Math.min(1, dt * 0.9);
      p.obj.visible = p.current > 0.01;
      if (!p.obj.visible) continue;
      p.obj.scale.setScalar(Math.max(0.001, p.current));
      if (name === 'halo') p.obj.rotation.z = time * 0.4;
      if (name === 'petals' || name === 'masks') {
        p.obj.children.forEach((c, i) => {
          const a = (c.userData['a'] as number) + time * (name === 'petals' ? 0.7 : 0.4);
          c.position.set(Math.cos(a) * 0.85, 1.2 + Math.sin(time * 1.3 + i) * 0.2, Math.sin(a) * 0.85);
          if (name === 'masks') c.lookAt(0, 1.2, 0);
          else c.rotation.set(time + i, time * 0.7, 0);
        });
      }
      if (name === 'embers') {
        const pos = this.embers.geometry.attributes['position'] as THREE.BufferAttribute;
        for (let i = 0; i < pos.count; i++) {
          let y = pos.getY(i) + dt * (0.6 + (i % 5) * 0.2);
          if (y > 2.6) y = 0.1;
          pos.setY(i, y);
          pos.setX(i, pos.getX(i) + Math.sin(time * 2 + i) * dt * 0.2);
        }
        pos.needsUpdate = true;
      }
    }

    // trail of light left behind as the spirit moves
    this.trailTimer += dt;
    if (this.trailTimer > 0.04) {
      this.trailTimer = 0;
      const wp = this.root.position;
      const i = this.trailHead;
      this.trailPos[i * 3] = wp.x + (Math.random() - 0.5) * 0.4;
      this.trailPos[i * 3 + 1] = wp.y + 0.6 + Math.random() * 0.9;
      this.trailPos[i * 3 + 2] = wp.z + (Math.random() - 0.5) * 0.4;
      this.trailHead = (i + 1) % (this.trailPos.length / 3);
      (this.trail.geometry.attributes['position'] as THREE.BufferAttribute).needsUpdate = true;
    }
    for (let i = 0; i < this.trailPos.length / 3; i++) this.trailPos[i * 3 + 1]! += dt * 0.25;
  }
}

let dotTex: THREE.CanvasTexture | null = null;
function glowDot(): THREE.CanvasTexture {
  if (dotTex) return dotTex;
  const c = document.createElement('canvas');
  c.width = c.height = 32;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(16, 16, 0, 16, 16, 16);
  g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.35, 'rgba(255,255,255,0.5)'); g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 32, 32);
  dotTex = new THREE.CanvasTexture(c);
  return dotTex;
}
