// LEVEL: obstacle / collectible streaming for Rail Dash (see CONTRACTS.md 6.2).
//   generator.js + patterns.js  -> what goes where (pure logic, validated in node by validate.mjs + sim.js)
//   visuals.js / coins.js / pickups.js -> how it looks (BatchedMeshes, instanced coins, glow layer)
// This file owns the runtime state: obstacle records + their persistent collider objects, moving trains,
// the tutorial script, the menu backdrop and the gameplay events.
import * as THREE from 'three';
import { EV } from '../core/events.js';
import { VIEW, BARRIER, TRAIN, FLIGHT } from '../config.js';
import { RNG } from '../core/rng.js';
import { Generator } from './generator.js';
import { LevelVisuals } from './visuals.js';
import { CoinField } from './coins.js';
import { PickupField } from './pickups.js';
import {
  RAMP, ROOF, OBSTACLE, TRAIN_W, trainLen, laneX, movingTrainSpeed, nominalSpeedAt,
  MOVING_SPAWN_AHEAD, APPROACH_DIST, COIN_Y, COIN_LOW_Y, COIN_SPACING, PICKUP_Y, JUMP_APEX_T, JUMP_AIR_T, PHYS,
} from './layout.js';

const RESULT_EMPTY = [];
const J = 'barrierJump', RO = 'barrierRoll', BU = 'bumper';

export class Level {
  constructor(ctx) {
    this.ctx = ctx;
    this.root = new THREE.Group();
    this.root.name = 'level';
    ctx.scene.add(this.root);
    this.vis = new LevelVisuals(ctx, this.root);
    this.coins = new CoinField(ctx, this.root);
    this.pickups = new PickupField(ctx, this.root, this.vis.glow);
    this.gen = new Generator();
    this.recs = [];            // live obstacle records (trains, ramps, barriers, bumpers)
    this._recPool = [];
    this.pending = [];         // moving trains waiting to enter (d-space specs)
    this._id = 1;
    this._tmp = [];
    this.tutorial = null;
    this.devSpeed = 0;         // how far the run's speed deviates from the nominal curve (for chunk design speed)
    this.lastInfoZ = 0;
    this.time = 0;
    this.stats = { chunks: 0 };
    this._speedAt = (d) => Math.min(30, Math.max(14, nominalSpeedAt(d) + this.devSpeed));
  }

  start() { this.reset(); }

  // ================================================================== reset
  reset(opts = {}) {
    for (let i = this.recs.length - 1; i >= 0; i--) this._release(i);
    this.pending.length = 0;
    this.coins.clear();
    this.pickups.clear();
    this.devSpeed = 0;
    this.time = 0;
    const seedParam = this.ctx.params?.get?.('seed');
    const seed = seedParam != null ? (+seedParam >>> 0) + (this._runs = (this._runs || 0) + 1) - 1 : (this.ctx.rng.next() * 2 ** 31) >>> 0;
    this.rng = new RNG(seed ^ 0x5bd1e995);
    let plan = { letters: [], tokens: false };
    try { plan = this.ctx.meta?.getSpawnPlan?.() || plan; } catch { /* meta not ready */ }
    this.tutorial = null;
    let startD = 40;
    if (opts.tutorial) { startD = this._buildTutorial(); }
    this.gen.reset({ seed, startD, speedAt: this._speedAt, plan });
    this._spawnBackdrop();
    this._stream(0);
  }

  // ================================================================== obstacle records
  _rec(kind, lane, minZ, maxZ) {
    const r = this._recPool.pop() || { col: { id: 0, kind: '', lane: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, vz: 0, top: 'none', ramp: null, moving: false } };
    r.id = this._id++;
    r.kind = kind; r.lane = lane; r.moving = false; r.vis = null; r.prop = -1; r.link = null;
    r.vt = 0; r.vDesign = 0; r.dMeet = 0; r.approached = false; r.cars = 0; r.len = maxZ - minZ;
    r.passed = false; r.tIn = 0; r.tMinY = Infinity; r.tStand = false; r.hint = null;
    const c = r.col, x = laneX(lane);
    const w = kind === 'train' || kind === 'ramp' ? TRAIN_W / 2 : OBSTACLE[kind].width / 2;
    c.id = r.id; c.kind = kind; c.lane = lane; c.minX = x - w; c.maxX = x + w;
    c.minZ = minZ; c.maxZ = maxZ; c.vz = 0; c.moving = false;
    if (kind === 'train' || kind === 'ramp') { c.minY = 0; c.maxY = ROOF; c.top = 'walk'; }
    else { c.minY = OBSTACLE[kind].minY; c.maxY = OBSTACLE[kind].maxY; c.top = 'none'; }
    if (kind === 'ramp') {
      const rp = r.rampObj || (r.rampObj = { zLow: 0, zHigh: 0, h: ROOF });
      rp.zLow = maxZ; rp.zHigh = minZ; rp.h = ROOF;
      c.ramp = rp;
    } else c.ramp = null;
    this.recs.push(r);
    return r;
  }
  _release(i) {
    const r = this.recs[i];
    if (r.kind === 'train') this.vis.removeTrain(r.vis);
    else if (r.prop >= 0) this.vis.removeProp(r.prop);
    r.vis = null; r.prop = -1; r.link = null;
    this.recs[i] = this.recs[this.recs.length - 1];
    this.recs.pop();
    this._recPool.push(r);
  }
  _removeRec(r) { const i = this.recs.indexOf(r); if (i >= 0) this._release(i); }

  /** Static train (zNear = world maxZ). ramp: add a ramp in front of it. */
  _addTrain(lane, zNear, cars, liv = 0, seed = 1, ramp = false) {
    const len = trainLen(cars);
    const r = this._rec('train', lane, zNear - len, zNear);
    r.cars = cars;
    r.vis = this.vis.addTrain(lane, zNear, cars, liv, seed, false);
    if (ramp) {
      const rr = this._rec('ramp', lane, zNear, zNear + RAMP);
      rr.prop = this.vis.addProp('ramp', lane, zNear);
      rr.link = r; r.link = rr;
    }
    return r;
  }
  _addBarrier(kind, lane, zNear) {
    const dep = OBSTACLE[kind].depth;
    const r = this._rec(kind, lane, zNear - dep, zNear);
    r.prop = this.vis.addProp(kind, lane, zNear - dep / 2);
    return r;
  }
  _addMoving(spec, pd, v) {
    const dN = spec.dMeet + (spec.vt / Math.max(1, v)) * (spec.dMeet - pd);
    const zNear = -dN, len = spec.len;
    const r = this._rec('train', spec.lane, zNear - len, zNear);
    r.moving = true; r.col.moving = true; r.cars = spec.cars;
    r.vDesign = spec.vt; r.vt = spec.vt; r.col.vz = spec.vt; r.dMeet = spec.dMeet;
    r.vis = this.vis.addTrain(spec.lane, zNear, spec.cars, spec.liv, spec.seed, true);
    return r;
  }

  // ================================================================== streaming
  _stream(pd) {
    let guard = 0;
    while (this.gen.cursor < pd + VIEW.spawnAhead + 30 && guard++ < 50) this._instantiate(this.gen.next());
  }
  _instantiate(ch) {
    this.stats.chunks++;
    for (const s of ch.statics) {
      if (s.kind === 'train') this._addTrain(s.lane, -s.dNear, s.cars, s.liv, s.seed, s.ramp);
      else this._addBarrier(s.kind, s.lane, -s.dNear);
    }
    for (const m of ch.movings) this.pending.push(m);
    for (const c of ch.coins) this.coins.add(c.x, c.y, -c.d, false);
    for (const p of ch.pickups) this.pickups.add(p.type, p.x, p.y, -p.d, p.letter);
  }

  _spawnBackdrop() {
    // graffiti trains parked behind the start line (menu camera looks back at them); center lane stays clear
    const r = this.rng;
    const L = r.chance(0.5) ? -1 : 1;
    const a = this._addTrain(L, 5 + 2 * 12.5 + 0.7 + r.range(0, 1.5), 2, r.int(0, 4), r.int(1, 1e9));
    const b = this._addTrain(-L, 9 + 3 * 12.5 + 1.4 + r.range(0, 1.5), 3, r.int(0, 4), r.int(1, 1e9));
    const c = this._addTrain(L, 45.8 + r.range(0, 1.2), 1, r.int(0, 4), r.int(1, 1e9));
    for (const t of [a, b, c]) t.passed = true;
  }

  // ================================================================== tutorial
  _buildTutorial() {
    const T = (this.tutorial = { steps: [], done: false });
    const step = (d, action, text, build) => T.steps.push({ d, action, text, build, hinted: false, built: false });
    // 1) jump: barriers across all lanes
    step(60, 'jump', 'Swipe UP to jump!', () => {
      for (const l of [-1, 0, 1]) this._addBarrier(J, l, -60);
      this._coinArc(0, 60 + OBSTACLE[J].depth / 2, 0, 14);
      this._coinLine(0, 36, 52, 0);
    });
    // 2) roll: hanging signs across all lanes
    step(118, 'roll', 'Swipe DOWN to roll!', () => {
      for (const l of [-1, 0, 1]) this._addBarrier(RO, l, -118);
      this._coinLine(0, 106, 128, 0, COIN_LOW_Y);
    });
    // 3) a train in the runner's lane, both side lanes free
    step(172, 'left', 'Swipe LEFT to dodge!', () => {
      this._addTrain(0, -172, 1, 2, 777);
      this._coinLine(-1, 158, 186, 0);
    });
    // 4) wall: free lane on the right
    step(236, 'right', 'Swipe RIGHT to switch lanes!', () => {
      this._addTrain(-1, -236, 1, 0, 778); this._addTrain(0, -236, 1, 4, 779);
      this._coinLine(1, 214, 250, 0);
    });
    // 5) ramp onto the roofs (other lanes blocked)
    step(290, 'any', 'Run up the ramp to the roofs!', () => {
      this._addTrain(1, -290 - RAMP, 2, 3, 780, true);
      this._addTrain(-1, -290 - RAMP, 2, 1, 781); this._addTrain(0, -290 - RAMP, 2, 0, 782);
      this._coinRamp(1, 290, 290 + RAMP + trainLen(2));
      this.pickups.add('magnet', laneX(1), ROOF + PICKUP_Y, -(290 + RAMP + 18));
    });
    for (const s of T.steps) { s.build(); s.built = true; }
    T.end = 290 + RAMP + trainLen(2) + 4;
    return T.end + 26;
  }
  _coinLine(lane, d0, d1, base, y = COIN_Y) { for (let d = d0; d <= d1; d += COIN_SPACING) this.coins.add(laneX(lane), base + y, -d); }
  _coinArc(lane, dc, h0, v) {
    const n = Math.max(5, Math.round((v * JUMP_AIR_T) / 1.9)) + 1;
    for (let k = 0; k < n; k++) {
      const t = (k / (n - 1)) * JUMP_AIR_T;
      this.coins.add(laneX(lane), h0 + PHYS.jumpVelocity * t - 0.5 * PHYS.gravity * t * t + COIN_Y, -(dc - v * JUMP_APEX_T + v * t));
    }
  }
  _coinRamp(lane, dRamp, dEnd) {
    for (let d = dRamp + 0.5; d <= dEnd; d += COIN_SPACING) {
      const h = d < dRamp + RAMP ? ROOF * (d - dRamp) / RAMP : ROOF;
      this.coins.add(laneX(lane), h + COIN_Y, -d);
    }
  }
  _tutorialUpdate(info) {
    const T = this.tutorial;
    if (!T || T.done || info.state !== 'running') return;
    const pd = -info.playerZ;
    for (const s of T.steps) {
      if (!s.hinted && pd >= s.d - 25) {
        s.hinted = true;
        let action = s.action;
        if (action === 'left' && info.lane !== 0) continue;           // already out of the train's lane
        if (action === 'right' && info.lane === 1) continue;
        this.ctx.events.emit(EV.TUTORIAL_HINT, { action, text: s.text, z: -s.d });
      }
    }
    if (pd > T.end) { T.done = true; this.ctx.events.emit(EV.TUTORIAL_DONE, {}); }
  }

  // ================================================================== per frame
  update(dt, info) {
    const pz = info.playerZ ?? 0;
    const pd = -pz;
    const v = info.speed || 0;
    this.time += dt;
    const running = info.state === 'running';
    // design-speed deviation (headstart / boards change the speed at a given distance)
    if (running && v > 0 && !info.headstart && !info.jetpack) {
      const dev = Math.max(-8, Math.min(4, v - nominalSpeedAt(pd)));
      this.devSpeed += (dev - this.devSpeed) * Math.min(1, dt * 0.5);
    }
    this._stream(pd);

    // --- moving trains: enter, move, approach events
    if (v > 0 && dt > 0) {
      for (let i = this.pending.length - 1; i >= 0; i--) {
        const m = this.pending[i];
        if (pd > m.dMeet - 6) { this.pending.splice(i, 1); continue; }         // runner already there (flight, clearRange)
        if (m.dMeet - pd <= MOVING_SPAWN_AHEAD * v / (v + m.vt)) { this._addMoving(m, pd, v); this.pending.splice(i, 1); }
      }
    }
    const moveOk = v > 0 && dt > 0 && info.state !== 'dying' && info.state !== 'gameover';
    for (let i = 0; i < this.recs.length; i++) {
      const r = this.recs[i];
      if (!r.moving) continue;
      if (moveOk) {
        const dN = -r.col.maxZ;
        r.vt = movingTrainSpeed(dN, r.dMeet, pd, v, r.vDesign);
        const dz = r.vt * dt;
        r.col.minZ += dz; r.col.maxZ += dz; r.col.vz = r.vt;
        this.vis.placeTrain(r.vis, r.col.maxZ);
      } else r.col.vz = 0;
      if (!r.approached && r.col.maxZ < pz && r.col.maxZ > pz - APPROACH_DIST) {
        r.approached = true;
        if (running) this.ctx.events.emit(EV.TRAIN_APPROACH, { id: r.id, lane: r.lane, z: r.col.maxZ, speed: r.vt });
      }
    }

    // --- pass events + recycling
    const E = this.ctx.events;
    for (let i = this.recs.length - 1; i >= 0; i--) {
      const r = this.recs[i], c = r.col;
      if (!r.passed) {
        if (pz - 0.3 < c.maxZ + 0.1 && pz + 0.3 > c.minZ - 0.1 && Math.abs((info.playerX || 0) - laneX(r.lane)) < 1.25) {
          r.tIn++;
          const y = info.playerY || 0;
          if (y < r.tMinY) r.tMinY = y;
          if (!(info.rolling || y + PHYS_ROLL_H < BARRIER.rollClear)) r.tStand = true;
        }
        if (c.minZ > pz + 0.35) {
          r.passed = true;
          if (running && r.kind !== 'ramp') E.emit(EV.OBSTACLE_PASS, { kind: r.kind, lane: r.lane, playerLane: info.lane, relation: this._relation(r), moving: r.moving });
        }
      }
      if (c.minZ > pz + VIEW.despawnBehind) this._release(i);
    }

    this._tutorialUpdate(info);
    this.coins.update(dt, pz);
    this.pickups.update(dt, pz, this.time);
    this.vis.update(dt, this.ctx.camera, this.time);
    this.lastInfoZ = pz;
  }

  _relation(r) {
    if (!r.tIn) return 'beside';
    if (r.kind === 'train') return r.tMinY >= ROOF - 0.5 ? (r.tMinY > ROOF + 1.6 ? 'over' : 'onTop') : 'through';
    if (r.kind === RO) return !r.tStand ? 'under' : r.tMinY >= BARRIER.rollTop - 0.15 ? 'over' : 'through';
    return r.tMinY >= OBSTACLE[r.kind].maxY - 0.2 ? 'over' : 'through';
  }

  // ================================================================== queries (contract)
  getColliders(zMin, zMax, out = []) {
    out.length = 0;
    for (let i = 0; i < this.recs.length; i++) {
      const c = this.recs[i].col;
      if (c.minZ < zMax && c.maxZ > zMin) out.push(c);
    }
    return out;
  }

  static rampHeightAt(ramp, z) {
    const t = (ramp.zLow - z) / (ramp.zLow - ramp.zHigh);
    return ramp.h * Math.min(1, Math.max(0, t));
  }

  supportHeight(x, z, halfWidth, maxTop) {
    let best = 0;
    for (let i = 0; i < this.recs.length; i++) {
      const c = this.recs[i].col;
      if (c.top !== 'walk' || z < c.minZ || z > c.maxZ || x + halfWidth <= c.minX || x - halfWidth >= c.maxX) continue;
      const h = c.ramp ? Level.rampHeightAt(c.ramp, z) : c.maxY;
      if (h <= maxTop && h > best) best = h;
    }
    return best;
  }

  collect(box, opts = {}) {
    const a = this.coins.collect(box, opts, opts.dt || 0);
    const b = this.pickups.collect(box);
    if (!a.length && !b.length) { RESULT_EMPTY.length = 0; return RESULT_EMPTY; }
    if (!b.length) return a;
    if (!a.length) return b;
    return a.concat(b);
  }

  clearRange(zA, zB) {
    const lo = Math.min(zA, zB), hi = Math.max(zA, zB);
    for (let i = this.recs.length - 1; i >= 0; i--) {
      const r = this.recs[i], c = r.col;
      let hit = c.minZ < hi && c.maxZ > lo;
      if (!hit && r.moving) hit = c.maxZ < hi && c.maxZ > lo - 70;           // oncoming train about to arrive
      if (!hit && r.link) { const l = r.link.col; hit = l.minZ < hi && l.maxZ > lo; }
      if (hit) { const link = r.link; this._release(i); if (link) this._removeRec(link); i = Math.min(i, this.recs.length); }
    }
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const zm = -this.pending[i].dMeet;
      if (zm < hi && zm > lo - 30) this.pending.splice(i, 1);
    }
  }

  spawnSkyTrail({ fromZ, length = 200, y = FLIGHT.jetpackAltitude, kind = 'jetpack' } = {}) {
    const r = this.rng;
    const cy = y + 0.85;
    if (kind === 'headstart') {
      for (let d = 0, k = 0; d < length; d += 7.5, k++) if (k % 4 !== 3) this.coins.add(0, cy, fromZ - d, true);
      return;
    }
    if (kind === 'pogo') {
      // a triple arc over all lanes following the bounce
      const n = Math.max(8, Math.round(length / COIN_SPACING));
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const h = 4 * t * (1 - t) * y;
        if (h + COIN_Y < ROOF + 1.4) continue;               // stay above the roofs
        for (const lane of [-1, 0, 1]) this.coins.add(laneX(lane), h + COIN_Y, fromZ - t * length, true);
      }
      return;
    }
    // jetpack: weaving line with smooth lane changes and the odd 3-wide cluster
    let lane = r.pick([-1, 0, 1]), d = 0;
    while (d < length) {
      const run = r.range(26, 44);
      for (let s = 0; s < run && d < length; s += 2.4, d += 2.4) this.coins.add(laneX(lane), cy, fromZ - d, true);
      if (d >= length) break;
      if (r.chance(0.18)) {
        for (let k = 0; k < 4 && d < length; k++, d += 2.4) for (const l of [-1, 0, 1]) this.coins.add(laneX(l), cy, fromZ - d, true);
        continue;
      }
      const to = r.pick([-1, 0, 1].filter((l) => l !== lane));
      const span = 9 + Math.abs(to - lane) * 4;
      for (let s = 0; s < span && d < length; s += 2.4, d += 2.4) {
        const t = s / span, e = t * t * (3 - 2 * t);
        this.coins.add(laneX(lane) + (laneX(to) - laneX(lane)) * e, cy, fromZ - d, true);
      }
      lane = to;
    }
  }

  // ------------------------------------------------------------------ debug helpers (harness)
  debugStats() {
    return { recs: this.recs.length, pending: this.pending.length, coins: this.coins.list.length, pickups: this.pickups.list.length, ...this.vis.stats(), chunks: this.stats.chunks };
  }
}

const PHYS_ROLL_H = 0.85;
export { TRAIN };
