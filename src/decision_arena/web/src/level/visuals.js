// Rendering side of the LEVEL module.
//   * trains + props (ramps, barriers, bumpers): one BatchedMesh each (1 draw call each, per-instance culling)
//   * graffiti decals: one alpha-tested BatchedMesh
//   * glows (moving-train headlight flares, pickup halos): one additive InstancedMesh of camera-facing quads
//   * headlight beams on the track: one additive InstancedMesh
// Everything is pooled: adding / removing a train only allocates / frees batch instance ids.
import * as THREE from 'three';
import { buildTrainAtlas, buildGraffitiAtlas, buildPropsAtlas, buildGlowTextures, GRAFFITI_COUNT, LIVERIES, PLATE_TEXTS } from './art.js';
import { buildCar, buildLamps, buildPlate, buildDecal, buildRamp, buildBarrierJump, buildBarrierRoll, buildBumper } from './models.js';
import { CAR, CAR_GAP, ROOF, laneX, trainLen } from './layout.js';
import { HALF_W, CAB } from './trainspec.js';

const H = CAR / 2;
const _m = new THREE.Matrix4();
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _yAxis = new THREE.Vector3(0, 1, 0);
const _c = new THREE.Color();

function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

/** A BatchedMesh holding a fixed set of named geometries. */
class Bank {
  constructor(geos, maxInstances, material, name) {
    let v = 0, i = 0;
    for (const g of Object.values(geos)) { v += g.attributes.position.count; i += g.index.count; }
    this.mesh = new THREE.BatchedMesh(maxInstances, v, i, material);
    this.mesh.name = name;
    this.mesh.frustumCulled = false;       // whole-batch bounds would be stale; per-instance culling stays on
    this.mesh.perObjectFrustumCulled = true;
    this.mesh.sortObjects = false;
    this.gid = {};
    for (const [k, g] of Object.entries(geos)) { this.gid[k] = this.mesh.addGeometry(g); g.dispose(); }
    this.max = maxInstances;
    this.used = 0;
  }
  add(name) {
    if (this.used >= this.max) return -1;
    this.used++;
    return this.mesh.addInstance(this.gid[name]);
  }
  remove(id) { if (id >= 0) { this.mesh.deleteInstance(id); this.used--; } }
  set(id, m) { if (id >= 0) this.mesh.setMatrixAt(id, m); }
}

/** Camera-facing additive quads with per-instance color (compacted every frame). */
class GlowLayer {
  constructor(tex, cap) {
    this.cap = cap;
    const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, toneMapped: false });
    this.mesh = new THREE.InstancedMesh(new THREE.PlaneGeometry(1, 1), mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.setColorAt(0, _c.set(0xffffff));
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    this.mesh.count = 0;
    this.items = [];     // {x,y,z,size,r,g,b,alpha,on}
    this.free = [];
  }
  alloc(color, size) {
    const it = this.free.pop() || { x: 0, y: 0, z: 0, size: 1, r: 1, g: 1, b: 1, a: 1, on: false };
    _c.set(color);
    it.r = _c.r; it.g = _c.g; it.b = _c.b; it.size = size; it.a = 1; it.on = true;
    this.items.push(it);
    return it;
  }
  release(it) {
    if (!it || !it.on) return;
    it.on = false;
    const i = this.items.indexOf(it);
    if (i >= 0) { this.items[i] = this.items[this.items.length - 1]; this.items.pop(); }
    this.free.push(it);
  }
  update(camera) {
    const n = Math.min(this.cap, this.items.length);
    _q.copy(camera.quaternion);
    for (let i = 0; i < n; i++) {
      const it = this.items[i];
      _p.set(it.x, it.y, it.z);
      _s.set(it.size, it.size, it.size);
      _m.compose(_p, _q, _s);
      this.mesh.setMatrixAt(i, _m);
      _c.setRGB(it.r * it.a, it.g * it.a, it.b * it.a);
      this.mesh.setColorAt(i, _c);
    }
    this.mesh.count = n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}

export class LevelVisuals {
  constructor(ctx, root) {
    this.ctx = ctx;
    this.root = root;
    const q = ctx.quality || 'high';
    this.TA = buildTrainAtlas(q);
    this.PA = buildPropsAtlas(q);
    this.GA = buildGraffitiAtlas(q);
    const glowTex = buildGlowTextures();

    // ---- materials
    this.trainMat = new THREE.MeshStandardMaterial({
      map: this.TA.map, emissiveMap: this.TA.emissiveMap, emissive: 0xffffff, emissiveIntensity: 2.2,
      vertexColors: true, roughness: 0.6, metalness: 0.08,
    });
    this.propsMat = new THREE.MeshStandardMaterial({
      map: this.PA.map, emissiveMap: this.PA.emissiveMap, emissive: 0xffffff, emissiveIntensity: 2.0,
      vertexColors: true, roughness: 0.66, metalness: 0.06,
    });
    this.decalMat = new THREE.MeshStandardMaterial({
      map: this.GA.map, alphaTest: 0.45, roughness: 0.75, metalness: 0,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.trainMat.name = 'level-train'; this.propsMat.name = 'level-props'; this.decalMat.name = 'level-decal';

    // ---- train bank
    const tg = {};
    LIVERIES.forEach((_, l) => { for (const t of ['mid', 'end', 'solo']) tg[`car_${t}_${l}`] = buildCar(this.TA, l, t); });
    tg.lampsOff = buildLamps(this.TA, false);
    tg.lampsLit = buildLamps(this.TA, true);
    for (let i = 0; i < 12; i++) tg['plate' + i] = buildPlate(this.TA, i);
    this.trains = new Bank(tg, 900, this.trainMat, 'level-trains');
    const pg = { ramp: buildRamp(this.PA), barrierJump: buildBarrierJump(this.PA), barrierRoll: buildBarrierRoll(this.PA), bumper: buildBumper(this.PA) };
    this.props = new Bank(pg, 220, this.propsMat, 'level-props');
    const dg = {};
    for (let i = 0; i < GRAFFITI_COUNT; i++) dg['g' + i] = buildDecal(this.GA, i);
    this.decals = new Bank(dg, 700, this.decalMat, 'level-decals');

    const shadows = q !== 'low';
    for (const b of [this.trains, this.props]) { b.mesh.castShadow = shadows; b.mesh.receiveShadow = shadows; }
    this.decals.mesh.receiveShadow = shadows;
    root.add(this.trains.mesh, this.props.mesh, this.decals.mesh);

    // ---- glows + beams
    this.glow = new GlowLayer(glowTex.radial, 96);
    root.add(this.glow.mesh);
    const beamGeo = new THREE.PlaneGeometry(1, 1, 1, 4);
    beamGeo.rotateX(-Math.PI / 2);                 // lies on the ground, length along z
    // taper: narrow at the lamps (z=+0.5 side is far from the train... set per instance scale)
    {
      const pos = beamGeo.attributes.position;
      for (let i = 0; i < pos.count; i++) {
        const z = pos.getZ(i);                     // -0.5 (train end) .. +0.5 (far end, toward the runner)
        const w = 0.55 + (z + 0.5) * 0.7;
        pos.setX(i, pos.getX(i) * w);
      }
      const uv = beamGeo.attributes.uv;
      for (let i = 0; i < uv.count; i++) uv.setY(i, 1 - (pos.getZ(i) + 0.5));
    }
    const beamMat = new THREE.MeshBasicMaterial({ map: glowTex.beam, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false, color: 0xfff1c8, opacity: 0.55, toneMapped: false });
    this.beams = new THREE.InstancedMesh(beamGeo, beamMat, 16);
    this.beams.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.beams.frustumCulled = false;
    this.beams.count = 0;
    this.beams.renderOrder = 4;
    this.beamItems = [];
    root.add(this.beams);

    this._vpool = [];
  }

  // ------------------------------------------------------------------ trains
  /**
   * Build the visual of a train. zNear = world maxZ (end facing the runner at spawn); lit = moving (headlights on).
   * Returns a handle; call placeTrain() whenever zNear changes.
   */
  addTrain(lane, zNear, cars, liv, seed, lit) {
    const R = mulberry(seed || 1);
    const v = this._vpool.pop() || { pieces: [], decals: [], glows: [], beam: null };
    v.pieces.length = 0; v.decals.length = 0; v.glows.length = 0; v.beam = null;
    v.lane = lane; v.x = laneX(lane); v.cars = cars; v.lit = lit;
    const len = trainLen(cars);
    const T = this.trains;
    const piece = (arr, bank, name, dz, ry, dx = 0, dy = 0, s = 1) => {
      const id = bank.add(name);
      if (id < 0) return;
      arr.push({ id, bank, dx, dy, dz, ry, s });
    };
    for (let k = 0; k < cars; k++) {
      const dz = -H - k * (CAR + CAR_GAP);
      if (cars === 1) piece(v.pieces, T, `car_solo_${liv}`, dz, 0);
      else if (k === 0) piece(v.pieces, T, `car_end_${liv}`, dz, 0);
      else if (k === cars - 1) piece(v.pieces, T, `car_end_${liv}`, dz, Math.PI);
      else piece(v.pieces, T, `car_mid_${liv}`, dz, 0);
      // graffiti: up to two pieces per side
      for (const side of [1, -1]) {
        const n = R() < 0.72 ? (R() < 0.35 ? 2 : 1) : 0;
        for (let j = 0; j < n; j++) {
          const s = 2.5 + R() * 0.85;                      // decal width (height = s / 2)
          const h = s / 2;
          const span = H - 0.7 - s / 2;
          const zc = n === 2 ? (j === 0 ? -1 : 1) * (0.5 + R() * Math.max(0, span - 0.5)) * (s / 2 < span ? 1 : 0.6) : (R() * 2 - 1) * span;
          const y = 0.82 + R() * Math.max(0, 1.66 - h) + h / 2;
          piece(v.decals, this.decals, 'g' + ((R() * GRAFFITI_COUNT) | 0), dz + zc, side * Math.PI / 2, side * (HALF_W + 0.014), y, s);
        }
      }
    }
    const plate = ((R() * PLATE_TEXTS.length) | 0);
    piece(v.pieces, T, lit ? 'lampsLit' : 'lampsOff', 0, 0);
    piece(v.pieces, T, 'plate' + (plate + (lit ? 6 : 0)), 0, 0);
    piece(v.pieces, T, 'lampsOff', -len, Math.PI);
    piece(v.pieces, T, 'plate' + ((plate + 1) % 6), -len, Math.PI);
    if (lit) {
      const capY = (y) => 0.64 + (y - 0.64) * 0.965;
      for (const sx of [-1, 1]) {
        const gl = this.glow.alloc(0xfff0c0, 1.5);
        gl.dx = sx * CAB.lampX * 0.935; gl.dy = capY(CAB.lampY); gl.dz = 0.18;
        v.glows.push(gl);
      }
      const big = this.glow.alloc(0xffe2a0, 4.2);
      big.dx = 0; big.dy = 1.3; big.dz = 0.35; big.a = 0.55;
      v.glows.push(big);
      v.beam = { x: 0, z: 0, on: true };
      this.beamItems.push(v.beam);
    }
    this.placeTrain(v, zNear);
    return v;
  }

  placeTrain(v, zNear) {
    v.z = zNear;
    for (const arr of [v.pieces, v.decals]) for (const pc of arr) {
      _p.set(v.x + pc.dx, pc.dy, zNear + pc.dz);
      _q.setFromAxisAngle(_yAxis, pc.ry);
      _s.set(pc.s, pc.s, pc.s);
      _m.compose(_p, _q, _s);
      pc.bank.set(pc.id, _m);
    }
    for (const gl of v.glows) { gl.x = v.x + gl.dx; gl.y = gl.dy; gl.z = zNear + gl.dz; }
    if (v.beam) { v.beam.x = v.x; v.beam.z = zNear; }
  }

  removeTrain(v) {
    if (!v) return;
    for (const pc of v.pieces) pc.bank.remove(pc.id);
    for (const pc of v.decals) pc.bank.remove(pc.id);
    for (const gl of v.glows) this.glow.release(gl);
    if (v.beam) { const i = this.beamItems.indexOf(v.beam); if (i >= 0) this.beamItems.splice(i, 1); }
    v.pieces.length = 0; v.decals.length = 0; v.glows.length = 0; v.beam = null;
    this._vpool.push(v);
  }

  // ------------------------------------------------------------------ props
  /** kind: ramp (z = train maxZ = ramp high end) | barrierJump | barrierRoll | bumper (z = collider center). */
  addProp(kind, lane, z) {
    const id = this.props.add(kind);
    if (id < 0) return -1;
    _p.set(laneX(lane), 0, z); _q.identity(); _s.set(1, 1, 1);
    this.props.set(id, _m.compose(_p, _q, _s));
    return id;
  }
  removeProp(id) { this.props.remove(id); }

  // ------------------------------------------------------------------ per frame
  update(dt, camera, time) {
    // flicker-free pulse on moving-train glows
    this.glow.update(camera);
    const n = Math.min(16, this.beamItems.length);
    for (let i = 0; i < n; i++) {
      const b = this.beamItems[i];
      const L = 16;
      _p.set(b.x, 0.035, b.z + L / 2 + 0.2); _q.identity(); _s.set(2.4, 1, L);
      this.beams.setMatrixAt(i, _m.compose(_p, _q, _s));
    }
    this.beams.count = n;
    this.beams.instanceMatrix.needsUpdate = true;
    void dt; void time;
  }

  stats() { return { trains: this.trains.used, props: this.props.used, decals: this.decals.used, glows: this.glow.items.length }; }
}

export { ROOF };
