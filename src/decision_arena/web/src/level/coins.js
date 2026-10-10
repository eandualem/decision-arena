// Coins: one InstancedMesh (gold coin with a raised rim and an embossed star), spinning in sync.
// Visible coins are compacted into the instance buffer every frame (no allocations). Magnet: coins in range
// home in on the runner along a curved path that accelerates, and are returned by collect() on arrival.
import * as THREE from 'three';
import { buildCoin } from './models.js';
import { buildCoinTextures } from './art.js';
import { MAGNET } from '../config.js';

const CAP = 1100;
const HOME_T = 0.34;            // seconds for a magnet coin to reach the runner
const EMPTY = Object.freeze([]);

export class CoinField {
  constructor(ctx, root) {
    this.ctx = ctx;
    const q = ctx.quality || 'high';
    const tex = buildCoinTextures(q);
    this.mat = new THREE.MeshStandardMaterial({
      map: tex.map, bumpMap: tex.bumpMap, bumpScale: 3.2,
      emissive: 0xffa800, emissiveMap: tex.map, emissiveIntensity: 0.32,
      metalness: 0.35, roughness: 0.34,
    });
    this.mat.name = 'level-coin';
    this.mesh = new THREE.InstancedMesh(buildCoin(q), this.mat, CAP);
    this.mesh.name = 'level-coins';
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = q === 'high';
    this.mesh.count = 0;
    root.add(this.mesh);
    this.list = [];
    this.pool = [];
    this.spin = 0;
  }

  add(x, y, z, sky = false) {
    if (this.list.length >= CAP) return null;
    const c = this.pool.pop() || {};
    c.x = x; c.y = y; c.z = z; c.sky = sky; c.homing = false; c.tau = 0; c.sx = 0; c.sy = 0; c.sz = 0; c.slot = -1; c.side = 0;
    this.list.push(c);
    return c;
  }

  clear() {
    for (const c of this.list) this.pool.push(c);
    this.list.length = 0;
    this.mesh.count = 0;
  }

  _kill(i) {
    const c = this.list[i];
    if (c.slot >= 0) this._hideSlot(c.slot);
    this.list[i] = this.list[this.list.length - 1];
    this.list.pop();
    this.pool.push(c);
  }
  _hideSlot(slot) {
    const a = this.mesh.instanceMatrix.array, o = slot * 16;
    a[o] = a[o + 5] = a[o + 10] = 0;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
  _write(slot, c, spin, scale) {
    const a = this.mesh.instanceMatrix.array, o = slot * 16;
    const cs = Math.cos(spin) * scale, sn = Math.sin(spin) * scale;
    a[o] = cs; a[o + 1] = 0; a[o + 2] = -sn; a[o + 3] = 0;
    a[o + 4] = 0; a[o + 5] = scale; a[o + 6] = 0; a[o + 7] = 0;
    a[o + 8] = sn; a[o + 9] = 0; a[o + 10] = cs; a[o + 11] = 0;
    a[o + 12] = c.x; a[o + 13] = c.y; a[o + 14] = c.z; a[o + 15] = 1;
  }

  /** despawn behind, compact visible coins into the instance buffer, spin */
  update(dt, pz) {
    this.spin += dt * 3.4;
    const L = this.list;
    let n = 0;
    for (let i = L.length - 1; i >= 0; i--) {
      const c = L[i];
      if (c.z > pz + 40) { c.slot = -1; this.list[i] = L[L.length - 1]; L.pop(); this.pool.push(c); continue; }
      if (c.z < pz - 210 || n >= CAP) { c.slot = -1; continue; }
      c.slot = n;
      this._write(n, c, c.homing ? this.spin * 3 : this.spin, c.homing ? Math.max(0.35, 1 - c.tau / HOME_T * 0.55) : 1);
      n++;
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  /** Remove + return coins the runner touches (and magnet coins that arrive). */
  collect(box, opts, dt) {
    let out = null;
    const cx = (box.minX + box.maxX) / 2, cy = (box.minY + box.maxY) * 0.5, cz = (box.minZ + box.maxZ) / 2;
    const m = 0.35;
    const magnet = !!(opts && opts.magnet);
    const R = MAGNET.radius;
    const L = this.list;
    for (let i = L.length - 1; i >= 0; i--) {
      const c = L[i];
      if (magnet && !c.homing) {
        const dx = c.x - cx, dz = c.z - cz, dy = c.y - cy;
        if (dz > -R && dz < 3 && dx * dx + dz * dz < R * R && dy > -4 && dy < 4.5) {
          c.homing = true; c.tau = 0; c.sx = c.x; c.sy = c.y; c.sz = c.z; c.side = dx >= 0 ? 1 : -1;
          c.owner = opts.owner;   // Decision Arena: only the runner whose magnet pulled it moves and takes it
        }
      }
      if (c.homing) {
        if (c.owner !== undefined && opts && opts.owner !== c.owner) continue;
        c.tau += dt;
        const t = Math.min(1, c.tau / HOME_T);
        const h = t * t * (1.6 - 0.6 * t);                // accelerating ease
        const arc = Math.sin(Math.PI * h);
        c.x = c.sx + (cx - c.sx) * h + c.side * arc * 0.35;
        c.y = c.sy + (cy - c.sy) * h + arc * 0.9;
        c.z = c.sz + (cz - c.sz) * h;
        if (c.slot >= 0) { this._write(c.slot, c, this.spin * 3, Math.max(0.35, 1 - t * 0.55)); this.mesh.instanceMatrix.needsUpdate = true; }
        if (t >= 1) {
          (out || (out = [])).push({ type: 'coin', x: c.x, y: c.y, z: c.z, magnet: true, sky: c.sky });
          this._kill(i);
        }
        continue;
      }
      if (c.x > box.minX - m && c.x < box.maxX + m && c.y > box.minY - m && c.y < box.maxY + m && c.z > box.minZ - m && c.z < box.maxZ + m) {
        (out || (out = [])).push({ type: 'coin', x: c.x, y: c.y, z: c.z, magnet: false, sky: c.sky });
        this._kill(i);
      }
    }
    return out || EMPTY;
  }
}
