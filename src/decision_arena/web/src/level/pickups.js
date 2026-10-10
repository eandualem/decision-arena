// Pickups: floating, rotating 3D collectibles with a soft glow halo. One BatchedMesh for every model
// (power-ups, mystery box, key, token, 26 letter tiles) + halos in the shared additive glow layer.
import * as THREE from 'three';
import { buildPickupAtlas } from './art.js';
import { buildPickups } from './models.js';

export const PICKUP_COLOR = {
  jetpack: 0xff7a1a, sneakers: 0x39d353, magnet: 0xff3b5c, multiplier: 0xffd23f, pogo: 0xb86bff,
  mysteryBox: 0x9b6bff, key: 0x3ab7ff, letter: 0x39e0ff, token: 0xff4fa3, hoverboardItem: 0xff4fa3,
};
const EMPTY = Object.freeze([]);
const _m = new THREE.Matrix4(), _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _e = new THREE.Euler();

export class PickupField {
  constructor(ctx, root, glow) {
    this.ctx = ctx;
    this.glow = glow;
    const KA = buildPickupAtlas(ctx.quality || 'high');
    const G = buildPickups(KA);
    const geos = {};
    for (const [k, g] of Object.entries(G)) if (k !== 'letters') geos[k] = g;
    for (const [ch, g] of Object.entries(G.letters)) geos['L' + ch] = g;
    geos.hoverboardItem = geos.token;
    let v = 0, i = 0;
    for (const g of Object.values(geos)) { v += g.attributes.position.count; i += g.index.count; }
    this.mat = new THREE.MeshStandardMaterial({
      map: KA.map, emissiveMap: KA.emissiveMap, emissive: 0xffffff, emissiveIntensity: 1.25,
      vertexColors: true, roughness: 0.34, metalness: 0.12,
    });
    this.mat.name = 'level-pickup';
    this.mesh = new THREE.BatchedMesh(48, v, i, this.mat);
    this.mesh.name = 'level-pickups';
    this.mesh.frustumCulled = false;
    this.mesh.sortObjects = false;
    this.mesh.castShadow = (ctx.quality || 'high') !== 'low';
    this.gid = {};
    const seen = new Map();
    for (const [k, g] of Object.entries(geos)) {
      if (seen.has(g)) { this.gid[k] = seen.get(g); continue; }
      const id = this.mesh.addGeometry(g); this.gid[k] = id; seen.set(g, id);
    }
    root.add(this.mesh);
    this.list = [];
    this.pool = [];
  }

  add(type, x, y, z, letter) {
    const key = type === 'letter' ? 'L' + String(letter || 'A').toUpperCase()[0] : type;
    const gid = this.gid[key] ?? (type === 'letter' ? this.gid.LA : null);
    if (gid == null || this.list.length >= 46) return null;
    const p = this.pool.pop() || {};
    p.type = type; p.letter = letter || null; p.x = x; p.y = y; p.z = z;
    p.id = this.mesh.addInstance(gid);
    p.phase = (x * 1.7 + z * 0.37) % 6.28;
    p.glow = this.glow.alloc(PICKUP_COLOR[type] ?? 0xffffff, 1.9);
    p.glow.a = 0.9;
    this.list.push(p);
    return p;
  }

  _kill(i) {
    const p = this.list[i];
    this.mesh.deleteInstance(p.id);
    this.glow.release(p.glow);
    p.glow = null;
    this.list[i] = this.list[this.list.length - 1];
    this.list.pop();
    this.pool.push(p);
  }

  clear() { for (let i = this.list.length - 1; i >= 0; i--) this._kill(i); }

  update(dt, pz, time) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.z > pz + 40) { this._kill(i); continue; }
      const t = time + p.phase;
      const bob = Math.sin(t * 2.6) * 0.1;
      const s = 1 + Math.sin(t * 5.2) * 0.03;
      let tilt = 0;
      if (p.type === 'key' || p.type === 'magnet' || p.type === 'pogo') tilt = 0.18;
      _e.set(tilt * Math.sin(t * 1.3), t * 2.1, 0);
      _q.setFromEuler(_e);
      _p.set(p.x, p.y + bob, p.z); _s.set(s, s, s);
      this.mesh.setMatrixAt(p.id, _m.compose(_p, _q, _s));
      const gl = p.glow;
      if (gl) { gl.x = p.x; gl.y = p.y + bob; gl.z = p.z - 0.15; gl.size = 1.85 + Math.sin(t * 3.1) * 0.18; }
    }
    void dt;
  }

  collect(box) {
    let out = null;
    const m = 0.5;
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      if (p.x > box.minX - m && p.x < box.maxX + m && p.y > box.minY - m && p.y < box.maxY + m && p.z > box.minZ - m && p.z < box.maxZ + m) {
        const r = { type: p.type, x: p.x, y: p.y, z: p.z };
        if (p.letter) r.letter = p.letter;
        (out || (out = [])).push(r);
        this._kill(i);
      }
    }
    return out || EMPTY;
  }
}
