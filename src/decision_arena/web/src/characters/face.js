// Painted faces. Each rig owns a small canvas texture mapped onto a sphere patch in front of the head
// (or a flat screen for robots). The canvas is only redrawn when expression / blink / gaze change.
//
// Human faces are drawn in "degree space": x = horizontal angle from the face center (negative = viewer's left),
// y = polar angle theta from the top of the head. The patch covers x in [-62, 62] and theta in [55, 135] degrees,
// so features keep their proportions on the sphere.
import * as THREE from 'three';

export const FACE_PATCH = { halfPhi: THREE.MathUtils.degToRad(62), thetaStart: THREE.MathUtils.degToRad(55), thetaLen: THREE.MathUtils.degToRad(80) };
const PHI_SPAN = 124, TH0 = 55, TH_SPAN = 80;

/** Expressions: eyes, lid (0 open .. 1 closed), brow {y, tilt}, mouth */
export const EXPR = {
  neutral:   { eyes: 'open', lid: 0.05, by: 0, bt: 0, mouth: 'smile' },
  idle:      { eyes: 'open', lid: 0.05, by: 0, bt: 0, mouth: 'smile' },
  happy:     { eyes: 'happy', by: -3, bt: -3, mouth: 'grin' },
  laugh:     { eyes: 'happy', by: -4, bt: -4, mouth: 'laugh' },
  run:       { eyes: 'open', lid: 0.3, by: 2.5, bt: 7, mouth: 'smirk' },
  focus:     { eyes: 'open', lid: 0.35, by: 3, bt: 9, mouth: 'teeth' },
  excited:   { eyes: 'open', lid: 0, by: -4, bt: -2, mouth: 'grin', sparkle: true },
  surprised: { eyes: 'wide', by: -6, bt: -3, mouth: 'o' },
  scared:    { eyes: 'wide', by: -5, bt: -10, mouth: 'wavy', sweat: true },
  hurt:      { eyes: 'x', by: -2, bt: -8, mouth: 'wavy' },
  dizzy:     { eyes: 'spiral', by: -3, bt: -6, mouth: 'wavy' },
  sad:       { eyes: 'open', lid: 0.5, by: -1, bt: -12, mouth: 'frown', lookY: 0.8 },
  wink:      { eyes: 'wink', by: -2, bt: -2, mouth: 'tongue' },
  roar:      { eyes: 'open', lid: 0.35, by: 3, bt: 12, mouth: 'roar' },
  yawn:      { eyes: 'closed', by: -2, bt: -5, mouth: 'yawn' },
  cool:      { eyes: 'open', lid: 0.42, by: 1, bt: 3, mouth: 'smirk' },
  // guard specific
  stern:     { eyes: 'open', lid: 0.3, by: 3, bt: 11, mouth: 'flat' },
  shout:     { eyes: 'open', lid: 0.1, by: 3, bt: 13, mouth: 'shout' },
  grin:      { eyes: 'open', lid: 0.3, by: 2, bt: 10, mouth: 'grin' },
  whistle:   { eyes: 'closed', by: 2, bt: 10, mouth: 'o' },
  love:      { eyes: 'heart', by: -3, bt: -3, mouth: 'grin' },
};

function makeCanvas(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

export class FacePainter {
  /**
   * style: { kind:'human'|'screen', skin, iris, iris2, brow, line, lashes, blush, freckles, eyeBlack, bandaid,
   *          eyeScale, eyeSpacing, eyeY, browThick, mouthY, nose, glyph (screen color), screenBg }
   */
  constructor(style, size = 256) {
    this.style = style;
    const screen = style.kind === 'screen';
    this.canvas = makeCanvas(size, screen ? Math.round(size * 0.75) : size);
    this.g = this.canvas.getContext('2d');
    this.texture = new THREE.CanvasTexture(this.canvas);
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.texture.anisotropy = 4;
    this.key = '';
    this.set('neutral', 0, 0, false);
  }
  /** returns true when the texture was redrawn */
  set(expr, lookX = 0, lookY = 0, blink = false) {
    const e = EXPR[expr] ? expr : 'neutral';
    const qx = Math.round(Math.max(-1, Math.min(1, lookX)) * 4) / 4;
    const qy = Math.round(Math.max(-1, Math.min(1, lookY)) * 3) / 3;
    const key = `${e}|${qx}|${qy}|${blink ? 1 : 0}`;
    if (key === this.key) return false;
    this.key = key;
    if (this.style.kind === 'screen') drawScreen(this.g, this.canvas, this.style, EXPR[e], e, qx, qy, blink);
    else drawHuman(this.g, this.canvas, this.style, EXPR[e], qx, qy, blink);
    this.texture.needsUpdate = true;
    return true;
  }
  dispose() { this.texture.dispose(); }
}

// ------------------------------------------------------------------ human faces
function shade(hex, k) {
  const c = new THREE.Color(hex);
  const hsl = {}; c.getHSL(hsl);
  c.setHSL(hsl.h, Math.min(1, hsl.s * (k < 1 ? 1.08 : 0.95)), Math.max(0, Math.min(1, hsl.l * k)));
  return '#' + c.getHexString();
}

function drawHuman(g, cv, st, ex, lx, ly, blink) {
  const W = cv.width, H = cv.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = st.skin;
  g.fillRect(0, 0, W, H);
  // degree space: x in [-62, 62] (0 = face center), y = theta in [55, 135]
  const sx = W / PHI_SPAN, sy = H / TH_SPAN;
  g.setTransform(sx, 0, 0, sy, W / 2, -TH0 * sy);
  g.lineCap = 'round'; g.lineJoin = 'round';

  const es = st.eyeScale || 1;
  const spacing = st.eyeSpacing || 24;
  const eyeY = st.eyeY || 97;
  const mouthY = st.mouthY || 117;
  const line = st.line || '#2a1a22';
  if (ly === 0 && ex.lookY) ly = ex.lookY;

  // blush / freckles / face paint first (under the eyes)
  if (st.blush) {
    for (const s of [-1, 1]) {
      const cx = s * (spacing + 10), cy = eyeY + 12;
      g.save(); g.translate(cx, cy); g.scale(1, 0.55);
      const grd = g.createRadialGradient(0, 0, 0, 0, 0, 7.5);
      grd.addColorStop(0, st.blush); grd.addColorStop(1, 'rgba(255,120,140,0)');
      g.fillStyle = grd; g.globalAlpha = 0.55;
      g.beginPath(); g.arc(0, 0, 7.5, 0, Math.PI * 2); g.fill();
      g.restore(); g.globalAlpha = 1;
    }
  }
  if (st.freckles) {
    g.fillStyle = shade(st.skin, 0.72);
    for (const s of [-1, 1]) for (const [dx, dy] of [[-3, 0], [0, 2.2], [3, 0.4], [1.5, -2], [-1.6, 3.6]]) {
      g.beginPath(); g.ellipse(s * (spacing + 9) + dx * s, eyeY + 11 + dy, 0.75, 0.9, 0, 0, Math.PI * 2); g.fill();
    }
  }
  if (st.eyeBlack) {
    g.fillStyle = st.eyeBlack;
    for (const s of [-1, 1]) roundRect(g, s * spacing - 6, eyeY + 12.5, 12, 3.2, 1.4), g.fill();
  }
  if (st.bandaid) {
    g.save(); g.translate(spacing + 12, eyeY + 10); g.rotate(-0.5);
    g.fillStyle = '#f2c48f'; roundRect(g, -6, -2.2, 12, 4.4, 2); g.fill();
    g.fillStyle = '#e0a86e'; roundRect(g, -2, -2.2, 4, 4.4, 0.6); g.fill();
    g.restore();
  }

  // nose
  if (st.nose !== 'none') {
    g.fillStyle = shade(st.skin, 0.84);
    g.beginPath(); g.ellipse(0, eyeY + 9.5, 2.1 * (st.noseScale || 1), 1.4 * (st.noseScale || 1), 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = 'rgba(255,255,255,0.35)';
    g.beginPath(); g.ellipse(-0.6, eyeY + 8.9, 0.8, 0.5, 0, 0, Math.PI * 2); g.fill();
  }

  // eyes
  const kindL = ex.eyes === 'wink' ? 'open' : ex.eyes;
  const kindR = ex.eyes === 'wink' ? 'happy' : ex.eyes;
  for (const s of [-1, 1]) {
    let kind = s < 0 ? kindL : kindR;
    if (blink && kind !== 'happy' && kind !== 'x' && kind !== 'spiral' && kind !== 'heart') kind = 'closed';
    drawEye(g, st, kind, s * spacing, eyeY, es, ex.lid || 0, lx, ly, s, line, ex.sparkle);
  }

  // brows
  if (st.brow) {
    g.strokeStyle = st.brow;
    g.lineWidth = (st.browThick || 3.2);
    const by = eyeY - 17 * es + (ex.by || 0);
    const bt = ex.bt || 0;
    for (const s of [-1, 1]) {
      const cx = s * spacing;
      const inner = cx - s * 6.5, outer = cx + s * 6.5;
      const yi = by + bt * 0.5, yo = by - bt * 0.5 - 0.5;
      g.beginPath();
      g.moveTo(outer, yo);
      g.quadraticCurveTo(cx, by - 2.6 + bt * 0.05, inner, yi);
      g.stroke();
    }
  }

  // mouth
  drawMouth(g, st, ex.mouth, 0, mouthY, line);

  if (ex.sweat) {
    g.fillStyle = '#9fe3ff'; g.strokeStyle = '#3a8fc0'; g.lineWidth = 0.8;
    g.beginPath(); g.moveTo(44, 78); g.quadraticCurveTo(49, 86, 45, 89); g.quadraticCurveTo(40, 87, 44, 78); g.fill(); g.stroke();
  }
  g.setTransform(1, 0, 0, 1, 0, 0);
}

function roundRect(g, x, y, w, h, r) {
  g.beginPath();
  g.moveTo(x + r, y); g.lineTo(x + w - r, y); g.quadraticCurveTo(x + w, y, x + w, y + r);
  g.lineTo(x + w, y + h - r); g.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  g.lineTo(x + r, y + h); g.quadraticCurveTo(x, y + h, x, y + h - r);
  g.lineTo(x, y + r); g.quadraticCurveTo(x, y, x + r, y);
  g.closePath();
}

function drawEye(g, st, kind, cx, cy, es, lid, lx, ly, side, line, sparkle) {
  const rx = 8.2 * es, ry = 10.8 * es;
  g.lineCap = 'round';
  if (kind === 'closed') {
    g.strokeStyle = line; g.lineWidth = 2.3;
    g.beginPath(); g.moveTo(cx - rx, cy + 1); g.quadraticCurveTo(cx, cy + 6.5, cx + rx, cy + 1); g.stroke();
    if (st.lashes) { g.beginPath(); g.moveTo(cx + side * rx, cy + 1); g.lineTo(cx + side * (rx + 2.6), cy - 1.2); g.stroke(); }
    return;
  }
  if (kind === 'happy') {
    g.strokeStyle = line; g.lineWidth = 2.6;
    g.beginPath(); g.moveTo(cx - rx, cy + 3); g.quadraticCurveTo(cx, cy - 9, cx + rx, cy + 3); g.stroke();
    if (st.lashes) { g.beginPath(); g.moveTo(cx + side * (rx - 0.6), cy + 2); g.lineTo(cx + side * (rx + 2.4), cy + 0.2); g.stroke(); }
    return;
  }
  if (kind === 'x') {
    g.strokeStyle = line; g.lineWidth = 2.4;
    g.beginPath(); g.moveTo(cx - 5.5, cy - 6); g.lineTo(cx + 5.5, cy + 6); g.moveTo(cx + 5.5, cy - 6); g.lineTo(cx - 5.5, cy + 6); g.stroke();
    return;
  }
  if (kind === 'spiral') {
    g.strokeStyle = line; g.lineWidth = 1.6;
    g.beginPath();
    for (let a = 0; a < Math.PI * 5; a += 0.2) {
      const r = 0.6 + a * 0.5;
      const x = cx + Math.cos(a * side) * r * 0.85, y = cy + Math.sin(a * side) * r;
      if (a === 0) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    return;
  }
  if (kind === 'heart') {
    g.fillStyle = '#ff3d7f';
    const s = 0.62;
    g.beginPath();
    g.moveTo(cx, cy + 9 * s);
    g.bezierCurveTo(cx - 13 * s, cy, cx - 9 * s, cy - 11 * s, cx, cy - 4 * s);
    g.bezierCurveTo(cx + 9 * s, cy - 11 * s, cx + 13 * s, cy, cx, cy + 9 * s);
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.beginPath(); g.ellipse(cx - 3.2, cy - 2.6, 1.6, 1.1, -0.5, 0, Math.PI * 2); g.fill();
    return;
  }
  const wide = kind === 'wide';
  const erx = wide ? rx * 1.08 : rx, ery = wide ? ry * 1.08 : ry;
  // sclera
  g.save();
  g.beginPath(); g.ellipse(cx, cy, erx, ery, 0, 0, Math.PI * 2);
  g.fillStyle = '#ffffff'; g.fill();
  g.clip();
  // iris
  const irx = (wide ? 4.9 : 6.7) * es, iry = (wide ? 6.4 : 9.2) * es;
  const ix = cx + lx * 2.6 * es, iy = cy + 1.2 + ly * 2.4 * es;
  const grd = g.createLinearGradient(0, iy - iry, 0, iy + iry);
  grd.addColorStop(0, st.iris2 || shade(st.iris, 0.55)); grd.addColorStop(1, st.iris);
  g.fillStyle = grd;
  g.beginPath(); g.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2); g.fill();
  g.fillStyle = '#140a18';
  g.beginPath(); g.ellipse(ix, iy + 0.4, irx * 0.52, iry * 0.56, 0, 0, Math.PI * 2); g.fill();
  // highlights
  g.fillStyle = '#ffffff';
  g.beginPath(); g.ellipse(ix - irx * 0.36, iy - iry * 0.4, 2.5 * es, 2.9 * es, 0, 0, Math.PI * 2); g.fill();
  g.beginPath(); g.ellipse(ix + irx * 0.42, iy + iry * 0.38, 1.2 * es, 1.3 * es, 0, 0, Math.PI * 2); g.fill();
  if (sparkle) { g.beginPath(); g.ellipse(ix + irx * 0.3, iy - iry * 0.55, 1.1, 1.1, 0, 0, Math.PI * 2); g.fill(); }
  // eyelid (skin) coming down
  const lidY = cy - ery + Math.max(0, lid) * ery * 1.7;
  if (lid > 0.02) {
    g.fillStyle = st.skin;
    g.fillRect(cx - erx - 2, cy - ery - 2, erx * 2 + 4, lidY - (cy - ery) + 2);
  }
  g.restore();
  // upper lid line
  g.strokeStyle = line; g.lineWidth = 2.4;
  g.beginPath();
  if (lid > 0.02) {
    const w = Math.sqrt(Math.max(0, 1 - Math.pow((lidY - cy) / ery, 2))) * erx;
    g.moveTo(cx - w - 0.6, lidY + 0.3); g.quadraticCurveTo(cx, lidY - 1.2, cx + w + 0.6, lidY + 0.3);
  } else {
    g.ellipse(cx, cy, erx, ery, 0, Math.PI * 1.08, Math.PI * 1.92);
  }
  g.stroke();
  // lashes flick
  if (st.lashes) {
    g.lineWidth = 1.9;
    const ly0 = lid > 0.02 ? lidY + 0.2 : cy - ery * 0.45;
    g.beginPath(); g.moveTo(cx + side * (erx - 0.8), ly0); g.lineTo(cx + side * (erx + 2.8), ly0 - 2.6); g.stroke();
    g.beginPath(); g.moveTo(cx + side * (erx - 2.4), ly0 - 1.8); g.lineTo(cx + side * (erx + 0.6), ly0 - 5); g.stroke();
  }
  // subtle lower lid
  g.strokeStyle = 'rgba(60,30,40,0.35)'; g.lineWidth = 1;
  g.beginPath(); g.ellipse(cx, cy, erx * 0.8, ery, 0, Math.PI * 0.3, Math.PI * 0.7); g.stroke();
}

function drawMouth(g, st, kind, cx, cy, line) {
  const dark = st.mouthDark || '#6b1b2a';
  const tongue = '#ff7a8a';
  g.strokeStyle = line; g.lineWidth = 2.1; g.lineCap = 'round';
  switch (kind) {
    case 'smile':
      g.beginPath(); g.moveTo(cx - 5.5, cy - 1.5); g.quadraticCurveTo(cx, cy + 4.5, cx + 5.5, cy - 1.5); g.stroke();
      break;
    case 'smirk':
      g.beginPath(); g.moveTo(cx - 5, cy); g.quadraticCurveTo(cx + 1, cy + 3.8, cx + 6.5, cy - 2.6); g.stroke();
      break;
    case 'flat':
      g.beginPath(); g.moveTo(cx - 4.5, cy + 0.5); g.lineTo(cx + 4.5, cy + 0.5); g.stroke();
      break;
    case 'frown':
      g.beginPath(); g.moveTo(cx - 5, cy + 3); g.quadraticCurveTo(cx, cy - 2.5, cx + 5, cy + 3); g.stroke();
      break;
    case 'wavy':
      g.lineWidth = 1.9;
      g.beginPath(); g.moveTo(cx - 7, cy + 1);
      g.quadraticCurveTo(cx - 5.2, cy - 2.2, cx - 3.5, cy + 0.5);
      g.quadraticCurveTo(cx - 1.7, cy + 3, cx, cy + 0.5);
      g.quadraticCurveTo(cx + 1.7, cy - 2.2, cx + 3.5, cy + 0.5);
      g.quadraticCurveTo(cx + 5.2, cy + 3, cx + 7, cy + 0.5);
      g.stroke();
      break;
    case 'o': case 'shout': case 'yawn': {
      const rx = kind === 'o' ? 3.3 : kind === 'yawn' ? 4.6 : 5.2, ry = kind === 'o' ? 4.2 : kind === 'yawn' ? 6.2 : 6;
      g.fillStyle = dark; g.beginPath(); g.ellipse(cx, cy + 1, rx, ry, 0, 0, Math.PI * 2); g.fill();
      g.save(); g.clip();
      g.fillStyle = tongue; g.beginPath(); g.ellipse(cx, cy + 1 + ry * 0.85, rx * 0.8, ry * 0.5, 0, 0, Math.PI * 2); g.fill();
      g.restore();
      g.lineWidth = 1.5; g.beginPath(); g.ellipse(cx, cy + 1, rx, ry, 0, 0, Math.PI * 2); g.stroke();
      break;
    }
    case 'grin': case 'laugh': case 'tongue': case 'roar': {
      const w = kind === 'laugh' ? 9 : kind === 'roar' ? 8.5 : kind === 'tongue' ? 6.5 : 7.8;
      const d = kind === 'laugh' ? 11 : kind === 'roar' ? 11 : kind === 'tongue' ? 6 : 8.5;
      const top = cy - 2.2;
      g.beginPath();
      g.moveTo(cx - w, top);
      g.quadraticCurveTo(cx, top + 1.6, cx + w, top);
      g.quadraticCurveTo(cx + w * 0.9, top + d, cx, top + d);
      g.quadraticCurveTo(cx - w * 0.9, top + d, cx - w, top);
      g.closePath();
      g.fillStyle = dark; g.fill();
      g.save(); g.clip();
      if (kind !== 'roar') { g.fillStyle = '#ffffff'; g.fillRect(cx - w, top - 1, w * 2, 2.9); }
      g.fillStyle = tongue; g.beginPath(); g.ellipse(cx + (kind === 'tongue' ? 1.5 : 0), top + d + 1, w * 0.62, d * 0.45, 0, 0, Math.PI * 2); g.fill();
      g.restore();
      if (kind === 'roar') {
        g.fillStyle = '#ffffff';
        for (const s of [-1, 1]) { g.beginPath(); g.moveTo(cx + s * (w - 3.4), top + 0.6); g.lineTo(cx + s * (w - 1.2), top + 0.4); g.lineTo(cx + s * (w - 2.3), top + 4.4); g.closePath(); g.fill(); }
      }
      g.lineWidth = 1.6; g.strokeStyle = line;
      g.beginPath();
      g.moveTo(cx - w, top); g.quadraticCurveTo(cx, top + 1.6, cx + w, top);
      g.quadraticCurveTo(cx + w * 0.9, top + d, cx, top + d);
      g.quadraticCurveTo(cx - w * 0.9, top + d, cx - w, top);
      g.stroke();
      if (kind === 'tongue') {
        g.fillStyle = tongue; g.beginPath(); g.ellipse(cx + 2.2, top + d + 0.8, 3.2, 3.6, 0, 0, Math.PI * 2); g.fill();
        g.lineWidth = 1.2; g.stroke();
        g.strokeStyle = '#d94f64'; g.beginPath(); g.moveTo(cx + 2.2, top + d - 0.5); g.lineTo(cx + 2.2, top + d + 2.6); g.stroke();
      }
      break;
    }
    case 'teeth': {
      g.fillStyle = '#ffffff';
      roundRect(g, cx - 6.5, cy - 2.6, 13, 6, 2.2); g.fill();
      g.lineWidth = 1.5; g.stroke();
      g.lineWidth = 0.8; g.beginPath(); g.moveTo(cx - 6, cy + 0.4); g.lineTo(cx + 6, cy + 0.4);
      for (const x of [-3, 0, 3]) { g.moveTo(cx + x, cy - 2.4); g.lineTo(cx + x, cy + 3.2); }
      g.stroke();
      break;
    }
    default:
      g.beginPath(); g.moveTo(cx - 5, cy); g.quadraticCurveTo(cx, cy + 4, cx + 5, cy); g.stroke();
  }
}

// ------------------------------------------------------------------ robot screen faces
function drawScreen(g, cv, st, ex, name, lx, ly, blink) {
  const W = cv.width, H = cv.height;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = st.screenBg || '#07122a';
  g.fillRect(0, 0, W, H);
  // scanlines + vignette
  g.fillStyle = 'rgba(255,255,255,0.035)';
  for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1.5);
  const vg = g.createRadialGradient(W / 2, H / 2, H * 0.2, W / 2, H / 2, H * 0.85);
  vg.addColorStop(0, 'rgba(0,0,0,0)'); vg.addColorStop(1, 'rgba(0,0,0,0.55)');
  g.fillStyle = vg; g.fillRect(0, 0, W, H);

  const col = st.glyph || '#5ff4ff';
  g.save();
  g.shadowColor = col; g.shadowBlur = W * 0.05;
  g.fillStyle = col; g.strokeStyle = col; g.lineCap = 'round'; g.lineJoin = 'round';
  const s = W / 256;
  g.scale(s, s);
  const ox = lx * 10, oy = ly * 8;
  const eyes = blink && !['happy', 'x', 'spiral', 'heart'].includes(ex.eyes) ? 'closed' : ex.eyes;
  const EX = [84 + ox, 172 + ox], EY = 82 + oy;
  const eye = (i, kind) => {
    const x = EX[i], y = EY;
    g.lineWidth = 12;
    switch (kind) {
      case 'closed': g.beginPath(); g.moveTo(x - 18, y + 6); g.lineTo(x + 18, y + 6); g.stroke(); break;
      case 'happy': g.beginPath(); g.moveTo(x - 20, y + 12); g.lineTo(x, y - 10); g.lineTo(x + 20, y + 12); g.stroke(); break;
      case 'wide': g.lineWidth = 9; g.beginPath(); g.arc(x, y, 22, 0, Math.PI * 2); g.stroke(); g.beginPath(); g.arc(x, y, 7, 0, Math.PI * 2); g.fill(); break;
      case 'x': g.beginPath(); g.moveTo(x - 16, y - 16); g.lineTo(x + 16, y + 16); g.moveTo(x + 16, y - 16); g.lineTo(x - 16, y + 16); g.stroke(); break;
      case 'spiral': {
        g.lineWidth = 6; g.beginPath();
        for (let a = 0; a < Math.PI * 5; a += 0.15) { const r = 2 + a * 1.35; const px = x + Math.cos(a) * r, py = y + Math.sin(a) * r; if (a === 0) g.moveTo(px, py); else g.lineTo(px, py); }
        g.stroke(); break;
      }
      case 'heart':
        g.beginPath(); g.moveTo(x, y + 22);
        g.bezierCurveTo(x - 34, y, x - 22, y - 28, x, y - 10);
        g.bezierCurveTo(x + 22, y - 28, x + 34, y, x, y + 22); g.fill(); break;
      default: {
        // tall rounded pill eyes; lid cuts the top (determined look slants inward)
        const lid = ex.lid || 0;
        const h = 44 * (1 - lid * 0.55);
        g.save();
        roundRect(g, x - 13, y - 22 + (44 - h), 26, h, 13);
        g.fill();
        if ((ex.bt || 0) > 5) { // angry slant: erase a triangle at the inner top corner
          g.globalCompositeOperation = 'destination-out';
          const inner = i === 0 ? 1 : -1;
          g.beginPath(); g.moveTo(x - 16 * inner, y - 30); g.lineTo(x + 18 * inner, y - 30); g.lineTo(x + 18 * inner, y - 6); g.closePath(); g.fill();
        }
        g.restore();
        g.globalCompositeOperation = 'source-over';
      }
    }
  };
  const eL = eyes === 'wink' ? 'open' : eyes, eR = eyes === 'wink' ? 'happy' : eyes;
  eye(0, eL); eye(1, eR);
  // mouth
  const mx = 128 + ox * 0.5, my = 142 + oy * 0.5;
  g.lineWidth = 8;
  switch (ex.mouth) {
    case 'grin': case 'laugh': case 'tongue':
      g.beginPath(); g.moveTo(mx - 26, my - 6); g.quadraticCurveTo(mx, my + 26, mx + 26, my - 6); g.closePath(); g.fill(); break;
    case 'o': case 'shout': case 'yawn': g.lineWidth = 7; g.beginPath(); g.arc(mx, my, 11, 0, Math.PI * 2); g.stroke(); break;
    case 'frown': g.beginPath(); g.moveTo(mx - 20, my + 8); g.quadraticCurveTo(mx, my - 12, mx + 20, my + 8); g.stroke(); break;
    case 'wavy':
      g.lineWidth = 6; g.beginPath(); g.moveTo(mx - 26, my);
      for (let i = 1; i <= 6; i++) g.lineTo(mx - 26 + i * 52 / 6, my + (i % 2 ? -7 : 7));
      g.stroke(); break;
    case 'teeth': case 'flat': g.beginPath(); g.moveTo(mx - 20, my); g.lineTo(mx + 20, my); g.stroke(); break;
    case 'roar': g.beginPath(); g.moveTo(mx - 26, my - 8); g.lineTo(mx + 26, my - 8); g.lineTo(mx, my + 18); g.closePath(); g.fill(); break;
    default: g.beginPath(); g.moveTo(mx - 20, my - 4); g.quadraticCurveTo(mx, my + 14, mx + 20, my - 4); g.stroke();
  }
  if (ex.sweat || name === 'sad') { g.beginPath(); g.moveTo(206, 108); g.quadraticCurveTo(214, 124, 206, 128); g.quadraticCurveTo(198, 124, 206, 108); g.fill(); }
  g.restore();
  // glass glare
  const gl = g.createLinearGradient(0, 0, W, H);
  gl.addColorStop(0, 'rgba(255,255,255,0.16)'); gl.addColorStop(0.35, 'rgba(255,255,255,0.03)'); gl.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gl; g.fillRect(0, 0, W, H);
}
