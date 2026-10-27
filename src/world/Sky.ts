// Storm sky dome with drifting clouds, a veiled moon and lightning; distant mountain layers.

import * as THREE from 'three';
import { Simplex2 } from './noise.js';

export const FOG_COLOR = new THREE.Color('#222f44');
export const MOON_DIR = new THREE.Vector3(-0.45, 0.62, -0.64).normalize();

export class Sky {
  mesh: THREE.Mesh;
  uniforms: Record<string, THREE.IUniform>;
  mountains: THREE.Group;

  constructor(scene: THREE.Scene) {
    this.uniforms = {
      uTime: { value: 0 },
      uMoonDir: { value: MOON_DIR.clone() },
      uFlash: { value: 0 },
      uStorm: { value: 1 },
      uFog: { value: FOG_COLOR.clone() },
      uDread: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, side: THREE.BackSide, depthWrite: false, fog: false,
      vertexShader: /* glsl */`
        varying vec3 vDir;
        void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }
      `,
      fragmentShader: /* glsl */`
        uniform float uTime, uFlash, uStorm, uDread; uniform vec3 uMoonDir, uFog; varying vec3 vDir;
        float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
        float vnoise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
          return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
        float fbm(vec2 p){ float s=0.0,a=0.5; for(int i=0;i<5;i++){ s+=a*vnoise(p); p=p*2.03+vec2(1.7,9.2); a*=0.5; } return s; }
        void main(){
          vec3 d = normalize(vDir);
          float h = clamp(d.y, -0.2, 1.0);
          vec3 zenith = mix(vec3(0.018,0.026,0.055), vec3(0.03,0.012,0.03), uDread);
          vec3 horizon = uFog * 1.05;
          vec3 col = mix(horizon, zenith, pow(smoothstep(-0.02, 0.75, h), 0.7));
          // stars through gaps
          vec2 sp = d.xz / max(d.y + 0.25, 0.1) * 60.0;
          float star = step(0.9965, hash(floor(sp))) * smoothstep(0.1, 0.5, h);
          // moon
          float md = max(dot(d, uMoonDir), 0.0);
          float disc = smoothstep(0.9993, 0.9996, md);
          float halo = pow(md, 180.0) * 0.9 + pow(md, 12.0) * 0.18;
          vec3 moonCol = vec3(0.78, 0.84, 0.95);
          // clouds
          vec2 cp = d.xz / max(d.y + 0.18, 0.06) * 1.4 + vec2(uTime * 0.012, uTime * 0.004);
          float c = fbm(cp);
          float c2 = fbm(cp * 2.1 - uTime * 0.01);
          float cloud = smoothstep(0.38 - uStorm * 0.12, 0.78, c * 0.75 + c2 * 0.35);
          float lit = pow(md, 6.0) * 0.6 + 0.08;
          vec3 cloudCol = mix(vec3(0.035,0.045,0.07), moonCol * 0.32, lit * (1.0 - c2 * 0.6));
          cloudCol += uFlash * vec3(0.5,0.55,0.75) * (0.6 + c2);
          col += moonCol * (disc * 1.6 + halo);
          col += star * 0.5 * (1.0 - cloud);
          col = mix(col, cloudCol, cloud * smoothstep(-0.05, 0.12, h));
          col = mix(uFog * 1.05, col, smoothstep(-0.05, 0.16, h));
          col += uFlash * 0.12;
          gl_FragColor = vec4(col, 1.0);
        }
      `,
    });
    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(900, 48, 24), mat);
    this.mesh.renderOrder = -10;
    this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    this.mountains = buildMountainLayers();
    scene.add(this.mountains);
  }

  update(time: number, flash: number, cameraPos: THREE.Vector3, dread: number): void {
    this.uniforms['uTime']!.value = time;
    this.uniforms['uFlash']!.value = flash;
    this.uniforms['uDread']!.value = dread;
    this.mesh.position.copy(cameraPos);
  }
}

/** Painterly silhouettes of far mountains — atmospheric perspective by depth. */
function buildMountainLayers(): THREE.Group {
  const g = new THREE.Group();
  const n = new Simplex2(55);
  const layers = [
    { r: 330, h: 95, tint: 0.55, seed: 0 },
    { r: 470, h: 150, tint: 0.72, seed: 3 },
    { r: 640, h: 210, tint: 0.86, seed: 7 },
  ];
  for (const L of layers) {
    const seg = 220;
    const pos: number[] = []; const idx: number[] = []; const shade: number[] = [];
    for (let i = 0; i <= seg; i++) {
      const a = (i / seg) * Math.PI * 2;
      const ridge = 0.35 + 0.65 * Math.pow(Math.abs(n.ridged(Math.cos(a) * 2.2 + L.seed, Math.sin(a) * 2.2, 5)), 1.4);
      const x = Math.cos(a) * L.r, z = Math.sin(a) * L.r;
      pos.push(x, -30, z, x, -30 + L.h * ridge, z);
      shade.push(0, 1);
    }
    for (let i = 0; i < seg; i++) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute('aShade', new THREE.Float32BufferAttribute(shade, 1));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uFog: { value: FOG_COLOR }, uTint: { value: L.tint }, uMoon: { value: MOON_DIR } },
      side: THREE.DoubleSide, fog: false, depthWrite: true,
      vertexShader: `attribute float aShade; varying float vS; varying vec3 vW; void main(){ vS = aShade; vW = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 uFog; uniform float uTint; uniform vec3 uMoon; varying float vS; varying vec3 vW;
        void main(){ vec3 base = vec3(0.02,0.03,0.045);
          float rim = pow(max(dot(normalize(vec3(vW.x,0.0,vW.z)), -normalize(vec3(uMoon.x,0.0,uMoon.z))),0.0),3.0) * vS * 0.15;
          vec3 c = mix(base, uFog * 0.95, uTint) + rim * vec3(0.5,0.6,0.8);
          c = mix(uFog * 1.03, c, smoothstep(0.0, 0.35, vS));
          gl_FragColor = vec4(c,1.0); }`,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = -5;
    g.add(m);
  }
  return g;
}
