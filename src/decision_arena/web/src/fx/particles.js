// Pooled particle system (AUDIOFX): CPU-simulated, drawn as ONE instanced quad mesh.
// Premultiplied blending lets additive (glow) and alpha (smoke/dust) particles share the draw call:
// each particle has an `add` factor (1 = additive, 0 = normal alpha).
// Render modes per particle: BILL (camera-facing, rotated), STRETCH (along velocity), FLAT (ground plane), FLIP (confetti).
// The vertex shader applies the curved-world bend (same formula as core/curve.js) unless NO_CURVE is defined.
import * as THREE from 'three';
import { curveUniform } from '../core/curve.js';

export const MODE = { BILL: 0, STRETCH: 1, FLAT: 2, FLIP: 3 };
const STRIDE = 14; // iPos(3) iVel(3) iColor(4) iData(4: size, rot|stretch, frame + 16*mode, additive)

const VERT = /* glsl */`
#define USE_CURVE
uniform vec3 uCurve;
attribute vec3 iPos;
attribute vec3 iVel;
attribute vec4 iColor;
attribute vec4 iData;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
void main() {
  float size = iData.x;
  float rot = iData.y;
  float mode = floor(iData.z / 16.0 + 0.001);
  float cell = iData.z - mode * 16.0;
  vec2 c = position.xy;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
#ifndef NO_CURVE
  float cd = max(0.0, -mv.z - uCurve.z);
  mv.x += uCurve.x * cd * cd;
  mv.y -= uCurve.y * cd * cd;
#endif
  if (mode < 0.5) {
    float cs = cos(rot), sn = sin(rot);
    mv.xy += vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
  } else if (mode < 1.5) {
    vec3 vv = (modelViewMatrix * vec4(iVel, 0.0)).xyz;
    float sp = length(vv);
    vec3 dir = sp > 1e-4 ? vv / sp : vec3(0.0, 1.0, 0.0);
    vec3 toCam = normalize(-mv.xyz);
    vec3 side = cross(dir, toCam);
    float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(1.0, 0.0, 0.0);
    float len = size * (1.0 + rot * sp);
    mv.xyz += dir * (c.y * len) + side * (c.x * size);
  } else if (mode < 2.5) {
    float cs = cos(rot), sn = sin(rot);
    vec2 r = vec2(c.x * cs - c.y * sn, c.x * sn + c.y * cs) * size;
    mv.xyz += (modelViewMatrix * vec4(r.x, 0.0, -r.y, 0.0)).xyz; // -z keeps CCW winding seen from above
  } else {
    float cs = cos(rot), sn = sin(rot);
    vec2 q = vec2(c.x * (0.15 + 0.85 * abs(cos(rot * 1.7))), c.y);
    mv.xy += vec2(q.x * cs - q.y * sn, q.x * sn + q.y * cs) * size;
  }
  gl_Position = projectionMatrix * mv;
  float cx = mod(cell, 4.0);
  float cy = floor(cell / 4.0);
  vUv = vec2((cx + c.x + 0.5) * 0.25, 1.0 - (cy + 0.5 - c.y) * 0.25);
  vColor = iColor;
  vAdd = iData.w;
}`;

const FRAG = /* glsl */`
uniform sampler2D map;
varying vec2 vUv;
varying vec4 vColor;
varying float vAdd;
void main() {
  vec4 tex = texture2D(map, vUv);
  float a = vColor.a * tex.a;
  if (a < 0.004) discard;
  gl_FragColor = vec4(vColor.rgb * tex.rgb, a);
  #include <colorspace_fragment>
  gl_FragColor.rgb *= gl_FragColor.a;
  gl_FragColor.a *= (1.0 - vAdd);
}`;

export class ParticleSystem {
  /**
   * @param {{capacity:number, texture:THREE.Texture, parent:THREE.Object3D, curved?:boolean, depthTest?:boolean, renderOrder?:number, name?:string}} o
   */
  constructor(o) {
    const cap = (this.cap = o.capacity);
    this.n = 0;
    const F = (k = 1) => new Float32Array(cap * k);
    this.p = F(3); this.v = F(3);
    this.age = F(); this.life = F();
    this.s0 = F(); this.s1 = F();
    this.c0 = F(3); this.c1 = F(3);
    this.a0 = F(); this.fin = F(); this.fpow = F();
    this.rot = F(); this.spin = F(); this.stretch = F();
    this.frame = F(); this.mode = F(); this.add = F();
    this.drag = F(); this.grav = F(); this.follow = F();
    this.orb = F(4); // radius, angle, angular velocity, vertical bob
    this.oc = F(3);  // orbit centre
    this.buf = new Float32Array(cap * STRIDE);
    const ib = (this.ib = new THREE.InstancedInterleavedBuffer(this.buf, STRIDE, 1));
    ib.setUsage(THREE.DynamicDrawUsage);
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.setAttribute('position', new THREE.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    geo.setAttribute('iPos', new THREE.InterleavedBufferAttribute(ib, 3, 0));
    geo.setAttribute('iVel', new THREE.InterleavedBufferAttribute(ib, 3, 3));
    geo.setAttribute('iColor', new THREE.InterleavedBufferAttribute(ib, 4, 6));
    geo.setAttribute('iData', new THREE.InterleavedBufferAttribute(ib, 4, 10));
    geo.instanceCount = 0;
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      name: o.name || 'fx-particles',
      uniforms: { map: { value: o.texture }, uCurve: curveUniform },
      vertexShader: VERT.trim(), // must start with '#define USE_CURVE' so core/curve.js does not inject uCurve twice
      fragmentShader: FRAG,
      defines: o.curved === false ? { NO_CURVE: '' } : {},
      transparent: true,
      depthWrite: false,
      depthTest: o.depthTest !== false,
      toneMapped: false,
      blending: THREE.CustomBlending,
      blendEquation: THREE.AddEquation,
      blendSrc: THREE.OneFactor,
      blendDst: THREE.OneMinusSrcAlphaFactor,
      blendSrcAlpha: THREE.OneFactor,
      blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = o.name || 'fx-particles';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = o.renderOrder ?? 20;
    this.mesh.visible = false;
    this.mesh.matrixAutoUpdate = false;
    o.parent.add(this.mesh);
  }

  get count() { return this.n; }

  /** Allocate a particle with defaults; returns its index or -1 when the pool is full. */
  alloc() {
    if (this.n >= this.cap) return -1;
    const i = this.n++;
    this.age[i] = 0; this.life[i] = 0.5;
    this.s0[i] = this.s1[i] = 0.3;
    this.a0[i] = 1; this.fin[i] = 0.08; this.fpow[i] = 1;
    this.rot[i] = 0; this.spin[i] = 0; this.stretch[i] = 0;
    this.frame[i] = 0; this.mode[i] = 0; this.add[i] = 1;
    this.drag[i] = 0; this.grav[i] = 0; this.follow[i] = 0;
    this.orb[i * 4] = 0;
    const j = i * 3;
    this.v[j] = this.v[j + 1] = this.v[j + 2] = 0;
    this.c0[j] = this.c0[j + 1] = this.c0[j + 2] = 1;
    this.c1[j] = this.c1[j + 1] = this.c1[j + 2] = 1;
    return i;
  }

  // --- setters (chainable by index; all allocation-free)
  pos(i, x, y, z) { const j = i * 3; this.p[j] = x; this.p[j + 1] = y; this.p[j + 2] = z; }
  vel(i, x, y, z) { const j = i * 3; this.v[j] = x; this.v[j + 1] = y; this.v[j + 2] = z; }
  color(i, c0, c1 = c0) {
    const j = i * 3;
    this.c0[j] = c0.r; this.c0[j + 1] = c0.g; this.c0[j + 2] = c0.b;
    this.c1[j] = c1.r; this.c1[j + 1] = c1.g; this.c1[j + 2] = c1.b;
  }
  look(i, frame, mode = 0, add = 1) { this.frame[i] = frame; this.mode[i] = mode; this.add[i] = add; }
  shape(i, s0, s1 = s0, rot = 0, spin = 0) { this.s0[i] = s0; this.s1[i] = s1; this.rot[i] = rot; this.spin[i] = spin; }
  fade(i, life, alpha = 1, fin = 0.08, fpow = 1) { this.life[i] = Math.max(0.01, life); this.a0[i] = alpha; this.fin[i] = Math.max(0.001, fin); this.fpow[i] = fpow; }
  phys(i, drag = 0, grav = 0, follow = 0, stretch = 0) { this.drag[i] = drag; this.grav[i] = grav; this.follow[i] = follow; this.stretch[i] = stretch; }
  /** Orbit around a centre (cx, cy, cz): radius r, start angle, angular velocity w, vertical bob amplitude. */
  orbit(i, cx, cy, cz, r, angle, w, bob = 0) {
    const k = i * 4, j = i * 3;
    this.orb[k] = r; this.orb[k + 1] = angle; this.orb[k + 2] = w; this.orb[k + 3] = bob;
    this.oc[j] = cx; this.oc[j + 1] = cy; this.oc[j + 2] = cz;
  }

  clear() { this.n = 0; this.geo.instanceCount = 0; this.mesh.visible = false; }

  _kill(i) {
    const last = --this.n;
    if (i === last) return;
    const S1 = this._s1 || (this._s1 = [this.age, this.life, this.s0, this.s1, this.a0, this.fin, this.fpow, this.rot, this.spin,
      this.stretch, this.frame, this.mode, this.add, this.drag, this.grav, this.follow]);
    const S3 = this._s3 || (this._s3 = [this.p, this.v, this.c0, this.c1, this.oc]);
    for (let k = 0; k < S1.length; k++) S1[k][i] = S1[k][last];
    const j = i * 3, l = last * 3;
    for (let k = 0; k < S3.length; k++) { const a = S3[k]; a[j] = a[l]; a[j + 1] = a[l + 1]; a[j + 2] = a[l + 2]; }
    const o = this.orb, j4 = i * 4, l4 = last * 4;
    o[j4] = o[l4]; o[j4 + 1] = o[l4 + 1]; o[j4 + 2] = o[l4 + 2]; o[j4 + 3] = o[l4 + 3];
  }

  /** Integrate by dt (skip when dt <= 0). fx, fy, fz: displacement of the followed target this frame. */
  update(dt, fx = 0, fy = 0, fz = 0) {
    if (dt > 0) {
      const { p, v, age, life, orb, oc } = this;
      for (let i = this.n - 1; i >= 0; i--) {
        const born = age[i] === 0;
        age[i] += dt;
        if (age[i] >= life[i]) { this._kill(i); continue; }
        const j = i * 3, f = born ? 0 : this.follow[i];
        const r = orb[i * 4];
        if (r > 0) {
          const k = i * 4;
          oc[j] += v[j] * dt + fx * f; oc[j + 1] += v[j + 1] * dt + fy * f; oc[j + 2] += v[j + 2] * dt + fz * f;
          const a = (orb[k + 1] += orb[k + 2] * dt);
          p[j] = oc[j] + Math.cos(a) * r;
          p[j + 1] = oc[j + 1] + Math.sin(a * 2.3) * orb[k + 3];
          p[j + 2] = oc[j + 2] + Math.sin(a) * r;
        } else {
          const g = this.grav[i], d = this.drag[i];
          v[j + 1] -= g * dt;
          if (d > 0) { const k = Math.exp(-d * dt); v[j] *= k; v[j + 1] *= k; v[j + 2] *= k; }
          p[j] += v[j] * dt + fx * f;
          p[j + 1] += v[j + 1] * dt + fy * f;
          p[j + 2] += v[j + 2] * dt + fz * f;
        }
        this.rot[i] += this.spin[i] * dt;
      }
    }
    this._write();
  }

  _write() {
    const n = this.n, b = this.buf;
    for (let i = 0; i < n; i++) {
      const j = i * 3, o = i * STRIDE;
      const t = this.age[i] / this.life[i];
      const e = 1 - (1 - t) * (1 - t);
      const size = this.s0[i] + (this.s1[i] - this.s0[i]) * e;
      const fi = t < this.fin[i] ? t / this.fin[i] : 1;
      const alpha = this.a0[i] * fi * Math.pow(1 - t, this.fpow[i]);
      b[o] = this.p[j]; b[o + 1] = this.p[j + 1]; b[o + 2] = this.p[j + 2];
      b[o + 3] = this.v[j]; b[o + 4] = this.v[j + 1]; b[o + 5] = this.v[j + 2];
      b[o + 6] = this.c0[j] + (this.c1[j] - this.c0[j]) * t;
      b[o + 7] = this.c0[j + 1] + (this.c1[j + 1] - this.c0[j + 1]) * t;
      b[o + 8] = this.c0[j + 2] + (this.c1[j + 2] - this.c0[j + 2]) * t;
      b[o + 9] = alpha;
      b[o + 10] = size;
      b[o + 11] = this.mode[i] === 1 ? this.stretch[i] : this.rot[i];
      b[o + 12] = this.frame[i] + 16 * this.mode[i];
      b[o + 13] = this.add[i];
    }
    this.geo.instanceCount = n;
    this.mesh.visible = n > 0;
    if (n > 0) {
      this.ib.clearUpdateRanges();
      this.ib.addUpdateRange(0, n * STRIDE);
      this.ib.needsUpdate = true;
    }
  }

  dispose() {
    this.mesh.parent?.remove(this.mesh);
    this.geo.dispose();
    this.material.dispose();
  }
}
