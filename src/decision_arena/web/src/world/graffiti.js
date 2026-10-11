// WORLD: graffiti, billboards and signs painted on canvases. All names / tags / brands are original to Rail Dash.
import { FONT_CSS } from '../ui/fonts.js';

// ------------------------------------------------------------------ display font (Luckiest Guy from the shared data URI)
export const FONT_FAMILY = 'RDWorld';
let fontReady = false;
let fontPromise = null;
export const font = (px) => `${px}px ${fontReady ? FONT_FAMILY + ', ' : ''}"Arial Black", "Luckiest Guy", Impact, "Helvetica Neue", Arial, sans-serif`;
export function loadDisplayFont() {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    try {
      if (typeof FontFace === 'undefined' || !document.fonts) return false;
      const m = /font-family:\s*'Luckiest Guy'[^}]*?src:\s*url\(([^)]+)\)/.exec(FONT_CSS || '');
      if (!m) return false;
      const face = new FontFace(FONT_FAMILY, `url(${m[1]})`);
      await face.load();
      document.fonts.add(face);
      fontReady = true;
      return true;
    } catch (e) {
      return false;
    }
  })();
  return fontPromise;
}
export const isFontReady = () => fontReady;

// ------------------------------------------------------------------ small helpers
export function mulberry(seed) {
  let s = seed >>> 0 || 1;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), s | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const INK = '#1b1238';
export const GRAF = ['#ff4fa3', '#c6ff3d', '#ffc93c', '#19b3b1', '#3a6fd8', '#f2553d', '#8b5cf6', '#ff8a1f', '#5ec8f5', '#8edc4a'];

export function star(g, x, y, r, points = 5, inner = 0.48, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const a = rot + (i * Math.PI) / points;
    const rr = i % 2 ? r * inner : r;
    g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
}
export function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath();
}
function sparkle(g, x, y, r, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y - r); g.quadraticCurveTo(x, y, x + r, y); g.quadraticCurveTo(x, y, x, y + r);
  g.quadraticCurveTo(x, y, x - r, y); g.quadraticCurveTo(x, y, x, y - r); g.fill();
}

/**
 * Chunky graffiti piece: 3D block shadow, double outline, gradient fill with highlights, drips.
 * Drawn centered at (x, y). Returns the measured width.
 */
export function bubbleText(g, text, x, y, size, o = {}) {
  const R = o.rand || Math.random;
  const fill = o.fill || ['#ff4fa3', '#ffc93c'];
  const outline = o.outline || '#ffffff';
  const ink = o.ink || INK;
  g.save();
  g.translate(x, y);
  g.rotate(o.rot || 0);
  if (o.skew) g.transform(1, 0, o.skew, 1, 0, 0);
  g.font = font(size);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.miterLimit = 2;
  // letter spacing squeeze: draw per letter for a jumpy, hand-made baseline
  const letters = [...text];
  const widths = letters.map((ch) => g.measureText(ch).width * 0.9);
  const total = widths.reduce((a, b) => a + b, 0);
  const pos = [];
  let cx = -total / 2;
  for (let i = 0; i < letters.length; i++) {
    const w = widths[i];
    pos.push({ ch: letters[i], x: cx + w / 2, y: (R() - 0.5) * size * (o.bounce ?? 0.14), r: (R() - 0.5) * (o.wobble ?? 0.16), s: 1 + (R() - 0.5) * 0.12 });
    cx += w;
  }
  const each = (fn) => { for (const p of pos) { g.save(); g.translate(p.x, p.y); g.rotate(p.r); g.scale(p.s, p.s); fn(p); g.restore(); } };
  // block shadow (extrusion)
  const depth = o.depth ?? size * 0.09;
  g.fillStyle = ink; g.strokeStyle = ink; g.lineWidth = size * 0.26;
  for (let d = depth; d > 0; d -= Math.max(1, depth / 6)) {
    each((p) => { g.strokeText(p.ch, d * 0.8, d); g.fillText(p.ch, d * 0.8, d); });
  }
  // outer ink outline + bright outline
  g.strokeStyle = ink; g.lineWidth = size * 0.26;
  each((p) => g.strokeText(p.ch, 0, 0));
  g.strokeStyle = outline; g.lineWidth = size * 0.13;
  each((p) => g.strokeText(p.ch, 0, 0));
  // gradient fill
  const grad = g.createLinearGradient(0, -size * 0.5, 0, size * 0.5);
  fill.forEach((c, i) => grad.addColorStop(fill.length === 1 ? 0 : i / (fill.length - 1), c));
  g.fillStyle = grad;
  each((p) => g.fillText(p.ch, 0, 0));
  // inner highlights: short white strokes top-left of each letter
  g.fillStyle = 'rgba(255,255,255,0.75)';
  each(() => {
    g.beginPath(); g.ellipse(-size * 0.14, -size * 0.2, size * 0.06, size * 0.035, -0.6, 0, Math.PI * 2); g.fill();
    g.beginPath(); g.arc(-size * 0.02, -size * 0.27, size * 0.022, 0, Math.PI * 2); g.fill();
  });
  // drips
  if (o.drips !== false) {
    const dc = o.dripColor || fill[fill.length - 1];
    g.strokeStyle = dc; g.fillStyle = dc; g.lineCap = 'round';
    const n = Math.max(2, Math.round(letters.length * 0.8));
    for (let i = 0; i < n; i++) {
      const p = pos[(R() * pos.length) | 0];
      const dx = p.x + (R() - 0.5) * widths[0] * 0.5;
      const len = size * (0.15 + R() * 0.45);
      g.lineWidth = size * (0.035 + R() * 0.03);
      g.beginPath(); g.moveTo(dx, size * 0.25); g.lineTo(dx, size * 0.3 + len); g.stroke();
      g.beginPath(); g.arc(dx, size * 0.3 + len, g.lineWidth * 0.85, 0, Math.PI * 2); g.fill();
    }
  }
  g.restore();
  return total;
}

/** Quick hand-style tag (thin, fast strokes). */
export function tag(g, text, x, y, size, color, rot = -0.12, R = Math.random) {
  g.save();
  g.translate(x, y); g.rotate(rot); g.transform(1, 0, -0.35, 1, 0, 0);
  g.font = `italic 700 ${size}px "Comic Sans MS", "Segoe Print", "Bradley Hand", cursive, sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineJoin = 'round';
  g.strokeStyle = color; g.lineWidth = size * 0.1;
  g.strokeText(text, 0, 0);
  g.fillStyle = color; g.fillText(text, 0, 0);
  // underline swoosh
  g.lineWidth = size * 0.08; g.lineCap = 'round';
  const w = g.measureText(text).width;
  g.beginPath(); g.moveTo(-w * 0.55, size * 0.55); g.quadraticCurveTo(0, size * (0.75 + R() * 0.3), w * 0.62, size * 0.35); g.stroke();
  g.restore();
}

function spraySplat(g, x, y, r, color, R) {
  g.fillStyle = color;
  g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
  for (let i = 0; i < 14; i++) {
    const a = R() * Math.PI * 2, d = r * (1 + R() * 0.9), rr = r * (0.06 + R() * 0.16);
    g.beginPath(); g.arc(x + Math.cos(a) * d, y + Math.sin(a) * d, rr, 0, Math.PI * 2); g.fill();
  }
}
function arrow(g, x, y, len, rot, color, width) {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = INK; g.lineWidth = width + 8;
  const path = () => { g.beginPath(); g.moveTo(-len / 2, 0); g.bezierCurveTo(-len / 6, -len * 0.35, len / 6, len * 0.3, len / 2, -len * 0.05); };
  path(); g.stroke();
  g.strokeStyle = color; g.lineWidth = width; path(); g.stroke();
  // head
  g.translate(len / 2, -len * 0.05); g.rotate(-0.35);
  g.fillStyle = INK; g.beginPath(); g.moveTo(width * 1.9, 0); g.lineTo(-width * 1.1, -width * 1.7); g.lineTo(-width * 1.1, width * 1.7); g.closePath(); g.fill();
  g.fillStyle = color; g.beginPath(); g.moveTo(width * 1.3, 0); g.lineTo(-width * 0.7, -width * 1.15); g.lineTo(-width * 0.7, width * 1.15); g.closePath(); g.fill();
  g.restore();
}
function crown(g, x, y, s, color) {
  g.save(); g.translate(x, y);
  g.lineJoin = 'round'; g.lineWidth = s * 0.14; g.strokeStyle = INK; g.fillStyle = color;
  g.beginPath();
  g.moveTo(-s, s * 0.5); g.lineTo(-s, -s * 0.35); g.lineTo(-s * 0.5, s * 0.05); g.lineTo(0, -s * 0.6);
  g.lineTo(s * 0.5, s * 0.05); g.lineTo(s, -s * 0.35); g.lineTo(s, s * 0.5); g.closePath();
  g.stroke(); g.fill();
  g.fillStyle = '#fff';
  for (const px of [-s, 0, s]) { g.beginPath(); g.arc(px, px === 0 ? -s * 0.68 : -s * 0.42, s * 0.12, 0, Math.PI * 2); g.fill(); }
  g.restore();
}
function heart(g, x, y, s, color) {
  g.save(); g.translate(x, y); g.scale(s, s);
  g.beginPath(); g.moveTo(0, 0.35); g.bezierCurveTo(-1.1, -0.35, -0.45, -1.05, 0, -0.45); g.bezierCurveTo(0.45, -1.05, 1.1, -0.35, 0, 0.35);
  g.lineWidth = 0.16; g.strokeStyle = INK; g.stroke(); g.fillStyle = color; g.fill();
  g.restore();
}
function inkStar(g, x, y, r, color, rot = -Math.PI / 2) {
  star(g, x, y, r, 5, 0.5, rot);
  g.lineJoin = 'round'; g.lineWidth = r * 0.22; g.strokeStyle = INK; g.stroke();
  g.fillStyle = color; g.fill();
  g.fillStyle = 'rgba(255,255,255,0.7)';
  g.beginPath(); g.arc(x - r * 0.18, y - r * 0.2, r * 0.13, 0, Math.PI * 2); g.fill();
}
function cloudBlob(g, x, y, w, h, color, R) {
  // throw-up background blob behind letters
  g.save();
  g.fillStyle = color; g.strokeStyle = INK; g.lineWidth = Math.max(4, h * 0.07);
  g.beginPath();
  const n = 9;
  for (let i = 0; i <= n; i++) {
    const a = (i / n) * Math.PI * 2;
    const rx = w / 2 * (0.92 + R() * 0.16), ry = h / 2 * (0.88 + R() * 0.2);
    const px = x + Math.cos(a) * rx, py = y + Math.sin(a) * ry;
    if (i === 0) g.moveTo(px, py); else g.quadraticCurveTo(x + Math.cos(a - Math.PI / n) * rx * 1.18, y + Math.sin(a - Math.PI / n) * ry * 1.18, px, py);
  }
  g.closePath(); g.stroke(); g.fill();
  g.restore();
}

// ------------------------------------------------------------------ concrete base shared by walls / panels
export function concreteBase(g, w, h, R, base = '#bdb6a9', seams = true) {
  g.fillStyle = base; g.fillRect(0, 0, w, h);
  // soft blotches
  for (let i = 0; i < 26; i++) {
    const x = R() * w, y = R() * h, r = 12 + R() * 40;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const dark = R() < 0.55;
    gr.addColorStop(0, dark ? 'rgba(90,80,70,0.10)' : 'rgba(255,255,245,0.10)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  // speckle
  for (let i = 0; i < w * h / 60; i++) {
    g.fillStyle = R() < 0.5 ? 'rgba(80,70,60,0.18)' : 'rgba(255,255,255,0.16)';
    g.fillRect(R() * w, R() * h, 1 + R() * 1.5, 1 + R() * 1.5);
  }
  // rain streaks from the top
  for (let i = 0; i < w / 10; i++) {
    const x = R() * w, len = h * (0.15 + R() * 0.5);
    const gr = g.createLinearGradient(0, 0, 0, len);
    gr.addColorStop(0, 'rgba(70,60,50,0.16)'); gr.addColorStop(1, 'rgba(70,60,50,0)');
    g.fillStyle = gr; g.fillRect(x, 0, 2 + R() * 5, len);
  }
  if (seams) {
    g.fillStyle = 'rgba(60,55,50,0.28)';
    g.fillRect(0, h * 0.5 - 1, w, 2);
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(0, h * 0.5 + 1, w, 1);
    // form-tie holes
    for (let yy = h * 0.2; yy < h; yy += h * 0.3) for (let xx = w / 8; xx < w; xx += w / 4) {
      g.fillStyle = 'rgba(50,45,40,0.45)'; g.beginPath(); g.arc(xx, yy, 2.2, 0, Math.PI * 2); g.fill();
    }
  }
  // bottom grime
  const gb = g.createLinearGradient(0, h * 0.75, 0, h);
  gb.addColorStop(0, 'rgba(60,50,40,0)'); gb.addColorStop(1, 'rgba(60,50,40,0.25)');
  g.fillStyle = gb; g.fillRect(0, h * 0.75, w, h * 0.25);
}

// ------------------------------------------------------------------ graffiti wall panels (8 compositions)
const WORDS = ['RAIL DASH', 'ZOOM', 'RUN!', 'TAG', 'DASH', 'GO!', 'WOW', 'HOP', 'YO!', 'BOOM', 'FAST', 'JUMP', 'SWISH', 'LOL', 'RDX', 'NOVA', 'KAPOW', 'ZIP'];
const FILLS = [
  ['#ff4fa3', '#ffc93c'], ['#c6ff3d', '#19b3b1'], ['#5ec8f5', '#3a6fd8'], ['#ffc93c', '#f2553d'],
  ['#8b5cf6', '#ff4fa3'], ['#ff8a1f', '#ffc93c', '#fff27a'], ['#19b3b1', '#c6ff3d'], ['#f2553d', '#8b5cf6'],
];

export function paintGraffitiPanel(g, w, h, variant) {
  const R = mulberry(9001 + variant * 7919);
  concreteBase(g, w, h, R, ['#bdb6a9', '#b3ada3', '#c4bdb0', '#aaa49a'][variant % 4], true);
  // faded old paint patches (buffed walls)
  for (let i = 0; i < 3; i++) {
    g.fillStyle = ['rgba(150,160,170,0.35)', 'rgba(170,150,140,0.3)', 'rgba(140,150,130,0.3)'][i];
    const x = R() * w * 0.8, y = R() * h * 0.6;
    g.fillRect(x, y, w * (0.15 + R() * 0.3), h * (0.2 + R() * 0.3));
  }
  // background small tags
  for (let i = 0; i < 6; i++) tag(g, WORDS[(R() * WORDS.length) | 0].toLowerCase(), R() * w, h * (0.15 + R() * 0.75), 14 + R() * 12, ['#1b1238', '#3a3050', '#6a2b8a', '#1f5a8a'][(R() * 4) | 0], (R() - 0.5) * 0.4, R);
  const fill = FILLS[variant % FILLS.length];
  const s = Math.min(w, h * 1.5);
  switch (variant % 8) {
    case 0: // big RAIL DASH piece with stars
      cloudBlob(g, w * 0.5, h * 0.52, w * 0.9, h * 0.62, '#3a6fd8', R);
      bubbleText(g, 'RAIL DASH', w * 0.5, h * 0.52, s * 0.19, { fill, rand: R, rot: -0.05, outline: '#ffffff' });
      inkStar(g, w * 0.1, h * 0.2, s * 0.06, '#ffc93c'); inkStar(g, w * 0.9, h * 0.8, s * 0.05, '#c6ff3d', 0.3);
      sparkle(g, w * 0.86, h * 0.2, s * 0.045, '#ffffff');
      break;
    case 1: // ZOOM with arrow
      bubbleText(g, 'ZOOM', w * 0.46, h * 0.48, s * 0.3, { fill, rand: R, rot: -0.12, skew: -0.15 });
      arrow(g, w * 0.5, h * 0.84, w * 0.62, 0.05, '#ff4fa3', 10);
      inkStar(g, w * 0.88, h * 0.26, s * 0.07, '#ffc93c');
      break;
    case 2: // RUN! throw-up + heart
      cloudBlob(g, w * 0.42, h * 0.5, w * 0.62, h * 0.6, '#ffffff', R);
      bubbleText(g, 'RUN!', w * 0.42, h * 0.5, s * 0.27, { fill, rand: R, rot: 0.06, outline: '#1b1238', depth: 6 });
      heart(g, w * 0.84, h * 0.4, s * 0.1, '#ff4fa3');
      spraySplat(g, w * 0.86, h * 0.8, 10, '#c6ff3d', R);
      break;
    case 3: // TAG + crown
      crown(g, w * 0.5, h * 0.2, s * 0.08, '#ffc93c');
      bubbleText(g, 'TAG', w * 0.5, h * 0.58, s * 0.33, { fill, rand: R, rot: -0.04 });
      sparkle(g, w * 0.12, h * 0.3, s * 0.05, '#fff'); sparkle(g, w * 0.9, h * 0.75, s * 0.04, '#fff');
      break;
    case 4: // two stacked words
      bubbleText(g, 'GO', w * 0.3, h * 0.36, s * 0.24, { fill: ['#c6ff3d', '#8edc4a'], rand: R, rot: -0.1 });
      bubbleText(g, 'DASH', w * 0.6, h * 0.66, s * 0.22, { fill, rand: R, rot: 0.05 });
      inkStar(g, w * 0.82, h * 0.24, s * 0.07, '#ff4fa3', 0.2);
      break;
    case 5: // WOW with bubbles + splats
      for (let i = 0; i < 7; i++) { g.strokeStyle = '#ffffff'; g.lineWidth = 3; g.beginPath(); g.arc(R() * w, R() * h * 0.4, 6 + R() * 12, 0, Math.PI * 2); g.stroke(); }
      bubbleText(g, 'WOW', w * 0.5, h * 0.55, s * 0.3, { fill, rand: R, rot: 0.03, skew: 0.1 });
      spraySplat(g, w * 0.12, h * 0.78, 12, '#19b3b1', R); spraySplat(g, w * 0.9, h * 0.3, 9, '#ffc93c', R);
      break;
    case 6: // BOOM comic burst
      g.save(); star(g, w * 0.5, h * 0.52, h * 0.46, 12, 0.72, 0.1); g.fillStyle = '#ffc93c'; g.fill(); g.lineWidth = 6; g.strokeStyle = INK; g.stroke(); g.restore();
      bubbleText(g, 'BOOM', w * 0.5, h * 0.53, s * 0.2, { fill: ['#f2553d', '#ff4fa3'], rand: R, rot: -0.08, outline: '#ffffff' });
      break;
    default: // HOP + arrows + stars
      bubbleText(g, 'HOP', w * 0.36, h * 0.5, s * 0.28, { fill, rand: R, rot: -0.14 });
      arrow(g, w * 0.78, h * 0.42, w * 0.3, -0.9, '#5ec8f5', 8);
      inkStar(g, w * 0.84, h * 0.8, s * 0.06, '#ff4fa3');
      inkStar(g, w * 0.1, h * 0.2, s * 0.045, '#c6ff3d');
  }
}

// ------------------------------------------------------------------ billboards (fictional brands)
export function paintBillboard(g, w, h, variant) {
  const R = mulberry(5150 + variant * 131);
  g.save();
  const bg = [
    ['#ff4fa3', '#ff8ac7'], ['#ffc93c', '#ff8a1f'], ['#3a6fd8', '#5ec8f5'], ['#1b1238', '#3a2a78'],
  ][variant % 4];
  const gr = g.createLinearGradient(0, 0, w, h); gr.addColorStop(0, bg[0]); gr.addColorStop(1, bg[1]);
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
  // sunburst rays
  g.globalAlpha = 0.14; g.fillStyle = '#ffffff';
  for (let i = 0; i < 16; i += 2) {
    const a0 = (i / 16) * Math.PI * 2, a1 = ((i + 1) / 16) * Math.PI * 2;
    g.beginPath(); g.moveTo(w * 0.7, h * 0.5); g.lineTo(w * 0.7 + Math.cos(a0) * w, h * 0.5 + Math.sin(a0) * w); g.lineTo(w * 0.7 + Math.cos(a1) * w, h * 0.5 + Math.sin(a1) * w); g.fill();
  }
  g.globalAlpha = 1;
  const title = (text, x, y, size, col, stroke = INK) => {
    g.font = font(size); g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    g.lineWidth = size * 0.2; g.strokeStyle = stroke; g.strokeText(text, x, y);
    g.fillStyle = col; g.fillText(text, x, y);
  };
  switch (variant % 4) {
    case 0: { // FIZZ POP soda
      // bottle
      g.save(); g.translate(w * 0.76, h * 0.54); g.rotate(0.18);
      g.fillStyle = INK; roundRect(g, -34, -88, 68, 176, 22); g.fill();
      g.fillStyle = '#19b3b1'; roundRect(g, -28, -82, 56, 164, 18); g.fill();
      g.fillStyle = '#ffffff'; roundRect(g, -28, -18, 56, 46, 6); g.fill();
      g.fillStyle = '#ff4fa3'; g.font = font(20); g.textAlign = 'center'; g.fillText('FIZZ', 0, 6);
      g.fillStyle = 'rgba(255,255,255,0.55)'; roundRect(g, -20, -74, 10, 50, 5); g.fill();
      g.fillStyle = INK; g.fillRect(-14, -112, 28, 28); g.fillStyle = '#f2553d'; g.fillRect(-12, -110, 24, 12);
      g.restore();
      for (let i = 0; i < 22; i++) { g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 3; g.beginPath(); g.arc(w * (0.55 + R() * 0.42), h * R(), 3 + R() * 9, 0, Math.PI * 2); g.stroke(); }
      title('FIZZ POP', w * 0.36, h * 0.4, h * 0.26, '#ffffff');
      title('the bubbliest soda in town', w * 0.36, h * 0.72, h * 0.075, '#ffffff', '#b8246e');
      break;
    }
    case 1: { // BYTE BURGER
      g.save(); g.translate(w * 0.74, h * 0.52);
      const layer = (y, hh, c, r = 90) => { g.fillStyle = INK; roundRect(g, -r - 5, y - 5, r * 2 + 10, hh + 10, hh / 2 + 5); g.fill(); g.fillStyle = c; roundRect(g, -r, y, r * 2, hh, hh / 2); g.fill(); };
      g.fillStyle = INK; g.beginPath(); g.ellipse(0, -30, 98, 62, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#f0a33c'; g.beginPath(); g.ellipse(0, -30, 90, 56, 0, Math.PI, 0); g.fill();
      g.fillStyle = '#fff3c8'; for (let i = 0; i < 9; i++) { g.beginPath(); g.ellipse(-60 + i * 15, -58 + (i % 2) * 14, 4, 2.5, 0.4, 0, Math.PI * 2); g.fill(); }
      layer(-30, 16, '#8edc4a', 96); layer(-14, 14, '#f2553d', 92); layer(0, 24, '#6b3a1e', 88); layer(24, 12, '#ffc93c', 94);
      layer(36, 26, '#f0a33c', 86);
      g.restore();
      title('BYTE', w * 0.3, h * 0.3, h * 0.25, '#ffc93c');
      title('BURGER', w * 0.3, h * 0.58, h * 0.22, '#ffffff');
      title('grab a bite!', w * 0.3, h * 0.84, h * 0.075, '#1b1238', '#ffffff');
      break;
    }
    case 2: { // NOVA KICKS sneakers
      g.save(); g.translate(w * 0.72, h * 0.6); g.rotate(-0.12); g.lineJoin = 'round';
      g.fillStyle = INK;
      g.beginPath(); g.moveTo(-110, 30); g.lineTo(-100, -40); g.quadraticCurveTo(-60, -60, -30, -40); g.lineTo(40, -10); g.quadraticCurveTo(110, 0, 115, 30); g.closePath(); g.fill();
      g.fillStyle = '#c6ff3d';
      g.beginPath(); g.moveTo(-102, 24); g.lineTo(-94, -34); g.quadraticCurveTo(-60, -52, -32, -34); g.lineTo(40, -4); g.quadraticCurveTo(102, 4, 107, 24); g.closePath(); g.fill();
      g.fillStyle = '#ffffff'; g.fillRect(-106, 22, 216, 16); g.fillStyle = INK; g.fillRect(-106, 36, 216, 4);
      g.strokeStyle = '#8b5cf6'; g.lineWidth = 7; g.beginPath(); g.moveTo(-70, 0); g.quadraticCurveTo(0, -20, 60, 14); g.stroke();
      g.restore();
      for (let i = 0; i < 5; i++) { g.strokeStyle = 'rgba(255,255,255,0.8)'; g.lineWidth = 5; g.beginPath(); g.moveTo(w * 0.46 - i * 8, h * (0.45 + i * 0.07)); g.lineTo(w * 0.52 - i * 8, h * (0.45 + i * 0.07)); g.stroke(); }
      title('NOVA', w * 0.28, h * 0.32, h * 0.26, '#c6ff3d');
      title('KICKS', w * 0.28, h * 0.6, h * 0.22, '#ffffff');
      title('jump higher', w * 0.28, h * 0.84, h * 0.075, '#ffffff', '#1b1238');
      break;
    }
    default: { // RAIL DASH promo
      for (let i = 0; i < 30; i++) { g.fillStyle = `rgba(255,255,255,${0.3 + R() * 0.6})`; g.beginPath(); g.arc(R() * w, R() * h, 1 + R() * 2, 0, Math.PI * 2); g.fill(); }
      // coin
      g.save(); g.translate(w * 0.8, h * 0.5);
      g.fillStyle = INK; g.beginPath(); g.arc(0, 0, 72, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffc21a'; g.beginPath(); g.arc(0, 0, 64, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#ffe07a'; g.beginPath(); g.arc(0, 0, 48, 0, Math.PI * 2); g.fill();
      g.fillStyle = '#e8a300'; star(g, 0, 2, 32, 5, 0.5); g.fill();
      g.restore();
      bubbleText(g, 'RAIL DASH', w * 0.38, h * 0.42, h * 0.24, { fill: ['#ff4fa3', '#ffc93c'], rand: R, drips: false, wobble: 0.08, bounce: 0.06 });
      title('RUN THE RAILS', w * 0.38, h * 0.8, h * 0.09, '#c6ff3d');
    }
  }
  // frame shading
  g.strokeStyle = 'rgba(0,0,0,0.25)'; g.lineWidth = 6; g.strokeRect(3, 3, w - 6, h - 6);
  g.restore();
}

// ------------------------------------------------------------------ signs
export function paintSign(g, w, h, variant) {
  const texts = [
    { t: 'DASHWOOD', bg: '#1f4fb8', fg: '#ffffff', icon: true },
    { t: 'PLATFORM 2', bg: '#1b1238', fg: '#ffffff' },
    { t: 'NOODLES', bg: '#2a1440', fg: '#ff4fa3', neon: true },
    { t: 'OPEN 24', bg: '#101a30', fg: '#5ec8f5', neon: true },
    { t: 'ARCADE', bg: '#1a0f30', fg: '#c6ff3d', neon: true },
    { t: 'PIZZA', bg: '#3a1010', fg: '#ffc93c', neon: true },
    { t: 'HOTEL', bg: '#101030', fg: '#ff8a1f', neon: true },
    { t: 'EXIT', bg: '#0e7a3e', fg: '#ffffff', arrow: true },
  ];
  const s = texts[variant % texts.length];
  g.fillStyle = s.bg; g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = Math.max(2, h * 0.05); g.strokeRect(h * 0.08, h * 0.08, w - h * 0.16, h - h * 0.16);
  let size = h * 0.62;
  g.font = font(size);
  const maxW = w * (s.icon || s.arrow ? 0.72 : 0.88);
  const tw = g.measureText(s.t).width;
  if (tw > maxW) size *= maxW / tw;
  g.font = font(size); g.textAlign = 'center'; g.textBaseline = 'middle';
  const cx = s.icon ? w * 0.56 : s.arrow ? w * 0.42 : w / 2;
  if (s.neon) {
    g.lineJoin = 'round';
    g.strokeStyle = s.fg; g.globalAlpha = 0.35; g.lineWidth = size * 0.22; g.strokeText(s.t, cx, h * 0.54);
    g.globalAlpha = 1; g.lineWidth = size * 0.08; g.strokeText(s.t, cx, h * 0.54);
    g.fillStyle = '#ffffff'; g.fillText(s.t, cx, h * 0.54);
  } else {
    g.fillStyle = s.fg; g.fillText(s.t, cx, h * 0.54);
  }
  if (s.icon) { // little train glyph
    g.fillStyle = '#ffffff'; roundRect(g, h * 0.18, h * 0.22, h * 0.6, h * 0.5, h * 0.1); g.fill();
    g.fillStyle = s.bg; g.fillRect(h * 0.26, h * 0.3, h * 0.44, h * 0.18);
    g.fillStyle = '#ffffff'; g.beginPath(); g.arc(h * 0.3, h * 0.8, h * 0.06, 0, 7); g.arc(h * 0.66, h * 0.8, h * 0.06, 0, 7); g.fill();
  }
  if (s.arrow) { g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(w * 0.93, h / 2); g.lineTo(w * 0.8, h * 0.2); g.lineTo(w * 0.8, h * 0.8); g.fill(); g.fillRect(w * 0.7, h * 0.4, w * 0.12, h * 0.2); }
}
/** Additive glow version of the neon signs (for night). */
export function paintSignGlow(g, w, h, variant) {
  const cols = ['#9fc4ff', '#ffffff', '#ff4fa3', '#5ec8f5', '#c6ff3d', '#ffc93c', '#ff8a1f', '#7dffb0'];
  const texts = ['DASHWOOD', 'PLATFORM 2', 'NOODLES', 'OPEN 24', 'ARCADE', 'PIZZA', 'HOTEL', 'EXIT'];
  g.fillStyle = '#000'; g.fillRect(0, 0, w, h);
  const t = texts[variant % texts.length];
  let size = h * 0.62;
  g.font = font(size);
  const maxW = w * (variant === 0 || variant === 7 ? 0.72 : 0.88);
  const tw = g.measureText(t).width;
  if (tw > maxW) size *= maxW / tw;
  g.font = font(size); g.textAlign = 'center'; g.textBaseline = 'middle';
  const cx = variant === 0 ? w * 0.56 : variant === 7 ? w * 0.42 : w / 2;
  g.lineJoin = 'round';
  if (variant <= 1 || variant === 7) { // back-lit box signs: soft even glow
    const gr = g.createLinearGradient(0, 0, 0, h); gr.addColorStop(0, 'rgba(90,110,150,0.9)'); gr.addColorStop(1, 'rgba(60,70,110,0.9)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
    g.fillStyle = cols[variant % cols.length]; g.fillText(t, cx, h * 0.54);
    return;
  }
  g.shadowColor = cols[variant % cols.length]; g.shadowBlur = h * 0.3;
  g.strokeStyle = cols[variant % cols.length]; g.lineWidth = size * 0.16; g.strokeText(t, cx, h * 0.54);
  g.shadowBlur = h * 0.12; g.lineWidth = size * 0.07; g.strokeText(t, cx, h * 0.54);
  g.shadowBlur = 0; g.fillStyle = '#ffffff'; g.fillText(t, cx, h * 0.54);
}

// ------------------------------------------------------------------ posters (small wall posters)
export function paintPoster(g, w, h, variant) {
  const R = mulberry(777 + variant);
  const bgs = ['#ffc93c', '#19b3b1', '#ff4fa3', '#8b5cf6'];
  g.fillStyle = bgs[variant % 4]; g.fillRect(0, 0, w, h);
  g.fillStyle = '#ffffff'; g.fillRect(6, 6, w - 12, h - 12);
  g.fillStyle = bgs[variant % 4]; g.fillRect(10, 10, w - 20, h * 0.55);
  g.fillStyle = INK; g.beginPath(); g.arc(w / 2, h * 0.36, w * 0.22, 0, 7); g.fill();
  g.fillStyle = '#ffffff'; star(g, w / 2, h * 0.36, w * 0.14, 5, 0.5); g.fill();
  const lines = [['BEAT', 'NIGHT'], ['RAIL', 'JAM'], ['SKATE', 'DAY'], ['BLOCK', 'PARTY']][variant % 4];
  g.fillStyle = INK; g.font = font(h * 0.12); g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(lines[0], w / 2, h * 0.72); g.fillText(lines[1], w / 2, h * 0.85);
  for (let i = 0; i < 12; i++) { g.fillStyle = 'rgba(0,0,0,0.08)'; g.fillRect(R() * w, R() * h, 2, 8); }
}
