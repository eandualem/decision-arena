// PIXEL: a small chrome robot with a screen face (emoji eyes) and a bouncy antenna.
import * as THREE from 'three';
import { Prim } from '../geo.js';
import { J } from '../skeleton.js';
import { add3, mitten } from '../body.js';

const OUTFITS = {
  chrome: {
    shell: 0xd3d9e2, shellSlot: 'chrome', joint: 0x3a4150, accent: 0x2fd1ff, accent2: 0xff4fa3, light: 0x5ff4ff,
    screenBg: '#06122a', glyph: '#5ff4ff', boot: 0xb9c1cc, sole: 0x2a2f3a, panel: 0x1b2233, kind: 'chrome',
  },
  retro: {
    shell: 0xe6dac0, shellSlot: 'gloss', joint: 0x6b5a48, accent: 0xff7a1a, accent2: 0x8a5a2b, light: 0x8cff6a,
    screenBg: '#081a08', glyph: '#8cff6a', boot: 0xc9b99a, sole: 0x5a4a3a, panel: 0x3a3226, kind: 'gloss',
  },
};

export default {
  id: 'pixel',
  defaultOutfit: 'chrome',
  outfits: OUTFITS,
  body: { hipY: 0.56, thigh: 0.22, shin: 0.23, spine: 0.06, chest: 0.14, neck: 0.12, headUp: 0.04, shoulderX: 0.23, upperArm: 0.17, forearm: 0.16, headR: 0.27, hipX: 0.1 },
  gestures: ['dance', 'wave', 'spin', 'dance'],
  face: (o) => ({ kind: 'screen', screenBg: o.screenBg, glyph: o.glyph }),
  build(B, rp, dims, o) {
    const S = o.shellSlot, sh = o.shell, jt = o.joint;
    const hb = rp[J.head];
    const hc = new THREE.Vector3(0, hb.y + 0.22, 0);
    // ---- head: TV box, screen on the front, ear bolts, antenna
    B.rbox(hc.toArray(), [0.54, 0.44, 0.42], 0.1, sh, { bone: J.head, slot: S, seg: 3 });
    B.rbox([0, hc.y - 0.005, hc.z - 0.2], [0.46, 0.35, 0.03], 0.05, o.panel, { bone: J.head, seg: 2 }); // screen bezel
    for (const s of [-1, 1]) {
      B.add(Prim.cylinder(0.075, 0.075, 0.05, 14), { bone: J.head, pos: [s * 0.285, hc.y, hc.z], rot: [0, 0, Math.PI / 2], color: jt });
      B.add(Prim.cylinder(0.045, 0.045, 0.02, 12), { bone: J.head, pos: [s * 0.315, hc.y, hc.z], rot: [0, 0, Math.PI / 2], color: o.light, slot: 'glow' });
      B.add(Prim.torus(0.06, 0.012, 4, 14), { bone: J.head, pos: [s * 0.31, hc.y, hc.z], rot: [0, Math.PI / 2, 0], color: o.accent, slot: 'shiny' });
    }
    // top vent + antenna base
    for (let i = -1; i <= 1; i++) B.add(Prim.box(0.1, 0.012, 0.02), { bone: J.head, pos: [0, hc.y + 0.222, hc.z + 0.08 + i * 0.04], color: jt });
    B.add(Prim.cylinder(0.04, 0.05, 0.035, 10), { bone: J.head, pos: [0.08, hc.y + 0.235, hc.z - 0.03], color: jt });
    const ab = [0.08, hc.y + 0.25, hc.z - 0.03];
    B.add(Prim.cylinder(0.011, 0.011, 0.17, 6), { bone: 'antenna', pos: [ab[0], ab[1] + 0.085, ab[2]], color: 0x9aa3b0, slot: 'chrome' });
    B.add(Prim.sphere(10, 8), { bone: 'antenna', pos: [ab[0], ab[1] + 0.19, ab[2]], scale: 0.042, color: o.accent2, slot: 'glow' });
    // neck: accordion rings
    for (let i = 0; i < 3; i++) B.add(Prim.cylinder(0.075, 0.075, 0.03, 12), { bone: J.neck, pos: [0, rp[J.neck].y + 0.005 + i * 0.035, 0], color: i % 2 ? jt : 0x9aa3b0, slot: i % 2 ? 'body' : 'chrome' });
    // ---- torso: rounded chest box + waist + chest panel with lights
    const cy = rp[J.chest].y + 0.04;
    B.rbox([0, cy, 0], [0.4, 0.32, 0.28], 0.09, sh, { bone: J.chest, slot: S, seg: 3 });
    B.rbox([0, cy + 0.01, -0.14], [0.22, 0.14, 0.02], 0.02, o.panel, { bone: J.chest, seg: 1 });
    B.add(Prim.sphere(10, 6), { bone: J.chest, pos: [0, cy + 0.02, -0.152], scale: [0.035, 0.035, 0.01], color: o.light, slot: 'glow' });
    [[-0.07, 0xff4f5e], [0.06, 0xffd23f], [0.085, 0x39d353]].forEach(([x, c], i) => B.add(Prim.sphere(6, 4), { bone: J.chest, pos: [x, cy - 0.035 + (i ? 0 : 0.03), -0.152], scale: [0.016, 0.016, 0.008], color: c, slot: 'glow' }));
    B.add(Prim.cylinder(0.13, 0.15, 0.1, 14), { bone: J.spine, pos: [0, rp[J.spine].y - 0.01, 0], scale: [1, 1, 0.85], color: jt });
    B.add(Prim.torus(0.15, 0.015, 4, 16), { bone: J.spine, pos: [0, rp[J.spine].y + 0.04, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.85, 1], color: o.accent, slot: 'shiny' });
    // hips
    B.rbox([0, rp[J.hips].y - 0.03, 0], [0.32, 0.15, 0.24], 0.06, sh, { bone: J.hips, slot: S, seg: 2 });
    // ---- arms
    for (const s of [-1, 1]) {
      const aj = s < 0 ? J.armL : J.armR, fj = s < 0 ? J.foreL : J.foreR, hj = s < 0 ? J.handL : J.handR;
      const pA = rp[aj], pE = rp[fj], pW = rp[hj];
      B.add(Prim.sphere(12, 9), { bone: aj, pos: add3(pA, s * 0.01, 0, 0), scale: 0.075, color: sh, slot: S });
      B.cylinderBetween(add3(pA, 0, -0.03, 0), add3(pE, 0, 0.02, 0), 0.034, 0.034, 0x9aa3b0, { bone: aj, seg: 8, slot: 'chrome' });
      B.add(Prim.sphere(10, 7), { bone: fj, pos: pE.toArray(), scale: 0.048, color: jt });
      B.cylinderBetween(add3(pE, 0, -0.02, 0), add3(pW, 0, 0.02, 0), 0.05, 0.065, sh, { bone: fj, seg: 10, slot: S });
      B.add(Prim.torus(0.062, 0.01, 4, 12), { bone: fj, pos: add3(pW, 0, 0.03, 0), rot: [Math.PI / 2, 0, 0], color: o.accent, slot: 'glow' });
      mitten(B, hj, pW, s, jt, { scale: 1.05 });
    }
    // ---- legs: pistons + chunky boots
    for (const s of [-1, 1]) {
      const th = s < 0 ? J.thighL : J.thighR, sn = s < 0 ? J.shinL : J.shinR, ft = s < 0 ? J.footL : J.footR;
      const pT = rp[th], pS = rp[sn], pF = rp[ft];
      B.add(Prim.sphere(10, 7), { bone: th, pos: pT.toArray(), scale: 0.06, color: jt });
      B.cylinderBetween(add3(pT, 0, -0.02, 0), add3(pS, 0, 0.02, 0), 0.04, 0.04, 0x9aa3b0, { bone: th, seg: 8, slot: 'chrome' });
      B.add(Prim.sphere(10, 7), { bone: sn, pos: pS.toArray(), scale: 0.055, color: jt });
      B.cylinderBetween(add3(pS, 0, -0.02, 0), add3(pF, 0, 0.05, 0), 0.058, 0.075, sh, { bone: sn, seg: 10, slot: S });
      B.rbox([pF.x, 0.07, -0.03], [0.17, 0.12, 0.3], 0.055, o.boot, { bone: ft, slot: S, seg: 2 });
      B.rbox([pF.x, 0.018, -0.03], [0.18, 0.036, 0.31], 0.016, o.sole, { bone: ft, seg: 1 });
      B.add(Prim.box(0.14, 0.012, 0.012), { bone: ft, pos: [pF.x, 0.1, -0.18], color: o.light, slot: 'glow' });
    }
    // ---- battery pack (hidden with the jetpack)
    const BB = B.sub('back');
    BB.rbox([0, cy - 0.01, 0.19], [0.26, 0.24, 0.1], 0.04, o.panel, { bone: J.chest, seg: 2 });
    for (let i = 0; i < 3; i++) BB.add(Prim.box(0.18, 0.014, 0.012), { bone: J.chest, pos: [0, cy + 0.06 - i * 0.04, 0.245], color: 0x0b0f18 });
    BB.add(Prim.box(0.05, 0.12, 0.012), { bone: J.chest, pos: [0.09, cy - 0.02, 0.246], color: o.light, slot: 'glow' });
    // screen (the face mesh) on the head bone
    const screen = new THREE.PlaneGeometry(0.4, 0.3);
    screen.rotateY(Math.PI);
    screen.translate(hc.x - hb.x, hc.y - 0.005 - hb.y, hc.z - 0.2155 - hb.z);
    return {
      faceGeo: screen,
      shinyKind: o.kind,
      height: 1.58,
      anchors: { back: [0, cy, 0.25], headTop: [0, hc.y + 0.25, 0] },
      jetpackZ: 0.25,
      extras: [
        { name: 'antenna', parent: 'head', pos: ab, jiggle: { gain: 0.0022, k: 110, d: 6 } },
      ],
    };
  },
};
