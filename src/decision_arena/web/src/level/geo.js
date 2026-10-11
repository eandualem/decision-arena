// Geometry helpers: every part ends up with the same attribute set (position, normal, uv, color) and an index,
// so parts can be merged freely and dropped into BatchedMeshes.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
const _c = new THREE.Color();

/** Normalize a geometry: indexed, has uv + color (white), no groups. */
export function norm(geo) {
  if (!geo.index) {
    const n = geo.attributes.position.count;
    const idx = new (n > 65535 ? Uint32Array : Uint16Array)(n);
    for (let i = 0; i < n; i++) idx[i] = i;
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
  }
  if (!geo.attributes.normal) geo.computeVertexNormals();
  if (!geo.attributes.uv) geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(geo.attributes.position.count * 2), 2));
  if (!geo.attributes.color) {
    const a = new Float32Array(geo.attributes.position.count * 3).fill(1);
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
  }
  for (const k of Object.keys(geo.attributes)) if (!['position', 'normal', 'uv', 'color'].includes(k)) geo.deleteAttribute(k);
  geo.clearGroups();
  return geo;
}

/** Set vertex color (sRGB hex) on all vertices. */
export function tint(geo, hex) {
  norm(geo);
  _c.set(hex);
  const a = geo.attributes.color;
  for (let i = 0; i < a.count; i++) a.setXYZ(i, _c.r, _c.g, _c.b);
  return geo;
}

/** Transform: position [x,y,z], rotation [rx,ry,rz] (radians, XYZ), scale [sx,sy,sz] or number. */
export function xf(geo, pos = [0, 0, 0], rot = [0, 0, 0], scl = 1) {
  _e.set(rot[0], rot[1], rot[2]);
  _q.setFromEuler(_e);
  if (typeof scl === 'number') _s.set(scl, scl, scl); else _s.set(scl[0], scl[1], scl[2]);
  _p.set(pos[0], pos[1], pos[2]);
  _m.compose(_p, _q, _s);
  geo.applyMatrix4(_m);
  return geo;
}

/**
 * Make a part: geometry + options {color, uv:[u,v] (flat) | rect:{u0,u1,v0,v1} (remap 0..1 uvs),
 * pos, rot, scl}.
 */
export function part(geo, o = {}) {
  norm(geo);
  if (o.color != null) tint(geo, o.color);
  const uv = geo.attributes.uv;
  if (o.uv) { for (let i = 0; i < uv.count; i++) uv.setXY(i, o.uv[0], o.uv[1]); }
  else if (o.rect) {
    const r = o.rect;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, r.u0 + (r.u1 - r.u0) * uv.getX(i), r.v0 + (r.v1 - r.v0) * uv.getY(i));
  }
  if (o.pos || o.rot || o.scl) xf(geo, o.pos, o.rot, o.scl ?? 1);
  return geo;
}

export const box = (w, h, d, o) => part(new THREE.BoxGeometry(w, h, d, 1, 1, Math.max(1, Math.ceil(d / 2.2))), o);
export const cyl = (rt, rb, h, seg, o, open = false) => part(new THREE.CylinderGeometry(rt, rb, h, seg, 1, open), o);
export const sph = (r, ws, hs, o) => part(new THREE.SphereGeometry(r, ws, hs), o);
export const tor = (r, t, rs, ts, arc, o) => part(new THREE.TorusGeometry(r, t, rs, ts, arc), o);

/** Merge normalized parts into one geometry. */
export function merge(parts) {
  const list = parts.filter(Boolean).map(norm);
  const g = mergeGeometries(list, false);
  if (!g) throw new Error('merge failed');
  return g;
}

/** Planar uv projection (in place): project on axes a,b ('x','y','z') with ranges -> rect. */
export function planarUV(geo, a, b, [a0, a1], [b0, b1], rect) {
  const pos = geo.attributes.position, uv = geo.attributes.uv;
  const ga = a === 'x' ? 'getX' : a === 'y' ? 'getY' : 'getZ';
  const gb = b === 'x' ? 'getX' : b === 'y' ? 'getY' : 'getZ';
  for (let i = 0; i < pos.count; i++) {
    const u = (pos[ga](i) - a0) / (a1 - a0), v = (pos[gb](i) - b0) / (b1 - b0);
    uv.setXY(i, rect.u0 + (rect.u1 - rect.u0) * u, rect.v0 + (rect.v1 - rect.v0) * v);
  }
  return geo;
}

/**
 * Build an indexed quad-strip mesh from a 2D grid of vertices: rows[i][j] = {p:[x,y,z], uv:[u,v]}.
 * Normals are computed from the grid (smooth). `flip` reverses the winding.
 */
export function gridMesh(rows, flip = false) {
  const R = rows.length, C = rows[0].length;
  const pos = new Float32Array(R * C * 3), uv = new Float32Array(R * C * 2);
  let k = 0;
  for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
    const v = rows[i][j];
    pos.set(v.p, k * 3); uv.set(v.uv, k * 2); k++;
  }
  const idx = [];
  for (let i = 0; i < R - 1; i++) for (let j = 0; j < C - 1; j++) {
    const a = i * C + j, b = i * C + j + 1, c = (i + 1) * C + j, d = (i + 1) * C + j + 1;
    if (!flip) idx.push(a, c, b, b, c, d); else idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return norm(g);
}

/** Flat polygon (fan) in the XY plane at z, facing +z (or -z with flip), from an ordered outline [[x,y],...]. */
export function fanPolygon(outline, z, center, flip = false) {
  const n = outline.length;
  const pos = new Float32Array((n + 1) * 3);
  pos.set([center[0], center[1], z], 0);
  outline.forEach(([x, y], i) => pos.set([x, y, z], (i + 1) * 3));
  const idx = [];
  for (let i = 0; i < n; i++) {
    const a = 0, b = 1 + i, c = 1 + ((i + 1) % n);
    if (!flip) idx.push(a, b, c); else idx.push(a, c, b);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return norm(g);
}

/** Box whose 6 faces all map the full 0..1 uv (THREE default) - handy for textured panels. */
export function panel(w, h, d, frontRect, sideUV) {
  const g = new THREE.BoxGeometry(w, h, d);
  norm(g);
  const uv = g.attributes.uv;
  // BoxGeometry face order: +x, -x, +y, -y, +z, -z ; 4 verts each
  for (let f = 0; f < 6; f++) for (let v = 0; v < 4; v++) {
    const i = f * 4 + v;
    if ((f === 4 || f === 5) && frontRect) {
      const r = typeof frontRect === 'function' ? frontRect(f) : frontRect;
      uv.setXY(i, r.u0 + (r.u1 - r.u0) * uv.getX(i), r.v0 + (r.v1 - r.v0) * uv.getY(i));
    } else uv.setXY(i, sideUV[0], sideUV[1]);
  }
  return g;
}
