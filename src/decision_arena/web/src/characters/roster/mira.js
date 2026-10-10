// MIRA: pink space buns, purple bomber jacket covered in patches, rolled jeans, yellow sneakers.
import * as THREE from 'three';
import { Prim, tube } from '../geo.js';
import { J } from '../skeleton.js';
import { buildHumanoid, shell, rimFn, add3, makeAtlas, REG, hex } from '../body.js';

const OUTFITS = {
  bomber: {
    skin: 0xf6cfae, hair: 0xff6fae, hairDark: 0xe04a8e, tie: 0x2fd1c5, iris: '#7a5cff',
    jacket: 0x7b4dff, jacketDark: 0x5a33d6, rib: 0x2a1f4a, ribStripe: 0xff9f1c,
    pants: 0x33406e, cuff: 0x4c5c94, shoe: 0xffd23f, sole: 0xffffff, accent: 0xff4fa3, laces: 0xff4fa3,
    patchA: '#ffd23f', patchB: '#2fd1c5', patchC: '#ff4fa3', planet: '#ff9f1c', ring: '#ffffff', earring: 0xffd23f,
  },
  sunset: {
    skin: 0xf6cfae, hair: 0xc04fd8, hairDark: 0x9a35b3, tie: 0xffd23f, iris: '#ff7a4a',
    jacket: 0xff8a3d, jacketDark: 0xe0662a, rib: 0x5a1a4a, ribStripe: 0xff4fa3,
    pants: 0x6d8fd8, cuff: 0x8aa8ea, shoe: 0x2fd1c5, sole: 0xffffff, accent: 0xffd23f, laces: 0xffffff,
    patchA: '#ff4fa3', patchB: '#ffd23f', patchC: '#7a5cff', planet: '#7a5cff', ring: '#ffd23f', earring: 0xff4fa3,
  },
};

export default {
  id: 'mira',
  defaultOutfit: 'bomber',
  outfits: OUTFITS,
  body: {},
  gestures: ['shake', 'wave', 'hop', 'spin'],
  face: (o) => ({ kind: 'human', skin: hex(o.skin), iris: o.iris, brow: hex(o.hairDark), line: '#2a1426', lashes: true, blush: '#ff7f9f', eyeScale: 1.04 }),
  atlas: (o) => makeAtlas((g) => {
    const [tx, ty, tw, th] = REG.torso;
    g.fillStyle = hex(o.jacket); g.fillRect(tx, ty, tw, th);
    // quilted seams
    g.strokeStyle = 'rgba(0,0,0,0.13)'; g.lineWidth = 2;
    for (let y = 20; y < th; y += 28) { g.beginPath(); g.moveTo(tx, ty + y); g.lineTo(tx + tw, ty + y); g.stroke(); }
    // zipper
    for (const zx of [0, 512]) { g.fillStyle = '#d9d9e8'; g.fillRect(zx - 3, ty, 6, th); }
    // sleeve pocket stripe look: side panels
    g.fillStyle = hex(o.jacketDark); g.fillRect(118, ty, 18, th); g.fillRect(376, ty, 18, th);
    // front patches (viewer sees u in [0.75,1] on the left of the chest, [0,0.25] on the right)
    star(g, 450, ty + 55, 22, o.patchA, '#1b1238');
    heart(g, 62, ty + 50, 18, o.patchC, '#1b1238');
    bolt(g, 470, ty + 110, 16, o.patchB, '#1b1238');
    // big back patch: planet with rings
    const cx = 256, cy = ty + 78;
    g.fillStyle = '#1b1238'; g.beginPath(); g.arc(cx, cy, 56, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 51, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a1f4a'; g.beginPath(); g.arc(cx, cy, 47, 0, Math.PI * 2); g.fill();
    for (let i = 0; i < 14; i++) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.fillRect(cx - 40 + ((i * 37) % 80), cy - 38 + ((i * 53) % 76), 2, 2); }
    g.save(); g.translate(cx, cy); g.rotate(-0.35);
    g.strokeStyle = o.ring; g.lineWidth = 6; g.beginPath(); g.ellipse(0, 0, 44, 12, 0, Math.PI, Math.PI * 2); g.stroke();
    g.fillStyle = o.planet; g.beginPath(); g.arc(0, 0, 25, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.beginPath(); g.arc(6, 5, 22, 0, Math.PI * 2); g.fill();
    g.fillStyle = o.planet; g.beginPath(); g.arc(-2, -2, 21, 0, Math.PI * 2); g.fill();
    g.strokeStyle = o.ring; g.beginPath(); g.ellipse(0, 0, 44, 12, 0, 0, Math.PI); g.stroke();
    g.restore();
    // jeans
    const [hx, hy, hw, hh] = REG.hips;
    g.fillStyle = hex(o.pants); g.fillRect(hx, hy, hw, hh);
    g.strokeStyle = 'rgba(255,220,120,0.55)'; g.lineWidth = 2; g.setLineDash([5, 4]);
    for (const x of [40, 216]) { g.beginPath(); g.moveTo(hx + x, hy); g.lineTo(hx + x, hy + hh); g.stroke(); }
    g.setLineDash([]);
  }),
  build(B, rp, dims, o) {
    const H = buildHumanoid(B, rp, {
      skin: o.skin,
      head: { scale: [1.04, 0.97, 1.0] },
      torso: { print: true, color: o.jacket, hem: o.rib, collar: o.rib, puffy: 0.02 },
      sleeves: { len: 'long', color: o.jacket, cuff: o.rib, puff: 0.008 },
      pants: { kind: 'pants', color: o.pants, print: true, cuff: o.cuff },
      shoes: { kind: 'high', color: o.shoe, sole: o.sole, toe: o.sole, accent: o.accent, laces: o.laces, rim: o.accent },
    }, dims);
    const { headC: hc, hr } = H;
    // ---- hair: side-swept bangs, covers the back of the head
    const hairCol = (x, y, z, nx, ny) => (ny > 0.55 && ny < 0.78 ? 0xff9fc9 : o.hair);
    B.add(shell(rimFn({ front: 64, side: 98, back: 128, bangs: 13, bangCount: 3, bangWidth: 65, part: 14 }), { lift: (t) => 1.07 - 0.05 * t * t, lip: 0.96, segA: 32, segT: 6 }),
      { bone: J.head, pos: hc.toArray(), scale: [hr * 1.05, hr * 0.98, hr * 1.01], color: hairCol });
    // face-framing strands
    for (const s of [-1, 1]) {
      B.add(Prim.capsule(0.035, 0.14, 3, 6), { bone: J.head, pos: [s * 0.265, hc.y - 0.1, hc.z - 0.1], rot: [0.1, 0, s * 0.12], color: o.hair });
    }
    // ---- space buns (extra bones for a little bounce) + hair ties
    for (const s of [-1, 1]) {
      const name = s < 0 ? 'bunL' : 'bunR';
      const p = [hc.x + s * 0.2, hc.y + 0.25, hc.z + 0.05];
      B.add(Prim.sphere(14, 10), { bone: name, pos: p, scale: [0.13, 0.12, 0.13], color: (x, y, z) => {
        const a = Math.atan2(z - p[2], x - p[0]) + (y - p[1]) * 18;
        return Math.sin(a * 3) > 0.55 ? o.hairDark : o.hair;
      } });
      B.add(Prim.torus(0.085, 0.022, 5, 14), { bone: name, pos: [p[0] - s * 0.045, p[1] - 0.075, p[2]], rot: [Math.PI / 2, 0, s * 0.5], color: o.tie });
    }
    // earrings (small hoops)
    for (const s of [-1, 1]) B.add(Prim.torus(0.028, 0.007, 4, 10), { bone: J.head, pos: [s * 0.3, hc.y - 0.1, hc.z + 0.02], rot: [0, Math.PI / 2, 0], color: o.earring, slot: 'shiny' });
    // ---- choker
    B.add(Prim.torus(0.072, 0.012, 4, 14), { bone: J.neck, pos: [0, rp[J.neck].y + 0.04, 0], rot: [Math.PI / 2, 0, 0], color: 0x1b1238 });
    // ---- bomber details: rib stripes on hem/cuffs (thin colored rings) + spray-can holster on the hip
    B.add(Prim.torus(0.2, 0.008, 3, 18), { bone: J.spine, pos: [0, rp[J.spine].y - 0.03, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.84, 1], color: o.ribStripe });
    B.add(Prim.cylinder(0.034, 0.034, 0.13, 8), { bone: J.hips, pos: [0.18, rp[J.hips].y - 0.02, 0.03], color: 0xff4fa3, slot: 'shiny' });
    B.add(Prim.cylinder(0.018, 0.024, 0.03, 6), { bone: J.hips, pos: [0.18, rp[J.hips].y + 0.06, 0.03], color: 0xffffff });
    return {
      headC: hc, hr, hs: H.hs,
      anchors: { back: [0, rp[J.chest].y + 0.02, 0.22], headTop: [0, hc.y + 0.4, 0] },
      jetpackZ: 0.2,
      extras: [
        { name: 'bunL', parent: 'head', pos: [hc.x - 0.16, hc.y + 0.2, hc.z + 0.04], jiggle: { gain: 0.0012, k: 160, d: 10 } },
        { name: 'bunR', parent: 'head', pos: [hc.x + 0.16, hc.y + 0.2, hc.z + 0.04], jiggle: { gain: 0.0012, k: 160, d: 10 } },
      ],
    };
  },
};

function star(g, x, y, r, fill, line) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath(); g.lineWidth = 4; g.strokeStyle = line; g.stroke(); g.fillStyle = fill; g.fill();
}
function heart(g, x, y, s, fill, line) {
  g.beginPath(); g.moveTo(x, y + s);
  g.bezierCurveTo(x - s * 1.6, y, x - s * 0.9, y - s * 1.2, x, y - s * 0.4);
  g.bezierCurveTo(x + s * 0.9, y - s * 1.2, x + s * 1.6, y, x, y + s);
  g.lineWidth = 4; g.strokeStyle = line; g.stroke(); g.fillStyle = fill; g.fill();
}
function bolt(g, x, y, s, fill, line) {
  g.beginPath();
  [[0.2, -1], [-0.6, 0.15], [-0.05, 0.15], [-0.3, 1], [0.6, -0.2], [0.05, -0.2]].forEach(([a, b], i) => (i ? g.lineTo(x + a * s, y + b * s) : g.moveTo(x + a * s, y + b * s)));
  g.closePath(); g.lineWidth = 4; g.strokeStyle = line; g.stroke(); g.fillStyle = fill; g.fill();
}
