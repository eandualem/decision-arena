// KOA: surfer. Wavy sun-bleached hair, aviator goggles pushed up on the forehead, hibiscus shirt,
// long striped board shorts, shell necklace, slip-on skate shoes.
import * as THREE from 'three';
import { Prim, tube } from '../geo.js';
import { J } from '../skeleton.js';
import { buildHumanoid, shell, rimFn, add3, makeAtlas, REG, hex } from '../body.js';

const OUTFITS = {
  tropic: {
    skin: 0xd69a68, hair: 0x5a3421, tips: 0xc98f4e, strap: 0x7a4a2a, rim: 0xd4a640, lens: 0x3ad7ff,
    shirt: '#16b0b0', flowers: ['#ff4fa3', '#ff9f1c', '#ffd23f', '#ffffff'], leaf: '#0f7f6a', collar: 0x16b0b0,
    shorts: '#ff7a1a', stripe: '#ffffff', stripe2: '#1d2544', shoe: 0x2e4057, sole: 0xf2efe6, beads: [0xfff4e0, 0xe8d0b0, 0x7ad7c9],
  },
  storm: {
    skin: 0xd69a68, hair: 0x2e1d14, tips: 0x8a6a4e, strap: 0x2a2a33, rim: 0xc9ccd6, lens: 0xffd23f,
    shirt: '#1d2544', flowers: ['#ffd23f', '#ffd23f', '#9fb4ff', '#ffffff'], leaf: '#2c3a6e', collar: 0x1d2544, bolts: true,
    shorts: '#5a6270', stripe: '#ffd23f', stripe2: '#2a2f3a', shoe: 0x2a2a33, sole: 0xffd23f, beads: [0xe0e0e0, 0x9aa3b0, 0xffd23f],
  },
};

export default {
  id: 'koa',
  defaultOutfit: 'tropic',
  outfits: OUTFITS,
  body: { thigh: 0.27, shin: 0.25, hipY: 0.67, upperArm: 0.205, forearm: 0.185, shoulderX: 0.235, headR: 0.29 },
  gestures: ['shaka', 'stretch', 'wave', 'shaka'],
  face: (o) => ({ kind: 'human', skin: hex(o.skin), iris: '#3f8a5a', iris2: '#173a24', brow: hex(o.hair), line: '#2a1a12', freckles: true, blush: '#ff9a7a' }),
  atlas: (o) => makeAtlas((g) => {
    const [tx, ty, tw, th] = REG.torso;
    g.fillStyle = o.shirt; g.fillRect(tx, ty, tw, th);
    // leaves then flowers, tiled so the print wraps seamlessly (x mod 512)
    const rnd = mulberry(7);
    const items = [];
    for (let i = 0; i < 26; i++) items.push([rnd() * 512, ty + rnd() * th, 10 + rnd() * 9, i]);
    for (const [x, y, r, i] of items) {
      for (const dx of [-512, 0, 512]) {
        g.save(); g.translate(x + dx, y); g.rotate(i * 1.7);
        g.fillStyle = o.leaf;
        g.beginPath(); g.ellipse(r * 1.1, 0, r * 0.9, r * 0.38, 0, 0, Math.PI * 2); g.fill();
        g.beginPath(); g.ellipse(-r * 0.7, r * 0.7, r * 0.75, r * 0.32, 0.8, 0, Math.PI * 2); g.fill();
        g.restore();
      }
    }
    for (const [x, y, r, i] of items) {
      for (const dx of [-512, 0, 512]) {
        if (o.bolts && i % 2) { bolt(g, x + dx, y, r * 1.1, '#ffd23f'); continue; }
        flower(g, x + dx, y, r, o.flowers[i % o.flowers.length]);
      }
    }
    // button placket at the front seam
    for (const zx of [0, 512]) { g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(zx - 5, ty, 10, th); }
    for (let y = 30; y < th; y += 34) for (const zx of [4, 508]) { g.fillStyle = '#fff4e0'; g.beginPath(); g.arc(zx, ty + y, 4, 0, Math.PI * 2); g.fill(); }
    // board shorts: vertical racing stripes + wave hem
    const [hx, hy, hw, hh] = REG.hips;
    g.fillStyle = o.shorts; g.fillRect(hx, hy, hw, hh);
    for (const x of [44, 212]) { g.fillStyle = o.stripe; g.fillRect(hx + x, hy, 12, hh); g.fillStyle = o.stripe2; g.fillRect(hx + x + 12, hy, 5, hh); }
    g.fillStyle = o.stripe;
    for (let x = 0; x < hw; x += 24) { g.beginPath(); g.arc(hx + x + 12, hy + hh - 6, 9, Math.PI, 0); g.fill(); }
  }),
  build(B, rp, dims, o) {
    const shirtHex = parseInt(o.shirt.slice(1), 16);
    const H = buildHumanoid(B, rp, {
      skin: o.skin,
      head: { scale: [1.03, 0.98, 1.0] },
      torso: { print: true, color: 0xffffff, width: 1.0, puffy: 0.006 },
      sleeves: { len: 'short', color: shirtHex, cuff: null },
      pants: { kind: 'shorts', color: parseInt(o.shorts.slice(1), 16), print: true, length: 0.25, flare: 1.12 },
      shoes: { kind: 'low', color: o.shoe, sole: o.sole, toe: o.sole, accent: o.sole, laces: o.shoe, rim: o.shoe, gum: 0xcfc6b0 },
    }, dims);
    const { headC: hc, hr } = H;
    // ---- wavy hair with sun-bleached tips + a few curls
    const hairCol = (x, y, z, nx, ny) => (y < hc.y + 0.06 && ny < 0.45 ? o.tips : o.hair);
    B.add(shell(rimFn({ front: 66, side: 104, back: 124, bangs: 16, bangCount: 5, bangWidth: 75, part: -10 }), { lift: (t, a) => 1.11 - 0.07 * t * t + 0.02 * Math.sin(a * 7), lip: 0.97, segA: 34, segT: 6 }),
      { bone: J.head, pos: hc.toArray(), scale: [hr * 1.05, hr * 1.0, hr * 1.02], color: hairCol });
    const curls = [[-0.27, 0.12, -0.02], [0.28, 0.1, 0.0], [-0.2, 0.26, 0.1], [0.19, 0.27, 0.1], [0.0, 0.31, 0.12], [-0.25, -0.02, 0.14], [0.26, -0.03, 0.13], [0.0, 0.05, 0.3], [-0.14, 0.2, 0.24], [0.15, 0.2, 0.25]];
    for (const [x, y, z] of curls) B.add(Prim.sphere(8, 6), { bone: J.head, pos: [hc.x + x, hc.y + y, hc.z + z], scale: 0.085, color: y < 0.06 ? o.tips : o.hair });
    // ---- aviator goggles on the forehead: strap around the head + twin lenses with brass rims
    const gy = hc.y + 0.17;
    B.add(Prim.torus(0.325, 0.02, 4, 26), { bone: J.head, pos: [hc.x, gy - 0.02, hc.z + 0.01], rot: [Math.PI / 2 - 0.42, 0, 0], scale: [1.02, 1.0, 1], color: o.strap });
    for (const s of [-1, 1]) {
      const p = [s * 0.095, gy + 0.04, hc.z - 0.255];
      const rot = [-0.62, s * 0.2, 0];
      B.add(Prim.cylinder(0.078, 0.084, 0.05, 14), { bone: J.head, pos: p, rot: [rot[0] + Math.PI / 2, rot[1], 0], color: o.strap });
      B.add(Prim.torus(0.075, 0.016, 5, 14), { bone: J.head, pos: [p[0], p[1] + 0.012, p[2] - 0.024], rot, color: o.rim, slot: 'shiny' });
      B.add(Prim.sphere(12, 6), { bone: J.head, pos: [p[0], p[1] + 0.012, p[2] - 0.026], rot: [rot[0] - Math.PI / 2, rot[1], 0], scale: [0.068, 0.018, 0.068], color: o.lens, slot: 'shiny' });
    }
    B.add(Prim.box(0.05, 0.022, 0.02), { bone: J.head, pos: [0, gy + 0.052, hc.z - 0.29], rot: [-0.6, 0, 0], color: o.rim, slot: 'shiny' });
    // ---- open shirt collar flaps + shell necklace
    const ny = rp[J.neck].y;
    for (const s of [-1, 1]) {
      B.add(Prim.rbox(0.1, 0.02, 0.12, 0.008, 1), { bone: J.chest, pos: [s * 0.075, ny - 0.02, -0.075], rot: [0.9, s * 0.5, s * 0.3], color: o.collar });
    }
    B.add(Prim.torus(0.1, 0.014, 5, 16), { bone: J.chest, pos: [0, ny - 0.03, -0.035], rot: [Math.PI / 2 + 0.55, 0, 0], color: (x) => o.beads[Math.floor((x + 1) * 60) % 3] });
    B.add(Prim.sphere(8, 6), { bone: J.chest, pos: [0, ny - 0.1, -0.13], scale: [0.028, 0.034, 0.014], color: 0xff9f7a });
    return {
      headC: hc, hr, hs: H.hs,
      anchors: { back: [0, rp[J.chest].y + 0.02, 0.22], headTop: [0, hc.y + 0.4, 0] },
      jetpackZ: 0.2,
      extras: [],
    };
  },
};

function flower(g, x, y, r, col) {
  g.fillStyle = col;
  for (let k = 0; k < 5; k++) { const a = k * Math.PI * 2 / 5; g.beginPath(); g.ellipse(x + Math.cos(a) * r * 0.55, y + Math.sin(a) * r * 0.55, r * 0.55, r * 0.38, a, 0, Math.PI * 2); g.fill(); }
  g.fillStyle = '#ffe066'; g.beginPath(); g.arc(x, y, r * 0.22, 0, Math.PI * 2); g.fill();
}
function bolt(g, x, y, s, col) {
  g.fillStyle = col; g.beginPath();
  [[0.2, -1], [-0.6, 0.15], [-0.05, 0.15], [-0.3, 1], [0.6, -0.2], [0.05, -0.2]].forEach(([a, b], i) => (i ? g.lineTo(x + a * s, y + b * s) : g.moveTo(x + a * s, y + b * s)));
  g.closePath(); g.fill();
}
function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
