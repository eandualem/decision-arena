// ZED: street tagger. Mustard beanie, over-ear headphones, teal windbreaker, backpack full of spray cans,
// cargo shorts, orange high-tops.
import * as THREE from 'three';
import { Prim, tube, lathe } from '../geo.js';
import { J } from '../skeleton.js';
import { buildHumanoid, shell, rimFn, backpack, add3, makeAtlas, REG, region, hex } from '../body.js';

const OUTFITS = {
  street: {
    skin: 0xe8b08a, hair: 0x3a2618, beanie: 0xe3a52a, beanieDark: 0xc98d1c, phones: 0x2b2b38, cups: 0xff7a1a,
    jacket: 0x1fa9a1, jacketDark: 0x168a84, stripeA: 0xffffff, stripeB: 0xff7a1a, cuff: 0xf2f2ee,
    pack: 0xe2483d, packDark: 0xb8352c, shorts: 0x9c8a5b, pocket: 0x857449, socks: 0xffffff, sockStripe: 0x1fa9a1,
    shoe: 0xff7a1a, sole: 0xffffff, toe: 0xffffff, accent: 0xffffff, tag: '#ffffff', tagFill: '#ffd23f',
  },
  midnight: {
    skin: 0xe8b08a, hair: 0x2a1d16, beanie: 0x3a3a4c, beanieDark: 0x2c2c3a, phones: 0xc9ccd6, cups: 0x8a5cff,
    jacket: 0x1d2544, jacketDark: 0x151b33, stripeA: 0x8a5cff, stripeB: 0x3ad7ff, cuff: 0x8a5cff,
    pack: 0x2c2c38, packDark: 0x1f1f29, shorts: 0x26262e, pocket: 0x1c1c22, socks: 0x2c2c38, sockStripe: 0x8a5cff,
    shoe: 0x7b4dff, sole: 0xf0ecff, toe: 0xf0ecff, accent: 0x3ad7ff, tag: '#3ad7ff', tagFill: '#8a5cff',
  },
  neon: {
    skin: 0xe8b08a, hair: 0x2a1d16, beanie: 0xff4fa3, beanieDark: 0xd93a87, phones: 0x16161f, cups: 0xc6ff3d,
    jacket: 0x17171f, jacketDark: 0x0f0f15, stripeA: 0xc6ff3d, stripeB: 0xff4fa3, cuff: 0xc6ff3d,
    pack: 0x17171f, packDark: 0x0f0f15, shorts: 0x22222a, pocket: 0x18181e, socks: 0x17171f, sockStripe: 0xff4fa3,
    shoe: 0xc6ff3d, sole: 0x17171f, toe: 0xc6ff3d, accent: 0xff4fa3, tag: '#c6ff3d', tagFill: '#ff4fa3', glow: true,
  },
};

export default {
  id: 'zed',
  defaultOutfit: 'street',
  outfits: OUTFITS,
  body: {},
  gestures: ['shake', 'headphones', 'wave', 'stretch'],
  face: (o) => ({ kind: 'human', skin: hex(o.skin), iris: '#6b4a2e', iris2: '#2a170c', brow: hex(o.hair), line: '#2a1a14', blush: '#ff8f8f', bandaid: false }),
  atlas: (o) => makeAtlas((g) => {
    const [tx, ty, tw, th] = REG.torso;
    g.fillStyle = hex(o.jacket); g.fillRect(tx, ty, tw, th);
    // lower darker block
    g.fillStyle = hex(o.jacketDark); g.fillRect(tx, ty + th * 0.62, tw, th * 0.38);
    // chest chevron stripes (front half: x in [0,150] U [362,512])
    const band = (y, h, c) => { g.fillStyle = c; g.fillRect(tx, ty + y, tw, h); };
    band(th * 0.5, 9, hex(o.stripeA));
    band(th * 0.5 + 9, 7, hex(o.stripeB));
    // shoulder yoke
    g.fillStyle = hex(o.jacketDark); g.fillRect(tx, ty, tw, 14);
    // zipper at the front seam
    for (const zx of [0, 512]) {
      g.fillStyle = '#2b2b33'; g.fillRect(zx - 3, ty, 6, th);
      g.fillStyle = '#c9ccd1'; for (let y = 4; y < th; y += 6) g.fillRect(zx - 2, ty + y, 4, 2);
    }
    // side seams
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(126, ty, 3, th); g.fillRect(383, ty, 3, th);
    // pockets on the front (welt lines)
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(40, ty + th * 0.78, 50, 4); g.fillRect(422, ty + th * 0.78, 50, 4);
    // cargo shorts
    const [hx, hy, hw, hh] = REG.hips;
    g.fillStyle = hex(o.shorts); g.fillRect(hx, hy, hw, hh);
    g.fillStyle = 'rgba(0,0,0,0.18)'; for (let x = hx; x < hx + hw; x += 64) g.fillRect(x + 30, hy, 2, hh);
    // back tag decal (extra region): bubble "Z" with drips
    const [ex, ey, ew, eh] = REG.extra;
    g.fillStyle = hex(o.pack); g.fillRect(ex, ey, ew, eh);
    drawTag(g, ex + ew / 2, ey + eh / 2, eh * 0.42, o.tag, o.tagFill);
  }),
  build(B, rp, dims, o) {
    const glowSlot = o.glow ? 'glow' : 'body';
    const H = buildHumanoid(B, rp, {
      skin: o.skin,
      head: { scale: [1.05, 0.96, 1.0], ears: false },
      torso: { print: true, color: o.jacket, hem: o.cuff, collar: o.jacketDark, puffy: 0.012 },
      sleeves: { len: 'long', color: o.jacket, cuff: o.cuff, puff: 0.004 },
      pants: { kind: 'shorts', color: o.shorts, print: true, length: 0.2, flare: 1.08, cuff: o.pocket },
      socks: { color: o.socks, height: 0.1, stripe: o.sockStripe },
      shoes: { kind: 'high', color: o.shoe, sole: o.sole, toe: o.toe, accent: o.accent, laces: o.glow ? 0xc6ff3d : 0xffffff, rim: o.sole },
    }, dims);
    const { headC, hr } = H;
    const hc = headC;
    // ---- hair: a fringe peeking out under the beanie + sideburns
    B.add(shell(rimFn({ front: 67, side: 100, back: 116, bangs: 9, bangCount: 4, bangWidth: 58 }), { lift: (t) => 1.05 - 0.032 * t, lip: 0.97, segA: 30, segT: 5 }),
      { bone: J.head, pos: hc.toArray(), scale: [hr * 1.05, hr * 0.97, hr], color: o.hair });
    // ---- beanie: slouchy ribbed crown + folded cuff, tilted back
    const tilt = new THREE.Matrix4().makeRotationX(0.36).setPosition(hc.x, hc.y + 0.1, hc.z + 0.012);
    const rib = (dark) => (x, y, z) => {
      const a = Math.atan2(x - hc.x, z - hc.z);
      const on = Math.sin(a * 18) > 0.1;
      return dark ? (on ? o.beanieDark : o.beanie) : (on ? o.beanie : o.beanieDark);
    };
    const crown = [[0.322, 0.0], [0.33, 0.07], [0.327, 0.15], [0.31, 0.23], [0.275, 0.3], [0.21, 0.355], [0.12, 0.388], [0.0, 0.396]];
    B.add(lathe(crown, 22, { phiStart: 0 }), { bone: J.head, parent: tilt, color: rib(false) });
    const cuff = [[0.318, -0.012], [0.343, -0.002], [0.352, 0.045], [0.345, 0.092], [0.322, 0.104]];
    B.add(lathe(cuff, 22, { phiStart: 0 }), { bone: J.head, parent: tilt, color: rib(true) });
    B.add(Prim.box(0.07, 0.045, 0.02), { bone: J.head, parent: tilt, pos: [0.15, 0.045, -0.31], rot: [0.05, 0.45, 0], color: 0xffffff });
    // ---- headphones (band over the beanie, big cups over the ears)
    const cupY = hc.y - 0.01;
    const bandPts = [];
    for (let i = 0; i <= 8; i++) {
      const a = -Math.PI / 2 + (i / 8) * Math.PI;
      bandPts.push([Math.sin(a) * 0.35, cupY + 0.05 + Math.cos(a) * 0.47, 0.0 + Math.cos(a) * 0.02]);
    }
    B.add(tube(bandPts, 0.024, 14, 5), { bone: J.head, color: o.phones });
    for (const s of [-1, 1]) {
      const cx = s * 0.335;
      B.add(Prim.cylinder(0.1, 0.095, 0.075, 12), { bone: J.head, pos: [cx, cupY, hc.z + 0.02], rot: [0, 0, Math.PI / 2], color: o.cups, slot: o.glow ? 'glow' : 'body' });
      B.add(Prim.torus(0.085, 0.026, 4, 12), { bone: J.head, pos: [cx - s * 0.032, cupY, hc.z + 0.02], rot: [0, Math.PI / 2, 0], color: 0x1e1e26 });
    }
    // ---- hood bunched at the back of the neck + drawstrings
    B.add(Prim.sphere(10, 8), { bone: J.chest, pos: [0, rp[J.neck].y - 0.005, 0.125], scale: [0.17, 0.085, 0.1], rot: [0.25, 0, 0], color: o.jacketDark });
    for (const s of [-1, 1]) {
      B.add(tube([[s * 0.05, rp[J.neck].y - 0.01, -0.13], [s * 0.055, rp[J.neck].y - 0.07, -0.17], [s * 0.05, rp[J.neck].y - 0.14, -0.175]], 0.007, 6, 4), { bone: J.chest, color: o.cuff });
      B.add(Prim.sphere(6, 5), { bone: J.chest, pos: [s * 0.05, rp[J.neck].y - 0.15, -0.175], scale: 0.014, color: o.stripeB });
    }
    // ---- cargo pockets on the shorts
    for (const s of [-1, 1]) {
      const th = s < 0 ? J.thighL : J.thighR;
      B.add(Prim.rbox(0.05, 0.085, 0.1, 0.018, 1), { bone: th, pos: add3(rp[th], s * 0.095, -0.1, 0.0), color: o.pocket });
    }
    // ---- backpack with spray cans (hidden when the jetpack is on)
    const pc = backpack(B.sub('back'), rp, { color: o.pack, pocket: o.packDark, flap: o.packDark, strap: 0x2a2a33, z: 0.17, dy: 0.0 });
    const BB = B.sub('back');
    // tag decal on the backpack's front pocket (faces the camera during runs)
    BB.add(Prim.plane(0.19, 0.125), { bone: J.chest, pos: [0, pc[1] - 0.068, pc[2] + 0.126], slot: 'print', uv: region(...REG.extra), color: 0xffffff });
    const cans = [[-0.08, 0.14, 0x3a6fd8, 0.12], [0.02, 0.17, 0xffc93c, -0.05], [0.09, 0.13, 0xff4fa3, -0.2]];
    for (const [cx, h, cap, tiltZ] of cans) {
      const base = [cx, pc[1] + 0.1, pc[2] - 0.01];
      const m = new THREE.Matrix4().makeRotationZ(tiltZ).setPosition(base[0], base[1], base[2]);
      BB.add(Prim.cylinder(0.034, 0.034, h, 8), { bone: J.chest, parent: m, pos: [0, h / 2, 0], color: (x, y) => 0xd8dde3, slot: 'shiny' });
      BB.add(Prim.cylinder(0.02, 0.034, 0.03, 8), { bone: J.chest, parent: m, pos: [0, h + 0.015, 0], color: 0xd8dde3, slot: 'shiny' });
      BB.add(Prim.cylinder(0.014, 0.018, 0.028, 6), { bone: J.chest, parent: m, pos: [0, h + 0.04, 0], color: cap });
      BB.add(Prim.cylinder(0.035, 0.035, 0.035, 8, true), { bone: J.chest, parent: m, pos: [0, h * 0.55, 0], color: cap });
    }
    if (o.glow) {
      // neon piping on sleeves and the backpack
      for (const s of [-1, 1]) {
        const aj = s < 0 ? J.armL : J.armR;
        B.add(Prim.cylinder(0.067, 0.067, 0.014, 12, true), { bone: aj, pos: add3(rp[aj], 0, -0.12, 0), color: s < 0 ? 0xc6ff3d : 0xff4fa3, slot: 'glow' });
      }
      BB.add(Prim.rbox(0.26, 0.016, 0.02, 0.006, 1), { bone: J.chest, pos: [0, pc[1] - 0.06, pc[2] + 0.1], color: 0xc6ff3d, slot: 'glow' });
    }
    return {
      headC, hr, hs: H.hs,
      anchors: { back: [0, rp[J.chest].y + 0.02, 0.36], headTop: [0, hc.y + 0.43, 0] },
      jetpackZ: 0.38,
      extras: [],
    };
  },
};

function drawTag(g, cx, cy, s, stroke, fill) {
  g.save();
  g.translate(cx, cy);
  g.lineJoin = 'round';
  const Z = [[-0.8, -0.85], [0.75, -0.85], [0.85, -0.55], [-0.2, 0.5], [0.85, 0.5], [0.8, 0.85], [-0.85, 0.85], [-0.9, 0.55], [0.15, -0.5], [-0.75, -0.5]];
  const path = () => { g.beginPath(); Z.forEach(([x, y], i) => (i ? g.lineTo(x * s, y * s) : g.moveTo(x * s, y * s))); g.closePath(); };
  g.fillStyle = '#1b1238'; g.lineWidth = s * 0.34; g.strokeStyle = '#1b1238'; path(); g.stroke();
  g.lineWidth = s * 0.2; g.strokeStyle = stroke; path(); g.stroke();
  g.fillStyle = fill; path(); g.fill();
  // drips
  g.fillStyle = fill;
  for (const [x, len] of [[-0.55, 0.45], [0.3, 0.3], [0.6, 0.55]]) {
    g.fillRect(x * s - s * 0.05, 0.8 * s, s * 0.1, len * s);
    g.beginPath(); g.arc(x * s, (0.8 + len) * s, s * 0.07, 0, Math.PI * 2); g.fill();
  }
  // shine
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.beginPath(); g.ellipse(-0.45 * s, -0.68 * s, s * 0.14, s * 0.05, -0.2, 0, Math.PI * 2); g.fill();
  g.restore();
}
