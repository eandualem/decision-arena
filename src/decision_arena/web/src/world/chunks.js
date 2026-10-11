// WORLD: streaming of 50 m scenery chunks. Chunk objects (4 meshes each) are pooled and their geometry buffers
// are rewritten in place, so streaming allocates nothing after warm-up.
import * as THREE from 'three';
import { GeoBuilder } from './builder.js';
import { CHUNK } from './scenery.js';

const KEYS = ['o', 'n', 'c', 'g'];
export const kOf = (z) => Math.floor(-z / CHUNK);

export class Chunks {
  constructor(scene, scenery, mats) {
    this.root = new THREE.Group();
    this.root.name = 'world-chunks';
    scene.add(this.root);
    this.scenery = scenery;
    this.mats = mats;
    this.active = new Map();
    this.free = [];
    this.glowVisible = false;
    this.B = { o: new GeoBuilder(60000, 90000), n: new GeoBuilder(30000, 45000), c: new GeoBuilder(8000, 12000), g: new GeoBuilder(8000, 12000) };
    this.stats = { built: 0, lastMs: 0, maxMs: 0 };
    this._want = [];
  }
  _make() {
    const c = { k: null, meshes: {} };
    for (const key of KEYS) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), this.mats[key]);
      m.matrixAutoUpdate = false;
      m.name = 'chunk-' + key;
      if (key === 'o') m.receiveShadow = true;
      if (key === 'n' || key === 'c') { m.castShadow = true; m.receiveShadow = true; }
      if (key === 'g') m.renderOrder = 5;
      c.meshes[key] = m;
      this.root.add(m);
    }
    return c;
  }
  build(k) {
    const t0 = performance.now();
    const c = this.free.pop() || this._make();
    for (const key of KEYS) this.B[key].reset();
    this.scenery.build(k, this.B);
    for (const key of KEYS) {
      const m = c.meshes[key];
      this.B[key].toGeometry(m.geometry, 6);
      m.visible = this.B[key].ni > 0 && (key !== 'g' || this.glowVisible);
    }
    c.k = k;
    this.active.set(k, c);
    const ms = performance.now() - t0;
    this.stats.built++; this.stats.lastMs = ms; this.stats.maxMs = Math.max(this.stats.maxMs, ms);
    return c;
  }
  release(k) {
    const c = this.active.get(k);
    if (!c) return;
    for (const key of KEYS) c.meshes[key].visible = false;
    this.active.delete(k);
    this.free.push(c);
  }
  clear() { for (const k of [...this.active.keys()]) this.release(k); }
  /** Keep chunks kMin..kMax. Builds missing ones (nearest to kFocus first), at most `budget` per call. */
  update(kMin, kMax, kFocus, budget = 1) {
    for (const k of [...this.active.keys()]) if (k < kMin || k > kMax) this.release(k);
    const want = this._want; want.length = 0;
    for (let k = kMin; k <= kMax; k++) if (!this.active.has(k)) want.push(k);
    if (!want.length) return 0;
    want.sort((a, b) => Math.abs(a - kFocus) - Math.abs(b - kFocus));
    let n = 0;
    for (const k of want) { if (n >= budget) break; this.build(k); n++; }
    return want.length - n;
  }
  setGlowVisible(v) {
    this.glowVisible = v;
    for (const c of this.active.values()) {
      const m = c.meshes.g;
      m.visible = v && m.geometry.drawRange.count > 0;
    }
  }
  /** Scene statistics for debugging: vertices / triangles of active chunks. */
  counts() {
    let tris = 0, verts = 0;
    for (const c of this.active.values()) for (const key of KEYS) {
      const g = c.meshes[key].geometry;
      tris += (g.drawRange.count === Infinity ? 0 : g.drawRange.count) / 3;
      verts += g.getAttribute('position')?.count || 0;
    }
    return { chunks: this.active.size, tris: Math.round(tris), verts };
  }
}
