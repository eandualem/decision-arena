// Live player controller (GAMEPLAY): wraps the physics body, runs it against the Level every frame with
// sub-steps, and adds the flight modes (jetpack, rocket start, pogo) with safe, obstacle-aware descents.
import { PHYS, FLIGHT, LANE_WIDTH, TRAIN } from '../config.js';
import {
  TUNE, HW, HD, createBody, resetBody, createCfg, createEvents, clearEvents, stepBody, laneChange, updateLane,
  tryJump, tryRoll, addGrace, overheadBlocked,
} from './physics.js';

const JET_RISE = 0.7;         // seconds to climb to cruise altitude
const DESCENT_ACCEL = 24;     // m/s^2 while descending after a flight
const DESCENT_MAX = 10.5;     // max descent speed (m/s)
const FLOOR_LOOKAHEAD = 0.45; // seconds: keep above obstacle tops we are about to reach while descending

export class Player {
  constructor(game) {
    this.game = game;
    this.ctx = game.ctx;
    this.b = createBody();
    this.cfg = createCfg();
    this.ev = createEvents();
    this.cols = [];
    this.W = {
      cols: this.cols,
      tOff: 0,
      support: (x, z, hw, maxTop) => this.ctx.level.supportHeight(x, z, hw, maxTop),
    };
    this.flight = null;       // { kind:'jetpack'|'headstart'|'pogo', phase:'rise'|'cruise'|'descend', t, y0, alt, vy, g }
    this.invulnT = 0;         // collisions are soft (vault / pass / bounce) while > 0
    this.blinkT = 0;          // visible blink (revive, hoverboard break)
    this.knockV = 0;          // death knock-back speed
  }

  reset(z = 0) {
    resetBody(this.b, z, 0);
    this.flight = null;
    this.invulnT = 0;
    this.blinkT = 0;
    this.knockV = 0;
    this.cols.length = 0;
  }

  get flying() { return !!this.flight; }

  // -------------------------------------------------------------------------------- actions
  lane(dir, zap) { return laneChange(this.b, dir, zap); }
  jump(cfg) { return this.flight ? null : tryJump(this.b, this.W, cfg); }
  roll() { return this.flight ? null : tryRoll(this.b); }
  grace(id) { addGrace(this.b, id); }

  startFlight(kind, alt) {
    const b = this.b;
    const prev = this.flight;
    this.flight = { kind, phase: 'rise', t: 0, y0: b.y, alt, vy: 0, g: 0 };
    if (prev && prev.kind !== 'pogo' && prev.phase !== 'descend') { this.flight.phase = 'cruise'; }
    b.grounded = false; b.vy = 0; b.rollT = 0; b.rollAir = false; b.jumpBufT = 0; b.coyoteT = 0; b.jumped = true;
    b.peakY = b.y;
  }

  startPogo(duration) {
    const b = this.b;
    const h = Math.max(2, FLIGHT.pogoApex - b.y);
    const T = Math.max(1.2, duration);
    this.flight = { kind: 'pogo', phase: 'rise', t: 0, y0: b.y, alt: FLIGHT.pogoApex, vy: 4 * h / T, g: 8 * h / (T * T) };
    b.grounded = false; b.vy = this.flight.vy; b.rollT = 0; b.rollAir = false; b.jumpBufT = 0; b.coyoteT = 0; b.jumped = true;
    b.peakY = b.y;
  }

  /** End of a jetpack / rocket start: glide down onto whatever is below. */
  descend() {
    const f = this.flight;
    if (f && f.kind !== 'pogo' && f.phase !== 'descend') { f.phase = 'descend'; f.vy = Math.min(0, this.b.vy * 0.3); }
  }

  // -------------------------------------------------------------------------------- per frame
  /** Advance the player during a run. Returns the (reused) event record. */
  update(dt, speed, cfg) {
    const b = this.b;
    const ev = clearEvents(this.ev);
    b.speed = speed;
    if (this.invulnT > 0) this.invulnT = Math.max(0, this.invulnT - dt);
    if (this.blinkT > 0) this.blinkT = Math.max(0, this.blinkT - dt);
    if (dt <= 0) return ev;
    const reach = speed * dt + speed * FLOOR_LOOKAHEAD + 16;
    const got = this.ctx.level.getColliders(b.z - reach, b.z + 6, this.cols);
    if (got && got !== this.cols) { this.cols.length = 0; for (let i = 0; i < got.length; i++) this.cols.push(got[i]); }
    if (this.invulnT > 0) cfg.invulnerable = true;
    const n = Math.max(1, Math.ceil((speed * dt) / TUNE.subStep));
    const sdt = dt / n;
    for (let i = 0; i < n; i++) {
      this.W.tOff = -(dt - (i + 1) * sdt);
      if (this.flight) this._flightStep(sdt, cfg, ev);
      else stepBody(b, sdt, this.W, cfg, ev);
      if (ev.hitType) break;
    }
    this.W.tOff = 0;
    return ev;
  }

  _flightStep(dt, cfg, ev) {
    const f = this.flight, b = this.b;
    f.t += dt;
    const py = b.y;
    const px = b.x;
    updateLane(b, dt);
    b.z -= b.speed * dt;
    if (f.kind === 'pogo') {
      const v0 = f.vy;
      f.vy -= f.g * dt;
      b.y += (v0 + f.vy) * 0.5 * dt;
      if (f.vy < 0) f.phase = 'descend';
    } else if (f.phase === 'rise') {
      const u = Math.min(1, f.t / JET_RISE);
      const e = u * u * (3 - 2 * u);
      b.y = f.y0 + (f.alt - f.y0) * e;
      if (u >= 1) f.phase = 'cruise';
    } else if (f.phase === 'cruise') {
      b.y += (f.alt - b.y) * Math.min(1, dt * 5);
    } else {
      f.vy = Math.max(f.vy - DESCENT_ACCEL * dt, -DESCENT_MAX);
      b.y += f.vy * dt;
    }
    b.vy = dt > 0 ? (b.y - py) / dt : 0;
    if (b.y > b.peakY) b.peakY = b.y;
    if (f.phase !== 'descend') return;

    // Descending: never drop into an obstacle face we are about to reach, land on whatever is below.
    const below = this.W.support(b.x, b.z, HW + TUNE.edgeTol, Math.max(py, b.y) + TUNE.landTol);
    const ahead = this._aheadFloor();
    const floor = ahead > below ? ahead : below;
    if (b.y <= floor) {
      if (below >= floor - 1e-3) {
        const kind = f.kind;
        b.y = below;
        this.flight = null;
        b.grounded = true; b.vy = 0; b.jumped = false; b.doubleJumpUsed = false; b.coyoteT = 0; b.airT = 0;
        ev.landed = true;
        ev.fallHeight = Math.max(ev.fallHeight, b.peakY - below);
        ev.flightLanded = kind;
        return;
      }
      b.y = floor;
      if (f.vy < 0) f.vy = 0;
      if (f.kind === 'pogo') f.vy = Math.max(f.vy, -1);
    }
    // Lateral safety while low: steering into a train's side bounces back (no stumble while descending).
    if (b.y < TRAIN.height + 0.4 && px !== b.x) {
      const cols = this.cols;
      for (let i = 0; i < cols.length; i++) {
        const c = cols[i];
        if (c.ramp || b.y >= c.maxY - 0.05 || b.y + 1.7 <= c.minY) continue;
        if (b.z - HD >= c.maxZ || b.z + HD <= c.minZ) continue;
        if (b.x - HW >= c.maxX || b.x + HW <= c.minX) continue;
        if (px + HW <= c.minX + 1e-3 || px - HW >= c.maxX - 1e-3) {
          b.x = px; const back = b.fromLane; b.fromLane = b.lane; b.lane = back; b.laneX0 = px; b.laneT = 0; b.laneDur = PHYS.laneSwitchTime * 1.3;
          ev.bounced = true;
          break;
        }
      }
    }
  }

  /** Highest obstacle top we will reach within the look-ahead window in our footprint (descent floor). */
  _aheadFloor() {
    const b = this.b, cols = this.cols;
    const x0 = b.x - HW - 0.05, x1 = b.x + HW + 0.05;
    let fl = 0;
    for (let i = 0; i < cols.length; i++) {
      const c = cols[i];
      if (c.ramp || x0 >= c.maxX || x1 <= c.minX) continue;
      if (c.minZ >= b.z + HD) continue;                    // behind us
      const gap = (b.z - HD) - c.maxZ;                      // > 0: still ahead
      if (gap > (b.speed + (c.vz || 0)) * FLOOR_LOOKAHEAD + 1) continue;
      const top = c.top === 'walk' ? c.maxY : c.maxY + 0.05;
      if (top > fl) fl = top;
    }
    return fl;
  }

  // -------------------------------------------------------------------------------- death / revive
  die(hit) {
    const b = this.b;
    this.flight = null;
    b.rollAir = false;
    // frontal crash: pop back out of the face so the body doesn't sit inside the obstacle
    if (hit && typeof hit.maxZ === 'number' && b.z > hit.maxZ - 1.2 && b.z - HD < hit.maxZ) b.z = hit.maxZ + HD + 0.02;
    this.knockV = hit && hit.moving ? 5.5 : 2.4;
  }

  /** Death physics in real time: settle onto the surface below and slide back a little. */
  deathUpdate(raw) {
    const b = this.b;
    if (this.knockV > 0) { b.z += this.knockV * raw; this.knockV = Math.max(0, this.knockV - 7 * raw); }
    const s = this.ctx.level.supportHeight(b.x, b.z, HW, b.y + 0.35);
    if (b.y > s + 1e-3 || b.vy > 0) {
      b.grounded = false;
      b.vy -= PHYS.gravity * raw;
      b.y += b.vy * raw;
      if (b.y <= s) { b.y = s; b.vy = 0; b.grounded = true; }
    } else { b.y = s; b.vy = 0; b.grounded = true; }
  }

  revive() {
    const b = this.b;
    this.flight = null;
    this.knockV = 0;
    b.vy = 0; b.rollT = 0; b.rollAir = false; b.jumpBufT = 0; b.coyoteT = 0; b.jumped = false; b.doubleJumpUsed = false;
    b.graceN = 0;
    b.lane = Math.max(-1, Math.min(1, Math.round(b.x / LANE_WIDTH)));
    b.fromLane = b.lane; b.laneX0 = b.x; b.laneT = 0; b.laneDur = 0.25;
    const s = this.ctx.level.supportHeight(b.x, b.z, HW, b.y + PHYS.stepUp);
    if (b.y <= s + 0.02) { b.y = s; b.grounded = true; } else { b.grounded = false; b.peakY = b.y; }
  }

  /** Should a roll end now? (used by the tutorial / autopilot helpers) */
  underOverhang() { return overheadBlocked(this.b, this.W); }
}
