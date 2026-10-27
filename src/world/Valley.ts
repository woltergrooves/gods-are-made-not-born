// Assembles Amahara Valley and exposes the switches the consequence system flips.

import * as THREE from 'three';
import { Sky, FOG_COLOR, MOON_DIR } from './Sky.js';
import { buildTerrain } from './Terrain.js';
import { River } from './River.js';
import { buildVegetation } from './Vegetation.js';
import { buildVillage, type VillageHandles } from './Architecture.js';
import { Weather } from './Weather.js';
import { CollisionWorld } from './Colliders.js';
import { makeTextures, type TextureSet } from './textures.js';
import { heightAt, riverX, riverHalfWidth, PLACES, WATERFALL_Z } from './layout.js';
import { Simplex2 } from './noise.js';
import type { QualityPreset } from '../render/Renderer.js';
import type { Surfaces } from '../player/PlayerController.js';

export class Valley {
  scene = new THREE.Scene();
  collision = new CollisionWorld();
  uTime: THREE.IUniform = { value: 0 };
  sky!: Sky;
  river!: River;
  weather!: Weather;
  village!: VillageHandles;
  moon!: THREE.DirectionalLight;
  hemi!: THREE.HemisphereLight;
  tex!: TextureSet;
  mioRock!: THREE.Mesh;
  mioRockTop = 0;
  private dread = 0;
  private dreadTarget = 0;
  private warmth = 0.3;
  private bellSwing = 0;
  readonly fogDensity = 0.0135;

  async build(preset: QualityPreset, quality: 'low' | 'medium' | 'high', progress: (p: number, label: string) => Promise<void>): Promise<void> {
    const s = this.scene;
    s.fog = new THREE.FogExp2(FOG_COLOR.getHex(), this.fogDensity);
    s.background = FOG_COLOR.clone();
    await progress(0.05, 'Painting textures');
    this.tex = makeTextures(quality);

    await progress(0.15, 'Raising the mountains');
    this.sky = new Sky(s);
    this.moon = new THREE.DirectionalLight('#b4c6ea', 2.1);
    this.moon.position.copy(MOON_DIR).multiplyScalar(80);
    this.moon.castShadow = preset.shadows;
    this.moon.shadow.mapSize.set(preset.shadowMap, preset.shadowMap);
    const sc = this.moon.shadow.camera;
    sc.left = -42; sc.right = 42; sc.top = 42; sc.bottom = -42; sc.near = 1; sc.far = 220;
    this.moon.shadow.bias = -0.0008;
    this.moon.shadow.normalBias = 0.04;
    s.add(this.moon, this.moon.target);
    this.hemi = new THREE.HemisphereLight('#6a80a8', '#2a2219', 1.25);
    s.add(this.hemi);
    s.add(new THREE.AmbientLight('#2e3b58', 0.55));

    await progress(0.25, 'Shaping Amahara Valley');
    const terrain = buildTerrain(preset.terrainSegments, this.tex, { uTime: this.uTime });
    s.add(terrain);

    await progress(0.4, 'Filling the river');
    this.river = new River(this.fogDensity);
    s.add(this.river.group);
    this.buildMioRock(preset.shadows);

    await progress(0.55, 'Growing the Whispering Forest');
    const veg = buildVegetation({ trees: preset.trees, grass: preset.grass, tex: this.tex, uTime: this.uTime, collision: this.collision, shadows: preset.shadows });
    s.add(veg.group);

    await progress(0.75, 'Building the village');
    this.village = buildVillage(this.tex, this.collision, preset.shadows, quality === 'low' ? 2 : quality === 'medium' ? 3 : 5);
    s.add(this.village.group);

    await progress(0.88, 'Calling the storm');
    this.weather = new Weather(s, preset.rain);
  }

  private buildMioRock(shadows: boolean): void {
    const g = new THREE.IcosahedronGeometry(1.6, 3);
    const n = new Simplex2(5);
    const p = g.attributes['position'] as THREE.BufferAttribute;
    for (let i = 0; i < p.count; i++) {
      const v = new THREE.Vector3(p.getX(i), p.getY(i), p.getZ(i));
      v.multiplyScalar(1 + n.fbm(v.x, v.y + v.z, 3) * 0.25);
      if (v.y > 0.35) v.y = 0.35 + (v.y - 0.35) * 0.25; // flattish top to stand on
      p.setXYZ(i, v.x * 1.15, v.y, v.z);
    }
    g.computeVertexNormals();
    const mat = new THREE.MeshStandardMaterial({ map: this.tex.stone, color: '#8a8780', roughness: 0.7 });
    this.mioRock = new THREE.Mesh(g, mat);
    const { x, z } = PLACES.mioRock;
    this.mioRock.position.set(x, 0.15, z);
    this.mioRock.castShadow = shadows; this.mioRock.receiveShadow = true;
    this.mioRockTop = 0.15 + 0.42;
    this.scene.add(this.mioRock);
    this.collision.add({ kind: 'circle', x, z, r: 1.5, y0: -5, y1: this.mioRockTop - 0.3, tag: 'mio-rock' });
  }

  surfaces(): Surfaces {
    return {
      ground: (x, z) => {
        let h = heightAt(x, z);
        const d = this.village.bridgeDeck(x, z);
        if (d !== null) h = Math.max(h, d);
        if (Math.hypot(x - PLACES.mioRock.x, z - PLACES.mioRock.z) < 1.5) h = Math.max(h, this.mioRockTop);
        return h;
      },
      water: (x, z) => {
        if (Math.abs(x - riverX(z)) > riverHalfWidth(z) + 0.6) return null;
        return this.river.surfaceAt(z);
      },
    };
  }

  /** Flip world set pieces from the consequence list (data from the sim, never decided here). */
  applyConsequences(ids: Set<string>, flags: Record<string, unknown>): void {
    const sp = this.village.setPieces;
    const bridgeBroken = ids.has('bridge_broken');
    sp['bridge_intact']!.visible = !bridgeBroken;
    sp['bridge_broken']!.visible = bridgeBroken;
    const millDamaged = ids.has('mill_damaged');
    sp['mill_intact']!.visible = !millDamaged;
    sp['mill_damaged']!.visible = millDamaged;
    const weirBroken = flags['flood_outcome'] === 'weir';
    sp['weir_intact']!.visible = !weirBroken;
    sp['weir_broken']!.visible = weirBroken;
    this.river.setWeirIntact(!weirBroken);
    sp['river_shrine']!.visible = ids.has('river_shrine');
    sp['warden_bells']!.visible = ids.has('warden_bells');
    const shut = ids.has('village_shuttered');
    this.village.shutters.visible = shut;
    this.village.warmLanterns.visible = ids.has('village_warm');
    this.dreadTarget = shut ? 1 : 0;
    this.warmth = ids.has('village_warm') ? 1 : 0.3;
  }

  ringWardenBells(): void { this.bellSwing = 1; }

  get dreadLevel(): number { return this.dread; }

  update(dt: number, time: number, camPos: THREE.Vector3, focus: THREE.Vector3): void {
    this.uTime.value = time;
    this.weather.update(dt, time, camPos);
    const flash = this.weather.flash;
    this.river.update(dt, time, flash);
    this.sky.update(time, flash, camPos, this.dread);
    this.dread += (this.dreadTarget - this.dread) * Math.min(1, dt * 0.5);
    // lantern mood: warm amber when loved, cold blue when feared
    const lm = this.village.mats['lantern']!;
    const warm = new THREE.Color('#ff9a42'), cold = new THREE.Color('#4f7cff');
    lm.emissive.copy(warm).lerp(cold, this.dread);
    lm.emissiveIntensity = 2.0 + this.warmth * 0.6 + Math.sin(time * 9) * 0.08;
    this.village.mats['shoji']!.emissiveIntensity = 1.1 * (1 - this.dread * 0.85);
    for (const L of this.village.lanternLights) {
      L.color.copy(warm).lerp(cold, this.dread);
      L.intensity = (8 + Math.sin(time * 11 + L.position.x) * 0.6) * (1 - this.dread * 0.4);
    }
    this.hemi.intensity = 1.25 + flash * 2.2;
    this.moon.intensity = 2.1 + flash * 3.5;
    // keep the shadow frustum centred on the action
    this.moon.target.position.copy(focus);
    this.moon.position.copy(focus).addScaledVector(MOON_DIR, 90);
    if (this.village.wheel) this.village.wheel.rotation.x -= dt * (0.6 + this.river.flood * 1.4);
    // warden bells sway
    this.bellSwing = Math.max(0, this.bellSwing - dt * 0.4);
    this.village.bells.forEach((b, i) => { b.rotation.z = Math.sin(time * 3 + i) * (0.05 + this.bellSwing * 0.5); });
    this.weather.setCalm(1 - this.dread);
  }

  waterfallDistance(p: THREE.Vector3): number {
    return Math.hypot(p.x - riverX(WATERFALL_Z), p.z - WATERFALL_Z);
  }
}
