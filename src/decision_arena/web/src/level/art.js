// Procedural canvas art for the LEVEL module: train livery atlas, graffiti atlas, props atlas, pickup atlas,
// coin face + emboss, glow sprites. Everything is drawn at runtime (no image files). All names, tags and
// logos are original to Rail Dash.
import * as THREE from 'three';
import { makeCanvas } from '../core/tex.js';
import { Atlas } from './atlas.js';
import { CAR_LEN, HALF_W, BODY_BOTTOM, CORNER_R, SIDE_TOP, ROOF_Y, sideArc, SIDE, CAB } from './trainspec.js';

// ------------------------------------------------------------------------------------ palette / liveries
export const LIVERIES = [
  { name: 'teal', base: '#19B3B1', dark: '#0e7c7b', band: '#133b50', accent: '#FFC93C', stripe: '#ffffff', upper: '#dde9ea', door: '#1fc4c2', style: 'band' },
  { name: 'tomato', base: '#F2553D', dark: '#b83a2a', band: '#fff0d4', accent: '#1B1238', stripe: '#fff0d4', upper: '#ece5dd', door: '#ff6a52', style: 'cream' },
  { name: 'cobalt', base: '#3A6FD8', dark: '#264f9e', band: '#18203a', accent: '#FFC93C', stripe: '#ffffff', upper: '#e0e6f0', door: '#4a80ea', style: 'band' },
  { name: 'sunflower', base: '#FFC93C', dark: '#d8971a', band: '#2b2b36', accent: '#F2553D', stripe: '#2b2b36', upper: '#f1eadb', door: '#ffd35e', style: 'band' },
  { name: 'lime', base: '#8EDC4A', dark: '#5ea52c', band: '#f5f8f0', accent: '#19B3B1', stripe: '#244a30', upper: '#e7ecdf', door: '#9fe85c', style: 'cream' },
];
export const PLATE_TEXTS = ['12', '7A', 'R3', '44', 'D9', '08'];

// ------------------------------------------------------------------------------------ helpers
export function rr(g, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}
function hexToRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
export function shade(hex, k) {
  const [r, g, b] = hexToRgb(hex);
  const f = (c) => Math.round(k >= 0 ? c + (255 - c) * k : c * (1 + k));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
function rgba(hex, a) { const [r, g, b] = hexToRgb(hex); return `rgba(${r},${g},${b},${a})`; }
function mulberry(seed) { let s = seed >>> 0; return () => { s = (s + 0x6d2b79f5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const FONT = '"Arial Black", "Helvetica Neue", Impact, "Segoe UI Black", Arial, sans-serif';

function toTexture(canvas, { srgb = true, aniso = 8, mip = true } = {}) {
  const t = new THREE.CanvasTexture(canvas);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.anisotropy = aniso;
  if (!mip) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  t.needsUpdate = true;
  return t;
}

/** A design-pixel canvas pair (color + emissive at lower res). */
function makePair(W, H, scale, emScale) {
  const c = makeCanvas(Math.round(W * scale), Math.round(H * scale));
  const g = c.getContext('2d');
  g.scale(scale, scale);
  const e = makeCanvas(Math.round(W * emScale), Math.round(H * emScale));
  const ge = e.getContext('2d');
  ge.fillStyle = '#000'; ge.fillRect(0, 0, e.width, e.height);
  ge.scale(emScale, emScale);
  return { c, g, e, ge };
}

// ===================================================================================== TRAIN ATLAS
export function buildTrainAtlas(quality = 'high') {
  const scale = quality === 'low' ? 0.5 : 1;
  const W = 2048, H = 1024;
  const A = new Atlas(W, H);
  const put = (name, x, y, w, h) => (A.r[name] = { name, x, y, w, h });
  const SW = 1012, SH = 204;
  put('side0', 8, 8, SW, SH); put('side1', 1028, 8, SW, SH);
  put('side2', 8, 220, SW, SH); put('side3', 1028, 220, SW, SH);
  put('side4', 8, 432, SW, SH);
  put('roof', 1028, 432, SW, 90);
  for (let i = 0; i < 12; i++) put('plate' + i, 1028 + (i % 8) * 126, 530 + Math.floor(i / 8) * 42, 120, 36);
  put('lampOff', 1536, 574, 36, 36); put('lampLit', 1578, 574, 36, 36);
  put('tailOff', 1620, 574, 36, 36); put('tailLit', 1662, 574, 36, 36);
  put('white', 1706, 574, 60, 60);
  put('bellows', 1776, 574, 150, 60);
  put('glass', 1936, 574, 60, 60);
  for (let i = 0; i < 5; i++) put('cab' + i, 8 + i * 264, 644, 256, 288);
  put('grille', 1328, 644, 200, 120);

  const { c, g, e, ge } = makePair(W, H, scale, 0.25);
  g.fillStyle = '#808080'; g.fillRect(0, 0, W, H);
  LIVERIES.forEach((L, i) => { drawCarSide(g, A.get('side' + i), L, i); drawCab(g, A.get('cab' + i), L, i); });
  drawRoof(g, A.get('roof'));
  PLATE_TEXTS.forEach((t, i) => { drawPlate(g, ge, A.get('plate' + i), t, false); drawPlate(g, ge, A.get('plate' + (i + 6)), t, true); });
  drawLamp(g, ge, A.get('lampOff'), '#fff8e0', '#cfc6a6', false);
  drawLamp(g, ge, A.get('lampLit'), '#ffffff', '#fff1b8', true);
  drawLamp(g, ge, A.get('tailOff'), '#e0413a', '#8e1d1d', false);
  drawLamp(g, ge, A.get('tailLit'), '#ff6a5a', '#ff2a2a', true, '#ff2a1a');
  fillRegion(g, A.get('white'), '#ffffff');
  drawBellows(g, A.get('bellows'));
  drawGlass(g, A.get('glass'));
  drawGrille(g, A.get('grille'));
  return { atlas: A, map: toTexture(c, { aniso: 8 }), emissiveMap: toTexture(e, { aniso: 1 }), canvas: c };
}

function fillRegion(g, r, color) { g.fillStyle = color; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); }

function drawCarSide(g, r, L, idx) {
  const arc = sideArc();
  const X = (z) => r.x + (z / CAR_LEN) * r.w;
  const Ys = (s) => r.y + r.h * (1 - s / arc.total);
  const Y = (y) => Ys(arc.sOfY(y));
  const pxm = r.w / CAR_LEN;
  g.save();
  g.beginPath(); g.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); g.clip();
  // base body
  g.fillStyle = L.base; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  // soft vertical shading (lighter mid body)
  let gr = g.createLinearGradient(0, Y(2.5), 0, Y(0.8));
  gr.addColorStop(0, 'rgba(255,255,255,0.10)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.0)'); gr.addColorStop(1, 'rgba(0,0,0,0.12)');
  g.fillStyle = gr; g.fillRect(r.x, Y(2.5), r.w, Y(0.8) - Y(2.5));
  // upper roof curve
  gr = g.createLinearGradient(0, Ys(arc.total), 0, Ys(arc.sSideTop));
  gr.addColorStop(0, shade(L.upper, -0.08)); gr.addColorStop(1, L.upper);
  g.fillStyle = gr; g.fillRect(r.x - 4, r.y - 4, r.w + 8, Ys(arc.sSideTop) - r.y + 4);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(r.x - 4, Ys(arc.sSideTop) - 1, r.w + 8, 3);       // rain gutter
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(r.x - 4, Ys(arc.sSideTop) + 2, r.w + 8, 2);
  // window band
  if (L.style === 'band' || L.style === 'cream') {
    g.fillStyle = L.band;
    g.fillRect(r.x - 4, Y(SIDE.winY1 + 0.07), r.w + 8, Y(SIDE.winY0 - 0.07) - Y(SIDE.winY1 + 0.07));
  }
  // stripe under the windows
  g.fillStyle = L.stripe; g.fillRect(r.x - 4, Y(SIDE.stripeY1), r.w + 8, Y(SIDE.stripeY0) - Y(SIDE.stripeY1));
  g.fillStyle = L.accent; g.fillRect(r.x - 4, Y(SIDE.stripeY0 - 0.02), r.w + 8, 3);
  // skirt + bottom corner
  gr = g.createLinearGradient(0, Y(SIDE.skirtTop), 0, r.y + r.h);
  gr.addColorStop(0, L.dark); gr.addColorStop(1, shade(L.dark, -0.35));
  g.fillStyle = gr; g.fillRect(r.x - 4, Y(SIDE.skirtTop), r.w + 8, r.y + r.h + 4 - Y(SIDE.skirtTop));
  g.fillStyle = 'rgba(255,255,255,0.28)'; g.fillRect(r.x - 4, Y(SIDE.skirtTop) - 1, r.w + 8, 2);
  // rivets along the skirt
  g.fillStyle = 'rgba(0,0,0,0.25)';
  for (let z = 0.3; z < CAR_LEN; z += 0.32) { g.beginPath(); g.arc(X(z), Y(SIDE.skirtTop - 0.06), 1.3, 0, 7); g.fill(); }
  // windows
  for (const [z0, z1] of SIDE.windows) drawWindow(g, X(z0), Y(SIDE.winY1), X(z1) - X(z0), Y(SIDE.winY0) - Y(SIDE.winY1), pxm);
  // doors
  for (const [z0, z1] of SIDE.doors) {
    const x0 = X(z0), x1 = X(z1), yT = Y(SIDE.doorTop), yB = Y(BODY_BOTTOM + CORNER_R + 0.03);
    g.fillStyle = L.style === 'cream' ? L.door : shade(L.base, 0.06);
    rr(g, x0, yT, x1 - x0, yB - yT, 5); g.fill();
    g.lineWidth = 3; g.strokeStyle = 'rgba(20,20,30,0.75)'; g.stroke();
    // accent edges
    g.fillStyle = L.accent; g.fillRect(x0 + 2, yT + 3, 4, yB - yT - 6); g.fillRect(x1 - 6, yT + 3, 4, yB - yT - 6);
    // split
    const xm = (x0 + x1) / 2;
    g.fillStyle = 'rgba(20,20,30,0.8)'; g.fillRect(xm - 1.5, yT, 3, yB - yT);
    // door windows
    const wy0 = Y(2.24), wy1 = Y(1.64);
    drawWindow(g, x0 + 9, wy0, xm - x0 - 15, wy1 - wy0, pxm, 6);
    drawWindow(g, xm + 6, wy0, x1 - xm - 15, wy1 - wy0, pxm, 6);
    // step plate
    g.fillStyle = '#3a3c44'; g.fillRect(x0 - 2, yB - 5, x1 - x0 + 4, 7);
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x0 - 2, yB - 5, x1 - x0 + 4, 1.5);
    // door-open buttons
    g.fillStyle = '#ffe36b'; g.beginPath(); g.arc(x0 - 8, Y(1.3), 3, 0, 7); g.fill();
  }
  // panel seams
  g.fillStyle = 'rgba(0,0,0,0.16)';
  for (const z of [0.28, 4.2, 8.3, CAR_LEN - 0.28]) g.fillRect(X(z) - 1, Y(SIDE_TOP), 2, Y(SIDE.skirtTop) - Y(SIDE_TOP));
  // car number + little logo
  const R = mulberry(1234 + idx * 77);
  g.font = `bold ${Math.round(0.17 * pxm)}px ${FONT}`;
  g.textBaseline = 'middle';
  g.fillStyle = 'rgba(255,255,255,0.85)';
  g.fillText(`RD ${1000 + Math.floor(R() * 8999)}`, X(10.35), Y(1.22));
  drawLogo(g, X(1.4), Y(1.18), 0.2 * pxm, L);
  // grime: speckles + bottom darkening
  for (let i = 0; i < 900; i++) {
    const x = r.x + R() * r.w, yy = r.y + r.h * Math.pow(R(), 0.6);
    g.fillStyle = `rgba(40,30,20,${0.04 + R() * 0.08})`;
    g.fillRect(x, yy, 1 + R() * 2.5, 1 + R() * 2.5);
  }
  gr = g.createLinearGradient(0, Y(1.2), 0, r.y + r.h);
  gr.addColorStop(0, 'rgba(60,45,30,0)'); gr.addColorStop(1, 'rgba(60,45,30,0.28)');
  g.fillStyle = gr; g.fillRect(r.x, Y(1.2), r.w, r.y + r.h - Y(1.2));
  // subtle streaks from the roof
  for (let i = 0; i < 26; i++) {
    const x = r.x + R() * r.w, len = 10 + R() * 40;
    g.fillStyle = `rgba(30,30,30,${0.03 + R() * 0.04})`;
    g.fillRect(x, Ys(arc.sSideTop) + 3, 1.5, len);
  }
  g.restore();
}

function drawWindow(g, x, y, w, h, pxm, rad = 8) {
  // rubber frame
  g.fillStyle = '#15161c';
  rr(g, x - 3, y - 3, w + 6, h + 6, rad + 3); g.fill();
  // glass
  const gr = g.createLinearGradient(x, y, x + w * 0.3, y + h);
  gr.addColorStop(0, '#6f93b4'); gr.addColorStop(0.45, '#2f4a68'); gr.addColorStop(1, '#1b2940');
  g.fillStyle = gr; rr(g, x, y, w, h, rad); g.fill();
  g.save(); rr(g, x, y, w, h, rad); g.clip();
  // interior hints: seat backs + handrail
  g.fillStyle = 'rgba(10,15,25,0.35)'; g.fillRect(x, y + h * 0.62, w, h * 0.38);
  g.fillStyle = 'rgba(200,210,220,0.18)'; g.fillRect(x, y + h * 0.18, w, 2);
  // reflections
  g.fillStyle = 'rgba(255,255,255,0.28)';
  g.beginPath(); g.moveTo(x + w * 0.12, y); g.lineTo(x + w * 0.3, y); g.lineTo(x + w * 0.12, y + h); g.lineTo(x - w * 0.06, y + h); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.14)';
  g.beginPath(); g.moveTo(x + w * 0.38, y); g.lineTo(x + w * 0.46, y); g.lineTo(x + w * 0.28, y + h); g.lineTo(x + w * 0.2, y + h); g.fill();
  g.restore();
  void pxm;
}

function drawLogo(g, x, y, s, L) {
  g.save(); g.translate(x, y);
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(0, 0, s, 0, 7); g.fill();
  g.fillStyle = L.accent === '#1B1238' ? '#FF4FA3' : L.accent;
  star(g, 0, 0, s * 0.78, s * 0.36, 5); g.fill();
  g.lineWidth = s * 0.12; g.strokeStyle = '#1B1238'; g.beginPath(); g.arc(0, 0, s, 0, 7); g.stroke();
  g.restore();
}

export function star(g, x, y, R, r, n, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i * Math.PI) / n, rad = i % 2 ? r : R;
    g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
}

function drawRoof(g, r) {
  g.fillStyle = '#a7adb5'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  const R = mulberry(99);
  for (let i = 0; i < 10; i++) {
    const y = r.y + (i + 0.5) * (r.h / 10);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(r.x, y - 2, r.w, 1.5);
    g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(r.x, y + 1, r.w, 1.5);
  }
  for (let z = 0; z < CAR_LEN; z += 2.08) { g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(r.x + (z / CAR_LEN) * r.w, r.y, 2, r.h); }
  for (let i = 0; i < 700; i++) { g.fillStyle = `rgba(50,45,40,${0.05 + R() * 0.1})`; g.fillRect(r.x + R() * r.w, r.y + R() * r.h, 2 + R() * 3, 1 + R() * 2); }
  // walkway center (lighter)
  const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(r.x, r.y, r.w, r.h);
}

function drawPlate(g, ge, r, text, lit) {
  g.fillStyle = '#101014'; rr(g, r.x, r.y, r.w, r.h, 6); g.fill();
  g.fillStyle = '#1d1d24'; rr(g, r.x + 4, r.y + 4, r.w - 8, r.h - 8, 4); g.fill();
  // LED dot grid
  g.fillStyle = 'rgba(255,255,255,0.04)';
  for (let x = r.x + 6; x < r.x + r.w - 5; x += 4) for (let y = r.y + 6; y < r.y + r.h - 5; y += 4) g.fillRect(x, y, 2, 2);
  g.font = `bold ${Math.round(r.h * 0.7)}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = lit ? '#ffc43d' : '#8a5a1c';
  g.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 1);
  g.textAlign = 'left';
  if (lit) {
    ge.font = g.font; ge.textAlign = 'center'; ge.textBaseline = 'middle';
    ge.fillStyle = '#ffae2a'; ge.fillText(text, r.x + r.w / 2, r.y + r.h / 2 + 1);
    ge.textAlign = 'left';
  }
}

function drawLamp(g, ge, r, c0, c1, lit, em) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  const gr = g.createRadialGradient(cx - r.w * 0.1, cy - r.h * 0.1, 1, cx, cy, r.w * 0.7);
  gr.addColorStop(0, c0); gr.addColorStop(1, c1);
  g.fillStyle = gr; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  if (!lit) { g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(cx - r.w * 0.18, cy - r.h * 0.18, r.w * 0.1, 0, 7); g.fill(); }
  if (lit) { ge.fillStyle = em || '#fff4d0'; ge.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); }
}

function drawBellows(g, r) {
  g.fillStyle = '#2a2b31'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  for (let x = r.x; x < r.x + r.w; x += 10) { g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x, r.y, 3, r.h); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 5, r.y, 3, r.h); }
}
function drawGlass(g, r) {
  const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h);
  gr.addColorStop(0, '#7fa2c2'); gr.addColorStop(0.5, '#2c4665'); gr.addColorStop(1, '#16223a');
  g.fillStyle = gr; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
}
function drawGrille(g, r) {
  g.fillStyle = '#2b2d33'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  for (let y = r.y + 4; y < r.y + r.h; y += 9) { g.fillStyle = '#4a4d56'; g.fillRect(r.x, y, r.w, 4); g.fillStyle = '#17181c'; g.fillRect(r.x, y + 4, r.w, 2); }
}

function drawCab(g, r, L, idx) {
  const X = (x) => r.x + ((x + HALF_W) / (2 * HALF_W)) * r.w;
  const Y = (y) => r.y + r.h * (1 - (y - BODY_BOTTOM) / (ROOF_Y - BODY_BOTTOM));
  const pxm = r.w / (2 * HALF_W);
  g.save();
  g.beginPath(); g.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); g.clip();
  g.fillStyle = L.base; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  // roof crown
  let gr = g.createLinearGradient(0, Y(ROOF_Y), 0, Y(2.9));
  gr.addColorStop(0, shade(L.upper, -0.12)); gr.addColorStop(1, L.upper);
  g.fillStyle = gr; g.fillRect(r.x - 4, r.y - 4, r.w + 8, Y(2.92) - r.y + 4);
  // upper cream / band around windshield for cream liveries
  if (L.style === 'cream') { g.fillStyle = L.band; g.fillRect(r.x - 4, Y(2.9), r.w + 8, Y(CAB.winY0 - 0.12) - Y(2.9)); }
  else { g.fillStyle = shade(L.base, -0.05); g.fillRect(r.x - 4, Y(2.9), r.w + 8, Y(CAB.winY0 - 0.12) - Y(2.9)); }
  // accent band + emblem
  g.fillStyle = L.stripe; g.fillRect(r.x - 4, Y(CAB.bandY1 + 0.05), r.w + 8, Y(CAB.bandY1) - Y(CAB.bandY1 + 0.05));
  g.fillStyle = L.accent; g.fillRect(r.x - 4, Y(CAB.bandY1), r.w + 8, Y(CAB.bandY0) - Y(CAB.bandY1));
  drawLogo(g, X(0), Y((CAB.bandY0 + CAB.bandY1) / 2), 0.15 * pxm, L);
  // skirt with hazard chevrons
  const ys = Y(CAB.skirtY1), yb = r.y + r.h + 4;
  g.fillStyle = '#2a2b31'; g.fillRect(r.x - 4, ys, r.w + 8, yb - ys);
  g.save(); g.beginPath(); g.rect(r.x + 8, ys + 4, r.w - 16, Y(BODY_BOTTOM + 0.06) - ys - 4); g.clip();
  g.fillStyle = '#ffcc2a'; g.fillRect(r.x, ys, r.w, yb - ys);
  g.fillStyle = '#1d1d22';
  const cx = X(0);
  for (let k = -12; k < 12; k++) {
    const x = cx + k * 26;
    g.beginPath();
    if (k < 0) { g.moveTo(x, yb); g.lineTo(x + 13, yb); g.lineTo(x + 13 + 40, ys); g.lineTo(x + 40, ys); }
    else { g.moveTo(x, ys); g.lineTo(x + 13, ys); g.lineTo(x + 13 + 40, yb); g.lineTo(x + 40, yb); }
    g.fill();
  }
  g.restore();
  // windshield
  const wx0 = X(-CAB.winX), wx1 = X(CAB.winX), wy0 = Y(CAB.winY1), wy1 = Y(CAB.winY0);
  g.fillStyle = '#121318'; rr(g, wx0 - 7, wy0 - 7, wx1 - wx0 + 14, wy1 - wy0 + 14, CAB.winR * pxm + 7); g.fill();
  gr = g.createLinearGradient(wx0, wy0, wx0 + (wx1 - wx0) * 0.35, wy1);
  gr.addColorStop(0, '#86aacb'); gr.addColorStop(0.5, '#34506f'); gr.addColorStop(1, '#1a2740');
  g.fillStyle = gr; rr(g, wx0, wy0, wx1 - wx0, wy1 - wy0, CAB.winR * pxm); g.fill();
  g.save(); rr(g, wx0, wy0, wx1 - wx0, wy1 - wy0, CAB.winR * pxm); g.clip();
  g.fillStyle = 'rgba(12,18,30,0.4)'; g.fillRect(wx0, wy0 + (wy1 - wy0) * 0.66, wx1 - wx0, wy1 - wy0);    // dashboard
  g.fillStyle = 'rgba(255,255,255,0.32)';
  g.beginPath(); g.moveTo(wx0 + 28, wy0); g.lineTo(wx0 + 58, wy0); g.lineTo(wx0 + 18, wy1); g.lineTo(wx0 - 12, wy1); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.beginPath(); g.moveTo(wx0 + 72, wy0); g.lineTo(wx0 + 84, wy0); g.lineTo(wx0 + 44, wy1); g.lineTo(wx0 + 32, wy1); g.fill();
  g.restore();
  // wipers
  g.strokeStyle = '#18191e'; g.lineWidth = 3;
  g.beginPath(); g.moveTo(X(-0.35), wy1 - 3); g.lineTo(X(-0.62), wy1 - 44); g.stroke();
  g.beginPath(); g.moveTo(X(0.35), wy1 - 3); g.lineTo(X(0.08), wy1 - 44); g.stroke();
  // number board recess
  g.fillStyle = '#0d0d11'; rr(g, X(-CAB.plateX - 0.04), Y(CAB.plateY1 + 0.03), X(CAB.plateX + 0.04) - X(-CAB.plateX - 0.04), Y(CAB.plateY0 - 0.03) - Y(CAB.plateY1 + 0.03), 5); g.fill();
  // headlight + taillight housings
  for (const s of [-1, 1]) {
    const lx = X(s * CAB.lampX), ly = Y(CAB.lampY);
    g.fillStyle = '#c9ced6'; g.beginPath(); g.arc(lx, ly, (CAB.lampR + 0.05) * pxm, 0, 7); g.fill();
    g.fillStyle = '#1a1b20'; g.beginPath(); g.arc(lx, ly, (CAB.lampR + 0.02) * pxm, 0, 7); g.fill();
    const tx = X(s * CAB.tailX);
    g.fillStyle = '#1a1b20'; g.beginPath(); g.arc(tx, ly, (CAB.tailR + 0.025) * pxm, 0, 7); g.fill();
  }
  // grab handles near the edges
  g.fillStyle = '#d7dbe0';
  for (const s of [-1, 1]) g.fillRect(X(s * 1.03) - 2, Y(2.45), 4, Y(1.85) - Y(2.45));
  // edge vignette for roundness
  gr = g.createLinearGradient(r.x, 0, r.x + r.w, 0);
  gr.addColorStop(0, 'rgba(0,0,0,0.28)'); gr.addColorStop(0.12, 'rgba(0,0,0,0)'); gr.addColorStop(0.88, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.28)');
  g.fillStyle = gr; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  const R = mulberry(555 + idx);
  for (let i = 0; i < 260; i++) { g.fillStyle = `rgba(40,30,20,${0.04 + R() * 0.07})`; g.fillRect(r.x + R() * r.w, r.y + r.h * Math.pow(R(), 0.5), 1.5, 1.5); }
  g.restore();
}

// ===================================================================================== GRAFFITI ATLAS
// 16 original pieces, 512x256 each, transparent background (alpha-tested decals on train sides).
export const GRAFFITI_COUNT = 16;
export function buildGraffitiAtlas(quality = 'high') {
  const scale = quality === 'low' ? 0.5 : 1;
  const W = 2048, H = 1024;
  const c = makeCanvas(W * scale, H * scale);
  const g = c.getContext('2d');
  g.scale(scale, scale);
  const A = new Atlas(W, H, 0);
  for (let i = 0; i < GRAFFITI_COUNT; i++) A.r['g' + i] = { name: 'g' + i, x: (i % 4) * 512, y: Math.floor(i / 4) * 256, w: 512, h: 256 };
  const pieces = [
    (g, R) => bubbleWord(g, 'RAIL DASH', ['#ff4fa3', '#ff9bd0'], '#1b1238', R, { size: 92, drips: true }),
    (g, R) => bubbleWord(g, 'ZOOM', ['#ffb020', '#ffe45c'], '#2a1030', R, { size: 128, speed: true }),
    (g, R) => bubbleWord(g, 'RUN!', ['#8edc4a', '#d6ff7a'], '#10301a', R, { size: 132, block: '#0c5a2c' }),
    (g, R) => bubbleWord(g, 'TAG', ['#29c6ff', '#b8f0ff'], '#0c1c48', R, { size: 150, drips: true }),
    (g, R) => starBurst(g, 'WOW', R),
    (g, R) => bigArrow(g, R),
    (g, R) => speech(g, 'YO!', R),
    (g, R) => crownWord(g, 'KING', R),
    (g, R) => bubbleWord(g, 'GO GO', ['#ff5a3c', '#ffd0b0'], '#2b0d0d', R, { size: 110, block: '#7a1a10' }),
    (g, R) => bubbleWord(g, 'DASH', ['#d9e3ee', '#ffffff'], '#101018', R, { size: 136, chrome: true }),
    (g, R) => heartTag(g, R),
    (g, R) => zapTag(g, R),
    (g, R) => swirls(g, R),
    (g, R) => bubbleWord(g, 'FAST', ['#ff3d6e', '#ffc23a'], '#1b1238', R, { size: 128, flames: true }),
    (g, R) => smiley(g, R),
    (g, R) => bubbleWord(g, 'COOL', ['#b86bff', '#ecc9ff'], '#1a0b33', R, { size: 128, drips: true, block: '#4b1d8a' }),
  ];
  pieces.forEach((fn, i) => {
    const r = A.get('g' + i);
    g.save(); g.translate(r.x, r.y);
    g.beginPath(); g.rect(2, 2, 508, 252); g.clip();
    fn(g, mulberry(9001 + i * 31));
    g.restore();
  });
  const map = toTexture(c, { aniso: 8 });
  return { atlas: A, map };
}

function bubbleWord(g, text, [c0, c1], ink, R, o = {}) {
  const size = o.size || 110;
  g.save();
  g.font = `900 ${size}px ${FONT}`;
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  // measure letters
  const letters = [...text];
  const widths = letters.map((ch) => (ch === ' ' ? size * 0.3 : g.measureText(ch).width * 0.86));
  let total = widths.reduce((a, b) => a + b, 0);
  const k = Math.min(1, 460 / total);
  g.translate(256, 132);
  g.scale(k, k);
  g.rotate((R() - 0.5) * 0.12);
  let x = -total / 2;
  const pos = letters.map((ch, i) => { const p = { ch, x: x + widths[i] / 2, y: (R() - 0.5) * size * 0.16, rot: (R() - 0.5) * 0.3, s: 0.92 + R() * 0.16 }; x += widths[i]; return p; });
  if (o.speed) { // speed lines behind
    g.strokeStyle = ink; g.lineWidth = 9; g.lineCap = 'round';
    for (let i = 0; i < 4; i++) { const y = -size * 0.35 + i * size * 0.23; g.beginPath(); g.moveTo(-total / 2 - 120, y); g.lineTo(-total / 2 - 20, y); g.stroke(); }
  }
  if (o.flames) {
    for (const p of pos) { if (p.ch === ' ') continue; g.fillStyle = '#ff7a1a'; g.beginPath(); g.moveTo(p.x - 30, size * 0.3); g.quadraticCurveTo(p.x - 10, size * 0.9 + R() * 20, p.x + 5, size * 0.3); g.fill(); }
  }
  const each = (fn) => { for (const p of pos) { if (p.ch === ' ') continue; g.save(); g.translate(p.x, p.y); g.rotate(p.rot); g.scale(p.s, p.s); fn(p); g.restore(); } };
  // 3D block / drop shadow
  if (o.block) { for (let d = 14; d > 0; d -= 2) each((p) => { g.fillStyle = o.block; g.fillText(p.ch, -g.measureText(p.ch).width / 2 + d, d); }); }
  // outer ink outline
  each((p) => { g.strokeStyle = ink; g.lineWidth = size * 0.26; g.strokeText(p.ch, -g.measureText(p.ch).width / 2, 0); });
  // white rim
  each((p) => { g.strokeStyle = '#ffffff'; g.lineWidth = size * 0.1; g.strokeText(p.ch, -g.measureText(p.ch).width / 2, 0); });
  // fill gradient
  each((p) => {
    const gr = g.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
    if (o.chrome) { gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.45, '#aab6c4'); gr.addColorStop(0.55, '#5d6b7c'); gr.addColorStop(1, '#e8eef5'); }
    else { gr.addColorStop(0, c1); gr.addColorStop(1, c0); }
    g.fillStyle = gr; g.fillText(p.ch, -g.measureText(p.ch).width / 2, 0);
  });
  // highlights
  each((p) => { g.fillStyle = 'rgba(255,255,255,0.75)'; g.beginPath(); g.ellipse(-g.measureText(p.ch).width * 0.18, -size * 0.2, size * 0.07, size * 0.035, -0.5, 0, 7); g.fill(); });
  if (o.drips) {
    for (const p of pos) {
      if (p.ch === ' ' || R() < 0.35) continue;
      const dx = p.x + (R() - 0.5) * size * 0.4, len = size * (0.25 + R() * 0.45);
      g.fillStyle = c0; g.strokeStyle = ink; g.lineWidth = 5;
      g.beginPath(); g.moveTo(dx - 6, size * 0.3); g.lineTo(dx - 6, size * 0.3 + len); g.arc(dx, size * 0.3 + len, 6, Math.PI, 0, true); g.lineTo(dx + 6, size * 0.3); g.closePath(); g.stroke(); g.fill();
    }
  }
  // sparkles
  for (let i = 0; i < 3; i++) { g.fillStyle = '#ffffff'; star(g, (R() - 0.5) * total, (R() - 0.5) * size * 1.1, 14, 4, 4, 0); g.fill(); }
  g.restore();
}

function starBurst(g, text, R) {
  g.save(); g.translate(256, 128);
  g.fillStyle = '#1b1238'; star(g, 0, 0, 125, 72, 12, R()); g.fill();
  g.fillStyle = '#ffd23f'; star(g, 0, 0, 110, 62, 12, R() * 0.2); g.fill();
  g.fillStyle = '#ff4fa3'; star(g, 0, 0, 80, 50, 12, 0.13); g.fill();
  g.font = `900 70px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
  g.strokeStyle = '#1b1238'; g.lineWidth = 14; g.strokeText(text, 0, 4);
  g.fillStyle = '#ffffff'; g.fillText(text, 0, 4);
  g.restore();
  for (let i = 0; i < 5; i++) { g.fillStyle = i % 2 ? '#29c6ff' : '#c6ff3d'; star(g, 40 + R() * 430, 20 + R() * 210, 16, 6, 4, 0); g.fill(); }
}
function bigArrow(g, R) {
  g.save(); g.translate(256, 128); g.rotate(-0.12 + R() * 0.1);
  const path = () => { g.beginPath(); g.moveTo(-210, 30); g.bezierCurveTo(-120, -80, 20, 60, 120, -10); g.lineTo(100, -50); g.lineTo(215, -20); g.lineTo(150, 80); g.lineTo(140, 35); g.bezierCurveTo(30, 110, -110, -20, -190, 75); g.closePath(); };
  path(); g.lineJoin = 'round'; g.strokeStyle = '#1b1238'; g.lineWidth = 22; g.stroke();
  const gr = g.createLinearGradient(-200, 0, 200, 0); gr.addColorStop(0, '#b86bff'); gr.addColorStop(1, '#ff4fa3');
  path(); g.fillStyle = gr; g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 6; g.beginPath(); g.moveTo(-170, 20); g.bezierCurveTo(-100, -50, 10, 40, 100, -12); g.stroke();
  g.restore();
}
function speech(g, text, R) {
  g.save(); g.translate(256, 118);
  g.beginPath(); g.ellipse(0, 0, 170, 92, 0, 0, 7); g.moveTo(-60, 70); g.lineTo(-110, 130); g.lineTo(-10, 84);
  g.lineJoin = 'round'; g.strokeStyle = '#1b1238'; g.lineWidth = 16; g.stroke(); g.fillStyle = '#ffffff'; g.fill();
  g.font = `900 104px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#FF4FA3'; g.strokeStyle = '#1b1238'; g.lineWidth = 10; g.strokeText(text, 0, 6); g.fillText(text, 0, 6);
  g.restore(); void R;
}
function crownWord(g, text, R) {
  g.save(); g.translate(256, 150);
  g.fillStyle = '#ffd23f'; g.strokeStyle = '#1b1238'; g.lineWidth = 10; g.lineJoin = 'round';
  g.beginPath(); g.moveTo(-90, -40); g.lineTo(-70, -120); g.lineTo(-30, -70); g.lineTo(0, -135); g.lineTo(30, -70); g.lineTo(70, -120); g.lineTo(90, -40); g.closePath(); g.stroke(); g.fill();
  for (const x of [-70, 0, 70]) { g.fillStyle = '#ff4fa3'; g.beginPath(); g.arc(x, x === 0 ? -135 : -120, 10, 0, 7); g.fill(); g.stroke(); }
  g.font = `900 92px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = 20; g.strokeStyle = '#1b1238'; g.strokeText(text, 0, 20);
  const gr = g.createLinearGradient(0, -20, 0, 60); gr.addColorStop(0, '#fff6b0'); gr.addColorStop(1, '#ffb020');
  g.fillStyle = gr; g.fillText(text, 0, 20);
  g.restore(); void R;
}
function heartTag(g, R) {
  g.save(); g.translate(256, 128);
  const heart = (s) => { g.beginPath(); g.moveTo(0, 70 * s); g.bezierCurveTo(-150 * s, -20 * s, -80 * s, -120 * s, 0, -50 * s); g.bezierCurveTo(80 * s, -120 * s, 150 * s, -20 * s, 0, 70 * s); g.closePath(); };
  heart(1.25); g.fillStyle = '#1b1238'; g.fill();
  heart(1.1); g.fillStyle = '#ff3d6e'; g.fill();
  g.font = `900 70px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#ffffff'; g.fillText('RD', 0, -8);
  g.fillStyle = 'rgba(255,255,255,0.5)'; g.beginPath(); g.ellipse(-60, -60, 18, 10, -0.6, 0, 7); g.fill();
  g.restore();
  g.strokeStyle = '#ffd23f'; g.lineWidth = 6; for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(80 + i * 170 + R() * 30, 40 + R() * 170, 14, 0, 5); g.stroke(); }
}
function zapTag(g, R) {
  g.save(); g.translate(256, 128);
  g.fillStyle = '#6a2fd8'; g.beginPath(); g.ellipse(0, 0, 200, 105, -0.08, 0, 7); g.fill();
  g.strokeStyle = '#1b1238'; g.lineWidth = 12; g.stroke();
  g.beginPath(); g.moveTo(-40, -95); g.lineTo(40, -95); g.lineTo(5, -15); g.lineTo(60, -15); g.lineTo(-40, 100); g.lineTo(-10, 10); g.lineTo(-60, 10); g.closePath();
  g.lineJoin = 'round'; g.lineWidth = 12; g.stroke(); g.fillStyle = '#ffe44d'; g.fill();
  g.font = `900 64px ${FONT}`; g.textBaseline = 'middle'; g.fillStyle = '#c6ff3d';
  g.strokeStyle = '#1b1238'; g.lineWidth = 10; g.strokeText('ZAP', 70, 40); g.fillText('ZAP', 70, 40);
  g.restore(); void R;
}
function swirls(g, R) {
  const cols = ['#29c6ff', '#ff4fa3', '#c6ff3d', '#ffd23f'];
  g.lineCap = 'round';
  for (let i = 0; i < 6; i++) {
    const x = 60 + R() * 390, y = 50 + R() * 150, rad = 30 + R() * 50;
    g.lineWidth = 22; g.strokeStyle = '#1b1238'; g.beginPath(); g.arc(x, y, rad, R() * 6, R() * 6 + 4); g.stroke();
    g.lineWidth = 12; g.strokeStyle = cols[i % 4]; g.stroke();
  }
  for (let i = 0; i < 6; i++) { g.fillStyle = '#ffffff'; star(g, 30 + R() * 450, 20 + R() * 210, 14, 5, 4, 0); g.fill(); }
}
function smiley(g, R) {
  g.save(); g.translate(256, 128);
  g.fillStyle = '#1b1238'; g.beginPath(); g.arc(0, 0, 112, 0, 7); g.fill();
  const gr = g.createRadialGradient(-30, -40, 10, 0, 0, 105); gr.addColorStop(0, '#fff27a'); gr.addColorStop(1, '#ffc21a');
  g.fillStyle = gr; g.beginPath(); g.arc(0, 0, 100, 0, 7); g.fill();
  g.fillStyle = '#1b1238';
  g.beginPath(); g.ellipse(-36, -25, 13, 22, 0, 0, 7); g.fill();
  g.beginPath(); g.moveTo(22, -25); g.lineTo(55, -32); g.lineWidth = 12; g.strokeStyle = '#1b1238'; g.lineCap = 'round'; g.stroke();   // wink
  g.lineWidth = 13; g.beginPath(); g.arc(0, 10, 58, 0.25, Math.PI - 0.25); g.stroke();
  g.fillStyle = '#ff4fa3'; g.beginPath(); g.ellipse(15, 62, 18, 14, 0, 0, Math.PI); g.fill();
  g.restore();
  g.font = `900 40px ${FONT}`; g.fillStyle = '#ffffff'; g.strokeStyle = '#1b1238'; g.lineWidth = 8;
  g.strokeText('HI!', 380, 60 + R() * 20); g.fillText('HI!', 380, 60 + R() * 2);
}

// ===================================================================================== PROPS ATLAS
export function buildPropsAtlas(quality = 'high') {
  const scale = quality === 'low' ? 0.5 : 1;
  const W = 1024, H = 1024;
  const A = new Atlas(W, H);
  const put = (name, x, y, w, h) => (A.r[name] = { name, x, y, w, h });
  put('white', 8, 8, 96, 96);
  put('redOff', 112, 8, 40, 40); put('redLit', 160, 8, 40, 40); put('amberOff', 208, 8, 40, 40); put('amberLit', 256, 8, 40, 40);
  put('hazard', 304, 8, 400, 48);
  put('hazardV', 712, 8, 48, 300);
  put('deck', 8, 112, 240, 640);
  put('plank', 272, 112, 420, 56);
  put('duck', 272, 184, 420, 290);
  put('signBack', 272, 490, 420, 120);
  put('stop', 776, 8, 128, 128);
  put('wood', 776, 150, 220, 70);
  put('diamond', 776, 230, 220, 220);
  put('metal', 272, 626, 300, 90);

  const { c, g, e, ge } = makePair(W, H, scale, 0.25);
  g.fillStyle = '#888'; g.fillRect(0, 0, W, H);
  fillRegion(g, A.get('white'), '#ffffff');
  drawLamp(g, ge, A.get('redOff'), '#e0413a', '#7a1616', false);
  drawLamp(g, ge, A.get('redLit'), '#ff7466', '#ff2a1a', true, '#ff1a0a');
  drawLamp(g, ge, A.get('amberOff'), '#ffcc55', '#b87a10', false);
  const al = A.get('amberLit'); drawLamp(g, ge, al, '#fff0a0', '#ffb020', false); ge.fillStyle = '#ffb020'; ge.fillRect(al.x - 4, al.y - 4, al.w + 8, al.h + 8);
  hazardStripes(g, A.get('hazard'), '#ffc21a', '#1d1d22', 30, false);
  hazardStripes(g, A.get('hazardV'), '#ffc21a', '#1d1d22', 30, true);
  drawDeck(g, A.get('deck'));
  drawPlank(g, A.get('plank'));
  drawDuck(g, A.get('duck'));
  drawSignBack(g, A.get('signBack'));
  drawStop(g, A.get('stop'));
  drawWood(g, A.get('wood'));
  drawDiamond(g, A.get('diamond'));
  drawMetal(g, A.get('metal'));
  return { atlas: A, map: toTexture(c, { aniso: 8 }), emissiveMap: toTexture(e, { aniso: 1 }) };
}

function hazardStripes(g, r, c0, c1, w, vertical) {
  g.save(); g.beginPath(); g.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); g.clip();
  g.fillStyle = c0; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  g.fillStyle = c1;
  const L = Math.max(r.w, r.h) + 60;
  for (let k = -L; k < L; k += w * 2) {
    g.beginPath();
    if (!vertical) { g.moveTo(r.x + k, r.y + r.h + 4); g.lineTo(r.x + k + w, r.y + r.h + 4); g.lineTo(r.x + k + w + r.h + 8, r.y - 4); g.lineTo(r.x + k + r.h + 8, r.y - 4); }
    else { g.moveTo(r.x - 4, r.y + k); g.lineTo(r.x - 4, r.y + k + w); g.lineTo(r.x + r.w + 4, r.y + k + w + r.w + 8); g.lineTo(r.x + r.w + 4, r.y + k + r.w + 8); }
    g.fill();
  }
  // wear
  const R = mulberry(r.x * 13 + r.y);
  for (let i = 0; i < 120; i++) { g.fillStyle = `rgba(60,50,40,${0.06 + R() * 0.12})`; g.fillRect(r.x + R() * r.w, r.y + R() * r.h, 1 + R() * 3, 1 + R() * 3); }
  g.restore();
}
function drawDeck(g, r) {
  g.save(); g.beginPath(); g.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); g.clip();
  // diamond plate base
  g.fillStyle = '#f2a524'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  for (let y = r.y; y < r.y + r.h; y += 14) for (let x = r.x + ((y / 14) % 2 ? 7 : 0); x < r.x + r.w; x += 14) {
    g.fillStyle = 'rgba(120,60,0,0.35)'; g.beginPath(); g.ellipse(x + 1, y + 1, 5, 1.8, 0.8, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,240,190,0.45)'; g.beginPath(); g.ellipse(x, y, 5, 1.6, 0.8, 0, 7); g.fill();
  }
  // hazard edges (left/right) + bottom lip
  const ew = 26;
  for (const x0 of [r.x - 4, r.x + r.w - ew + 4]) hazardStripes(g, { x: x0 + 4, y: r.y, w: ew - 4, h: r.h }, '#ffd23a', '#1d1d22', 16, true);
  hazardStripes(g, { x: r.x, y: r.y + r.h - 34, w: r.w, h: 34 }, '#ffd23a', '#1d1d22', 16, false);
  // chevrons pointing up the ramp
  g.fillStyle = 'rgba(255,255,255,0.9)';
  for (let k = 0; k < 4; k++) {
    const cy = r.y + 90 + k * 140, cx = r.x + r.w / 2;
    g.beginPath(); g.moveTo(cx - 60, cy + 40); g.lineTo(cx, cy - 12); g.lineTo(cx + 60, cy + 40); g.lineTo(cx + 60, cy + 70); g.lineTo(cx, cy + 18); g.lineTo(cx - 60, cy + 70); g.closePath(); g.fill();
  }
  // wear + bolts
  const R = mulberry(77);
  for (let i = 0; i < 500; i++) { g.fillStyle = `rgba(70,40,10,${0.05 + R() * 0.12})`; g.fillRect(r.x + R() * r.w, r.y + R() * r.h, 1 + R() * 4, 1 + R() * 3); }
  g.fillStyle = '#5a3a10';
  for (let y = r.y + 40; y < r.y + r.h - 30; y += 80) for (const x of [r.x + 34, r.x + r.w - 34]) { g.beginPath(); g.arc(x, y, 3.5, 0, 7); g.fill(); }
  g.restore();
}
function drawPlank(g, r) {
  g.save(); g.beginPath(); g.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); g.clip();
  g.fillStyle = '#ffffff'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  g.fillStyle = '#e8232f';
  for (let k = -80; k < r.w + 80; k += 64) { g.beginPath(); g.moveTo(r.x + k, r.y + r.h + 4); g.lineTo(r.x + k + 32, r.y + r.h + 4); g.lineTo(r.x + k + 32 + r.h + 8, r.y - 4); g.lineTo(r.x + k + r.h + 8, r.y - 4); g.fill(); }
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 4; g.strokeRect(r.x + 1, r.y + 1, r.w - 2, r.h - 2);
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.fillRect(r.x, r.y + 4, r.w, 4);
  const R = mulberry(5);
  for (let i = 0; i < 160; i++) { g.fillStyle = `rgba(60,40,30,${0.05 + R() * 0.12})`; g.fillRect(r.x + R() * r.w, r.y + R() * r.h, 1 + R() * 3, 1 + R() * 2); }
  g.restore();
}
function drawDuck(g, r) {
  g.save(); g.beginPath(); g.rect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); g.clip();
  // bottom striped bar (the part you slide under)
  const barH = r.h * 0.22;
  g.fillStyle = '#ffffff'; g.fillRect(r.x - 4, r.y + r.h - barH, r.w + 8, barH + 4);
  g.fillStyle = '#e8232f';
  for (let k = -80; k < r.w + 80; k += 60) { g.beginPath(); g.moveTo(r.x + k, r.y + r.h + 4); g.lineTo(r.x + k + 30, r.y + r.h + 4); g.lineTo(r.x + k + 30 + barH, r.y + r.h - barH); g.lineTo(r.x + k + barH, r.y + r.h - barH); g.fill(); }
  // sign panel
  const sy = r.y - 4, sh = r.h - barH + 4;
  g.fillStyle = '#1d1d22'; g.fillRect(r.x - 4, sy, r.w + 8, sh);
  g.fillStyle = '#ffcf2e'; rr(g, r.x + 10, sy + 12, r.w - 20, sh - 24, 16); g.fill();
  g.fillStyle = '#1d1d22'; rr(g, r.x + 20, sy + 22, r.w - 40, sh - 44, 12); g.fill();
  g.fillStyle = '#ffcf2e'; rr(g, r.x + 26, sy + 28, r.w - 52, sh - 56, 10); g.fill();
  g.font = `900 ${Math.round(sh * 0.4)}px ${FONT}`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillStyle = '#1d1d22';
  g.fillText('DUCK!', r.x + r.w * 0.44, sy + sh * 0.5);
  // down arrow
  const ax = r.x + r.w * 0.86, ay = sy + sh * 0.5;
  g.beginPath(); g.moveTo(ax - 18, ay - 50); g.lineTo(ax + 18, ay - 50); g.lineTo(ax + 18, ay); g.lineTo(ax + 40, ay); g.lineTo(ax, ay + 52); g.lineTo(ax - 40, ay); g.lineTo(ax - 18, ay); g.closePath(); g.fill();
  g.textAlign = 'left';
  g.restore();
}
function drawSignBack(g, r) {
  g.fillStyle = '#e2b41f'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  g.fillStyle = 'rgba(0,0,0,0.18)'; for (let y = r.y + 10; y < r.y + r.h; y += 22) g.fillRect(r.x, y, r.w, 3);
}
function drawStop(g, r) {
  const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
  g.fillStyle = '#ffffff'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  g.fillStyle = '#1d1d22'; g.beginPath(); g.arc(cx, cy, r.w * 0.48, 0, 7); g.fill();
  g.fillStyle = '#e8232f'; g.beginPath(); g.arc(cx, cy, r.w * 0.43, 0, 7); g.fill();
  g.fillStyle = '#ffffff'; rr(g, cx - r.w * 0.3, cy - r.h * 0.08, r.w * 0.6, r.h * 0.16, 4); g.fill();
}
function drawWood(g, r) {
  g.fillStyle = '#7a5130'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  const R = mulberry(3);
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(${40 + R() * 40},${25 + R() * 20},10,0.35)`; g.fillRect(r.x, r.y + R() * r.h, r.w, 1 + R() * 2); }
}
function drawDiamond(g, r) {
  g.fillStyle = '#9aa1ab'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
  for (let y = r.y; y < r.y + r.h; y += 12) for (let x = r.x + ((y / 12) % 2 ? 6 : 0); x < r.x + r.w; x += 12) {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.beginPath(); g.ellipse(x + 1, y + 1, 4, 1.5, 0.8, 0, 7); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(x, y, 4, 1.4, 0.8, 0, 7); g.fill();
  }
}
function drawMetal(g, r) {
  const gr = g.createLinearGradient(0, r.y, 0, r.y + r.h);
  gr.addColorStop(0, '#d8dde3'); gr.addColorStop(0.5, '#9aa2ad'); gr.addColorStop(1, '#6d7580');
  g.fillStyle = gr; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
}

// ===================================================================================== PICKUP ATLAS
export function buildPickupAtlas(quality = 'high') {
  const scale = quality === 'low' ? 0.5 : 1;
  const W = 512, H = 512;
  const A = new Atlas(W, H);
  const put = (name, x, y, w, h) => (A.r[name] = { name, x, y, w, h });
  put('white', 8, 8, 60, 60); put('glow', 76, 8, 60, 60); put('stripes', 144, 8, 200, 60); put('metal', 352, 8, 150, 60);
  put('x2', 8, 80, 128, 128); put('q', 144, 80, 128, 128); put('star', 280, 80, 128, 128); put('token', 416, 80, 88, 88);
  for (let i = 0; i < 26; i++) put('L' + String.fromCharCode(65 + i), 8 + (i % 8) * 62, 216 + Math.floor(i / 8) * 62, 56, 56);
  const { c, g, e, ge } = makePair(W, H, scale, 0.25);
  g.fillStyle = '#888'; g.fillRect(0, 0, W, H);
  fillRegion(g, A.get('white'), '#ffffff');
  fillRegion(g, A.get('glow'), '#ffffff');
  { const r = A.get('glow'); ge.fillStyle = '#ffffff'; ge.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); }
  { const r = A.get('stripes'); g.fillStyle = '#ffffff'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); g.fillStyle = '#d8d8e0'; for (let x = r.x; x < r.x + r.w; x += 24) g.fillRect(x, r.y - 4, 12, r.h + 8); }
  drawMetal(g, A.get('metal'));
  // 2X badge face
  {
    const r = A.get('x2'), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    g.fillStyle = '#ffd23f'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    g.fillStyle = '#ff9f1a'; star(g, cx, cy, 60, 50, 16, 0); g.fill();
    g.fillStyle = '#ffe36b'; g.beginPath(); g.arc(cx, cy, 46, 0, 7); g.fill();
    g.font = `900 54px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.strokeStyle = '#1b1238'; g.lineWidth = 10; g.strokeText('2X', cx, cy + 3);
    g.fillStyle = '#ffffff'; g.fillText('2X', cx, cy + 3);
    g.textAlign = 'left';
  }
  // mystery box face
  {
    const r = A.get('q'), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const gr = g.createLinearGradient(r.x, r.y, r.x + r.w, r.y + r.h); gr.addColorStop(0, '#9b6bff'); gr.addColorStop(1, '#5a2bd0');
    g.fillStyle = gr; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    g.strokeStyle = '#ffd23f'; g.lineWidth = 10; g.strokeRect(r.x + 6, r.y + 6, r.w - 12, r.h - 12);
    g.font = `900 84px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.strokeStyle = '#1b1238'; g.lineWidth = 12; g.strokeText('?', cx, cy + 4);
    g.fillStyle = '#ffffff'; g.fillText('?', cx, cy + 4);
    g.textAlign = 'left';
  }
  // star token face
  {
    const r = A.get('star'), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    g.fillStyle = '#ff4fa3'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 58, 0, 7); g.fill();
    g.fillStyle = '#ff4fa3'; g.beginPath(); g.arc(cx, cy, 52, 0, 7); g.fill();
    g.fillStyle = '#fff36b'; star(g, cx, cy + 3, 40, 17, 5); g.fill();
    g.strokeStyle = '#1b1238'; g.lineWidth = 4; g.stroke();
  }
  { const r = A.get('token'); g.fillStyle = '#ffd23f'; g.fillRect(r.x - 4, r.y - 4, r.w + 8, r.h + 8); }
  // letters
  for (let i = 0; i < 26; i++) {
    const ch = String.fromCharCode(65 + i), r = A.get('L' + ch), cx = r.x + r.w / 2, cy = r.y + r.h / 2;
    const gr = g.createLinearGradient(r.x, r.y, r.x, r.y + r.h); gr.addColorStop(0, '#39e0ff'); gr.addColorStop(1, '#1f8fe0');
    g.fillStyle = gr; g.fillRect(r.x - 3, r.y - 3, r.w + 6, r.h + 6);
    g.font = `900 40px ${FONT}`; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.lineJoin = 'round'; g.strokeStyle = '#1b1238'; g.lineWidth = 8; g.strokeText(ch, cx, cy + 2);
    g.fillStyle = '#ffffff'; g.fillText(ch, cx, cy + 2);
    g.textAlign = 'left';
  }
  return { atlas: A, map: toTexture(c, { aniso: 4 }), emissiveMap: toTexture(e, { aniso: 1 }) };
}

// ===================================================================================== COIN
export function buildCoinTextures(quality = 'high') {
  const S = quality === 'low' ? 128 : 256;
  const k = S / 256;
  const draw = (g, bump) => {
    g.scale(k, k);
    const cx = 128, cy = 128;
    if (bump) {
      g.fillStyle = '#000'; g.fillRect(0, 0, 256, 256);
      g.fillStyle = '#909090'; g.beginPath(); g.arc(cx, cy, 124, 0, 7); g.fill();       // face level
      g.fillStyle = '#ffffff'; g.lineWidth = 16; g.strokeStyle = '#ffffff'; g.beginPath(); g.arc(cx, cy, 112, 0, 7); g.stroke();   // raised rim
      g.fillStyle = '#e0e0e0'; star(g, cx, cy + 4, 70, 30, 5); g.fill();                        // raised star
      g.fillStyle = '#b0b0b0'; g.beginPath(); g.arc(cx, cy, 92, 0, 7); g.lineWidth = 5; g.strokeStyle = '#6a6a6a'; g.stroke();
      return;
    }
    let gr = g.createRadialGradient(cx - 30, cy - 40, 10, cx, cy, 130);
    gr.addColorStop(0, '#fff3a0'); gr.addColorStop(0.55, '#ffc21a'); gr.addColorStop(1, '#d88a00');
    g.fillStyle = gr; g.fillRect(0, 0, 256, 256);
    g.lineWidth = 16; g.strokeStyle = '#ffe070'; g.beginPath(); g.arc(cx, cy, 112, 0, 7); g.stroke();
    g.lineWidth = 4; g.strokeStyle = '#c07800'; g.beginPath(); g.arc(cx, cy, 102, 0, 7); g.stroke();
    g.lineWidth = 4; g.strokeStyle = '#b36d00'; g.beginPath(); g.arc(cx, cy, 92, 0, 7); g.stroke();
    gr = g.createLinearGradient(cx, cy - 70, cx, cy + 70); gr.addColorStop(0, '#fff6b8'); gr.addColorStop(1, '#ffb300');
    g.fillStyle = gr; star(g, cx, cy + 4, 70, 30, 5); g.fill();
    g.lineWidth = 5; g.strokeStyle = '#b36d00'; g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.55)'; g.beginPath(); g.ellipse(cx - 40, cy - 52, 26, 10, -0.6, 0, 7); g.fill();
  };
  const c1 = makeCanvas(S, S); draw(c1.getContext('2d'), false);
  const c2 = makeCanvas(S, S); draw(c2.getContext('2d'), true);
  return { map: toTexture(c1, { aniso: 4 }), bumpMap: toTexture(c2, { srgb: false, aniso: 4 }) };
}

// ===================================================================================== GLOWS
export function buildGlowTextures() {
  const rad = makeCanvas(128, 128);
  let g = rad.getContext('2d');
  let gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  // light streaks for flares
  g.globalCompositeOperation = 'lighter';
  gr = g.createLinearGradient(0, 64, 128, 64); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 61, 128, 6);
  const beam = makeCanvas(64, 128);
  g = beam.getContext('2d');
  for (let y = 0; y < 128; y++) {
    const t = y / 127;          // 0 = far end (top), 1 = at the lamps
    const a = Math.pow(t, 1.6) * 0.9;
    const row = g.createLinearGradient(0, 0, 64, 0);
    row.addColorStop(0, 'rgba(255,255,255,0)'); row.addColorStop(0.5, `rgba(255,255,255,${a})`); row.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = row; g.fillRect(0, y, 64, 1);
  }
  return { radial: toTexture(rad, { aniso: 1 }), beam: toTexture(beam, { aniso: 1 }) };
}
