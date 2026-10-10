// Geometry for everything LEVEL draws. Built once at startup, then instanced through BatchedMeshes.
// Units: meters. Trains/props are modelled in local space centered on x = 0; see each builder for its z origin.
import * as THREE from 'three';
import { box, cyl, sph, tor, part, merge, gridMesh, fanPolygon, planarUV, norm, xf, tint } from './geo.js';
import {
  CAR_LEN, HALF_W, BODY_BOTTOM, NOSE_LEN, ROOF_Y, bodyProfile, sideArc, CAB,
} from './trainspec.js';
import { RAMP, ROOF, OBSTACLE } from './layout.js';

const PI = Math.PI;
const H = CAR_LEN / 2;

// ===================================================================================== TRAIN CARS
/**
 * One car (local z in [-H, H], nose (if any) at +z). type: 'mid' | 'end' | 'solo'.
 * Includes the livery shell, cab face, undercarriage, bogies, roof gear and gangway bellows.
 */
export function buildCar(TA, liv, type) {
  const A = TA.atlas;
  const white = A.center('white');
  const sideR = A.uv('side' + liv, 2), roofR = A.uv('roof', 2), cabR = A.uv('cab' + liv, 1);
  const prof = bodyProfile();
  const arc = sideArc();
  const noseFront = type !== 'mid';
  const noseBack = type === 'solo';
  // z stations (+ taper scale per station)
  const st = [];
  const z0 = -H, z1 = H;
  const segs = 6;
  const nose = (t) => ({ sx: 1 - 0.065 * t * t, sy: 1 - 0.035 * t * t });
  if (noseBack) for (const t of [1, 0.7, 0.35]) st.push({ z: z0 + NOSE_LEN * (1 - t), ...nose(t) });
  const a = noseBack ? z0 + NOSE_LEN : z0, b = noseFront ? z1 - NOSE_LEN : z1;
  for (let i = 0; i <= segs; i++) st.push({ z: a + (b - a) * (i / segs), sx: 1, sy: 1 });
  if (noseFront) for (const t of [0.35, 0.7, 1]) st.push({ z: z1 - NOSE_LEN * (1 - t), ...nose(t) });
  const P = (p, s) => [p.x * s.sx, BODY_BOTTOM + (p.y - BODY_BOTTOM) * s.sy];

  const parts = [];
  // --- side zones (right: x>0 flip winding; left: mirrored)
  const sidePts = prof.filter((p) => p.zone === 'side');
  const sideS = arc.pts.map((p) => p.s / arc.total);
  for (const side of [1, -1]) {
    const rows = st.map((s) => sidePts.map((p, j) => {
      const [x, y] = P(p, s);
      const u = side > 0 ? (H - s.z) / CAR_LEN : (s.z + H) / CAR_LEN;
      return { p: [x * side, y, s.z], uv: [sideR.u0 + (sideR.u1 - sideR.u0) * u, sideR.v0 + (sideR.v1 - sideR.v0) * sideS[j]] };
    }));
    parts.push(gridMesh(rows, side > 0));
  }
  // --- roof zone (left to right)
  const roofPts = prof.filter((p) => p.zone === 'roof');
  const roofRow = [...roofPts.slice().reverse().map((p) => ({ x: -p.x, y: p.y })), ...roofPts.slice(1).map((p) => ({ x: p.x, y: p.y }))];
  const rw = roofPts[0].x;
  parts.push(gridMesh(st.map((s) => roofRow.map((p) => {
    const [x, y] = P(p, s);
    return { p: [x, y, s.z], uv: [roofR.u0 + (roofR.u1 - roofR.u0) * ((s.z + H) / CAR_LEN), roofR.v0 + (roofR.v1 - roofR.v0) * ((p.x + rw) / (2 * rw))] };
  })), false));
  // --- underside
  const ux = prof[1].x;
  parts.push(tint(gridMesh(st.map((s) => [-ux, ux].map((x) => ({ p: [x * s.sx, BODY_BOTTOM, s.z], uv: white }))), true), '#2a2c33'));

  // --- ends
  const outline = (s) => {
    const right = prof.map((p) => P(p, s));
    const left = right.slice().reverse().map(([x, y]) => [-x, y]);
    return [...right, ...left].filter((p, i, arr) => i === 0 || Math.hypot(p[0] - arr[i - 1][0], p[1] - arr[i - 1][1]) > 1e-4);
  };
  const endCap = (zSign, isNose) => {
    const s = zSign > 0 ? st[st.length - 1] : st[0];
    const ol = outline(s);
    // outline order: right side bottom->top then left top->bottom = counter-clockwise seen from +z? compute winding
    let area = 0; for (let i = 0; i < ol.length; i++) { const [x1, y1] = ol[i], [x2, y2] = ol[(i + 1) % ol.length]; area += x1 * y2 - x2 * y1; }
    const ccw = area > 0;
    const g = fanPolygon(ol, s.z, [0, 1.9], zSign > 0 ? !ccw : ccw);
    if (isNose) {
      planarUV(g, 'x', 'y', zSign > 0 ? [-HALF_W * s.sx, HALF_W * s.sx] : [HALF_W * s.sx, -HALF_W * s.sx], [BODY_BOTTOM, BODY_BOTTOM + (ROOF_Y - BODY_BOTTOM) * s.sy], cabR);
    } else part(g, { uv: white, color: '#3b3e46' });
    return g;
  };
  parts.push(endCap(1, noseFront));
  parts.push(endCap(-1, noseBack));

  // --- nose hardware (front and/or back)
  const noseGear = (zs) => {
    const zt = zs > 0 ? z1 : z0;              // tip plane
    const d = zs;                              // outward direction
    const g = [];
    const s = st[zs > 0 ? st.length - 1 : 0];
    // windshield visor (brow)
    g.push(box(1.95, 0.07, 0.16, { uv: white, color: '#24262c', pos: [0, CAB.winY1 + 0.07, zt - d * 0.02] }));
    // headlight bezels
    for (const sx of [-1, 1]) g.push(cyl(CAB.lampR + 0.05, CAB.lampR + 0.05, 0.07, 16, { uv: white, color: '#c9ced6', pos: [sx * CAB.lampX * s.sx, CAB.lampY, zt - d * 0.02], rot: [PI / 2, 0, 0] }));
    // anticlimber + coupler + plow
    g.push(box(1.9 * s.sx, 0.16, 0.12, { uv: white, color: '#2e3037', pos: [0, 0.8, zt - d * 0.04] }));
    for (let i = 0; i < 4; i++) g.push(box(1.8 * s.sx, 0.02, 0.02, { uv: white, color: '#5a5d66', pos: [0, 0.74 + i * 0.04, zt + d * 0.025] }));
    g.push(box(0.26, 0.18, 0.3, { uv: white, color: '#3a3c43', pos: [0, 0.52, zt - d * 0.15] }));
    g.push(box(0.34, 0.24, 0.1, { uv: white, color: '#4a4d55', pos: [0, 0.52, zt - d * 0.03] }));
    // plow wedge
    const plow = box(2.0, 0.32, 0.14, { uv: white, color: '#2a2b31', pos: [0, 0.34, zt - d * 0.12], rot: [zs * 0.35, 0, 0] });
    g.push(plow);
    g.push(box(2.02, 0.05, 0.16, { uv: white, color: '#ffc21a', pos: [0, 0.2, zt - d * 0.08] }));
    // side mirrors
    for (const sx of [-1, 1]) g.push(box(0.06, 0.26, 0.1, { uv: white, color: '#26282e', pos: [sx * (HALF_W * s.sx + 0.03), 2.25, zt - d * 0.25] }));
    return g;
  };
  if (noseFront) parts.push(...noseGear(1));
  if (noseBack) parts.push(...noseGear(-1));

  // --- gangway bellows + couplers on square ends
  const gangway = (zs) => {
    const zt = zs > 0 ? z1 : z0, d = zs;
    const bel = A.uv('bellows', 2);
    return [
      part(new THREE.BoxGeometry(1.46, 1.95, 0.36), { rect: bel, pos: [0, 1.84, zt + d * 0.17] }),
      box(1.5, 0.08, 0.37, { uv: white, color: '#1f2025', pos: [0, 2.83, zt + d * 0.17] }),
      box(0.18, 0.14, 0.4, { uv: white, color: '#3a3c43', pos: [0, 0.6, zt + d * 0.18] }),
    ];
  };
  if (!noseFront) parts.push(...gangway(1));
  if (!noseBack) parts.push(...gangway(-1));

  // --- bogies
  for (const bz of [-4.3, 4.3]) {
    const dark = '#2c2e34', steel = '#8d939c', springC = '#c6582c';
    for (const sx of [-1, 1]) {
      parts.push(box(0.12, 0.26, 2.7, { uv: white, color: dark, pos: [sx * 0.83, 0.5, bz] }));                      // side frame
      parts.push(box(0.16, 0.1, 2.9, { uv: white, color: '#3a3d45', pos: [sx * 0.83, 0.34, bz] }));
      for (const sz of [-0.62, 0.62]) parts.push(cyl(0.08, 0.08, 0.2, 8, { uv: white, color: springC, pos: [sx * 0.83, 0.68, bz + sz] }));   // springs
      for (const wz of [-1.0, 1.0]) {
        parts.push(cyl(0.36, 0.36, 0.1, 16, { uv: white, color: steel, pos: [sx * 0.63, 0.43, bz + wz], rot: [0, 0, PI / 2] }));   // wheel
        parts.push(cyl(0.2, 0.2, 0.12, 10, { uv: white, color: '#5c616a', pos: [sx * 0.64, 0.43, bz + wz], rot: [0, 0, PI / 2] })); // hub
        parts.push(box(0.16, 0.18, 0.24, { uv: white, color: '#44474f', pos: [sx * 0.86, 0.43, bz + wz] }));                       // axle box
      }
    }
    for (const wz of [-1.0, 1.0]) parts.push(cyl(0.05, 0.05, 1.3, 6, { uv: white, color: '#4a4d55', pos: [0, 0.43, bz + wz], rot: [0, 0, PI / 2] }));
    parts.push(box(1.84, 0.16, 0.42, { uv: white, color: dark, pos: [0, 0.6, bz] }));     // bolster
    parts.push(cyl(0.09, 0.09, 0.22, 8, { uv: white, color: '#b8452a', pos: [0.5, 0.55, bz + 0.3], rot: [PI / 2, 0, 0] }));   // brake cylinder
  }
  // underbody equipment
  parts.push(box(1.5, 0.34, 2.6, { uv: white, color: '#33363d', pos: [0, 0.44, 0] }));
  parts.push(box(0.5, 0.28, 1.1, { uv: white, color: '#474a52', pos: [0.62, 0.48, -1.9] }));
  parts.push(box(0.5, 0.26, 1.0, { uv: white, color: '#3f424a', pos: [-0.6, 0.49, 1.9] }));
  parts.push(box(1.2, 0.18, 0.5, { uv: white, color: '#4a4d55', pos: [0, 0.52, -2.6] }));

  // --- roof gear (kept off the center line where the runner goes)
  const grille = A.uv('grille', 2);
  const acZ = [[0.52, -3.1], [-0.52, 3.1]];
  for (const [ax, az] of acZ) {
    const ay = ROOF_Y - 0.08 * (Math.abs(ax) / 0.72) ** 2;
    const unit = part(new THREE.BoxGeometry(0.4, 0.16, 2.1), { uv: A.center('white'), color: '#c7ccd3', pos: [ax, ay + 0.06, az] });
    parts.push(unit);
    parts.push(part(new THREE.PlaneGeometry(0.34, 1.9), { rect: grille, pos: [ax, ay + 0.145, az], rot: [-PI / 2, 0, 0] }));
    parts.push(box(0.42, 0.03, 2.14, { uv: white, color: '#8e949c', pos: [ax, ay - 0.01, az] }));
  }
  for (let i = -2; i <= 2; i++) parts.push(box(0.16, 0.04, 0.34, { uv: white, color: '#7d838c', pos: [(i % 2 ? 0.58 : -0.58), ROOF_Y - 0.04, i * 1.1] }));
  // gutter lines along the roof edge
  for (const sx of [-1, 1]) parts.push(box(0.04, 0.04, (noseFront ? H - NOSE_LEN : H) + (noseBack ? H - NOSE_LEN : H), { uv: white, color: '#6f757e', pos: [sx * 1.08, 2.53, noseFront && !noseBack ? -NOSE_LEN / 2 : !noseFront && noseBack ? NOSE_LEN / 2 : 0] }));

  return merge(parts);
}

/** Headlight + taillight lenses for one cab end (local nose tip at z = 0, facing +z). */
export function buildLamps(TA, lit) {
  const A = TA.atlas;
  const head = A.center(lit ? 'lampLit' : 'lampOff'), tail = A.center('tailOff');
  const s = 1 - 0.065;
  const p = [];
  for (const sx of [-1, 1]) {
    p.push(cyl(CAB.lampR, CAB.lampR * 0.92, 0.07, 18, { uv: head, pos: [sx * CAB.lampX * s, CAB.lampY, 0.01], rot: [PI / 2, 0, 0] }));
    p.push(cyl(CAB.tailR, CAB.tailR, 0.05, 10, { uv: tail, pos: [sx * CAB.tailX * s, CAB.lampY, -0.0], rot: [PI / 2, 0, 0] }));
  }
  return merge(p);
}

/** Number plate quad (local nose tip at z = 0). */
export function buildPlate(TA, i) {
  const rect = TA.atlas.uv('plate' + i, 2);
  return part(new THREE.PlaneGeometry(2 * CAB.plateX, CAB.plateY1 - CAB.plateY0), { rect, pos: [0, (CAB.plateY0 + CAB.plateY1) / 2, 0.005] });
}

/** Graffiti decal: 2:1 quad facing +z, subdivided for the curved world. Width 1, height 0.5. */
export function buildDecal(GA, i) {
  const g = new THREE.PlaneGeometry(1, 0.5, 3, 1);
  return part(g, { rect: GA.atlas.uv('g' + i, 3) });
}

// ===================================================================================== RAMP
/** Ramp in local space: high end at z = 0 (touching the train), low end at z = +RAMP; top surface = collider. */
export function buildRamp(PA) {
  const A = PA.atlas;
  const white = A.center('white');
  const L = Math.hypot(RAMP, ROOF), ang = Math.asin(ROOF / L);
  const nrm = [0, RAMP / L, ROOF / L];
  const deckT = 0.14, W = 2.2;
  const parts = [];
  // deck slab (subdivided along its length)
  const deck = new THREE.BoxGeometry(W, deckT, L, 2, 1, 6);
  norm(deck);
  xf(deck, [0, ROOF / 2 - nrm[1] * deckT / 2, RAMP / 2 - nrm[2] * deckT / 2], [ang, 0, 0]);
  const dr = A.uv('deck', 2);
  {
    const pos = deck.attributes.position, n = deck.attributes.normal, uv = deck.attributes.uv, col = deck.attributes.color;
    const c = new THREE.Color('#d9891c');
    for (let i = 0; i < pos.count; i++) {
      if (n.getY(i) > 0.8) {
        const u = (pos.getX(i) + W / 2) / W, v = (RAMP - pos.getZ(i)) / RAMP;
        uv.setXY(i, dr.u0 + (dr.u1 - dr.u0) * u, dr.v0 + (dr.v1 - dr.v0) * Math.min(1, Math.max(0, v)));
      } else { uv.setXY(i, white[0], white[1]); col.setXYZ(i, c.r, c.g, c.b); }
    }
  }
  parts.push(deck);
  const deckY = (z) => ROOF * (RAMP - z) / RAMP;
  // stringers under the deck edges
  for (const sx of [-1, 1]) {
    const s = box(0.14, 0.3, L, { uv: white, color: '#c8641a' });
    xf(s, [sx * 0.95, ROOF / 2 - nrm[1] * 0.28, RAMP / 2 - nrm[2] * 0.28], [ang, 0, 0]);
    parts.push(s);
  }
  // support columns + braces + base rails
  const colZ = [0.45, 2.9, 5.4];
  for (const cz of colZ) {
    const h = deckY(cz) - 0.3;
    for (const sx of [-1, 1]) parts.push(box(0.16, h, 0.16, { uv: white, color: '#3b3e46', pos: [sx * 0.95, h / 2, cz] }));
    parts.push(box(1.9, 0.1, 0.1, { uv: white, color: '#4a4d55', pos: [0, h * 0.55, cz] }));
    // X brace across
    const dlen = Math.hypot(1.9, h * 0.8);
    for (const s2 of [-1, 1]) parts.push(box(0.06, dlen, 0.06, { uv: white, color: '#5a5e67', pos: [0, h * 0.45, cz], rot: [0, 0, s2 * Math.atan2(1.9, h * 0.8)] }));
  }
  for (const sx of [-1, 1]) {
    parts.push(box(0.2, 0.1, RAMP, { uv: white, color: '#3b3e46', pos: [sx * 0.95, 0.05, RAMP / 2] }));
    // diagonal braces along each side between columns
    for (let i = 0; i < colZ.length - 1; i++) {
      const za = colZ[i], zb = colZ[i + 1], ya = 0.15, yb = deckY(zb) - 0.35;
      const len = Math.hypot(zb - za, yb - ya);
      parts.push(box(0.07, 0.07, len, { uv: white, color: '#5a5e67', pos: [sx * 1.0, (ya + yb) / 2, (za + zb) / 2], rot: [Math.atan2(yb - ya, zb - za), 0, 0] }));
    }
  }
  // side rails: posts + top rail + mid rail
  for (const sx of [-1, 1]) {
    for (let i = 0; i <= 4; i++) {
      const z = 0.25 + i * ((RAMP - 0.6) / 4);
      const y = deckY(z);
      parts.push(box(0.07, 0.62, 0.07, { uv: white, color: '#ffc21a', pos: [sx * 1.06, y + 0.31, z] }));
      parts.push(box(0.09, 0.06, 0.09, { uv: white, color: '#1d1d22', pos: [sx * 1.06, y + 0.63, z] }));
    }
    for (const hh of [0.6, 0.32]) {
      const r = box(0.06, 0.06, L - 0.35, { uv: white, color: hh > 0.5 ? '#ffc21a' : '#e0a010' });
      xf(r, [sx * 1.06, ROOF / 2 + hh - 0.02, RAMP / 2 + 0.05], [ang, 0, 0]);
      parts.push(r);
    }
  }
  // top hook plate resting on the roof + bottom lip
  parts.push(box(2.1, 0.05, 0.5, { uv: white, color: '#6d737c', pos: [0, ROOF + 0.02, -0.18] }));
  parts.push(box(2.2, 0.05, 0.5, { uv: white, color: '#ffc21a', pos: [0, 0.025, RAMP + 0.15] }));
  return merge(parts);
}

// ===================================================================================== BARRIERS
/** Low red/white striped barrier. Local: centered on the collider (z = 0 is the collider middle). */
export function buildBarrierJump(PA) {
  const A = PA.atlas, white = A.center('white');
  const plank = A.uv('plank', 2);
  const parts = [];
  const top = OBSTACLE.barrierJump.maxY;
  const mk = (y0, y1) => part(new THREE.BoxGeometry(2.2, y1 - y0, 0.1), { pos: [0, (y0 + y1) / 2, 0] });
  for (const [y0, y1] of [[0.72, top - 0.01], [0.3, 0.54]]) {
    const g = mk(y0, y1);
    const uv = g.attributes.uv, n = g.attributes.normal;
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getZ(i)) > 0.5) uv.setXY(i, plank.u0 + (plank.u1 - plank.u0) * uv.getX(i), plank.v0 + (plank.v1 - plank.v0) * uv.getY(i));
      else uv.setXY(i, white[0], white[1]);
    }
    parts.push(g);
  }
  // A-frame legs
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) parts.push(box(0.09, 1.08, 0.09, { uv: white, color: '#e9ecef', pos: [sx * 0.98, 0.5, sz * 0.14], rot: [sz * -0.28, 0, 0] }));
    parts.push(box(0.12, 0.05, 0.62, { uv: white, color: '#2a2b31', pos: [sx * 0.98, 0.025, 0] }));
    parts.push(box(0.1, 0.1, 0.1, { uv: white, color: '#2a2b31', pos: [sx * 0.98, top - 0.03, 0] }));
    parts.push(cyl(0.06, 0.06, 0.07, 10, { uv: A.center('amberLit'), pos: [sx * 0.98, top + 0.02, 0] }));
  }
  return merge(parts);
}

/** Tall frame with a hanging DUCK sign; the sign occupies exactly the collider (y rollClear..rollTop). */
export function buildBarrierRoll(PA) {
  const A = PA.atlas, white = A.center('white');
  const { minY, maxY } = OBSTACLE.barrierRoll;
  const parts = [];
  const postH = maxY + 0.24;
  const hz = A.uv('hazardV', 2);
  for (const sx of [-1, 1]) {
    const p = part(new THREE.BoxGeometry(0.14, postH, 0.14), { pos: [sx * 1.14, postH / 2, 0] });
    const uv = p.attributes.uv, pos = p.attributes.position;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, hz.u0 + (hz.u1 - hz.u0) * uv.getX(i), hz.v0 + (hz.v1 - hz.v0) * (pos.getY(i) / postH));
    parts.push(p);
    parts.push(box(0.4, 0.06, 0.5, { uv: white, color: '#2a2b31', pos: [sx * 1.14, 0.03, 0] }));
    parts.push(box(0.05, postH - maxY + 0.02, 0.05, { uv: white, color: '#5c6068', pos: [sx * 0.7, maxY + (postH - maxY) / 2, 0] }));   // hanger rods
  }
  parts.push(box(2.46, 0.14, 0.16, { uv: white, color: '#2e3036', pos: [0, postH + 0.05, 0] }));
  // sign board
  const sign = part(new THREE.BoxGeometry(2.2, maxY - minY, 0.1), { pos: [0, (minY + maxY) / 2, 0] });
  {
    const duck = A.uv('duck', 1), back = A.uv('signBack', 2);
    const uv = sign.attributes.uv, n = sign.attributes.normal, col = sign.attributes.color;
    const c = new THREE.Color('#2a2b31');
    for (let i = 0; i < uv.count; i++) {
      const nz = n.getZ(i);
      if (nz > 0.5) uv.setXY(i, duck.u0 + (duck.u1 - duck.u0) * uv.getX(i), duck.v0 + (duck.v1 - duck.v0) * uv.getY(i));
      else if (nz < -0.5) uv.setXY(i, back.u0 + (back.u1 - back.u0) * uv.getX(i), back.v0 + (back.v1 - back.v0) * uv.getY(i));
      else { uv.setXY(i, white[0], white[1]); col.setXYZ(i, c.r, c.g, c.b); }
    }
  }
  parts.push(sign);
  return merge(parts);
}

/** Track-end buffer stop. Local: centered on the collider; buffers face +z (toward the runner). */
export function buildBumper(PA) {
  const A = PA.atlas, white = A.center('white');
  const D = OBSTACLE.bumper.depth, top = OBSTACLE.bumper.maxY;
  const zf = D / 2;
  const parts = [];
  const red = '#d42a2a', dark = '#2b2d33';
  for (const sx of [-1, 1]) {
    parts.push(box(0.22, 1.12, 0.22, { uv: white, color: red, pos: [sx * 0.62, 0.56, zf - 0.32] }));
    parts.push(box(0.16, 0.12, D, { uv: white, color: dark, pos: [sx * 0.62, 0.06, 0] }));
    // struts back to the ground
    const len = Math.hypot(1.0, D - 0.3);
    parts.push(box(0.14, len, 0.14, { uv: white, color: '#b82222', pos: [sx * 0.62, 0.55, -0.1], rot: [Math.atan2(D - 0.35, 1.0) * -1, 0, 0] }));
    // buffers
    parts.push(cyl(0.09, 0.09, 0.2, 10, { uv: white, color: '#9aa1ab', pos: [sx * 0.62, 0.92, zf - 0.12], rot: [PI / 2, 0, 0] }));
    parts.push(cyl(0.2, 0.2, 0.05, 18, { uv: white, color: '#d9dee5', pos: [sx * 0.62, 0.92, zf - 0.025], rot: [PI / 2, 0, 0] }));
    // red lamps on top
    parts.push(cyl(0.075, 0.075, 0.06, 8, { uv: white, color: dark, pos: [sx * 0.62, 1.15, zf - 0.32] }));
    parts.push(sph(0.08, 12, 8, { uv: A.center('redLit'), pos: [sx * 0.62, top - 0.09, zf - 0.32] }));
  }
  // buffer beam with hazard stripes (front face)
  const beam = part(new THREE.BoxGeometry(2.14, 0.36, 0.24), { pos: [0, 0.92, zf - 0.3] });
  {
    const hz = A.uv('hazard', 2), uv = beam.attributes.uv, n = beam.attributes.normal, col = beam.attributes.color;
    const c = new THREE.Color(red);
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getZ(i)) > 0.5) uv.setXY(i, hz.u0 + (hz.u1 - hz.u0) * uv.getX(i), hz.v0 + (hz.v1 - hz.v0) * uv.getY(i));
      else { uv.setXY(i, white[0], white[1]); col.setXYZ(i, c.r, c.g, c.b); }
    }
  }
  parts.push(beam);
  // stop disc on the beam
  const disc = cyl(0.19, 0.19, 0.04, 20, { pos: [0, 0.92, zf - 0.16], rot: [PI / 2, 0, 0] });
  planarUV(disc, 'x', 'y', [-0.19, 0.19], [0.92 - 0.19, 0.92 + 0.19], A.uv('stop', 2));
  parts.push(disc);
  // stacked sleepers behind (track end)
  const wood = A.uv('wood', 2);
  for (let i = 0; i < 2; i++) parts.push(part(new THREE.BoxGeometry(2.0, 0.16, 0.26), { rect: wood, pos: [0, 0.08 + i * 0.16, -zf + 0.2 + i * 0.05] }));
  return merge(parts);
}

// ===================================================================================== PICKUPS
/** All pickup geometries, centered at the origin, ~1 m tall. Returns {type: geometry} + letters. */
export function buildPickups(KA) {
  const A = KA.atlas;
  const W = A.center('white'), GL = A.center('glow'), MT = A.center('metal');
  const out = {};
  // jetpack
  {
    const p = [];
    for (const sx of [-1, 1]) {
      p.push(cyl(0.15, 0.15, 0.62, 16, { uv: W, color: '#ff7a1a', pos: [sx * 0.19, 0.02, 0] }));
      p.push(sph(0.15, 16, 8, { uv: MT, color: '#e8ecf2', pos: [sx * 0.19, 0.33, 0], scl: [1, 0.7, 1] }));
      p.push(cyl(0.1, 0.14, 0.14, 12, { uv: W, color: '#3a3c44', pos: [sx * 0.19, -0.35, 0] }));
      p.push(cyl(0.02, 0.1, 0.2, 10, { uv: GL, color: '#ffb23a', pos: [sx * 0.19, -0.5, 0], rot: [PI, 0, 0] }));
      p.push(box(0.05, 0.5, 0.05, { uv: W, color: '#2a2b31', pos: [sx * 0.1, 0.05, 0.18] }));
    }
    p.push(box(0.26, 0.48, 0.22, { uv: W, color: '#4a4d57', pos: [0, 0.02, -0.06] }));
    p.push(box(0.5, 0.06, 0.24, { uv: MT, color: '#ffffff', pos: [0, 0.2, 0] }));
    p.push(box(0.5, 0.06, 0.24, { uv: MT, color: '#ffffff', pos: [0, -0.18, 0] }));
    out.jetpack = merge(p);
  }
  // sneakers (spring shoes)
  {
    const p = [];
    p.push(box(0.34, 0.09, 0.78, { uv: W, color: '#ffffff', pos: [0, 0.02, 0] }));
    p.push(box(0.3, 0.24, 0.5, { uv: W, color: '#39d353', pos: [0, 0.17, -0.1] }));
    p.push(sph(0.17, 16, 10, { uv: W, color: '#39d353', pos: [0, 0.1, 0.2], scl: [0.95, 0.72, 1.25] }));
    p.push(box(0.28, 0.2, 0.2, { uv: W, color: '#2fb246', pos: [0, 0.36, -0.28] }));
    for (let i = 0; i < 3; i++) p.push(box(0.26, 0.03, 0.04, { uv: W, color: '#ffffff', pos: [0, 0.3 - i * 0.02, -0.02 + i * 0.1], rot: [0.5, 0, 0] }));
    p.push(box(0.36, 0.05, 0.16, { uv: W, color: '#1b1238', pos: [0, 0.05, 0.1] }));
    for (let i = 0; i < 3; i++) p.push(tor(0.12, 0.03, 8, 18, PI * 2, { uv: MT, color: '#ffffff', pos: [0, -0.07 - i * 0.075, -0.05], rot: [PI / 2, 0, 0] }));
    p.push(cyl(0.16, 0.16, 0.04, 16, { uv: W, color: '#2a2b31', pos: [0, -0.3, -0.05] }));
    out.sneakers = xf(merge(p), [0, 0.1, 0], [0.25, 0.6, 0]);
  }
  // magnet
  {
    const p = [];
    p.push(tor(0.26, 0.11, 12, 24, PI, { uv: W, color: '#ff3b5c', pos: [0, 0.12, 0] }));
    for (const sx of [-1, 1]) {
      p.push(cyl(0.11, 0.11, 0.26, 16, { uv: W, color: '#ff3b5c', pos: [sx * 0.26, -0.01, 0] }));
      p.push(cyl(0.115, 0.115, 0.16, 16, { uv: MT, color: '#ffffff', pos: [sx * 0.26, -0.22, 0] }));
    }
    out.magnet = xf(merge(p), [0, 0.02, 0], [0, 0, 0], 1.25);
  }
  // 2X badge
  {
    const g = cyl(0.42, 0.42, 0.13, 32, { rot: [PI / 2, 0, 0] });
    const n = g.attributes.normal, pos = g.attributes.position, uv = g.attributes.uv, col = g.attributes.color;
    const rect = A.uv('x2', 2), gold = new THREE.Color('#ffb020');
    for (let i = 0; i < uv.count; i++) {
      if (Math.abs(n.getZ(i)) > 0.5) {
        const sx = n.getZ(i) > 0 ? 1 : -1;
        uv.setXY(i, rect.u0 + (rect.u1 - rect.u0) * (0.5 + sx * pos.getX(i) / 0.84), rect.v0 + (rect.v1 - rect.v0) * (0.5 + pos.getY(i) / 0.84));
      } else { uv.setXY(i, W[0], W[1]); col.setXYZ(i, gold.r, gold.g, gold.b); }
    }
    out.multiplier = merge([g, tor(0.42, 0.04, 8, 32, PI * 2, { uv: MT, color: '#ffe07a' })]);
  }
  // pogo stick
  {
    const p = [];
    p.push(cyl(0.045, 0.045, 1.0, 10, { uv: W, color: '#b86bff', pos: [0, 0.05, 0] }));
    p.push(cyl(0.035, 0.035, 0.62, 10, { uv: W, color: '#2a2b31', pos: [0, 0.55, 0], rot: [0, 0, PI / 2] }));
    for (const sx of [-1, 1]) p.push(cyl(0.05, 0.05, 0.16, 10, { uv: W, color: '#1b1238', pos: [sx * 0.26, 0.55, 0], rot: [0, 0, PI / 2] }));
    for (const sx of [-1, 1]) p.push(box(0.2, 0.05, 0.12, { uv: W, color: '#ffd23f', pos: [sx * 0.13, -0.18, 0] }));
    for (let i = 0; i < 4; i++) p.push(tor(0.08, 0.02, 6, 14, PI * 2, { uv: MT, color: '#ffffff', pos: [0, -0.27 - i * 0.05, 0], rot: [PI / 2, 0, 0] }));
    p.push(cyl(0.06, 0.08, 0.1, 10, { uv: W, color: '#1b1238', pos: [0, -0.5, 0] }));
    out.pogo = xf(merge(p), [0, 0, 0], [0, 0, 0.35], 1.05);
  }
  // mystery box
  {
    const g = new THREE.BoxGeometry(0.66, 0.66, 0.66);
    part(g, { rect: A.uv('q', 2) });
    const e = [];
    for (const a of [-1, 1]) for (const b of [-1, 1]) {
      e.push(box(0.7, 0.05, 0.05, { uv: W, color: '#ffd23f', pos: [0, a * 0.33, b * 0.33] }));
      e.push(box(0.05, 0.7, 0.05, { uv: W, color: '#ffd23f', pos: [a * 0.33, 0, b * 0.33] }));
      e.push(box(0.05, 0.05, 0.7, { uv: W, color: '#ffd23f', pos: [a * 0.33, b * 0.33, 0] }));
    }
    out.mysteryBox = merge([g, ...e]);
  }
  // key (glowing blue)
  {
    const p = [];
    p.push(tor(0.17, 0.055, 10, 24, PI * 2, { uv: GL, color: '#3ab7ff', pos: [0, 0.28, 0] }));
    p.push(cyl(0.05, 0.05, 0.62, 10, { uv: GL, color: '#3ab7ff', pos: [0, -0.18, 0] }));
    p.push(box(0.16, 0.07, 0.07, { uv: GL, color: '#3ab7ff', pos: [0.09, -0.38, 0] }));
    p.push(box(0.12, 0.07, 0.07, { uv: GL, color: '#3ab7ff', pos: [0.07, -0.24, 0] }));
    p.push(sph(0.07, 10, 8, { uv: W, color: '#e8f7ff', pos: [0, 0.28, 0] }));
    out.key = xf(merge(p), [0, 0.05, 0], [0, 0, 0], 1.2);
  }
  // token (star)
  {
    const shape = new THREE.Shape();
    for (let i = 0; i < 10; i++) {
      const a = -PI / 2 + (i * PI) / 5, r = i % 2 ? 0.2 : 0.45;
      const x = Math.cos(a) * r, y = -Math.sin(a) * r;
      if (i === 0) shape.moveTo(x, y); else shape.lineTo(x, y);
    }
    shape.closePath();
    const g = new THREE.ExtrudeGeometry(shape, { depth: 0.12, bevelEnabled: true, bevelThickness: 0.04, bevelSize: 0.035, bevelSegments: 2 });
    g.translate(0, 0, -0.06);
    part(g, { uv: GL, color: '#ff4fa3' });
    const inner = new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: false });
    inner.translate(0, 0, -0.1); inner.scale(0.55, 0.55, 1);
    part(inner, { uv: W, color: '#ffe45c' });
    out.token = merge([g, inner]);
  }
  // letter tiles (26)
  out.letters = {};
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i);
    const g = new THREE.BoxGeometry(0.66, 0.66, 0.14);
    norm(g);
    const rect = A.uv('L' + ch, 2), uv = g.attributes.uv, n = g.attributes.normal, col = g.attributes.color;
    const rim = new THREE.Color('#ffffff');
    for (let k = 0; k < uv.count; k++) {
      if (Math.abs(n.getZ(k)) > 0.5) uv.setXY(k, rect.u0 + (rect.u1 - rect.u0) * uv.getX(k), rect.v0 + (rect.v1 - rect.v0) * uv.getY(k));
      else { uv.setXY(k, W[0], W[1]); col.setXYZ(k, rim.r, rim.g, rim.b); }
    }
    out.letters[ch] = g;
  }
  return out;
}

// ===================================================================================== COIN
export function buildCoin(quality) {
  const seg = quality === 'low' ? 14 : 20;
  const r = 0.34, t = 0.05;
  const prof = [[0.0001, t * 0.7], [0.23, t * 0.7], [0.26, t], [0.31, t], [r, t * 0.55], [r, -t * 0.55], [0.31, -t], [0.26, -t], [0.23, -t * 0.7], [0.0001, -t * 0.7]]
    .map(([x, y]) => new THREE.Vector2(x, y));
  const g = new THREE.LatheGeometry(prof, seg);
  g.rotateX(PI / 2);            // faces toward +/-z
  norm(g);
  const pos = g.attributes.position, uv = g.attributes.uv;
  for (let i = 0; i < pos.count; i++) {
    const zf = pos.getZ(i) >= 0 ? 1 : -1;
    uv.setXY(i, 0.5 + zf * pos.getX(i) / (2 * r) * 0.98, 0.5 + pos.getY(i) / (2 * r) * 0.98);
  }
  g.deleteAttribute('color');
  return g;
}
