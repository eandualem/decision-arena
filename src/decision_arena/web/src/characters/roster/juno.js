// JUNO: roller-derby jammer. Glossy helmet with star covers, afro puffs, number jersey, elbow/knee pads,
// wrist guards, striped knee socks and quad skates.
import * as THREE from 'three';
import { Prim, tube, plate } from '../geo.js';
import { J } from '../skeleton.js';
import { buildHumanoid, shell, rimFn, add3, makeAtlas, REG, hex } from '../body.js';

const OUTFITS = {
  derby: {
    skin: 0x8d5a3b, hair: 0x1b1414, helmet: 0x1e1e26, star: 0xff4fa3, jersey: '#e8384f', jerseyDark: '#b82338', trim: '#ffffff', number: '#ffffff', numberLine: '#1b1238',
    pad: 0x22222a, padBand: 0xff4fa3, shorts: '#22222a', shortsStripe: '#e8384f', sock: 0xff4fa3, sockStripe: 0xffffff,
    skate: 0xf4f4f8, wheel: 0xffd23f, tie: 0xff4fa3,
  },
  arctic: {
    skin: 0x8d5a3b, hair: 0x1b1414, helmet: 0xe8eef6, star: 0x3a6fd8, jersey: '#bfe9ff', jerseyDark: '#8fd0f2', trim: '#1d2544', number: '#1d2544', numberLine: '#ffffff',
    pad: 0x1d2544, padBand: 0x3ad7ff, shorts: '#1d2544', shortsStripe: '#3ad7ff', sock: 0xffffff, sockStripe: 0x3ad7ff,
    skate: 0xffffff, wheel: 0x3ad7ff, tie: 0x3ad7ff,
  },
};

function starOutline(r0, r1) {
  const pts = [];
  for (let i = 0; i < 10; i++) { const a = Math.PI / 2 + i * Math.PI / 5, r = i % 2 ? r1 : r0; pts.push([Math.cos(a) * r, Math.sin(a) * r]); }
  return pts;
}

export default {
  id: 'juno',
  defaultOutfit: 'derby',
  outfits: OUTFITS,
  body: { thigh: 0.265, shin: 0.245, hipY: 0.665 },
  gestures: ['kick', 'wave', 'spin', 'stretch'],
  face: () => ({ kind: 'human', skin: '#8d5a3b', iris: '#5a3218', iris2: '#1e0f06', brow: '#1b1414', line: '#1b0f0c', lashes: true, eyeBlack: '#15131a', blush: null }),
  atlas: (o) => makeAtlas((g) => {
    const [tx, ty, tw, th] = REG.torso;
    g.fillStyle = o.jersey; g.fillRect(tx, ty, tw, th);
    // side panels + trim
    g.fillStyle = o.jerseyDark; g.fillRect(100, ty, 56, th); g.fillRect(356, ty, 56, th);
    g.fillStyle = o.trim; g.fillRect(tx, ty, tw, 8); g.fillRect(tx, ty + th - 10, tw, 10);
    // big number on the back
    g.font = '900 88px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.lineWidth = 12; g.strokeStyle = o.numberLine; g.strokeText('13', 256, ty + 84);
    g.fillStyle = o.number; g.fillText('13', 256, ty + 84);
    // small number on the chest (right side as seen from the front)
    g.font = '900 36px Impact, "Arial Black", sans-serif'; g.lineWidth = 6;
    g.strokeText('13', 460, ty + 56); g.fillText('13', 460, ty + 56);
    // shorts
    const [hx, hy, hw, hh] = REG.hips;
    g.fillStyle = o.shorts; g.fillRect(hx, hy, hw, hh);
    g.fillStyle = o.shortsStripe; g.fillRect(hx + 60, hy, 8, hh); g.fillRect(hx + 188, hy, 8, hh);
  }),
  build(B, rp, dims, o) {
    const H = buildHumanoid(B, rp, {
      skin: o.skin,
      head: { scale: [1.04, 0.97, 1.0] },
      torso: { print: true, color: 0xffffff, hem: null, collar: parseInt(o.trim.slice(1), 16), width: 0.98 },
      sleeves: { len: 'short', color: parseInt(o.jersey.slice(1), 16), cuff: parseInt(o.trim.slice(1), 16) },
      pants: { kind: 'shorts', color: parseInt(o.shorts.slice(1), 16), print: true, length: 0.12, flare: 1.02 },
      socks: { color: o.sock, height: 0.2, stripe: o.sockStripe },
      shoes: { kind: 'roller', color: o.skate, sole: 0xdddde6, toe: o.skate, accent: o.padBand, laces: o.padBand, rim: o.skate, wheel: o.wheel },
    }, dims);
    const { headC: hc, hr } = H;
    // hair under the helmet (edges) + afro puffs at the back sides
    B.add(shell(rimFn({ front: 70, side: 104, back: 122 }), { lift: (t) => 1.035 - 0.01 * t, lip: 0.97, segA: 28, segT: 4 }),
      { bone: J.head, pos: hc.toArray(), scale: [hr * 1.05, hr * 0.97, hr], color: o.hair });
    for (const s of [-1, 1]) {
      const name = s < 0 ? 'puffL' : 'puffR';
      const p = [s * 0.25, hc.y - 0.04, hc.z + 0.2];
      B.add(Prim.sphere(14, 10), { bone: name, pos: p, scale: [0.15, 0.14, 0.14], color: (x, y, z) => (Math.sin(x * 90) * Math.sin(y * 85) * Math.sin(z * 80) > 0.25 ? 0x2a2020 : o.hair) });
      B.add(Prim.torus(0.07, 0.02, 4, 12), { bone: name, pos: [p[0] - s * 0.1, p[1], p[2] - 0.07], rot: [0, s * 0.9, 0], color: o.tie });
    }
    // ---- helmet (glossy shell) + vents + star covers + chin strap
    B.add(shell(rimFn({ front: 60, side: 86, back: 108 }), { lift: (t) => 1.14 - 0.035 * t * t, lip: 1.0, segA: 32, segT: 6 }),
      { bone: J.head, pos: [hc.x, hc.y + 0.01, hc.z], scale: [hr * 1.06, hr * 1.0, hr * 1.03], color: o.helmet, slot: 'shiny' });
    for (const x of [-0.07, 0.07]) B.add(Prim.rbox(0.04, 0.02, 0.14, 0.01, 1), { bone: J.head, pos: [x, hc.y + 0.345, hc.z + 0.02], color: 0x0b0b10 });
    const starGeo = plate(starOutline(0.075, 0.032), 0.012, { curveSegments: 1 });
    for (const s of [-1, 1]) {
      B.add(starGeo, { bone: J.head, pos: [s * 0.325, hc.y + 0.11, hc.z + 0.01], rot: [0, s * Math.PI / 2, 0], color: o.star, slot: 'shiny' });
    }
    // brim ridge
    B.add(Prim.torus(0.3, 0.018, 4, 20, Math.PI * 0.7), { bone: J.head, pos: [hc.x, hc.y + 0.14, hc.z - 0.02], rot: [Math.PI / 2 + 0.55, 0, Math.PI * 0.15 + Math.PI], scale: [1.07, 1.04, 1], color: o.helmet, slot: 'shiny' });
    for (const s of [-1, 1]) {
      B.add(tube([[s * 0.31, hc.y + 0.02, hc.z + 0.02], [s * 0.27, hc.y - 0.17, hc.z - 0.06], [s * 0.1, hc.y - 0.29, hc.z - 0.13], [0, hc.y - 0.3, hc.z - 0.14]], 0.011, 8, 4), { bone: J.head, color: 0x15131a });
    }
    // ---- pads: elbows, knees, wrist guards
    for (const s of [-1, 1]) {
      const fj = s < 0 ? J.foreL : J.foreR, sj = s < 0 ? J.shinL : J.shinR;
      const pE = rp[fj], pK = rp[sj], pW = rp[s < 0 ? J.handL : J.handR];
      B.add(Prim.sphere(10, 7), { bone: fj, pos: add3(pE, 0, -0.01, 0.025), scale: [0.07, 0.075, 0.065], color: o.pad, slot: 'shiny' });
      B.add(Prim.cylinder(0.066, 0.066, 0.02, 10, true), { bone: fj, pos: add3(pE, 0, -0.045, 0.0), color: o.padBand });
      B.add(Prim.cylinder(0.058, 0.06, 0.07, 10), { bone: fj, pos: add3(pW, 0, 0.05, 0), color: o.pad });
      B.add(Prim.cylinder(0.061, 0.061, 0.012, 10, true), { bone: fj, pos: add3(pW, 0, 0.06, 0), color: 0xffffff });
      B.add(Prim.sphere(12, 8), { bone: sj, pos: add3(pK, 0, -0.01, -0.03), scale: [0.085, 0.09, 0.075], color: o.pad, slot: 'shiny' });
      B.add(Prim.cylinder(0.082, 0.082, 0.024, 10, true), { bone: sj, pos: add3(pK, 0, -0.06, -0.005), color: o.padBand });
    }
    // mouth-guard case clipped on the shorts
    B.add(Prim.rbox(0.06, 0.05, 0.03, 0.012, 1), { bone: J.hips, pos: [-0.17, rp[J.hips].y + 0.01, -0.02], rot: [0, 0.6, 0], color: o.star });
    return {
      headC: hc, hr, hs: H.hs,
      anchors: { back: [0, rp[J.chest].y + 0.02, 0.22], headTop: [0, hc.y + 0.36, 0] },
      jetpackZ: 0.2,
      extras: [
        { name: 'puffL', parent: 'head', pos: [-0.2, hc.y - 0.02, hc.z + 0.14], jiggle: { gain: 0.001, k: 180, d: 12 } },
        { name: 'puffR', parent: 'head', pos: [0.2, hc.y - 0.02, hc.z + 0.14], jiggle: { gain: 0.001, k: 180, d: 12 } },
      ],
    };
  },
};
