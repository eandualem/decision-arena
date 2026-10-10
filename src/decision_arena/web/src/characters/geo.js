// Geometry assembly for the characters module.
// Characters are rigidly skinned: every primitive is transformed into model space (rest pose),
// tagged with one bone index and a color, and merged into ONE BufferGeometry per material slot.
// A whole character therefore renders in a handful of draw calls (one per slot) with a shared skeleton.
import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const _m = new THREE.Matrix4();
const _nm = new THREE.Matrix3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _p = new THREE.Vector3();
const _s = new THREE.Vector3();
const _v = new THREE.Vector3();
const _n = new THREE.Vector3();
const _c = new THREE.Color();

// ------------------------------------------------------------------ primitive cache (source geometry only)
const SRC = new Map();
function memo(key, make) {
  let g = SRC.get(key);
  if (!g) SRC.set(key, (g = make()));
  return g;
}
/** Drop cached source primitives (they are never uploaded to the GPU; only used as merge input). */
export function clearPrimitiveCache() { for (const g of SRC.values()) g.dispose(); SRC.clear(); }

const r3 = (n) => Math.round(n * 1000) / 1000;

export const Prim = {
  /** unit sphere (scale it to get ellipsoids) */
  sphere: (ws = 16, hs = 12) => memo(`sph${ws}.${hs}`, () => new THREE.SphereGeometry(1, ws, hs)),
  /** unit sphere cap: theta from 0 to thetaLen (top cap when thetaLen < PI) */
  cap: (thetaLen, ws = 16, hs = 8, thetaStart = 0) => memo(`cap${r3(thetaLen)}.${ws}.${hs}.${r3(thetaStart)}`,
    () => new THREE.SphereGeometry(1, ws, hs, 0, Math.PI * 2, thetaStart, thetaLen)),
  /** partial sphere patch (phi, theta ranges) */
  patch: (phiStart, phiLen, thetaStart, thetaLen, ws = 16, hs = 12) =>
    memo(`pat${r3(phiStart)}.${r3(phiLen)}.${r3(thetaStart)}.${r3(thetaLen)}.${ws}.${hs}`,
      () => new THREE.SphereGeometry(1, ws, hs, phiStart, phiLen, thetaStart, thetaLen)),
  capsule: (r, len, cap = 4, rad = 10) => memo(`cps${r3(r)}.${r3(len)}.${cap}.${rad}`, () => new THREE.CapsuleGeometry(r, len, cap, rad)),
  cylinder: (rt, rb, h, seg = 12, open = false, hseg = 1) =>
    memo(`cyl${r3(rt)}.${r3(rb)}.${r3(h)}.${seg}.${open}.${hseg}`, () => new THREE.CylinderGeometry(rt, rb, h, seg, hseg, open)),
  cone: (r, h, seg = 10) => memo(`con${r3(r)}.${r3(h)}.${seg}`, () => new THREE.ConeGeometry(r, h, seg, 1)),
  rbox: (w, h, d, r, seg = 2) => memo(`rbx${r3(w)}.${r3(h)}.${r3(d)}.${r3(r)}.${seg}`, () => new RoundedBoxGeometry(w, h, d, seg, r)),
  box: (w, h, d) => memo(`box${r3(w)}.${r3(h)}.${r3(d)}`, () => new THREE.BoxGeometry(w, h, d)),
  torus: (R, r, rs = 6, ts = 16, arc = Math.PI * 2) => memo(`tor${r3(R)}.${r3(r)}.${rs}.${ts}.${r3(arc)}`, () => new THREE.TorusGeometry(R, r, rs, ts, arc)),
  circle: (r, seg = 16) => memo(`cir${r3(r)}.${seg}`, () => new THREE.CircleGeometry(r, seg)),
  plane: (w, h) => memo(`pln${r3(w)}.${r3(h)}`, () => new THREE.PlaneGeometry(w, h)),
  /** sneaker sole: rounded outline (plan view) extruded upward, toe at -Z. Origin at the bottom center. */
  sole: (L, W, H, toeR = 0.5, heelR = 0.42) => memo(`sole${r3(L)}.${r3(W)}.${r3(H)}.${r3(toeR)}.${r3(heelR)}`, () => {
    const sh = new THREE.Shape();
    const hw = W / 2, hl = L / 2;
    const rt = Math.min(hw, W * toeR), rh = Math.min(hw, W * heelR);
    // shape in (x, y) where y = -z (toe at +y)
    sh.moveTo(-hw, -hl + rh);
    sh.lineTo(-hw, hl - rt);
    sh.quadraticCurveTo(-hw, hl, -hw + rt, hl);
    sh.lineTo(hw - rt, hl);
    sh.quadraticCurveTo(hw, hl, hw, hl - rt);
    sh.lineTo(hw, -hl + rh);
    sh.quadraticCurveTo(hw, -hl, hw - rh, -hl);
    sh.lineTo(-hw + rh, -hl);
    sh.quadraticCurveTo(-hw, -hl, -hw, -hl + rh);
    const bev = Math.min(0.012, H * 0.3);
    const g = new THREE.ExtrudeGeometry(sh, { depth: H - bev * 2, bevelEnabled: true, bevelThickness: bev, bevelSize: bev * 0.8, bevelSegments: 1, curveSegments: 4 });
    g.translate(0, 0, bev);
    g.rotateX(-Math.PI / 2); // extrusion (z) -> +y, shape y -> -z
    g.computeVertexNormals();
    return g;
  }),
};

/**
 * Lathe with analytic smooth normals and optional y-based v coordinates (so split pieces share one UV space).
 * profile: [[r, y], ...] bottom -> top. Revolved around +Y: x = sin(phi) r, z = cos(phi) r (like THREE.LatheGeometry).
 * phiStart = -PI puts u = 0.5 at the back (+Z) and the seam (u = 0/1) at the front (-Z).
 */
export function lathe(profile, segments = 16, o = {}) {
  const phiStart = o.phiStart ?? -Math.PI;
  const phiLen = o.phiLength ?? Math.PI * 2;
  const [vy0, vy1] = o.vRange || [profile[0][1], profile[profile.length - 1][1]];
  const n = profile.length;
  const pos = [], nor = [], uv = [], idx = [];
  // profile normals (2D) by central differences
  const pn = profile.map((p, i) => {
    const a = profile[Math.max(0, i - 1)], b = profile[Math.min(n - 1, i + 1)];
    const dr = b[0] - a[0], dy = b[1] - a[1];
    let nx = dy, ny = -dr;
    const l = Math.hypot(nx, ny) || 1;
    nx /= l; ny /= l;
    if (p[0] < 1e-4) { nx = 0; ny = i === 0 ? -1 : 1; }
    return [nx, ny];
  });
  for (let i = 0; i <= segments; i++) {
    const u = i / segments;
    const phi = phiStart + u * phiLen;
    const sp = Math.sin(phi), cp = Math.cos(phi);
    for (let j = 0; j < n; j++) {
      const [r, y] = profile[j];
      pos.push(sp * r, y, cp * r);
      nor.push(sp * pn[j][0], pn[j][1], cp * pn[j][0]);
      uv.push(u, (y - vy0) / (vy1 - vy0 || 1));
    }
  }
  for (let i = 0; i < segments; i++) {
    for (let j = 0; j < n - 1; j++) {
      const a = i * n + j, b = (i + 1) * n + j, c = (i + 1) * n + j + 1, d = i * n + j + 1;
      idx.push(a, b, d, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  return g;
}

/** Tube along a list of points (Catmull-Rom), radius may be a number or fn(t) */
export function tube(points, radius = 0.02, tubular = 12, radial = 6, closed = false) {
  const curve = new THREE.CatmullRomCurve3(points.map((p) => (p.isVector3 ? p : new THREE.Vector3(p[0], p[1], p[2]))), closed);
  const g = new THREE.TubeGeometry(curve, tubular, typeof radius === 'number' ? radius : 1, radial, closed);
  if (typeof radius === 'function') {
    // re-shape: scale each ring around the curve point
    const pos = g.attributes.position;
    for (let i = 0; i <= tubular; i++) {
      const t = i / tubular;
      const c = curve.getPointAt(t);
      const r = radius(t);
      for (let j = 0; j <= radial; j++) {
        const k = i * (radial + 1) + j;
        _v.fromBufferAttribute(pos, k).sub(c).multiplyScalar(r).add(c);
        pos.setXYZ(k, _v.x, _v.y, _v.z);
      }
    }
  }
  return g;
}

/** Custom extrusion of a 2D outline (x,y) along z with smooth-ish side normals; used for decals and plates. */
export function plate(outline, depth, o = {}) {
  const shape = new THREE.Shape(outline.map(([x, y]) => new THREE.Vector2(x, y)));
  const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: !!o.bevel, bevelThickness: o.bevel || 0, bevelSize: o.bevel || 0, bevelSegments: 2, curveSegments: o.curveSegments || 6 });
  g.translate(0, 0, -depth / 2);
  return g;
}

// ------------------------------------------------------------------ builder

function composeMatrix(o, out) {
  const pos = o.pos || [0, 0, 0];
  _p.set(pos[0], pos[1], pos[2]);
  if (o.quat) _q.copy(o.quat);
  else if (o.rot) { _e.set(o.rot[0] || 0, o.rot[1] || 0, o.rot[2] || 0, o.order || 'XYZ'); _q.setFromEuler(_e); }
  else _q.identity();
  const s = o.scale ?? 1;
  if (typeof s === 'number') _s.set(s, s, s); else _s.set(s[0], s[1], s[2]);
  out.compose(_p, _q, _s);
  if (o.pre) out.multiply(o.pre);      // pre-transform (applied first, in local space)
  if (o.post) out.premultiply(o.post); // post-transform (applied last, e.g. mirror)
  return out;
}

export const MIRROR_X = new THREE.Matrix4().makeScale(-1, 1, 1);

/**
 * Builder collects primitives. item options:
 *   bone (int), slot ('body'|'print'|'shiny'|'glow'|'glass'|...), pos [x,y,z], rot [x,y,z] (+order), quat, scale n|[x,y,z],
 *   color: hex | (x,y,z,nx,ny,nz) => hex (evaluated in model space), uv: [u0,v0,u1,v1] region remap (default: keep),
 *   post: Matrix4 (applied after the transform, e.g. MIRROR_X)
 */
export class Builder {
  constructor(opts = {}) {
    this.items = [];
    this.skinned = opts.skinned !== false;
    this.defaults = {};
  }
  /** A named child builder (built separately, e.g. detachable accessories that can be hidden at runtime). */
  sub(name) {
    this.subs = this.subs || {};
    return this.subs[name] || (this.subs[name] = new Builder({ skinned: this.skinned }));
  }
  /** set default option values (e.g. bone) for subsequent add() calls; returns previous defaults */
  with(defaults, fn) {
    const prev = this.defaults;
    this.defaults = Object.assign({}, prev, defaults);
    try { fn(this); } finally { this.defaults = prev; }
    return this;
  }
  add(geo, o = {}) {
    const opt = Object.assign({}, this.defaults, o);
    if (opt.mirror) opt.post = opt.post ? MIRROR_X.clone().multiply(opt.post) : MIRROR_X;
    const matrix = composeMatrix(opt, new THREE.Matrix4());
    if (opt.parent) matrix.premultiply(opt.parent);
    this.items.push({ geo, matrix, bone: opt.bone ?? 0, slot: opt.slot || 'body', color: opt.color ?? 0xffffff, uv: opt.uv || null });
    return this;
  }
  // -- shape helpers (all dimensions in meters)
  ellipsoid(pos, radii, color, o = {}) {
    const r = typeof radii === 'number' ? [radii, radii, radii] : radii;
    return this.add(Prim.sphere(o.ws || 16, o.hs || 12), Object.assign({ pos, scale: r, color }, o));
  }
  ball(pos, r, color, o = {}) { return this.ellipsoid(pos, r, color, Object.assign({ ws: 12, hs: 9 }, o)); }
  capsuleBetween(a, b, r, color, o = {}) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const d = new THREE.Vector3().subVectors(vb, va);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const mid = va.add(vb).multiplyScalar(0.5);
    return this.add(Prim.capsule(r, Math.max(0.001, len), o.cap || 4, o.rad || 10), Object.assign({ pos: mid.toArray(), quat: q, color }, o));
  }
  cylinderBetween(a, b, rt, rb, color, o = {}) {
    const va = new THREE.Vector3(...a), vb = new THREE.Vector3(...b);
    const d = new THREE.Vector3().subVectors(vb, va);
    const len = d.length();
    const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize());
    const mid = va.add(vb).multiplyScalar(0.5);
    return this.add(Prim.cylinder(rt, rb, len, o.seg || 12, o.open || false), Object.assign({ pos: mid.toArray(), quat: q, color }, o));
  }
  rbox(pos, size, radius, color, o = {}) {
    return this.add(Prim.rbox(size[0], size[1], size[2], radius, o.seg || 2), Object.assign({ pos, color }, o));
  }

  /** Merge everything into one BufferGeometry per slot. Returns { slots: {name: geometry}, tris, verts }.
   *  boneMap resolves string bone names (extra bones) to skeleton indices. */
  build(boneMap = null) {
    const bySlot = new Map();
    for (const it of this.items) {
      if (typeof it.bone === 'string') {
        const b = boneMap && boneMap[it.bone];
        if (b == null) throw new Error('Builder: unknown bone ' + it.bone);
        it.bone = b;
      }
      if (!bySlot.has(it.slot)) bySlot.set(it.slot, []);
      bySlot.get(it.slot).push(it);
    }
    const slots = {};
    let tris = 0, verts = 0;
    for (const [slot, items] of bySlot) {
      const g = mergeItems(items, this.skinned);
      slots[slot] = g;
      tris += g.index.count / 3;
      verts += g.attributes.position.count;
    }
    return { slots, tris, verts };
  }
}

function mergeItems(items, skinned) {
  let nv = 0, ni = 0;
  for (const it of items) {
    nv += it.geo.attributes.position.count;
    ni += it.geo.index ? it.geo.index.count : it.geo.attributes.position.count;
  }
  const pos = new Float32Array(nv * 3), nor = new Float32Array(nv * 3), uvs = new Float32Array(nv * 2), col = new Float32Array(nv * 3);
  const sIdx = skinned ? new Uint16Array(nv * 4) : null;
  const sW = skinned ? new Float32Array(nv * 4) : null;
  const index = nv > 65535 ? new Uint32Array(ni) : new Uint16Array(ni);
  let vo = 0, io = 0;
  for (const it of items) {
    const g = it.geo;
    const P = g.attributes.position, N = g.attributes.normal, U = g.attributes.uv;
    const m = it.matrix;
    _nm.getNormalMatrix(m);
    const flip = m.determinant() < 0;
    const colorFn = typeof it.color === 'function' ? it.color : null;
    if (!colorFn) _c.setHex(it.color);
    const cr = _c.r, cg = _c.g, cb = _c.b;
    const count = P.count;
    for (let i = 0; i < count; i++) {
      _v.fromBufferAttribute(P, i).applyMatrix4(m);
      const k = (vo + i) * 3;
      pos[k] = _v.x; pos[k + 1] = _v.y; pos[k + 2] = _v.z;
      if (N) _n.fromBufferAttribute(N, i).applyMatrix3(_nm).normalize(); else _n.set(0, 1, 0);
      nor[k] = _n.x; nor[k + 1] = _n.y; nor[k + 2] = _n.z;
      if (colorFn) {
        _c.setHex(colorFn(_v.x, _v.y, _v.z, _n.x, _n.y, _n.z));
        col[k] = _c.r; col[k + 1] = _c.g; col[k + 2] = _c.b;
      } else { col[k] = cr; col[k + 1] = cg; col[k + 2] = cb; }
      const ku = (vo + i) * 2;
      let u = U ? U.getX(i) : 0, v = U ? U.getY(i) : 0;
      if (it.uv) { const r = it.uv; u = r[0] + u * (r[2] - r[0]); v = r[1] + v * (r[3] - r[1]); }
      uvs[ku] = u; uvs[ku + 1] = v;
      if (skinned) { const ks = (vo + i) * 4; sIdx[ks] = it.bone; sW[ks] = 1; }
    }
    if (g.index) {
      const I = g.index.array;
      for (let t = 0; t < I.length; t += 3) {
        index[io++] = I[t] + vo;
        if (flip) { index[io++] = I[t + 2] + vo; index[io++] = I[t + 1] + vo; } else { index[io++] = I[t + 1] + vo; index[io++] = I[t + 2] + vo; }
      }
    } else {
      for (let t = 0; t < count; t += 3) {
        index[io++] = t + vo;
        if (flip) { index[io++] = t + 2 + vo; index[io++] = t + 1 + vo; } else { index[io++] = t + 1 + vo; index[io++] = t + 2 + vo; }
      }
    }
    vo += count;
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uvs, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (skinned) {
    out.setAttribute('skinIndex', new THREE.BufferAttribute(sIdx, 4));
    out.setAttribute('skinWeight', new THREE.BufferAttribute(sW, 4));
  }
  out.setIndex(new THREE.BufferAttribute(index, 1));
  out.computeBoundingSphere();
  out.computeBoundingBox();
  return out;
}

/** Vertical gradient color function helper: returns fn(x,y,z) lerping between hex a (at y0) and b (at y1). */
export function gradientY(a, b, y0, y1) {
  const ca = new THREE.Color(a), cb = new THREE.Color(b), t = new THREE.Color();
  return (x, y) => t.copy(ca).lerp(cb, Math.min(1, Math.max(0, (y - y0) / (y1 - y0)))).getHex();
}
/** Stripe color function: color `b` where |f(x,y,z)| band matches, else `a`. */
export function bands(a, b, axis, ranges) {
  return (x, y, z) => {
    const v = axis === 'x' ? x : axis === 'y' ? y : z;
    for (const [lo, hi] of ranges) if (v >= lo && v <= hi) return b;
    return a;
  };
}
