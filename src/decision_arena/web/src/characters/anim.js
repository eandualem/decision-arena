// Procedural poses. Each function fills a pose array (see skeleton.js conventions).
// Poses are authored for a character facing -Z; mirrored limbs use the arm()/thigh() helpers (side +1 = right).
import { J, R, NJ, setJ, addJ, arm, fore, hand, thigh, shin, foot, addArm, addFore, addThigh, addShin, addFoot, zeroPose, lerpPose, newPose } from './skeleton.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => clamp(v, 0, 1);
export const smooth = (a, b, x) => { const t = sat((x - a) / (b - a)); return t * t * (3 - 2 * t); };
const env = (t, a, b, c, d) => smooth(a, b, t) * (1 - smooth(c, d, t)); // rise a..b, fall c..d
const easeOut = (t) => 1 - (1 - t) * (1 - t);

export const PIVOT = 0.9; // default pivot height (body center)

/** Relaxed standing base. */
export function stand(P) {
  zeroPose(P);
  P[R.pivot] = PIVOT;
  arm(P, 1, 0.06, -0.15, 0.13); arm(P, -1, 0.06, -0.15, 0.13);
  fore(P, 1, 0.3); fore(P, -1, 0.3);
  thigh(P, 1, 0, 0, 0.035); thigh(P, -1, 0, 0, 0.035);
  foot(P, 1, 0, 0, -0.035); foot(P, -1, 0, 0, -0.035);
}

// ------------------------------------------------------------------ menu idle
/** c: {lookYaw, lookPitch, tilt} */
export function idle(P, t, c) {
  stand(P);
  const br = Math.sin(t * 1.9);
  const sway = Math.sin(t * 0.6) * 0.8 + Math.sin(t * 0.23) * 0.2;
  P[R.ox] = sway * 0.03;
  P[R.oy] = -0.006 + br * 0.004 - Math.abs(sway) * 0.012;
  const hz = -sway * 0.07;
  setJ(P, J.hips, 0, sway * 0.07, hz);
  setJ(P, J.spine, 0.02 + br * 0.012, -sway * 0.04, -hz * 0.6);
  setJ(P, J.chest, 0.01 + br * 0.018, -sway * 0.02, -hz * 0.3);
  setJ(P, J.neck, 0, c.lookYaw * 0.3, 0);
  setJ(P, J.head, -0.04 - c.lookPitch, c.lookYaw * 0.6, (c.tilt || 0) + sway * 0.05);
  // weight on one leg; the other relaxes with a bent knee (thighs counter the pelvis roll to keep feet planted)
  const kL = Math.max(0, sway), kR = Math.max(0, -sway);
  setJ(P, J.thighL, 0.14 * kL, 0, -hz - 0.05 - kL * 0.04);
  setJ(P, J.shinL, -0.3 * kL, 0, 0);
  setJ(P, J.footL, 0.16 * kL, 0, 0.04);
  setJ(P, J.thighR, 0.14 * kR, 0, -hz + 0.05 + kR * 0.04);
  setJ(P, J.shinR, -0.3 * kR, 0, 0);
  setJ(P, J.footR, 0.16 * kR, 0, -0.04);
  arm(P, 1, 0.06 + br * 0.02, -0.2, 0.14 + br * 0.015 + kR * 0.05); fore(P, 1, 0.35 + br * 0.03);
  arm(P, -1, 0.06 + br * 0.02, -0.2, 0.14 + br * 0.015 + kL * 0.05); fore(P, -1, 0.35 + br * 0.03);
  hand(P, 1, 0.05, 0, -0.1); hand(P, -1, 0.05, 0, -0.1);
}

// ------------------------------------------------------------------ gestures (menu), applied over idle with weight w
export const GESTURES = {
  wave: { dur: 2.0, face: 'happy', fn(P, t, w) {
    const k = w;
    arm(P, 1, lerp(P[J.armR * 3], 0.35, k), -0.3 * k, lerp(P[J.armR * 3 + 2], 2.45, k));
    fore(P, 1, lerp(P[J.foreR * 3], 0.45 + Math.sin(t * 13) * 0.45, k), 0, 0);
    hand(P, 1, 0, 0, Math.sin(t * 13 + 0.6) * 0.3 * k);
    addJ(P, J.head, 0, -0.12 * k, -0.12 * k);
    addJ(P, J.chest, 0, 0, -0.06 * k);
  } },
  stretch: { dur: 2.4, face: 'yawn', fn(P, t, w) {
    const k = w * env(t, 0.1, 0.7, 1.6, 2.2);
    for (const s of [-1, 1]) { arm(P, s, lerp(P[(s > 0 ? J.armR : J.armL) * 3], 0.25, k), 0, lerp(Math.abs(P[(s > 0 ? J.armR : J.armL) * 3 + 2]), 2.85, k)); fore(P, s, lerp(0.3, 0.5, k)); }
    addJ(P, J.spine, -0.1 * k, 0, 0); addJ(P, J.chest, 0.18 * k, 0, 0); addJ(P, J.head, 0.3 * k, 0, 0);
    P[R.oy] += 0.04 * k; addFoot(P, 1, -0.25 * k); addFoot(P, -1, -0.25 * k);
  } },
  shake: { dur: 2.0, face: 'cool', prop: 'can', fn(P, t, w) {
    const k = w;
    arm(P, 1, lerp(P[J.armR * 3], 0.55, k), -0.3 * k, lerp(P[J.armR * 3 + 2], 0.35, k));
    fore(P, 1, lerp(P[J.foreR * 3], 1.75 + Math.sin(t * 26) * 0.35, k));
    hand(P, 1, -0.2 * k, 0, 0);
    addJ(P, J.head, -0.12 * k, -0.25 * k, 0.1 * k);
    addJ(P, J.chest, 0, -0.1 * k, 0);
  } },
  headphones: { dur: 2.6, face: 'happy', fn(P, t, w) {
    const k = w;
    for (const s of [-1, 1]) { arm(P, s, lerp(0.06, 0.55, k), 0.3 * k, lerp(0.14, 1.35, k)); fore(P, s, lerp(0.35, 2.35, k), 0, 0); }
    const beat = Math.sin(t * 9.5);
    addJ(P, J.head, beat * 0.13 * k, 0, Math.sin(t * 4.75) * 0.1 * k);
    addJ(P, J.chest, beat * 0.04 * k, 0, 0);
    P[R.oy] += (Math.abs(beat) - 0.5) * 0.02 * k;
  } },
  rawr: { dur: 1.7, face: 'roar', fn(P, t, w) {
    const k = w * env(t, 0.05, 0.25, 1.3, 1.65);
    for (const s of [-1, 1]) { arm(P, s, lerp(0.06, 1.25, k), 0.4 * k, lerp(0.14, 0.75, k)); fore(P, s, lerp(0.35, 1.1, k)); hand(P, s, -0.9 * k, 0, 0); }
    addJ(P, J.spine, -0.2 * k, 0, 0); addJ(P, J.head, 0.25 * k + Math.sin(t * 30) * 0.03 * k, 0, 0);
    addThigh(P, 1, 0.25 * k, 0, 0.15 * k); addShin(P, 1, -0.3 * k);
    P[R.oy] -= 0.04 * k;
  } },
  dance: { dur: 2.8, face: 'love', fn(P, t, w) {
    const k = w;
    const step = Math.floor(t * 4) % 4;
    const a = [0.9, -0.9, 0.9, -0.9][step], b = [1, 1, -1, -1][step];
    for (const s of [-1, 1]) { arm(P, s, 0.2 * k, 0, lerp(0.14, 1.5, k)); fore(P, s, lerp(0.35, 1.2 + (s * a > 0 ? 0.4 : -0.4), k), 0, 0); }
    addJ(P, J.head, 0, 0, 0.18 * b * k);
    addJ(P, J.chest, 0, 0.12 * a * k, 0);
    P[R.oy] += (step % 2 ? -0.03 : 0) * k;
  } },
  shaka: { dur: 1.8, face: 'wink', fn(P, t, w) {
    const k = w;
    arm(P, 1, lerp(0.06, 0.6, k), -0.4 * k, lerp(0.14, 1.25, k)); fore(P, 1, lerp(0.35, 1.9, k));
    hand(P, 1, 0, 0, Math.sin(t * 16) * 0.35 * k);
    addJ(P, J.head, 0, -0.18 * k, -0.15 * k);
    addJ(P, J.hips, 0, 0, 0.05 * k);
  } },
  float: { dur: 3.0, face: 'happy', fn(P, t, w) {
    const k = w * env(t, 0.1, 0.9, 2.2, 2.95);
    P[R.oy] += 0.22 * k + Math.sin(t * 3) * 0.02 * k;
    P[R.yaw] += Math.sin(t * 1.4) * 0.25 * k;
    for (const s of [-1, 1]) { arm(P, s, 0.3 * k, 0, lerp(0.14, 1.1, k) + Math.sin(t * 2 + s) * 0.1 * k); fore(P, s, 0.4); }
    addThigh(P, 1, 0.3 * k, 0, 0); addShin(P, 1, -0.5 * k); addThigh(P, -1, 0.1 * k, 0, 0); addShin(P, -1, -0.3 * k);
    addFoot(P, 1, -0.3 * k); addFoot(P, -1, -0.3 * k);
  } },
  kick: { dur: 2.0, face: 'cool', fn(P, t, w) {
    const k = w * env(t, 0.05, 0.35, 1.5, 1.95);
    addThigh(P, 1, -0.7 * k, 0, 0.05 * k); addShin(P, 1, -1.2 * k); addFoot(P, 1, -0.4 * k);
    for (const s of [-1, 1]) { arm(P, s, 0.3 * k, 0, lerp(0.14, 1.2, k)); fore(P, s, 0.3); }
    addJ(P, J.spine, -0.25 * k, 0, 0); addJ(P, J.head, 0.2 * k, 0, 0);
    P[R.ox] -= 0.03 * k;
  } },
  spin: { dur: 1.4, face: 'happy', spin: true, fn(P, t, w) {
    const k = w;
    for (const s of [-1, 1]) { arm(P, s, 0.2 * k, 0, lerp(0.14, 1.35, k)); fore(P, s, 0.35); }
    P[R.oy] += Math.sin(Math.PI * sat(t / 1.1)) * 0.12;
  } },
  hop: { dur: 1.4, face: 'excited', fn(P, t, w) {
    const k = w;
    const h = Math.max(0, Math.sin(t * TAU * 1.6));
    P[R.oy] += h * 0.14 * k;
    for (const s of [-1, 1]) { arm(P, s, 0.2 * k, 0, lerp(0.14, 0.9 + h * 0.8, k)); fore(P, s, 0.5); addThigh(P, s, 0.3 * h * k, 0, 0); addShin(P, s, -0.5 * h * k); }
  } },
};
function lerp(a, b, t) { return a + (b - a) * t; }

// ------------------------------------------------------------------ run cycle
/** ph: phase (radians), c: {k: 0..1 intensity by speed, spring: bool} */
export function run(P, ph, c) {
  zeroPose(P);
  P[R.pivot] = PIVOT;
  const k = c.k ?? 0.5;
  const amp = 0.88 + 0.3 * k;
  const s = Math.sin(ph), s2 = Math.cos(2 * ph);
  const bob = c.spring ? 0.07 : 0.042;
  P[R.oy] = -0.03 - bob * s2;
  P[R.pitch] = -0.02 * s2;
  setJ(P, J.hips, 0.02, 0.2 * s, 0.05 * Math.cos(ph));
  setJ(P, J.spine, -0.2 - 0.08 * k - 0.04 * s2, -0.05 * s, -0.03 * Math.cos(ph));
  setJ(P, J.chest, -0.1, -0.33 * s, 0);
  setJ(P, J.neck, 0.08, 0.1 * s, 0);
  setJ(P, J.head, 0.24 + 0.05 * k + 0.03 * s2, 0.05 * s, 0);
  for (const side of [1, -1]) {
    const p = side > 0 ? ph : ph + Math.PI;
    const sp = Math.sin(p);
    const swing = Math.max(0, Math.cos(p + 0.35));
    thigh(P, side, 0.22 + 0.95 * sp * amp, 0, 0.045);
    shin(P, side, -(0.32 + 1.55 * Math.pow(swing, 1.15) * amp));
    foot(P, side, -0.08 + 0.42 * Math.max(0, sp) - 0.35 * swing);
    // arms: opposite phase to the same-side leg
    const a = -0.95 * sp * amp;
    arm(P, side, 0.12 + a, -0.15, 0.2 - 0.12 * Math.max(0, a) + 0.08 * Math.max(0, -a));
    fore(P, side, 1.3 + 0.4 * Math.max(0, a) - 0.15 * Math.max(0, -a));
    hand(P, side, -0.15, 0, -0.1);
  }
}

// ------------------------------------------------------------------ airborne (jump / fall), vy driven
const _A = newPose(), _B = newPose();
/** c: {vy, t (time since takeoff), flail} */
export function air(P, c) {
  const up = clamp(c.vy / 11.6, -1, 1);
  // apex tuck: knees high, arms up and out
  const A = _A; zeroPose(A); A[R.pivot] = PIVOT;
  setJ(A, J.spine, -0.22, 0, 0); setJ(A, J.chest, -0.08, 0, 0); setJ(A, J.head, 0.28, 0, 0);
  thigh(A, 1, 1.6, 0, 0.14); shin(A, 1, -2.1); foot(A, 1, 0.15);
  thigh(A, -1, 1.2, 0, 0.16); shin(A, -1, -2.0); foot(A, -1, -0.05);
  arm(A, 1, 0.35, -0.2, 1.75); fore(A, 1, 0.55); arm(A, -1, 0.2, -0.2, 1.9); fore(A, -1, 0.5);
  A[R.oy] = 0.08;
  const Bp = _B; zeroPose(Bp); Bp[R.pivot] = PIVOT;
  if (up >= 0) {
    // launch: hurdle stretch, one knee driving up, arms thrown up
    setJ(Bp, J.spine, -0.1, 0.12, 0); setJ(Bp, J.chest, 0.05, 0.05, 0); setJ(Bp, J.head, 0.38, 0, 0);
    thigh(Bp, 1, 1.45, 0, 0.06); shin(Bp, 1, -1.65); foot(Bp, 1, 0.25);
    thigh(Bp, -1, -0.5, 0, 0.06); shin(Bp, -1, -0.9); foot(Bp, -1, -0.6);
    arm(Bp, 1, -0.3, 0, 0.9); fore(Bp, 1, 0.8); arm(Bp, -1, 2.55, 0, 0.45); fore(Bp, -1, 0.4);
    Bp[R.pitch] = -0.08;
    lerpPose(P, A, Bp, Math.pow(up, 1.3));
  } else {
    // falling: legs reach down, arms up & out
    const f = -up;
    setJ(Bp, J.spine, -0.08, 0, 0); setJ(Bp, J.chest, 0.05, 0, 0); setJ(Bp, J.head, -0.1, 0, 0);
    thigh(Bp, 1, 0.45, 0, 0.1); shin(Bp, 1, -0.6); foot(Bp, 1, 0.25);
    thigh(Bp, -1, 0.1, 0, 0.12); shin(Bp, -1, -0.35); foot(Bp, -1, 0.15);
    arm(Bp, 1, 0.4, 0, 2.2); fore(Bp, 1, 0.5); arm(Bp, -1, 0.25, 0, 2.35); fore(Bp, -1, 0.4);
    Bp[R.oy] = -0.02;
    lerpPose(P, A, Bp, smooth(0, 0.75, f));
    // arm flail when falling for a while
    const fl = c.flail || 0;
    if (fl > 0) {
      addArm(P, 1, Math.sin(c.t * 17) * 0.35 * fl, 0, Math.cos(c.t * 17) * 0.25 * fl);
      addArm(P, -1, Math.sin(c.t * 17 + 2) * 0.35 * fl, 0, Math.cos(c.t * 17 + 2) * 0.25 * fl);
      addThigh(P, 1, Math.sin(c.t * 12) * 0.3 * fl, 0, 0); addThigh(P, -1, -Math.sin(c.t * 12) * 0.3 * fl, 0, 0);
    }
  }
}

// ------------------------------------------------------------------ roll (curl into a ball; the flip itself is the rig's flip channel)
export const ROLL_PIVOT = 0.66;
export function roll(P, t, dur = 0.62) {
  zeroPose(P);
  const into = smooth(0, 0.07, t);
  const k = into * (1 - smooth(dur - 0.12, dur, t));
  // pivot at the center of the tucked ball (in model space, a bit in front of the hips)
  P[R.pivot] = lerp(PIVOT, ROLL_PIVOT, into);
  P[R.pivotZ] = -0.2 * into;
  P[R.oy] = -0.24 * k;
  P[R.pitch] = -0.35 * k;
  setJ(P, J.hips, -0.2 * k, 0, 0);
  setJ(P, J.spine, -0.42 * k, 0, 0);
  setJ(P, J.chest, -0.32 * k, 0, 0);
  setJ(P, J.neck, -0.2 * k, 0, 0);
  setJ(P, J.head, -0.3 * k, 0, 0);
  for (const s of [-1, 1]) {
    thigh(P, s, 2.25 * k, 0, 0.12 * k); shin(P, s, -2.35 * k); foot(P, s, 0.25 * k);
    arm(P, s, 0.75 * k, 0, 0.32 * k); fore(P, s, 1.85 * k); hand(P, s, 0.2 * k);
  }
  P[R.squash] = 1 - 0.04 * k;
}

// ------------------------------------------------------------------ stumble overlay (weight w, t in 0..~0.6)
export function stumble(P, t, w, side = 1) {
  addJ(P, J.spine, -0.45 * w, 0.15 * side * w, 0.12 * side * w);
  addJ(P, J.chest, -0.15 * w, 0, 0);
  addJ(P, J.head, 0.45 * w, Math.sin(t * 21) * 0.18 * w, Math.sin(t * 17) * 0.12 * w);
  const f = t * 26;
  arm(P, 1, lerp(P[J.armR * 3], 1.7 + Math.sin(f) * 0.9, w), 0, lerp(P[J.armR * 3 + 2], 1.25 + Math.cos(f) * 0.4, w));
  arm(P, -1, lerp(P[J.armL * 3], 1.2 + Math.sin(f + 2.2) * 0.9, w), 0, lerp(-P[J.armL * 3 + 2], 1.45 + Math.cos(f + 2.2) * 0.4, w));
  fore(P, 1, lerp(P[J.foreR * 3], 0.4, w)); fore(P, -1, lerp(P[J.foreL * 3], 0.5, w));
  addThigh(P, side, -0.55 * w, 0, 0); addShin(P, side, -0.7 * w);
  P[R.pitch] += -0.22 * w;
  P[R.oy] -= 0.05 * w;
  P[R.roll] += -0.12 * side * w;
}

// ------------------------------------------------------------------ crash (knocked back and down), held at the end
export function crash(P, t) {
  zeroPose(P);
  const impact = env(t, 0, 0.05, 0.1, 0.22);
  const fall = smooth(0.08, 0.62, t);
  const bounce = t > 0.62 ? Math.max(0, Math.sin((t - 0.62) * 9)) * Math.exp(-(t - 0.62) * 5) : 0;
  const settle = smooth(0.6, 1.1, t);
  P[R.pivot] = lerp(PIVOT, 0.05, smooth(0.05, 0.2, t));
  P[R.pitch] = 1.38 * fall - 0.12 * bounce;
  P[R.oz] = 0.85 * easeOut(sat(t / 0.6));
  P[R.oy] = Math.sin(Math.PI * sat((t - 0.05) / 0.55)) * 0.3 + 0.2 * fall + bounce * 0.06;
  P[R.squash] = 1 - 0.14 * impact;
  setJ(P, J.spine, 0.15 * fall, 0, 0);
  setJ(P, J.chest, 0.1 * fall, 0, 0);
  setJ(P, J.head, 0.45 * impact - 0.25 * fall + Math.sin(t * 3) * 0.12 * settle, Math.sin(t * 2.1) * 0.3 * settle, 0);
  for (const s of [-1, 1]) {
    arm(P, s, lerp(-1.1 * impact, 0.35, fall), 0, lerp(0.6, 1.45 + (s > 0 ? 0.1 : -0.05), fall) + bounce * 0.3);
    fore(P, s, lerp(0.2, 0.55, fall));
    hand(P, s, 0.2 * fall, 0, 0);
    thigh(P, s, lerp(0.3, 0.55 + (s > 0 ? 0.25 : 0), fall) + bounce * 0.3, 0, 0.3 * fall);
    shin(P, s, lerp(-0.2, -0.9 - (s > 0 ? 0.4 : 0), fall));
    foot(P, s, 0.2 * fall);
  }
}

// ------------------------------------------------------------------ caught (grabbed by the guard): arms up, dejected
export function caught(P, t) {
  stand(P);
  const jolt = env(t, 0, 0.08, 0.2, 0.45);
  const hold = smooth(0.15, 0.55, t);
  const sw = Math.sin(t * 2.4) * hold;
  P[R.oy] = 0.1 * jolt + 0.14 * hold + sw * 0.01;
  P[R.roll] = sw * 0.05;
  setJ(P, J.spine, -0.05 * hold, 0, 0);
  setJ(P, J.chest, -0.18 * hold + 0.1 * jolt, 0, 0);
  setJ(P, J.neck, -0.15 * hold, 0, 0);
  setJ(P, J.head, 0.25 * jolt - 0.38 * hold, sw * 0.1, 0.1 * hold);
  for (const s of [-1, 1]) {
    arm(P, s, 0.3, 0.2, lerp(0.14, 2.45, Math.max(jolt, hold)));
    fore(P, s, lerp(0.2, 0.85, hold) + Math.sin(t * 3 + s) * 0.08 * hold);
    hand(P, s, 0.6 * hold, 0, 0);
    thigh(P, s, 0.12 * hold + (s > 0 ? sw : -sw) * 0.1, 0, 0.04);
    shin(P, s, -0.45 * hold);
    foot(P, s, -0.55 * hold);
  }
}

// ------------------------------------------------------------------ celebrate: two hops with fist pumps
export function celebrate(P, t) {
  stand(P);
  const hop = Math.max(0, Math.sin(Math.min(t, 1.55) * TAU * 1.3));
  const k = smooth(0, 0.15, t);
  P[R.oy] = hop * 0.24;
  setJ(P, J.spine, 0.08 * k, 0, 0); setJ(P, J.chest, 0.1 * k, 0, 0); setJ(P, J.head, 0.25 * k, 0, 0);
  for (const s of [-1, 1]) {
    arm(P, s, 0.3 * k, 0.2, lerp(0.14, 2.35, k) - hop * 0.25);
    fore(P, s, lerp(0.3, 0.35 + 0.9 * (1 - hop), k));
    thigh(P, s, hop * 0.6, 0, 0.1); shin(P, s, -hop * 1.0); foot(P, s, -hop * 0.3);
  }
}

// ------------------------------------------------------------------ start flourish: spray a tag, glance back, turn and run
export const START_DUR = 1.0;
export function startPose(P, t, runPose) {
  stand(P);
  const turn = smooth(0, 0.12, t) * (1 - smooth(0.6, 0.82, t));
  const spray = env(t, 0.08, 0.16, 0.5, 0.6);
  const glance = env(t, 0.46, 0.52, 0.62, 0.7);
  P[R.yaw] = -1.45 * turn;
  // spraying arm (right), little tag zig-zag
  const zz = Math.sin(t * 34) * 0.12, zy = Math.cos(t * 17) * 0.1;
  arm(P, 1, lerp(0.06, 1.55 + zz, spray), -0.3 * spray, lerp(0.14, 0.12 + zy, spray));
  fore(P, 1, lerp(0.3, 0.12, spray)); hand(P, 1, -0.5 * spray, 0, 0);
  // left hand on hip
  arm(P, -1, 0.1, 0.5 * turn, lerp(0.14, 0.62, turn)); fore(P, -1, lerp(0.3, 1.5, turn), 0, 0);
  setJ(P, J.spine, 0.04, 0, 0.05 * spray);
  setJ(P, J.neck, 0, -0.45 * glance, 0);
  setJ(P, J.head, 0.1 * spray, -0.8 * glance, -0.1 * spray);
  thigh(P, 1, 0.05, 0, 0.12 * turn); thigh(P, -1, 0.05, 0, 0.12 * turn);
  // take off into the run
  const go = smooth(0.62, 0.95, t);
  if (go > 0 && runPose) lerpPose(P, P, runPose, go);
}

// ------------------------------------------------------------------ revive pop (spin handled by the rig)
export function revive(P, t) {
  stand(P);
  const k = env(t, 0, 0.15, 0.55, 0.8);
  P[R.oy] = Math.sin(Math.PI * sat(t / 0.7)) * 0.3;
  for (const s of [-1, 1]) { arm(P, s, 0.3, 0, lerp(0.14, 2.3, k)); fore(P, s, 0.3); thigh(P, s, 0.4 * k, 0, 0.1); shin(P, s, -0.8 * k); }
  setJ(P, J.head, 0.25 * k, 0, 0);
}

// ------------------------------------------------------------------ hoverboard stance (regular: left foot forward, facing +X)
export const BOARD_YAW = -1.22;
/** c: {t, lean, air (0..1), crouch (0..1), grab} */
export function board(P, c) {
  zeroPose(P);
  P[R.pivot] = PIVOT;
  const t = c.t, L = c.lean || 0, air = c.air || 0, cr = c.crouch || 0;
  const sway = Math.sin(t * 2.1) * 0.5 + Math.sin(t * 0.9) * 0.5;
  P[R.yaw] = BOARD_YAW;
  P[R.oy] = -0.1 - 0.12 * cr - 0.03 * air + sway * 0.008;
  const bend = 1 + 0.35 * air + 0.9 * cr;
  // lean toward the direction of travel (character's left) + carve (knees)
  setJ(P, J.hips, 0.12 * bend, 0.18, 0.05 + L * 0.08);
  setJ(P, J.spine, -0.18 - 0.12 * cr, 0.12, 0.1 + sway * 0.03);
  setJ(P, J.chest, -0.05, 0.25, 0.04);
  setJ(P, J.neck, 0.05, 0.3, -0.05);
  setJ(P, J.head, 0.1 + 0.1 * cr, 0.36, -0.08);
  // wide stance along local X (front foot = left = board nose)
  const kneeF = 0.45 * bend + L * 0.12, kneeB = 0.5 * bend - L * 0.12;
  thigh(P, -1, kneeF, 0.1, 0.32); shin(P, -1, -kneeF * 1.85); foot(P, -1, kneeF * 0.85, 0, -0.3);
  thigh(P, 1, kneeB, -0.1, 0.3); shin(P, 1, -kneeB * 1.85); foot(P, 1, kneeB * 0.85, 0, -0.28);
  // arms out for balance
  arm(P, -1, 0.35 + sway * 0.05, 0.2, 1.05 + sway * 0.1 + L * 0.2); fore(P, -1, 0.35);
  arm(P, 1, 0.1 - sway * 0.05, 0.2, 0.95 - sway * 0.1 - L * 0.2); fore(P, 1, 0.55);
  hand(P, 1, 0, 0, -0.3); hand(P, -1, 0, 0, -0.3);
  if (c.grab > 0) { // one hand grabs the board edge while airborne
    const g = c.grab;
    arm(P, 1, lerp(P[J.armR * 3], 0.9, g), 0, lerp(P[J.armR * 3 + 2], 0.25, g)); fore(P, 1, lerp(0.55, 0.3, g));
    addJ(P, J.spine, -0.3 * g, 0, -0.1 * g);
  }
  if (cr > 0) { arm(P, 1, lerp(P[J.armR * 3], 0.8, cr), 0, lerp(P[J.armR * 3 + 2], 0.35, cr)); }
}

// ------------------------------------------------------------------ jetpack flight
export const FLY_PITCH = -1.12;
export function fly(P, t, c) {
  zeroPose(P);
  P[R.pivot] = PIVOT;
  const w = Math.sin(t * 2.3);
  P[R.pitch] = FLY_PITCH + w * 0.04 + (c.boost || 0) * -0.15;
  P[R.oy] = Math.sin(t * 3.1) * 0.04;
  setJ(P, J.spine, 0.08, 0, w * 0.03);
  setJ(P, J.chest, 0.06, 0, 0);
  setJ(P, J.neck, 0.35, 0, 0);
  setJ(P, J.head, 0.55, Math.sin(t * 0.8) * 0.1, 0);
  const kick = Math.sin(t * 5);
  thigh(P, 1, -0.12 + kick * 0.08, 0, 0.08); shin(P, 1, -0.45 - kick * 0.12); foot(P, 1, -0.75);
  thigh(P, -1, -0.02 - kick * 0.08, 0, 0.1); shin(P, -1, -0.65 + kick * 0.12); foot(P, -1, -0.7);
  // arms reaching forward (overhead in body space), a little staggered
  arm(P, 1, 2.75 + w * 0.05, -0.2, 0.22); fore(P, 1, 0.15); hand(P, 1, 0.3);
  arm(P, -1, 2.5 - w * 0.05, -0.2, 0.3); fore(P, -1, 0.35); hand(P, -1, 0.3);
}

// ------------------------------------------------------------------ pogo: feet on the pegs, hands on the handlebar
export const POGO_LIFT = 0.36;
export function pogo(P, t, c) {
  zeroPose(P);
  P[R.pivot] = PIVOT;
  const up = clamp((c.vy || 0) / 14, -1, 1);
  const comp = c.compress || 0;      // 0..1 spring compression (landing / launch)
  const bend = 0.35 + 0.35 * Math.max(0, -up) + 0.7 * comp - 0.25 * Math.max(0, up);
  P[R.oy] = -0.08 * bend;
  setJ(P, J.spine, -0.12 - 0.1 * bend, 0, 0);
  setJ(P, J.chest, -0.05, 0, 0);
  setJ(P, J.head, 0.2 + 0.15 * Math.max(0, up) - 0.2 * Math.max(0, -up), 0, 0);
  for (const s of [-1, 1]) {
    thigh(P, s, 0.45 * bend + 0.05, 0, 0.1); shin(P, s, -0.95 * bend); foot(P, s, 0.5 * bend - 0.15 * Math.max(0, up), 0, -0.1);
    arm(P, s, 0.62 + 0.12 * bend, -0.25, 0.22); fore(P, s, 0.95 - 0.1 * bend); hand(P, s, -0.35);
  }
}

// ------------------------------------------------------------------ land overlay (squash), w fades 1 -> 0
export function land(P, w) {
  P[R.squash] *= 1 - 0.16 * w;
  P[R.oy] -= 0.1 * w;
  for (const s of [-1, 1]) { addThigh(P, s, 0.55 * w, 0, 0); addShin(P, s, -0.95 * w); addFoot(P, s, 0.35 * w); addArm(P, s, -0.1 * w, 0, 0.35 * w); }
  addJ(P, J.spine, -0.22 * w, 0, 0);
  addJ(P, J.head, 0.15 * w, 0, 0);
}

// ------------------------------------------------------------------ magnet arm (right arm holds the magnet up front)
export function magnetArm(P, t) {
  arm(P, 1, 1.75 + Math.sin(t * 7) * 0.04, 0.1, 0.18);
  fore(P, 1, 0.35);
  hand(P, 1, -0.2, 0, 0);
}

// ------------------------------------------------------------------ portrait / showcase pose
export function hero(P, t = 0) {
  stand(P);
  setJ(P, J.hips, 0, -0.06, 0.05);
  setJ(P, J.spine, 0.03, 0.05, -0.04);
  setJ(P, J.chest, 0.02, 0.06, -0.02);
  setJ(P, J.head, 0.02, -0.08, 0.1);
  // right hand on hip, left arm relaxed with a little wave-ready bend
  arm(P, 1, 0.12, 0.55, 0.62); fore(P, 1, 1.55); hand(P, 1, 0, 0, 0.2);
  arm(P, -1, 0.15, -0.2, 0.2); fore(P, -1, 0.45);
  setJ(P, J.thighL, 0.08, 0, -0.12); setJ(P, J.shinL, -0.14, 0, 0); setJ(P, J.footL, 0.06, 0, 0.1);
  setJ(P, J.thighR, 0.0, 0, 0.1); setJ(P, J.footR, 0, 0, -0.1);
  P[R.ox] = -0.01;
}
