// Hoverboards: six original designs keyed by the ids in defs.js. Deck with kicktails, grip-tape top art,
// painted bottom graphic, glowing underside and ability hardware (springs, thrusters, wings, coils, twin deck).
import * as THREE from 'three';
import { Builder, Prim, tube } from './geo.js';
import { additiveMaterial, radialTexture, shinyMaterial, bodyMaterial, glowMaterial } from './materials.js';
import { groupFromBuilt } from './props.js';

export const DECK = { L: 1.3, W: 0.42, T: 0.045, hover: 0.19 };

const DESIGNS = {
  classic: { name: 'Daybreak', top: ['#ff9f1c', '#ffd23f'], bottom: ['#ff5e3a', '#ffd23f'], edge: '#1b1238', glow: 0xffa040, grip: '#26213a', art: 'sun', hw: 'pads' },
  bouncer: { name: 'Bouncer', top: ['#8edc4a', '#c6ff3d'], bottom: ['#2fd18a', '#c6ff3d'], edge: '#1b3a1b', glow: 0x7dff4a, grip: '#1f2a1f', art: 'dots', hw: 'springs' },
  nitro: { name: 'Nitro', top: ['#f2553d', '#ff9f1c'], bottom: ['#1b1b24', '#f2553d'], edge: '#111118', glow: 0xff5a1f, grip: '#1b1b24', art: 'flames', hw: 'thrusters' },
  glider: { name: 'Glider', top: ['#5ec8f5', '#cfefff'], bottom: ['#3a6fd8', '#cfefff'], edge: '#ffffff', glow: 0x6fe6ff, grip: '#27364a', art: 'feather', hw: 'wings' },
  zapper: { name: 'Zapper', top: ['#7a3cff', '#3ad7ff'], bottom: ['#1b1238', '#7a3cff'], edge: '#3ad7ff', glow: 0xb06bff, grip: '#1b1238', art: 'bolts', hw: 'coils' },
  twin: { name: 'Double Deck', top: ['#ff4fa3', '#ffd23f'], bottom: ['#19b3b1', '#ff4fa3'], edge: '#ffffff', glow: 0xff5fc0, grip: '#2a1a30', art: 'stars', hw: 'twin' },
};

// ------------------------------------------------------------------ deck geometry
/** Deck mesh: cross sections along Z (nose at -Z), rounded ends, kicktails, slight concave.
 *  UVs: top surface u in [0, 0.5], bottom surface u in [0.5, 1], edges u ~ 0.5; v along the length. */
function deckGeometry(L, W, T, kick = 0.085, tail = 0.26) {
  const NS = 26;         // sections
  const topN = 7, botN = 7;
  const pos = [], uv = [], idx = [];
  const loop = [];
  // cross-section template (x in [-1,1] of half width, y offset), with u coordinate
  for (let i = 0; i < topN; i++) { const x = -1 + (2 * i) / (topN - 1); loop.push({ x: x * 0.94, y: 0.5, top: true, u: 0.02 + (x * 0.5 + 0.5) * 0.46 }); }
  loop.push({ x: 1.0, y: 0.15, u: 0.5 }, { x: 1.0, y: -0.2, u: 0.5 });
  for (let i = 0; i < botN; i++) { const x = 1 - (2 * i) / (botN - 1); loop.push({ x: x * 0.94, y: -0.5, bottom: true, u: 0.52 + (1 - (x * 0.5 + 0.5)) * 0.46 }); }
  loop.push({ x: -1.0, y: -0.2, u: 0.5 }, { x: -1.0, y: 0.15, u: 0.5 });
  const M = loop.length;
  for (let s = 0; s <= NS; s++) {
    const t = s / NS;
    const z = (t - 0.5) * L;
    const az = Math.abs(z), R = W / 2;
    let w = W;
    if (az > L / 2 - R) { const k = (az - (L / 2 - R)) / R; w = W * Math.sqrt(Math.max(0.0025, 1 - k * k)); }
    const tk = Math.max(0, (az - (L / 2 - tail)) / tail);
    const lift = kick * tk * tk;
    for (const p of loop) {
      const cx = p.x * w / 2;
      const concave = p.top ? -0.006 * (1 - p.x * p.x) : 0;
      pos.push(cx, lift + p.y * T + concave, z);
      uv.push(p.u, 1 - t);
    }
  }
  for (let s = 0; s < NS; s++) {
    for (let i = 0; i < M; i++) {
      const a = s * M + i, b = s * M + (i + 1) % M, c = (s + 1) * M + (i + 1) % M, d = (s + 1) * M + i;
      idx.push(a, d, b, b, d, c);
    }
  }
  // end caps (fans)
  for (const s of [0, NS]) {
    const ci = pos.length / 3;
    let cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < M; i++) { cx += pos[(s * M + i) * 3]; cy += pos[(s * M + i) * 3 + 1]; cz += pos[(s * M + i) * 3 + 2]; }
    pos.push(cx / M, cy / M, cz / M); uv.push(0.5, s ? 0 : 1);
    for (let i = 0; i < M; i++) {
      const a = s * M + i, b = s * M + (i + 1) % M;
      if (s === 0) idx.push(ci, a, b); else idx.push(ci, b, a);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ------------------------------------------------------------------ deck art (canvas: left half = grip top, right half = bottom graphic)
function deckTexture(d) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 512;
  const g = c.getContext('2d');
  // ---- top: bright gradient field with a grip-tape speckle, dark rails, art in the grip color
  const grd = g.createLinearGradient(0, 0, 0, 512);
  grd.addColorStop(0, d.top[0]); grd.addColorStop(1, d.top[1]);
  g.fillStyle = grd; g.fillRect(0, 0, 128, 512);
  g.fillStyle = d.grip; g.fillRect(0, 0, 9, 512); g.fillRect(119, 0, 9, 512);
  g.globalAlpha = 0.9; topArt(g, d, d.grip); g.globalAlpha = 1;
  for (let i = 0; i < 1400; i++) { g.fillStyle = i % 3 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.12)'; g.fillRect(Math.random() * 128, Math.random() * 512, 1.5, 1.5); }
  // ---- bottom graphic
  const gb = g.createLinearGradient(0, 0, 0, 512);
  gb.addColorStop(0, d.bottom[0]); gb.addColorStop(1, d.bottom[1]);
  g.fillStyle = gb; g.fillRect(128, 0, 128, 512);
  bottomArt(g, d);
  // edge band (u ~ 0.5)
  g.fillStyle = d.edge; g.fillRect(124, 0, 8, 512);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function topArt(g, d, grd) {
  g.save();
  g.fillStyle = grd; g.strokeStyle = grd;
  switch (d.art) {
    case 'sun': {
      g.beginPath(); g.arc(64, 256, 30, 0, Math.PI * 2); g.fill();
      g.lineWidth = 6; g.lineCap = 'round';
      for (let i = 0; i < 12; i++) { const a = i * Math.PI / 6; g.beginPath(); g.moveTo(64 + Math.cos(a) * 40, 256 + Math.sin(a) * 40); g.lineTo(64 + Math.cos(a) * 54, 256 + Math.sin(a) * 54); g.stroke(); }
      break;
    }
    case 'dots':
      for (let y = 40; y < 480; y += 44) for (let x = 34; x < 110; x += 30) { g.beginPath(); g.arc(x + ((y / 44) % 2) * 12, y, 8, 0, Math.PI * 2); g.fill(); }
      break;
    case 'flames':
      for (const x of [34, 94]) { g.beginPath(); g.moveTo(x - 14, 470); for (let y = 470; y > 120; y -= 40) { g.quadraticCurveTo(x + 22, y - 20, x - 4, y - 40); } g.lineTo(x + 14, 470); g.closePath(); g.fill(); }
      break;
    case 'feather':
      g.lineWidth = 5; g.beginPath(); g.moveTo(64, 80); g.lineTo(64, 440); g.stroke();
      for (let y = 110; y < 420; y += 22) { g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(90, y - 6, 106, y - 30); g.stroke(); g.beginPath(); g.moveTo(64, y); g.quadraticCurveTo(38, y - 6, 22, y - 30); g.stroke(); }
      break;
    case 'bolts':
      for (const y of [150, 360]) boltPath(g, 64, y, 60), g.fill();
      break;
    case 'stars':
      for (const [x, y, r] of [[64, 130, 26], [40, 260, 16], [88, 300, 20], [64, 400, 26]]) starPath(g, x, y, r), g.fill();
      break;
  }
  g.restore();
}
function bottomArt(g, d) {
  g.save();
  g.translate(128, 0);
  g.fillStyle = 'rgba(255,255,255,0.9)'; g.strokeStyle = '#1b1238'; g.lineWidth = 6; g.lineJoin = 'round';
  switch (d.art) {
    case 'sun':
      g.fillStyle = 'rgba(255,255,255,0.35)';
      for (let i = 0; i < 6; i++) g.fillRect(0, 300 + i * 30, 128, 12);
      g.fillStyle = '#fff6d8'; g.beginPath(); g.arc(64, 290, 44, Math.PI, 0); g.fill();
      break;
    case 'dots':
      for (let y = 30; y < 500; y += 40) for (let x = 20; x < 120; x += 36) { g.beginPath(); g.arc(x + ((y / 40) % 2) * 16, y, 11, 0, Math.PI * 2); g.fill(); }
      break;
    case 'flames':
      g.fillStyle = '#ffd23f';
      for (let i = 0; i < 5; i++) { const x = 12 + i * 26; g.beginPath(); g.moveTo(x - 10, 512); g.quadraticCurveTo(x + 20, 380, x, 260 + (i % 2) * 40); g.quadraticCurveTo(x - 4, 380, x + 12, 512); g.fill(); }
      break;
    case 'feather':
      g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 7;
      for (let i = 0; i < 3; i++) { g.beginPath(); g.moveTo(10, 120 + i * 120); g.quadraticCurveTo(64, 60 + i * 120, 118, 120 + i * 120); g.stroke(); }
      break;
    case 'bolts':
      g.fillStyle = '#3ad7ff';
      for (const y of [110, 256, 400]) boltPath(g, 64, y, 52), g.fill(), g.stroke();
      break;
    case 'stars':
      g.fillStyle = '#ffffff';
      for (let i = 0; i < 9; i++) starPath(g, 22 + (i * 47) % 90, 40 + i * 52, 12 + (i % 3) * 5), g.fill();
      break;
  }
  // brand plate: a little original logo (a dash arrow)
  g.fillStyle = '#1b1238'; g.beginPath(); g.moveTo(40, 470); g.lineTo(88, 470); g.lineTo(88, 460); g.lineTo(104, 478); g.lineTo(88, 496); g.lineTo(88, 486); g.lineTo(40, 486); g.closePath(); g.fill();
  g.restore();
}
function boltPath(g, x, y, s) {
  g.beginPath();
  [[0.15, -1], [-0.45, 0.12], [-0.02, 0.12], [-0.22, 1], [0.45, -0.18], [0.04, -0.18]].forEach(([a, b], i) => (i ? g.lineTo(x + a * s, y + b * s) : g.moveTo(x + a * s, y + b * s)));
  g.closePath();
}
function starPath(g, x, y, r) {
  g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); }
  g.closePath();
}

// ------------------------------------------------------------------ hardware per design
const protoCache = {};
function boardProto(id) {
  if (protoCache[id]) return protoCache[id];
  const d = DESIGNS[id] || DESIGNS.classic;
  const { L, W, T } = DECK;
  const deckGeo = deckGeometry(L, W, T);
  const tex = deckTexture(d);
  const deckMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, metalness: 0.05 });
  const B = new Builder({ skinned: false });
  const glowHex = d.glow;
  const metal = 0xc9ccd6, dark = 0x2a2e38;
  const under = -T / 2; // deck underside (local)
  // glowing edge strip on the underside
  for (const s of [-1, 1]) B.add(Prim.box(0.012, 0.01, L * 0.62), { pos: [s * W * 0.42, under - 0.004, 0], color: glowHex, slot: 'glow' });
  switch (d.hw) {
    case 'pads':
      for (const z of [-0.38, 0.38]) {
        B.add(Prim.cylinder(0.11, 0.09, 0.05, 16), { pos: [0, under - 0.028, z], color: dark, slot: 'shiny' });
        B.add(Prim.torus(0.085, 0.014, 5, 16), { pos: [0, under - 0.056, z], rot: [Math.PI / 2, 0, 0], color: glowHex, slot: 'glow' });
      }
      break;
    case 'springs':
      for (const [x, z] of [[-0.12, -0.36], [0.12, -0.36], [-0.12, 0.36], [0.12, 0.36]]) {
        const pts = [];
        for (let i = 0; i <= 30; i++) { const a = i / 30 * Math.PI * 2 * 3; pts.push([x + Math.cos(a) * 0.045, under - 0.01 - i / 30 * 0.085, z + Math.sin(a) * 0.045]); }
        B.add(tube(pts, 0.009, 40, 5), { color: metal, slot: 'shiny' });
        B.add(Prim.cylinder(0.055, 0.055, 0.02, 12), { pos: [x, under - 0.1, z], color: glowHex, slot: 'glow' });
      }
      break;
    case 'thrusters':
      for (const s of [-1, 1]) {
        B.add(Prim.cylinder(0.06, 0.07, 0.3, 14), { pos: [s * 0.12, under - 0.045, 0.5], rot: [Math.PI / 2, 0, 0], color: dark, slot: 'shiny' });
        B.add(Prim.cylinder(0.07, 0.05, 0.08, 14, true), { pos: [s * 0.12, under - 0.045, 0.69], rot: [Math.PI / 2, 0, 0], color: metal, slot: 'chrome' });
        B.add(Prim.cylinder(0.045, 0.045, 0.01, 12), { pos: [s * 0.12, under - 0.045, 0.72], rot: [Math.PI / 2, 0, 0], color: glowHex, slot: 'glow' });
        B.add(Prim.box(0.01, 0.05, 0.36), { pos: [s * 0.2, T / 2 + 0.01, 0.2], color: 0xffd23f });
      }
      break;
    case 'wings':
      for (const s of [-1, 1]) {
        const shape = new THREE.Shape([new THREE.Vector2(0, -0.22), new THREE.Vector2(0.26, -0.02), new THREE.Vector2(0.28, 0.12), new THREE.Vector2(0, 0.2)]);
        const wg = new THREE.ExtrudeGeometry(shape, { depth: 0.014, bevelEnabled: false, curveSegments: 2 });
        wg.rotateX(Math.PI / 2);
        B.add(wg, { pos: [s * W * 0.42, 0.0, 0.05], scale: [s, 1, 1], rot: [0, 0, s * 0.15], color: 0xffffff, slot: 'shiny' });
        B.add(Prim.box(0.2, 0.006, 0.02), { pos: [s * (W * 0.42 + 0.13), 0.012, 0.1], rot: [0, s * 0.5, s * 0.15], color: glowHex, slot: 'glow' });
      }
      B.add(Prim.cylinder(0.08, 0.06, 0.04, 14), { pos: [0, under - 0.022, 0], color: dark, slot: 'shiny' });
      break;
    case 'coils':
      for (const z of [-0.5, -0.36]) for (const s of [-1, 1]) {
        B.add(Prim.cylinder(0.012, 0.012, 0.07, 6), { pos: [s * 0.1, T / 2 + 0.07, z], color: metal, slot: 'chrome' });
        B.add(Prim.sphere(10, 8), { pos: [s * 0.1, T / 2 + 0.11, z], scale: 0.03, color: 0xbfe9ff, slot: 'glow' });
      }
      for (const z of [-0.3, 0.3]) {
        for (let i = 0; i < 3; i++) B.add(Prim.torus(0.07 - i * 0.012, 0.01, 4, 16), { pos: [0, under - 0.02 - i * 0.022, z], rot: [Math.PI / 2, 0, 0], color: i === 1 ? glowHex : metal, slot: i === 1 ? 'glow' : 'chrome' });
      }
      break;
    case 'twin':
      for (const [x, z] of [[-0.12, -0.34], [0.12, -0.34], [-0.12, 0.34], [0.12, 0.34]]) {
        B.add(Prim.cylinder(0.022, 0.022, 0.07, 8), { pos: [x, under - 0.035, z], color: metal, slot: 'chrome' });
      }
      break;
  }
  const hw = B.build();
  // second (lower) deck for the Double Deck
  let lower = null;
  if (d.hw === 'twin') lower = deckGeometry(L * 0.86, W * 0.9, T * 0.8, 0.05, 0.2);
  protoCache[id] = { d, deckGeo, deckMat, hw, lower, tris: deckGeo.index.count / 3 + hw.tris + (lower ? lower.index.count / 3 : 0) };
  return protoCache[id];
}

export class BoardRig {
  constructor(id, opts = {}) {
    this.id = DESIGNS[id] ? id : 'classic';
    const P = boardProto(this.id);
    this.design = P.d;
    this.object = new THREE.Group();
    this.object.name = 'board:' + this.id;
    this.deck = new THREE.Group();
    this.object.add(this.deck);
    const deck = new THREE.Mesh(P.deckGeo, P.deckMat);
    deck.castShadow = opts.castShadow !== false;
    this.deck.add(deck);
    const hw = groupFromBuilt(P.hw, opts.castShadow !== false);
    this.deck.add(hw);
    if (P.lower) {
      const low = new THREE.Mesh(P.lower, P.deckMat);
      low.position.y = -0.075;
      low.castShadow = opts.castShadow !== false;
      this.deck.add(low);
    }
    // soft underglow (additive, per instance so it can pulse)
    this.glowMat = additiveMaterial(radialTexture(), P.d.glow, 0.85);
    this.glow = new THREE.Mesh(new THREE.PlaneGeometry(DECK.W * 2.2, DECK.L * 1.25), this.glowMat);
    this.glow.rotation.x = -Math.PI / 2;
    this.glow.renderOrder = 3;
    this.object.add(this.glow);
    this.glow.position.y = 0.02;
    this.t = Math.random() * 10;
    this.hover = DECK.hover;
    this.topY = DECK.hover + DECK.T / 2;
    this.tris = P.tris;
    this.update(0, { speed: 0, active: false });
  }
  /** s = { speed, active } */
  update(dt, s = {}) {
    this.t += dt || 0;
    const active = !!s.active;
    const sp = s.speed || 0;
    const bob = Math.sin(this.t * 3.1) * 0.022 + Math.sin(this.t * 7.3) * (active ? 0.006 + Math.min(sp, 30) * 0.0003 : 0.003);
    const h = this.hover + bob;
    this.deck.position.y = h;
    this.deck.rotation.z = Math.sin(this.t * 2.3) * (active ? 0.02 : 0.035);
    this.deck.rotation.x = Math.sin(this.t * 1.7) * 0.015;
    this.topY = h + DECK.T / 2;
    const pulse = 0.65 + 0.25 * Math.sin(this.t * 6) + (active ? 0.15 : 0);
    this.glowMat.opacity = pulse;
    const sc = 0.9 + 0.1 * Math.sin(this.t * 6) - bob * 2;
    this.glow.scale.set(sc, sc, 1);
  }
  dispose() {
    this.object.removeFromParent();
    this.glow.geometry.dispose();
    this.glowMat.dispose();
  }
}

export function boardDesign(id) { return DESIGNS[id] || DESIGNS.classic; }
export function boardTris(id) { return boardProto(DESIGNS[id] ? id : 'classic').tris; }
