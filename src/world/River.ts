// The river: flowing water shader, flood rise, waterfall and plunge pool.

import * as THREE from 'three';
import { riverX, riverHalfWidth, waterY, WATERFALL_Z, PLACES } from './layout.js';
import { FOG_COLOR, MOON_DIR } from './Sky.js';

const NOISE_GLSL = /* glsl */`
  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
  float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
    return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
`;

export class River {
  group = new THREE.Group();
  uniforms: Record<string, THREE.IUniform>;
  flood = 0;           // 0..1 visual flood state
  floodTarget = 0;
  /** Extra water height at full flood (m). */
  static FLOOD_RISE = 1.15;

  constructor(fogDensity: number) {
    this.uniforms = {
      uTime: { value: 0 },
      uFlood: { value: 0 },
      uMoonDir: { value: MOON_DIR },
      uFog: { value: FOG_COLOR },
      uFogDensity: { value: fogDensity },
      uRock: { value: new THREE.Vector2(PLACES.mioRock.x, PLACES.mioRock.z) },
      uWeirZ: { value: PLACES.weirZ },
      uWeirIntact: { value: 1 },
      uFlash: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, transparent: true, depthWrite: false,
      vertexShader: /* glsl */`
        uniform float uTime, uFlood;
        attribute float aAcross; attribute float aAlong;
        varying vec3 vW; varying float vAcross; varying float vAlong; varying float vDepth;
        void main(){
          vec3 p = position;
          float rise = uFlood * ${River.FLOOD_RISE.toFixed(2)};
          p.y += rise + sin(aAlong * 0.9 - uTime * 2.4) * 0.03 * (1.0 + uFlood * 3.0);
          vAcross = aAcross; vAlong = aAlong;
          vec4 w = modelMatrix * vec4(p, 1.0);
          vW = w.xyz;
          vec4 mv = viewMatrix * w; vDepth = -mv.z;
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime, uFlood, uFogDensity, uWeirZ, uWeirIntact, uFlash;
        uniform vec3 uMoonDir, uFog; uniform vec2 uRock;
        varying vec3 vW; varying float vAcross; varying float vAlong; varying float vDepth;
        ${NOISE_GLSL}
        float ripple(vec2 p, float t){
          vec2 cell = floor(p); vec2 f = fract(p) - 0.5;
          float h = hash(cell);
          float ph = fract(t * 0.9 + h);
          float r = length(f - (vec2(hash(cell+3.1), hash(cell+7.7)) - 0.5) * 0.5);
          return smoothstep(0.05, 0.0, abs(r - ph * 0.45)) * (1.0 - ph);
        }
        void main(){
          float speed = 1.4 + uFlood * 2.6;
          vec2 flow = vec2(vW.x, vAlong);
          float n1 = vnoise(flow * vec2(0.9, 0.35) - vec2(0.0, uTime * speed));
          float n2 = vnoise(flow * vec2(2.3, 0.9) - vec2(0.0, uTime * speed * 1.7) + 4.0);
          float n3 = vnoise(flow * vec2(5.0, 2.0) - vec2(uTime * 0.3, uTime * speed * 2.6));
          vec3 nrm = normalize(vec3((n1 - 0.5) * 0.6 + (n3 - 0.5) * 0.25, 1.0, (n2 - 0.5) * 0.6));
          float rip = ripple(vW.xz * 1.6, uTime) + ripple(vW.xz * 2.3 + 11.0, uTime * 1.13);
          nrm.xz += rip * 0.35;
          nrm = normalize(nrm);
          vec3 V = normalize(cameraPosition - vW);
          float fres = pow(1.0 - max(dot(nrm, V), 0.0), 4.0);
          vec3 deep = mix(vec3(0.012, 0.035, 0.045), vec3(0.06, 0.05, 0.035), uFlood * 0.8);
          vec3 sky = uFog * 0.85 + vec3(0.01,0.015,0.03);
          vec3 col = mix(deep, sky, 0.12 + fres * 0.7);
          vec3 R = reflect(-V, nrm);
          float spec = pow(max(dot(R, uMoonDir), 0.0), 220.0) * 2.4 + pow(max(dot(R, uMoonDir), 0.0), 18.0) * 0.12;
          col += vec3(0.75, 0.82, 0.95) * spec;
          // foam: banks, the rock, the weir, and flood turbulence
          float edge = smoothstep(0.78, 1.0, abs(vAcross));
          float rockD = length(vW.xz - uRock);
          float rockFoam = smoothstep(2.6 + uFlood * 0.8, 0.9, rockD);
          float weirFoam = smoothstep(4.0, 0.0, abs(vW.z - uWeirZ - 1.5)) * uWeirIntact;
          float foamN = vnoise(flow * vec2(3.0, 1.2) - vec2(0.0, uTime * speed * 1.4));
          float foam = clamp((edge * 0.6 + rockFoam + weirFoam * 0.8 + uFlood * 0.1) * smoothstep(0.45, 0.85, foamN + n3 * 0.3), 0.0, 1.0);
          col = mix(col, mix(vec3(0.5, 0.56, 0.6), vec3(0.36, 0.33, 0.28), uFlood), foam * 0.7);
          col += uFlash * 0.25 * (0.3 + fres);
          float alpha = mix(0.82, 0.95, fres) * smoothstep(1.0, 0.92, abs(vAcross));
          float fog = 1.0 - exp(-uFogDensity * uFogDensity * vDepth * vDepth);
          col = mix(col, uFog, fog);
          gl_FragColor = vec4(col, alpha);
        }
      `,
    });
    const lower = ribbon(WATERFALL_Z + 1.5, 160, 1.4);
    const upper = ribbon(-175, WATERFALL_Z - 5, 1.6);
    for (const g of [lower, upper]) {
      const m = new THREE.Mesh(g, mat);
      m.renderOrder = 2;
      this.group.add(m);
    }
    this.group.add(buildWaterfall(this.uniforms));
  }

  setWeirIntact(intact: boolean): void { this.uniforms['uWeirIntact']!.value = intact ? 1 : 0; }

  /** Current water surface height (m) at z, including flood rise. */
  surfaceAt(z: number): number { return waterY(z) + this.flood * River.FLOOD_RISE; }

  update(dt: number, time: number, flash: number): void {
    this.flood += (this.floodTarget - this.flood) * Math.min(1, dt * 0.35);
    this.uniforms['uTime']!.value = time;
    this.uniforms['uFlood']!.value = this.flood;
    this.uniforms['uFlash']!.value = flash;
  }
}

function ribbon(z0: number, z1: number, step: number): THREE.BufferGeometry {
  const across = 10;
  const rows = Math.ceil((z1 - z0) / step);
  const pos: number[] = []; const ac: number[] = []; const al: number[] = []; const idx: number[] = [];
  for (let r = 0; r <= rows; r++) {
    const z = z0 + (r / rows) * (z1 - z0);
    const cx = riverX(z), hw = riverHalfWidth(z) + 2.6;
    for (let a = 0; a <= across; a++) {
      const t = (a / across) * 2 - 1;
      pos.push(cx + t * hw, waterY(z), z);
      ac.push(t); al.push(z);
    }
  }
  for (let r = 0; r < rows; r++) for (let a = 0; a < across; a++) {
    const i = r * (across + 1) + a;
    idx.push(i, i + across + 1, i + 1, i + 1, i + across + 1, i + across + 2);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('aAcross', new THREE.Float32BufferAttribute(ac, 1));
  g.setAttribute('aAlong', new THREE.Float32BufferAttribute(al, 1));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function buildWaterfall(uniforms: Record<string, THREE.IUniform>): THREE.Object3D {
  const g = new THREE.Group();
  const z = WATERFALL_Z;
  const cx = riverX(z);
  const width = 7.5;
  const top = waterY(z - 6) + 0.1, bottom = -0.3;
  const shape = new THREE.PlaneGeometry(width, top - bottom, 12, 16);
  const p = shape.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const y = p.getY(i); const t = 1 - (y + (top - bottom) / 2) / (top - bottom); // 0 top -> 1 bottom
    p.setZ(i, -Math.pow(1 - t, 2.2) * 3.2 + t * 1.2);
  }
  shape.computeVertexNormals();
  const mat = new THREE.ShaderMaterial({
    uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: `varying vec2 vUv; varying vec3 vW; void main(){ vUv = uv; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: `uniform float uTime, uFlood, uFlash; uniform vec3 uFog; varying vec2 vUv; varying vec3 vW;
      ${NOISE_GLSL}
      void main(){
        float s = vnoise(vec2(vUv.x * 18.0, vUv.y * 3.0 + uTime * (3.5 + uFlood * 2.0)));
        float s2 = vnoise(vec2(vUv.x * 40.0, vUv.y * 6.0 + uTime * 6.0));
        float streak = smoothstep(0.3, 0.9, s * 0.7 + s2 * 0.5);
        vec3 col = mix(vec3(0.05,0.08,0.1), vec3(0.62,0.68,0.72), streak);
        col = mix(col, vec3(0.75), smoothstep(0.25, 0.0, vUv.y) * 0.6);
        col += uFlash * 0.3;
        float a = (0.55 + streak * 0.4) * smoothstep(0.0, 0.08, vUv.x) * smoothstep(1.0, 0.92, vUv.x);
        gl_FragColor = vec4(col, a);
      }`,
  });
  const fall = new THREE.Mesh(shape, mat);
  fall.position.set(cx, (top + bottom) / 2, z - 1.0);
  fall.renderOrder = 3;
  g.add(fall);
  return g;
}
