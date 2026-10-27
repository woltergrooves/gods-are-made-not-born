// Procedurally painted textures (original, generated at load time — no external assets).

import * as THREE from 'three';
import { Simplex2, mulberry32 } from './noise.js';

const noise = new Simplex2(101);

function canvas(size: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return [c, c.getContext('2d')!];
}

/** Tileable noise sampled on a torus so textures repeat seamlessly. */
function tileNoise(u: number, v: number, freq: number, oct = 4): number {
  const a = u * Math.PI * 2, b = v * Math.PI * 2;
  const r = freq / (Math.PI * 2);
  // Map to 4D-ish by combining two 2D samples on circles.
  const x1 = Math.cos(a) * r, y1 = Math.sin(a) * r;
  const x2 = Math.cos(b) * r, y2 = Math.sin(b) * r;
  return (noise.fbm(x1 + x2 * 0.7 + 13.1, y1 - y2 * 0.7, oct) + noise.fbm(x2 + 7.7, y2 + x1 * 0.3 + 3.3, oct)) * 0.5;
}

function toTexture(c: HTMLCanvasElement, repeat = 1, srgb = true): THREE.CanvasTexture {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.needsUpdate = true;
  return t;
}

function paint(size: number, fn: (u: number, v: number) => [number, number, number]): HTMLCanvasElement {
  const [c, ctx] = canvas(size);
  const img = ctx.createImageData(size, size);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [r, g, b] = fn(x / size, y / size);
      const i = (y * size + x) * 4;
      img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export interface TextureSet {
  ground: THREE.CanvasTexture;
  wood: THREE.CanvasTexture;
  woodDark: THREE.CanvasTexture;
  plaster: THREE.CanvasTexture;
  roofTile: THREE.CanvasTexture;
  thatch: THREE.CanvasTexture;
  bark: THREE.CanvasTexture;
  stone: THREE.CanvasTexture;
  shoji: THREE.CanvasTexture;
  paper: THREE.CanvasTexture;
}

export function makeTextures(quality: 'low' | 'medium' | 'high'): TextureSet {
  const S = quality === 'low' ? 128 : quality === 'medium' ? 256 : 512;

  const ground = paint(S, (u, v) => {
    const n = tileNoise(u, v, 18, 5) * 0.5 + 0.5;
    const m = tileNoise(u + 0.3, v, 60, 2) * 0.5 + 0.5;
    const g = 150 + n * 80 + m * 25;
    return [g, g, g];
  });

  const woodC = (base: [number, number, number], dark: number) => paint(S, (u, v) => {
    const plank = Math.floor(v * 6);
    const pv = (v * 6) % 1;
    const grain = Math.sin((u * 40 + tileNoise(u, v + plank * 0.13, 6, 3) * 6) * Math.PI) * 0.5 + 0.5;
    const fiber = tileNoise(u * 0.25, v, 90, 2) * 0.5 + 0.5;
    const seam = pv < 0.035 || pv > 0.965 ? 0.45 : 1;
    const k = (0.72 + grain * 0.16 + fiber * 0.12) * seam * (0.92 + (mulberry32(plank + 3)() * 0.16)) * dark;
    return [base[0] * k, base[1] * k, base[2] * k];
  });

  const plaster = paint(S, (u, v) => {
    const n = tileNoise(u, v, 8, 5) * 0.5 + 0.5;
    const stain = Math.max(0, tileNoise(u, v * 0.5, 4, 3)) * (0.4 + v * 0.8);
    const k = 0.82 + n * 0.12 - stain * 0.35;
    return [222 * k, 214 * k, 196 * k];
  });

  const roofTile = paint(S, (u, v) => {
    const rows = 10, cols = 8;
    const rv = (v * rows) % 1;
    const cu = (u * cols + (Math.floor(v * rows) % 2) * 0.5) % 1;
    const ridge = Math.pow(Math.sin(cu * Math.PI), 0.7);
    const lip = rv > 0.86 ? 0.55 : 1;
    const n = tileNoise(u, v, 20, 3) * 0.5 + 0.5;
    const k = (0.45 + ridge * 0.45) * lip * (0.85 + n * 0.25);
    return [70 * k + 8, 74 * k + 8, 82 * k + 10];
  });

  const thatch = paint(S, (u, v) => {
    const s = tileNoise(u * 0.15, v, 140, 2) * 0.5 + 0.5;
    const n = tileNoise(u, v, 10, 3) * 0.5 + 0.5;
    const k = 0.5 + s * 0.4 + n * 0.2;
    return [128 * k, 104 * k, 66 * k];
  });

  const bark = paint(S, (u, v) => {
    const f = tileNoise(u, v * 0.12, 30, 3) * 0.5 + 0.5;
    const crack = Math.pow(Math.abs(Math.sin((u * 14 + tileNoise(u, v, 4, 2) * 2) * Math.PI)), 6);
    const k = 0.55 + f * 0.4 - crack * 0.35;
    return [112 * k, 66 * k, 44 * k];
  });

  const stone = paint(S, (u, v) => {
    const n = tileNoise(u, v, 10, 5) * 0.5 + 0.5;
    const moss = Math.max(0, tileNoise(u + 0.5, v, 6, 4) + 0.1 - v * 0.2);
    const k = 0.55 + n * 0.4;
    const g = [118 * k, 118 * k, 112 * k];
    return [g[0]! * (1 - moss) + 52 * moss, g[1]! * (1 - moss) + 78 * moss, g[2]! * (1 - moss) + 40 * moss];
  });

  const [shojiC, sctx] = canvas(128);
  sctx.fillStyle = '#f3e2bd'; sctx.fillRect(0, 0, 128, 128);
  const grd = sctx.createRadialGradient(64, 64, 10, 64, 64, 90);
  grd.addColorStop(0, 'rgba(255,220,150,0.0)'); grd.addColorStop(1, 'rgba(120,70,20,0.35)');
  sctx.fillStyle = grd; sctx.fillRect(0, 0, 128, 128);
  sctx.strokeStyle = '#3a2516'; sctx.lineWidth = 3;
  for (let i = 0; i <= 4; i++) { sctx.beginPath(); sctx.moveTo(i * 32, 0); sctx.lineTo(i * 32, 128); sctx.stroke(); }
  for (let i = 0; i <= 6; i++) { sctx.beginPath(); sctx.moveTo(0, i * 21.3); sctx.lineTo(128, i * 21.3); sctx.stroke(); }

  const paper = paint(64, (u, v) => {
    const n = tileNoise(u, v, 12, 3) * 0.5 + 0.5;
    const rib = Math.abs(Math.sin(v * Math.PI * 9)) > 0.93 ? 0.7 : 1;
    const k = (0.85 + n * 0.15) * rib;
    return [255 * k, 236 * k, 200 * k];
  });

  return {
    ground: toTexture(ground, 1, false),
    wood: toTexture(woodC([150, 104, 70], 1)),
    woodDark: toTexture(woodC([92, 62, 44], 0.85)),
    plaster: toTexture(plaster),
    roofTile: toTexture(roofTile),
    thatch: toTexture(thatch),
    bark: toTexture(bark),
    stone: toTexture(stone),
    shoji: toTexture(shojiC),
    paper: toTexture(paper),
  };
}
