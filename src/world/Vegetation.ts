// Instanced vegetation: Japanese cedars, pines, maples, bamboo, ferns, grass and rocks.
// All geometry is generated here (original); wind sway runs on the GPU.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { forestDensity, heightAt, distToRiver, PLACES, riverX, pathMask, villageMask, WORLD } from './layout.js';
import { Simplex2, mulberry32, smoothstep } from './noise.js';
import type { CollisionWorld } from './Colliders.js';
import type { TextureSet } from './textures.js';

const jit = new Simplex2(303);
const ni = (g: THREE.BufferGeometry) => (g.index ? g.toNonIndexed() : g);

/** Inject GPU wind sway into a standard material used by an InstancedMesh. */
export function addWind(mat: THREE.Material, uTime: THREE.IUniform, strength: number, heightScale: number): void {
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nuniform float uTime;')
      .replace('#include <begin_vertex>', `
        #include <begin_vertex>
        #ifdef USE_INSTANCING
          vec3 ip = vec3(instanceMatrix[3][0], instanceMatrix[3][1], instanceMatrix[3][2]);
        #else
          vec3 ip = vec3(0.0);
        #endif
        float hh = max(position.y, 0.0) / ${heightScale.toFixed(2)};
        float gust = sin(uTime * 0.7 + ip.x * 0.02) * 0.5 + 0.5;
        float sw = sin(uTime * 1.6 + ip.x * 0.31 + ip.z * 0.27) + 0.4 * sin(uTime * 3.7 + ip.z * 0.9);
        transformed.x += sw * hh * hh * ${strength.toFixed(3)} * (0.6 + gust);
        transformed.z += cos(uTime * 1.3 + ip.z * 0.21) * hh * hh * ${(strength * 0.6).toFixed(3)} * (0.6 + gust);
      `);
  };
}

function colorize(g: THREE.BufferGeometry, fn: (x: number, y: number, z: number, nx: number, ny: number, nz: number) => THREE.Color): THREE.BufferGeometry {
  const g2 = ni(g);
  g2.computeVertexNormals();
  const p = g2.attributes['position'] as THREE.BufferAttribute;
  const n = g2.attributes['normal'] as THREE.BufferAttribute;
  const cols = new Float32Array(p.count * 3);
  for (let i = 0; i < p.count; i++) {
    const c = fn(p.getX(i), p.getY(i), p.getZ(i), n.getX(i), n.getY(i), n.getZ(i));
    cols[i * 3] = c.r; cols[i * 3 + 1] = c.g; cols[i * 3 + 2] = c.b;
  }
  g2.setAttribute('color', new THREE.BufferAttribute(cols, 3));
  return g2;
}

function jitter(g: THREE.BufferGeometry, amount: number, freq: number, seed: number): void {
  const p = g.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    p.setXYZ(i,
      x + jit.noise(x * freq + seed, y * freq) * amount,
      y + jit.noise(y * freq - seed, z * freq) * amount * 0.6,
      z + jit.noise(z * freq + 3 + seed, x * freq) * amount);
  }
}

// ─── Tree geometries (unit trees ~1m tall, scaled per instance) ─────────────

function cedarGeometry(seed: number): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const trunk = new THREE.CylinderGeometry(0.012, 0.03, 1, 7, 4);
  trunk.translate(0, 0.5, 0);
  const layers: THREE.BufferGeometry[] = [];
  const r = mulberry32(seed);
  const count = 9;
  for (let i = 0; i < count; i++) {
    const t = i / (count - 1);
    const y = 0.28 + t * 0.7;
    const rad = (0.2 * (1 - t) + 0.035) * (0.85 + r() * 0.3);
    const h = 0.16 - t * 0.05;
    const cone = new THREE.ConeGeometry(rad, h, 9, 2, true);
    cone.translate(0, y, 0);
    cone.rotateY(r() * Math.PI);
    jitter(cone, rad * 0.22, 9, seed + i);
    layers.push(cone);
  }
  const tip = new THREE.ConeGeometry(0.03, 0.08, 6, 1);
  tip.translate(0, 1.02, 0);
  layers.push(tip);
  const deep = new THREE.Color('#1a3226'), mid = new THREE.Color('#2f5038'), lit = new THREE.Color('#4f7552');
  const crown = colorize(mergeGeometries(layers.map((l) => ni(l)))!, (_x, y, _z, _nx, ny) => {
    const c = deep.clone().lerp(mid, smoothstep(-0.4, 0.6, ny));
    return c.lerp(lit, smoothstep(0.55, 1.0, y) * 0.5 * Math.max(0, ny));
  });
  return { trunk, crown };
}

function pineGeometry(seed: number): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const r = mulberry32(seed);
  const pts: THREE.Vector3[] = [];
  for (let i = 0; i <= 6; i++) {
    const t = i / 6;
    pts.push(new THREE.Vector3(Math.sin(t * 3 + seed) * 0.08 * t + t * 0.12, t * 0.82, Math.cos(t * 2.3 + seed) * 0.06 * t));
  }
  const curve = new THREE.CatmullRomCurve3(pts);
  const trunkParts: THREE.BufferGeometry[] = [ni(new THREE.TubeGeometry(curve, 16, 0.028, 6, false))];
  const pads: THREE.BufferGeometry[] = [];
  const padCount = 5 + Math.floor(r() * 3);
  for (let i = 0; i < padCount; i++) {
    const t = 0.45 + (i / padCount) * 0.55;
    const p = curve.getPoint(Math.min(t, 1));
    const ang = r() * Math.PI * 2;
    const reach = (1 - t) * 0.32 + 0.05;
    const pad = new THREE.IcosahedronGeometry(0.11 + r() * 0.06, 1);
    pad.scale(1.6, 0.42, 1.3);
    jitter(pad, 0.025, 14, seed + i * 7);
    pad.translate(p.x + Math.cos(ang) * reach, p.y + 0.02, p.z + Math.sin(ang) * reach);
    pads.push(ni(pad));
    // a limb to the pad
    const limb = new THREE.CylinderGeometry(0.008, 0.014, reach + 0.04, 4);
    limb.rotateZ(Math.PI / 2);
    limb.rotateY(-ang);
    limb.translate(p.x + Math.cos(ang) * reach * 0.5, p.y - 0.01, p.z + Math.sin(ang) * reach * 0.5);
    trunkParts.push(ni(limb));
  }
  const trunk = mergeGeometries(trunkParts)!;
  const dark = new THREE.Color('#1b3127'), top = new THREE.Color('#4a6e4c');
  const crown = colorize(mergeGeometries(pads)!, (_x, _y, _z, _nx, ny) => dark.clone().lerp(top, smoothstep(-0.3, 0.9, ny)));
  return { trunk, crown };
}

function mapleGeometry(seed: number): { trunk: THREE.BufferGeometry; crown: THREE.BufferGeometry } {
  const r = mulberry32(seed);
  const trunk = new THREE.CylinderGeometry(0.025, 0.05, 0.55, 6, 2);
  trunk.translate(0, 0.275, 0);
  const blobs: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 7; i++) {
    const b = new THREE.IcosahedronGeometry(0.16 + r() * 0.1, 1);
    b.scale(1, 0.75, 1);
    jitter(b, 0.04, 10, seed + i);
    const a = r() * Math.PI * 2, d = r() * 0.22;
    b.translate(Math.cos(a) * d, 0.62 + r() * 0.28, Math.sin(a) * d);
    blobs.push(ni(b));
  }
  const inner = new THREE.Color('#3a0d0c'), outer = new THREE.Color('#8a2a17'), tip = new THREE.Color('#b8552a');
  const crown = colorize(mergeGeometries(blobs)!, (_x, y, _z, _nx, ny) => inner.clone().lerp(outer, smoothstep(-0.5, 0.5, ny)).lerp(tip, smoothstep(0.85, 1.05, y) * 0.5));
  return { trunk, crown };
}

function rockGeometry(seed: number): THREE.BufferGeometry {
  const g = new THREE.IcosahedronGeometry(1, 2);
  const n = new Simplex2(seed);
  const p = g.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
    const k = 1 + n.fbm(v.x * 1.3, v.y * 1.3 + v.z, 3) * 0.32;
    v.multiplyScalar(k);
    v.y = v.y > 0 ? v.y * 0.7 : v.y * 0.4;
    p.setXYZ(i, v.x, v.y, v.z);
  }
  const stone = new THREE.Color('#7a7770'), moss = new THREE.Color('#3c5a2c');
  return colorize(g, (_x, _y, _z, _nx, ny) => stone.clone().lerp(moss, smoothstep(0.45, 0.95, ny) * 0.85));
}

function alphaCardTexture(kind: 'grass' | 'fern'): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 128;
  const ctx = c.getContext('2d')!;
  const r = mulberry32(kind === 'grass' ? 5 : 9);
  if (kind === 'grass') {
    for (let i = 0; i < 26; i++) {
      const x = 10 + r() * 108, lean = (r() - 0.5) * 40, h = 60 + r() * 64;
      const g = ctx.createLinearGradient(0, 128, 0, 128 - h);
      g.addColorStop(0, '#1c2a16'); g.addColorStop(1, r() > 0.5 ? '#6a7a45' : '#58703c');
      ctx.fillStyle = g;
      ctx.beginPath(); ctx.moveTo(x - 2.5, 128); ctx.quadraticCurveTo(x + lean * 0.3, 128 - h * 0.6, x + lean, 128 - h); ctx.lineTo(x + 2.5, 128); ctx.fill();
    }
  } else {
    ctx.translate(64, 128);
    for (let f = 0; f < 5; f++) {
      ctx.save();
      ctx.rotate((f - 2) * 0.38);
      ctx.strokeStyle = '#2b3d20'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.quadraticCurveTo(8, -60, 0, -118); ctx.stroke();
      for (let i = 0; i < 18; i++) {
        const y = -10 - i * 6, len = 22 * (1 - i / 20);
        ctx.fillStyle = i % 2 ? '#3d5a2a' : '#4b6b31';
        for (const s of [-1, 1]) {
          ctx.beginPath(); ctx.moveTo(0, y); ctx.quadraticCurveTo(s * len * 0.6, y - 6, s * len, y - 2); ctx.quadraticCurveTo(s * len * 0.5, y + 2, 0, y + 3); ctx.fill();
        }
      }
      ctx.restore();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function crossedCard(w: number, h: number): THREE.BufferGeometry {
  const a = new THREE.PlaneGeometry(w, h, 1, 3); a.translate(0, h / 2, 0);
  const b = a.clone(); b.rotateY(Math.PI / 2);
  const c = a.clone(); c.rotateY(Math.PI / 4);
  return mergeGeometries([a, b, c])!;
}

export interface VegetationResult { group: THREE.Group; trunks: { x: number; z: number; r: number }[] }

export function buildVegetation(opts: {
  trees: number; grass: number; tex: TextureSet; uTime: THREE.IUniform; collision: CollisionWorld; shadows: boolean;
}): VegetationResult {
  const group = new THREE.Group();
  const rand = mulberry32(4242);
  const trunks: { x: number; z: number; r: number }[] = [];
  const barkMat = new THREE.MeshStandardMaterial({ map: opts.tex.bark, roughness: 0.95, color: '#c8a088' });
  const crownMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: false });
  addWind(crownMat, opts.uTime, 0.35, 1.0);
  addWind(barkMat, opts.uTime, 0.2, 1.0);

  // Candidate points: jittered grid scored by forest density.
  type Spot = { x: number; z: number; s: number; kind: 'cedar' | 'pine' | 'maple' };
  const spots: Spot[] = [];
  const step = 6.2;
  for (let x = WORLD.minX + 4; x < WORLD.maxX - 4; x += step) {
    for (let z = WORLD.minZ + 4; z < WORLD.maxZ - 4; z += step) {
      const px = x + (rand() - 0.5) * step * 0.9, pz = z + (rand() - 0.5) * step * 0.9;
      const d = forestDensity(px, pz);
      if (d <= 0 || rand() > d) continue;
      const nearRiver = distToRiver(px, pz) < 14;
      const shrineD = Math.hypot(px - PLACES.shrine.x, pz - PLACES.shrine.z);
      const inVillageRing = villageMask(px, pz) > 0.02;
      let kind: Spot['kind'] = 'cedar';
      if (inVillageRing || (px > riverX(pz) && rand() < 0.25)) kind = 'maple';
      else if (nearRiver && rand() < 0.45) kind = 'pine';
      else if (shrineD < 30 && rand() < 0.35) kind = 'pine';
      spots.push({ x: px, z: pz, s: rand(), kind });
    }
  }
  // Prioritise trees near the playable heart so low settings stay dense where it matters.
  spots.sort((a, b) => (Math.hypot(a.x - 10, a.z) - a.s * 30) - (Math.hypot(b.x - 10, b.z) - b.s * 30));
  const chosen = spots.slice(0, opts.trees);

  const variants = {
    cedar: [cedarGeometry(1), cedarGeometry(2), cedarGeometry(3)],
    pine: [pineGeometry(4), pineGeometry(5)],
    maple: [mapleGeometry(6), mapleGeometry(7)],
  };
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), p = new THREE.Vector3();
  for (const kind of ['cedar', 'pine', 'maple'] as const) {
    const list = chosen.filter((c) => c.kind === kind);
    const vs = variants[kind];
    vs.forEach((v, vi) => {
      const mine = list.filter((_, i) => i % vs.length === vi);
      if (!mine.length) return;
      const trunkMesh = new THREE.InstancedMesh(v.trunk, barkMat, mine.length);
      const crownMesh = new THREE.InstancedMesh(v.crown, crownMat, mine.length);
      mine.forEach((s, i) => {
        const h = kind === 'cedar' ? 17 + s.s * 12 : kind === 'pine' ? 7 + s.s * 5 : 6 + s.s * 3.5;
        const y = heightAt(s.x, s.z) - 0.3;
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * Math.PI * 2);
        sc.set(h * (kind === 'cedar' ? 1 : 1.05), h, h * (kind === 'cedar' ? 1 : 1.05));
        p.set(s.x, y, s.z);
        m4.compose(p, q, sc);
        trunkMesh.setMatrixAt(i, m4);
        crownMesh.setMatrixAt(i, m4);
        const r = kind === 'cedar' ? 0.5 + h * 0.012 : 0.35;
        trunks.push({ x: s.x, z: s.z, r });
        opts.collision.add({ kind: 'circle', x: s.x, z: s.z, r, y0: -5, y1: y + h, tag: 'tree' });
      });
      trunkMesh.castShadow = opts.shadows; crownMesh.castShadow = opts.shadows;
      crownMesh.receiveShadow = true;
      trunkMesh.computeBoundingSphere(); crownMesh.computeBoundingSphere();
      group.add(trunkMesh, crownMesh);
    });
  }

  // Bamboo grove behind the mill and on the west bank.
  const bambooSpots: { x: number; z: number }[] = [];
  for (const g of [{ x: -18, z: -6, r: 9 }, { x: 30, z: -10, r: 7 }, { x: -40, z: 48, r: 8 }]) {
    for (let i = 0; i < 70; i++) {
      const a = rand() * Math.PI * 2, d = Math.sqrt(rand()) * g.r;
      const x = g.x + Math.cos(a) * d, z = g.z + Math.sin(a) * d;
      if (pathMask(x, z) > 0.05 || distToRiver(x, z) < 2) continue;
      bambooSpots.push({ x, z });
    }
  }
  const culm = new THREE.CylinderGeometry(0.06, 0.075, 1, 5, 10, true);
  culm.translate(0, 0.5, 0);
  const culmC = colorize(culm, (_x, y) => (Math.abs(((y * 10) % 1) - 0.5) > 0.46 ? new THREE.Color('#5f6b3a') : new THREE.Color('#3f5a2c')));
  const leafBlob = new THREE.IcosahedronGeometry(0.5, 1); leafBlob.scale(1, 0.35, 1); jitter(leafBlob, 0.12, 4, 31);
  const leafA = leafBlob.clone().translate(0.3, 0.86, 0), leafB = leafBlob.clone().translate(-0.25, 0.94, 0.2), leafC = leafBlob.clone().translate(0, 0.78, -0.3);
  const bambooLeaves = colorize(mergeGeometries([ni(leafA), ni(leafB), ni(leafC)])!, (_x, _y, _z, _nx, ny) => new THREE.Color('#1e3a1d').lerp(new THREE.Color('#4a6e34'), smoothstep(-0.2, 0.9, ny)));
  const bambooMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  addWind(bambooMat, opts.uTime, 0.7, 1.0);
  const bambooLeafMat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  addWind(bambooLeafMat, opts.uTime, 0.7, 1.0);
  const culms = new THREE.InstancedMesh(culmC, bambooMat, bambooSpots.length);
  const leaves = new THREE.InstancedMesh(bambooLeaves, bambooLeafMat, bambooSpots.length);
  bambooSpots.forEach((s, i) => {
    const h = 7 + rand() * 5;
    q.setFromEuler(new THREE.Euler((rand() - 0.5) * 0.08, rand() * 6.28, (rand() - 0.5) * 0.08));
    m4.compose(p.set(s.x, heightAt(s.x, s.z) - 0.2, s.z), q, sc.set(h * 0.12, h, h * 0.12));
    culms.setMatrixAt(i, m4);
    m4.compose(p, q, sc.set(2.2, h, 2.2));
    leaves.setMatrixAt(i, m4);
    opts.collision.add({ kind: 'circle', x: s.x, z: s.z, r: 0.12, y0: -5, y1: 30, tag: 'bamboo' });
  });
  culms.castShadow = leaves.castShadow = opts.shadows;
  group.add(culms, leaves);

  // Rocks along the river and through the forest.
  const rockSpots: { x: number; z: number; s: number }[] = [];
  for (let i = 0; i < 520; i++) {
    const z = WORLD.minZ + rand() * (WORLD.maxZ - WORLD.minZ);
    const onBank = rand() < 0.6;
    const x = onBank ? riverX(z) + (rand() < 0.5 ? -1 : 1) * (4 + rand() * 7) : WORLD.minX + rand() * (WORLD.maxX - WORLD.minX);
    if (pathMask(x, z) > 0.1 || villageMask(x, z) > 0.3) continue;
    if (Math.hypot(x - PLACES.mioRock.x, z - PLACES.mioRock.z) < 4) continue;
    rockSpots.push({ x, z, s: onBank ? 0.3 + rand() * 0.9 : 0.4 + rand() * 1.6 });
  }
  const rockMat = new THREE.MeshStandardMaterial({ vertexColors: true, map: opts.tex.stone, roughness: 0.88 });
  for (let v = 0; v < 3; v++) {
    const mine = rockSpots.filter((_, i) => i % 3 === v);
    const rm = new THREE.InstancedMesh(rockGeometry(90 + v), rockMat, mine.length);
    mine.forEach((s, i) => {
      q.setFromEuler(new THREE.Euler(rand() * 0.4, rand() * 6.28, rand() * 0.4));
      m4.compose(p.set(s.x, heightAt(s.x, s.z) - s.s * 0.25, s.z), q, sc.set(s.s * (1 + rand() * 0.6), s.s, s.s * (1 + rand() * 0.4)));
      rm.setMatrixAt(i, m4);
      if (s.s > 0.8) opts.collision.add({ kind: 'circle', x: s.x, z: s.z, r: s.s * 0.9, y0: -5, y1: heightAt(s.x, s.z) + s.s * 0.6, tag: 'rock' });
    });
    rm.castShadow = opts.shadows; rm.receiveShadow = true;
    group.add(rm);
  }

  // Ground cover: ferns in the forest, grass in the open.
  if (opts.grass > 0) {
    const grassMat = new THREE.MeshStandardMaterial({ map: alphaCardTexture('grass'), alphaTest: 0.45, side: THREE.DoubleSide, roughness: 1, color: '#8a9a78' });
    addWind(grassMat, opts.uTime, 0.18, 1.0);
    const fernMat = new THREE.MeshStandardMaterial({ map: alphaCardTexture('fern'), alphaTest: 0.4, side: THREE.DoubleSide, roughness: 1, color: '#7f907a' });
    addWind(fernMat, opts.uTime, 0.12, 1.0);
    const grassG = crossedCard(1, 1), fernG = crossedCard(1.4, 1);
    const gs: THREE.Matrix4[] = [], fs: THREE.Matrix4[] = [];
    let tries = 0;
    while ((gs.length + fs.length) < opts.grass && tries++ < opts.grass * 6) {
      // concentrate around the playable heart of the valley
      const a = rand() * Math.PI * 2, d = Math.pow(rand(), 0.75) * 95;
      const x = 12 + Math.cos(a) * d * 1.1, z = 10 + Math.sin(a) * d;
      if (distToRiver(x, z) < 0.8 || pathMask(x, z) > 0.35) continue;
      if (villageMask(x, z) > 0.7 && rand() < 0.8) continue;
      const forest = forestDensity(x, z) > 0.55 && x < riverX(z);
      const s = forest ? 0.7 + rand() * 0.9 : 0.45 + rand() * 0.55;
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rand() * 6.28);
      const m = new THREE.Matrix4().compose(new THREE.Vector3(x, heightAt(x, z) - 0.05, z), q, new THREE.Vector3(s, s * (forest ? 0.8 : 1), s));
      (forest ? fs : gs).push(m);
    }
    for (const [geo, mat, list] of [[grassG, grassMat, gs], [fernG, fernMat, fs]] as const) {
      const im = new THREE.InstancedMesh(geo, mat, list.length);
      list.forEach((m, i) => im.setMatrixAt(i, m));
      im.receiveShadow = true;
      group.add(im);
    }
  }
  return { group, trunks };
}
