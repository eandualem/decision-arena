// LUNA: little astronaut. Puffy suit with glowing trims, glass bubble helmet over a lilac bob,
// life-support pack, chunky space boots.
import * as THREE from 'three';
import { Prim, tube } from '../geo.js';
import { J } from '../skeleton.js';
import { buildHumanoid, shell, rimFn, add3, makeAtlas, REG, hex } from '../body.js';

const OUTFITS = {
  nova: {
    skin: 0xf4cdb0, hair: 0xc9b8ff, hairDark: 0xa38fe8, suit: '#f4f6fa', suitHex: 0xf4f6fa, panel: '#c9d2e0', panelHex: 0xc9d2e0,
    trim: 0x5ff4ff, trimCss: '#5ff4ff', glove: 0xe6eaf2, boot: 0xf4f6fa, sole: 0x7a8494, badge: '#3a6fd8', iris: '#39a6ff', ring: 0xdfe5ee,
  },
  eclipse: {
    skin: 0xf4cdb0, hair: 0x4b3a8a, hairDark: 0x35286a, suit: '#2a2238', suitHex: 0x2a2238, panel: '#3d3352', panelHex: 0x3d3352,
    trim: 0xff4fd8, trimCss: '#ff4fd8', glove: 0x3d3352, boot: 0x2a2238, sole: 0x15111e, badge: '#ff4fd8', iris: '#c04fd8', ring: 0x3d3352,
  },
};

export default {
  id: 'luna',
  defaultOutfit: 'nova',
  outfits: OUTFITS,
  body: { headR: 0.29 },
  gestures: ['float', 'wave', 'spin', 'float'],
  face: (o) => ({ kind: 'human', skin: hex(o.skin), iris: o.iris, brow: hex(o.hairDark), line: '#2a1a30', lashes: true, blush: '#ff8fb0', eyeScale: 1.05 }),
  atlas: (o) => makeAtlas((g) => {
    const [tx, ty, tw, th] = REG.torso;
    g.fillStyle = o.suit; g.fillRect(tx, ty, tw, th);
    // quilted puffs (horizontal segments)
    for (let y = 14; y < th; y += 26) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(tx, ty + y, tw, 4); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(tx, ty + y + 4, tw, 3); }
    // side panels
    g.fillStyle = o.panel; g.fillRect(96, ty, 64, th); g.fillRect(352, ty, 64, th);
    // glowing chest stripe (front) and back stripe
    g.fillStyle = o.trimCss; g.fillRect(0, ty + 64, 70, 7); g.fillRect(442, ty + 64, 70, 7);
    // mission badge on the shoulder/front-right + moon logo on the back
    g.fillStyle = o.badge; g.beginPath(); g.arc(470, ty + 36, 16, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(470, ty + 36, 9, 0, Math.PI * 2); g.fill();
    g.fillStyle = o.badge; g.beginPath(); g.arc(474, ty + 33, 8, 0, Math.PI * 2); g.fill();
    // hips (suit shorts part)
    const [hx, hy, hw, hh] = REG.hips;
    g.fillStyle = o.suit; g.fillRect(hx, hy, hw, hh);
    g.fillStyle = o.panel; g.fillRect(hx + 50, hy, 30, hh); g.fillRect(hx + 176, hy, 30, hh);
  }),
  build(B, rp, dims, o) {
    const H = buildHumanoid(B, rp, {
      skin: o.skin,
      head: { scale: [1.04, 0.97, 1.0] },
      torso: { print: true, color: 0xffffff, hem: o.panelHex, puffy: 0.035, width: 1.02 },
      sleeves: { len: 'long', color: o.suitHex, cuff: o.panelHex, puff: 0.018 },
      hands: { color: o.glove, cuff: o.panelHex },
      pants: { kind: 'pants', color: o.suitHex, print: true, cuff: null },
      shoes: { kind: 'boot', color: o.boot, sole: o.sole, toe: o.boot, accent: o.trim, laces: o.panelHex, collar: o.boot, rim: o.panelHex, gum: o.sole },
    }, dims);
    const { headC: hc, hr } = H;
    // ---- lilac bob with bangs
    const hairCol = (x, y, z, nx, ny) => (ny > 0.5 && ny < 0.75 ? 0xe8deff : o.hair);
    B.add(shell(rimFn({ front: 64, side: 112, back: 118, bangs: 10, bangCount: 6, bangWidth: 58 }), { lift: (t) => 1.08 - 0.03 * t * t, lip: 0.96, segA: 32, segT: 6 }),
      { bone: J.head, pos: hc.toArray(), scale: [hr * 1.08, hr * 0.99, hr * 1.02], color: hairCol });
    // ---- bubble helmet (glass) + collar ring + little antenna light
    const hy = hc.y + 0.02;
    B.add(Prim.sphere(22, 16), { bone: J.head, pos: [hc.x, hy, hc.z], scale: [0.41, 0.4, 0.4], color: 0xe8f6ff, slot: 'glass' });
    B.add(Prim.torus(0.19, 0.05, 6, 20), { bone: J.chest, pos: [0, rp[J.neck].y + 0.03, 0], rot: [Math.PI / 2, 0, 0], color: o.ring, slot: 'shiny' });
    B.add(Prim.torus(0.19, 0.012, 3, 20), { bone: J.chest, pos: [0, rp[J.neck].y + 0.075, 0], rot: [Math.PI / 2, 0, 0], color: o.trim, slot: 'glow' });
    B.add(Prim.cylinder(0.018, 0.018, 0.08, 6), { bone: J.chest, pos: [0.17, rp[J.neck].y + 0.1, 0.06], color: 0x9aa3b0, slot: 'shiny' });
    B.add(Prim.sphere(8, 6), { bone: J.chest, pos: [0.17, rp[J.neck].y + 0.15, 0.06], scale: 0.025, color: o.trim, slot: 'glow' });
    // ---- glowing trims: cuffs, belt, knees, boots
    for (const s of [-1, 1]) {
      const fj = s < 0 ? J.foreL : J.foreR, sj = s < 0 ? J.shinL : J.shinR, hj = s < 0 ? J.handL : J.handR;
      B.add(Prim.torus(0.062, 0.01, 3, 12), { bone: fj, pos: add3(rp[hj], 0, 0.04, 0), rot: [Math.PI / 2, 0, 0], color: o.trim, slot: 'glow' });
      B.add(Prim.torus(0.082, 0.01, 3, 12), { bone: sj, pos: add3(rp[sj], 0, -0.02, 0), rot: [Math.PI / 2, 0, 0], color: o.trim, slot: 'glow' });
      const f = rp[s < 0 ? J.footL : J.footR];
      B.add(Prim.box(0.02, 0.02, 0.2), { bone: s < 0 ? J.footL : J.footR, pos: [f.x + s * 0.074, 0.075, -0.05], color: o.trim, slot: 'glow' });
    }
    B.add(Prim.torus(0.172, 0.012, 3, 20), { bone: J.hips, pos: [0, rp[J.spine].y - 0.035, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.84, 1], color: o.trim, slot: 'glow' });
    // chest control box
    B.rbox([0, rp[J.chest].y - 0.02, -0.19], [0.14, 0.09, 0.04], 0.015, o.panelHex, { bone: J.chest, seg: 1 });
    [[-0.035, 0xff4f5e], [0, 0xffd23f], [0.035, 0x39d353]].forEach(([x, c]) => B.add(Prim.sphere(6, 4), { bone: J.chest, pos: [x, rp[J.chest].y - 0.02, -0.212], scale: [0.013, 0.013, 0.006], color: c, slot: 'glow' }));
    // ---- life-support pack (hidden with the jetpack)
    const BB = B.sub('back');
    const cy = rp[J.chest].y + 0.01;
    BB.rbox([0, cy, 0.24], [0.3, 0.34, 0.13], 0.05, o.suitHex, { bone: J.chest, seg: 2 });
    for (const s of [-1, 1]) {
      BB.add(Prim.capsule(0.045, 0.2, 3, 8), { bone: J.chest, pos: [s * 0.1, cy + 0.02, 0.33], color: o.panelHex, slot: 'shiny' });
    }
    BB.add(Prim.box(0.06, 0.14, 0.012), { bone: J.chest, pos: [0, cy + 0.02, 0.308], color: o.trim, slot: 'glow' });
    BB.add(Prim.cylinder(0.02, 0.02, 0.012, 8), { bone: J.chest, pos: [0, cy - 0.12, 0.308], rot: [Math.PI / 2, 0, 0], color: 0xff4f5e, slot: 'glow' });
    return {
      headC: hc, hr, hs: H.hs,
      anchors: { back: [0, rp[J.chest].y + 0.02, 0.4], headTop: [0, hy + 0.42, 0] },
      jetpackZ: 0.38,
      extras: [],
    };
  },
};
