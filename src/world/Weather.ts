// Rain (GPU-animated streaks around the camera), lightning, river mist and spirit motes.

import * as THREE from 'three';
import { mulberry32 } from './noise.js';
import { riverX, heightAt, PLACES } from './layout.js';

export class Weather {
  rain: THREE.LineSegments;
  mist: THREE.Points;
  motes: THREE.Points;
  flash = 0;
  private nextStrike = 6;
  private strikeQueue: number[] = [];
  intensity = 1;  // 0..1 storm strength
  onThunder: ((delay: number, power: number) => void) | null = null;
  private rainU: Record<string, THREE.IUniform>;
  private moteU: Record<string, THREE.IUniform>;

  constructor(scene: THREE.Scene, drops: number) {
    const rand = mulberry32(9);
    const pos = new Float32Array(drops * 6);
    const seed = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) {
      const x = rand() * 44 - 22, y = rand() * 26, z = rand() * 44 - 22, s = rand();
      pos.set([x, y, z, x, y, z], i * 6);
      seed[i * 2] = s; seed[i * 2 + 1] = 1; // second vertex = tail
    }
    const tail = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) { tail[i * 2] = 0; tail[i * 2 + 1] = 1; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const sd = new Float32Array(drops * 2);
    for (let i = 0; i < drops; i++) { const s = rand(); sd[i * 2] = s; sd[i * 2 + 1] = s; }
    g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    g.setAttribute('aTail', new THREE.BufferAttribute(tail, 1));
    this.rainU = { uTime: { value: 0 }, uCam: { value: new THREE.Vector3() }, uIntensity: { value: 1 }, uFlash: { value: 0 } };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.rainU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`
        uniform float uTime; uniform vec3 uCam; attribute float aSeed; attribute float aTail; varying float vA;
        void main(){
          vec3 p = position;
          float fall = 21.0 + aSeed * 8.0;
          p.y = mod(p.y - uTime * fall, 26.0);
          p.x += uTime * 2.2; // wind slant
          vec3 w = p;
          w.x = mod(w.x - uCam.x + 22.0, 44.0) - 22.0 + uCam.x;
          w.z = mod(w.z - uCam.z + 22.0, 44.0) - 22.0 + uCam.z;
          w.y += uCam.y - 10.0;
          w += aTail * vec3(-0.08, 0.32 + aSeed * 0.22, 0.0);
          vA = (0.05 + aSeed * 0.11) * (1.0 - aTail * 0.85);
          gl_Position = projectionMatrix * viewMatrix * vec4(w, 1.0);
        }`,
      fragmentShader: `uniform float uIntensity, uFlash; varying float vA; void main(){ gl_FragColor = vec4(vec3(0.62,0.7,0.82) * (1.0 + uFlash * 2.0), vA * uIntensity); }`,
    });
    this.rain = new THREE.LineSegments(g, mat);
    this.rain.frustumCulled = false;
    this.rain.renderOrder = 5;
    scene.add(this.rain);

    // Low mist banks over the river and in the forest hollows.
    const mN = 160;
    const mp = new Float32Array(mN * 3);
    for (let i = 0; i < mN; i++) {
      const z = -110 + rand() * 230;
      const x = rand() < 0.7 ? riverX(z) + (rand() - 0.5) * 22 : -80 + rand() * 70;
      mp.set([x, heightAt(x, z) + 0.6 + rand() * 1.6, z], i * 3);
    }
    const mg = new THREE.BufferGeometry();
    mg.setAttribute('position', new THREE.BufferAttribute(mp, 3));
    const mistTex = softDot(64, 'rgba(150,170,190,0.55)');
    this.mist = new THREE.Points(mg, new THREE.PointsMaterial({ size: 14, map: mistTex, transparent: true, depthWrite: false, opacity: 0.12, color: '#7d90a6', sizeAttenuation: true, fog: true }));
    this.mist.renderOrder = 4;
    scene.add(this.mist);

    // Spirit motes: drifting lights in the forest and around the shrine.
    const nM = 220;
    const mo = new Float32Array(nM * 3); const ph = new Float32Array(nM);
    for (let i = 0; i < nM; i++) {
      const near = rand() < 0.35;
      const x = near ? PLACES.shrine.x + (rand() - 0.5) * 30 : -90 + rand() * 90;
      const z = near ? PLACES.shrine.z + (rand() - 0.5) * 30 : -100 + rand() * 150;
      mo.set([x, heightAt(x, z) + 0.5 + rand() * 3, z], i * 3);
      ph[i] = rand() * 100;
    }
    const og = new THREE.BufferGeometry();
    og.setAttribute('position', new THREE.BufferAttribute(mo, 3));
    og.setAttribute('aPhase', new THREE.BufferAttribute(ph, 1));
    this.moteU = { uTime: { value: 0 }, uMap: { value: softDot(32, 'rgba(255,255,255,1)') }, uCalm: { value: 0.3 } };
    this.motes = new THREE.Points(og, new THREE.ShaderMaterial({
      uniforms: this.moteU, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime, uCalm; attribute float aPhase; varying float vA;
        void main(){ vec3 p = position; float t = uTime * 0.35 + aPhase;
          p += vec3(sin(t)*0.8, sin(t*1.7)*0.5, cos(t*0.8)*0.8);
          vec4 mv = modelViewMatrix * vec4(p,1.0);
          vA = (0.35 + 0.65 * (sin(uTime * 2.0 + aPhase * 3.0) * 0.5 + 0.5)) * (0.4 + uCalm);
          gl_PointSize = min(180.0 / -mv.z, 18.0); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `uniform sampler2D uMap; varying float vA; void main(){ vec4 t = texture2D(uMap, gl_PointCoord); gl_FragColor = vec4(vec3(0.6,0.95,0.85) * t.a * vA, t.a * vA); }`,
    }));
    this.motes.frustumCulled = false;
    scene.add(this.motes);
  }

  setCalm(c: number): void { this.moteU['uCalm']!.value = c; }

  /** Force a lightning strike (used by story beats). */
  strike(power = 1): void {
    this.strikeQueue.push(0, 0.12, 0.3);
    this.onThunder?.(0.6 + Math.random() * 1.2, power);
  }

  update(dt: number, time: number, cam: THREE.Vector3): void {
    this.rainU['uTime']!.value = time;
    (this.rainU['uCam']!.value as THREE.Vector3).copy(cam);
    this.rainU['uIntensity']!.value = this.intensity;
    this.rainU['uFlash']!.value = this.flash;
    this.moteU['uTime']!.value = time;
    this.rain.visible = this.intensity > 0.02;
    // lightning schedule
    this.nextStrike -= dt * (0.4 + this.intensity * 0.6);
    if (this.nextStrike <= 0 && this.intensity > 0.3) {
      this.nextStrike = 9 + Math.random() * 16;
      this.strike(0.6 + Math.random() * 0.4);
    }
    this.strikeQueue = this.strikeQueue.map((t) => t - dt);
    let f = 0;
    for (const t of this.strikeQueue) if (t <= 0 && t > -0.14) f = Math.max(f, 1 + t * 7);
    this.strikeQueue = this.strikeQueue.filter((t) => t > -0.2);
    this.flash = Math.max(f * this.intensity, this.flash - dt * 6);
  }
}

function softDot(size: number, color: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, color); g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, size, size);
  const t = new THREE.CanvasTexture(c);
  return t;
}
