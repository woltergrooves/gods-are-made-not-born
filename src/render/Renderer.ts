// Renderer, post-processing chain, quality presets and dynamic resolution.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export type Quality = 'low' | 'medium' | 'high';

export interface QualityPreset {
  maxPixelRatio: number;
  minPixelRatio: number;
  shadowMap: number;
  shadows: boolean;
  bloom: boolean;
  post: boolean;
  terrainSegments: number;
  trees: number;
  grass: number;
  rain: number;
  antialias: boolean;
}

export const PRESETS: Record<Quality, QualityPreset> = {
  low: { maxPixelRatio: 1.0, minPixelRatio: 0.6, shadowMap: 512, shadows: false, bloom: false, post: false, terrainSegments: 150, trees: 240, grass: 0, rain: 2500, antialias: false },
  medium: { maxPixelRatio: 1.5, minPixelRatio: 0.7, shadowMap: 1024, shadows: true, bloom: true, post: true, terrainSegments: 210, trees: 430, grass: 5500, rain: 5000, antialias: false },
  high: { maxPixelRatio: 2.0, minPixelRatio: 0.8, shadowMap: 2048, shadows: true, bloom: true, post: true, terrainSegments: 280, trees: 700, grass: 14000, rain: 9000, antialias: true },
};

export function detectDefaultQuality(): Quality {
  const ua = navigator.userAgent;
  const mobile = /iPhone|iPad|iPod|Android/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const cores = navigator.hardwareConcurrency || 4;
  if (mobile) return cores >= 6 ? 'medium' : 'low';
  return cores >= 8 ? 'high' : 'medium';
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null as THREE.Texture | null },
    uTime: { value: 0 },
    uVignette: { value: 1.0 },
    uGrain: { value: 0.016 },
    uFlash: { value: 0 },
    uDread: { value: 0 },
    uResolution: { value: new THREE.Vector2(1, 1) },
  },
  vertexShader: /* glsl */`
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */`
    uniform sampler2D tDiffuse; uniform float uTime, uVignette, uGrain, uFlash, uDread; uniform vec2 uResolution;
    varying vec2 vUv;
    float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233))) * 43758.5453); }
    void main(){
      vec2 c = vUv - 0.5;
      float r2 = dot(c, c);
      // subtle chromatic fringe toward the edges
      vec2 off = c * r2 * 0.012;
      vec3 col;
      col.r = texture2D(tDiffuse, vUv + off).r;
      col.g = texture2D(tDiffuse, vUv).g;
      col.b = texture2D(tDiffuse, vUv - off).b;
      // painterly split-tone: cool shadows, warm highlights
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      vec3 shadowTint = vec3(0.86, 0.95, 1.12);
      vec3 hiTint = vec3(1.08, 1.0, 0.9);
      col *= mix(shadowTint, hiTint, smoothstep(0.05, 0.9, l));
      // dread desaturates and bruises the image
      col = mix(col, vec3(l) * vec3(0.85, 0.9, 1.15), uDread * 0.45);
      col += uFlash * vec3(0.55, 0.62, 0.8) * (0.4 + l);
      float vig = smoothstep(0.85, 0.2, r2 * (1.6 + uDread * 0.8)) ;
      col *= mix(1.0, vig, uVignette);
      float g = hash(vUv * uResolution + fract(uTime) * 91.7) - 0.5;
      col += g * uGrain * (0.35 + (1.0 - l));
      gl_FragColor = vec4(max(col, 0.0), 1.0);
    }
  `,
};

export class GameRenderer {
  renderer: THREE.WebGLRenderer;
  composer: EffectComposer | null = null;
  bloom: UnrealBloomPass | null = null;
  grade: ShaderPass | null = null;
  preset: QualityPreset;
  pixelRatio: number;
  private frameTimes: number[] = [];
  private lastAdjust = 0;
  fps = 60;

  constructor(public canvas: HTMLCanvasElement, public quality: Quality) {
    this.preset = PRESETS[quality];
    this.renderer = new THREE.WebGLRenderer({
      canvas, antialias: this.preset.antialias, powerPreference: 'high-performance', stencil: false,
    });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.35;
    this.renderer.shadowMap.enabled = this.preset.shadows;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.pixelRatio = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio);
    this.renderer.setPixelRatio(this.pixelRatio);
  }

  setup(scene: THREE.Scene, camera: THREE.PerspectiveCamera): void {
    if (!this.preset.post) { this.composer = null; return; }
    const size = this.renderer.getSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(size.x, size.y, { type: THREE.HalfFloatType });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(scene, camera));
    if (this.preset.bloom) {
      this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x / 2, size.y / 2), 0.55, 0.6, 0.82);
      this.composer.addPass(this.bloom);
    }
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.composer.addPass(new OutputPass());
    this.resize();
  }

  resize(): void {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.canvas.style.width = `${w}px`; this.canvas.style.height = `${h}px`;
    if (this.composer) {
      this.composer.setPixelRatio(this.pixelRatio);
      this.composer.setSize(w, h);
    }
    if (this.grade) (this.grade.uniforms['uResolution']!.value as THREE.Vector2).set(w, h);
  }

  render(scene: THREE.Scene, camera: THREE.Camera, dt: number, time: number, flash: number, dread: number): void {
    if (this.grade) {
      this.grade.uniforms['uTime']!.value = time;
      this.grade.uniforms['uFlash']!.value = flash;
      this.grade.uniforms['uDread']!.value = dread;
    }
    if (this.composer) this.composer.render(dt); else this.renderer.render(scene, camera);
    this.trackPerformance(dt, time);
  }

  /** Lower or raise render resolution to hold ~30+ FPS. */
  private trackPerformance(dt: number, time: number): void {
    this.frameTimes.push(dt);
    if (this.frameTimes.length > 90) this.frameTimes.shift();
    const avg = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
    this.fps = 1 / Math.max(avg, 1e-3);
    if (time - this.lastAdjust < 2.5 || this.frameTimes.length < 60) return;
    const maxPR = Math.min(window.devicePixelRatio || 1, this.preset.maxPixelRatio);
    let next = this.pixelRatio;
    if (avg > 1 / 28) next = Math.max(this.preset.minPixelRatio, this.pixelRatio - 0.1);
    else if (avg < 1 / 50) next = Math.min(maxPR, this.pixelRatio + 0.05);
    if (Math.abs(next - this.pixelRatio) > 0.01) {
      this.pixelRatio = next;
      this.renderer.setPixelRatio(next);
      this.resize();
      this.lastAdjust = time;
    }
  }
}
