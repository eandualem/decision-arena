// WORLD: fast procedural geometry writer. Appends quads / boxes / cylinders / template meshes straight into
// growable typed arrays (no per-primitive allocation), then copies the result into a reusable BufferGeometry.
// Every face gets flat normals, atlas UVs (a rect {u0,v0,u1,v1}) and a linear-space vertex color (tint).
import * as THREE from 'three';

const _c = new THREE.Color();
const _linCache = new Map();
/** sRGB hex -> cached linear [r,g,b] (vertex colors must be linear). */
export function lin(hex) {
  let v = _linCache.get(hex);
  if (!v) { _c.setHex(hex); v = [_c.r, _c.g, _c.b]; _linCache.set(hex, v); }
  return v;
}
/** Multiply a linear color by k (returns a NEW small array; use at build time only). */
export const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
export const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

const WHITE = [1, 1, 1];
const FULL = { u0: 0, v0: 0, u1: 1, v1: 1 };

export class GeoBuilder {
  constructor(vcap = 8192, icap = 16384) {
    this._alloc(vcap, icap);
    this.reset();
  }
  _alloc(vcap, icap) {
    const old = this.pos ? { pos: this.pos, nor: this.nor, uv: this.uv, col: this.col, idx: this.idx } : null;
    this.vcap = vcap; this.icap = icap;
    this.pos = new Float32Array(vcap * 3); this.nor = new Float32Array(vcap * 3);
    this.uv = new Float32Array(vcap * 2); this.col = new Float32Array(vcap * 3);
    this.idx = new Uint32Array(icap);
    if (old) {
      this.pos.set(old.pos.subarray(0, this.nv * 3)); this.nor.set(old.nor.subarray(0, this.nv * 3));
      this.uv.set(old.uv.subarray(0, this.nv * 2)); this.col.set(old.col.subarray(0, this.nv * 3));
      this.idx.set(old.idx.subarray(0, this.ni));
    }
  }
  reset() {
    this.nv = 0; this.ni = 0;
    this.minX = this.minY = this.minZ = Infinity;
    this.maxX = this.maxY = this.maxZ = -Infinity;
    return this;
  }
  _ensure(nv, ni) {
    if (this.nv + nv <= this.vcap && this.ni + ni <= this.icap) return;
    let vc = this.vcap, ic = this.icap;
    while (this.nv + nv > vc) vc *= 2;
    while (this.ni + ni > ic) ic *= 2;
    this._alloc(vc, ic);
  }
  _v(x, y, z, nx, ny, nz, u, v, c) {
    const i = this.nv++;
    const p = i * 3, t = i * 2;
    this.pos[p] = x; this.pos[p + 1] = y; this.pos[p + 2] = z;
    this.nor[p] = nx; this.nor[p + 1] = ny; this.nor[p + 2] = nz;
    this.uv[t] = u; this.uv[t + 1] = v;
    this.col[p] = c[0]; this.col[p + 1] = c[1]; this.col[p + 2] = c[2];
    if (x < this.minX) this.minX = x; if (x > this.maxX) this.maxX = x;
    if (y < this.minY) this.minY = y; if (y > this.maxY) this.maxY = y;
    if (z < this.minZ) this.minZ = z; if (z > this.maxZ) this.maxZ = z;
    return i;
  }

  /**
   * Quad from corner o spanned by U (texture right) and V (texture up); normal = U x V.
   * rect: atlas uv rect (optionally partial via su0..su1 / sv0..sv1 fractions). cB/cT: colors of bottom/top edge.
   */
  quad(ox, oy, oz, ux, uy, uz, vx, vy, vz, rect = FULL, cB = WHITE, cT = cB, su0 = 0, su1 = 1, sv0 = 0, sv1 = 1) {
    this._ensure(4, 6);
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const du = rect.u1 - rect.u0, dv = rect.v1 - rect.v0;
    const U0 = rect.u0 + du * su0, U1 = rect.u0 + du * su1, V0 = rect.v0 + dv * sv0, V1 = rect.v0 + dv * sv1;
    const a = this._v(ox, oy, oz, nx, ny, nz, U0, V0, cB);
    this._v(ox + ux, oy + uy, oz + uz, nx, ny, nz, U1, V0, cB);
    this._v(ox + ux + vx, oy + uy + vy, oz + uz + vz, nx, ny, nz, U1, V1, cT);
    this._v(ox + vx, oy + vy, oz + vz, nx, ny, nz, U0, V1, cT);
    const I = this.idx, n = this.ni;
    I[n] = a; I[n + 1] = a + 1; I[n + 2] = a + 2; I[n + 3] = a; I[n + 4] = a + 2; I[n + 5] = a + 3;
    this.ni += 6;
  }

  /**
   * Quad split into pieces: along U every tileU meters (texture repeats per tile) and never longer than segU;
   * along V every tileV meters. dirU/dirV must be unit vectors. Colors interpolate from cB (bottom) to cT (top).
   */
  tiled(ox, oy, oz, dux, duy, duz, lenU, dvx, dvy, dvz, lenV, rect, tileU = 0, tileV = 0, cB = WHITE, cT = cB, segU = 2.5) {
    const tu = tileU > 0 ? tileU : lenU, tv = tileV > 0 ? tileV : lenV;
    let s = 0;
    while (s < lenU - 1e-4) {
      const tileStart = Math.floor(s / tu + 1e-6) * tu;
      let e = Math.min(tileStart + tu, lenU, s + segU);
      if (e - s < 1e-4) e = Math.min(lenU, s + segU);
      const su0 = (s - tileStart) / tu, su1 = (e - tileStart) / tu;
      let t = 0;
      while (t < lenV - 1e-4) {
        const vStart = Math.floor(t / tv + 1e-6) * tv;
        const f = Math.min(vStart + tv, lenV);
        const k0 = t / lenV, k1 = f / lenV;
        const c0 = cB === cT ? cB : mixc(cB, cT, k0), c1 = cB === cT ? cT : mixc(cB, cT, k1);
        this.quad(ox + dux * s + dvx * t, oy + duy * s + dvy * t, oz + duz * s + dvz * t,
          dux * (e - s), duy * (e - s), duz * (e - s), dvx * (f - t), dvy * (f - t), dvz * (f - t),
          rect, c0, c1, su0, su1, (t - vStart) / tv, (f - vStart) / tv);
        t = f;
      }
      s = e;
    }
  }

  /**
   * Axis-aligned box. faces: a rect for all faces, or {px,nx,py,ny,pz,nz} (rect | null to skip; missing = `all`).
   * opts: { tile: meters (texture repeat on sides, 0 = stretch), tileV, cT: top color for sides (vertical gradient),
   *         seg: max piece length (curve subdivision, default 2.5), topCol, skip: 'py,ny' }
   */
  box(cx, cy, cz, sx, sy, sz, faces, c = WHITE, o = EMPTY) {
    const all = faces && faces.u0 !== undefined ? faces : (faces?.all || FULL);
    const F = faces && faces.u0 === undefined ? faces : null;
    const pick = (k) => (F && k in F ? F[k] : all);
    const hx = sx / 2, hy = sy / 2, hz = sz / 2;
    const x0 = cx - hx, x1 = cx + hx, y0 = cy - hy, y1 = cy + hy, z0 = cz - hz, z1 = cz + hz;
    const cT = o.cT || c, tile = o.tile || 0, tileV = o.tileV || 0, seg = o.seg || 2.5;
    const skip = o.skip || '';
    let r;
    // +x face: U = -z, V = +y
    if ((r = pick('px')) && !skip.includes('px')) this.tiled(x1, y0, z1, 0, 0, -1, sz, 0, 1, 0, sy, r, tile, tileV, c, cT, seg);
    // -x face: U = +z
    if ((r = pick('nx')) && !skip.includes('nx')) this.tiled(x0, y0, z0, 0, 0, 1, sz, 0, 1, 0, sy, r, tile, tileV, c, cT, seg);
    // +z face: U = +x
    if ((r = pick('pz')) && !skip.includes('pz')) this.tiled(x0, y0, z1, 1, 0, 0, sx, 0, 1, 0, sy, r, tile, tileV, c, cT, 99);
    // -z face: U = -x
    if ((r = pick('nz')) && !skip.includes('nz')) this.tiled(x1, y0, z0, -1, 0, 0, sx, 0, 1, 0, sy, r, tile, tileV, c, cT, 99);
    const top = o.topCol || cT;
    // top: U = -z (texture u runs forward, split for the curve), V = -x  -> U x V = +y
    if ((r = pick('py')) && !skip.includes('py')) this.tiled(x1, y1, z1, 0, 0, -1, sz, -1, 0, 0, sx, r, o.tileTop || 0, o.tileTopV || 0, top, top, seg);
    // bottom: U = +z, V = -x -> U x V = -y
    if ((r = pick('ny')) && !skip.includes('ny')) this.tiled(x1, y0, z0, 0, 0, 1, sz, -1, 0, 0, sx, r, 0, 0, c, c, seg);
  }

  /** Vertical cylinder (open bottom). sides >= 3. rect maps around the circumference. */
  cyl(x, y0, z, r, h, sides, rect = FULL, c = WHITE, cT = c, capRect = null, r2 = r) {
    this._ensure(sides * 4 + sides + 2, sides * 6 + sides * 3);
    for (let i = 0; i < sides; i++) {
      const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
      const c0 = Math.cos(a0), s0 = Math.sin(a0), c1 = Math.cos(a1), s1 = Math.sin(a1);
      // outward winding: going from a1 to a0 when viewed from outside keeps CCW
      const bx0 = x + c1 * r, bz0 = z + s1 * r, bx1 = x + c0 * r, bz1 = z + s0 * r;
      const tx0 = x + c1 * r2, tz0 = z + s1 * r2, tx1 = x + c0 * r2, tz1 = z + s0 * r2;
      const am = (a0 + a1) / 2, nx = Math.cos(am), nz = Math.sin(am);
      const du = rect.u1 - rect.u0;
      const U0 = rect.u0 + du * (i / sides), U1 = rect.u0 + du * ((i + 1) / sides);
      const a = this._v(bx0, y0, bz0, nx, 0, nz, U0, rect.v0, c);
      this._v(bx1, y0, bz1, nx, 0, nz, U1, rect.v0, c);
      this._v(tx1, y0 + h, tz1, nx, 0, nz, U1, rect.v1, cT);
      this._v(tx0, y0 + h, tz0, nx, 0, nz, U0, rect.v1, cT);
      const I = this.idx, n = this.ni;
      I[n] = a; I[n + 1] = a + 1; I[n + 2] = a + 2; I[n + 3] = a; I[n + 4] = a + 2; I[n + 5] = a + 3;
      this.ni += 6;
    }
    if (capRect) {
      const cu = (capRect.u0 + capRect.u1) / 2, cv = (capRect.v0 + capRect.v1) / 2;
      const center = this._v(x, y0 + h, z, 0, 1, 0, cu, cv, cT);
      const first = this.nv;
      for (let i = 0; i < sides; i++) {
        const a = (i / sides) * Math.PI * 2;
        this._v(x + Math.cos(a) * r2, y0 + h, z + Math.sin(a) * r2, 0, 1, 0, cu + Math.cos(a) * (capRect.u1 - capRect.u0) / 2, cv + Math.sin(a) * (capRect.v1 - capRect.v0) / 2, cT);
      }
      for (let i = 0; i < sides; i++) {
        const I = this.idx, n = this.ni;
        I[n] = center; I[n + 1] = first + ((i + 1) % sides); I[n + 2] = first + i;
        this.ni += 3;
      }
    }
  }

  /** Horizontal cylinder along x or z axis ('x'|'z'), e.g. pipes, rails of fences. */
  hcyl(axis, x, y, z, r, len, sides, rect = FULL, c = WHITE, seg = 2.5) {
    const n = Math.max(1, Math.ceil(len / seg));
    for (let k = 0; k < n; k++) {
      const s0 = -len / 2 + (len * k) / n, s1 = -len / 2 + (len * (k + 1)) / n;
      for (let i = 0; i < sides; i++) {
        const a0 = (i / sides) * Math.PI * 2, a1 = ((i + 1) / sides) * Math.PI * 2;
        const am = (a0 + a1) / 2;
        const d0a = Math.cos(a0) * r, d0b = Math.sin(a0) * r, d1a = Math.cos(a1) * r, d1b = Math.sin(a1) * r;
        if (axis === 'z') {
          // circle in x-y plane, extrude along z. U along -z (from s1 to s0) so normal points outward
          const nx = Math.cos(am), ny = Math.sin(am);
          this._quadRaw(
            x + d0a, y + d0b, z + s1, x + d0a, y + d0b, z + s0, x + d1a, y + d1b, z + s0, x + d1a, y + d1b, z + s1,
            nx, ny, 0, rect, c);
        } else {
          const ny = Math.cos(am), nz = Math.sin(am);
          this._quadRaw(
            x + s0, y + d0a, z + d0b, x + s1, y + d0a, z + d0b, x + s1, y + d1a, z + d1b, x + s0, y + d1a, z + d1b,
            0, ny, nz, rect, c);
        }
      }
    }
  }
  _quadRaw(ax, ay, az, bx, by, bz, cx, cy, cz, dx, dy, dz, nx, ny, nz, rect, c) {
    this._ensure(4, 6);
    const a = this._v(ax, ay, az, nx, ny, nz, rect.u0, rect.v0, c);
    this._v(bx, by, bz, nx, ny, nz, rect.u1, rect.v0, c);
    this._v(cx, cy, cz, nx, ny, nz, rect.u1, rect.v1, c);
    this._v(dx, dy, dz, nx, ny, nz, rect.u0, rect.v1, c);
    // make sure winding agrees with the given normal
    const ex = bx - ax, ey = by - ay, ez = bz - az, fx = cx - ax, fy = cy - ay, fz = cz - az;
    const wx = ey * fz - ez * fy, wy = ez * fx - ex * fz, wz = ex * fy - ey * fx;
    const I = this.idx, n = this.ni;
    if (wx * nx + wy * ny + wz * nz >= 0) { I[n] = a; I[n + 1] = a + 1; I[n + 2] = a + 2; I[n + 3] = a; I[n + 4] = a + 2; I[n + 5] = a + 3; }
    else { I[n] = a; I[n + 1] = a + 2; I[n + 2] = a + 1; I[n + 3] = a; I[n + 4] = a + 3; I[n + 5] = a + 2; }
    this.ni += 6;
  }

  /** Triangle with explicit corners (winding decides the facing; normal computed). */
  tri(ax, ay, az, bx, by, bz, cx, cy, cz, rect = FULL, c = WHITE) {
    this._ensure(3, 3);
    const ex = bx - ax, ey = by - ay, ez = bz - az, fx = cx - ax, fy = cy - ay, fz = cz - az;
    let nx = ey * fz - ez * fy, ny = ez * fx - ex * fz, nz = ex * fy - ey * fx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    const a = this._v(ax, ay, az, nx, ny, nz, rect.u0, rect.v0, c);
    this._v(bx, by, bz, nx, ny, nz, rect.u1, rect.v0, c);
    this._v(cx, cy, cz, nx, ny, nz, (rect.u0 + rect.u1) / 2, rect.v1, c);
    const I = this.idx, n = this.ni;
    I[n] = a; I[n + 1] = a + 1; I[n + 2] = a + 2;
    this.ni += 3;
  }

  /**
   * Copy a template {pos, nor, uv?, idx} (flat arrays, local space) with scale (sx,sy,sz), rotation about Y (ry)
   * and translation. Color: c at local y <= 0, cT at local y >= 1 (template units), interpolated.
   */
  geo(t, x, y, z, sx, sy, sz, ry, rect = FULL, c = WHITE, cT = c) {
    const nv = t.pos.length / 3;
    this._ensure(nv, t.idx.length);
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const base = this.nv;
    const du = rect.u1 - rect.u0, dv = rect.v1 - rect.v0;
    const grad = c !== cT;
    const tmp = [0, 0, 0];
    for (let i = 0; i < nv; i++) {
      const lx = t.pos[i * 3] * sx, ly = t.pos[i * 3 + 1] * sy, lz = t.pos[i * 3 + 2] * sz;
      // normals: inverse-transpose of the scale then rotate
      let nx = t.nor[i * 3] / sx, ny = t.nor[i * 3 + 1] / sy, nz = t.nor[i * 3 + 2] / sz;
      const nl = Math.hypot(nx, ny, nz) || 1; nx /= nl; ny /= nl; nz /= nl;
      const wx = lx * cs + lz * sn, wz = -lx * sn + lz * cs;
      const mx = nx * cs + nz * sn, mz = -nx * sn + nz * cs;
      let col = c;
      if (grad) {
        const k = Math.min(1, Math.max(0, t.pos[i * 3 + 1]));
        tmp[0] = c[0] + (cT[0] - c[0]) * k; tmp[1] = c[1] + (cT[1] - c[1]) * k; tmp[2] = c[2] + (cT[2] - c[2]) * k;
        col = tmp;
      }
      const u = t.uv ? rect.u0 + du * t.uv[i * 2] : (rect.u0 + rect.u1) / 2;
      const v = t.uv ? rect.v0 + dv * t.uv[i * 2 + 1] : (rect.v0 + rect.v1) / 2;
      this._v(x + wx, y + ly, z + wz, mx, ny, mz, u, v, col);
    }
    const I = this.idx;
    for (let i = 0; i < t.idx.length; i++) I[this.ni + i] = base + t.idx[i];
    this.ni += t.idx.length;
  }

  /**
   * Copy the built data into `geometry` (reusing its attributes when big enough). Sets draw range and a bounding
   * sphere/box from the built bounds (padded by `pad`, the curved world moves vertices around).
   */
  toGeometry(geometry, pad = 4) {
    const nv = this.nv, ni = this.ni;
    let pos = geometry.getAttribute('position');
    if (!pos || pos.count < nv || !geometry.index || geometry.index.count < ni) {
      if (pos) geometry.dispose(); // frees the old GPU buffers; the geometry is re-uploaded on next render
      const vc = Math.max(nv, 64) * 1.25 | 0, ic = Math.max(ni, 96) * 1.25 | 0;
      geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
      geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
      geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(vc * 2), 2));
      geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
      geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(ic), 1));
      pos = geometry.getAttribute('position');
    }
    const put = (name, src, n) => {
      const a = geometry.getAttribute(name);
      a.array.set(src.subarray(0, n));
      a.clearUpdateRanges(); a.addUpdateRange(0, n); a.needsUpdate = true;
    };
    put('position', this.pos, nv * 3); put('normal', this.nor, nv * 3);
    put('uv', this.uv, nv * 2); put('color', this.col, nv * 3);
    const ix = geometry.index;
    ix.array.set(this.idx.subarray(0, ni)); ix.clearUpdateRanges(); ix.addUpdateRange(0, ni); ix.needsUpdate = true;
    geometry.setDrawRange(0, ni);
    if (nv === 0) {
      geometry.boundingBox = new THREE.Box3(new THREE.Vector3(), new THREE.Vector3());
      geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 0.001);
      return geometry;
    }
    const bb = geometry.boundingBox || (geometry.boundingBox = new THREE.Box3());
    bb.min.set(this.minX - pad, this.minY - pad, this.minZ - pad);
    bb.max.set(this.maxX + pad, this.maxY + pad, this.maxZ + pad);
    const bs = geometry.boundingSphere || (geometry.boundingSphere = new THREE.Sphere());
    bb.getBoundingSphere(bs);
    return geometry;
  }
}
const EMPTY = {};

/** Flat-shaded template from a THREE geometry (non-indexed -> per-face normals), positions in local units. */
export function makeTemplate(geometry, { jitter = 0, seed = 1, yMin = null } = {}) {
  let g = geometry.index ? geometry.toNonIndexed() : geometry;
  const p = g.getAttribute('position');
  if (jitter > 0) {
    // jitter shared corners consistently (hash of the rounded position)
    const h = (x, y, z) => {
      let s = Math.imul(Math.round(x * 1000) + 7919 * seed, 73856093) ^ Math.imul(Math.round(y * 1000), 19349663) ^ Math.imul(Math.round(z * 1000), 83492791);
      s = Math.imul(s ^ (s >>> 13), 0x5bd1e995); s ^= s >>> 15;
      return ((s >>> 0) / 4294967296) - 0.5;
    };
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
      p.setXYZ(i, x + h(x, y, z) * jitter, y + h(y, z, x) * jitter, z + h(z, x, y) * jitter);
    }
  }
  if (yMin !== null) for (let i = 0; i < p.count; i++) if (p.getY(i) < yMin) p.setY(i, yMin);
  g.computeVertexNormals();
  const uv = g.getAttribute('uv');
  const idx = new Uint32Array(p.count);
  for (let i = 0; i < p.count; i++) idx[i] = i;
  return { pos: Float32Array.from(p.array), nor: Float32Array.from(g.getAttribute('normal').array), uv: uv ? Float32Array.from(uv.array) : null, idx };
}
