// Autopilot (GAMEPLAY): a look-ahead bot for long automated test runs (`?autopilot` or game.autopilot = true).
// It simulates candidate plans (lane change timing x jump/roll timing) with the exact player physics against a
// snapshot of Level colliders (moving trains extrapolated), with stricter margins than the live game, and
// commits to the best surviving plan. A simple "reflex" (jump barriers, roll under overhangs, hop trains with
// Spring Kicks) is used both inside rollouts and live, so predictions and behaviour stay consistent.
import { PLAYER, PHYS, TRAIN, LANE_WIDTH } from '../config.js';
import {
  TUNE, HW, HD, createBody, copyBody, createCfg, createEvents, clearEvents, stepBody, laneChange, tryJump, tryRoll,
  supportFromCols,
} from './physics.js';

const H = 1.25;                 // planning horizon (s)
const STEP = 1 / 40;            // rollout step (s)
const LANE_T = [0, 0.1, 0.22, 0.36, 0.55];
const JUMP_T = [0, 0.06, 0.13, 0.21, 0.3, 0.42, 0.56, 0.72];
const ROLL_T = [0, 0.12, 0.26, 0.42, 0.6];
const SECOND_SWIPE = 0.07;
const INFLATE_Z = 0.12;
const SCAN = 110;               // strategic look-ahead (m)

function makePlan() { return { n: 0, dir: 0, mt0: 0, mt1: 0, md0: false, md1: false, v: 0, tv: 0, vDone: false, target: 0 }; }
function copyPlan(d, s) { Object.assign(d, s); return d; }

export class Autopilot {
  constructor(game) {
    this.game = game;
    this.ctx = game.ctx;
    this.cols = [];
    this.W = { cols: this.cols, tOff: 0, support: (x, z, hw, top) => supportFromCols(this.cols, this.W.tOff, x, z, hw, top) };
    this.sim = createBody();
    this.ev = createEvents();
    this.cfg = createCfg();
    this.plan = null;
    this._plan = makePlan();
    this._cand = makePlan();
    this._best = makePlan();
    this._noop = makePlan();
    this.laneVal = [0, 0, 0];
    this.stratT = 0;
    this.searchCd = 0;
    this.out = [];
    this.rDead = false; this.rStumble = false; this.rT = 0;
    this.searches = 0;
    this._lane = [[], [], []];
    this.flightT = 0;
  }

  reset() { this.plan = null; this.stratT = 0; this.searchCd = 0; }

  _syncCfg() {
    const src = this.game._cfg();
    const c = this.cfg;
    c.jumpV = src.jumpV; c.doubleJump = src.doubleJump; c.glide = src.glide; c.zap = src.zap;
    c.invulnerable = this.game.player.invulnT > H;
    c.strict = true; c.inflateZ = INFLATE_Z;
  }

  /** Called by Game every run frame. Returns the actions to perform (human input passes through). */
  think(dt, input) {
    const out = this.out;
    out.length = 0;
    for (let i = 0; i < input.length; i++) out.push(input[i]);
    const g = this.game, P = g.player, b = P.b;
    if (!g.run || dt <= 0) return out;
    this._syncCfg();
    const got = this.ctx.level.getColliders(b.z - SCAN, b.z + 8, this.cols);
    if (got && got !== this.cols) { this.cols.length = 0; for (let i = 0; i < got.length; i++) this.cols.push(got[i]); }
    this.stratT -= dt;
    if (this.stratT <= 0) { this.stratT = 0.12; this._strategy(); }
    if (P.flight) { this.plan = null; this._flight(dt, out); return out; }

    let p = this.plan;
    if (p) {
      p.mt0 -= dt; p.mt1 -= dt; p.tv -= dt;
      if ((p.n < 1 || p.md0) && (p.n < 2 || p.md1) && (!p.v || p.vDone)) p = this.plan = null;
    }
    let need = false;
    if (p) { this._rollout(p); if (this.rDead) need = true; }
    else {
      this._rollout(this._noopPlan(b));
      if (this.rDead) need = true;
      else {
        let best = -1e9;
        for (let i = 0; i < 3; i++) best = Math.max(best, this.laneVal[i]);
        if (best > this.laneVal[b.lane + 1] + 10) need = true;
      }
    }
    this.searchCd -= dt;
    if (need && (this.searchCd <= 0 || this.rDead)) {
      const best = this._search();
      if (best < 0) {
        // nothing survives with safety margins: plan with the live game's exact forgiveness instead
        this.cfg.strict = false; this.cfg.inflateZ = 0;
        this._search();
        this.cfg.strict = true; this.cfg.inflateZ = INFLATE_Z;
      }
      this.searchCd = 0.05; p = this.plan;
    }

    if (p) {
      const due = dt * 0.5;
      if (p.n > 0 && !p.md0 && p.mt0 <= due) { out.push(p.dir < 0 ? 'left' : 'right'); p.md0 = true; }
      if (p.n > 1 && !p.md1 && p.mt1 <= due) { out.push(p.dir < 0 ? 'left' : 'right'); p.md1 = true; }
      if (p.v && !p.vDone && p.tv <= due) { out.push(p.v === 1 ? 'up' : 'down'); p.vDone = true; }
    }
    if (!p || !p.v || p.vDone) {
      this.W.tOff = 0;
      const a = this._reflex(b, 0, this.cfg, false);
      if (a) out.push(a);
    }
    return out;
  }

  _noopPlan(b) { const p = this._noop; p.n = 0; p.v = 0; p.vDone = true; p.md0 = p.md1 = true; p.target = b.lane; return p; }

  // ------------------------------------------------------------------------------ search
  _search() {
    this.searches++;
    const b = this.game.player.b;
    const cur = b.lane;
    const cand = this._cand, best = this._best;
    let bestS = -1e12, found = false;
    for (let target = -1; target <= 1; target++) {
      const n = Math.abs(target - cur), dir = Math.sign(target - cur);
      const nt = n === 0 ? 1 : LANE_T.length;
      for (let k = 0; k < nt; k++) {
        const mt = n === 0 ? 0 : LANE_T[k];
        cand.n = n; cand.dir = dir; cand.mt0 = mt; cand.mt1 = mt + SECOND_SWIPE; cand.md0 = n < 1; cand.md1 = n < 2;
        cand.target = target;
        cand.v = 0; cand.tv = 0; cand.vDone = true;
        let s = this._eval(cand);
        if (s > bestS) { bestS = s; copyPlan(best, cand); found = true; }
        if (!this.rDead && this.cfg.jumpV < 15) continue;   // surviving without a vertical move: variants only cost more
        for (let j = 0; j < JUMP_T.length; j++) {
          cand.v = 1; cand.tv = JUMP_T[j]; cand.vDone = false;
          s = this._eval(cand);
          if (s > bestS) { bestS = s; copyPlan(best, cand); }
        }
        for (let j = 0; j < ROLL_T.length; j++) {
          cand.v = 2; cand.tv = ROLL_T[j]; cand.vDone = false;
          s = this._eval(cand);
          if (s > bestS) { bestS = s; copyPlan(best, cand); }
        }
      }
    }
    if (!found) return bestS;
    if (best.n === 0 && best.v === 0) { this.plan = null; return bestS; }
    this.plan = copyPlan(this._plan, best);
    return bestS;
  }

  _eval(p) {
    const b = this._rollout(p);
    if (this.rDead) {
      const g = this.game, r = g.run;
      const stumbleOk = this.rStumble && r && r.t - r.lastStumbleT >= 4.6;   // a 2nd stumble in the window = caught
      return -1000 + this.rT * 300 + (stumbleOk ? 80 : 0);
    }
    let s = 1000 + this.laneVal[p.target + 1];
    if (b.grounded && b.y >= TRAIN.height - 0.2) s += 8;
    s -= p.n * 3 + (p.v === 1 ? 3 : p.v === 2 ? 2 : 0);
    if (p.v) s += Math.max(0, p.tv) * 4;
    if (p.n) s -= Math.max(0, p.mt0) * 6;
    return s;
  }

  /** Simulate plan p from the live body. Sets rDead / rStumble / rT. Returns the final simulated body. */
  _rollout(p) {
    const g = this.game;
    const b = copyBody(this.sim, g.player.b);
    const W = this.W, cfg = this.cfg, ev = this.ev;
    let d0 = p.md0 || p.n < 1, d1 = p.md1 || p.n < 2, vd = p.vDone || !p.v;
    this.rDead = false; this.rStumble = false; this.rT = H;
    let t = 0;
    while (t < H) {
      W.tOff = t;
      if (!d0 && t >= p.mt0 - 1e-6) { laneChange(b, p.dir, cfg.zap); d0 = true; }
      if (!d1 && t >= p.mt1 - 1e-6) { laneChange(b, p.dir, cfg.zap); d1 = true; }
      if (!vd) { if (t >= p.tv - 1e-6) { if (p.v === 1) tryJump(b, W, cfg); else tryRoll(b); vd = true; } }
      else this._reflex(b, t, cfg, true);
      const n = Math.max(1, Math.ceil((b.speed * STEP) / TUNE.subStep));
      const sdt = STEP / n;
      for (let i = 0; i < n; i++) {
        W.tOff = t + (i + 1) * sdt;
        clearEvents(ev);
        stepBody(b, sdt, W, cfg, ev);
        if (ev.hitType) { this.rDead = true; this.rStumble = ev.hitType === 'stumble'; this.rT = t; return b; }
      }
      t += STEP;
    }
    return b;
  }

  // ------------------------------------------------------------------------------ reflex
  /** Jump low barriers, roll under overhangs, hop trains with Spring Kicks. sim=true applies it to b. */
  _reflex(b, t, cfg, sim) {
    if (!b.grounded || b.jumpBufT > 0) return null;
    const cols = this.cols;
    const x0 = b.x - HW - 0.05, x1 = b.x + HW + 0.05, zf = b.z - HD;
    let best = null, bestT = 0.75;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.ramp || x0 >= c.maxX || x1 <= c.minX) continue;
      if (c.maxY <= b.y + 0.05 || c.minY >= b.y + PLAYER.height) continue;
      const near = c.maxZ + (c.vz ? c.vz * t : 0);
      const gap = zf - near;
      if (gap < -0.3) continue;
      const tc = gap / (b.speed + (c.vz || 0));
      if (tc < bestT) { bestT = tc; best = c; }
    }
    if (!best) return null;
    if (best.top === 'walk' && b.y > 0.05 && b.y < TRAIN.height - 0.05) return null;   // on a ramp: it carries us up
    const rel = best.minY - b.y;
    const v = b.speed + (best.vz || 0);
    let act = null;
    if (rel > 0.5) {
      if (bestT <= 0.3 && b.rollT < 0.2) act = 'down';
    } else {
      const top = best.top === 'walk' ? best.maxY - b.y - (PHYS.stepUp - 0.05) : best.maxY - b.y + 0.1;
      const v0 = cfg.jumpV, g = PHYS.gravity;
      const disc = v0 * v0 - 2 * g * top;
      if (disc > 0) {
        const tA = (v0 - Math.sqrt(disc)) / g, tB = (v0 + Math.sqrt(disc)) / g;
        const lead = (HD + INFLATE_Z - HD) / v;
        if (best.top === 'walk') {
          if (bestT - lead <= tA + 0.07) act = 'up';             // (Spring Kicks) arrive just above the roof
        } else {
          const D = (best.maxZ - best.minZ + 2 * (HD + INFLATE_Z)) / v;
          if (tB - D > tA && bestT - lead <= (tA + tB - D) * 0.5) act = 'up';
        }
      }
    }
    if (act && sim) { if (act === 'up') tryJump(b, this.W, cfg); else tryRoll(b); }
    return act;
  }

  // ------------------------------------------------------------------------------ strategy
  /** Lane values: how far each lane stays open (roofs, ramps and Spring Kicks extend it), minus hazards. */
  _strategy() {
    const b = this.game.player.b, cols = this.cols;
    const sneakers = this.cfg.jumpV > 15;
    const lanes = this._lane;
    for (let L = 0; L < 3; L++) lanes[L].length = 0;
    const ramps = this._ramps || (this._ramps = []);
    ramps.length = 0;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.minZ > b.z + HD) continue;                    // fully behind
      const L = Math.round((c.minX + c.maxX) * 0.5 / LANE_WIDTH);
      if (L < -1 || L > 1) continue;
      if (c.ramp) ramps.push(c);
      else lanes[L + 1].push(c);
    }
    for (let L = -1; L <= 1; L++) {
      const arr = lanes[L + 1];
      arr.sort((a, c) => c.maxZ - a.maxZ);                // nearest first
      let onRoof = false, roofEnd = 0, wall = SCAN, bonus = 0;
      for (let i = 0; i < arr.length; i++) {
        const c = arr[i];
        const gap = (b.z - HD) - c.maxZ;
        if (c.kind !== 'train') {                           // barriers / bumpers
          if (!onRoof && gap > 0 && gap < 70) bonus -= 1.5;
          continue;
        }
        if (gap <= 0 && L === b.lane && b.y >= c.maxY - 0.2) { onRoof = true; roofEnd = c.minZ; bonus += 12; continue; }
        if (onRoof && c.maxZ >= roofEnd - 7) { roofEnd = Math.min(roofEnd, c.minZ); continue; }
        onRoof = false;
        if (gap <= 0 && !c.moving) {
          // alongside us: the lane opens again after its far end (small penalty for the wait)
          bonus -= Math.min(25, (b.z - HD - c.minZ) * 0.6);
          continue;
        }
        if (c.moving) {
          const eff = gap > 0 ? (gap * b.speed) / (b.speed + c.vz) : 0;
          if (gap > -2) { wall = Math.min(wall, eff); bonus -= 18; }
          break;
        }
        let ramp = false;
        for (let k = 0; k < ramps.length; k++) {
          const r = ramps[k];
          if (Math.abs(r.ramp.zHigh - c.maxZ) < 0.6 && r.maxX > c.minX && r.minX < c.maxX) { ramp = true; break; }
        }
        if (ramp || sneakers) { onRoof = true; roofEnd = c.minZ; if (ramp && gap > 0 && gap < 60) bonus += 5; continue; }
        wall = Math.min(wall, Math.max(0, gap));
        break;
      }
      this.laneVal[L + 1] = Math.min(wall, SCAN) + bonus - Math.abs(L - b.lane) * 2 + (L === 0 ? 1.5 : 0);
    }
    this._items(b);
  }

  /** Best effort: steer toward power-ups / keys / boxes and coin lines ahead (reads the Level's item lists). */
  _items(b) {
    const lvl = this.ctx.level;
    const val = this.laneVal;
    const scan = (list, isCoin) => {
      if (!Array.isArray(list)) return;
      let coins0 = 0, coins1 = 0, coins2 = 0;
      for (let i = 0; i < list.length; i++) {
        const it = list[i];
        const pos = it.mesh ? it.mesh.position : it;
        if (!pos || typeof pos.z !== 'number') continue;
        const ahead = b.z - pos.z;
        if (ahead < 4 || ahead > (isCoin ? 40 : 75)) continue;
        if (pos.y > b.y + 3.2 || pos.y < b.y - 2.5) continue;          // out of reach from our current height
        const L = Math.round(pos.x / LANE_WIDTH);
        if (L < -1 || L > 1) continue;
        if (isCoin) { if (L === -1) coins0++; else if (L === 0) coins1++; else coins2++; continue; }
        const t = it.type;
        const w = t === 'key' || t === 'mysteryBox' || t === 'letter' || t === 'token' ? 12 : t === 'coin' ? 0 : 22;
        val[L + 1] += w * (1 - ahead / 90);
      }
      if (isCoin) { val[0] += Math.min(6, coins0 * 0.35); val[1] += Math.min(6, coins1 * 0.35); val[2] += Math.min(6, coins2 * 0.35); }
    };
    try {
      scan(Array.isArray(lvl.pickups) ? lvl.pickups : lvl.pickups && lvl.pickups.list, false);
      scan(Array.isArray(lvl.coins) ? lvl.coins : lvl.coins && lvl.coins.list, true);
    } catch { /* level internals changed: items are only a bonus */ }
  }

  _flight(dt, out) {
    // In the air nothing can hit us: drift toward the best lane for the landing, one swipe at a time.
    this.flightT -= dt;
    if (this.flightT > 0) return;
    const b = this.game.player.b;
    let bestL = b.lane, bestV = this.laneVal[b.lane + 1];
    for (let L = -1; L <= 1; L++) if (this.laneVal[L + 1] > bestV + 6) { bestV = this.laneVal[L + 1]; bestL = L; }
    if (bestL !== b.lane) { out.push(bestL < b.lane ? 'left' : 'right'); this.flightT = 0.3; }
  }
}
