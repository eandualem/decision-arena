// REX: a kid in a green dinosaur-hood hoodie: felt teeth around the face, googly eyes on top,
// spikes down the back and a little tail (two jiggly bones).
import * as THREE from 'three';
import { Prim, tube } from '../geo.js';
import { J } from '../skeleton.js';
import { buildHumanoid, shell, rimFn, add3, makeAtlas, REG, hex } from '../body.js';

const OUTFITS = {
  jungle: {
    skin: 0xc98e63, hair: 0x2b1b12, hood: 0x4cc45a, hoodDark: 0x36a046, belly: 0xd8f07a, bellyLine: 0xb8d45a,
    spike: 0xff9f1c, teeth: 0xffffff, eye: 0xffffff, pupil: 0x1b1238, cuff: 0xd8f07a,
    pants: 0x3d4a5c, pantsCuff: 0x2e3848, shoe: 0xf2553d, sole: 0xffffff, strap: 0xffd23f, spots: '#36a046', glow: false,
  },
  lava: {
    skin: 0xc98e63, hair: 0x2b1b12, hood: 0x2d2a33, hoodDark: 0x1f1d24, belly: 0xff6a1f, bellyLine: 0xffd23f,
    spike: 0xff7a1a, teeth: 0xfff2d6, eye: 0xffd23f, pupil: 0x3a0d00, cuff: 0xff6a1f,
    pants: 0x1f1d24, pantsCuff: 0x2d2a33, shoe: 0xff7a1a, sole: 0x1f1d24, strap: 0xffd23f, spots: '#3a3440', glow: true,
  },
};

const deg = THREE.MathUtils.degToRad;
const up = new THREE.Vector3(0, 1, 0);

export default {
  id: 'rex',
  defaultOutfit: 'jungle',
  outfits: OUTFITS,
  body: { hipY: 0.6, thigh: 0.24, shin: 0.22, spine: 0.075, chest: 0.13, neck: 0.15, upperArm: 0.18, forearm: 0.16, shoulderX: 0.22, headR: 0.31 },
  gestures: ['rawr', 'hop', 'wave', 'rawr'],
  face: (o) => ({ kind: 'human', skin: hex(o.skin), iris: '#8a5a2b', iris2: '#3a2010', brow: hex(o.hair), line: '#2a1a14', blush: '#ff8f7f', bandaid: true, eyeScale: 1.08 }),
  atlas: (o) => makeAtlas((g) => {
    const [tx, ty, tw, th] = REG.torso;
    g.fillStyle = hex(o.hood); g.fillRect(tx, ty, tw, th);
    // dino spots on the back and sides
    g.fillStyle = o.spots;
    for (const [x, y, r] of [[200, 40, 16], [240, 90, 12], [300, 55, 18], [180, 110, 10], [330, 120, 14], [270, 135, 9], [150, 60, 9], [360, 80, 10]]) {
      g.beginPath(); g.ellipse(x, ty + y, r * 1.2, r, 0.3, 0, Math.PI * 2); g.fill();
    }
    // belly panel on the front (u ~ 0 / 1 wraps at the front seam)
    const belly = (x0, x1) => {
      g.fillStyle = hex(o.belly); g.fillRect(x0, ty + 30, x1 - x0, th - 30);
      g.fillStyle = hex(o.bellyLine);
      for (let y = 52; y < th; y += 22) g.fillRect(x0, ty + y, x1 - x0, 5);
    };
    belly(0, 78); belly(434, 512);
    if (o.glow) { // lava cracks
      g.strokeStyle = '#ffd23f'; g.lineWidth = 3;
      for (const [x, y] of [[190, 30], [260, 70], [320, 40], [230, 120]]) { g.beginPath(); g.moveTo(x, ty + y); g.lineTo(x + 14, ty + y + 18); g.lineTo(x + 4, ty + y + 30); g.lineTo(x + 20, ty + y + 46); g.stroke(); }
    }
    // kangaroo pocket seam
    g.strokeStyle = 'rgba(0,0,0,0.22)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(0, ty + 108); g.lineTo(60, ty + 108); g.stroke(); g.beginPath(); g.moveTo(452, ty + 108); g.lineTo(512, ty + 108); g.stroke();
    const [hx, hy, hw, hh] = REG.hips;
    g.fillStyle = hex(o.pants); g.fillRect(hx, hy, hw, hh);
    g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(hx + 60, hy, 4, hh); g.fillRect(hx + 190, hy, 4, hh);
  }),
  build(B, rp, dims, o) {
    const H = buildHumanoid(B, rp, {
      skin: o.skin,
      head: { scale: [1.05, 0.97, 1.0], ears: false },
      torso: { print: true, color: o.hood, hem: o.cuff, puffy: 0.022, width: 1.02 },
      sleeves: { len: 'long', color: o.hood, cuff: o.cuff, puff: 0.01 },
      pants: { kind: 'pants', color: o.pants, print: true, cuff: o.pantsCuff },
      shoes: { kind: 'low', color: o.shoe, sole: o.sole, toe: o.sole, accent: o.strap, laces: o.strap, rim: o.shoe, length: 0.3, width: 0.155 },
    }, dims);
    const { headC: hc, hr } = H;
    const R = hr * 1.16;
    const hoodSlot = 'body';
    // curly fringe peeking out
    B.add(shell(rimFn({ front: 64, side: 96, back: 110, bangs: 7, bangCount: 5, bangWidth: 50 }), { lift: (t) => 1.04 - 0.02 * t, lip: 0.97, segA: 28, segT: 4 }),
      { bone: J.head, pos: hc.toArray(), scale: [hr * 1.05, hr * 0.97, hr], color: o.hair });
    // ---- the hood: a shell with a face opening, wraps down to the neck at the back
    const hoodRim = (a) => {
      const k = Math.min(1, Math.abs(a) / deg(88));
      const s = k * k * (3 - 2 * k);
      return deg(57 + (178 - 57) * Math.pow(s, 1.1));
    };
    const hoodCol = (x, y, z, nx, ny, nz) => (nz > 0.2 && ny < 0.5 && ny > -0.6 && Math.sin(y * 40 + x * 20) > 0.7 ? o.hoodDark : o.hood);
    B.add(shell(hoodRim, { lift: (t) => 1.17 - 0.04 * t * t, lip: 1.02, segA: 34, segT: 8 }),
      { bone: J.head, pos: [hc.x, hc.y + 0.01, hc.z + 0.01], scale: [hr * 1.03, hr * 0.99, hr * 1.02], color: hoodCol, slot: hoodSlot });
    const onHood = (thetaDeg, aDeg, lift = 1.17) => {
      const th = deg(thetaDeg), a = deg(aDeg);
      const d = new THREE.Vector3(-Math.sin(th) * Math.sin(a), Math.cos(th), -Math.sin(th) * Math.cos(a));
      return { p: [hc.x + d.x * hr * 1.03 * lift, hc.y + 0.01 + d.y * hr * 0.99 * lift, hc.z + 0.01 + d.z * hr * 1.02 * lift], n: d };
    };
    // felt teeth along the top of the face opening
    for (let a = -48; a <= 48; a += 12) {
      const { p, n } = onHood(hoodRim(deg(a)) * 180 / Math.PI + 3, a, 1.12);
      const q = new THREE.Quaternion().setFromUnitVectors(up, new THREE.Vector3(n.x * 0.3, -1, n.z * 0.3).normalize());
      B.add(Prim.cone(0.03, 0.065, 6), { bone: J.head, pos: p, quat: q, color: o.teeth });
    }
    // googly dino eyes on top of the hood
    for (const s of [-1, 1]) {
      const { p, n } = onHood(26, s * 30, 1.14);
      B.add(Prim.sphere(12, 9), { bone: J.head, pos: p, scale: 0.075, color: o.eye, slot: o.glow ? 'glow' : 'body' });
      B.add(Prim.sphere(8, 6), { bone: J.head, pos: [p[0] + n.x * 0.05 + s * 0.005, p[1] + 0.012, p[2] - 0.055], scale: 0.036, color: o.pupil });
      // brow ridge
      B.add(Prim.capsule(0.022, 0.09, 3, 6), { bone: J.head, pos: [p[0], p[1] + 0.07, p[2] + 0.005], rot: [0, 0, s * 1.35], color: o.hoodDark });
    }
    // nostrils on the snout
    for (const s of [-1, 1]) { const { p } = onHood(47, s * 9, 1.16); B.add(Prim.sphere(6, 4), { bone: J.head, pos: p, scale: [0.018, 0.012, 0.012], color: o.hoodDark }); }
    // spikes along the back midline: hood, back, then tail
    const spikeSlot = o.glow ? 'glow' : 'body';
    [[20, 0.07], [52, 0.085], [86, 0.08], [118, 0.07], [148, 0.055]].forEach(([th, h]) => {
      const { p, n } = onHood(th, 180, 1.15);
      const q = new THREE.Quaternion().setFromUnitVectors(up, n);
      B.add(Prim.cone(h * 0.55, h * 1.3, 6), { bone: J.head, pos: [p[0] + n.x * h * 0.45, p[1] + n.y * h * 0.45, p[2] + n.z * h * 0.45], quat: q, color: o.spike, slot: spikeSlot });
    });
    const back = [[rp[J.chest].y + 0.1, 0.07, J.chest], [rp[J.chest].y - 0.02, 0.065, J.chest], [rp[J.spine].y - 0.02, 0.055, J.spine]];
    for (const [y, h, bone] of back) {
      B.add(Prim.cone(h * 0.55, h * 1.3, 6), { bone, pos: [0, y, 0.19 + h * 0.4], rot: [Math.PI / 2 - 0.25, 0, 0], color: o.spike, slot: spikeSlot });
    }
    // ---- tail (two bones)
    const t1 = [0, rp[J.hips].y - 0.06, 0.13], t2 = [0, rp[J.hips].y - 0.15, 0.33];
    B.cylinderBetween(t1, t2, 0.075, 0.11, o.hood, { bone: 'tail1', seg: 10 });
    B.add(Prim.sphere(10, 6), { bone: 'tail1', pos: t1, scale: 0.105, color: o.hood });
    B.cylinderBetween(t2, [0, rp[J.hips].y - 0.2, 0.52], 0.012, 0.075, o.hood, { bone: 'tail2', seg: 10 });
    B.add(Prim.sphere(10, 6), { bone: 'tail2', pos: t2, scale: 0.074, color: o.hood });
    B.add(Prim.cone(0.035, 0.08, 6), { bone: 'tail1', pos: [0, rp[J.hips].y - 0.05, 0.25], rot: [-0.5, 0, 0], color: o.spike, slot: spikeSlot });
    B.add(Prim.cone(0.028, 0.065, 6), { bone: 'tail2', pos: [0, rp[J.hips].y - 0.12, 0.42], rot: [-0.7, 0, 0], color: o.spike, slot: spikeSlot });
    // little felt claws on the sleeve cuffs
    for (const s of [-1, 1]) {
      const fj = s < 0 ? J.foreL : J.foreR;
      const w = rp[s < 0 ? J.handL : J.handR];
      for (const dz of [-0.035, 0, 0.035]) B.add(Prim.cone(0.014, 0.035, 5), { bone: fj, pos: [w.x + s * 0.005, w.y + 0.01, w.z + dz - 0.04], rot: [Math.PI, 0, 0], color: o.teeth });
    }
    // velcro strap on the shoes
    for (const s of [-1, 1]) {
      const fj = s < 0 ? J.footL : J.footR;
      const f = rp[fj];
      B.add(Prim.rbox(0.16, 0.022, 0.06, 0.01, 1), { bone: fj, pos: [f.x, 0.115, -0.06], rot: [0.3, 0, 0], color: o.strap });
    }
    return {
      headC: hc, hr, hs: H.hs,
      anchors: { back: [0, rp[J.chest].y + 0.02, 0.26], headTop: [0, hc.y + 0.42, 0] },
      jetpackZ: 0.27,
      extras: [
        { name: 'tail1', parent: 'hips', pos: t1, jiggle: { gain: 0.0018, k: 90, d: 8, wag: [5.5, 0.18], base: [0.05, 0, 0] } },
        { name: 'tail2', parent: 'tail1', pos: t2, jiggle: { gain: 0.0025, k: 70, d: 7, wag: [5.5, 0.22] } },
      ],
    };
  },
};
