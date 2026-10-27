// Procedural Japanese-inspired architecture for Amahara: houses, torii, lanterns,
// the arched bridge, the mill, the weir, the abandoned hill shrine and consequence set pieces.

import * as THREE from 'three';
import { Kit } from './Kit.js';
import { HOUSES, PLACES, heightAt, riverX, riverHalfWidth, waterY } from './layout.js';
import { mulberry32 } from './noise.js';
import type { CollisionWorld } from './Colliders.js';
import type { TextureSet } from './textures.js';

export interface ArchitectureMaterials {
  [k: string]: THREE.Material;
}

export function makeMaterials(t: TextureSet): Record<string, THREE.MeshStandardMaterial> {
  const m = (o: THREE.MeshStandardMaterialParameters) => new THREE.MeshStandardMaterial({ roughness: 0.85, metalness: 0, ...o });
  return {
    wood: m({ map: t.wood, color: '#b08868' }),
    woodDark: m({ map: t.woodDark, color: '#9a7a62' }),
    plaster: m({ map: t.plaster, roughness: 0.95 }),
    tile: m({ map: t.roofTile, roughness: 0.55, color: '#9aa0aa' }),
    thatch: m({ map: t.thatch, roughness: 1, color: '#8c7a62' }),
    stone: m({ map: t.stone, roughness: 0.9 }),
    vermilion: m({ color: '#8f2a1a', roughness: 0.55 }),
    black: m({ color: '#151214', roughness: 0.5 }),
    shoji: m({ map: t.shoji, emissive: new THREE.Color('#ffb767'), emissiveMap: t.shoji, emissiveIntensity: 1.1, roughness: 0.9 }),
    lantern: m({ map: t.paper, emissive: new THREE.Color('#ff9a42'), emissiveMap: t.paper, emissiveIntensity: 2.2, roughness: 0.8, color: '#d9a070' }),
    stoneGlow: m({ emissive: new THREE.Color('#ffb060'), emissiveIntensity: 2.6, color: '#332211' }),
    bronze: m({ color: '#5d4a2c', metalness: 0.75, roughness: 0.42 }),
    rope: m({ color: '#d9d0b8', roughness: 1 }),
    paper: m({ color: '#f0eee6', roughness: 1, side: THREE.DoubleSide }),
    cloth: m({ color: '#1d2a48', roughness: 1, side: THREE.DoubleSide }),
    candle: m({ color: '#efe6d0', emissive: new THREE.Color('#ffcf8a'), emissiveIntensity: 1.8 }),
    moss: m({ color: '#3c5530', roughness: 1 }),
    rice: m({ color: '#c9b78a', roughness: 1 }),
  };
}

/** Prism roof: gable profile extruded along the ridge. */
function gableRoof(width: number, depth: number, rise: number, overhang: number, thick: number): THREE.BufferGeometry {
  const D = depth / 2 + overhang;
  const s = new THREE.Shape();
  s.moveTo(-D, 0); s.lineTo(0, rise); s.lineTo(D, 0); s.lineTo(D, -thick); s.lineTo(0, rise - thick * 1.25); s.lineTo(-D, -thick); s.closePath();
  const len = width + overhang * 1.6;
  const g = new THREE.ExtrudeGeometry(s, { depth: len, bevelEnabled: false });
  g.translate(0, 0, -len / 2);
  g.rotateY(Math.PI / 2); // ridge along local X
  const p = g.attributes['position'] as THREE.BufferAttribute;
  const uv = g.attributes['uv'] as THREE.BufferAttribute;
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    // droop the eaves slightly for the Japanese curve
    const k = Math.abs(z) / D;
    p.setY(i, y - Math.pow(k, 3) * rise * 0.12 + Math.pow(Math.abs(x) / (len / 2), 4) * 0.12);
    uv.setXY(i, x / 1.6, (Math.abs(z) + (rise - y)) / 1.3);
  }
  g.computeVertexNormals();
  return g;
}

function gableTriangle(depth: number, rise: number): THREE.BufferGeometry {
  const s = new THREE.Shape();
  s.moveTo(-depth / 2, 0); s.lineTo(0, rise * 0.92); s.lineTo(depth / 2, 0); s.closePath();
  const g = new THREE.ShapeGeometry(s);
  const uv = g.attributes['uv'] as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.6, uv.getY(i) * 0.6);
  return g;
}

export function lanternGeometry(): THREE.BufferGeometry {
  const pts: THREE.Vector2[] = [];
  for (let i = 0; i <= 10; i++) { const t = i / 10; pts.push(new THREE.Vector2(Math.sin(t * Math.PI) * 0.26 + 0.04, t * 0.62 - 0.31)); }
  return new THREE.LatheGeometry(pts, 12);
}

export interface VillageHandles {
  group: THREE.Group;
  shutters: THREE.Group;
  warmLanterns: THREE.Group;
  lanternLights: THREE.PointLight[];
  mats: Record<string, THREE.MeshStandardMaterial>;
  setPieces: Record<string, THREE.Object3D>;
  wheel: THREE.Object3D | null;
  bridgeDeck: (x: number, z: number) => number | null;
  bells: THREE.Object3D[];
}

export function buildVillage(t: TextureSet, collision: CollisionWorld, shadows: boolean, lightBudget: number): VillageHandles {
  const mats = makeMaterials(t);
  const root = new THREE.Group(); root.name = 'village';
  const shutters = new THREE.Group(); shutters.name = 'shutters'; shutters.visible = false;
  const warmLanterns = new THREE.Group(); warmLanterns.name = 'warm-lanterns'; warmLanterns.visible = false;
  const lanternGeo = lanternGeometry();
  const lanternSpots: THREE.Vector3[] = [];
  const rand = mulberry32(88);
  const setPieces: Record<string, THREE.Object3D> = {};

  // ── Houses ──
  const kit = new Kit(mats);
  const shutterKit = new Kit(mats);
  for (const h of HOUSES) {
    const y0 = heightAt(h.x, h.z);
    const tiled = h.kind !== 'minka';
    const W = h.w, D = h.d, eave = h.kind === 'elder' ? 3.6 : 3.2;
    kit.push(h.x, y0, h.z, h.rot);
    shutterKit.push(h.x, y0, h.z, h.rot);
    kit.box('stone', W + 0.5, 0.7, D + 0.5, 0, 0.0, 0);
    kit.box('woodDark', W, 0.16, D, 0, 0.42, 0);
    // engawa veranda
    kit.box('wood', W, 0.12, 1.1, 0, 0.36, D / 2 + 0.55);
    for (let i = 0; i <= 4; i++) kit.box('woodDark', 0.14, 0.36, 0.14, -W / 2 + (i / 4) * W, 0.15, D / 2 + 1.0);
    // posts
    const nx = Math.max(2, Math.round(W / 1.8)), nz = Math.max(2, Math.round(D / 1.8));
    for (let i = 0; i <= nx; i++) for (const zz of [-D / 2, D / 2]) kit.box('woodDark', 0.2, eave - 0.5, 0.2, -W / 2 + (i / nx) * W, 0.5 + (eave - 0.5) / 2, zz);
    for (let j = 1; j < nz; j++) for (const xx of [-W / 2, W / 2]) kit.box('woodDark', 0.2, eave - 0.5, 0.2, xx, 0.5 + (eave - 0.5) / 2, -D / 2 + (j / nz) * D);
    // beams
    for (const yy of [eave - 0.08, 2.35]) {
      kit.box('woodDark', W + 0.3, 0.18, 0.24, 0, yy, D / 2);
      kit.box('woodDark', W + 0.3, 0.18, 0.24, 0, yy, -D / 2);
      kit.box('woodDark', 0.24, 0.18, D + 0.3, W / 2, yy, 0);
      kit.box('woodDark', 0.24, 0.18, D + 0.3, -W / 2, yy, 0);
    }
    // walls: back & sides plaster above wood wainscot; front shoji
    const wallH = eave - 0.6;
    kit.box('wood', W - 0.1, 0.9, 0.08, 0, 0.95, -D / 2 + 0.02);
    kit.box('plaster', W - 0.1, wallH - 0.9, 0.08, 0, 1.4 + (wallH - 0.9) / 2, -D / 2 + 0.02);
    for (const s of [-1, 1]) {
      kit.box('wood', 0.08, 0.9, D - 0.1, s * (W / 2 - 0.02), 0.95, 0);
      kit.box('plaster', 0.08, wallH - 0.9, D - 0.1, s * (W / 2 - 0.02), 1.4 + (wallH - 0.9) / 2, 0);
      // side shoji window
      kit.box('shoji', 0.1, 0.8, Math.min(2.2, D * 0.4), s * (W / 2), 1.8, 0);
      shutterKit.box('woodDark', 0.14, 0.9, Math.min(2.3, D * 0.42), s * (W / 2 + 0.06), 1.8, 0);
    }
    if (h.kind === 'store') {
      kit.box('plaster', W - 0.1, wallH, 0.12, 0, 0.5 + wallH / 2, D / 2 - 0.02);
      kit.box('woodDark', 1.4, 1.9, 0.16, 0, 1.45, D / 2);
    } else {
      kit.box('shoji', W - 0.5, 1.85, 0.06, 0, 1.45, D / 2 - 0.02);
      kit.box('plaster', W - 0.1, wallH - 2.0, 0.08, 0, 2.5 + (wallH - 2.0) / 2, D / 2 - 0.02);
      shutterKit.box('woodDark', W - 0.3, 1.95, 0.1, 0, 1.45, D / 2 + 0.08);
    }
    // roof
    const rise = D * (tiled ? 0.36 : 0.55);
    const roof = gableRoof(W, D, rise, tiled ? 1.0 : 1.2, tiled ? 0.28 : 0.6);
    kit.add(tiled ? 'tile' : 'thatch', roof, 0, eave + 0.1, 0);
    kit.box(tiled ? 'black' : 'thatch', W + 1.8, 0.3, 0.42, 0, eave + rise + 0.03, 0);
    if (tiled) for (const s of [-1, 1]) kit.box('black', 0.4, 0.55, 0.5, s * (W / 2 + 0.9), eave + rise + 0.18, 0);
    const gt = gableTriangle(D, rise);
    for (const s of [-1, 1]) kit.add('woodDark', gt, s * (W / 2 + 0.05), eave + 0.08, 0, s * Math.PI / 2);
    if (h.kind === 'shop') {
      // noren curtain
      for (let i = 0; i < 4; i++) kit.add('cloth', new THREE.PlaneGeometry(0.42, 0.9), -0.69 + i * 0.46, 2.0, D / 2 + 0.25);
    }
    kit.pop(); shutterKit.pop();
    // lantern hanging under the front eave (world position)
    const c = Math.cos(h.rot), s = Math.sin(h.rot);
    const lx = h.x + (W / 2 - 0.8) * c + (D / 2 + 0.9) * s;
    const lz = h.z - (W / 2 - 0.8) * s + (D / 2 + 0.9) * c;
    lanternSpots.push(new THREE.Vector3(lx, y0 + eave - 0.35, lz));
    collision.add({ kind: 'box', x: h.x, z: h.z, hx: W / 2 + 0.3, hz: D / 2 + 0.3, rot: -h.rot, y0: -5, y1: y0 + eave + rise, tag: 'house' });
  }

  // ── Torii at the village approach ──
  const tx = PLACES.torii.x, tz = PLACES.torii.z, ty = heightAt(tx, tz);
  kit.push(tx, ty, tz, Math.PI / 2);
  for (const s of [-1, 1]) {
    kit.cyl('vermilion', 0.2, 0.26, 4.6, s * 1.9, 2.3, 0, 12, 0, s * 0.03);
    kit.cyl('black', 0.3, 0.3, 0.45, s * 1.9, 0.22, 0, 12);
    collision.add({ kind: 'circle', x: tx + 0, z: tz + s * 1.9, r: 0.35, y0: -5, y1: ty + 5, tag: 'torii' });
  }
  kit.box('vermilion', 4.8, 0.32, 0.3, 0, 3.55, 0);
  const kasagi = new THREE.BoxGeometry(6.2, 0.34, 0.5, 16, 1, 1);
  const kp = kasagi.attributes['position'] as THREE.BufferAttribute;
  for (let i = 0; i < kp.count; i++) { const x = kp.getX(i); kp.setY(i, kp.getY(i) + Math.pow(Math.abs(x) / 3.1, 2.5) * 0.35); }
  kasagi.computeVertexNormals();
  kit.add('vermilion', kasagi, 0, 4.45, 0);
  const shimaki = kasagi.clone(); shimaki.scale(1.02, 0.6, 1.05);
  kit.add('black', shimaki, 0, 4.7, 0);
  kit.box('vermilion', 0.24, 0.75, 0.24, 0, 3.95, 0);
  kit.pop();

  // ── Stone lanterns lining the approach ──
  const toroSpots = [
    { x: riverX(26) + 10.5, z: 23.2 }, { x: riverX(26) + 10.5, z: 28.8 },
    { x: 42, z: 23.6 }, { x: 42, z: 28.4 }, { x: PLACES.shrine.x + 3.2, z: PLACES.shrine.z + 6 }, { x: PLACES.shrine.x - 3.2, z: PLACES.shrine.z + 6 },
  ];
  for (const p of toroSpots) {
    const y = heightAt(p.x, p.z);
    kit.push(p.x, y, p.z, 0);
    kit.box('stone', 0.9, 0.3, 0.9, 0, 0.15, 0);
    kit.cyl('stone', 0.16, 0.2, 1.1, 0, 0.85, 0, 8);
    kit.box('stone', 0.85, 0.18, 0.85, 0, 1.45, 0);
    kit.box('stoneGlow', 0.42, 0.42, 0.42, 0, 1.75, 0);
    for (let i = 0; i < 4; i++) kit.box('stone', 0.12, 0.5, 0.12, (i % 2 ? 1 : -1) * 0.27, 1.77, (i < 2 ? 1 : -1) * 0.27);
    kit.add('stone', new THREE.ConeGeometry(0.75, 0.42, 6), 0, 2.2, 0);
    kit.add('stone', new THREE.SphereGeometry(0.13, 8, 6), 0, 2.48, 0);
    kit.pop();
    collision.add({ kind: 'circle', x: p.x, z: p.z, r: 0.5, y0: -5, y1: y + 2.5, tag: 'toro' });
  }

  // ── Props: well, barrels, firewood, rice racks, fences ──
  const well = { x: 47, z: 30 };
  const wy = heightAt(well.x, well.z);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    kit.box('stone', 0.6, 0.8, 0.35, well.x + Math.cos(a) * 0.9, wy + 0.4, well.z + Math.sin(a) * 0.9, -a + Math.PI / 2);
  }
  kit.box('woodDark', 0.14, 2.2, 0.14, well.x - 1.05, wy + 1.1, well.z);
  kit.box('woodDark', 0.14, 2.2, 0.14, well.x + 1.05, wy + 1.1, well.z);
  kit.box('woodDark', 2.4, 0.14, 0.14, well.x, wy + 2.2, well.z);
  kit.add('tile', gableRoof(1.6, 1.4, 0.55, 0.3, 0.12), well.x, wy + 2.3, well.z);
  collision.add({ kind: 'circle', x: well.x, z: well.z, r: 1.25, y0: -5, y1: wy + 3, tag: 'well' });

  const props = [
    { x: 44.5, z: 9, k: 'barrels' }, { x: 59, z: 13, k: 'wood' }, { x: 61, z: 40, k: 'barrels' }, { x: 34, z: 33, k: 'wood' },
    { x: 70, z: 30, k: 'crates' }, { x: 49, z: 46, k: 'crates' },
  ];
  for (const p of props) {
    const y = heightAt(p.x, p.z);
    if (p.k === 'barrels') {
      for (let i = 0; i < 3; i++) kit.cyl('wood', 0.38, 0.34, 0.9, p.x + (i - 1) * 0.8, y + 0.45, p.z + (i === 1 ? 0.3 : 0), 10);
      collision.add({ kind: 'box', x: p.x, z: p.z, hx: 1.3, hz: 0.6, rot: 0, y0: -5, y1: y + 1, tag: 'prop' });
    } else if (p.k === 'wood') {
      for (let r = 0; r < 4; r++) for (let i = 0; i < 6 - r; i++) kit.cyl('woodDark', 0.13, 0.13, 1.6, p.x - 0.8 + i * 0.27 + r * 0.13, y + 0.14 + r * 0.24, p.z, 6, Math.PI / 2);
      kit.add('thatch', gableRoof(1.8, 1.4, 0.4, 0.2, 0.1), p.x, y + 1.35, p.z);
      collision.add({ kind: 'box', x: p.x, z: p.z, hx: 1.0, hz: 0.9, rot: 0, y0: -5, y1: y + 1.4, tag: 'prop' });
    } else {
      for (let i = 0; i < 3; i++) kit.box('wood', 0.8, 0.7, 0.8, p.x + (i % 2) * 0.9, y + 0.35 + (i === 2 ? 0.7 : 0), p.z + (i === 2 ? 0.2 : 0), rand() * 0.3, 0, 0, 0.8);
      collision.add({ kind: 'box', x: p.x + 0.45, z: p.z, hx: 0.95, hz: 0.5, rot: 0, y0: -5, y1: y + 1.4, tag: 'prop' });
    }
  }
  // rice-drying racks (hasa-gake) at the village edge
  for (const r of [{ x: 74, z: 8, rot: 0.5 }, { x: 80, z: 20, rot: 0.2 }]) {
    const y = heightAt(r.x, r.z);
    kit.push(r.x, y, r.z, r.rot);
    for (let i = -2; i <= 2; i++) kit.cyl('woodDark', 0.06, 0.07, 2.2, i * 1.4, 1.1, 0, 5);
    for (const yy of [0.9, 1.5]) {
      kit.cyl('woodDark', 0.04, 0.04, 5.8, 0, yy, 0, 4, 0, Math.PI / 2);
      for (let i = 0; i < 18; i++) kit.box('rice', 0.25, 0.55, 0.22, -2.6 + i * 0.31, yy - 0.25, 0, 0, 0, (rand() - 0.5) * 0.2);
    }
    kit.pop();
  }
  // bamboo fence along the river side of the village
  for (let i = 0; i < 24; i++) {
    const z = -6 + i * 1.6;
    if (Math.abs(z - PLACES.bridgeZ) < 4 || Math.abs(z - 7) < 3) continue;
    const x = riverX(z) + riverHalfWidth(z) + 6.2;
    const y = heightAt(x, z);
    kit.cyl('rice', 0.045, 0.05, 1.2, x, y + 0.6, z, 5);
    kit.cyl('woodDark', 0.035, 0.035, 1.6, x, y + 0.9, z + 0.8, 4, Math.PI / 2);
    kit.cyl('woodDark', 0.035, 0.035, 1.6, x, y + 0.45, z + 0.8, 4, Math.PI / 2);
  }

  root.add(kit.build('village-structures', shadows));
  shutters.add(shutterKit.build('village-shutters', false));

  // ── Paper lanterns (instanced emissive) + a few real lights ──
  const lanternMesh = new THREE.InstancedMesh(lanternGeo, mats['lantern']!, lanternSpots.length);
  lanternSpots.forEach((p, i) => lanternMesh.setMatrixAt(i, new THREE.Matrix4().makeTranslation(p.x, p.y, p.z)));
  root.add(lanternMesh);
  const lanternLights: THREE.PointLight[] = [];
  const lightOrder = [...lanternSpots].sort((a, b) => Math.hypot(a.x - 45, a.z - 22) - Math.hypot(b.x - 45, b.z - 22));
  for (let i = 0; i < Math.min(lightBudget, lightOrder.length); i++) {
    const L = new THREE.PointLight('#ff9a4a', 9, 16, 1.8);
    L.position.copy(lightOrder[i]!).add(new THREE.Vector3(0, -0.2, 0));
    lanternLights.push(L);
    root.add(L);
  }
  // Extra devotional lanterns along the approach (consequence: village_warm)
  const warmSpots: THREE.Vector3[] = [];
  for (let i = 0; i < 14; i++) {
    const t = i / 13;
    const x = riverX(26) + 9 + t * 32, z = 26 + (i % 2 ? 2.4 : -2.4);
    const y = heightAt(x, z);
    warmSpots.push(new THREE.Vector3(x, y + 1.7, z));
  }
  const poleKit = new Kit(mats);
  for (const p of warmSpots) poleKit.cyl('woodDark', 0.04, 0.05, 1.9, p.x, p.y - 0.75, p.z, 5);
  warmLanterns.add(poleKit.build('warm-poles', false));
  const warmMesh = new THREE.InstancedMesh(lanternGeo, mats['lantern']!, warmSpots.length);
  warmSpots.forEach((p, i) => warmMesh.setMatrixAt(i, new THREE.Matrix4().compose(p, new THREE.Quaternion(), new THREE.Vector3(0.7, 0.7, 0.7))));
  warmLanterns.add(warmMesh);

  // ── Bridge ──
  const bridge = buildBridge(mats, false, shadows);
  const bridgeBroken = buildBridge(mats, true, shadows);
  bridgeBroken.visible = false;
  setPieces['bridge_intact'] = bridge; setPieces['bridge_broken'] = bridgeBroken;
  root.add(bridge, bridgeBroken);

  // ── Mill + wheel ──
  const mill = buildMill(mats, shadows, collision);
  setPieces['mill_intact'] = mill.intact; setPieces['mill_damaged'] = mill.damaged;
  root.add(mill.intact, mill.damaged);

  // ── Weir ──
  const weir = buildWeir(mats, false, shadows), weirBroken = buildWeir(mats, true, shadows);
  weirBroken.visible = false;
  setPieces['weir_intact'] = weir; setPieces['weir_broken'] = weirBroken;
  root.add(weir, weirBroken);

  // ── Abandoned hill shrine ──
  root.add(buildHillShrine(mats, collision, shadows));

  // ── Consequence set pieces ──
  const riverShrine = buildRiverShrine(mats);
  riverShrine.visible = false;
  setPieces['river_shrine'] = riverShrine;
  root.add(riverShrine);
  const bells = buildWardenBells(mats);
  bells.group.visible = false;
  setPieces['warden_bells'] = bells.group;
  root.add(bells.group);

  root.add(shutters, warmLanterns);
  const bx0 = riverX(PLACES.bridgeZ);
  const deckLen = 2 * (riverHalfWidth(PLACES.bridgeZ) + 3.5);
  const bridgeDeck = (x: number, z: number): number | null => {
    if (setPieces['bridge_broken']!.visible) return null;
    if (Math.abs(z - PLACES.bridgeZ) > 1.25) return null;
    const t = (x - bx0) / (deckLen / 2);
    if (Math.abs(t) > 1.05) return null;
    return bridgeY(t);
  };
  return { group: root, shutters, warmLanterns, lanternLights, mats, setPieces, wheel: mill.wheel, bridgeDeck, bells: bells.bells };
}

const BRIDGE_END_W = () => heightAt(riverX(PLACES.bridgeZ) - (riverHalfWidth(PLACES.bridgeZ) + 3.5), PLACES.bridgeZ);
const BRIDGE_END_E = () => heightAt(riverX(PLACES.bridgeZ) + (riverHalfWidth(PLACES.bridgeZ) + 3.5), PLACES.bridgeZ);
function bridgeY(t: number): number {
  const w = BRIDGE_END_W(), e = BRIDGE_END_E();
  const base = w + (e - w) * (t * 0.5 + 0.5);
  return base + 1.7 * (1 - t * t) + 0.12;
}

function buildBridge(mats: Record<string, THREE.Material>, broken: boolean, shadows: boolean): THREE.Group {
  const kit = new Kit(mats);
  const z = PLACES.bridgeZ, cx = riverX(z);
  const half = riverHalfWidth(z) + 3.5;
  const N = 34;
  const rand = mulberry32(broken ? 5 : 4);
  for (let i = 0; i < N; i++) {
    const t = (i + 0.5) / N * 2 - 1;
    if (broken && Math.abs(t) < 0.42) continue;
    const x = cx + t * half;
    const y = bridgeY(t);
    const slope = Math.atan2(bridgeY(t + 0.01) - bridgeY(t - 0.01), half * 0.02);
    kit.box('wood', (2 * half) / N + 0.02, 0.12, 2.4, x, y - 0.06, z, 0, 0, slope);
  }
  // railings
  for (const s of [-1, 1]) {
    const posts = 9;
    for (let i = 0; i <= posts; i++) {
      const t = (i / posts) * 2 - 1;
      if (broken && Math.abs(t) < 0.5) continue;
      const x = cx + t * half, y = bridgeY(t);
      kit.box('vermilion', 0.14, 1.0, 0.14, x, y + 0.5, z + s * 1.15);
      if (i === 0 || i === posts) kit.add('bronze', new THREE.SphereGeometry(0.13, 8, 6), x, y + 1.1, z + s * 1.15);
    }
    const pts: THREE.Vector3[] = [];
    for (let i = 0; i <= 20; i++) { const t = (i / 20) * 2 - 1; pts.push(new THREE.Vector3(cx + t * half, bridgeY(t) + 0.95, z + s * 1.15)); }
    if (!broken) kit.add('vermilion', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts), 40, 0.06, 6, false));
    else {
      for (const range of [[0, 6], [14, 20]]) {
        const seg = pts.slice(range[0], range[1]! + 1);
        kit.add('vermilion', new THREE.TubeGeometry(new THREE.CatmullRomCurve3(seg), 12, 0.06, 6, false));
      }
    }
  }
  // piers
  for (const t of [-0.55, 0.55]) {
    const x = cx + t * half, y = bridgeY(t);
    for (const s of [-1, 1]) kit.cyl('woodDark', 0.16, 0.18, y + 1.6, x, (y - 1.6) / 2, z + s * 0.9, 8);
    kit.box('woodDark', 0.24, 0.24, 2.2, x, y - 0.35, z);
  }
  if (broken) {
    // wreckage caught downstream
    for (let i = 0; i < 9; i++) {
      const zz = z + 6 + rand() * 22, xx = riverX(zz) + (rand() - 0.5) * 6;
      kit.box('wood', 1.6 + rand(), 0.12, 0.35, xx, waterY(zz) + 0.05, zz, rand() * 3, (rand() - 0.5) * 0.5, (rand() - 0.5) * 0.4);
    }
    kit.box('vermilion', 3.2, 0.12, 0.12, cx + 1.5, waterY(z) + 0.1, z + 9, 0.7, 0.1, 0.2);
  }
  const g = kit.build(broken ? 'bridge-broken' : 'bridge', shadows);
  return g;
}

function buildMill(mats: Record<string, THREE.Material>, shadows: boolean, collision: CollisionWorld) {
  const { x, z } = PLACES.mill;
  const y0 = heightAt(x, z);
  const mk = (damaged: boolean) => {
    const kit = new Kit(mats);
    kit.push(x, y0, z, Math.PI / 2);
    kit.box('stone', 6.4, 0.7, 5.4, 0, 0, 0);
    for (const xx of [-3, 3]) for (const zz of [-2.5, 2.5]) kit.box('woodDark', 0.22, 2.8, 0.22, xx, 1.7, zz);
    kit.box('wood', 6, 2.4, 0.1, 0, 1.6, -2.5);
    kit.box('wood', 0.1, 2.4, 5, -3, 1.6, 0);
    kit.box('wood', 0.1, 2.4, 5, 3, 1.6, 0);
    kit.box('shoji', 2.2, 1.6, 0.08, -1.2, 1.4, 2.5);
    kit.box('wood', 2.6, 2.4, 0.1, 1.6, 1.6, 2.5);
    const roof = gableRoof(6, 5, 2.4, 1.0, 0.5);
    if (damaged) kit.add('thatch', roof, 0.4, 3.0, 0.3, 0.1, 0.18, 0.12);
    else kit.add('thatch', roof, 0, 3.1, 0);
    kit.pop();
    // flume
    kit.box('woodDark', 0.9, 0.5, 8, x - 4.2, y0 + 2.5, z - 6, 0, 0.12, 0);
    return kit.build(damaged ? 'mill-damaged' : 'mill', shadows);
  };
  const intact = mk(false), damaged = mk(true);
  damaged.visible = false;
  // water wheel
  const wheelKit = new Kit(mats);
  const R = 2.3;
  for (const s of [-0.4, 0.4]) wheelKit.add('woodDark', new THREE.TorusGeometry(R, 0.09, 6, 28), s, 0, 0, Math.PI / 2);
  for (let i = 0; i < 8; i++) wheelKit.box('woodDark', 0.1, R * 2, 0.1, 0, 0, 0, 0, (i / 8) * Math.PI);
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    wheelKit.box('wood', 0.9, 0.06, 0.5, 0, Math.sin(a) * R, Math.cos(a) * R, 0, -a);
  }
  wheelKit.cyl('woodDark', 0.15, 0.15, 1.6, 0, 0, 0, 8, 0, Math.PI / 2);
  const wheel = wheelKit.build('wheel', shadows);
  const wheelPivot = new THREE.Group();
  wheelPivot.position.set(x - 4.4, y0 + 0.6, z);
  wheelPivot.add(wheel);
  intact.add(wheelPivot);
  // broken wheel
  const bw = wheel.clone();
  bw.position.set(x - 4.6, y0 - 0.6, z + 1.2);
  bw.rotation.set(0.5, 0.3, 1.1);
  damaged.add(bw);
  collision.add({ kind: 'box', x, z, hx: 2.8, hz: 3.3, rot: 0, y0: -5, y1: y0 + 5, tag: 'mill' });
  return { intact, damaged, wheel: wheelPivot };
}

function buildWeir(mats: Record<string, THREE.Material>, broken: boolean, shadows: boolean): THREE.Group {
  const kit = new Kit(mats);
  const z = PLACES.weirZ, cx = riverX(z), hw = riverHalfWidth(z) + 1.2;
  const rand = mulberry32(broken ? 61 : 60);
  for (let i = 0; i <= 14; i++) {
    const t = (i / 14) * 2 - 1;
    const x = cx + t * hw;
    if (broken && Math.abs(t) < 0.55) {
      if (rand() < 0.5) kit.cyl('woodDark', 0.12, 0.14, 1.8, x + rand() * 2, -0.2, z + 4 + rand() * 6, 6, 1.4, rand());
      continue;
    }
    kit.cyl('woodDark', 0.12, 0.15, 2.2, x, 0.0 + (broken ? -0.2 : 0), z, 6, broken ? (rand() - 0.5) * 0.6 : 0, broken ? (rand() - 0.5) * 0.4 : 0);
  }
  if (!broken) {
    for (const yy of [-0.3, 0.25, 0.75]) kit.box('wood', hw * 2, 0.4, 0.12, cx, yy, z + 0.15);
    for (let i = 0; i < 18; i++) kit.add('stone', new THREE.DodecahedronGeometry(0.4 + rand() * 0.3, 0), cx + (rand() * 2 - 1) * hw, -0.5, z - 0.9 + rand() * 0.6);
  } else {
    for (let i = 0; i < 8; i++) kit.box('wood', 1.5 + rand(), 0.35, 0.1, cx + (rand() * 2 - 1) * hw, -0.1, z + 3 + rand() * 12, rand() * 3, 0, (rand() - 0.5));
    for (let i = 0; i < 10; i++) kit.add('stone', new THREE.DodecahedronGeometry(0.35 + rand() * 0.3, 0), cx + (rand() * 2 - 1) * hw, -0.6, z + rand() * 6);
  }
  return kit.build(broken ? 'weir-broken' : 'weir', shadows);
}

function buildHillShrine(mats: Record<string, THREE.Material>, collision: CollisionWorld, shadows: boolean): THREE.Group {
  const kit = new Kit(mats);
  const { x, z } = PLACES.shrine;
  const y = PLACES.shrineTopY;
  const rand = mulberry32(12);
  // stone stairs climbing the last stretch of the path
  const from = new THREE.Vector2(-56, -58), to = new THREE.Vector2(x + 1, z + 9);
  const steps = 26;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);
    const px = from.x + (to.x - from.x) * t, pz = from.y + (to.y - from.y) * t;
    const py = heightAt(px, pz);
    const ang = Math.atan2(to.x - from.x, to.y - from.y);
    kit.box('stone', 2.4, 0.3, 0.75, px, py + 0.05, pz, ang, 0, (rand() - 0.5) * 0.05);
  }
  kit.push(x, y, z, Math.PI * 0.1);
  // platform
  kit.box('stone', 7, 0.5, 6, 0, 0.1, 0);
  // honden on stilts
  for (const xx of [-1.6, 1.6]) for (const zz of [-1.4, 1.4]) kit.box('woodDark', 0.2, 1.6, 0.2, xx, 1.0, zz);
  kit.box('woodDark', 3.6, 0.14, 3.2, 0, 1.75, 0);
  kit.box('wood', 3.2, 1.9, 0.1, 0, 2.75, -1.4);
  kit.box('wood', 0.1, 1.9, 2.8, -1.6, 2.75, 0);
  kit.box('wood', 0.1, 1.9, 2.8, 1.6, 2.75, 0, 0, 0, 0.04);
  kit.box('woodDark', 1.1, 1.6, 0.1, -0.9, 2.6, 1.42, 0.2);
  kit.add('thatch', gableRoof(3.6, 3.2, 1.6, 0.8, 0.45), 0, 3.75, 0, 0, 0, 0.05);
  kit.add('moss', gableRoof(3.4, 3.0, 1.5, 0.75, 0.15), 0.2, 3.95, 0, 0.1, 0.0, 0.05);
  // the silent bell, its rope hanging still
  kit.box('woodDark', 3.8, 0.16, 0.18, 0, 3.55, 1.9);
  kit.add('bronze', new THREE.SphereGeometry(0.32, 10, 8, 0, Math.PI * 2, 0, Math.PI * 0.62), 0, 3.15, 1.9);
  kit.cyl('rope', 0.04, 0.04, 2.0, 0.1, 2.15, 1.9, 5);
  // offering box (broken)
  kit.box('woodDark', 1.4, 0.6, 0.7, 0, 0.65, 2.4, 0, 0, 0.15);
  // fallen torii
  kit.cyl('vermilion', 0.17, 0.2, 3.8, -3.4, 0.6, 4.8, 10, 0, Math.PI / 2 - 0.15, 0.4);
  kit.cyl('vermilion', 0.17, 0.2, 3.8, 3.0, 1.9, 4.2, 10, 0, 0.05);
  kit.box('black', 4.8, 0.3, 0.38, 0.2, 0.35, 5.8, 0.25, 0, 0.12);
  kit.pop();
  // sacred cedar with a shimenawa rope
  const tx = x - 6, tz = z - 5, ty = heightAt(tx, tz);
  kit.cyl('woodDark', 0.9, 1.3, 14, tx, ty + 7, tz, 12);
  kit.add('rope', new THREE.TorusGeometry(1.22, 0.12, 6, 20), tx, ty + 2.4, tz, 0, Math.PI / 2);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2; kit.add('paper', new THREE.PlaneGeometry(0.18, 0.5), tx + Math.cos(a) * 1.3, ty + 2.05, tz + Math.sin(a) * 1.3, -a + Math.PI / 2); }
  collision.add({ kind: 'circle', x: tx, z: tz, r: 1.4, y0: -5, y1: ty + 20, tag: 'shrine' });
  collision.add({ kind: 'box', x, z, hx: 1.9, hz: 1.7, rot: -Math.PI * 0.1, y0: y + 0.3, y1: y + 6, tag: 'shrine' });
  const g = kit.build('hill-shrine', shadows);
  return g;
}

function buildRiverShrine(mats: Record<string, THREE.Material>): THREE.Group {
  const kit = new Kit(mats);
  const { x, z } = PLACES.riverShrine;
  const y = heightAt(x, z);
  const rand = mulberry32(31);
  // cairn of river stones
  for (let i = 0; i < 6; i++) kit.add('stone', new THREE.SphereGeometry(0.42 - i * 0.05, 9, 7).scale(1.2, 0.55, 1), 1.4 + (rand() - 0.5) * 0.1, y + 0.18 + i * 0.32, 0.6);
  // little hokora
  kit.box('stone', 1.0, 0.5, 0.9, 0, y + 0.25, 0);
  kit.box('wood', 0.7, 0.6, 0.6, 0, y + 0.8, 0);
  kit.add('tile', gableRoof(0.8, 0.7, 0.35, 0.18, 0.06), 0, y + 1.1, 0);
  kit.box('vermilion', 0.08, 0.9, 0.08, -0.55, y + 0.45, 0.6);
  kit.box('vermilion', 0.08, 0.9, 0.08, 0.55, y + 0.45, 0.6);
  kit.box('vermilion', 1.3, 0.08, 0.1, 0, y + 0.92, 0.6);
  for (let i = 0; i < 5; i++) kit.cyl('candle', 0.035, 0.04, 0.22 + rand() * 0.1, -0.5 + i * 0.25, y + 0.62, 0.55, 6);
  for (let i = 0; i < 4; i++) kit.add('paper', new THREE.PlaneGeometry(0.1, 0.35), -0.3 + i * 0.2, y + 0.7, 0.62);
  kit.add('rice', new THREE.SphereGeometry(0.1, 8, 6), 0.2, y + 0.58, 0.45);
  kit.add('rice', new THREE.SphereGeometry(0.1, 8, 6), -0.15, y + 0.58, 0.45);
  const g = kit.build('river-shrine', true);
  g.position.set(x, 0, z);
  g.rotation.y = -Math.PI / 2;
  const L = new THREE.PointLight('#ffc27a', 5, 7, 2);
  L.position.set(0, y + 1.0, 0.8);
  g.add(L);
  g.name = 'river-shrine';
  return g;
}

function buildWardenBells(mats: Record<string, THREE.Material>): { group: THREE.Group; bells: THREE.Object3D[] } {
  const g = new THREE.Group();
  const kit = new Kit(mats);
  const bells: THREE.Object3D[] = [];
  const spots = [{ x: PLACES.torii.x + 2.5, z: 22.5, r: 0 }, { x: PLACES.torii.x + 2.5, z: 29.5, r: 0 }, { x: PLACES.gate.x, z: PLACES.gate.z, r: 0.8 }, { x: 58, z: 14, r: 0.3 }];
  const bellGeo = new THREE.CylinderGeometry(0.12, 0.26, 0.5, 10, 1, true);
  for (const s of spots) {
    const y = heightAt(s.x, s.z);
    kit.cyl('woodDark', 0.08, 0.1, 3.2, s.x - 0.9, y + 1.6, s.z, 6);
    kit.cyl('woodDark', 0.08, 0.1, 3.2, s.x + 0.9, y + 1.6, s.z, 6);
    kit.box('woodDark', 2.2, 0.14, 0.14, s.x, y + 3.1, s.z);
    kit.box('paper', 0.12, 0.4, 0.02, s.x - 0.4, y + 2.8, s.z);
    kit.box('paper', 0.12, 0.4, 0.02, s.x + 0.4, y + 2.8, s.z);
    const pivot = new THREE.Group();
    pivot.position.set(s.x, y + 3.0, s.z);
    const bell = new THREE.Mesh(bellGeo, mats['bronze']);
    bell.position.y = -0.4;
    const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 4), mats['rope']);
    rope.position.y = -0.05;
    pivot.add(bell, rope);
    g.add(pivot);
    bells.push(pivot);
  }
  g.add(kit.build('warden-bells', true));
  return { group: g, bells };
}
