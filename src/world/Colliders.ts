// Lightweight 2.5D collision: circles and oriented boxes on the XZ plane, with height ranges.

export interface Circle { kind: 'circle'; x: number; z: number; r: number; y0: number; y1: number; tag?: string }
export interface Box { kind: 'box'; x: number; z: number; hx: number; hz: number; rot: number; y0: number; y1: number; tag?: string }
export type Collider = Circle | Box;

export class CollisionWorld {
  private cells = new Map<string, Collider[]>();
  private all: Collider[] = [];
  private cell = 8;

  add(c: Collider): Collider {
    this.all.push(c);
    const r = c.kind === 'circle' ? c.r : Math.hypot(c.hx, c.hz);
    const x0 = Math.floor((c.x - r) / this.cell), x1 = Math.floor((c.x + r) / this.cell);
    const z0 = Math.floor((c.z - r) / this.cell), z1 = Math.floor((c.z + r) / this.cell);
    for (let i = x0; i <= x1; i++) for (let j = z0; j <= z1; j++) {
      const k = `${i},${j}`;
      let l = this.cells.get(k);
      if (!l) this.cells.set(k, (l = []));
      l.push(c);
    }
    return c;
  }

  removeTag(tag: string): void {
    this.all = this.all.filter((c) => c.tag !== tag);
    for (const [k, l] of this.cells) this.cells.set(k, l.filter((c) => c.tag !== tag));
  }

  near(x: number, z: number): Collider[] {
    const i = Math.floor(x / this.cell), j = Math.floor(z / this.cell);
    const out: Collider[] = [];
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) {
      const l = this.cells.get(`${i + a},${j + b}`);
      if (l) for (const c of l) if (!out.includes(c)) out.push(c);
    }
    return out;
  }

  /** Push a circle of radius r at (x,z) out of all colliders overlapping height y. */
  resolve(x: number, z: number, r: number, y: number): { x: number; z: number; hit: boolean } {
    let hit = false;
    for (let iter = 0; iter < 3; iter++) {
      let moved = false;
      for (const c of this.near(x, z)) {
        if (y + 0.2 < c.y0 || y > c.y1) continue;
        if (c.kind === 'circle') {
          const dx = x - c.x, dz = z - c.z;
          const d = Math.hypot(dx, dz);
          const min = r + c.r;
          if (d < min && d > 1e-5) { x = c.x + (dx / d) * min; z = c.z + (dz / d) * min; moved = hit = true; }
        } else {
          const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
          const lx = (x - c.x) * cs - (z - c.z) * sn;
          const lz = (x - c.x) * sn + (z - c.z) * cs;
          const qx = Math.max(-c.hx, Math.min(c.hx, lx));
          const qz = Math.max(-c.hz, Math.min(c.hz, lz));
          const dx = lx - qx, dz = lz - qz;
          const d = Math.hypot(dx, dz);
          if (d < r) {
            let nx: number, nz: number;
            if (d > 1e-5) { nx = qx + (dx / d) * r; nz = qz + (dz / d) * r; }
            else {
              // inside: push out along the shallowest axis
              const px = c.hx - Math.abs(lx), pz = c.hz - Math.abs(lz);
              if (px < pz) { nx = Math.sign(lx || 1) * (c.hx + r); nz = lz; } else { nx = lx; nz = Math.sign(lz || 1) * (c.hz + r); }
            }
            const cs2 = Math.cos(c.rot), sn2 = Math.sin(c.rot);
            x = c.x + nx * cs2 - nz * sn2;
            z = c.z + nx * sn2 + nz * cs2;
            moved = hit = true;
          }
        }
      }
      if (!moved) break;
    }
    return { x, z, hit };
  }

  /** Top of any walkable collider (e.g. bridge decks are handled separately). */
  rayBlocks(ax: number, ay: number, az: number, bx: number, by: number, bz: number): number {
    // Returns fraction t (0..1) at which the segment first enters a collider, or 1.
    let best = 1;
    const steps = 16;
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      const x = ax + (bx - ax) * t, y = ay + (by - ay) * t, z = az + (bz - az) * t;
      for (const c of this.near(x, z)) {
        if (y < c.y0 || y > c.y1) continue;
        let inside = false;
        if (c.kind === 'circle') inside = Math.hypot(x - c.x, z - c.z) < c.r + 0.3;
        else {
          const cs = Math.cos(-c.rot), sn = Math.sin(-c.rot);
          const lx = (x - c.x) * cs - (z - c.z) * sn, lz = (x - c.x) * sn + (z - c.z) * cs;
          inside = Math.abs(lx) < c.hx + 0.3 && Math.abs(lz) < c.hz + 0.3;
        }
        if (inside) { best = Math.min(best, (s - 1) / steps); break; }
      }
      if (best < 1) break;
    }
    return best;
  }
}
