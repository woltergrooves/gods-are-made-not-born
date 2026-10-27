// Amahara Valley — authored layout plus the analytic height field.
// The same functions drive mesh generation, collision, placement and AI.

import { Simplex2, smoothstep, lerp, clamp } from './noise.js';

export const WORLD = { minX: -175, maxX: 175, minZ: -175, maxZ: 160 };
const sx = new Simplex2(7);
const sy = new Simplex2(19);

export function riverX(z: number): number {
  return 4 + 6 * Math.sin(z * 0.025) + 3 * Math.sin(z * 0.061 + 1.3);
}
export function riverHalfWidth(z: number): number {
  return 4.2 + 1.2 * Math.sin(z * 0.04 + 0.7) + (z < -118 ? -1.2 : 0);
}
export const WATERFALL_Z = -124;
export function waterY(z: number): number {
  return z < WATERFALL_Z - 4 ? 12.6 : 0;
}

export const PLACES = {
  start: { x: -34, z: 30 },
  bridgeZ: 26,
  mioRock: { x: riverX(12) + 0.6, z: 12 },
  weirZ: -28,
  mill: { x: riverX(6) + 10.5, z: 6 },
  villageCenter: { x: 50, z: 26 },
  torii: { x: riverX(26) + 13.5, z: 26 },
  shrine: { x: -62, z: -72 },
  shrineTopY: 0, // filled after heightAt is defined
  riverShrine: { x: riverX(18) + 7.5, z: 18 },
  pass: { x: 96, z: 76 },
  gate: { x: 76, z: 50 },
};

export const HOUSES: { x: number; z: number; rot: number; w: number; d: number; kind: 'minka' | 'shop' | 'elder' | 'store' }[] = [
  { x: 40, z: 12, rot: 0.15, w: 9, d: 7, kind: 'minka' },
  { x: 55, z: 10, rot: -0.1, w: 8, d: 6.5, kind: 'shop' },
  { x: 66, z: 22, rot: -1.45, w: 10, d: 8, kind: 'elder' },
  { x: 38, z: 38, rot: 3.0, w: 8, d: 6, kind: 'minka' },
  { x: 53, z: 42, rot: 3.25, w: 7.5, d: 6, kind: 'store' },
  { x: 30, z: 26, rot: 1.62, w: 7, d: 5.5, kind: 'minka' },
  { x: 67, z: 37, rot: -2.1, w: 7, d: 6, kind: 'minka' },
];

type P = { x: number; z: number };
export const PATHS: { pts: P[]; width: number }[] = [
  { pts: [{ x: -34, z: 30 }, { x: -22, z: 28.5 }, { x: -13, z: 27 }, { x: riverX(26) - 8, z: 26 }], width: 2.2 },
  { pts: [{ x: riverX(26) + 7, z: 26 }, { x: riverX(26) + 14, z: 26 }, { x: 34, z: 25.5 }, { x: 50, z: 26 }, { x: 62, z: 32 }, { x: 76, z: 50 }, { x: 96, z: 76 }], width: 2.6 },
  { pts: [{ x: 50, z: 26 }, { x: 46, z: 16 }, { x: riverX(6) + 13, z: 7 }], width: 2.0 },
  { pts: [{ x: 50, z: 26 }, { x: 54, z: 17 }, { x: 60, z: 18 }], width: 1.8 },
  { pts: [{ x: -13, z: 27 }, { x: -24, z: 6 }, { x: -36, z: -22 }, { x: -48, z: -44 }, { x: -56, z: -58 }, { x: -62, z: -72 }], width: 1.9 },
  { pts: [{ x: -24, z: 6 }, { x: -9, z: -8 }, { x: riverX(-28) - 6, z: -28 }], width: 1.4 },
];

function segDist(px: number, pz: number, a: P, b: P): number {
  const vx = b.x - a.x, vz = b.z - a.z;
  const t = clamp(((px - a.x) * vx + (pz - a.z) * vz) / (vx * vx + vz * vz || 1), 0, 1);
  const dx = px - (a.x + vx * t), dz = pz - (a.z + vz * t);
  return Math.sqrt(dx * dx + dz * dz);
}

/** 1 on a path, fading to 0 at its edge. */
export function pathMask(x: number, z: number): number {
  let m = 0;
  for (const p of PATHS) {
    for (let i = 0; i < p.pts.length - 1; i++) {
      const d = segDist(x, z, p.pts[i]!, p.pts[i + 1]!);
      if (d < p.width + 1.5) m = Math.max(m, 1 - smoothstep(p.width * 0.55, p.width + 1.2, d));
    }
  }
  return m;
}

export function villageMask(x: number, z: number): number {
  const d = Math.hypot((x - 52) / 1.05, z - 27);
  return 1 - smoothstep(25, 37, d);
}

function rawHeight(x: number, z: number): number {
  const rx = riverX(z);
  const d = Math.abs(x - rx);
  const n = sx.fbm(x * 0.018, z * 0.018, 5);
  let h = 1.4 + smoothstep(5, 17, d) * 1.7 + n * 2.6 * smoothstep(8, 30, d);
  h += Math.pow(Math.max(0, d - 42) / 80, 1.7) * 46 * (0.8 + 0.45 * sy.fbm(x * 0.01 + 7, z * 0.01, 3));
  h += sx.ridged(x * 0.011 + 3, z * 0.011, 4) * 24 * smoothstep(65, 150, d);
  // Upper valley above the waterfall.
  const up = smoothstep(WATERFALL_Z + 6, WATERFALL_Z - 8, z);
  h += up * 13.5;
  // The village plateau.
  const vm = villageMask(x, z);
  h = lerp(h, 3.1 + n * 0.3, vm);
  // Shrine hill: a raised knoll with a flat top.
  const sd = Math.hypot(x - PLACES.shrine.x, z - PLACES.shrine.z);
  h += 13 * Math.exp(-(sd * sd) / (2 * 20 * 20));
  return h;
}

const SHRINE_TOP = rawHeight(PLACES.shrine.x, PLACES.shrine.z);
PLACES.shrineTopY = SHRINE_TOP;

export function heightAt(x: number, z: number): number {
  let h = rawHeight(x, z);
  const sd = Math.hypot(x - PLACES.shrine.x, z - PLACES.shrine.z);
  h = lerp(SHRINE_TOP, h, smoothstep(9, 14, sd));
  // Paths are gently levelled.
  const pm = pathMask(x, z);
  if (pm > 0) h -= pm * 0.12;
  // Carve the river channel.
  const rx = riverX(z);
  const hw = riverHalfWidth(z);
  const d = Math.abs(x - rx);
  const bed = waterY(z) - 1.5 + Math.min(1, d / hw) * 0.6;
  const ch = smoothstep(hw - 0.5, hw + 3.5, d);
  h = lerp(bed, Math.max(h, waterY(z) + 0.5), ch);
  // Waterfall cliff face: steepen.
  const cliff = 1 - smoothstep(0, 9, Math.abs(z - WATERFALL_Z));
  if (cliff > 0 && d < 30) h += sy.noise(x * 0.3, z * 0.3) * 0.6 * cliff;
  return h;
}

/** Approximate surface normal via central differences. */
export function normalAt(x: number, z: number): [number, number, number] {
  const e = 0.6;
  const hx = heightAt(x + e, z) - heightAt(x - e, z);
  const hz = heightAt(x, z + e) - heightAt(x, z - e);
  const nx = -hx, ny = 2 * e, nz = -hz;
  const l = Math.hypot(nx, ny, nz);
  return [nx / l, ny / l, nz / l];
}

export function distToRiver(x: number, z: number): number {
  return Math.abs(x - riverX(z)) - riverHalfWidth(z);
}

/** Where vegetation is allowed (0 = never). */
export function forestDensity(x: number, z: number): number {
  if (distToRiver(x, z) < 3) return 0;
  if (pathMask(x, z) > 0.05) return 0;
  if (villageMask(x, z) > 0.25) return 0;
  const sd = Math.hypot(x - PLACES.shrine.x, z - PLACES.shrine.z);
  if (sd < 13) return 0;
  const west = x < riverX(z) ? 1 : 0.35;
  const n = sx.fbm(x * 0.03 + 11, z * 0.03 - 4, 3) * 0.5 + 0.5;
  return clamp(west * (0.35 + n * 0.9), 0, 1);
}
