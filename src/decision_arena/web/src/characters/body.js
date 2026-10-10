// Standard chibi humanoid builder + reusable accessory shapes.
// Everything is placed in model space (rest pose, feet at y = 0, facing -Z) and bound rigidly to one bone.
import * as THREE from 'three';
import { Prim, lathe, tube } from './geo.js';
import { J } from './skeleton.js';
import { FACE_PATCH } from './face.js';

const V = (a) => new THREE.Vector3(a[0], a[1], a[2]);
export const add3 = (p, dx = 0, dy = 0, dz = 0) => [p.x + dx, p.y + dy, p.z + dz];

// ------------------------------------------------------------------ print atlas (per outfit canvas)
export const ATLAS_W = 512, ATLAS_H = 256;
/** canvas pixel rect -> uv region [u0, v0, u1, v1] (v up, like three.js with flipY) */
export function region(x, y, w, h) { return [x / ATLAS_W, 1 - (y + h) / ATLAS_H, (x + w) / ATLAS_W, 1 - y / ATLAS_H]; }
export const REG = {
  torso: [0, 0, 512, 160],   // wraps around the torso: x = 0/512 front center seam, 128 left side, 256 back center, 384 right side
  hips: [0, 160, 256, 96],   // wraps around the pelvis the same way
  extra: [256, 160, 256, 96],
};
export function makeAtlas(draw) {
  const c = document.createElement('canvas');
  c.width = ATLAS_W; c.height = ATLAS_H;
  const g = c.getContext('2d');
  g.fillStyle = '#ffffff'; g.fillRect(0, 0, ATLAS_W, ATLAS_H);
  draw(g);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}
export const hex = (n) => '#' + n.toString(16).padStart(6, '0');

// ------------------------------------------------------------------ parametric shells (hair, hats, hoods)
/**
 * A cap over a sphere whose rim follows theta = rim(a) (a = azimuth from the front, + toward the character's left).
 * lift(t, a) -> radius multiplier (t: 0 crown .. 1 rim). Adds an inner lip so the rim has thickness.
 * Returns a BufferGeometry in unit-head space (multiply by radius via scale when adding).
 */
export function shell(rim, o = {}) {
  const segA = o.segA || 32, segT = o.segT || 6;
  const lift = o.lift || ((t) => 1.06 - 0.05 * t * t);
  const lip = o.lip ?? 0.9;
  const pos = [], idx = [];
  const dir = (th, a) => [-Math.sin(th) * Math.sin(a), Math.cos(th), -Math.sin(th) * Math.cos(a)];
  // crown vertex
  pos.push(0, lift(0, 0), 0);
  for (let j = 1; j <= segT + 1; j++) {
    for (let i = 0; i < segA; i++) {
      const a = -Math.PI + (i / segA) * Math.PI * 2;
      const t = Math.min(1, j / segT);
      const th = rim(a) * t;
      const r = j <= segT ? lift(t, a) : lip;
      const d = dir(th, a);
      pos.push(d[0] * r, d[1] * r, d[2] * r);
    }
  }
  const row = (j, i) => 1 + (j - 1) * segA + ((i % segA) + segA) % segA;
  for (let i = 0; i < segA; i++) idx.push(0, row(1, i), row(1, i + 1));
  for (let j = 1; j <= segT; j++) {
    for (let i = 0; i < segA; i++) {
      const a = row(j, i), b = row(j, i + 1), c = row(j + 1, i + 1), d = row(j + 1, i);
      idx.push(a, d, b, b, d, c);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const uv = new Float32Array((pos.length / 3) * 2);
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}
const deg = THREE.MathUtils.degToRad;
/** helper to build rim functions from control angles (degrees): front, side, back (+ optional bangs) */
export function rimFn({ front = 60, side = 95, back = 115, bangs = 0, bangCount = 5, bangWidth = 70, part = 0 }) {
  return (a) => {
    const aa = Math.abs(a);
    // smooth interpolation front -> side -> back
    let th;
    if (aa < Math.PI / 2) th = front + (side - front) * Math.pow(aa / (Math.PI / 2), 1.6);
    else th = side + (back - side) * Math.pow((aa - Math.PI / 2) / (Math.PI / 2), 1.2);
    if (bangs && aa < deg(bangWidth)) {
      const k = (a + (part ? deg(part) : 0)) / deg(bangWidth) * bangCount * Math.PI;
      th += bangs * Math.pow(Math.abs(Math.cos(k / 2)), 3) * (1 - aa / deg(bangWidth));
    }
    return deg(th);
  };
}

// ------------------------------------------------------------------ humanoid
/**
 * spec: {
 *   skin, head:{scale, ears}, torso:{color, print, hem, collar, zip, puffy, depth}, sleeves:{len:'long'|'short'|'none', color, cuff},
 *   hands:{color}, pants:{kind:'shorts'|'pants', color, print, cuff, legColor}, socks:{color, height}, shoes:{...}
 * }
 */
export function buildHumanoid(B, rp, spec, bodyDims) {
  const S = spec;
  const skin = S.skin;
  const hipY = rp[J.hips].y;
  const headC = headCenter(rp, bodyDims);
  const hr = bodyDims.headR;
  const hs = (S.head && S.head.scale) || [1.04, 0.96, 1.0];

  // ---- head
  B.add(Prim.sphere(18, 13), { bone: J.head, pos: headC.toArray(), scale: [hr * hs[0], hr * hs[1], hr * hs[2]], color: skin });
  if (!S.head || S.head.ears !== false) {
    for (const s of [-1, 1]) {
      B.add(Prim.sphere(8, 6), { bone: J.head, pos: add3(headC, s * hr * hs[0] * 0.97, -0.03, 0.01), scale: [0.035, 0.06, 0.05], color: S.earColor || skin });
    }
  }
  // neck
  B.cylinderBetween(add3(rp[J.neck], 0, -0.03, 0), add3(rp[J.head], 0, 0.05, 0), 0.068, 0.072, skin, { bone: J.neck, seg: 10 });

  // ---- torso (split between spine and chest bones, shared UV space)
  const T = S.torso;
  const w = T.width || 1, dz = T.depth || 0.82, puff = T.puffy || 0;
  const y0 = rp[J.spine].y - 0.05, yN = rp[J.neck].y + 0.03;
  const prof = [
    [0.0, y0], [0.135 * w, y0], [0.168 * w, y0 + 0.02], [0.182 * w + puff, y0 + 0.07], [0.186 * w + puff, y0 + 0.13],
    [0.196 * w + puff, y0 + 0.2], [0.2 * w + puff, y0 + 0.26], [0.188 * w + puff * 0.7, y0 + 0.305], [0.145 * w, yN - 0.02], [0.075, yN], [0.0, yN + 0.004],
  ];
  const split = rp[J.spine].y + 0.1;
  const lower = prof.filter((p) => p[1] <= split + 0.04);
  const upper = prof.filter((p) => p[1] >= split - 0.06);
  const torsoOpt = { vRange: [y0, yN + 0.004] };
  const tUV = T.print ? region(...REG.torso) : null;
  const tSlot = T.print ? 'print' : (T.slot || 'body');
  const tCol = T.print ? 0xffffff : T.color;
  B.add(lathe(lower, 16, torsoOpt), { bone: J.spine, scale: [1, 1, dz], color: tCol, slot: tSlot, uv: tUV });
  B.add(lathe(upper, 16, torsoOpt), { bone: J.chest, scale: [1, 1, dz], color: tCol, slot: tSlot, uv: tUV });
  if (T.hem) { // waistband / jacket hem
    B.add(Prim.torus(0.168 * w + puff * 0.5, 0.022, 5, 16), { bone: J.spine, pos: [0, y0 + 0.018, 0], rot: [Math.PI / 2, 0, 0], scale: [1, dz, 1], color: T.hem });
  }
  if (T.collar) {
    B.add(Prim.torus(0.085, 0.026, 5, 14), { bone: J.chest, pos: [0, yN - 0.012, 0.005], rot: [Math.PI / 2 + 0.12, 0, 0], scale: [1.05, 1, 1], color: T.collar });
  }

  // ---- pelvis / shorts / pants
  const Pn = S.pants;
  const pyTop = rp[J.spine].y + 0.01;
  const pprof = [[0.0, hipY - 0.13], [0.1, hipY - 0.125], [0.158, hipY - 0.09], [0.172, hipY - 0.02], [0.17, hipY + 0.05], [0.16, pyTop], [0.0, pyTop + 0.005]];
  const pUV = Pn.print ? region(...REG.hips) : null;
  B.add(lathe(pprof, 14, {}), { bone: J.hips, scale: [1, 1, 0.84], color: Pn.print ? 0xffffff : Pn.color, slot: Pn.print ? 'print' : 'body', uv: pUV });
  if (Pn.belt) B.add(Prim.torus(0.163, 0.018, 4, 16), { bone: J.hips, pos: [0, pyTop - 0.03, 0], rot: [Math.PI / 2, 0, 0], scale: [1, 0.84, 1], color: Pn.belt });

  // ---- legs
  for (const s of [-1, 1]) {
    const th = s < 0 ? J.thighL : J.thighR, sh = s < 0 ? J.shinL : J.shinR, ft = s < 0 ? J.footL : J.footR;
    const pT = rp[th], pS = rp[sh], pF = rp[ft];
    const shorts = Pn.kind === 'shorts';
    const legCol = Pn.print ? 0xffffff : Pn.color;
    const legSlot = Pn.print ? 'print' : 'body';
    const legUV = Pn.print ? region(REG.hips[0] + 8, REG.hips[1] + 40, 60, 50) : null;
    if (shorts) {
      const len = Pn.length || 0.17;
      B.cylinderBetween(add3(pT, 0.005 * s, 0.05, 0), add3(pT, 0.012 * s, -len, 0.005), 0.088, 0.1 * (Pn.flare || 1), legCol, { bone: th, seg: 12, open: true, slot: legSlot, uv: legUV });
      if (Pn.cuff) B.add(Prim.torus(0.098 * (Pn.flare || 1), 0.014, 4, 14), { bone: th, pos: add3(pT, 0.012 * s, -len, 0.005), rot: [Math.PI / 2, 0, 0], color: Pn.cuff });
      B.capsuleBetween(add3(pT, 0, -0.05, 0), add3(pS, 0, 0.02, 0), 0.058, S.legColor || skin, { bone: th, rad: 8, cap: 3 });
    } else {
      B.capsuleBetween(add3(pT, 0, 0.03, 0), add3(pS, 0, 0.0, 0), 0.08, legCol, { bone: th, rad: 10, cap: 3, slot: legSlot, uv: legUV });
    }
    // knee + shin
    const shinCol = shorts ? (S.legColor || skin) : legCol;
    if (!shorts) B.add(Prim.sphere(8, 6), { bone: sh, pos: pS.toArray(), scale: 0.078, color: shinCol, slot: legSlot, uv: legUV });
    B.capsuleBetween(add3(pS, 0, -0.01, 0), add3(pF, 0, 0.03, 0), shorts ? 0.054 : 0.074, shinCol, { bone: sh, rad: 8, cap: 3, slot: shorts ? 'body' : legSlot, uv: shorts ? null : legUV });
    if (!shorts && Pn.cuff) B.add(Prim.cylinder(0.082, 0.086, 0.05, 12, true), { bone: sh, pos: add3(pF, 0, 0.06, 0), color: Pn.cuff });
    if (S.socks) {
      const sh0 = S.socks.height || 0.1;
      B.add(Prim.cylinder(0.06, 0.062, sh0, 10, true), { bone: sh, pos: add3(pF, 0, 0.02 + sh0 / 2, 0), color: S.socks.color });
      if (S.socks.stripe) B.add(Prim.cylinder(0.0615, 0.0615, 0.018, 10, true), { bone: sh, pos: add3(pF, 0, 0.02 + sh0 - 0.025, 0), color: S.socks.stripe });
    }
    // shoe
    shoe(B, ft, pF, s, S.shoes);
  }

  // ---- arms
  const SL = S.sleeves || { len: 'long', color: T.color };
  const handCol = (S.hands && S.hands.color) || skin;
  for (const s of [-1, 1]) {
    const aj = s < 0 ? J.armL : J.armR, fj = s < 0 ? J.foreL : J.foreR, hj = s < 0 ? J.handL : J.handR;
    const pA = rp[aj], pE = rp[fj], pW = rp[hj];
    const sleeveCol = SL.color ?? T.color;
    const upperCol = SL.len === 'none' ? skin : sleeveCol;
    // shoulder ball
    B.add(Prim.sphere(10, 6), { bone: aj, pos: add3(pA, -s * 0.01, 0, 0), scale: [0.078 + (SL.puff || 0), 0.078 + (SL.puff || 0), 0.074 + (SL.puff || 0)], color: upperCol, slot: SL.slot || 'body' });
    if (SL.len === 'short') {
      B.capsuleBetween(add3(pA, 0, -0.02, 0), add3(pE, 0, 0.02, 0), 0.05, skin, { bone: aj, rad: 8, cap: 3 });
      B.add(Prim.cylinder(0.074, 0.08, 0.11, 10, true), { bone: aj, pos: add3(pA, s * 0.004, -0.05, 0), color: sleeveCol });
      if (SL.cuff) B.add(Prim.torus(0.079, 0.012, 4, 12), { bone: aj, pos: add3(pA, s * 0.004, -0.105, 0), rot: [Math.PI / 2, 0, 0], color: SL.cuff });
    } else {
      B.capsuleBetween(add3(pA, 0, -0.01, 0), add3(pE, 0, 0.0, 0), 0.064 + (SL.puff || 0) * 0.6, upperCol, { bone: aj, rad: 8, cap: 3, slot: SL.slot || 'body' });
    }
    const foreCol = SL.len === 'long' ? sleeveCol : skin;
    B.capsuleBetween(add3(pE, 0, -0.005, 0), add3(pW, 0, 0.02, 0), SL.len === 'long' ? 0.06 : 0.048, foreCol, { bone: fj, rad: 8, cap: 3, slot: SL.len === 'long' ? (SL.slot || 'body') : 'body' });
    if (SL.len === 'long' && SL.cuff) B.add(Prim.cylinder(0.064, 0.066, 0.04, 10, false), { bone: fj, pos: add3(pW, 0, 0.035, 0), color: SL.cuff });
    mitten(B, hj, pW, s, handCol, S.hands);
  }
  return { headC, hr, hs };
}

export function headCenter(rp, b) { return new THREE.Vector3(0, rp[J.head].y + (b.headLift ?? 0.25), -0.005); }

/** Big cartoon hand: palm + finger row + thumb, hanging down from the wrist with the palm facing the body. */
export function mitten(B, bone, pW, s, color, o = {}) {
  const k = (o && o.scale) || 1;
  const c = add3(pW, s * 0.004, -0.068 * k, 0);
  B.add(Prim.sphere(10, 8), { bone, pos: c, scale: [0.046 * k, 0.07 * k, 0.064 * k], color });
  // finger row (slightly curled toward the palm side)
  B.add(Prim.sphere(10, 7), { bone, pos: add3(pW, -s * 0.004, -0.118 * k, -0.004), scale: [0.042 * k, 0.04 * k, 0.062 * k], rot: [0, 0, s * 0.25], color });
  // thumb (front side, -Z)
  B.capsuleBetween(add3(pW, -s * 0.012, -0.045 * k, -0.045 * k), add3(pW, -s * 0.028, -0.09 * k, -0.07 * k), 0.022 * k, color, { bone, rad: 6, cap: 2 });
  if (o && o.cuff) B.add(Prim.cylinder(0.056, 0.058, 0.035, 10, false), { bone, pos: add3(pW, 0, -0.012, 0), color: o.cuff });
}

/**
 * Chunky chibi sneaker around the ankle joint pF (~600 tris).
 * shoes: {kind:'low'|'high'|'boot'|'roller', color, sole, toe, accent, laces, rim, gum, wheel, length, width}
 */
export function shoe(B, bone, pF, s, o) {
  const x = pF.x;
  const col = o.color, sole = o.sole ?? 0xffffff, toe = o.toe ?? sole, accent = o.accent ?? col, laces = o.laces ?? 0xffffff;
  const L = o.length || 0.29, Wd = o.width || 0.148;
  const zc = -0.045; // shoe center is forward of the ankle
  const gum = o.gum ?? 0xd9d2c5;
  const roller = o.kind === 'roller';
  const baseY = roller ? 0.062 : 0; // skates ride on wheels
  const soleH = roller ? 0.04 : 0.05;
  // sole (extruded stadium outline, gum stripe at the bottom)
  B.add(Prim.sole(L, Wd, soleH, 0.5, 0.5), { bone, pos: [x, baseY, zc], color: (px, py) => (py < baseY + 0.012 ? gum : sole) });
  // puffy upper covering the whole sole + bulbous toe box
  const uh = o.kind === 'boot' ? 0.085 : 0.066;
  B.add(Prim.sphere(12, 7), { bone, pos: [x, baseY + soleH + 0.006, zc + 0.012], scale: [Wd * 0.49, uh, L * 0.47], color: col });
  B.add(Prim.sphere(10, 6), { bone, pos: [x, baseY + soleH + 0.004, zc - L * 0.2], scale: [Wd * 0.49, uh * 0.78, L * 0.29], color: col });
  // rubber toe cap
  B.add(Prim.sphere(10, 5), { bone, pos: [x, baseY + soleH - 0.004, zc - L * 0.35], scale: [Wd * 0.45, 0.036, 0.06], color: toe });
  // side accent (both sides)
  for (const side of [-1, 1]) {
    B.add(Prim.sphere(6, 4), { bone, pos: [x + side * Wd * 0.43, baseY + soleH + 0.03, zc + 0.03], scale: [0.012, 0.024, 0.07], rot: [0.3, 0, 0], color: accent });
  }
  // laces + tongue
  for (let i = 0; i < 2; i++) {
    B.add(Prim.box(Wd * 0.5, 0.014, 0.02), { bone, pos: [x, baseY + soleH + uh - 0.006 - i * 0.012, zc - 0.035 + i * 0.045], rot: [0.35, 0, 0], color: laces });
  }
  B.add(Prim.box(Wd * 0.46, 0.05, 0.026), { bone, pos: [x, baseY + soleH + uh + 0.018, zc + 0.045], rot: [-0.3, 0, 0], color: o.tongue ?? col });
  if (o.kind === 'high' || o.kind === 'boot' || roller) {
    const ch = roller ? 0.16 : 0.12;
    B.add(Prim.cylinder(0.07, 0.078, ch, 12, true), { bone, pos: [x, baseY + soleH + ch / 2 + 0.02, 0.012], color: o.collar ?? col });
    B.add(Prim.torus(0.071, 0.016, 4, 12), { bone, pos: [x, baseY + soleH + ch + 0.02, 0.012], rot: [Math.PI / 2, 0, 0], color: o.rim ?? sole });
  } else {
    B.add(Prim.torus(0.062, 0.016, 4, 12), { bone, pos: [x, baseY + soleH + uh + 0.004, 0.02], rot: [Math.PI / 2 - 0.25, 0, 0], color: o.rim ?? col });
  }
  if (roller) {
    B.add(Prim.box(Wd * 0.62, 0.018, L * 0.78), { bone, pos: [x, baseY - 0.004, zc + 0.01], color: 0x9aa0a8, slot: 'shiny' });
    for (const wz of [-0.12, 0.075]) for (const wx of [-1, 1]) {
      B.add(Prim.cylinder(0.033, 0.033, 0.034, 10, false), { bone, pos: [x + wx * Wd * 0.4, 0.034, zc + wz + 0.02], rot: [0, 0, Math.PI / 2], color: o.wheel ?? 0xff4fa3, slot: 'shiny' });
    }
    B.add(Prim.cylinder(0.028, 0.032, 0.04, 8), { bone, pos: [x, 0.035, zc - L * 0.47], rot: [0.5, 0, 0], color: 0xe8e0d0 });
  }
}

// ------------------------------------------------------------------ face patch geometry (separate mesh on the head bone)
export function facePatchGeometry(headC, hr, hs, headBonePos, lift = 1.004) {
  const P = FACE_PATCH;
  const g = new THREE.SphereGeometry(1, 18, 11, -Math.PI / 2 - P.halfPhi, P.halfPhi * 2, P.thetaStart, P.thetaLen);
  g.scale(hr * hs[0] * lift, hr * hs[1] * lift, hr * hs[2] * lift);
  g.translate(headC.x - headBonePos.x, headC.y - headBonePos.y, headC.z - headBonePos.z);
  return g;
}

// ------------------------------------------------------------------ misc accessories
/** Rounded backpack on the chest bone at the back. Returns the pack's model-space center. */
export function backpack(B, rp, o) {
  const cy = rp[J.chest].y + (o.dy ?? 0.0);
  const zb = (o.z ?? 0.2);
  const w = o.w || 0.3, h = o.h || 0.34, d = o.d || 0.15;
  const c = [0, cy, zb + d / 2];
  B.add(Prim.rbox(w, h, d, 0.06, 2), { bone: J.chest, pos: c, color: o.color });
  // front pocket
  B.add(Prim.rbox(w * 0.72, h * 0.42, 0.06, 0.03, 1), { bone: J.chest, pos: [0, cy - h * 0.2, zb + d + 0.02], color: o.pocket ?? o.color });
  // flap
  B.add(Prim.rbox(w * 0.98, 0.08, d * 1.05, 0.035, 1), { bone: J.chest, pos: [0, cy + h / 2 - 0.02, zb + d / 2 + 0.005], color: o.flap ?? o.color });
  // straps over the shoulders
  for (const s of [-1, 1]) {
    const pts = [[s * 0.1, cy - h * 0.35, zb + 0.01], [s * 0.12, cy + 0.12, zb + 0.03], [s * 0.125, rp[J.neck].y + 0.02, 0.05], [s * 0.12, rp[J.neck].y - 0.02, -0.12], [s * 0.115, cy - 0.02, -0.19]];
    B.add(tube(pts, 0.018, 10, 4), { bone: J.chest, color: o.strap ?? 0x2a2a33 });
  }
  return c;
}
