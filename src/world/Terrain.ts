// Terrain mesh built from the analytic height field, painted by slope, wetness and paths.

import * as THREE from 'three';
import { WORLD, heightAt, normalAt, pathMask, villageMask, distToRiver, PLACES, WATERFALL_Z } from './layout.js';
import { Simplex2, smoothstep } from './noise.js';
import type { TextureSet } from './textures.js';

const n = new Simplex2(77);

export function buildTerrain(segments: number, tex: TextureSet, shared: { uTime: THREE.IUniform }): THREE.Mesh {
  const w = WORLD.maxX - WORLD.minX, d = WORLD.maxZ - WORLD.minZ;
  const segX = segments, segZ = Math.round(segments * (d / w));
  const geo = new THREE.PlaneGeometry(w, d, segX, segZ);
  geo.rotateX(-Math.PI / 2);
  geo.translate(WORLD.minX + w / 2, 0, WORLD.minZ + d / 2);
  const pos = geo.attributes['position'] as THREE.BufferAttribute;
  const colors = new Float32Array(pos.count * 3);
  const wet = new Float32Array(pos.count);
  const grass = new THREE.Color('#34422a'), grass2 = new THREE.Color('#485233'), moss = new THREE.Color('#263620');
  const dirt = new THREE.Color('#5a4936'), rock = new THREE.Color('#57544f'), mud = new THREE.Color('#3b342b');
  const packed = new THREE.Color('#665643'), needles = new THREE.Color('#3f2f22');
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    const h = heightAt(x, z);
    pos.setY(i, h);
    const [, ny] = normalAt(x, z);
    const slope = 1 - ny;
    const v = n.fbm(x * 0.06, z * 0.06, 3) * 0.5 + 0.5;
    c.copy(grass).lerp(grass2, v);
    // forest floor under the cedars (west bank) is darker, needle-covered
    const west = smoothstep(0, -30, x - 4);
    c.lerp(needles, west * 0.35 * (0.6 + v * 0.4));
    c.lerp(moss, smoothstep(0.35, 0.75, n.fbm(x * 0.02 + 5, z * 0.02, 3) * 0.5 + 0.5) * 0.5);
    const vm = villageMask(x, z);
    c.lerp(packed, vm * 0.35);
    const pm = pathMask(x, z);
    c.lerp(dirt, pm * 0.9);
    const dr = distToRiver(x, z);
    const bank = 1 - smoothstep(-0.5, 4.5, dr);
    c.lerp(mud, bank * 0.85);
    c.lerp(rock, smoothstep(0.28, 0.55, slope));
    const cliff = 1 - smoothstep(2, 10, Math.abs(z - WATERFALL_Z));
    c.lerp(rock, cliff * smoothstep(-2, 30, -Math.abs(dr)) * 0.8);
    const shrineD = Math.hypot(x - PLACES.shrine.x, z - PLACES.shrine.z);
    c.lerp(moss, (1 - smoothstep(6, 16, shrineD)) * 0.6);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
    wet[i] = Math.max(bank, pm * 0.5);
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.setAttribute('aWet', new THREE.BufferAttribute(wet, 1));
  geo.computeVertexNormals();

  const mat = new THREE.MeshStandardMaterial({
    vertexColors: true, roughness: 0.92, metalness: 0, map: tex.ground,
  });
  mat.onBeforeCompile = (shader) => {
    shader.uniforms['uTime'] = shared.uTime;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute float aWet; varying float vWet; varying vec3 vWorldP;')
      .replace('#include <uv_vertex>', '#include <uv_vertex>\n vWet = aWet; vWorldP = (modelMatrix * vec4(position,1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying float vWet; varying vec3 vWorldP; uniform float uTime;')
      .replace('#include <map_fragment>', `
        vec4 g1 = texture2D(map, vWorldP.xz * 0.11);
        vec4 g2 = texture2D(map, vWorldP.xz * 0.023 + 0.37);
        float grain = g1.r * 0.6 + g2.r * 0.6;
        diffuseColor.rgb *= 0.55 + grain * 0.55;
        diffuseColor.rgb *= 1.0 - vWet * 0.38;
      `)
      .replace('#include <roughnessmap_fragment>', `
        #include <roughnessmap_fragment>
        roughnessFactor = mix(roughnessFactor, 0.62, vWet * 0.8);
      `);
  };
  const mesh = new THREE.Mesh(geo, mat);
  mesh.receiveShadow = true;
  mesh.name = 'terrain';
  return mesh;
}
