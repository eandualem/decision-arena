// Hand-authored chunk patterns (the classic runner situations) + the ChunkBuilder they are written with.
// Pure JS: no THREE, no DOM. Used by the Generator at runtime and by the node validator.
//
// Local coordinates: d = meters ahead of the chunk start. Lanes are real lane indices (-1, 0, 1); each
// pattern receives a random lane permutation (A, B, C) or a random mirror (L, M, R) so it appears in
// every configuration. Distances that are about reaction/timing are written in seconds via b.t(sec),
// which converts to meters with the design speed of the chunk.
import {
  RAMP, ROOF, CAR, trainLen, OBSTACLE, COIN_Y, COIN_LOW_Y, COIN_SPACING, PICKUP_Y,
  JUMP_APEX_T, JUMP_AIR_T, MOVING_SPAWN_AHEAD, MOVING_CLEAR_BEHIND, laneX, PHYS, TRAIN,
} from './layout.js';

const J = 'barrierJump', RO = 'barrierRoll', BU = 'bumper';
const LANES = [-1, 0, 1];

export class ChunkBuilder {
  begin(r, tier, v, dist) {
    this.r = r; this.tier = tier; this.v = v; this.dist = dist;
    this.statics = []; this.movings = []; this.coins = []; this.slots = []; this.clear = [];
    this.len = 0;
    const perm = r.shuffle([-1, 0, 1]);
    this.A = perm[0]; this.B = perm[1]; this.C = perm[2];
    const m = r.chance(0.5) ? 1 : -1;
    this.L = -m; this.M = 0; this.R = m;
    this._arcsDone = new Set();
    return this;
  }
  /** seconds -> meters at the design speed */
  t(sec) { return sec * this.v; }
  ext(d) { if (d > this.len) this.len = d; }
  end(d) { this.ext(d); }

  // ------------------------------------------------------------------ obstacles
  train(lane, d, cars, opts = {}) {
    const len = trainLen(cars);
    this.statics.push({ kind: 'train', lane, dNear: d, dFar: d + len, cars, ramp: !!opts.ramp });
    this.ext(d + len);
    return d + len;
  }
  /** ramp from dRamp to dRamp + RAMP, train right behind it. Returns the train's far end. */
  rampTrain(lane, dRamp, cars) { return this.train(lane, dRamp + RAMP, cars, { ramp: true }); }
  barrier(kind, lane, d) {
    const dep = OBSTACLE[kind].depth;
    this.statics.push({ kind, lane, dNear: d, dFar: d + dep });
    this.ext(d + dep);
    return d + dep;
  }
  row(kind, d, lanes = LANES) { for (const l of lanes) this.barrier(kind, l, d); return d + OBSTACLE[kind].depth; }
  jump(lane, d) { return this.barrier(J, lane, d); }
  roll(lane, d) { return this.barrier(RO, lane, d); }
  bumper(lane, d) { return this.barrier(BU, lane, d); }
  /** Moving train whose near end meets the runner at local d = dMeet. Reserves its lane for the whole approach. */
  moving(lane, dMeet, cars, vt) {
    const r = this.r;
    vt = vt ?? r.range(TRAIN.movingSpeedMin, TRAIN.movingSpeedMax) * (this.tier >= 3 ? 1.08 : 1);
    const len = trainLen(cars);
    const vMin = Math.max(14, this.v * 0.82);
    const lead = MOVING_SPAWN_AHEAD * vt / (vMin + vt);         // how far past dMeet the train starts
    const d0 = dMeet - MOVING_CLEAR_BEHIND, d1 = dMeet + lead + len + 3;
    this.movings.push({ kind: 'train', moving: true, lane, cars, len, dMeet, vt, clear0: d0, clear1: d1 });
    this.clear.push({ lane, d0, d1 });
    this.ext(d1);
    return d1;
  }
  isClear(lane, d) {
    for (const c of this.clear) if (c.lane === lane && d > c.d0 - 1 && d < c.d1) return false;
    return true;
  }

  // ------------------------------------------------------------------ queries
  /** Walkable surface height at (lane, d) from this chunk's static trains and ramps. */
  surfaceAt(lane, d) {
    let h = 0;
    for (const s of this.statics) {
      if (s.lane !== lane || s.kind !== 'train') continue;
      if (d >= s.dNear && d <= s.dFar) h = Math.max(h, ROOF);
      else if (s.ramp && d >= s.dNear - RAMP && d < s.dNear) h = Math.max(h, ROOF * (d - (s.dNear - RAMP)) / RAMP);
    }
    return h;
  }
  trainAt(lane, d) {
    for (const s of this.statics) if (s.lane === lane && s.kind === 'train' && d >= s.dNear - 0.01 && d <= s.dFar + 0.01) return s;
    return null;
  }
  nextTrainAfter(lane, d, within) {
    let best = null;
    for (const s of this.statics) if (s.lane === lane && s.kind === 'train' && s.dNear > d && s.dNear <= d + within && (!best || s.dNear < best.dNear)) best = s;
    return best;
  }

  // ------------------------------------------------------------------ coins
  coin(x, d, y) { this.coins.push({ x, d, y }); this.ext(d); }

  /**
   * A line of coins along `lane` from d0 to d1 that hugs whatever the runner does there: flat on the
   * ground, up ramps, along roofs, jump arcs over jump barriers / bumpers / roof gaps (matching the real
   * jump at the design speed), low under roll barriers, and a falling curve when a roof ends.
   */
  coinRun(lane, d0, d1) {
    const x = laneX(lane), v = this.v, half = v * JUMP_APEX_T;
    let d = d0;
    let guard = 0;
    while (d <= d1 + 0.01 && guard++ < 400) {
      if (!this.isClear(lane, d)) { d += COIN_SPACING; continue; }
      // jump-type obstacle ahead within the arc window?
      const jb = this._jumpObstacleNear(lane, d, half);
      if (jb) {
        const dc = (jb.dNear + jb.dFar) / 2;
        const h0 = this.surfaceAt(lane, dc - half - 0.5);
        if (!this._arcsDone.has(jb)) { this._arcsDone.add(jb); this._arc(x, dc, h0, v); }
        d = dc + half + COIN_SPACING;
        continue;
      }
      const s = this.surfaceAt(lane, d);
      const onTrain = this.trainAt(lane, d);
      if (onTrain) {
        // roof gap ahead? -> arc to the next roof. Roof ends with no train close behind -> falling curve.
        const endD = onTrain.dFar;
        const nxt = this.nextTrainAfter(lane, endD, 9);
        if (nxt) {
          const dc = (endD + nxt.dNear) / 2;
          if (d >= dc - half - 0.2) {
            if (!this._arcsDone.has(onTrain)) { this._arcsDone.add(onTrain); this._arc(x, dc, ROOF, v); }
            d = Math.max(dc + half + COIN_SPACING * 0.6, nxt.dNear + 0.5);
            continue;
          }
        } else if (d + COIN_SPACING > endD) {
          this.coin(x, d, s + COIN_Y);
          // walk-off fall: y = ROOF - g t^2 / 2
          let dd = endD + 0.8;
          for (let k = 0; k < 6; k++) {
            const tt = (dd - endD) / v;
            const y = ROOF - 0.5 * PHYS.gravity * tt * tt;
            if (y <= 0.05 || dd > d1) break;
            if (this._blocked(lane, dd, y)) break;
            this.coin(x, dd, y + COIN_Y);
            dd += COIN_SPACING;
          }
          d = dd;
          continue;
        }
      }
      const low = this._rollNear(lane, d);
      const y = low ? s + COIN_LOW_Y : s + COIN_Y;
      if (!this._blocked(lane, d, s)) this.coin(x, d, y);
      d += COIN_SPACING;
    }
  }
  /** coins sliding from lane a to lane b between d0 and d1 (ground level) */
  coinShift(a, b, d0, d1, base = 0) {
    const n = Math.max(2, Math.round((d1 - d0) / COIN_SPACING));
    for (let i = 0; i <= n; i++) {
      const t = i / n, d = d0 + (d1 - d0) * t;
      const e = t * t * (3 - 2 * t);
      const x = laneX(a) + (laneX(b) - laneX(a)) * e;
      this.coin(x, d, base + COIN_Y);
    }
  }
  _arc(x, dc, h0, v) {
    const n = Math.max(5, Math.round((v * JUMP_AIR_T) / 1.9)) + 1;
    for (let k = 0; k < n; k++) {
      const t = (k / (n - 1)) * JUMP_AIR_T;
      const y = h0 + PHYS.jumpVelocity * t - 0.5 * PHYS.gravity * t * t;
      this.coin(x, dc - v * JUMP_APEX_T + v * t, y + COIN_Y);
    }
  }
  _jumpObstacleNear(lane, d, half) {
    for (const s of this.statics) {
      if (s.lane !== lane || (s.kind !== J && s.kind !== BU)) continue;
      const dc = (s.dNear + s.dFar) / 2;
      if (d >= dc - half - 0.2 && d <= dc + half) return s;
    }
    return null;
  }
  _rollNear(lane, d) {
    for (const s of this.statics) if (s.lane === lane && s.kind === RO && d > s.dNear - 3.5 && d < s.dFar + 3.5) return s;
    return null;
  }
  /** would a coin at (lane, d) with the runner's feet at y sit inside a solid obstacle? */
  _blocked(lane, d, y) {
    for (const s of this.statics) {
      if (s.lane !== lane || d < s.dNear - 0.6 || d > s.dFar + 0.6) continue;
      if (s.kind === 'train') { if (y < ROOF - 0.2) return true; continue; }
      const o = OBSTACLE[s.kind];
      if (y + COIN_Y > o.minY - 0.3 && y + COIN_Y < o.maxY + 0.4 && s.kind !== RO) return true;
    }
    return false;
  }

  // ------------------------------------------------------------------ pickups
  slot(lane, d, pref = 'any') {
    if (!this.isClear(lane, d)) return;
    const s = this.surfaceAt(lane, d);
    if (this._blocked(lane, d, s)) return;
    this.slots.push({ lane, d, y: s + PICKUP_Y, pref, roof: s >= ROOF - 0.01 });
    this.ext(d);
  }
}

// ======================================================================================= catalog
// w = weights per tier [easy, medium, hard, expert]; minD = first distance where the pattern may appear.
export const PATTERNS = [];
const def = (id, w, build, o = {}) => PATTERNS.push({ id, w, build, minD: o.minD ?? 0, tags: o.tags || [] });
const pickTier = (b, arr) => arr[Math.min(b.tier, arr.length - 1)];

// ---- one train, two free lanes
def('single', [4, 1.2, 0.3, 0], (b) => {
  const { A, B, C, r } = b;
  const e = b.train(A, 4, r.int(1, b.tier ? 3 : 2));
  b.coinRun(B, 0, e);
  b.slot(B, e + 4);
  if (b.tier > 0 && r.chance(0.6)) b.barrier(r.pick([J, RO]), C, r.range(8, Math.max(9, e - 4)));
});

// ---- two trains side by side, one free lane
def('pair', [3, 2.5, 1.2, 0.8], (b) => {
  const { A, B, C, r } = b;
  const e1 = b.train(A, 4, r.int(1, 3));
  const e2 = b.train(B, 4 + r.range(0, b.t(0.4)), r.int(1, 3));
  const e = Math.max(e1, e2);
  b.coinRun(C, 0, e);
  b.slot(C, e + 3);
});

// ---- a single barrier (+ maybe a second one beside it)
def('barrier', [4, 1, 0.3, 0], (b) => {
  const { A, B, C, r } = b;
  const kind = r.pick([J, RO, J, BU]);
  const d = b.t(0.7);
  b.barrier(kind, A, d);
  b.coinRun(A, d - b.t(0.65), d + b.t(0.7));
  if (r.chance(0.5)) b.barrier(r.pick([J, RO]), B, d + r.range(-2, 6));
  b.slot(C, d + 5);
});

// ---- full row of barriers across every lane (forced jump / forced roll), maybe a second row
def('row', [2.5, 2, 1, 0.6], (b) => {
  const { A, r } = b;
  const kind = r.pick([J, RO, J]);
  const d = b.t(0.75);
  b.row(kind, d);
  let e = d + b.t(0.7);
  if (b.tier > 0 && r.chance(0.55)) {
    const k2 = kind === J ? RO : J;
    const d2 = d + b.t(pickTier(b, [1.5, 1.25, 1.05, 0.95]));
    b.row(k2, d2);
    e = d2 + b.t(0.7);
  }
  b.coinRun(A, d - b.t(0.65), e);
  b.slot(r.pick([-1, 0, 1]), e + 3);
});

// ---- a jump/roll barrier in each lane, mixed
def('mixedRow', [1, 3, 2.5, 2], (b) => {
  const { A, B, C, r } = b;
  const d = b.t(0.75);
  const kinds = [r.pick([J, RO]), r.pick([J, RO]), 0];
  kinds[2] = kinds[0] === kinds[1] ? (kinds[0] === J ? RO : J) : r.pick([J, RO, BU]);
  b.barrier(kinds[0], A, d); b.barrier(kinds[1], B, d + r.range(0, 1.5)); b.barrier(kinds[2], C, d + r.range(0, 1.5));
  b.coinRun(A, d - b.t(0.65), d + b.t(0.8));
  b.slot(A, d + b.t(0.8) + 3);
  if (b.tier > 1 && r.chance(0.5)) {
    const d2 = d + b.t(pickTier(b, [1.5, 1.3, 1.1, 1.0]));
    b.train(r.pick([A, B, C]), d2, r.int(1, 2));
  }
});

// ---- ramp onto a train (coins up the ramp and along the roof, power-up on the roof)
def('rampTrain', [3, 2.5, 1.5, 1], (b) => {
  const { A, B, C, r } = b;
  const e = b.rampTrain(A, 3, r.int(2, 3));
  b.coinRun(A, 1, e + b.t(0.45));
  b.slot(A, e - 5, 'roof');
  if (r.chance(0.7)) b.train(B, 3 + RAMP + r.range(-1, 10), r.int(1, 2));
  if (b.tier > 0 && r.chance(0.5)) b.barrier(r.pick([J, RO]), C, r.range(12, e - 6));
});

// ---- three trains side by side, a ramp in one lane: the only way is up
def('threeRamp', [0.8, 3, 3, 2.5], (b) => {
  const { A, B, C, r } = b;
  const d0 = 3;
  const eA = b.rampTrain(A, d0, r.int(2, 3));
  const eB = b.train(B, d0 + RAMP + r.range(-1.5, 5), r.int(2, 4));
  const eC = b.train(C, d0 + RAMP + r.range(-1.5, 5), r.int(2, 4));
  b.coinRun(A, d0 - 2, eA - (Math.max(eB, eC) > eA + 6 ? 4 : -b.t(0.45)));
  const longest = eB > eC ? B : C;
  if (Math.max(eB, eC) > eA + 6 && Math.abs(longest - A) === 1) {
    b.coinShift(A, longest, eA - 3.5, eA + 1, ROOF);   // hop across to the longer roof (same height)
    b.coinRun(longest, eA + 3, Math.max(eB, eC) + b.t(0.4));
  }
  b.slot(r.chance(0.5) ? A : longest, d0 + RAMP + 10, 'roof');
});

// ---- two walls of trains, the free lane changes: forced lane switches
def('wallSlalom', [0.3, 3, 3, 3], (b) => {
  const { r } = b;
  const f1 = r.pick(LANES);
  const f2 = r.pick(LANES.filter((l) => l !== f1));
  const n1 = r.int(1, 3), n2 = r.int(1, 3);
  let e1 = 0, s2min = Infinity, e2 = 0;
  for (const l of LANES) if (l !== f1) e1 = Math.max(e1, b.train(l, 4 + r.range(0, 3), n1));
  const gap = b.t(pickTier(b, [1.05, 0.9, 0.75, 0.62])) + 4 + Math.abs(f2 - f1) * b.t(0.1);
  const s2 = e1 + gap;
  for (const l of LANES) if (l !== f2) { const s = s2 + r.range(0, 3); s2min = Math.min(s2min, s); e2 = Math.max(e2, b.train(l, s, n2)); }
  b.coinRun(f1, 0, e1);
  b.coinShift(f1, f2, e1 + 1, s2min - 1);
  b.coinRun(f2, s2min, e2);
  b.slot(f2, e2 + 3);
});

// ---- rows alternating jump / roll
def('gauntlet', [0, 2, 3, 3], (b) => {
  const { A, r } = b;
  const n = r.int(3, b.tier >= 2 ? 5 : 4);
  const sp = b.t(pickTier(b, [1.35, 1.1, 0.95, 0.85]));
  let kind = r.pick([J, RO]);
  let d = b.t(0.75);
  const d0 = d;
  for (let i = 0; i < n; i++) {
    if (b.tier >= 2 && r.chance(0.35)) {
      // mixed row: one lane differs
      const odd = r.pick(LANES);
      for (const l of LANES) b.barrier(l === odd ? (kind === J ? RO : J) : kind, l, d);
    } else b.row(kind, d);
    kind = r.chance(0.8) ? (kind === J ? RO : J) : kind;
    d += sp;
  }
  b.coinRun(A, d0 - b.t(0.65), d - sp + b.t(0.7));
  b.slot(A, d - sp + b.t(0.7) + 3);
});

// ---- corridor: trains in two lanes, barriers in the third
def('tunnel', [0.2, 3, 3, 2.5], (b) => {
  const { A, B, C, r } = b;
  const cars = r.int(3, 4);
  const eA = b.train(A, 4, cars), eB = b.train(B, 4 + r.range(0, 4), cars);
  const e = Math.min(eA, eB);
  const sp = b.t(pickTier(b, [1.4, 1.2, 1.0, 0.9]));
  let d = 4 + b.t(0.8);
  let kind = r.pick([J, RO]);
  let n = 0;
  while (d < e - 3 && n < 4) { b.barrier(kind, C, d); kind = r.chance(0.7) ? (kind === J ? RO : J) : kind; d += sp; n++; }
  b.coinRun(C, 0, e);
  b.slot(C, e + 4);
});

// ---- roof running: ramp, then trains with small gaps to hop across
def('roofRun', [0, 2, 3, 3], (b) => {
  const { A, B, C, r } = b;
  let e = b.rampTrain(A, 3, r.int(1, 2));
  const hops = r.int(1, b.tier >= 2 ? 3 : 2);
  const gMax = Math.min(pickTier(b, [3.4, 3.8, 4.6, 5.4]), 0.6157 * Math.max(14, b.v * 0.82) - 3.4);
  let firstEnd = e;
  for (let i = 0; i < hops; i++) e = b.train(A, e + r.range(2.6, Math.max(2.8, gMax)), r.int(1, 3));
  b.train(B, 3 + RAMP + r.range(-1, 6), r.int(2, 4));
  if (r.chance(0.6)) b.train(C, 3 + RAMP + r.range(4, 16), r.int(2, 3));
  else { let d = 3 + b.t(1.0); while (d < e - 4) { b.barrier(r.pick([J, RO]), C, d); d += b.t(r.range(1.1, 1.6)); } }
  b.coinRun(A, 1, e + b.t(0.45));
  b.slot(A, firstEnd - 4, 'roof');
});

// ---- a moving train charging down an otherwise open lane
def('movingOpen', [0.8, 2.5, 3, 3], (b) => {
  const { A, B, C, r } = b;
  const dMeet = 8 + b.t(r.range(1.4, 2.0));
  b.moving(A, dMeet, r.int(1, b.tier >= 2 ? 3 : 2));
  if (r.chance(0.7)) b.train(B, dMeet - b.t(r.range(0.4, 0.9)), r.int(2, 3));
  else { b.barrier(r.pick([J, RO]), B, dMeet - b.t(0.3)); }
  b.coinRun(C, 0, dMeet + 12);
  b.slot(C, dMeet + 16);
  if (b.tier >= 2 && r.chance(0.5)) b.barrier(r.pick([J, RO]), C, dMeet + b.t(1.1));
}, { minD: 300 });

// ---- lone moving train, both other lanes free (a gentle introduction)
def('movingSolo', [1, 1.5, 0.8, 0.5], (b) => {
  const { A, B, r } = b;
  const dMeet = 8 + b.t(r.range(1.4, 2.0));
  b.moving(A, dMeet, r.int(1, 2));
  b.coinRun(B, 0, dMeet + 10);
  b.slot(B, dMeet + 14);
}, { minD: 280 });

// ---- two moving trains, a barrier lane to survive in
def('movingPair', [0, 0.6, 2, 3], (b) => {
  const { A, B, C, r } = b;
  const d1 = 8 + b.t(r.range(1.4, 1.8));
  b.moving(A, d1, r.int(1, 2));
  const d2 = d1 + b.t(r.range(1.4, 2.0));
  b.moving(B, d2, r.int(1, 2));
  let d = b.t(0.9), kind = r.pick([J, RO]);
  while (d < d2 + 6) { b.barrier(kind, C, d); kind = kind === J ? RO : J; d += b.t(r.range(1.1, 1.5)); }
  b.coinRun(C, 0, d2 + 8);
  b.slot(C, d + 3);
}, { minD: 1100 });

// ---- ramp is the escape: wall in one lane, moving train in another
def('rampEscape', [0, 1, 2.5, 2.5], (b) => {
  const { A, B, C, r } = b;
  const eA = b.rampTrain(A, 3, r.int(2, 3));
  b.train(C, 3 + r.range(0, 4), r.int(3, 4));
  b.moving(B, 3 + RAMP + b.t(r.range(0.7, 1.1)), r.int(1, 2));
  b.coinRun(A, 1, eA);
  b.slot(A, eA - 6, 'roof');
}, { minD: 900 });

// ---- buffer stop at a track end
def('bumperEnd', [1.5, 2, 1, 0.5], (b) => {
  const { A, B, C, r } = b;
  if (r.chance(0.5)) {
    const e = b.train(A, 4, r.int(1, 2));
    b.bumper(A, e + 1.0);                               // track end right behind the parked train
    const db = r.range(b.t(0.7), Math.max(b.t(0.7) + 1, e - 4));
    b.bumper(B, db);
    b.coinRun(B, db - b.t(0.65), db + b.t(0.8));
    b.slot(B, db + b.t(0.8) + 3);
    if (b.tier > 0 && r.chance(0.5)) b.barrier(r.pick([J, RO]), C, db + r.range(4, 10));
  } else {
    const db = b.t(0.7);
    b.bumper(A, db);                                   // buffer stop in front of a parked train
    const e = b.train(A, db + 2.2, r.int(1, 3));
    b.coinRun(B, 0, e);
    if (r.chance(0.6)) b.bumper(C, db + r.range(4, 10));
    b.slot(B, e + 4);
  }
});

// ---- gates: two lanes blocked by short obstacles, the free lane moves each time
def('zigzag', [0.3, 2, 3, 3], (b) => {
  const { r } = b;
  const n = r.int(3, 4);
  const sp = b.t(pickTier(b, [1.25, 1.05, 0.88, 0.75])) + 3;
  let d = 4, free = r.pick(LANES), prevFree = free;
  for (let i = 0; i < n; i++) {
    let end = d;
    for (const l of LANES) {
      if (l === free) continue;
      if (r.chance(0.55)) end = Math.max(end, b.train(l, d, 1));
      else end = Math.max(end, b.barrier(r.pick([J, RO, J]), l, d));
    }
    if (i > 0) b.coinShift(prevFree, free, d - sp + 1, d - 1);
    b.coinRun(free, d, end);
    if (i === n - 1) b.slot(free, end + 3);
    prevFree = free;
    const others = LANES.filter((l) => l !== free);
    free = r.chance(0.7) ? others.sort((a, c) => Math.abs(a - free) - Math.abs(c - free))[0] : r.pick(others);
    d = end + sp;
  }
});

// ---- barrier row, then a wall right behind it: jump + lane switch combo
def('jumpDodge', [0, 1.5, 2.5, 2.5], (b) => {
  const { A, B, C, r } = b;
  const d = b.t(0.75);
  const kind = r.pick([J, RO, J]);
  b.row(kind, d);
  const s = d + b.t(pickTier(b, [1.3, 1.1, 0.95, 0.85])) + 2;
  const e1 = b.train(A, s, r.int(1, 3));
  const e2 = b.train(B, s + r.range(0, 3), r.int(1, 3));
  b.coinRun(C, d - b.t(0.65), Math.max(e1, e2));
  b.slot(C, Math.max(e1, e2) + 3);
});

// ---- two ramps side by side: a big roof section
def('twinRamps', [0.5, 1.5, 1.5, 1], (b) => {
  const { A, B, C, r } = b;
  const eA = b.rampTrain(A, 3, r.int(2, 3));
  const eB = b.rampTrain(B, 3 + r.range(0, 6), r.int(2, 4));
  b.train(C, 3 + RAMP + r.range(0, 8), r.int(2, 4));
  b.coinRun(B, 1, eB + b.t(0.45));
  b.slot(A, eA - 5, 'roof');
});

// ---- breather: coins weaving across empty track
def('breather', [2, 0.8, 0.4, 0.25], (b) => {
  const { A, B, r } = b;
  const L = b.t(r.range(1.3, 2.0));
  b.coinRun(A, 0, L * 0.4);
  b.coinShift(A, B, L * 0.4 + 1.5, L * 0.6);
  b.coinRun(B, L * 0.6 + 1.5, L);
  b.slot(B, L + 3);
  b.end(L + 4);
});

export const PATTERN_IDS = PATTERNS.map((p) => p.id);
