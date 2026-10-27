// A tiny "construction kit": accumulates transformed geometry per material and
// merges it into a few meshes, so procedural buildings stay cheap to draw.

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

export type MatKey = string;

export class Kit {
  private parts = new Map<MatKey, THREE.BufferGeometry[]>();
  private stack: THREE.Matrix4[] = [new THREE.Matrix4()];
  constructor(private mats: Record<MatKey, THREE.Material>) {}

  get top(): THREE.Matrix4 { return this.stack[this.stack.length - 1]!; }

  push(x = 0, y = 0, z = 0, rotY = 0, rotX = 0, rotZ = 0, scale = 1): this {
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
      new THREE.Vector3(scale, scale, scale),
    );
    this.stack.push(this.top.clone().multiply(m));
    return this;
  }
  pop(): this { if (this.stack.length > 1) this.stack.pop(); return this; }

  add(mat: MatKey, geo: THREE.BufferGeometry, x = 0, y = 0, z = 0, rotY = 0, rotX = 0, rotZ = 0): this {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    if (!g.attributes['uv']) g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array((g.attributes['position'] as THREE.BufferAttribute).count * 2), 2));
    if (!g.attributes['normal']) g.computeVertexNormals();
    for (const k of Object.keys(g.attributes)) if (!['position', 'normal', 'uv'].includes(k)) g.deleteAttribute(k);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(x, y, z),
      new THREE.Quaternion().setFromEuler(new THREE.Euler(rotX, rotY, rotZ, 'YXZ')),
      new THREE.Vector3(1, 1, 1),
    );
    g.applyMatrix4(this.top.clone().multiply(m));
    let l = this.parts.get(mat);
    if (!l) this.parts.set(mat, (l = []));
    l.push(g);
    return this;
  }

  /** Box with world-scaled UVs (so textures don't stretch). */
  box(mat: MatKey, w: number, h: number, d: number, x: number, y: number, z: number, rotY = 0, rotX = 0, rotZ = 0, uvScale = 1): this {
    const g = new THREE.BoxGeometry(w, h, d);
    scaleBoxUV(g, w, h, d, uvScale);
    return this.add(mat, g, x, y, z, rotY, rotX, rotZ);
  }

  cyl(mat: MatKey, rTop: number, rBot: number, h: number, x: number, y: number, z: number, seg = 8, rotX = 0, rotZ = 0, rotY = 0): this {
    return this.add(mat, new THREE.CylinderGeometry(rTop, rBot, h, seg), x, y, z, rotY, rotX, rotZ);
  }

  build(name = 'kit', shadows = true): THREE.Group {
    const g = new THREE.Group();
    g.name = name;
    for (const [key, geos] of this.parts) {
      const merged = mergeGeometries(geos);
      if (!merged) continue;
      merged.computeBoundingSphere();
      const mesh = new THREE.Mesh(merged, this.mats[key]);
      mesh.castShadow = shadows; mesh.receiveShadow = true;
      mesh.name = `${name}:${key}`;
      g.add(mesh);
    }
    this.parts.clear();
    return g;
  }
}

export function scaleBoxUV(g: THREE.BoxGeometry, w: number, h: number, d: number, s = 1): void {
  const uv = g.attributes['uv'] as THREE.BufferAttribute;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z ; 4 verts each
  const dims: [number, number][] = [[d, h], [d, h], [w, d], [w, d], [w, h], [w, h]];
  for (let f = 0; f < 6; f++) {
    const [a, b] = dims[f]!;
    for (let v = 0; v < 4; v++) {
      const i = f * 4 + v;
      uv.setXY(i, uv.getX(i) * a * s * 0.5, uv.getY(i) * b * s * 0.5);
    }
  }
}
