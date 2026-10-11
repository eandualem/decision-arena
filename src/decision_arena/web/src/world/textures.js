// WORLD: procedural texture atlases.
//   * main atlas (opaque, 2048^2): ground, track, walls (neutral tones, tinted by vertex colors), windows, signs,
//     billboards, graffiti, props.
//   * cutout atlas (RGBA, 1024^2): chain-link, railings, trusses, foliage (alpha-tested) + night glow sprites
//     (lit windows, halos, light pools, neon glow) drawn with an additive material.
import * as THREE from 'three';
import { makeCanvas } from '../core/tex.js';
import {
  mulberry, INK, roundRect, star, concreteBase, paintGraffitiPanel, paintBillboard, paintSign, paintSignGlow, paintPoster,
  loadDisplayFont,
} from './graffiti.js';

// ------------------------------------------------------------------ atlas with skyline packing
class Atlas {
  constructor(size, alpha) {
    this.size = size; this.alpha = alpha;
    this.canvas = makeCanvas(size, size);
    this.g = this.canvas.getContext('2d');
    this.list = []; this.map = new Map();
    this.pad = 4;
  }
  add(name, w, h, paint, o = {}) { this.list.push({ name, w, h, paint, wrapX: !!o.wrapX, wrapY: !!o.wrapY, text: !!o.text }); return this; }
  pack() {
    const S = this.size, P = this.pad;
    const items = [...this.list].sort((a, b) => (b.h - a.h) || (b.w - a.w));
    let sky = [{ x: 0, y: 0, w: S }];
    for (const it of items) {
      const W = it.w + P * 2, H = it.h + P * 2;
      let best = null;
      for (let i = 0; i < sky.length; i++) {
        const x = sky[i].x;
        if (x + W > S) break;
        let y = 0, span = 0, j = i;
        while (span < W && j < sky.length) { y = Math.max(y, sky[j].y); span += sky[j].w; j++; }
        if (span < W || y + H > S) continue;
        if (!best || y < best.y || (y === best.y && x < best.x)) best = { x, y, i };
      }
      if (!best) { console.warn('[world] atlas full, dropping region', it.name); it.x = 0; it.y = 0; it.dropped = true; continue; }
      it.x = best.x + P; it.y = best.y + P;
      // update skyline
      const nx = best.x, nw = W, ny = best.y + H;
      const next = [];
      for (const s of sky) {
        const s0 = s.x, s1 = s.x + s.w;
        if (s1 <= nx || s0 >= nx + nw) { next.push(s); continue; }
        if (s0 < nx) next.push({ x: s0, y: s.y, w: nx - s0 });
        if (s1 > nx + nw) next.push({ x: nx + nw, y: s.y, w: s1 - (nx + nw) });
      }
      next.push({ x: nx, y: ny, w: nw });
      next.sort((a, b) => a.x - b.x);
      sky = [];
      for (const s of next) { const l = sky[sky.length - 1]; if (l && l.y === s.y && l.x + l.w === s.x) l.w += s.w; else sky.push({ ...s }); }
    }
    for (const it of this.list) {
      const S2 = this.size;
      it.rect = { u0: it.x / S2, u1: (it.x + it.w) / S2, v0: 1 - (it.y + it.h) / S2, v1: 1 - it.y / S2 };
      this.map.set(it.name, it);
    }
    this.used = items.reduce((a, it) => a + (it.w + 2 * P) * (it.h + 2 * P), 0) / (this.size * this.size);
    return this;
  }
  paintAll(filter = null) {
    const tmp = makeCanvas(8, 8);
    for (const it of this.list) {
      if (it.dropped || (filter && !filter(it))) continue;
      tmp.width = it.w; tmp.height = it.h;
      const tg = tmp.getContext('2d');
      tg.clearRect(0, 0, it.w, it.h);
      tg.save();
      it.paint(tg, it.w, it.h, mulberry(hash(it.name)));
      tg.restore();
      this._blit(tmp, it);
    }
  }
  _blit(src, it) {
    const g = this.g, P = this.pad, { x, y, w, h } = it;
    g.clearRect(x - P, y - P, w + P * 2, h + P * 2);
    g.drawImage(src, x, y);
    // bleed into the padding (wrap-around copy for tiling regions, edge stretch otherwise)
    if (it.wrapX) { g.drawImage(src, w - P, 0, P, h, x - P, y, P, h); g.drawImage(src, 0, 0, P, h, x + w, y, P, h); }
    else { g.drawImage(src, 0, 0, 1, h, x - P, y, P, h); g.drawImage(src, w - 1, 0, 1, h, x + w, y, P, h); }
    if (it.wrapY) { g.drawImage(src, 0, h - P, w, P, x, y - P, w, P); g.drawImage(src, 0, 0, w, P, x, y + h, w, P); }
    else { g.drawImage(src, 0, 0, w, 1, x, y - P, w, P); g.drawImage(src, 0, h - 1, w, 1, x, y + h, w, P); }
  }
  rect(name) { const it = this.map.get(name); if (!it) throw new Error('[world] unknown atlas region ' + name); return it.rect; }
  has(name) { return this.map.has(name); }
  makeTexture() {
    const t = new THREE.CanvasTexture(this.canvas);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    t.generateMipmaps = true;
    t.minFilter = THREE.LinearMipmapLinearFilter;
    t.magFilter = THREE.LinearFilter;
    t.needsUpdate = true;
    this.texture = t;
    return t;
  }
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

// ------------------------------------------------------------------ drawing helpers
const TAU = Math.PI * 2;
function ell(g, x, y, rx, ry, rot = 0) { g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, TAU); g.fill(); }
/** Call fn(x, y) at the position and its wrapped copies near the edges. */
function wrap(w, h, x, y, r, fn, wx = true, wy = true) {
  fn(x, y);
  const xs = [x]; if (wx) { if (x < r) xs.push(x + w); if (x > w - r) xs.push(x - w); }
  const ys = [y]; if (wy) { if (y < r) ys.push(y + h); if (y > h - r) ys.push(y - h); }
  for (const xx of xs) for (const yy of ys) if (xx !== x || yy !== y) fn(xx, yy);
}
function noise(g, w, h, n, a = 0.12, size = 1.6, R = Math.random) {
  for (let i = 0; i < n; i++) {
    g.fillStyle = R() < 0.5 ? `rgba(0,0,0,${a})` : `rgba(255,255,255,${a})`;
    g.fillRect(R() * w, R() * h, size * (0.5 + R()), size * (0.5 + R()));
  }
}
function stones(g, w, h, R, n, rMin, rMax, cols, wx, wy, shadowA = 0.45) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, rx = rMin + R() * (rMax - rMin), ry = rx * (0.55 + R() * 0.4), rot = R() * Math.PI;
    const c = cols[(R() * cols.length) | 0];
    wrap(w, h, x, y, rMax + 3, (px, py) => {
      g.fillStyle = `rgba(35,26,18,${shadowA})`; ell(g, px + rx * 0.25, py + ry * 0.35, rx, ry, rot);
      g.fillStyle = c; ell(g, px, py, rx, ry, rot);
      g.fillStyle = 'rgba(255,255,255,0.26)'; ell(g, px - rx * 0.25, py - ry * 0.3, rx * 0.5, ry * 0.4, rot);
    }, wx, wy);
  }
}
function lineWavy(g, x0, y, x1, amp, R) {
  g.beginPath(); g.moveTo(x0, y);
  for (let x = x0; x <= x1; x += 8) g.lineTo(x, y + Math.sin(x * 0.05 + R() * 0.5) * amp);
  g.stroke();
}

// ------------------------------------------------------------------ track / ground painters
const BALLAST = ['#8f8070', '#86776a', '#958676', '#7e7064', '#9a8b7a', '#8a7d72', '#928474', '#a09080', '#857a70'];
function stonesSoft(g, w, h, R, n, rMin, rMax, cols, wx, wy, sh = 0.26, hi = 0.13) {
  for (let i = 0; i < n; i++) {
    const x = R() * w, y = R() * h, rx = rMin + R() * (rMax - rMin), ry = rx * (0.55 + R() * 0.4), rot = R() * Math.PI;
    const c = cols[(R() * cols.length) | 0];
    wrap(w, h, x, y, rMax + 3, (px, py) => {
      g.fillStyle = `rgba(40,30,22,${sh})`; ell(g, px + rx * 0.22, py + ry * 0.32, rx, ry, rot);
      g.fillStyle = c; ell(g, px, py, rx, ry, rot);
      g.fillStyle = `rgba(255,250,240,${hi})`; ell(g, px - rx * 0.25, py - ry * 0.3, rx * 0.5, ry * 0.38, rot);
    }, wx, wy);
  }
}
function pBallast(g, w, h, R) {
  g.fillStyle = '#76685a'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 2200, 0.1, 2, R);
  stonesSoft(g, w, h, R, 1500, 3, 6.5, BALLAST, false, true);
  // darker oily band along the middle of the bed, rust dust along the rails
  const gm = g.createLinearGradient(w * 0.3, 0, w * 0.7, 0);
  gm.addColorStop(0, 'rgba(50,38,28,0)'); gm.addColorStop(0.5, 'rgba(50,38,28,0.2)'); gm.addColorStop(1, 'rgba(50,38,28,0)');
  g.fillStyle = gm; g.fillRect(w * 0.3, 0, w * 0.4, h);
  for (const cx of [w * 0.2306, w * 0.7694]) {
    const gr = g.createLinearGradient(cx - 18, 0, cx + 18, 0);
    gr.addColorStop(0, 'rgba(120,64,26,0)'); gr.addColorStop(0.5, 'rgba(120,64,26,0.24)'); gr.addColorStop(1, 'rgba(120,64,26,0)');
    g.fillStyle = gr; g.fillRect(cx - 18, 0, 36, h);
  }
}
function pBedSlope(g, w, h, R) {
  g.fillStyle = '#6a5d50'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 500, 0.1, 2, R);
  stonesSoft(g, w, h, R, 360, 2.8, 6, BALLAST, false, true, 0.3, 0.1);
  const gr = g.createLinearGradient(0, 0, w, 0); gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(25,18,10,0.22)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}
function pGravel(g, w, h, R) {
  g.fillStyle = '#6f6356'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 1800, 0.1, 2, R);
  stonesSoft(g, w, h, R, 800, 2.2, 4.6, ['#83766a', '#7a6d61', '#8c7f71', '#74685c', '#918475', '#7e746c'], true, true, 0.26, 0.1);
  for (let i = 0; i < 5; i++) {
    const x = R() * w, y = R() * h, r = 14 + R() * 26;
    wrap(w, h, x, y, r, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, 'rgba(30,24,20,0.22)'); gr.addColorStop(1, 'rgba(30,24,20,0)');
      g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
}
function pSleeperTop(g, w, h, R) {
  g.fillStyle = '#6e4b2d'; g.fillRect(0, 0, w, h);
  g.lineWidth = 1.2;
  for (let i = 0; i < 46; i++) {
    g.strokeStyle = R() < 0.6 ? 'rgba(45,27,12,0.4)' : 'rgba(160,115,70,0.3)';
    lineWavy(g, 0, R() * h, w, 1.2, R);
  }
  // cracks & knots
  g.strokeStyle = 'rgba(30,18,8,0.6)'; g.lineWidth = 1.5;
  for (let i = 0; i < 6; i++) { const x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); g.lineTo(x + 14 + R() * 30, y + (R() - 0.5) * 4); g.stroke(); }
  g.fillStyle = 'rgba(40,24,10,0.5)'; for (let i = 0; i < 3; i++) ell(g, R() * w, R() * h, 4, 2.5);
  // darker, worn ends
  for (const [x0, x1] of [[0, 18], [w, w - 18]]) {
    const gr = g.createLinearGradient(x0, 0, x1, 0); gr.addColorStop(0, 'rgba(30,18,8,0.55)'); gr.addColorStop(1, 'rgba(30,18,8,0)');
    g.fillStyle = gr; g.fillRect(Math.min(x0, x1), 0, 18, h);
  }
  // edge highlight / shadow
  g.fillStyle = 'rgba(255,220,170,0.18)'; g.fillRect(0, 0, w, 3);
  g.fillStyle = 'rgba(20,10,4,0.35)'; g.fillRect(0, h - 4, w, 4);
  // steel tie plates + clips under both rails
  for (const cx of [w * 0.2052, w * 0.7948]) { // sleeper is 2.12 m long, rails at +-0.625
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(cx - 21, 7, 44, h - 11);
    g.fillStyle = '#56565c'; g.fillRect(cx - 22, 5, 44, h - 12);
    g.fillStyle = '#6f7078'; g.fillRect(cx - 22, 5, 44, 3);
    g.fillStyle = '#3a3a40'; g.fillRect(cx - 6, 5, 12, h - 12);
    g.fillStyle = '#2a2a2e';
    for (const dx of [-15, 15]) for (const dy of [14, h - 16]) { g.beginPath(); g.arc(cx + dx, dy, 3.2, 0, TAU); g.fill(); }
    g.fillStyle = 'rgba(150,80,30,0.35)'; g.fillRect(cx - 24, h - 9, 48, 3);
  }
}
function pSleeperSide(g, w, h, R) {
  g.fillStyle = '#4e331d'; g.fillRect(0, 0, w, h);
  g.lineWidth = 1;
  for (let i = 0; i < 14; i++) { g.strokeStyle = R() < 0.5 ? 'rgba(20,10,4,0.4)' : 'rgba(130,90,50,0.25)'; lineWavy(g, 0, R() * h, w, 0.8, R); }
  g.fillStyle = 'rgba(255,220,170,0.12)'; g.fillRect(0, 0, w, 2);
}
function pAsphalt(g, w, h, R) {
  g.fillStyle = '#5b5d63'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 5000, 0.12, 1.6, R);
  g.strokeStyle = 'rgba(25,25,30,0.5)'; g.lineWidth = 1.4;
  for (let i = 0; i < 4; i++) {
    let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (R() - 0.5) * 40; y += (R() - 0.3) * 30; g.lineTo(x, y); } g.stroke();
  }
  g.fillStyle = 'rgba(40,40,46,0.35)'; g.fillRect(R() * w * 0.5, R() * h * 0.5, 70, 50);
}
function pSidewalk(g, w, h, R) {
  g.fillStyle = '#cdc7bb'; g.fillRect(0, 0, w, h);
  const n = 4, s = w / n;
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = 0.92 + R() * 0.12;
    g.fillStyle = `rgba(${(205 * k) | 0},${(199 * k) | 0},${(187 * k) | 0},1)`; g.fillRect(i * s, j * s, s, s);
  }
  noise(g, w, h, 3000, 0.1, 1.5, R);
  g.fillStyle = 'rgba(90,85,78,0.55)';
  for (let i = 0; i <= n; i++) { g.fillRect(i * s - 1, 0, 2, h); g.fillRect(0, i * s - 1, w, 2); }
  g.fillStyle = 'rgba(60,55,50,0.35)'; for (let i = 0; i < 10; i++) ell(g, R() * w, R() * h, 2 + R() * 2, 1.5 + R() * 2);
}
function pGrass(g, w, h, R) {
  g.fillStyle = '#62a83f'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < 18; i++) {
    const x = R() * w, y = R() * h, r = 20 + R() * 40;
    wrap(w, h, x, y, r, (px, py) => {
      const gr = g.createRadialGradient(px, py, 0, px, py, r);
      gr.addColorStop(0, R() < 0.5 ? 'rgba(140,200,80,0.25)' : 'rgba(50,110,40,0.25)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(px - r, py - r, r * 2, r * 2);
    });
  }
  const cols = ['#4f8f32', '#78bf4f', '#8fd064', '#5a9d3a', '#a6db6e'];
  g.lineCap = 'round';
  for (let i = 0; i < 2600; i++) {
    const x = R() * w, y = R() * h, l = 3 + R() * 6, a = -Math.PI / 2 + (R() - 0.5) * 0.9;
    g.strokeStyle = cols[(R() * cols.length) | 0]; g.lineWidth = 1 + R();
    wrap(w, h, x, y, 10, (px, py) => { g.beginPath(); g.moveTo(px, py); g.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l); g.stroke(); });
  }
  for (let i = 0; i < 14; i++) { g.fillStyle = R() < 0.5 ? '#ffffff' : '#ffe45c'; const x = R() * w, y = R() * h; wrap(w, h, x, y, 4, (px, py) => ell(g, px, py, 1.8, 1.8)); }
}
function pDirt(g, w, h, R) {
  g.fillStyle = '#9a7c5a'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 3000, 0.14, 2, R);
  stones(g, w, h, R, 180, 1.5, 3.5, ['#b09472', '#7f6448', '#a78d6e', '#c2a888'], true, true, 0.3);
  for (let i = 0; i < 10; i++) {
    const x = R() * w, y = R() * h, r = 16 + R() * 30;
    wrap(w, h, x, y, r, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, 'rgba(70,50,30,0.22)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(px - r, py - r, 2 * r, 2 * r); });
  }
}
function pPlatformTop(g, w, h, R) {
  g.fillStyle = '#d5cfc3'; g.fillRect(0, 0, w, h);
  const s = w / 2;
  for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) { g.fillStyle = `rgba(${R() < 0.5 ? '255,255,255' : '0,0,0'},0.05)`; g.fillRect(i * s, j * s, s, s); }
  noise(g, w, h, 3500, 0.09, 1.5, R);
  g.fillStyle = 'rgba(95,90,82,0.5)'; for (let i = 0; i <= 2; i++) { g.fillRect(i * s - 1, 0, 2, h); g.fillRect(0, i * s - 1, w, 2); }
  g.fillStyle = 'rgba(60,55,50,0.3)'; for (let i = 0; i < 12; i++) ell(g, R() * w, R() * h, 2 + R() * 3, 2 + R() * 2);
}
function pPlatformEdge(g, w, h, R) {
  g.fillStyle = '#ffcb2e'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#f0b400';
  for (let x = 4; x < w; x += 12) for (let y = 8; y < h - 6; y += 12) { g.beginPath(); g.arc(x + ((y / 12) % 2) * 6, y, 3.2, 0, TAU); g.fill(); }
  g.fillStyle = 'rgba(255,255,255,0.35)';
  for (let x = 4; x < w; x += 12) for (let y = 8; y < h - 6; y += 12) { g.beginPath(); g.arc(x + ((y / 12) % 2) * 6 - 1, y - 1, 1.2, 0, TAU); g.fill(); }
  noise(g, w, h, 500, 0.08, 1.5, R);
}
function pConcrete(g, w, h, R) { concreteBase(g, w, h, R, '#c2bbae', true); }
function pBrick(g, w, h, R) {
  g.fillStyle = '#e2dbd2'; g.fillRect(0, 0, w, h);
  const rows = 16, rh = h / rows, bw = w / 6;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * bw / 2;
    for (let c = -1; c < 7; c++) {
      const x = c * bw + off, y = r * rh;
      const k = 0.84 + R() * 0.16, dark = R() < 0.07 ? 0.78 : 1;
      const v = (255 * k * dark) | 0;
      g.fillStyle = `rgb(${v},${(v * 0.97) | 0},${(v * 0.95) | 0})`;
      g.fillRect(x + 1.5, y + 1.5, bw - 3, rh - 3);
      g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(x + 1.5, y + 1.5, bw - 3, 1.5);
      g.fillStyle = 'rgba(0,0,0,0.10)'; g.fillRect(x + 1.5, y + rh - 3, bw - 3, 1.5);
    }
  }
  noise(g, w, h, 2500, 0.07, 1.4, R);
}
function pStucco(g, w, h, R) {
  g.fillStyle = '#f2ece2'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 6000, 0.06, 1.4, R);
  for (let i = 0; i < 12; i++) {
    const x = R() * w, y = R() * h, r = 20 + R() * 40;
    wrap(w, h, x, y, r, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, 'rgba(120,100,80,0.08)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(px - r, py - r, 2 * r, 2 * r); });
  }
  g.strokeStyle = 'rgba(90,80,70,0.25)'; g.lineWidth = 1;
  for (let i = 0; i < 3; i++) { let x = R() * w, y = R() * h; g.beginPath(); g.moveTo(x, y); for (let k = 0; k < 4; k++) { x += (R() - 0.5) * 20; y += R() * 16; g.lineTo(x, y); } g.stroke(); }
}
function pSiding(g, w, h, R) {
  const n = 8, bh = h / n;
  for (let i = 0; i < n; i++) {
    const k = 0.93 + R() * 0.07;
    const gr = g.createLinearGradient(0, i * bh, 0, (i + 1) * bh);
    gr.addColorStop(0, `rgb(${(235 * k) | 0},${(235 * k) | 0},${(232 * k) | 0})`); gr.addColorStop(1, `rgb(${(250 * k) | 0},${(250 * k) | 0},${(247 * k) | 0})`);
    g.fillStyle = gr; g.fillRect(0, i * bh, w, bh);
    g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(0, (i + 1) * bh - 3, w, 3);
  }
  noise(g, w, h, 1500, 0.05, 1.4, R);
}
function pCorrugated(g, w, h, R) {
  const ribs = 16, rw = w / ribs;
  for (let x = 0; x < w; x++) {
    const t = (x % rw) / rw;
    const v = 200 + Math.round(Math.sin(t * TAU) * 38);
    g.fillStyle = `rgb(${v},${v},${v + 3})`; g.fillRect(x, 0, 1, h);
  }
  for (let i = 0; i < 10; i++) {
    const x = R() * w, len = 20 + R() * 60, y = R() * h;
    const gr = g.createLinearGradient(0, y, 0, y + len); gr.addColorStop(0, 'rgba(140,70,30,0.25)'); gr.addColorStop(1, 'rgba(140,70,30,0)');
    g.fillStyle = gr; g.fillRect(x, y, 3 + R() * 4, len);
  }
  noise(g, w, h, 1200, 0.05, 1.4, R);
}
function pTiles(g, w, h, R) {
  const n = 8, s = w / n;
  g.fillStyle = '#b9c2c8'; g.fillRect(0, 0, w, h);
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) {
    const k = 0.95 + R() * 0.05;
    g.fillStyle = `rgb(${(246 * k) | 0},${(249 * k) | 0},${(250 * k) | 0})`; g.fillRect(i * s + 1.5, j * s + 1.5, s - 3, s - 3);
    g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(i * s + 2, j * s + 2, s - 6, 2);
  }
  noise(g, w, h, 800, 0.05, 1.4, R);
}
function pRoof(g, w, h, R) {
  g.fillStyle = '#8f8b85'; g.fillRect(0, 0, w, h);
  noise(g, w, h, 6000, 0.15, 1.8, R);
  for (let i = 0; i < 8; i++) {
    const x = R() * w, y = R() * h, r = 20 + R() * 30;
    wrap(w, h, x, y, r, (px, py) => { const gr = g.createRadialGradient(px, py, 0, px, py, r); gr.addColorStop(0, 'rgba(50,48,45,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(px - r, py - r, 2 * r, 2 * r); });
  }
}
function pMetal(g, w, h, R) {
  g.fillStyle = '#e6e6e6'; g.fillRect(0, 0, w, h);
  for (let x = 0; x < w; x += 64) { g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(x, 0, 4, h); g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 4, 0, 3, h); }
  g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(0, 12, w, 3); g.fillRect(0, h - 15, w, 3);
  for (let x = 4; x < w; x += 12) for (const y of [6, h - 7]) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.beginPath(); g.arc(x + 1, y + 1, 2.4, 0, TAU); g.fill(); g.fillStyle = 'rgba(255,255,255,0.8)'; g.beginPath(); g.arc(x, y, 2, 0, TAU); g.fill(); }
  const gb = g.createLinearGradient(0, h * 0.6, 0, h); gb.addColorStop(0, 'rgba(60,50,40,0)'); gb.addColorStop(1, 'rgba(60,50,40,0.22)');
  g.fillStyle = gb; g.fillRect(0, h * 0.6, w, h * 0.4);
  noise(g, w, h, 800, 0.05, 1.4, R);
}
function pWood(g, w, h, R) {
  const n = 5, pw = w / n;
  for (let i = 0; i < n; i++) {
    const k = 0.85 + R() * 0.15;
    g.fillStyle = `rgb(${(232 * k) | 0},${(214 * k) | 0},${(190 * k) | 0})`; g.fillRect(i * pw, 0, pw, h);
    g.strokeStyle = 'rgba(90,60,30,0.2)'; g.lineWidth = 1;
    for (let k2 = 0; k2 < 5; k2++) { const x = i * pw + R() * pw; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + (R() - 0.5) * 4, h); g.stroke(); }
    g.fillStyle = 'rgba(40,25,10,0.45)'; g.fillRect(i * pw, 0, 2, h);
  }
}
function pContainer(g, w, h, R) {
  const ribs = 12, rw = w / ribs;
  for (let x = 0; x < w; x++) {
    const t = (x % rw) / rw;
    const v = t < 0.2 ? 205 : t < 0.5 ? 245 : t < 0.7 ? 185 : 225;
    g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(x, 0, 1, h);
  }
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(0, 0, w, 7); g.fillRect(0, h - 8, w, 8);
  g.fillStyle = 'rgba(255,255,255,0.3)'; g.fillRect(0, 7, w, 2);
  for (let i = 0; i < 8; i++) { g.fillStyle = 'rgba(130,60,20,0.22)'; ell(g, R() * w, R() * h, 3 + R() * 8, 2 + R() * 5); }
  noise(g, w, h, 900, 0.06, 1.5, R);
}
function pContainerDoor(g, w, h, R) {
  g.fillStyle = '#e8e8e8'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(w / 2 - 1.5, 0, 3, h); g.fillRect(0, 0, w, 6); g.fillRect(0, h - 6, w, 6);
  for (const x of [w * 0.17, w * 0.37, w * 0.63, w * 0.83]) {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - 2, 8, 5, h - 16);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.fillRect(x - 2, 8, 2, h - 16);
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x - 5, h * 0.55, 10, 5);
  }
  g.fillStyle = 'rgba(0,0,0,0.55)'; g.font = 'bold 13px sans-serif'; g.textAlign = 'center';
  g.fillText('RDX', w * 0.27, h * 0.3); g.fillText(String(4000 + ((R() * 5999) | 0)), w * 0.27, h * 0.42);
  noise(g, w, h, 500, 0.06, 1.5, R);
}
function pPillar(g, w, h, R) {
  concreteBase(g, w, h, R, '#c9c2b5', false);
  g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h);
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fillRect(6, 0, 3, h);
}

// ------------------------------------------------------------------ windows / doors / shops (not tinted)
function glass(g, x, y, w, h, R, dark = false) {
  const gr = g.createLinearGradient(x, y, x, y + h);
  if (dark) { gr.addColorStop(0, '#6d8aa6'); gr.addColorStop(1, '#233448'); }
  else { gr.addColorStop(0, '#cdeefe'); gr.addColorStop(0.45, '#8ec3e3'); gr.addColorStop(1, '#4d7596'); }
  g.fillStyle = gr; g.fillRect(x, y, w, h);
  g.save(); g.beginPath(); g.rect(x, y, w, h); g.clip();
  g.fillStyle = 'rgba(255,255,255,0.35)';
  g.beginPath(); g.moveTo(x + w * 0.15, y + h); g.lineTo(x + w * 0.55, y); g.lineTo(x + w * 0.72, y); g.lineTo(x + w * 0.32, y + h); g.fill();
  g.fillStyle = 'rgba(255,255,255,0.18)';
  g.beginPath(); g.moveTo(x + w * 0.62, y + h); g.lineTo(x + w * 0.95, y + h * 0.2); g.lineTo(x + w, y + h * 0.3); g.lineTo(x + w * 0.72, y + h); g.fill();
  g.restore();
}
function windowFrame(g, w, h, frame, R, opts = {}) {
  // stone lintel + sill
  g.fillStyle = '#e8dccb'; g.fillRect(4, 0, w - 8, 14); g.fillRect(0, h - 14, w, 14);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(4, 13, w - 8, 3); g.fillRect(0, h - 3, w, 3);
  // recess shadow
  g.fillStyle = 'rgba(20,15,10,0.55)'; g.fillRect(10, 14, w - 20, h - 28);
  // frame
  g.fillStyle = frame; g.fillRect(13, 16, w - 26, h - 32);
  return { gx: 20, gy: 23, gw: w - 40, gh: h - 46 };
}
function pWindow(v) {
  return (g, w, h, R) => {
    const frames = ['#fbf8f2', '#f3e8cf', '#2f5d46', '#6b4a2e', '#fbf8f2'];
    const { gx, gy, gw, gh } = windowFrame(g, w, h, frames[v], R);
    glass(g, gx, gy, gw, gh, R, v === 3);
    if (v === 0) { // curtains
      g.fillStyle = '#ff7eb6';
      g.beginPath(); g.moveTo(gx, gy); g.lineTo(gx + gw * 0.3, gy); g.quadraticCurveTo(gx + gw * 0.12, gy + gh * 0.5, gx + gw * 0.22, gy + gh); g.lineTo(gx, gy + gh); g.fill();
      g.beginPath(); g.moveTo(gx + gw, gy); g.lineTo(gx + gw * 0.7, gy); g.quadraticCurveTo(gx + gw * 0.88, gy + gh * 0.5, gx + gw * 0.78, gy + gh); g.lineTo(gx + gw, gy + gh); g.fill();
      g.fillStyle = 'rgba(0,0,0,0.15)'; g.fillRect(gx + gw * 0.08, gy, 3, gh); g.fillRect(gx + gw * 0.9, gy, 3, gh);
    } else if (v === 1) { // blinds
      g.fillStyle = '#f4f1e8'; g.fillRect(gx, gy, gw, gh * 0.55);
      g.fillStyle = 'rgba(0,0,0,0.14)'; for (let y = gy + 4; y < gy + gh * 0.55; y += 6) g.fillRect(gx, y, gw, 2);
    } else if (v === 2) { // plant + half curtain
      g.fillStyle = '#e8e2d0'; g.fillRect(gx, gy, gw, gh * 0.18);
      g.fillStyle = '#c0622f'; g.fillRect(gx + gw * 0.55, gy + gh - 22, 22, 22);
      g.fillStyle = '#3d9a3a'; for (let i = 0; i < 7; i++) ell(g, gx + gw * 0.55 + 11 + (R() - 0.5) * 26, gy + gh - 30 - R() * 24, 7, 5, R() * 3);
    } else if (v === 4) { // flower box
      g.fillStyle = '#7a4a2a'; g.fillRect(8, h - 30, w - 16, 16);
      for (let i = 0; i < 12; i++) { g.fillStyle = '#3f9a3a'; ell(g, 14 + R() * (w - 28), h - 32, 6, 4); }
      for (let i = 0; i < 10; i++) { g.fillStyle = ['#ff4fa3', '#f2553d', '#ffc93c', '#ffffff'][(R() * 4) | 0]; ell(g, 14 + R() * (w - 28), h - 36 + R() * 6, 3.2, 3.2); }
    }
    // muntins
    g.fillStyle = frames[v];
    g.fillRect(gx + gw / 2 - 2.5, gy, 5, gh);
    g.fillRect(gx, gy + gh * 0.5 - 2.5, gw, 5);
  };
}
function pShop(v) {
  return (g, w, h, R) => {
    g.fillStyle = v ? '#1f6f6a' : '#7a2430'; g.fillRect(0, 0, w, h);
    const gx = 10, gy = 12, gw = w * 0.66, gh = h - 30;
    // interior
    g.fillStyle = '#f6ecd6'; g.fillRect(gx, gy, gw, gh);
    for (let r = 0; r < 3; r++) {
      const y = gy + 18 + r * (gh / 3.2);
      g.fillStyle = '#9a7652'; g.fillRect(gx, y + 22, gw, 4);
      for (let x = gx + 4; x < gx + gw - 10; x += 10 + R() * 6) {
        g.fillStyle = ['#ff4fa3', '#ffc93c', '#19b3b1', '#f2553d', '#3a6fd8', '#8edc4a', '#ff8a1f'][(R() * 7) | 0];
        const bh = 10 + R() * 12; g.fillRect(x, y + 22 - bh, 7, bh);
      }
    }
    glass(g, gx, gy, gw, gh, R); g.globalAlpha = 1;
    g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(gx, gy, gw, gh);
    // door
    const dx = gx + gw + 12, dw = w - dx - 10;
    g.fillStyle = '#2a2a30'; g.fillRect(dx - 3, gy - 3, dw + 6, gh + 18);
    glass(g, dx, gy, dw, gh + 12, R, true);
    g.fillStyle = '#d9d9d9'; g.fillRect(dx + 4, gy + gh * 0.55, 4, 26);
    // kick plate
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(0, h - 18, gx + gw + 4, 18);
  };
}
function pDoor(g, w, h, R) {
  g.fillStyle = '#e8dccb'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(20,15,10,0.6)'; g.fillRect(12, 10, w - 24, h - 10);
  const col = ['#1f7a74', '#b23a3a', '#2e4f9a'][(R() * 3) | 0];
  g.fillStyle = col; g.fillRect(16, 14, w - 32, h - 14);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(24, 60, w - 48, 50); g.fillRect(24, 120, w - 48, 50);
  glass(g, 26, 22, w - 52, 30, R, true);
  g.fillStyle = '#e8c55a'; g.beginPath(); g.arc(w - 28, h * 0.58, 4.5, 0, TAU); g.fill();
}
function pGarage(g, w, h, R) {
  g.fillStyle = '#5a5e66'; g.fillRect(0, 0, w, h);
  const slat = 16;
  for (let y = 10; y < h; y += slat) {
    const gr = g.createLinearGradient(0, y, 0, y + slat);
    gr.addColorStop(0, '#b9bec6'); gr.addColorStop(0.7, '#9aa0a9'); gr.addColorStop(1, '#6b7079');
    g.fillStyle = gr; g.fillRect(8, y, w - 16, slat - 1);
  }
  g.fillStyle = '#3a3d44'; g.fillRect(0, 0, w, 10); g.fillRect(0, 0, 8, h); g.fillRect(w - 8, 0, 8, h);
  // graffiti tags on the shutter
  g.save(); g.globalAlpha = 0.9;
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (let i = 0; i < 3; i++) {
    g.strokeStyle = ['#1b1238', '#ff4fa3', '#3a6fd8'][i]; g.lineWidth = 4 + R() * 3;
    let x = 30 + R() * (w - 90), y = 60 + R() * (h - 110);
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 7; k++) { x += 8 + R() * 14; g.quadraticCurveTo(x - 6, y - 20 - R() * 16, x, y + (R() - 0.5) * 10); }
    g.stroke();
  }
  g.restore();
  g.fillStyle = '#2b2d32'; g.fillRect(w / 2 - 14, h - 22, 28, 6);
}
function pAwning(v) {
  return (g, w, h) => {
    const c = ['#e8403a', '#2e9e5a', '#2f6fd0'][v];
    const n = 8, sw = w / n;
    for (let i = 0; i < n; i++) { g.fillStyle = i % 2 ? '#fbf6ec' : c; g.fillRect(i * sw, 0, sw, h); }
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.15)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  };
}

// ------------------------------------------------------------------ props
function pCabinet(g, w, h, R) {
  g.fillStyle = '#9fb0a2'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(6, 6, w - 12, 2); g.fillRect(6, h - 8, w - 12, 2); g.fillRect(6, 6, 2, h - 12); g.fillRect(w - 8, 6, 2, h - 12);
  g.fillRect(w / 2 - 1, 8, 2, h - 16);
  for (let y = h - 34; y < h - 12; y += 5) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(16, y, w / 2 - 26, 2.5); g.fillRect(w / 2 + 10, y, w / 2 - 26, 2.5); }
  // warning triangle
  g.fillStyle = INK; g.beginPath(); g.moveTo(w * 0.28, 22); g.lineTo(w * 0.28 + 20, 56); g.lineTo(w * 0.28 - 20, 56); g.closePath(); g.fill();
  g.fillStyle = '#ffcb2e'; g.beginPath(); g.moveTo(w * 0.28, 27); g.lineTo(w * 0.28 + 16, 53); g.lineTo(w * 0.28 - 16, 53); g.closePath(); g.fill();
  g.fillStyle = INK; g.beginPath(); g.moveTo(w * 0.28 + 3, 32); g.lineTo(w * 0.28 - 5, 44); g.lineTo(w * 0.28, 44); g.lineTo(w * 0.28 - 3, 51); g.lineTo(w * 0.28 + 5, 40); g.lineTo(w * 0.28, 40); g.closePath(); g.fill();
  // sticker + tag
  g.fillStyle = '#ff4fa3'; g.beginPath(); g.arc(w * 0.72, 38, 12, 0, TAU); g.fill();
  g.fillStyle = '#fff'; star(g, w * 0.72, 38, 7, 5, 0.5); g.fill();
  g.strokeStyle = INK; g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(w * 0.58, 76); g.quadraticCurveTo(w * 0.66, 58, w * 0.72, 78); g.quadraticCurveTo(w * 0.78, 60, w * 0.86, 74); g.stroke();
  g.fillStyle = '#d8d8d8'; g.fillRect(w / 2 - 12, h / 2 - 3, 8, 14);
  noise(g, w, h, 600, 0.06, 1.4, R);
}
function pAC(g, w, h, R) {
  g.fillStyle = '#e4e4e0'; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(0, h - 4, w, 4);
  g.fillStyle = '#6d6f73'; g.beginPath(); g.arc(w * 0.42, h * 0.5, h * 0.33, 0, TAU); g.fill();
  g.strokeStyle = '#d4d4d0'; g.lineWidth = 1.5;
  for (let r = 4; r < h * 0.33; r += 4) { g.beginPath(); g.arc(w * 0.42, h * 0.5, r, 0, TAU); g.stroke(); }
  g.beginPath(); g.moveTo(w * 0.42 - h * 0.33, h * 0.5); g.lineTo(w * 0.42 + h * 0.33, h * 0.5); g.moveTo(w * 0.42, h * 0.17); g.lineTo(w * 0.42, h * 0.83); g.stroke();
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let y = 10; y < h - 10; y += 5) g.fillRect(w * 0.8, y, w * 0.14, 2);
}
function pVending(g, w, h, R) {
  g.fillStyle = '#e8403a'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#b52a26'; g.fillRect(0, 0, 6, h); g.fillRect(w - 6, 0, 6, h);
  g.fillStyle = '#1b1238'; g.fillRect(10, 40, w * 0.66, h - 90);
  for (let r = 0; r < 5; r++) for (let c = 0; c < 5; c++) {
    g.fillStyle = ['#ffc93c', '#19b3b1', '#ff4fa3', '#c6ff3d', '#5ec8f5', '#ffffff'][(R() * 6) | 0];
    roundRect(g, 16 + c * (w * 0.66 - 12) / 5, 50 + r * ((h - 110) / 5), 10, 26, 4); g.fill();
  }
  g.fillStyle = 'rgba(255,255,255,0.22)'; g.beginPath(); g.moveTo(10, 40); g.lineTo(40, 40); g.lineTo(10, 120); g.fill();
  g.fillStyle = '#ffffff'; g.font = 'bold 22px sans-serif'; g.textAlign = 'center'; g.fillText('FIZZ', w / 2, 30);
  g.fillStyle = '#2b2b30'; g.fillRect(w * 0.8, 60, w * 0.12, 60); g.fillRect(16, h - 40, w * 0.6, 22);
  for (let i = 0; i < 6; i++) { g.fillStyle = '#ffd23f'; g.fillRect(w * 0.82, 66 + i * 9, w * 0.08, 5); }
}
function pClock(g, w, h) {
  g.fillStyle = '#1b1238'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.44, 0, TAU); g.fill();
  g.strokeStyle = '#1b1238'; g.lineWidth = 2;
  for (let i = 0; i < 12; i++) { const a = (i / 12) * TAU; g.beginPath(); g.moveTo(w / 2 + Math.cos(a) * w * 0.36, h / 2 + Math.sin(a) * w * 0.36); g.lineTo(w / 2 + Math.cos(a) * w * 0.42, h / 2 + Math.sin(a) * w * 0.42); g.stroke(); }
  g.lineWidth = 3; g.lineCap = 'round';
  g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 - w * 0.2, h / 2 - w * 0.12); g.stroke();
  g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + w * 0.18, h / 2 - w * 0.26); g.stroke();
  g.fillStyle = '#f2553d'; g.beginPath(); g.arc(w / 2, h / 2, 3, 0, TAU); g.fill();
}
function pSignal(g, w, h) {
  g.fillStyle = '#16161a'; roundRect(g, 2, 2, w - 4, h - 4, 12); g.fill();
  const cols = [['#5a1512', '#ff3b2e'], ['#5a4412', '#ffb400'], ['#0f4a22', '#3dff7a']];
  cols.forEach(([off, on], i) => {
    const y = 24 + i * 38;
    g.fillStyle = '#000'; g.beginPath(); g.arc(w / 2, y, 15, 0, TAU); g.fill();
    g.fillStyle = i === 2 ? on : off; g.beginPath(); g.arc(w / 2, y, 12, 0, TAU); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.45)'; g.beginPath(); g.arc(w / 2 - 4, y - 4, 4, 0, TAU); g.fill();
  });
}
function pFar(v) {
  return (g, w, h, R) => {
    g.fillStyle = '#eeeae4'; g.fillRect(0, 0, w, h);
    noise(g, w, h, 1500, 0.05, 1.5, R);
    if (v === 0) {
      const cols = 6, rows = 8, cw = w / cols, rh = h / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        const x = c * cw + cw * 0.22, y = r * rh + rh * 0.2;
        g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x - 1, y - 1, cw * 0.56 + 2, rh * 0.58 + 2);
        const gr = g.createLinearGradient(0, y, 0, y + rh * 0.58); gr.addColorStop(0, '#9cc6e0'); gr.addColorStop(1, '#3f5f7c');
        g.fillStyle = gr; g.fillRect(x, y, cw * 0.56, rh * 0.58);
      }
    } else {
      const rows = 6, rh = h / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rh + rh * 0.3;
        const gr = g.createLinearGradient(0, y, 0, y + rh * 0.45); gr.addColorStop(0, '#a8d4ec'); gr.addColorStop(1, '#3a5a78');
        g.fillStyle = gr; g.fillRect(0, y, w, rh * 0.45);
        g.fillStyle = 'rgba(0,0,0,0.3)'; for (let x = 0; x < w; x += 32) g.fillRect(x, y, 3, rh * 0.45);
      }
    }
  };
}

// ------------------------------------------------------------------ cutout / glow painters (alpha)
function pChainlink(g, w, h) {
  const d = 32;
  g.lineWidth = 3.2; g.strokeStyle = 'rgba(150,158,168,1)';
  for (let k = -w; k <= w * 2; k += d) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + h, h); g.stroke();
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k - h, h); g.stroke();
  }
  g.lineWidth = 1.2; g.strokeStyle = 'rgba(230,236,242,1)';
  for (let k = -w; k <= w * 2; k += d) { g.beginPath(); g.moveTo(k - 1, 0); g.lineTo(k + h - 1, h); g.stroke(); }
}
function pBarbed(g, w, h) {
  g.strokeStyle = 'rgba(120,125,132,1)'; g.lineWidth = 2.5;
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w, h / 2); g.stroke();
  g.beginPath(); for (let x = 0; x <= w; x += 4) g.lineTo(x, h / 2 + Math.sin(x * 0.2) * 3); g.stroke();
  g.lineWidth = 2;
  for (let x = 8; x < w; x += 32) { g.beginPath(); g.moveTo(x - 6, h / 2 - 8); g.lineTo(x + 6, h / 2 + 8); g.moveTo(x + 6, h / 2 - 8); g.lineTo(x - 6, h / 2 + 8); g.stroke(); }
}
function pRailing(g, w, h) {
  g.fillStyle = '#d8d8d8';
  g.fillRect(0, 0, w, 12); g.fillRect(0, h * 0.5, w, 7); g.fillRect(0, h - 8, w, 8);
  for (let x = 6; x < w; x += 21.33) g.fillRect(x, 0, 5, h);
  g.fillStyle = 'rgba(255,255,255,0.6)'; g.fillRect(0, 0, w, 3);
  g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(0, 10, w, 2);
}
function pGrate(g, w, h) {
  g.fillStyle = '#cfcfcf';
  for (let x = 0; x < w; x += 16) g.fillRect(x, 0, 4, h);
  for (let y = 0; y < h; y += 16) g.fillRect(0, y, w, 3);
}
function pTruss(g, w, h) {
  g.strokeStyle = '#dcdcdc'; g.lineCap = 'butt';
  g.lineWidth = 14; g.beginPath(); g.moveTo(0, 7); g.lineTo(w, 7); g.moveTo(0, h - 7); g.lineTo(w, h - 7); g.stroke();
  g.lineWidth = 10;
  const n = 4, sw = w / n;
  g.beginPath();
  for (let i = 0; i < n; i++) { g.moveTo(i * sw, h - 7); g.lineTo(i * sw + sw / 2, 7); g.lineTo((i + 1) * sw, h - 7); }
  g.stroke();
  g.lineWidth = 6; g.beginPath(); for (let i = 0; i <= n; i++) { g.moveTo(i * sw, 7); g.lineTo(i * sw, h - 7); } g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.7)'; g.lineWidth = 3; g.beginPath(); g.moveTo(0, 3); g.lineTo(w, 3); g.stroke();
}
function pLeaves(v) {
  return (g, w, h, R) => {
    const cx = w / 2, cy = h / 2;
    const cols = v ? ['#3f8f3a', '#56a844', '#6cc04f', '#8bd65f', '#2f7a33'] : ['#2e7d4f', '#3f9a57', '#58b36a', '#7cc97a', '#246844'];
    for (let i = 0; i < 260; i++) {
      const a = R() * TAU, d = Math.sqrt(R()) * w * 0.42;
      const x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d * 0.9;
      const lit = (y < cy ? 1 : 0) + (x < cx ? 1 : 0);
      g.fillStyle = cols[Math.min(4, ((R() * 3) | 0) + lit)];
      ell(g, x, y, 7 + R() * 7, 4 + R() * 4, R() * Math.PI);
    }
  };
}
function pTuft(g, w, h, R) {
  g.lineCap = 'round';
  for (let i = 0; i < 60; i++) {
    const x = w * 0.1 + R() * w * 0.8, l = h * (0.4 + R() * 0.55), a = -Math.PI / 2 + (R() - 0.5) * 1.1;
    g.strokeStyle = ['#4f8f32', '#78bf4f', '#8fd064', '#5a9d3a'][(R() * 4) | 0]; g.lineWidth = 2 + R() * 2;
    g.beginPath(); g.moveTo(x, h); g.quadraticCurveTo(x + Math.cos(a) * l * 0.3, h - l * 0.6, x + Math.cos(a) * l, h + Math.sin(a) * l); g.stroke();
  }
}
function pGlow(g, w, h) {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}
function pPool(g, w, h) {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.35)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}
function pWinLit(v) {
  return (g, w, h, R) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    const gx = 20, gy = 23, gw = w - 40, gh = h - 46;
    const warm = [['#ffe9a8', '#ffb347'], ['#fff3c8', '#ffcf6a'], ['#9fd8ff', '#4c7dff']][v];
    const gr = g.createRadialGradient(gx + gw / 2, gy + gh * 0.35, 4, gx + gw / 2, gy + gh * 0.5, gh * 0.8);
    gr.addColorStop(0, warm[0]); gr.addColorStop(1, warm[1]);
    g.fillStyle = gr; g.fillRect(gx, gy, gw, gh);
    g.fillStyle = 'rgba(0,0,0,0.55)';
    if (v === 0) { g.fillRect(gx, gy, gw * 0.22, gh); g.fillRect(gx + gw * 0.78, gy, gw * 0.22, gh); }
    if (v === 1) { ell(g, gx + gw * 0.35, gy + gh * 0.7, 10, 14); ell(g, gx + gw * 0.35, gy + gh * 0.45, 7, 7); }
    if (v === 2) { g.fillRect(gx, gy, gw, gh * 0.3); }
    g.fillStyle = 'rgba(0,0,0,0.8)'; g.fillRect(gx + gw / 2 - 2.5, gy, 5, gh); g.fillRect(gx, gy + gh / 2 - 2.5, gw, 5);
  };
}
function pShopLit(g, w, h) {
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const gx = 10, gy = 12, gw = w * 0.66, gh = h - 30;
  const gr = g.createLinearGradient(0, gy, 0, gy + gh); gr.addColorStop(0, '#fff6d8'); gr.addColorStop(1, '#ffc46a');
  g.fillStyle = gr; g.fillRect(gx, gy, gw, gh);
  const dx = gx + gw + 12, dw = w - dx - 10;
  g.fillStyle = '#ffd98a'; g.fillRect(dx, gy, dw, gh + 12);
}
function pFarLit(v) {
  return (g, w, h, R) => {
    g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
    if (v === 0) {
      const cols = 6, rows = 8, cw = w / cols, rh = h / rows;
      for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
        if (R() > 0.42) continue;
        g.fillStyle = ['#ffd98a', '#ffe7b0', '#ffc36b', '#bfe0ff'][(R() * 4) | 0];
        g.fillRect(c * cw + cw * 0.22, r * rh + rh * 0.2, cw * 0.56, rh * 0.58);
      }
    } else {
      const rows = 6, rh = h / rows;
      for (let r = 0; r < rows; r++) {
        const y = r * rh + rh * 0.3;
        for (let x = 0; x < w; x += 32) { if (R() > 0.5) continue; g.fillStyle = R() < 0.8 ? '#fff1c8' : '#c8e4ff'; g.fillRect(x + 3, y, 29, rh * 0.45); }
      }
    }
  };
}
function pSparkle(g, w, h) {
  const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,255,255,0.3)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  g.fillStyle = 'rgba(255,255,255,0.9)';
  g.beginPath(); g.moveTo(w / 2, 0); g.lineTo(w / 2 + 3, h / 2); g.lineTo(w / 2, h); g.lineTo(w / 2 - 3, h / 2); g.fill();
  g.beginPath(); g.moveTo(0, h / 2); g.lineTo(w / 2, h / 2 - 3); g.lineTo(w, h / 2); g.lineTo(w / 2, h / 2 + 3); g.fill();
}
function pBeam(g, w, h) {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.beginPath(); g.moveTo(w * 0.4, 0); g.lineTo(w * 0.6, 0); g.lineTo(w, h); g.lineTo(0, h); g.fill();
}
function pWash(g, w, h) {
  const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(255,255,255,0.95)'); gr.addColorStop(1, 'rgba(255,255,255,0.35)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}

// ------------------------------------------------------------------ build everything
export const GRAFFITI_COUNT = 8;
export const BILLBOARD_COUNT = 4;
export const SIGN_COUNT = 8;
export const WINDOW_COUNT = 5;

export function buildAtlases(quality = 'high') {
  const main = new Atlas(2048, false);
  const add = (...a) => main.add(...a);
  const W = { wrapX: true, wrapY: true };
  add('white', 16, 16, (g, w, h) => { g.fillStyle = '#fff'; g.fillRect(0, 0, w, h); }, W);
  add('ballast', 256, 512, pBallast, { wrapY: true });
  add('bedSlope', 64, 512, pBedSlope, { wrapY: true });
  add('gravel', 256, 256, pGravel, W);
  add('sleeperTop', 256, 64, pSleeperTop);
  add('sleeperSide', 256, 32, pSleeperSide, { wrapX: true });
  add('asphalt', 256, 256, pAsphalt, W);
  add('sidewalk', 256, 256, pSidewalk, W);
  add('grass', 256, 256, pGrass, W);
  add('dirt', 256, 256, pDirt, W);
  add('platformTop', 256, 256, pPlatformTop, W);
  add('platformEdge', 256, 64, pPlatformEdge, { wrapX: true });
  add('concrete', 256, 256, pConcrete, { wrapX: true });
  add('brick', 256, 256, pBrick, W);
  add('stucco', 256, 256, pStucco, W);
  add('siding', 256, 256, pSiding, W);
  add('corrugated', 256, 256, pCorrugated, W);
  add('tiles', 256, 256, pTiles, W);
  add('roof', 256, 256, pRoof, W);
  add('metal', 256, 128, pMetal, { wrapX: true });
  add('wood', 128, 128, pWood, W);
  add('container', 256, 128, pContainer, { wrapX: true });
  add('containerDoor', 128, 128, pContainerDoor);
  add('pillar', 128, 256, pPillar, { wrapY: true });
  for (let i = 0; i < GRAFFITI_COUNT; i++) add('graf' + i, 384, 256, (g, w, h) => paintGraffitiPanel(g, w, h, i), { text: true });
  for (let i = 0; i < WINDOW_COUNT; i++) add('win' + i, 128, 160, pWindow(i));
  add('shop0', 256, 192, pShop(0)); add('shop1', 256, 192, pShop(1));
  add('door', 128, 192, pDoor);
  add('garage', 256, 256, pGarage);
  for (let i = 0; i < 3; i++) add('awning' + i, 128, 64, pAwning(i), { wrapX: true });
  for (let i = 0; i < BILLBOARD_COUNT; i++) add('bb' + i, 512, 256, (g, w, h) => paintBillboard(g, w, h, i), { text: true });
  for (let i = 0; i < SIGN_COUNT; i++) add('sign' + i, 256, 64, (g, w, h) => paintSign(g, w, h, i), { text: true });
  add('cabinet', 128, 128, pCabinet);
  add('ac', 64, 64, pAC);
  add('vending', 128, 256, pVending);
  add('clock', 64, 64, pClock);
  add('signal', 64, 128, pSignal);
  for (let i = 0; i < 4; i++) add('poster' + i, 96, 144, (g, w, h) => paintPoster(g, w, h, i), { text: true });
  add('far0', 256, 256, pFar(0), W); add('far1', 256, 256, pFar(1), W);
  main.pack(); main.paintAll();

  const cut = new Atlas(1024, true);
  const addc = (...a) => cut.add(...a);
  addc('chainlink', 256, 256, pChainlink, W);
  addc('barbed', 256, 32, pBarbed, { wrapX: true });
  addc('railing', 256, 128, pRailing, { wrapX: true });
  addc('grate', 128, 128, pGrate, W);
  addc('truss', 256, 128, pTruss, { wrapX: true });
  addc('leaves0', 256, 256, pLeaves(0)); addc('leaves1', 256, 256, pLeaves(1));
  addc('tuft', 128, 64, pTuft);
  addc('glow', 128, 128, pGlow);
  addc('pool', 128, 128, pPool);
  for (let i = 0; i < 3; i++) addc('winLit' + i, 128, 160, pWinLit(i));
  addc('shopLit', 256, 192, pShopLit);
  addc('farLit0', 256, 256, pFarLit(0), W); addc('farLit1', 256, 256, pFarLit(1), W);
  for (let i = 0; i < SIGN_COUNT; i++) addc('signGlow' + i, 256, 64, (g, w, h) => paintSignGlow(g, w, h, i), { text: true });
  addc('sparkle', 64, 64, pSparkle);
  addc('beam', 64, 128, pBeam);
  addc('wash', 64, 64, pWash);
  cut.pack(); cut.paintAll();

  const mainTex = main.makeTexture();
  const cutTex = cut.makeTexture();
  if (quality === 'low') { mainTex.anisotropy = 2; cutTex.anisotropy = 2; }

  // repaint text regions once the display font is available
  const fontReady = loadDisplayFont().then((ok) => {
    if (!ok) return false;
    main.paintAll((it) => it.text); mainTex.needsUpdate = true;
    cut.paintAll((it) => it.text); cutTex.needsUpdate = true;
    return true;
  });

  return {
    main, cut, mainTex, cutTex, fontReady,
    R: (n) => main.rect(n),
    C: (n) => cut.rect(n),
  };
}
