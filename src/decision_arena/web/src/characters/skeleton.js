// Joint hierarchy + pose arrays for all humanoids (players and the guard).
//
// Conventions (character faces -Z, right = +X, up = +Y; bones have identity rest orientation):
//   thigh/arm  rot.x > 0 : limb swings FORWARD        shin rot.x < 0 : knee bends (heel goes back)
//   fore       rot.x > 0 : elbow bends forward        foot rot.x > 0 : toes up
//   arm/thigh  rot.z     : raise sideways (right side +, left side -)   use limb() helpers for mirrored sides
//   spine/chest/head rot.x < 0 : lean / look down (forward); rot.y > 0 : turn to the character's LEFT
//   rot.z > 0 on spine/head: tilt toward the character's LEFT
// A pose is a Float32Array: 3 Euler angles per joint, then root channels (see R).
import * as THREE from 'three';

export const JOINTS = [
  { name: 'hips', parent: -1, order: 'YXZ' },
  { name: 'spine', parent: 0, order: 'YXZ' },
  { name: 'chest', parent: 1, order: 'YXZ' },
  { name: 'neck', parent: 2, order: 'YXZ' },
  { name: 'head', parent: 3, order: 'YXZ' },
  { name: 'armL', parent: 2, order: 'ZXY' },
  { name: 'foreL', parent: 5, order: 'ZXY' },
  { name: 'handL', parent: 6, order: 'ZXY' },
  { name: 'armR', parent: 2, order: 'ZXY' },
  { name: 'foreR', parent: 8, order: 'ZXY' },
  { name: 'handR', parent: 9, order: 'ZXY' },
  { name: 'thighL', parent: 0, order: 'ZXY' },
  { name: 'shinL', parent: 11, order: 'ZXY' },
  { name: 'footL', parent: 12, order: 'ZXY' },
  { name: 'thighR', parent: 0, order: 'ZXY' },
  { name: 'shinR', parent: 14, order: 'ZXY' },
  { name: 'footR', parent: 15, order: 'ZXY' },
];
export const J = Object.fromEntries(JOINTS.map((j, i) => [j.name, i]));
export const NJ = JOINTS.length;

// root channels (after the joints)
const B = NJ * 3;
export const R = { ox: B, oy: B + 1, oz: B + 2, pitch: B + 3, yaw: B + 4, roll: B + 5, pivot: B + 6, squash: B + 7, pivotZ: B + 8 };
export const POSE_SIZE = B + 9;

/** Default kid proportions (meters). Characters override a few of these. */
export const BODY = {
  hipY: 0.64, hipX: 0.1, hipDrop: 0.04, thigh: 0.26, shin: 0.24,
  spine: 0.08, chest: 0.14, neck: 0.16, headUp: 0.05,
  shoulderX: 0.23, shoulderY: 0.11, upperArm: 0.2, forearm: 0.18,
  headR: 0.3,
};

/** Model-space rest positions (Vector3) of every joint for body proportions `b`. */
export function restPositions(b) {
  const p = new Array(NJ);
  const v = (x, y, z) => new THREE.Vector3(x, y, z);
  p[J.hips] = v(0, b.hipY, 0);
  p[J.spine] = p[J.hips].clone().add(v(0, b.spine, 0));
  p[J.chest] = p[J.spine].clone().add(v(0, b.chest, 0));
  p[J.neck] = p[J.chest].clone().add(v(0, b.neck, 0));
  p[J.head] = p[J.neck].clone().add(v(0, b.headUp, 0));
  for (const [s, arm, fore, hand] of [[-1, J.armL, J.foreL, J.handL], [1, J.armR, J.foreR, J.handR]]) {
    p[arm] = p[J.chest].clone().add(v(s * b.shoulderX, b.shoulderY, 0));
    p[fore] = p[arm].clone().add(v(0, -b.upperArm, 0));
    p[hand] = p[fore].clone().add(v(0, -b.forearm, 0));
  }
  for (const [s, thigh, shin, foot] of [[-1, J.thighL, J.shinL, J.footL], [1, J.thighR, J.shinR, J.footR]]) {
    p[thigh] = p[J.hips].clone().add(v(s * b.hipX, -b.hipDrop, 0));
    p[shin] = p[thigh].clone().add(v(0, -b.thigh, 0));
    p[foot] = p[shin].clone().add(v(0, -b.shin, 0));
  }
  return p;
}

/**
 * Create the bone hierarchy. extras: [{name, parent: jointName|extraName, pos: [x,y,z] model space, order}]
 * Returns { bones, byName, root, rest (model-space positions per bone), skeleton }.
 */
export function createBones(rest, extras = []) {
  const bones = [], byName = {}, restAll = [];
  JOINTS.forEach((j, i) => {
    const b = new THREE.Bone();
    b.name = j.name;
    b.rotation.order = j.order;
    bones.push(b); byName[j.name] = b; restAll.push(rest[i].clone());
  });
  JOINTS.forEach((j, i) => {
    const b = bones[i];
    if (j.parent >= 0) { bones[j.parent].add(b); b.position.copy(rest[i]).sub(rest[j.parent]); } else b.position.copy(rest[i]);
  });
  for (const e of extras) {
    const b = new THREE.Bone();
    b.name = e.name;
    b.rotation.order = e.order || 'XYZ';
    const pi = bones.indexOf(byName[e.parent]);
    const pos = new THREE.Vector3(...e.pos);
    b.position.copy(pos).sub(restAll[pi]);
    byName[e.parent].add(b);
    bones.push(b); byName[e.name] = b; restAll.push(pos);
  }
  const root = bones[0];
  root.updateMatrixWorld(true); // root has no parent yet -> matrixWorld is relative to the model origin
  const skeleton = new THREE.Skeleton(bones);
  return { bones, byName, root, rest: restAll, skeleton };
}

/** Index of a bone by name within a bones array built by createBones (core joints first, then extras). */
export function boneIndex(names, name) { return names.indexOf(name); }

// ------------------------------------------------------------------ pose helpers
export function newPose() { const p = new Float32Array(POSE_SIZE); p[R.squash] = 1; return p; }
export function zeroPose(p) { p.fill(0); p[R.squash] = 1; return p; }
export function setJ(P, j, x, y, z) { const k = j * 3; P[k] = x; P[k + 1] = y; P[k + 2] = z; }
export function addJ(P, j, x, y, z) { const k = j * 3; P[k] += x; P[k + 1] += y; P[k + 2] += z; }
/** Mirrored limb helper: side = +1 (right) / -1 (left). y and z are given as "outward" amounts. */
export function arm(P, side, x, y, z) { setJ(P, side > 0 ? J.armR : J.armL, x, y * side, z * side); }
export function fore(P, side, x, y = 0, z = 0) { setJ(P, side > 0 ? J.foreR : J.foreL, x, y * side, z * side); }
export function hand(P, side, x, y = 0, z = 0) { setJ(P, side > 0 ? J.handR : J.handL, x, y * side, z * side); }
export function thigh(P, side, x, y, z) { setJ(P, side > 0 ? J.thighR : J.thighL, x, y * side, z * side); }
export function shin(P, side, x, y = 0, z = 0) { setJ(P, side > 0 ? J.shinR : J.shinL, x, y * side, z * side); }
export function foot(P, side, x, y = 0, z = 0) { setJ(P, side > 0 ? J.footR : J.footL, x, y * side, z * side); }
export function addArm(P, side, x, y, z) { addJ(P, side > 0 ? J.armR : J.armL, x, y * side, z * side); }
export function addFore(P, side, x, y = 0, z = 0) { addJ(P, side > 0 ? J.foreR : J.foreL, x, y * side, z * side); }
export function addThigh(P, side, x, y, z) { addJ(P, side > 0 ? J.thighR : J.thighL, x, y * side, z * side); }
export function addShin(P, side, x) { addJ(P, side > 0 ? J.shinR : J.shinL, x, 0, 0); }
export function addFoot(P, side, x) { addJ(P, side > 0 ? J.footR : J.footL, x, 0, 0); }

export function lerpPose(out, a, b, t) {
  for (let i = 0; i < POSE_SIZE; i++) out[i] = a[i] + (b[i] - a[i]) * t;
  return out;
}
/** out = base + (target - base) * w, only for joints in `mask` (array of joint indices) */
export function blendJoints(out, target, w, mask) {
  for (const j of mask) {
    const k = j * 3;
    out[k] += (target[k] - out[k]) * w; out[k + 1] += (target[k + 1] - out[k + 1]) * w; out[k + 2] += (target[k + 2] - out[k + 2]) * w;
  }
}
export const ARM_R = [J.armR, J.foreR, J.handR];
export const ARM_L = [J.armL, J.foreL, J.handL];
export const LEGS = [J.thighL, J.shinL, J.footL, J.thighR, J.shinR, J.footR];
export const UPPER = [J.spine, J.chest, J.neck, J.head, J.armL, J.foreL, J.handL, J.armR, J.foreR, J.handR];
