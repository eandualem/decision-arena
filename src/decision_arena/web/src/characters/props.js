// Power-up props: jetpack (with nozzle anchors), pogo stick, horseshoe magnet, spray can, spring-sneaker coils.
// Geometry is built once and shared; each rig gets its own lightweight Mesh instances.
import * as THREE from 'three';
import { Builder, Prim, tube } from './geo.js';
import { bodyMaterial, shinyMaterial, glowMaterial, additiveMaterial, radialTexture, flameTexture } from './materials.js';

const protos = {};

function matFor(slot) {
  switch (slot) {
    case 'shiny': return shinyMaterial('gloss');
    case 'chrome': return shinyMaterial('chrome');
    case 'glow': return glowMaterial();
    default: return bodyMaterial();
  }
}
/** Group with one Mesh per material slot of a built (non-skinned) Builder. */
export function groupFromBuilt(built, castShadow = true) {
  const g = new THREE.Group();
  for (const [slot, geo] of Object.entries(built.slots)) {
    const m = new THREE.Mesh(geo, matFor(slot));
    m.castShadow = castShadow && slot !== 'glow';
    m.name = slot;
    g.add(m);
  }
  return g;
}

// ------------------------------------------------------------------ jetpack
// Origin: center of the plate that touches the wearer's back; +Z points away from the back, nozzles at the bottom.
function jetpackProto() {
  if (protos.jet) return protos.jet;
  const B = new Builder({ skinned: false });
  const red = 0xff5a1f, white = 0xfff4e8, metal = 0x6b7280, dark = 0x2a2e38;
  B.rbox([0, 0.0, 0.03], [0.26, 0.36, 0.06], 0.03, dark);
  // straps (short stubs toward the shoulders)
  for (const s of [-1, 1]) B.rbox([s * 0.1, 0.17, 0.0], [0.05, 0.05, 0.05], 0.02, dark);
  for (const s of [-1, 1]) {
    const x = s * 0.1;
    // tank with a white band
    B.add(Prim.capsule(0.078, 0.26, 5, 14), { pos: [x, 0.02, 0.12], color: (px, py) => (py > 0.05 && py < 0.1 ? white : red), slot: 'shiny' });
    // nose cone light
    B.add(Prim.sphere(10, 8), { pos: [x, 0.2, 0.12], scale: [0.04, 0.03, 0.04], color: 0xffe066, slot: 'glow' });
    // nozzle (flared, dark metal) + inner glow ring
    B.add(Prim.cylinder(0.05, 0.075, 0.09, 14, false), { pos: [x, -0.2, 0.12], color: metal, slot: 'chrome' });
    B.add(Prim.torus(0.058, 0.012, 6, 14), { pos: [x, -0.245, 0.12], rot: [Math.PI / 2, 0, 0], color: 0xffb347, slot: 'glow' });
    // side fin
    B.add(Prim.rbox(0.02, 0.16, 0.1, 0.008, 1), { pos: [x + s * 0.085, -0.08, 0.13], rot: [0.3, 0, 0], color: white });
  }
  // center gauge
  B.add(Prim.cylinder(0.035, 0.035, 0.02, 12), { pos: [0, 0.05, 0.075], rot: [Math.PI / 2, 0, 0], color: white });
  B.add(Prim.cylinder(0.025, 0.025, 0.022, 12), { pos: [0, 0.05, 0.078], rot: [Math.PI / 2, 0, 0], color: 0x2ee6a6, slot: 'glow' });
  const built = B.build();
  // pilot flame: an additive cone below each nozzle (FX adds the big plume)
  const flameGeo = new THREE.ConeGeometry(0.055, 0.34, 12, 1, true);
  flameGeo.translate(0, -0.17, 0);
  flameGeo.rotateX(Math.PI); // point down
  flameGeo.translate(0, -0.34, 0);
  protos.jet = { built, flameGeo, nozzles: [[-0.1, -0.25, 0.12], [0.1, -0.25, 0.12]], tris: built.tris };
  return protos.jet;
}

export function makeJetpack() {
  const P = jetpackProto();
  const group = groupFromBuilt(P.built);
  group.name = 'jetpack';
  const flameMat = additiveMaterial(flameTexture(), 0xffb050, 0.95);
  const anchors = [];
  const flames = [];
  for (const n of P.nozzles) {
    const a = new THREE.Object3D();
    a.position.set(n[0], n[1], n[2]);
    a.name = 'jetNozzle';
    group.add(a);
    anchors.push(a);
    const f = new THREE.Mesh(P.flameGeo, flameMat);
    f.position.set(n[0], n[1], n[2]);
    f.visible = false;
    f.renderOrder = 3;
    group.add(f);
    flames.push(f);
  }
  return { group, jetL: anchors[0], jetR: anchors[1], flames, flameMat, dispose() { flameMat.dispose(); } };
}

// ------------------------------------------------------------------ pogo stick
// Origin at the rider's feet level; the shaft stands in front of the rider, the tip reaches down POGO_TIP.
export const POGO_TIP = 0.36;
function pogoProto() {
  if (protos.pogo) return protos.pogo;
  const U = new Builder({ skinned: false });
  const purple = 0xb86bff, yellow = 0xffd23f, dark = 0x2a2438, chrome = 0xd7dbe3;
  const z = -0.2;
  U.add(Prim.cylinder(0.026, 0.026, 1.0, 12), { pos: [0, 0.45, z], color: purple, slot: 'shiny' });
  // handlebar with grips
  U.add(Prim.cylinder(0.02, 0.02, 0.46, 10), { pos: [0, 0.93, z], rot: [0, 0, Math.PI / 2], color: chrome, slot: 'chrome' });
  for (const s of [-1, 1]) U.add(Prim.capsule(0.03, 0.1, 4, 10), { pos: [s * 0.2, 0.93, z], rot: [0, 0, Math.PI / 2], color: yellow });
  U.add(Prim.sphere(10, 8), { pos: [0, 0.96, z], scale: 0.04, color: yellow, slot: 'shiny' });
  // foot pegs
  U.add(Prim.cylinder(0.018, 0.018, 0.42, 8), { pos: [0, -0.01, z], rot: [0, 0, Math.PI / 2], color: chrome, slot: 'chrome' });
  for (const s of [-1, 1]) U.add(Prim.rbox(0.11, 0.03, 0.13, 0.012, 1), { pos: [s * 0.14, -0.005, z + 0.03], color: dark });
  // lower sleeve
  U.add(Prim.cylinder(0.04, 0.04, 0.1, 12), { pos: [0, -0.05, z], color: purple, slot: 'shiny' });
  const upper = U.build();
  const L = new Builder({ skinned: false });
  // spring coil (local origin at the top of the spring, y down)
  const pts = [];
  for (let i = 0; i <= 48; i++) { const a = i / 48 * Math.PI * 2 * 4; pts.push([Math.cos(a) * 0.045, -i / 48 * 0.22, z + Math.sin(a) * 0.045]); }
  L.add(tube(pts, 0.009, 64, 5), { color: yellow, slot: 'shiny' });
  L.add(Prim.cylinder(0.016, 0.016, 0.24, 8), { pos: [0, -0.12, z], color: chrome, slot: 'chrome' });
  L.add(Prim.sphere(12, 8), { pos: [0, -0.25, z], scale: [0.05, 0.045, 0.05], color: dark });
  const lower = L.build();
  protos.pogo = { upper, lower, tris: upper.tris + lower.tris };
  return protos.pogo;
}
export function makePogo() {
  const P = pogoProto();
  const group = new THREE.Group();
  group.name = 'pogo';
  group.add(groupFromBuilt(P.upper));
  const spring = groupFromBuilt(P.lower);
  spring.position.y = -0.1;
  group.add(spring);
  return { group, spring };
}

// ------------------------------------------------------------------ magnet (held in the hand; local frame of the hand bone)
function magnetProto() {
  if (protos.mag) return protos.mag;
  const B = new Builder({ skinned: false });
  const red = 0xff3b5c, tip = 0xe6e9ef;
  // horseshoe: half torus + two legs pointing along -Y (out of the fist)
  B.add(Prim.torus(0.07, 0.03, 8, 16, Math.PI), { pos: [0, -0.1, 0], rot: [0, Math.PI / 2, Math.PI], color: red, slot: 'shiny' });
  for (const s of [-1, 1]) {
    B.add(Prim.cylinder(0.03, 0.03, 0.1, 12), { pos: [0, -0.15, s * 0.07], color: red, slot: 'shiny' });
    B.add(Prim.cylinder(0.031, 0.031, 0.05, 12), { pos: [0, -0.225, s * 0.07], color: tip, slot: 'chrome' });
  }
  protos.mag = { built: B.build() };
  return protos.mag;
}
export function makeMagnet() {
  const group = groupFromBuilt(magnetProto().built);
  group.name = 'magnet';
  const glow = new THREE.Mesh(new THREE.PlaneGeometry(0.34, 0.34), additiveMaterial(radialTexture(), 0xff6a88, 0.55));
  glow.position.set(0, -0.26, 0);
  glow.renderOrder = 3;
  group.add(glow);
  return { group, glow, dispose() { glow.geometry.dispose(); glow.material.dispose(); } };
}

// ------------------------------------------------------------------ spray can (hand)
function canProto() {
  if (protos.can) return protos.can;
  const B = new Builder({ skinned: false });
  B.add(Prim.cylinder(0.036, 0.036, 0.14, 12), { pos: [0, -0.1, 0], color: (x, y) => (y < -0.13 || y > -0.075 ? 0xdfe3ea : 0xff4fa3), slot: 'shiny' });
  B.add(Prim.sphere(10, 6), { pos: [0, -0.17, 0], scale: [0.036, 0.022, 0.036], color: 0xdfe3ea, slot: 'shiny' });
  B.add(Prim.cylinder(0.012, 0.014, 0.025, 8), { pos: [0, -0.195, 0], color: 0x1b1238 });
  protos.can = { built: B.build() };
  return protos.can;
}
export function makeCan() {
  const group = groupFromBuilt(canProto().built, false);
  group.name = 'spraycan';
  return { group };
}

// ------------------------------------------------------------------ spring sneakers: glowing coil + sole plate under a shoe (foot bone space)
function coilProto() {
  if (protos.coil) return protos.coil;
  const B = new Builder({ skinned: false });
  const pts = [];
  for (let i = 0; i <= 36; i++) { const a = i / 36 * Math.PI * 2 * 3; pts.push([Math.cos(a) * 0.05, -i / 36 * 0.07, Math.sin(a) * 0.05]); }
  B.add(tube(pts, 0.01, 48, 5), { pos: [0, 0, 0], color: 0x39d353, slot: 'glow' });
  B.add(Prim.cylinder(0.075, 0.075, 0.012, 16), { pos: [0, -0.075, 0], scale: [1, 1, 1.9], color: 0x39d353, slot: 'glow' });
  protos.coil = { built: B.build() };
  return protos.coil;
}
export function makeCoil() {
  const group = groupFromBuilt(coilProto().built, false);
  group.name = 'springCoil';
  return { group };
}

export function propTris() {
  return { jetpack: jetpackProto().tris, pogo: pogoProto().tris };
}
