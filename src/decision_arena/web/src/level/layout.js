// Shared gameplay-geometry helpers for the LEVEL module. Pure JS (no THREE, no DOM) so the generator,
// the reachability validator (node) and the runtime Level all agree on the exact same numbers.
//
// "d-space": the generator and the simulator work with d = distance ahead of the start line (d = -z).
// An obstacle occupies [dNear, dFar] (dNear < dFar): dNear is the end the runner reaches first (world maxZ).
import { TRAIN, BARRIER, PHYS, PLAYER, SPEED, LANE_WIDTH } from '../config.js';

export const CAR = TRAIN.carLength;
export const CAR_GAP = TRAIN.carGap;
export const RAMP = TRAIN.rampLength;
export const ROOF = TRAIN.height;
export const TRAIN_W = TRAIN.width;
export const BARRIER_W = BARRIER.width;
export const BUMPER_DEPTH = 1.2;
export const RAMP_W = 2.2;

export const trainLen = (cars) => cars * CAR + (cars - 1) * CAR_GAP;
export const laneX = (lane) => lane * LANE_WIDTH;

/** Solid vertical extent + depth of each non-train obstacle kind. */
export const OBSTACLE = {
  barrierJump: { minY: 0, maxY: BARRIER.jumpHeight, depth: BARRIER.depth, width: BARRIER_W },
  barrierRoll: { minY: BARRIER.rollClear, maxY: BARRIER.rollTop, depth: BARRIER.depth, width: BARRIER_W },
  bumper: { minY: 0, maxY: BARRIER.bumperHeight, depth: BUMPER_DEPTH, width: BARRIER_W },
};

// Coins / pickups
export const COIN_Y = 0.9;          // coin center above the surface the runner stands on
export const COIN_LOW_Y = 0.45;     // under roll barriers
export const COIN_SPACING = 2.1;
export const PICKUP_Y = 1.05;

// Moving trains become active (spawned) when their near end is this far ahead of the runner.
export const MOVING_SPAWN_AHEAD = 132;
// TRAIN_APPROACH is emitted when the near end is within this distance.
export const APPROACH_DIST = 120;
// Lane stays clear this far behind a moving train's meeting point (the train keeps going after it).
export const MOVING_CLEAR_BEHIND = 9;

export const JUMP_APEX_T = PHYS.jumpVelocity / PHYS.gravity;          // 0.305 s
export const JUMP_AIR_T = 2 * JUMP_APEX_T;                            // 0.61 s

/** Nominal run speed (m/s) when the runner has covered distance d (no headstart, no board boost). */
export function nominalSpeedAt(d) {
  const s0 = SPEED.start, sm = SPEED.max, T = SPEED.rampSeconds;
  if (d <= 0) return s0;
  let t = d / s0;
  for (let i = 0; i < 30; i++) {
    const e = Math.exp(-t / T);
    const f = sm * t - (sm - s0) * T * (1 - e) - d;
    const fp = sm - (sm - s0) * e;
    t -= f / fp;
    if (Math.abs(f) < 1e-4) break;
  }
  return s0 + (sm - s0) * (1 - Math.exp(-t / T));
}

/** Difficulty tier from distance: 0 easy (0-400), 1 medium (400-1500), 2 hard (1500-3500), 3 expert (3500+). */
export function tierAt(d) {
  return d < 400 ? 0 : d < 1500 ? 1 : d < 3500 ? 2 : 3;
}
export const TIER_NAMES = ['easy', 'medium', 'hard', 'expert'];

/**
 * Speed a moving train should have right now so that its near end meets the runner exactly at dMeet.
 * (Self-correcting: if the runner speeds up or slows down, the train adapts so the designed encounter,
 * with its clear lane and free escape lanes, still happens where the pattern put it.)
 * d-space: runner at pd moving +d at speed v; train near end at dN moving -d.
 */
export function movingTrainSpeed(dN, dMeet, pd, v, vDesign) {
  const remain = dMeet - pd;
  if (remain < 1.5 || v <= 0.5) return vDesign;         // met already (or frozen): keep the cruise speed
  const want = (dN - dMeet) / (remain / v);
  return Math.min(vDesign * 1.6, Math.max(vDesign * 0.55, want));
}

export { PHYS, PLAYER, TRAIN, BARRIER, LANE_WIDTH };
