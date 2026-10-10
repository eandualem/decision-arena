// WORLD: procedural side scenery. Each 50 m chunk gets, per side, a "zone" (retaining wall, yard, station,
// street, industrial, park) plus a far layer of tall buildings; some chunks get a bridge spanning the tracks.
// Geometry goes into 4 builders: o (opaque, receives shadows), n (near casters), c (alpha-tested cutouts),
// g (additive night glow). Side s = +1 (right, x > 0) or -1 (left); u = distance from the track center (x = s * u).
import * as THREE from 'three';
import { lin, shade, mixc, makeTemplate } from './builder.js';
import { mulberry } from './graffiti.js';
import { GRAFFITI_COUNT, BILLBOARD_COUNT, WINDOW_COUNT } from './textures.js';
import { TRACK } from '../config.js';

export const CHUNK = 50;
const CORR = TRACK.corridorHalfWidth;       // 4.8: nothing above y 0.3 inside |x| < 4.8
const BRIDGE_Y = TRACK.overheadClearance + 0.4;
const GROUND = -0.14;

const PAL = {
  brick: [0xc7654a, 0xb85a44, 0xd98a5c, 0xa86b52, 0xe3b98e, 0xb07c68, 0xc9725e],
  stucco: [0xf3e1c1, 0xf7c9b0, 0xb9e0dc, 0xf4d67e, 0xdcc8ec, 0xf2a894, 0xaed0ee, 0xfaf4ea],
  siding: [0xe8e0d0, 0x9fd6cc, 0xf6bca4, 0xc9d8f0, 0xf2e3a0],
  warehouse: [0x9aa3ad, 0x5f8fa8, 0xc85a3c, 0x7faa6c, 0xe6d7b0, 0x4f7fae, 0xd9a24a],
  container: [0xe8492f, 0x2f6fd0, 0x19a3a1, 0xf5b82e, 0x7ac943, 0xff8a1f, 0x8a5cd6, 0xd8dcdf, 0xc23a5a, 0x2d8f5a],
  far: [0xb8c6d8, 0xd8cfc0, 0xcdb8cc, 0xa8c4c8, 0xe6d6bc, 0xa3b8d8, 0xc8d6c0, 0xe8c4b0],
  trim: [0xf2ede4, 0x2e3a4a, 0x19b3b1, 0xf2553d, 0x3a6fd8, 0xffc93c],
  canopy: [0x19b3b1, 0xf2553d, 0x3a6fd8, 0xffc93c, 0x8b5cf6],
};
const WALL_TILE = { brick: 2.2, stucco: 3, siding: 2.5, tiles: 1.6, corrugated: 2.4, concrete: 3.2 };

const TF = (s) => (s > 0 ? 'nx' : 'px');
const BF = (s) => (s > 0 ? 'px' : 'nx');
function fz(s, o) {
  return { [TF(s)]: o.t ?? null, [BF(s)]: o.b ?? null, pz: o.near ?? null, nz: o.far ?? null, py: o.top ?? null, ny: o.bottom ?? null };
}
function hashK(seed, k) { let h = (seed ^ Math.imul(k + 7919, 2654435761)) >>> 0; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); return (h ^ (h >>> 16)) >>> 0; }

export class Scenery {
  constructor(atlas, quality) {
    this.A = atlas;
    this.quality = quality;
    const names = ['white', 'gravel', 'asphalt', 'sidewalk', 'grass', 'dirt', 'platformTop', 'platformEdge', 'concrete', 'brick', 'stucco',
      'siding', 'corrugated', 'tiles', 'roof', 'metal', 'wood', 'container', 'containerDoor', 'pillar', 'shop0', 'shop1', 'door', 'garage',
      'cabinet', 'ac', 'vending', 'clock', 'signal', 'far0', 'far1', 'awning0', 'awning1', 'awning2'];
    this.r = {};
    for (const n of names) this.r[n] = atlas.R(n);
    this.graf = Array.from({ length: GRAFFITI_COUNT }, (_, i) => atlas.R('graf' + i));
    this.win = Array.from({ length: WINDOW_COUNT }, (_, i) => atlas.R('win' + i));
    this.bb = Array.from({ length: BILLBOARD_COUNT }, (_, i) => atlas.R('bb' + i));
    this.sign = Array.from({ length: 8 }, (_, i) => atlas.R('sign' + i));
    this.poster = Array.from({ length: 4 }, (_, i) => atlas.R('poster' + i));
    const cn = ['chainlink', 'barbed', 'railing', 'grate', 'truss', 'leaves0', 'leaves1', 'tuft', 'glow', 'pool', 'shopLit', 'farLit0', 'farLit1', 'sparkle', 'beam', 'wash'];
    this.c = {};
    for (const n of cn) this.c[n] = atlas.C(n);
    this.winLit = [0, 1, 2].map((i) => atlas.C('winLit' + i));
    this.signGlow = Array.from({ length: 8 }, (_, i) => atlas.C('signGlow' + i));
    // templates
    this.tBlob = makeTemplate(new THREE.IcosahedronGeometry(1, 1), { jitter: 0.28, seed: 3 });
    this.tBlob2 = makeTemplate(new THREE.IcosahedronGeometry(1, 1), { jitter: 0.32, seed: 11 });
    this.tCone = makeTemplate(new THREE.ConeGeometry(1, 1, 8, 1).translate(0, 0.5, 0));
    this.tPine = makeTemplate(new THREE.ConeGeometry(1, 1, 7, 1).translate(0, 0.5, 0), { jitter: 0.08, seed: 5 });
    this.W = lin(0xffffff);
    this.seed = 1;
    this.plan = { 1: [], [-1]: [] };
    this.bridgeKs = new Set();
  }

  // ------------------------------------------------------------------ planning
  reset(seed) {
    this.seed = seed >>> 0;
    this.plan = { 1: [], [-1]: [] };
    this.nextBridgeK = 2 + (seed % 3);
    this.bridges = new Map();
  }
  _zone(s, k) {
    if (k <= 0) return HOME[s](k);
    const list = this.plan[s];
    let last = list[list.length - 1];
    const R = mulberry(hashK(this.seed + (s > 0 ? 17 : 91), list.length));
    while (!last || last.k1 < k) {
      const k0 = last ? last.k1 + 1 : 1;
      const prev = last ? last.type : (s > 0 ? 'wall' : 'station');
      const pool = [['wall', 3.2], ['street', 3], ['yard', 1.6], ['industrial', 1.3], ['park', 1.2], ['station', 1.0]].filter(([t]) => t !== prev);
      let tot = 0; for (const p of pool) tot += p[1];
      let x = R() * tot, type = pool[0][0];
      for (const [t, w] of pool) { x -= w; if (x <= 0) { type = t; break; } }
      const len = type === 'wall' || type === 'street' ? 1 + ((R() * 3) | 0) : 1 + ((R() * 2) | 0);
      last = { type, k0, k1: k0 + len - 1, h: 3.6 + R() * 1.4, tint: (R() * 1000) | 0, style: (R() * 1000) | 0, fence: R() < 0.6 ? 'chain' : 'rail' };
      list.push(last);
    }
    for (let i = list.length - 1; i >= 0; i--) if (list[i].k0 <= k && list[i].k1 >= k) return list[i];
    return list[list.length - 1];
  }
  _bridge(k) {
    if (k === -1) return { kind: 'home', z: 44 };
    if (k < 1) return null;
    if (this.bridges.has(k)) return this.bridges.get(k);
    // decide sequentially so spacing stays sane
    let res = null;
    if (k >= this.nextBridgeK) {
      const R = mulberry(hashK(this.seed + 5, k));
      if (R() < 0.34) {
        res = { kind: R() < 0.55 ? 'road' : 'foot', z: -k * CHUNK - 12 - R() * 26, color: (R() * 100) | 0 };
        this.nextBridgeK = k + 3 + ((R() * 3) | 0);
      }
    }
    this.bridges.set(k, res);
    return res;
  }

  // ------------------------------------------------------------------ chunk
  build(k, B) {
    const zN = -k * CHUNK, zF = zN - CHUNK;
    const hi = this.quality === 'high', lo = this.quality === 'low';
    this.hi = hi; this.lo = lo;
    for (const s of [1, -1]) {
      const Z = this._zone(s, k);
      // the start area (k <= 0, menu backdrop) is a fixed design: constant seed
      const R = mulberry(hashK((k <= 0 ? 4242 : this.seed) + (s > 0 ? 1000 : 2000), k));
      const ctx = { Z, first: Z.k0 === k, last: Z.k1 === k, k, R };
      ZONES[Z.type].call(this, B, s, zF, zN, ctx);
      if (!lo || k <= 0) this.farLayer(B, s, zF, zN, R, Z.type);
    }
    const br = this._bridge(k);
    if (br) {
      const R = mulberry(hashK(this.seed + 77, k));
      if (br.kind === 'home') this.homeBridge(B, br.z, R);
      else if (br.kind === 'road') this.roadBridge(B, br.z, R, br.color);
      else this.footBridge(B, br.z, R, br.color);
    }
  }

  // ------------------------------------------------------------------ primitives (side aware)
  box(b, s, u0, u1, y0, y1, zF, zN, faces, c, o) {
    const xa = Math.min(s * u0, s * u1), xb = Math.max(s * u0, s * u1);
    b.box((xa + xb) / 2, (y0 + y1) / 2, (zF + zN) / 2, xb - xa, y1 - y0, zN - zF, faces, c, o);
  }
  /** vertical face at distance u facing the track */
  faceT(b, s, u, y0, h, zF, zN, rect, cB, cT = cB, tu = 0, tv = 0) {
    const len = zN - zF;
    if (s > 0) b.tiled(u, y0, zF, 0, 0, 1, len, 0, 1, 0, h, rect, tu, tv, cB, cT);
    else b.tiled(-u, y0, zN, 0, 0, -1, len, 0, 1, 0, h, rect, tu, tv, cB, cT);
  }
  /** vertical face at distance u facing away from the track */
  faceB(b, s, u, y0, h, zF, zN, rect, cB, cT = cB, tu = 0, tv = 0) { this.faceT(b, -s, -u * 1, y0, h, zF, zN, rect, cB, cT, tu, tv); }
  /** vertical face in the plane z, facing +z (dir 1) or -z (dir -1), spanning u0..u1 */
  faceZ(b, s, dir, z, u0, u1, y0, h, rect, cB, cT = cB, tu = 0, tv = 0) {
    const xa = Math.min(s * u0, s * u1), xb = Math.max(s * u0, s * u1), w = xb - xa;
    if (dir > 0) b.tiled(xa, y0, z, 1, 0, 0, w, 0, 1, 0, h, rect, tu, tv, cB, cT, 99);
    else b.tiled(xb, y0, z, -1, 0, 0, w, 0, 1, 0, h, rect, tu, tv, cB, cT, 99);
  }
  ground(b, s, u0, u1, y, zF, zN, rect, c, tile = 0) {
    const xa = Math.min(s * u0, s * u1), xb = Math.max(s * u0, s * u1);
    b.tiled(xb, y, zN, 0, 0, -1, zN - zF, -1, 0, 0, xb - xa, rect, tile, tile, c, c, 2.5);
  }
  /** horizontal quad facing down (canopy undersides, bridge bottoms) */
  ceiling(b, s, u0, u1, y, zF, zN, rect, c, tile = 0) {
    const xa = Math.min(s * u0, s * u1), xb = Math.max(s * u0, s * u1);
    b.tiled(xb, y, zF, 0, 0, 1, zN - zF, -1, 0, 0, xb - xa, rect, tile, tile, c, c, 2.5);
  }
  /** additive glow billboard (faces +z and -z via double-sided material) */
  halo(B, x, y, z, size, col) {
    B.g.quad(x - size / 2, y - size / 2, z, size, 0, 0, 0, size, 0, this.c.glow, col, col);
  }
  pool(B, x, z, r, col) {
    B.g.quad(x + r, GROUND + 0.05, z + r, 0, 0, -2 * r, -2 * r, 0, 0, this.c.pool, col, col);
  }

  // ------------------------------------------------------------------ props
  lamp(B, s, u, z, o = {}) {
    const h = o.h ?? 5.6, arm = o.arm ?? 1.3, y0 = o.y0 ?? GROUND;
    const pole = lin(o.color ?? 0x2f3b40), x = s * u;
    const b = B.n;
    b.box(x, y0 + 0.25, z, 0.34, 0.5, 0.34, this.r.white, shade(pole, 0.8));
    b.cyl(x, y0, z, 0.075, h, 6, this.r.white, shade(pole, 0.85), pole);
    const hx = s * (u - arm);
    // arm and head (head over the track side, always outside the corridor)
    this.box(b, s, Math.max(CORR + 0.1, u - arm - 0.2), u, y0 + h - 0.08, y0 + h + 0.06, z - 0.06, z + 0.06, this.r.white, pole);
    const hu0 = Math.max(CORR + 0.1, u - arm - 0.35), hu1 = hu0 + 0.62;
    this.box(b, s, hu0, hu1, y0 + h - 0.22, y0 + h + 0.02, z - 0.2, z + 0.2, fz(s, { t: this.r.white, b: this.r.white, near: this.r.white, far: this.r.white, top: this.r.white, bottom: this.r.white }), lin(0xfff6dc));
    const hxc = s * (hu0 + hu1) / 2;
    const warm = lin(0xffd79a);
    this.halo(B, hxc, y0 + h - 0.25, z, 2.2, warm);
    this.pool(B, hxc, z, 3.2, shade(warm, 0.55));
  }
  signalMast(B, s, z) {
    const u = 5.15, b = B.n, x = s * u;
    const dark = lin(0x3a4046);
    b.box(x, GROUND + 0.3, z, 0.5, 0.6, 0.5, this.r.white, lin(0x6b7075));
    b.box(x, GROUND + 2.4, z, 0.14, 4.6, 0.14, this.r.white, dark);
    // head faces +z (toward the runner)
    const hy = GROUND + 3.9;
    b.box(x, hy, z, 0.46, 1.0, 0.24, { pz: this.r.signal, nz: this.r.white, px: this.r.white, nx: this.r.white, py: this.r.white, ny: this.r.white }, lin(0x1a1a1e));
    b.box(x, hy + 0.56, z + 0.08, 0.5, 0.06, 0.4, this.r.white, lin(0x1a1a1e));
    this.halo(B, x, hy - 0.34, z + 0.14, 0.9, lin(0x3dff7a));
  }
  cabinet(B, s, u, z, w = 1.0, h = 1.35) {
    const col = lin(0xffffff);
    this.box(B.n, s, u, u + 0.55, GROUND, GROUND + h, z - w / 2, z + w / 2, fz(s, { t: this.r.cabinet, near: this.r.cabinet, far: this.r.cabinet, top: this.r.white }), shade(col, 0.9), { cT: col });
    this.box(B.n, s, u - 0.03, u + 0.58, GROUND + h, GROUND + h + 0.06, z - w / 2 - 0.03, z + w / 2 + 0.03, this.r.white, lin(0x7c8a80));
  }
  fence(B, s, u, y0, zF, zN, h, barbed = false, color = 0x8d949c) {
    const post = lin(color), wire = lin(0xc8ccd2);
    const n = Math.max(1, Math.round((zN - zF) / 2.5));
    for (let i = 0; i <= n; i++) {
      const z = zN - (i * (zN - zF)) / n;
      if (i === n && zF % CHUNK !== 0) continue;
      B.n.box(s * u, y0 + h / 2, z, 0.07, h, 0.07, this.r.white, post);
    }
    B.n.hcyl('z', s * u, y0 + h - 0.03, (zF + zN) / 2, 0.035, zN - zF, 5, this.r.white, post);
    this.faceT(B.c, s, u, y0, h - 0.05, zF, zN, this.c.chainlink, wire, wire, 2, 2);
    if (barbed) this.faceT(B.c, s, u - 0.05, y0 + h, 0.3, zF, zN, this.c.barbed, wire, wire, 2, 0);
  }
  railing(B, s, u, y0, zF, zN, h = 1.0, color = 0x6d747c) {
    const c = lin(color);
    this.faceT(B.c, s, u, y0, h, zF, zN, this.c.railing, c, c, 2.4, 0);
  }
  tree(B, s, u, z, size, R, b = null) {
    b = b || (u < 13 ? B.n : B.o);
    const x = s * u;
    const trunk = lin(0x7a5234);
    const th = 1.6 * size;
    b.cyl(x, GROUND, z, 0.14 * size, th + 0.6 * size, 6, this.r.white, shade(trunk, 0.8), trunk);
    const greens = [0x4e9b3f, 0x5bb04a, 0x3f8a3a, 0x6cbf52, 0x7fc85a, 0x4a9d5e];
    const g0 = lin(greens[(R() * greens.length) | 0]);
    const n = 2 + ((R() * 2) | 0);
    for (let i = 0; i < n; i++) {
      const r = size * (1.1 + R() * 0.6) * (i === 0 ? 1.15 : 0.85);
      const ox = (R() - 0.5) * size * 1.2, oz = (R() - 0.5) * size * 1.2;
      const oy = th + r * 0.55 + i * size * 0.5;
      const t = R() < 0.5 ? this.tBlob : this.tBlob2;
      // template y is -1..1: bottom darker, top lighter
      b.geo(t, x + ox, GROUND + oy, z + oz, r, r * 0.85, r, R() * 6, this.r.white, shade(g0, 0.62), mixc(g0, lin(0xd8ff9a), 0.28));
    }
  }
  pine(B, s, u, z, size, R) {
    const b = u < 13 ? B.n : B.o, x = s * u;
    b.cyl(x, GROUND, z, 0.12 * size, 1.2 * size, 5, this.r.white, lin(0x5a3a22), lin(0x6b4a2e));
    const g0 = lin([0x2f7a4a, 0x3a8a4e, 0x2a6e48][(R() * 3) | 0]);
    for (let i = 0; i < 3; i++) {
      const r = size * (1.3 - i * 0.32), hgt = size * (1.6 - i * 0.25);
      b.geo(this.tPine, x, GROUND + size * (0.9 + i * 0.9), z, r, hgt, r, R() * 3, this.r.white, shade(g0, 0.65), mixc(g0, lin(0xc8f0a0), 0.25));
    }
  }
  bush(B, s, u, z, size, R) {
    const b = B.o, x = s * u;
    const g0 = lin([0x4e9b3f, 0x5bb04a, 0x3f8a3a, 0x6cbf52][(R() * 4) | 0]);
    const n = 1 + ((R() * 3) | 0);
    for (let i = 0; i < n; i++) {
      const r = size * (0.6 + R() * 0.5);
      b.geo(this.tBlob2, x + (R() - 0.5) * size, GROUND + r * 0.45, z + (R() - 0.5) * size * 1.5, r * 1.2, r * 0.8, r, R() * 6, this.r.white, shade(g0, 0.6), mixc(g0, lin(0xd8ff9a), 0.22));
    }
  }
  container(B, s, u, zc, len, level, color, b = null) {
    b = b || (u < 12 ? B.n : B.o);
    const c = lin(color), y0 = GROUND + level * 2.6;
    const cB = shade(c, level === 0 ? 0.78 : 0.92);
    this.box(b, s, u, u + 2.44, y0, y0 + 2.59, zc - len / 2, zc + len / 2,
      fz(s, { t: this.r.container, b: this.r.container, near: this.r.containerDoor, far: this.r.containerDoor, top: this.r.container }), cB, { cT: c, tile: 3.2, tileV: 2.59, topCol: shade(c, 1.05) });
  }
  bench(B, s, u, z, alongZ = true) {
    const wood = lin(0xc98a4b), metal = lin(0x3b3f46), b = B.o;
    if (alongZ) {
      this.box(b, s, u, u + 0.45, GROUND + 0.42, GROUND + 0.5, z - 0.9, z + 0.9, this.r.white, wood);
      this.box(b, s, u + 0.38, u + 0.46, GROUND + 0.5, GROUND + 0.95, z - 0.9, z + 0.9, this.r.white, wood);
      for (const dz of [-0.75, 0.75]) this.box(b, s, u + 0.05, u + 0.4, GROUND, GROUND + 0.42, z + dz - 0.04, z + dz + 0.04, this.r.white, metal);
    }
  }
  bin(B, s, u, z, color = 0x2e9e5a) {
    const c = lin(color);
    B.o.cyl(s * u, GROUND, z, 0.28, 0.95, 8, this.r.white, shade(c, 0.75), c, this.r.white);
  }
  billboard(B, s, x, y, z, w, h, rect, dir = 1, legY0 = y - 3.3) {
    // board faces +z (dir 1) or -z; frame + posts + catwalk + lamps
    const b = B.o, frame = lin(0x2b2f36);
    const zf = z + dir * 0.02;
    if (dir > 0) b.quad(x - w / 2, y, zf, w, 0, 0, 0, h, 0, rect, this.W, this.W);
    else b.quad(x + w / 2, y, zf, -w, 0, 0, 0, h, 0, rect, this.W, this.W);
    b.box(x, y + h / 2, z - dir * 0.12, w + 0.3, h + 0.3, 0.2, this.r.white, frame);
    if (legY0 !== null && legY0 < y) {
      for (const dx of [-w * 0.3, w * 0.3]) b.box(x + dx, (legY0 + y) / 2, z - dir * 0.3, 0.25, y - legY0, 0.25, this.r.white, frame);
      b.box(x, y - 0.12, z + dir * 0.35, w, 0.08, 0.7, this.r.white, frame);
    }
    // night: wash light over the board
    const wash = lin(0xfff0d8);
    if (dir > 0) B.g.quad(x - w / 2, y, zf + 0.02, w, 0, 0, 0, h, 0, this.c.wash, shade(wash, 0.55), shade(wash, 0.25));
    else B.g.quad(x + w / 2, y, zf - 0.02, -w, 0, 0, 0, h, 0, this.c.wash, shade(wash, 0.55), shade(wash, 0.25));
    for (const dx of [-w * 0.3, w * 0.3]) this.halo(B, x + dx, y + h + 0.25, z + dir * 0.4, 1.4, lin(0xfff2d0));
  }
  waterTower(B, x, y, z, R) {
    const b = B.o, wood = lin(0xb07a4c), leg = lin(0x3b3530);
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) b.box(x + dx * 1.1, y + 1.2, z + dz * 1.1, 0.16, 2.4, 0.16, this.r.white, leg);
    b.box(x, y + 2.45, z, 2.9, 0.12, 2.9, this.r.white, leg);
    b.cyl(x, y + 2.5, z, 1.55, 3.0, 12, this.r.wood, shade(wood, 0.85), wood);
    b.geo(this.tCone, x, y + 5.5, z, 1.75, 1.3, 1.75, 0, this.r.white, lin(0x5a3a2a), lin(0x6e4a34));
    for (const hy of [0.8, 2.2]) b.cyl(x, y + 2.5 + hy, z, 1.58, 0.08, 12, this.r.white, leg);
  }

  // ------------------------------------------------------------------ buildings
  /**
   * Building block. uF = track-facing facade distance, uB = back. o: { wall, tint, shops, floors, style, roof, fire, trim }
   */
  building(B, s, uF, uB, zF, zN, y0, h, o, R) {
    const b = B.o;
    const wall = o.wall || 'brick', rect = this.r[wall], tile = WALL_TILE[wall] || 2.5;
    const tint = lin(o.tint), cB = shade(tint, 0.74), cT = tint;
    const top = y0 + h;
    const menuFace = o.menu ? this.r[wall] : rect;
    this.box(b, s, uF, uB, y0, top, zF, zN, fz(s, { t: rect, near: rect, far: menuFace, top: this.r.roof }), cB, { cT, tile, tileV: tile, tileTop: 4, tileTopV: 4, topCol: lin(0xd8d4cc) });
    const trim = lin(o.trim ?? 0xf2ede4);
    // parapet / cornice
    this.box(b, s, uF - 0.18, uB, top, top + 0.55, zN - 0.3, zN + 0.04, this.r.white, shade(trim, 0.85), { cT: trim });
    this.box(b, s, uF - 0.18, uB, top, top + 0.55, zF - 0.04, zF + 0.3, this.r.white, shade(trim, 0.85), { cT: trim });
    this.box(b, s, uF - 0.18, uF + 0.12, top, top + 0.55, zF, zN, this.r.white, shade(trim, 0.85), { cT: trim });
    this.box(b, s, uF - 0.12, uF, top - 0.5, top, zF, zN, this.r.white, shade(trim, 0.9));
    // floors
    const gH = o.shops ? 4.2 : 3.2, fH = 3.0;
    const floors = Math.max(1, Math.floor((h - gH) / fH));
    const wStyle = o.style % WINDOW_COUNT, wStyle2 = (o.style >> 3) % WINDOW_COUNT;
    const lit = (R2) => (R2 < 0.1 ? this.winLit[2] : this.winLit[R2 < 0.55 ? 0 : 1]);
    const warm = lin(0xffffff);
    const ww = 1.2, wh = 1.5;
    // --- track facade windows
    const lenZ = zN - zF;
    const nb = Math.max(1, Math.round(lenZ / 3.1)), bw = lenZ / nb;
    const acBays = new Set();
    for (let f = 0; f < floors; f++) {
      const wy = y0 + gH + f * fH + 0.7;
      if (wy + wh > top - 0.3) break;
      for (let j = 0; j < nb; j++) {
        const zc = zN - (j + 0.5) * bw;
        const wr = this.win[(j + f) % 3 === 0 ? wStyle2 : wStyle];
        this.faceT(b, s, uF - 0.03, wy, wh, zc - ww / 2, zc + ww / 2, wr, this.W, this.W);
        const r = R();
        if (r < 0.4) this.faceT(B.g, s, uF - 0.05, wy, wh, zc - ww / 2, zc + ww / 2, lit(r / 0.4), warm, warm);
        if (!this.lo && R() < 0.12 && !acBays.has(j * 100 + f)) {
          acBays.add(j * 100 + f);
          this.box(b, s, uF - 0.5, uF, wy - 0.62, wy - 0.12, zc - 0.42, zc + 0.42, fz(s, { t: this.r.ac, near: this.r.white, far: this.r.white, top: this.r.white, bottom: this.r.white }), lin(0xdcdcd6));
        }
      }
    }
    // --- side (z) facades: +z faces the runner, -z faces the menu camera
    const depth = uB - uF;
    const ns = Math.max(0, Math.floor((depth - 0.8) / 3.1));
    if (ns > 0) {
      const sw = (depth - 0.4) / ns;
      for (const dir of [1, -1]) {
        const zface = dir > 0 ? zN + 0.03 : zF - 0.03;
        for (let f = 0; f < floors; f++) {
          const wy = y0 + gH + f * fH + 0.7;
          if (wy + wh > top - 0.3) break;
          for (let j = 0; j < ns; j++) {
            const uc = uF + 0.2 + (j + 0.5) * sw;
            this.faceZ(b, s, dir, zface, uc - ww / 2, uc + ww / 2, wy, wh, this.win[(j + f) % 2 ? wStyle : wStyle2], this.W, this.W);
            const r = R();
            if (r < 0.35) this.faceZ(B.g, s, dir, zface + dir * 0.02, uc - ww / 2, uc + ww / 2, wy, wh, lit(r / 0.35), warm, warm);
          }
        }
      }
    }
    // --- ground floor on the track facade
    if (o.shops) {
      const nShop = Math.max(1, Math.round(lenZ / 6.2)), sw = lenZ / nShop;
      for (let j = 0; j < nShop; j++) {
        const zc = zN - (j + 0.5) * sw, hw = Math.min(2.2, sw / 2 - 0.35);
        this.faceT(b, s, uF - 0.03, y0 + 0.05, 3.1, zc - hw, zc + hw, this.r[R() < 0.5 ? 'shop0' : 'shop1'], this.W, this.W);
        if (R() < 0.6) this.faceT(B.g, s, uF - 0.05, y0 + 0.05, 3.1, zc - hw, zc + hw, this.c.shopLit, shade(warm, 0.8), shade(warm, 0.8));
        // awning (double sided sloped quad) + valance
        const aw = this.r['awning' + ((R() * 3) | 0)], ay = y0 + 3.5, out = 1.25;
        const uo = Math.max(CORR + 0.2, uF - out);
        const len = hw * 2 + 0.3, zs = s > 0 ? zc + len / 2 : zc - len / 2;
        b.quad(s * uF, ay, zs, 0, 0, -s * len, -s * (uF - uo), -0.5, 0, aw, this.W, this.W);
        b.quad(s * uF, ay - 0.02, zs - s * len * 1, 0, 0, s * len, -s * (uF - uo), -0.5, 0, aw, shade(this.W, 0.5), shade(this.W, 0.5));
        this.faceT(b, s, uo, ay - 0.82, 0.32, zc - len / 2, zc + len / 2, aw, this.W, this.W, 0, 0);
        // shop sign above the awning (neon at night)
        const si = 2 + ((R() * 5) | 0);
        this.box(b, s, uF - 0.14, uF, ay + 0.15, ay + 0.85, zc - 1.7, zc + 1.7, fz(s, { t: this.sign[si], near: this.r.white, far: this.r.white, top: this.r.white }), this.W);
        this.faceT(B.g, s, uF - 0.17, ay + 0.15, 0.7, zc - 1.7, zc + 1.7, this.signGlow[si], this.W, this.W);
      }
    } else {
      // doors and windows on the ground floor
      for (let j = 0; j < nb; j++) {
        const zc = zN - (j + 0.5) * bw;
        if (j % 3 === 1) this.faceT(b, s, uF - 0.03, y0 + 0.02, 2.4, zc - 0.8, zc + 0.8, this.r.door, this.W, this.W);
        else this.faceT(b, s, uF - 0.03, y0 + 0.9, wh, zc - ww / 2, zc + ww / 2, this.win[wStyle], this.W, this.W);
      }
    }
    // --- fire escape
    if (o.fire && floors >= 3) this.fireEscape(B, s, uF, zN - (Math.min(nb - 1, 1 + ((R() * (nb - 1)) | 0)) + 0.5) * bw, y0 + gH, floors, fH, top);
    // --- roof extras
    const uc = (uF + uB) / 2, zc = (zF + zN) / 2;
    if (!this.lo) {
      const nAc = (R() * 3) | 0;
      for (let i = 0; i < nAc; i++) {
        const au = uF + 1.2 + R() * (depth - 2.4), az = zF + 1.5 + R() * (lenZ - 3);
        this.box(b, s, au, au + 1.2, top, top + 0.8, az - 0.6, az + 0.6, this.r.white, lin(0xcfd2d4), { cT: lin(0xeef0f2) });
      }
      if (R() < 0.35) { const au = uF + 1 + R() * Math.max(0.5, depth - 4); this.box(b, s, au, au + 2.8, top, top + 2.6, zc - 1.6, zc + 1.6, fz(s, { t: this.r.stucco, near: this.r.stucco, far: this.r.stucco, top: this.r.roof }), shade(tint, 0.9), { cT: tint, tile: 3 }); }
      if (R() < 0.3) b.box(s * (uF + depth * 0.7), top + 3, zF + lenZ * 0.3, 0.08, 6, 0.08, this.r.white, lin(0x55595e));
    }
    if (o.tower ?? (R() < 0.28 && h < 30)) this.waterTower(B, s * Math.min(uB - 2, uF + 2.8 + R() * 3), top, zF + 3 + R() * Math.max(1, lenZ - 6), R);
    if (o.billboard !== undefined && o.billboard !== null) {
      const bw2 = Math.min(lenZ - 1, 9), bh = bw2 / 2;
      this.billboard(B, s, s * (uF + 2.5), top + 3.3, o.bbDir > 0 ? zN - 1.5 : zF + 1.5, bw2, bh, this.bb[o.billboard % BILLBOARD_COUNT], o.bbDir ?? 1);
    }
  }

  fireEscape(B, s, uF, zc, y0, floors, fH, top) {
    const c = B.c, dark = lin(0x3a3f47), rail = lin(0x454b54);
    const out = 1.15, hw = 1.5;
    for (let f = 0; f < floors; f++) {
      const y = y0 + f * fH - 0.12;
      if (y > top - 1.5) break;
      // landing grate (horizontal, double-sided material)
      const xa = Math.min(s * uF, s * (uF - out)), xb = Math.max(s * uF, s * (uF - out));
      c.tiled(xb, y, zc + hw, 0, 0, -1, hw * 2, -1, 0, 0, xb - xa, this.c.grate, 1, 1, dark, dark, 2.5);
      // railings: front and ends
      this.faceT(c, s, uF - out, y, 0.95, zc - hw, zc + hw, this.c.railing, rail, rail, 2.4, 0);
      this.faceZ(c, s, 1, zc + hw, uF - out, uF, y, 0.95, this.c.railing, rail, rail, 2.4, 0);
      this.faceZ(c, s, -1, zc - hw, uF - out, uF, y, 0.95, this.c.railing, rail, rail, 2.4, 0);
      // stairs to the next landing (a sloped grate strip)
      if (f < floors - 1 && y + fH < top - 1.5) {
        const u0 = uF - out * 0.9, u1 = uF - out * 0.2;
        const z0 = zc - hw + 0.2, z1 = zc + hw - 0.4;
        const x0 = s * u0, x1 = s * u1;
        c.quad(Math.min(x0, x1), y, z1, Math.abs(x1 - x0), 0, 0, 0, fH, z0 - z1, this.c.grate, dark, dark);
      }
    }
  }

  farBuilding(B, s, u0, u1, zF, zN, h, R, y0 = GROUND) {
    const b = B.o, v = (R() * 2) | 0;
    const rect = this.r['far' + v];
    const tu = v ? 12 : 15, tv = v ? 18 : 24;
    const tint = lin(PAL.far[(R() * PAL.far.length) | 0]);
    this.box(b, s, u0, u1, y0, y0 + h, zF, zN, fz(s, { t: rect, near: rect, far: rect, top: this.r.roof }), shade(tint, 0.8), { cT: tint, tile: tu, tileV: tv, tileTop: 6, tileTopV: 6 });
    const litRect = this.c['farLit' + v], L = lin(0xffffff);
    // night windows (same tiling as the facade texture)
    const yb = y0;
    this.faceT(B.g, s, u0 - 0.05, yb, h, zF, zN, litRect, L, L, tu, tv);
    B.g.tiled(Math.min(s * u0, s * u1), yb, zN + 0.05, 1, 0, 0, Math.abs(u1 - u0), 0, 1, 0, h, litRect, tu, tv, L, L, 99);
    if (R() < 0.5 && !this.lo) this.box(b, s, u0 + 2, u0 + 5, y0 + h, y0 + h + 2.5, zF + 2, zF + 5, this.r.white, lin(0xcfcac2));
    if (R() < 0.35) {
      b.box(s * (u0 + 3), y0 + h + 5, (zF + zN) / 2, 0.15, 10, 0.15, this.r.white, lin(0x6a6e74));
      this.halo(B, s * (u0 + 3), y0 + h + 10.1, (zF + zN) / 2, 1.6, lin(0xff4a4a));
    }
  }

  farLayer(B, s, zF, zN, R, type) {
    let z = zN - R() * 6;
    const uMin = type === 'park' || type === 'industrial' || type === 'yard' ? 30 : 27;
    while (z > zF + 6) {
      const w = 12 + R() * 16;
      const zf = Math.max(zF, z - w);
      const u0 = uMin + R() * 14, d = 12 + R() * 14;
      const h = 16 + Math.pow(R(), 0.8) * 34;
      this.farBuilding(B, s, u0, u0 + d, zf, z, h, R);
      z = zf - (R() < 0.5 ? 2 + R() * 6 : 0.5);
    }
  }

  /** a row of apartment blocks with its facade at ~uF */
  buildingRow(B, s, zF, zN, y0, uF, R, Z, o = {}) {
    let z = zN;
    const Rz = mulberry(Z.style * 13 + 7);
    while (z > zF + 3) {
      let w = 9 + R() * 14;
      if (z - w < zF + 5) w = z - zF;
      const zf = z - w;
      const wall = o.wall || (R() < 0.62 ? 'brick' : R() < 0.6 ? 'stucco' : 'siding');
      const tint = wall === 'brick' ? PAL.brick[(R() * PAL.brick.length) | 0] : wall === 'stucco' ? PAL.stucco[(R() * PAL.stucco.length) | 0] : PAL.siding[(R() * PAL.siding.length) | 0];
      const floors = 3 + ((R() * 5) | 0);
      const h = (o.shops ? 4.2 : 3.2) + floors * 3 + 0.4;
      const uf = uF + (R() < 0.3 ? R() * 1.5 : 0);
      this.building(B, s, uf, uf + 10 + R() * 8, zf, z, y0, h, {
        wall, tint, shops: o.shops, style: (R() * 4096) | 0, fire: R() < 0.55, trim: PAL.trim[(R() * 2) | 0],
        billboard: R() < 0.16 ? (R() * BILLBOARD_COUNT) | 0 : null, bbDir: 1,
      }, R);
      z = zf - (R() < 0.35 ? 1.5 + R() * 3 : 0);
      void Rz;
    }
  }

  // ------------------------------------------------------------------ bridges
  bridgePiers(B, zc, depth, color) {
    const c = lin(color);
    for (const s of [1, -1]) {
      this.box(B.n, s, 5.5, 7.3, GROUND, BRIDGE_Y, zc - depth / 2, zc + depth / 2, fz(s, { t: this.r.pillar, near: this.r.pillar, far: this.r.pillar, b: this.r.pillar }), shade(c, 0.75), { cT: c, tile: 0 });
      this.box(B.n, s, 5.3, 8.5, BRIDGE_Y - 0.5, BRIDGE_Y, zc - depth / 2 - 0.3, zc + depth / 2 + 0.3, this.r.white, shade(c, 0.9));
    }
  }
  roadBridge(B, zc, R, ci) {
    const d = 9, y0 = BRIDGE_Y, y1 = y0 + 1.7, span = 75;
    const col = lin([0x4f8f6a, 0x3f6fae, 0xb85a44, 0x8a8f96, 0x2e7d7a][ci % 5]);
    const b = B.n;
    b.box(0, (y0 + y1) / 2, zc, span * 2, y1 - y0, d, { pz: this.r.metal, nz: this.r.metal, py: this.r.asphalt, ny: this.r.concrete, px: null, nx: null }, shade(col, 0.85), { cT: col, tile: 4, tileV: 1.7, tileTop: 4, tileTopV: 4, topCol: lin(0xffffff) });
    // parapets
    for (const dz of [-d / 2 + 0.2, d / 2 - 0.2]) b.box(0, y1 + 0.5, zc + dz, span * 2, 1.0, 0.35, { pz: this.r.concrete, nz: this.r.concrete, py: this.r.white, ny: null, px: null, nx: null }, lin(0xcfc8bb), { tile: 3.2, tileV: 1 });
    // graffiti on the girder facing the runner + a sign
    const g = this.graf[(R() * GRAFFITI_COUNT) | 0];
    B.n.quad(-4, y0 + 0.05, zc + d / 2 + 0.03, 8, 0, 0, 0, 1.6, 0, g, this.W, this.W, 0, 1, 0.15, 0.85);
    this.bridgePiers(B, zc, 4.5, 0xc2bbae);
    // lamps on the bridge
    for (const x of [-9, 9]) {
      b.box(x, y1 + 2.5, zc + d / 2 - 0.4, 0.12, 4, 0.12, this.r.white, lin(0x2f3b40));
      this.halo(B, x, y1 + 4.4, zc + d / 2 - 0.4, 2, lin(0xffd79a));
    }
  }
  footBridge(B, zc, R, ci) {
    const d = 3.2, y0 = BRIDGE_Y, span = 13;
    const col = lin([0x19b3b1, 0xf2553d, 0x3a6fd8, 0xffc93c, 0x8b5cf6][ci % 5]);
    const b = B.n;
    b.box(0, y0 + 0.2, zc, span * 2, 0.4, d, { pz: this.r.white, nz: this.r.white, py: this.r.platformTop, ny: this.r.white, px: this.r.white, nx: this.r.white }, shade(col, 0.8), { cT: col, tileTop: 2, tileTopV: 2 });
    // trusses (cutout) on both sides, roof
    for (const dz of [d / 2, -d / 2]) {
      B.c.tiled(-span, y0 + 0.4, zc + dz, 1, 0, 0, span * 2, 0, 1, 0, 2.0, this.c.truss, 4, 0, col, col, 99);
    }
    b.box(0, y0 + 2.5, zc, span * 2, 0.15, d + 0.4, this.r.white, shade(col, 0.9));
    // stair towers
    for (const s of [1, -1]) {
      this.box(b, s, span - 3, span + 1, GROUND, y0 + 2.6, zc - 2.5, zc + 2.5, fz(s, { t: this.r.brick, b: this.r.brick, near: this.r.brick, far: this.r.brick, top: this.r.roof }), shade(lin(0xb85a44), 0.8), { cT: lin(0xc7654a), tile: 2.2, tileV: 2.2 });
      this.box(b, s, 5.6, 6.6, GROUND, y0, zc - 0.5, zc + 0.5, this.r.white, shade(col, 0.7), { cT: col });
    }
    this.halo(B, 0, y0 - 0.2, zc, 2.5, lin(0xfff2d0));
  }
  homeBridge(B, zc, R) {
    // the title-screen bridge: concrete road bridge with a big RAIL DASH billboard on top facing the menu camera
    const d = 8, y0 = BRIDGE_Y, y1 = y0 + 1.9, span = 75;
    const col = lin(0xd9d2c4);
    const b = B.n;
    b.box(0, (y0 + y1) / 2, zc, span * 2, y1 - y0, d, { pz: this.r.concrete, nz: this.r.concrete, py: this.r.asphalt, ny: this.r.concrete, px: null, nx: null }, shade(col, 0.82), { cT: col, tile: 3.2, tileV: 1.9, tileTop: 4, tileTopV: 4, topCol: lin(0xffffff) });
    for (const dz of [-d / 2 + 0.2, d / 2 - 0.2]) b.box(0, y1 + 0.5, zc + dz, span * 2, 1.0, 0.35, { pz: this.r.concrete, nz: this.r.concrete, py: this.r.white, ny: null, px: null, nx: null }, lin(0xcfc8bb), { tile: 3.2, tileV: 1 });
    // graffiti panels along the girder (menu side = -z face)
    for (let i = -2; i <= 2; i++) {
      const g = this.graf[(i + 2) * 3 % GRAFFITI_COUNT];
      B.n.quad(i * 7.2 + 3.3, y0 + 0.05, zc - d / 2 - 0.03, -6.6, 0, 0, 0, 1.8, 0, g, this.W, this.W, 0, 1, 0.12, 0.88);
    }
    this.billboard(B, 1, -1.2, y1 + 1.25, zc - 0.5, 11, 5.5, this.bb[3], -1, y1);
    this.billboard(B, 1, 1.2, y1 + 1.25, zc + 0.5, 11, 5.5, this.bb[0], 1, null);
    this.bridgePiers(B, zc, 4, 0xc9c2b5);
    for (const x of [-10, 10]) {
      b.box(x, y1 + 2.5, zc - d / 2 + 0.4, 0.12, 4, 0.12, this.r.white, lin(0x2f3b40));
      this.halo(B, x, y1 + 4.4, zc - d / 2 + 0.4, 2, lin(0xffd79a));
    }
  }
}

// ------------------------------------------------------------------ zones
const ZONES = {
  wall(B, s, zF, zN, C) {
    const { Z, R } = C;
    const H = Z.h;
    const P = 6.25;
    const concrete = lin(0xd6cfc2), cDark = shade(concrete, 0.72);
    // wall body (top/back; the track face is made of panels)
    this.box(B.n, s, 5.35, 6.05, GROUND - 0.2, H, zF, zN, fz(s, { top: this.r.concrete, near: C.first ? this.r.concrete : null, far: C.last ? this.r.concrete : null }), cDark, { cT: concrete, tile: 3.2 });
    for (let i = 0; i < 8; i++) {
      const zp = zN - i * P;
      this.box(B.n, s, 5.03, 5.37, GROUND - 0.2, H + 0.1, zp - 0.36, zp + 0.36, fz(s, { t: this.r.pillar, near: this.r.pillar, far: this.r.pillar, top: this.r.white }), shade(concrete, 0.78), { cT: concrete });
      const za = zp - P + 0.36, zb = zp - 0.36;
      const r = R();
      const rect = r < 0.68 ? this.graf[(C.k * 3 + i * 5 + (s > 0 ? 0 : 3) + ((R() * 3) | 0)) % GRAFFITI_COUNT] : this.r.concrete;
      const plain = rect === this.r.concrete;
      this.faceT(B.n, s, 5.35, GROUND - 0.2, H + 0.2, za, zb, rect, plain ? shade(concrete, 0.72) : lin(0xc8c8c8), plain ? concrete : this.W, plain ? 3.2 : 0, plain ? 3.2 : 0);
      if (plain && R() < 0.5) this.faceT(B.n, s, 5.33, 1.3, 1.45, (za + zb) / 2 - 0.5 - 0.8, (za + zb) / 2 - 0.5 + 0.2, this.poster[(R() * 4) | 0], this.W, this.W);
    }
    // coping
    this.box(B.n, s, 5.2, 6.2, H, H + 0.22, zF, zN, fz(s, { t: this.r.white, top: this.r.white, near: this.r.white, far: this.r.white }), lin(0xe4ded2));
    // pipe with brackets
    if (Z.style % 3 !== 0) {
      B.n.hcyl('z', s * 5.18, H - 0.8, (zF + zN) / 2, 0.1, zN - zF, 6, this.r.white, lin(0x7a8088));
      for (let z = zN - 1.5; z > zF; z -= 3.125) B.n.box(s * 5.25, H - 0.8, z, 0.18, 0.28, 0.1, this.r.white, lin(0x4a4e55));
    }
    // top fence
    if (Z.fence === 'chain') this.fence(B, s, 5.95, H + 0.22, zF, zN, 1.9, Z.style % 2 === 0);
    else this.railing(B, s, 5.9, H + 0.22, zF, zN, 1.05, 0x5b6470);
    // street level behind the wall
    this.ground(B.o, s, 6.2, 9.4, H, zF, zN, this.r.sidewalk, this.W, 2);
    this.ground(B.o, s, 9.4, 72, H - 0.01, zF, zN, this.r.asphalt, shade(this.W, 0.95), 4);
    if (C.first) this.faceZ(B.o, s, 1, zN, 6.05, 72, GROUND, H - GROUND, this.r.concrete, cDark, concrete, 3.2, 3.2);
    if (C.last) this.faceZ(B.o, s, -1, zF, 6.05, 72, GROUND, H - GROUND, this.r.concrete, cDark, concrete, 3.2, 3.2);
    // wall lamps + lamps on the street
    for (let z = zN - 12.5; z > zF; z -= 25) this.lamp(B, s, 6.9, z, { y0: H, h: 5.2, arm: 1.6 });
    // weeds at the base
    if (!this.lo) for (let i = 0; i < 6; i++) { const z = zF + R() * (zN - zF), x = s * (5.0 + R() * 0.25); B.c.quad(x, GROUND, z + 0.5, 0, 0, -1, 0, 0.45, 0, this.c.tuft, this.W, this.W); }
    // cabinet / signal now and then
    if (R() < 0.35) this.signalMast(B, s, zF + 10 + R() * 30);
    this.buildingRow(B, s, zF, zN, H, 9.6 + (Z.style % 3) * 0.6, R, Z, { shops: Z.style % 4 === 0 });
  },

  street(B, s, zF, zN, C) {
    const { Z, R } = C;
    // low wall + railing
    const wc = lin(PAL.stucco[Z.tint % PAL.stucco.length]);
    this.box(B.n, s, 5.3, 5.7, GROUND, 1.0, zF, zN, fz(s, { t: this.r.concrete, top: this.r.white, near: C.first ? this.r.concrete : null, far: C.last ? this.r.concrete : null }), shade(wc, 0.75), { cT: wc, tile: 3.2, tileV: 1.2 });
    this.railing(B, s, 5.55, 1.0, zF, zN, 0.9, 0x3b4450);
    this.ground(B.o, s, 5.3, 9.2, 0.02, zF, zN, this.r.sidewalk, this.W, 2);
    this.ground(B.o, s, 9.2, 72, 0.0, zF, zN, this.r.asphalt, this.W, 4);
    for (let z = zN - 10; z > zF; z -= 20) this.lamp(B, s, 6.3, z, { y0: 0.02, h: 5.4, arm: 1.3 });
    if (!this.lo) for (let z = zN - 5 - R() * 3; z > zF + 3; z -= 11 + R() * 6) this.tree(B, s, 7.9, z, 0.9 + R() * 0.3, R, B.n);
    if (!this.lo) for (let i = 0; i < 2; i++) this.bin(B, s, 8.6, zF + 5 + R() * 40, [0x2e9e5a, 0x3a6fd8, 0xf2553d][(R() * 3) | 0]);
    this.buildingRow(B, s, zF, zN, 0.02, 9.2, R, Z, { shops: true });
  },

  yard(B, s, zF, zN, C) {
    const { Z, R } = C;
    this.ground(B.o, s, 5.3, 72, GROUND + 0.01, zF, zN, this.r.dirt, this.W, 3.5);
    this.fence(B, s, 5.45, GROUND, zF, zN, 2.5, true);
    let z = zN - 1 - R() * 3;
    while (z > zF + 7) {
      const len = R() < 0.55 ? 12.2 : 6.1;
      if (z - len < zF + 0.5) break;
      const u = 7.2 + R() * 1.2, stack = 1 + ((R() * 3) | 0);
      for (let l = 0; l < stack; l++) this.container(B, s, u, z - len / 2 - (l % 2) * 0.1, len, l, PAL.container[(R() * PAL.container.length) | 0]);
      if (R() < 0.65) {
        const st2 = 1 + ((R() * 3) | 0);
        for (let l = 0; l < st2; l++) this.container(B, s, u + 2.7, z - len / 2, len, l, PAL.container[(R() * PAL.container.length) | 0]);
      }
      z -= len + 1.5 + R() * 5;
    }
    for (let i = 0; i < 2; i++) this.cabinet(B, s, 5.9, zF + 6 + R() * 38, 0.9, 1.2);
    if (R() < 0.6) this.signalMast(B, s, zF + 5 + R() * 40);
    // warehouses
    let zw = zN - R() * 4;
    while (zw > zF + 10) {
      const w = 16 + R() * 18, zf = Math.max(zF, zw - w);
      this.warehouse(B, s, 15.5 + R() * 3, zf, zw, R);
      zw = zf - 2 - R() * 4;
    }
  },

  industrial(B, s, zF, zN, C) {
    const { Z, R } = C;
    this.ground(B.o, s, 5.3, 72, GROUND + 0.01, zF, zN, this.r.asphalt, this.W, 4);
    // curb + bollards
    this.box(B.n, s, 5.3, 5.55, GROUND, 0.25, zF, zN, this.r.white, lin(0xd8d2c6));
    for (let z = zN - 2; z > zF; z -= 4.2) {
      B.n.cyl(s * 5.75, GROUND, z, 0.13, 1.0, 7, this.r.white, lin(0xf5b82e), lin(0xffd23f), this.r.white);
      B.n.cyl(s * 5.75, GROUND + 0.62, z, 0.135, 0.14, 7, this.r.white, lin(0x1b1b1f));
    }
    // pallets, crates, barrels
    if (!this.lo) for (let i = 0; i < 7; i++) {
      const u = 6.5 + R() * 4, z = zF + 3 + R() * 44;
      if (R() < 0.5) this.box(B.n, s, u, u + 1.2, GROUND, GROUND + 0.9 + ((R() * 2) | 0) * 0.9, z - 0.6, z + 0.6, this.r.wood, lin(0xd0a070), { tile: 1.2 });
      else {
        const c = lin([0x2f6fd0, 0xe8492f, 0x19a3a1, 0xf5b82e][(R() * 4) | 0]);
        for (let j = 0; j < 1 + ((R() * 3) | 0); j++) B.n.cyl(s * (u + j * 0.65), GROUND, z + (j % 2) * 0.5, 0.3, 0.95, 9, this.r.white, shade(c, 0.8), c, this.r.white);
      }
    }
    let zw = zN - R() * 3;
    while (zw > zF + 10) {
      const w = 18 + R() * 16, zf = Math.max(zF, zw - w);
      this.warehouse(B, s, 12 + R() * 2, zf, zw, R, true);
      zw = zf - 3 - R() * 5;
    }
    if (R() < 0.5) {
      const z = zF + 10 + R() * 30;
      for (let i = 0; i < 2; i++) B.o.cyl(s * (32 + i * 7), GROUND, z + i * 3, 3, 12, 14, this.r.white, lin(0xb8bec6), lin(0xe8ecf0), this.r.white);
    }
    if (R() < 0.5) this.signalMast(B, s, zF + 5 + R() * 40);
  },

  park(B, s, zF, zN, C) {
    const { Z, R } = C;
    this.ground(B.o, s, 5.3, 72, GROUND + 0.02, zF, zN, this.r.grass, this.W, 3.2);
    const stone = lin(0xcdb89c);
    this.box(B.n, s, 5.3, 5.75, GROUND, 0.6, zF, zN, fz(s, { t: this.r.concrete, top: this.r.white, near: C.first ? this.r.concrete : null, far: C.last ? this.r.concrete : null }), shade(stone, 0.78), { cT: stone, tile: 3.2, tileV: 0.8 });
    this.railing(B, s, 5.6, 0.6, zF, zN, 0.95, 0x2e5a3e);
    this.ground(B.o, s, 10.5, 12.3, GROUND + 0.04, zF, zN, this.r.dirt, this.W, 3.5);
    const nT = this.lo ? 3 : this.hi ? 9 : 6;
    for (let i = 0; i < nT; i++) {
      const u = 7 + R() * 17, z = zF + 2 + R() * 46;
      if (u > 10 && u < 12.8) continue;
      if (R() < 0.25) this.pine(B, s, u, z, 1.4 + R() * 0.8, R);
      else this.tree(B, s, u, z, 1.0 + R() * 0.7, R);
    }
    if (!this.lo) for (let i = 0; i < 6; i++) this.bush(B, s, 6.4 + R() * 3.5, zF + 2 + R() * 46, 0.9 + R() * 0.6, R);
    for (let z = zN - 8; z > zF; z -= 16) { this.bench(B, s, 12.4, z); }
    for (let z = zN - 16; z > zF; z -= 25) this.lamp(B, s, 10.2, z, { h: 4.6, arm: 0.5, color: 0x2e5a3e });
    this.buildingRow(B, s, zF, zN, GROUND, 25 + R() * 3, R, Z, { shops: false });
  },

  station(B, s, zF, zN, C) {
    const { Z, R } = C;
    const top = 1.05, uB = 11.4;
    const conc = lin(0xd8d1c4);
    // platform body + coping + dark recess under the lip
    this.box(B.n, s, 5.15, uB, GROUND, top - 0.22, zF, zN, fz(s, { t: this.r.concrete, near: C.first ? this.r.concrete : null, far: C.last ? this.r.concrete : null }), shade(conc, 0.45), { cT: shade(conc, 0.6), tile: 3.2, tileV: 1.2 });
    this.box(B.n, s, 4.86, 5.4, top - 0.24, top, zF, zN, fz(s, { t: this.r.white, top: this.r.white, bottom: this.r.white, near: this.r.white, far: this.r.white }), lin(0xf2efe8));
    this.ground(B.o, s, 5.4, 5.95, top + 0.002, zF, zN, this.r.platformEdge, this.W, 0);
    this.ground(B.o, s, 5.95, uB, top, zF, zN, this.r.platformTop, this.W, 2);
    // canopy
    const cc = lin(PAL.canopy[Z.tint % PAL.canopy.length]);
    const colC = lin(0xe9ecef);
    for (let z = zN - 3.75; z > zF; z -= 7.5) {
      this.box(B.n, s, 8.3, 8.6, top, 5.1, z - 0.15, z + 0.15, this.r.white, shade(colC, 0.8), { cT: colC });
      if (R() < 0.8) this.bench(B, s, 9.6, z - 3.75 + 0.1 * R());
    }
    this.box(B.n, s, 5.35, 11.0, 5.1, 5.38, zF, zN, fz(s, { t: this.r.white, top: this.r.roof, bottom: this.r.white, near: C.first ? this.r.white : null, far: C.last ? this.r.white : null }), lin(0xf4f2ee), { tileTop: 4, tileTopV: 4 });
    this.box(B.n, s, 5.2, 5.45, 4.85, 5.55, zF, zN, fz(s, { t: this.r.white, top: this.r.white, bottom: this.r.white, near: this.r.white, far: this.r.white }), cc);
    // light strips under the canopy
    for (let z = zN - 2; z > zF; z -= 7.5) {
      this.box(B.n, s, 6.4, 6.6, 5.0, 5.1, z - 1.8, z + 1.8, this.r.white, lin(0xfffbe8));
      this.ceilingGlow(B, s, 6.5, 4.98, z);
    }
    // hanging signs facing the runner (+z) and the menu (-z)
    const signs = [0, 1, 7];
    for (let z = zN - 11; z > zF + 3; z -= 18 + R() * 6) {
      const si = signs[(R() * signs.length) | 0];
      const y0 = 3.5, h = 0.62, u0 = 6.0, u1 = 8.2;
      this.box(B.n, s, u0, u1, y0, y0 + h, z - 0.06, z + 0.06, fz(s, { near: this.sign[si], far: this.sign[si], t: this.r.white, b: this.r.white, top: this.r.white, bottom: this.r.white }), this.W);
      for (const uu of [u0 + 0.25, u1 - 0.25]) this.box(B.n, s, uu - 0.02, uu + 0.02, y0 + h, 5.1, z - 0.02, z + 0.02, this.r.white, lin(0x3b3f46));
      this.faceZ(B.g, s, 1, z + 0.08, u0, u1, y0, h, this.signGlow[si], shade(this.W, 0.7));
      this.faceZ(B.g, s, -1, z - 0.08, u0, u1, y0, h, this.signGlow[si], shade(this.W, 0.7));
    }
    // clock
    const zc = zF + 20 + R() * 10;
    this.box(B.n, s, 6.9, 7.1, 4.0, 4.7, zc - 0.35, zc + 0.35, fz(s, { near: this.r.clock, far: this.r.clock, t: this.r.white, b: this.r.white, top: this.r.white, bottom: this.r.white }), this.W);
    // vending machine + bins
    if (R() < 0.7) { const z = zF + 6 + R() * 38; this.box(B.o, s, 10.3, 11.1, top, top + 1.9, z - 0.5, z + 0.5, fz(s, { t: this.r.vending, near: this.r.white, far: this.r.white, top: this.r.white }), this.W); }
    // back wall: station building
    const bt = lin(PAL.stucco[(Z.tint >> 2) % PAL.stucco.length]);
    this.box(B.o, s, uB, uB + 9, GROUND, top + 3.2, zF, zN, fz(s, { t: this.r.tiles, near: C.first ? this.r.tiles : null, far: C.last ? this.r.tiles : null }), lin(0xdfe6ea), { tile: 1.6, tileV: 1.6 });
    this.box(B.o, s, uB, uB + 9, top + 3.2, top + 9, zF, zN, fz(s, { t: this.r.brick, near: C.first ? this.r.brick : null, far: C.last ? this.r.brick : null, top: this.r.roof }), shade(lin(0xc7654a), 0.85), { cT: lin(0xc7654a), tile: 2.2, tileV: 2.2, tileTop: 4, tileTopV: 4 });
    this.box(B.o, s, uB - 0.2, uB + 9, top + 9, top + 9.5, zF, zN, this.r.white, lin(0xf2ede4));
    for (let z = zN - 3; z > zF + 1; z -= 6.25) {
      this.faceT(B.o, s, uB - 0.03, top + 0.05, 2.4, z - 0.8, z + 0.8, this.r.door, this.W, this.W);
      this.faceT(B.o, s, uB - 0.03, top + 4.5, 1.5, z - 0.6, z + 0.6, this.win[1], this.W, this.W);
      if (R() < 0.5) this.faceT(B.g, s, uB - 0.05, top + 4.5, 1.5, z - 0.6, z + 0.6, this.winLit[1], this.W, this.W);
      this.faceT(B.o, s, uB - 0.03, top + 1.2, 1.4, z - 3.6, z - 2.7, this.poster[(R() * 4) | 0], this.W, this.W);
    }
    this.pool(B, s * 7, (zF + zN) / 2, 0.01, this.W); // no-op sized pool keeps glow mesh non-empty
    this.buildingRow(B, s, zF, zN, GROUND, 22 + R() * 3, R, Z, { shops: false });
  },
};

// Scenery: extra helpers bound after the class for readability
Scenery.prototype.ceilingGlow = function (B, s, u, y, z) {
  const c = lin(0xfff4d8);
  const xa = s * (u - 0.4), xb = s * (u + 0.4);
  B.g.tiled(Math.max(xa, xb), y, z - 2.2, 0, 0, 1, 4.4, -1, 0, 0, 0.8, this.c.glow, 0, 0, c, c, 99);
  this.pool(B, s * (u + 0.8), z, 3.2, shade(c, 0.45));
};
Scenery.prototype.warehouse = function (B, s, uF, zF, zN, R, dock = false) {
  const b = B.o;
  const tint = lin(PAL.warehouse[(R() * PAL.warehouse.length) | 0]);
  const h = 7 + R() * 4, depth = 16 + R() * 10;
  this.box(b, s, uF, uF + depth, GROUND, GROUND + h, zF, zN, fz(s, { t: this.r.corrugated, near: this.r.corrugated, far: this.r.corrugated, top: this.r.roof }), shade(tint, 0.72), { cT: tint, tile: 2.4, tileV: 2.4, tileTop: 5, tileTopV: 5 });
  // roof trim
  this.box(b, s, uF - 0.2, uF + depth, GROUND + h, GROUND + h + 0.35, zF, zN, this.r.white, lin(0xe8e4dc));
  // roll-up doors facing the track
  const n = Math.max(1, Math.round((zN - zF) / 8));
  const sw = (zN - zF) / n;
  for (let i = 0; i < n; i++) {
    const zc = zN - (i + 0.5) * sw;
    this.faceT(b, s, uF - 0.03, GROUND, 4.2, zc - 2.1, zc + 2.1, this.r.garage, this.W, this.W);
    if (dock) this.box(B.n, s, uF - 1.6, uF, GROUND, GROUND + 1.1, zc - 2.6, zc + 2.6, this.r.concrete, shade(lin(0xc2bbae), 0.8), { cT: lin(0xc2bbae), tile: 3.2 });
    this.halo(B, s * (uF - 0.3), GROUND + 4.8, zc, 1.3, lin(0xffe0a8));
    this.box(b, s, uF - 0.3, uF, GROUND + 4.55, GROUND + 4.7, zc - 0.25, zc + 0.25, this.r.white, lin(0x2b2f36));
  }
  // side windows (ribbon) on the runner-facing end
  this.faceZ(b, s, 1, zN + 0.03, uF + 1, uF + depth - 1, GROUND + h - 2.2, 1.0, this.r.far1, lin(0xdce8f0), lin(0xdce8f0), 12, 3);
};

// Decision Arena: while a chunk is built, note where each building's geometry lies in the builders and the
// space it takes, so the collapse can take a building away whole (see race/collapse.js).
for (const name of ['building', 'farBuilding', 'warehouse']) {
  const fn = Scenery.prototype[name];
  Scenery.prototype[name] = function (B, ...rest) {
    if (!this.blocks) return fn.call(this, B, ...rest);
    const a = { o: [B.o.nv, B.o.ni], c: [B.c.nv, B.c.ni], g: [B.g.nv, B.g.ni] };
    const r = fn.call(this, B, ...rest);
    const p = B.o.pos, box = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
    for (let i = a.o[0] * 3; i < B.o.nv * 3; i += 3) {
      for (let k = 0; k < 3; k++) { box[k] = Math.min(box[k], p[i + k]); box[k + 3] = Math.max(box[k + 3], p[i + k]); }
    }
    this.blocks.push({ a, b: { o: [B.o.nv, B.o.ni], c: [B.c.nv, B.c.ni], g: [B.g.nv, B.g.ni] }, box, taken: false });
    return r;
  };
}

// ------------------------------------------------------------------ home (menu backdrop + run start), fixed design
const HOME = {
  1: (k) => ({ type: 'wall', k0: -2, k1: 0, h: 4.4, tint: 3, style: 5, fence: 'chain' }),
  [-1]: (k) => ({ type: 'station', k0: -2, k1: 0, h: 4, tint: 0, style: 2, fence: 'rail' }),
};
