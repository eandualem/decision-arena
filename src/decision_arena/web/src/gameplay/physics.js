// Rail Dash gameplay physics (GAMEPLAY module).
// A small, deterministic, allocation-free body stepper. The live controller (player.js) and the autopilot's
// look-ahead planner (autopilot.js) run exactly the same code, so the bot's predictions match what happens.
//
// World interface W = { cols, tOff, support(x, z, hw, maxTop) }
//   cols : colliders (CONTRACTS.md 6.2 shape). Moving colliders are offset by vz * tOff in z.
//   tOff : time offset of this sub-step relative to the moment `cols` describe (live game: -dt..0, planner: 0..H)
//   support : highest walkable top <= maxTop under the footprint (live game: level.supportHeight)
import { PLAYER, PHYS, TRAIN, LANE_WIDTH } from '../config.js';

export const TUNE = {
  footLift: 0.04,       // the collision box starts this far above the feet (standing on a surface is not an overlap)
  snapDown: 0.14,       // grounded: stick to surfaces that drop by up to this much, else start falling
  landTol: 0.32,        // airborne: may land on tops up to this much above the feet (step-down tolerance)
  edgeTol: 0.1,         // extra footprint half-width when landing (roof edge forgiveness)
  stepUpFront: 0.62,    // frontal contact with a walkable top within this of the feet => step up (no crash)
  clipTop: 0.2,         // frontal contact with a barrier top within this of the feet => graze, forgiven
  clipHead: 0.14,       // frontal contact with an overhead barrier's underside within this of the head => forgiven
  clipX: 0.3,           // frontal contact overlapping less than this in x while switching away => slip past the corner
  clipRear: 0.45,       // side contact with only the last part of an obstacle => slip past its tail
  subStep: 0.34,        // max forward travel per physics sub-step (thin barriers can't be tunnelled)
  gapBridge: 3.2,       // run straight across gaps up to this long between roofs of the same height
  rampBoost: 0.35,      // jumping on a ramp adds this fraction of the ramp's climb rate...
  rampBoostMax: 3,      // ...capped (m/s), so ramp jumps feel springy without launching into orbit
  glideGravity: 0.32,   // 'glide' board: gravity factor while falling
  glideTerminal: -8.5,  // 'glide' board: max fall speed (unless fast-falling)
};

export const HW = PLAYER.halfWidth;
export const HD = PLAYER.halfDepth;
const RAMP_SLOPE = TRAIN.height / TRAIN.rampLength;
const GRACE_MAX = 6;

export function rampHeightAt(ramp, z) {
  const span = ramp.zLow - ramp.zHigh;
  if (!(span > 0)) return ramp.h;
  const t = (ramp.zLow - z) / span;
  return ramp.h * (t <= 0 ? 0 : t >= 1 ? 1 : t);
}

export function createBody() {
  return {
    x: 0, y: 0, z: 0, speed: 0,
    lane: 0, fromLane: 0, laneX0: 0, laneT: 1, laneDur: PHYS.laneSwitchTime, vx: 0,
    vy: 0, grounded: true, airT: 0, peakY: 0,
    rollT: 0, rollAir: false,
    coyoteT: 0, jumpBufT: 0, jumped: false, doubleJumpUsed: false,
    graceN: 0, grace: new Array(GRACE_MAX).fill(0), graceSeen: new Uint8Array(GRACE_MAX),
  };
}

export function resetBody(b, z = 0, lane = 0) {
  b.x = lane * LANE_WIDTH; b.y = 0; b.z = z; b.speed = 0;
  b.lane = lane; b.fromLane = lane; b.laneX0 = b.x; b.laneT = 1; b.laneDur = PHYS.laneSwitchTime; b.vx = 0;
  b.vy = 0; b.grounded = true; b.airT = 0; b.peakY = 0;
  b.rollT = 0; b.rollAir = false;
  b.coyoteT = 0; b.jumpBufT = 0; b.jumped = false; b.doubleJumpUsed = false;
  b.graceN = 0;
  return b;
}

export function copyBody(d, s) {
  d.x = s.x; d.y = s.y; d.z = s.z; d.speed = s.speed;
  d.lane = s.lane; d.fromLane = s.fromLane; d.laneX0 = s.laneX0; d.laneT = s.laneT; d.laneDur = s.laneDur; d.vx = s.vx;
  d.vy = s.vy; d.grounded = s.grounded; d.airT = s.airT; d.peakY = s.peakY;
  d.rollT = s.rollT; d.rollAir = s.rollAir;
  d.coyoteT = s.coyoteT; d.jumpBufT = s.jumpBufT; d.jumped = s.jumped; d.doubleJumpUsed = s.doubleJumpUsed;
  d.graceN = s.graceN;
  for (let i = 0; i < s.graceN; i++) { d.grace[i] = s.grace[i]; d.graceSeen[i] = s.graceSeen[i]; }
  return d;
}

export function createCfg() {
  return { jumpV: PHYS.jumpVelocity, doubleJump: false, glide: false, zap: false, invulnerable: false, strict: false, inflateZ: 0 };
}

export function createEvents() {
  return { landed: false, fallHeight: 0, impactVy: 0, stepUp: false, jumped: false, bounced: false, hitType: null, hit: null, hitSide: 0 };
}
export function clearEvents(ev) {
  ev.landed = false; ev.fallHeight = 0; ev.impactVy = 0; ev.stepUp = false; ev.jumped = false; ev.bounced = false;
  ev.hitType = null; ev.hit = null; ev.hitSide = 0;
  return ev;
}

/** Walkable support computed from a collider list (planner); mirrors level.supportHeight. */
export function supportFromCols(cols, tOff, x, z, hw, maxTop) {
  let best = 0;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.top !== 'walk' || x + hw <= c.minX || x - hw >= c.maxX) continue;
    const zz = c.vz ? z - c.vz * tOff : z;
    if (zz < c.minZ || zz > c.maxZ) continue;
    const h = c.ramp ? rampHeightAt(c.ramp, zz) : c.maxY;
    if (h <= maxTop && h > best) best = h;
  }
  return best;
}

// ------------------------------------------------------------------------------------------ grace list
// Colliders we decided to forgive (grazed a corner, landed on a barrier top, invulnerable pass...) are ignored
// until the player stops overlapping them.
function inGrace(b, id) {
  for (let i = 0; i < b.graceN; i++) if (b.grace[i] === id) { b.graceSeen[i] = 1; return true; }
  return false;
}
export function addGrace(b, id) {
  if (inGrace(b, id)) return;
  if (b.graceN >= GRACE_MAX) { for (let i = 1; i < GRACE_MAX; i++) { b.grace[i - 1] = b.grace[i]; b.graceSeen[i - 1] = b.graceSeen[i]; } b.graceN--; }
  b.grace[b.graceN] = id; b.graceSeen[b.graceN] = 1; b.graceN++;
}
function purgeGrace(b) {
  let j = 0;
  for (let i = 0; i < b.graceN; i++) if (b.graceSeen[i]) { b.grace[j] = b.grace[i]; b.graceSeen[j] = 0; j++; }
  b.graceN = j;
}

// ------------------------------------------------------------------------------------------ actions
/** Start a lane change (dir -1 | 1). Retargets immediately, so quick consecutive swipes chain two lanes. */
export function laneChange(b, dir, zap = false) {
  const to = b.lane + dir;
  if (to < -1 || to > 1) return false;
  b.fromLane = b.lane;
  b.lane = to;
  b.laneX0 = b.x;
  b.laneT = 0;
  const dist = Math.abs(to * LANE_WIDTH - b.x);
  b.laneDur = zap ? 0.035 : PHYS.laneSwitchTime * Math.min(1.7, Math.max(0.5, dist / LANE_WIDTH));
  return true;
}

export function updateLane(b, dt) {
  const tx = b.lane * LANE_WIDTH;
  if (b.laneT < 1) {
    b.laneT = Math.min(1, b.laneT + dt / b.laneDur);
    const u = 1 - b.laneT;
    const nx = b.laneX0 + (tx - b.laneX0) * (1 - u * u * u);   // ease-out cubic: snappy start, soft arrival
    if (dt > 0) b.vx = (nx - b.x) / dt;
    b.x = nx;
  } else { b.vx = 0; b.x = tx; }
}

/** True when standing up here would put the head into an overhead obstacle (e.g. a roll barrier). */
export function overheadBlocked(b, W) {
  const cols = W.cols, x0 = b.x - HW, x1 = b.x + HW;
  const yLo = b.y + PLAYER.rollHeight - 0.05, yHi = b.y + PLAYER.height;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    if (c.ramp || c.minY < yLo || c.minY >= yHi || x0 >= c.maxX || x1 <= c.minX) continue;
    const dz = c.vz ? c.vz * W.tOff : 0;
    if (b.z - HD - 0.2 >= c.maxZ + dz || b.z + HD <= c.minZ + dz) continue;
    return true;
  }
  return false;
}

function onRamp(b, W) {
  if (!b.grounded || b.y < 0.02 || b.y > TRAIN.height - 0.02) return false;
  return W.support(b.x, b.z - 0.4, HW, b.y + 0.6) > b.y + 0.05;
}

export function doJump(b, v, rampBoost = 0) {
  b.vy = v + rampBoost;
  b.grounded = false; b.coyoteT = 0; b.jumped = true; b.airT = 0; b.peakY = b.y; b.jumpBufT = 0;
  b.rollT = 0; b.rollAir = false;
}

/** Jump request. Returns 'jump' | 'double' | 'buffered' | null. */
export function tryJump(b, W, cfg) {
  if (b.grounded || b.coyoteT > 0) {
    if (b.rollT > 0 && overheadBlocked(b, W)) { b.jumpBufT = PHYS.jumpBuffer + 0.3; return 'buffered'; }
    doJump(b, cfg.jumpV, onRamp(b, W) ? Math.min(TUNE.rampBoostMax, RAMP_SLOPE * b.speed * TUNE.rampBoost) : 0);
    return 'jump';
  }
  if (cfg.doubleJump && !b.doubleJumpUsed) {
    b.doubleJumpUsed = true;
    doJump(b, cfg.jumpV * 0.92);
    b.doubleJumpUsed = true;
    return 'double';
  }
  b.jumpBufT = PHYS.jumpBuffer;
  return 'buffered';
}

/** Roll request. Grounded: roll. Airborne: fast-fall, roll on landing. Returns 'roll' | 'air'. */
export function tryRoll(b) {
  b.jumpBufT = 0;
  if (b.grounded) { b.rollT = PHYS.rollDuration; b.rollAir = false; return 'roll'; }
  if (b.vy > PHYS.fastFallVelocity) b.vy = PHYS.fastFallVelocity;
  b.rollAir = true; b.rollT = PHYS.rollDuration;
  return 'air';
}

// ------------------------------------------------------------------------------------------ step
/** Advance the body by dt (one sub-step; callers split frames with TUNE.subStep). Fills ev. */
export function stepBody(b, dt, W, cfg, ev) {
  const px = b.x, py = b.y, pz = b.z;
  const ph = b.rollT > 0 ? PLAYER.rollHeight : PLAYER.height;
  if (b.coyoteT > 0) b.coyoteT = Math.max(0, b.coyoteT - dt);
  if (b.jumpBufT > 0) b.jumpBufT = Math.max(0, b.jumpBufT - dt);
  if (b.rollT > 0 && !b.rollAir) {
    b.rollT -= dt;
    if (b.rollT <= 0) b.rollT = overheadBlocked(b, W) ? 0.04 : 0;   // keep ducking while under an overhang
  }
  if (b.jumpBufT > 0 && (b.grounded || b.coyoteT > 0) && !(b.rollT > 0 && overheadBlocked(b, W))) {
    doJump(b, cfg.jumpV, onRamp(b, W) ? Math.min(TUNE.rampBoostMax, RAMP_SLOPE * b.speed * TUNE.rampBoost) : 0);
    ev.jumped = true;
  }
  updateLane(b, dt);
  b.z -= b.speed * dt;
  verticalStep(b, dt, W, cfg, ev, py);
  collideStep(b, dt, W, cfg, ev, px, py, pz, ph);
}

function land(b, s, ev) {
  ev.landed = true;
  const fh = b.peakY - s;
  if (fh > ev.fallHeight) ev.fallHeight = fh;
  if (b.vy < ev.impactVy) ev.impactVy = b.vy;
  b.y = s; b.vy = 0; b.grounded = true; b.jumped = false; b.doubleJumpUsed = false; b.coyoteT = 0; b.airT = 0;
  if (b.rollAir) { b.rollAir = false; b.rollT = PHYS.rollDuration; }
}

function verticalStep(b, dt, W, cfg, ev, py) {
  if (b.grounded) {
    const s = W.support(b.x, b.z, HW, b.y + PHYS.stepUp);
    if (s >= b.y - TUNE.snapDown) { b.y = s; b.vy = 0; return; }
    // a short gap to another roof at the same height: run across it instead of dropping into it
    if (b.y > 0.5 && W.support(b.x, b.z - TUNE.gapBridge, HW, b.y + 0.05) >= b.y - 0.05) { b.vy = 0; return; }
    // walked off an edge
    b.grounded = false; b.vy = 0; b.airT = 0; b.peakY = b.y;
    b.coyoteT = b.jumped ? 0 : PHYS.coyoteTime;
  }
  let g = PHYS.gravity;
  const gliding = cfg.glide && !b.rollAir;
  if (gliding && b.vy < 0) g *= TUNE.glideGravity;
  const v0 = b.vy;
  let v1 = v0 - g * dt;
  if (gliding && v1 < TUNE.glideTerminal) v1 = Math.max(Math.min(v0, TUNE.glideTerminal), v1 + (TUNE.glideTerminal - v1) * 0.5);
  b.vy = v1;
  b.y += (v0 + v1) * 0.5 * dt;
  b.airT += dt;
  if (b.y > b.peakY) b.peakY = b.y;
  const s = W.support(b.x, b.z, HW + TUNE.edgeTol, (py > b.y ? py : b.y) + TUNE.landTol);
  if (b.y <= s) land(b, s, ev);
}

function frac(g0, g1) { const d = g0 - g1; return d > 1e-9 ? g0 / d : 1; }

function stepOnto(b, top, ev) {
  if (b.grounded) { b.y = top; b.vy = 0; } else land(b, top, ev);
  ev.stepUp = true;
}

/** Invulnerable frontal hit on a walkable obstacle: hop up its face onto the roof instead of ghosting through. */
function vault(b, c) {
  const need = c.maxY + 0.35 - b.y;
  if (need <= 0) return;
  const v = Math.sqrt(2 * PHYS.gravity * need);
  if (b.vy < v) b.vy = v;
  b.grounded = false; b.jumped = true; b.coyoteT = 0; b.peakY = b.y; b.rollT = 0; b.rollAir = false;
}

/** Side hit: bounce back to the lane we came from. Returns true when it counts as a stumble. */
function sideHit(b, c, cfg, ev, px, side) {
  const lane = c.lane != null ? c.lane : Math.round((c.minX + c.maxX) * 0.5 / LANE_WIDTH);
  let back = lane - side;
  if (back < -1 || back > 1 || back === lane) back = b.fromLane;
  b.x = px; b.fromLane = b.lane; b.lane = back; b.laneX0 = px; b.laneT = 0; b.laneDur = PHYS.laneSwitchTime * 1.3; b.vx = 0;
  if (cfg.invulnerable || cfg.zap) { ev.bounced = true; ev.hitSide = side; return false; }
  ev.hitType = 'stumble'; ev.hit = c; ev.hitSide = side;
  return true;
}

function collideStep(b, dt, W, cfg, ev, px, py, pz, ph) {
  const cols = W.cols;
  const hd = HD + cfg.inflateZ;
  const lift = TUNE.footLift;
  const strict = cfg.strict;
  const clipTop = strict ? -0.08 : TUNE.clipTop;
  const clipHead = strict ? -0.06 : TUNE.clipHead;
  const stepFront = strict ? PHYS.stepUp - 0.05 : TUNE.stepUpFront;
  const clipX = strict ? 0 : TUNE.clipX;
  const clipRear = strict ? 0 : TUNE.clipRear;
  const pz0 = pz - hd, pz1 = pz + hd;
  let h = b.rollT > 0 ? PLAYER.rollHeight : PLAYER.height;
  let x0 = b.x - HW, x1 = b.x + HW, y0 = b.y + lift, y1 = b.y + h;
  const z0 = b.z - hd, z1 = b.z + hd;
  for (let i = 0; i < cols.length; i++) {
    const c = cols[i];
    const dz = c.vz ? c.vz * W.tOff : 0;
    const cz0 = c.minZ + dz, cz1 = c.maxZ + dz;
    if (z0 >= cz1 || z1 <= cz0 || x0 >= c.maxX || x1 <= c.minX) continue;

    if (c.ramp) {
      const rh = rampHeightAt(c.ramp, b.z);
      if (b.y + PHYS.stepUp >= rh) continue;            // walkable here: support handles it
      if (inGrace(b, c.id)) continue;
      const fromSide = px + HW <= c.minX + 1e-3 || px - HW >= c.maxX - 1e-3;
      if (fromSide) {
        if (z1 - cz0 < clipRear) { addGrace(b, c.id); continue; }
        const side = px < (c.minX + c.maxX) * 0.5 ? 1 : -1;
        if (sideHit(b, c, cfg, ev, px, side)) break;
      } else {
        // below the ramp surface without coming from the side (e.g. dropped onto it): lift onto the slope
        stepOnto(b, rh, ev);
      }
      x0 = b.x - HW; x1 = b.x + HW; y0 = b.y + lift; y1 = b.y + h;
      continue;
    }

    if (y0 >= c.maxY || y1 <= c.minY) continue;
    if (inGrace(b, c.id)) continue;

    // Which face did we come through? The axis whose gap closed last during this step decides.
    const pdz = c.vz ? c.vz * (W.tOff - dt) : 0;
    const pcz0 = c.minZ + pdz, pcz1 = c.maxZ + pdz;
    let contact = 0, best = -1, side = 0, g0, f;
    g0 = py + lift - c.maxY; if (g0 >= -1e-3) { f = frac(g0, y0 - c.maxY); if (f > best) { best = f; contact = 1; } }
    g0 = c.minY - (py + ph); if (g0 >= -1e-3) { f = frac(g0, c.minY - y1); if (f > best) { best = f; contact = 2; } }
    g0 = pz0 - pcz1; if (g0 >= -1e-3) { f = frac(g0, z0 - cz1); if (f > best) { best = f; contact = 3; } }
    g0 = pcz0 - pz1; if (g0 >= -1e-3) { f = frac(g0, cz0 - z1); if (f > best) { best = f; contact = 5; } }
    g0 = c.minX - (px + HW); if (g0 >= -1e-3) { f = frac(g0, c.minX - x1); if (f > best) { best = f; contact = 4; side = 1; } }
    g0 = (px - HW) - c.maxX; if (g0 >= -1e-3) { f = frac(g0, x0 - c.maxX); if (f > best) { best = f; contact = 4; side = -1; } }

    if (contact === 1) {                       // from above: land on walkable tops, glide over barrier tops
      if (c.top === 'walk') stepOnto(b, c.maxY, ev); else addGrace(b, c.id);
    } else if (contact === 2) {                // head rose into an overhang: duck instead
      b.rollT = Math.max(b.rollT, 0.06);
      if (!b.grounded && b.vy > 0) { b.vy = 0; b.y = py; }
      h = PLAYER.rollHeight;
      addGrace(b, c.id);
    } else if (contact === 3) {                // frontal
      if (c.top === 'walk' && b.y + stepFront >= c.maxY) { stepOnto(b, c.maxY, ev); }
      else if (c.top !== 'walk' && y0 >= c.maxY - clipTop) addGrace(b, c.id);
      else if (c.minY > 0.3 && y1 <= c.minY + clipHead) addGrace(b, c.id);
      else {
        const ox = Math.min(x1, c.maxX) - Math.max(x0, c.minX);
        if (ox < clipX && b.laneT < 1) {
          const cx = (c.minX + c.maxX) * 0.5;
          if ((b.lane * LANE_WIDTH - b.x) * (b.x - cx) > 0) addGrace(b, c.id);          // switching away: slip past
          else if (sideHit(b, c, cfg, ev, px, b.x < cx ? 1 : -1)) break;                // switching into it: bump
        } else if (cfg.invulnerable) {
          if (c.top === 'walk') vault(b, c);
          addGrace(b, c.id);
        } else {
          ev.hitType = 'crash'; ev.hit = c; ev.hitSide = 0;
          break;
        }
      }
    } else if (contact === 4) {                // side
      if (c.top === 'walk' && b.y + PHYS.stepUp >= c.maxY) stepOnto(b, c.maxY, ev);
      else if (c.top !== 'walk' && y0 >= c.maxY - clipTop) addGrace(b, c.id);
      else if (c.minY > 0.3 && y1 <= c.minY + clipHead) addGrace(b, c.id);
      else if (z1 - cz0 < clipRear) addGrace(b, c.id);
      else if (sideHit(b, c, cfg, ev, px, side)) break;
    } else {                                   // was already inside / overtaken from behind: never punish
      addGrace(b, c.id);
    }
    x0 = b.x - HW; x1 = b.x + HW; y0 = b.y + lift; y1 = b.y + h;
  }
  purgeGrace(b);
}

/** Player AABB (CONTRACTS.md collect box) written into `out`. */
export function bodyBox(b, out) {
  const h = b.rollT > 0 ? PLAYER.rollHeight : PLAYER.height;
  out.minX = b.x - HW; out.maxX = b.x + HW;
  out.minY = b.y; out.maxY = b.y + h;
  out.minZ = b.z - HD; out.maxZ = b.z + HD;
  return out;
}
