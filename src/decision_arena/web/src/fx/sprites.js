// FX sprite atlas (AUDIOFX): 256x256 canvas, 4x4 cells of 64 px, drawn white/grey so vertex colours tint them.
import * as THREE from 'three';

export const SPR = {
  GLOW: 0, SPARKLE: 1, STAR: 2, SMOKE: 3,
  SPARK: 4, RING: 5, CONFETTI: 6, FLAME: 7,
  DISC: 8, LINE: 9, SHOCK: 10, PLUS: 11,
  SHARD: 12, PUFF: 13, COIN: 14, CHUNK: 15,
};

const CELL = 64;

function radial(g, cx, cy, r, stops) {
  const gr = g.createRadialGradient(cx, cy, 0, cx, cy, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.beginPath();
  g.arc(cx, cy, r, 0, Math.PI * 2);
  g.fill();
}

function starPath(g, cx, cy, n, r0, r1, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const r = i % 2 ? r1 : r0;
    const a = rot + (i * Math.PI) / n;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}

const DRAW = [
  // 0 GLOW: soft radial falloff
  (g) => radial(g, 32, 32, 30, [[0, 'rgba(255,255,255,1)'], [0.25, 'rgba(255,255,255,0.75)'], [0.55, 'rgba(255,255,255,0.25)'], [1, 'rgba(255,255,255,0)']]),
  // 1 SPARKLE: 4-point star with glow core
  (g) => {
    radial(g, 32, 32, 18, [[0, 'rgba(255,255,255,0.9)'], [1, 'rgba(255,255,255,0)']]);
    g.fillStyle = '#fff';
    starPath(g, 32, 32, 4, 29, 4.2, -Math.PI / 2);
    g.fill();
  },
  // 2 STAR: chunky cartoon 5-point star, white with a grey rim (tints to a darker outline)
  (g) => {
    g.lineJoin = 'round';
    starPath(g, 32, 34, 5, 27, 12.5);
    g.fillStyle = '#b8b8b8';
    g.fill();
    g.lineWidth = 5; g.strokeStyle = '#9a9a9a'; g.stroke();
    starPath(g, 32, 34, 5, 21, 9.8);
    g.fillStyle = '#fff';
    g.fill();
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath(); g.ellipse(26, 27, 4, 2.5, -0.6, 0, Math.PI * 2); g.fill();
  },
  // 3 SMOKE: puffy cloud of soft blobs
  (g) => {
    const blobs = [[32, 34, 20], [22, 30, 14], [42, 29, 15], [30, 22, 13], [40, 40, 12], [22, 41, 11]];
    for (const [x, y, r] of blobs) radial(g, x, y, r, [[0, 'rgba(255,255,255,0.8)'], [0.6, 'rgba(255,255,255,0.45)'], [1, 'rgba(255,255,255,0)']]);
  },
  // 4 SPARK: vertical soft streak (used stretched along velocity)
  (g) => {
    const gr = g.createLinearGradient(0, 4, 0, 60);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.35, 'rgba(255,255,255,1)'); gr.addColorStop(0.7, 'rgba(255,255,255,0.9)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.ellipse(32, 32, 9, 28, 0, 0, Math.PI * 2); g.fill();
    radial(g, 32, 30, 8, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
  },
  // 5 RING: thin soft ring
  (g) => {
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = 7; g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.stroke();
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.beginPath(); g.arc(32, 32, 25, 0, Math.PI * 2); g.stroke();
  },
  // 6 CONFETTI: rounded paper strip with a fold shade
  (g) => {
    g.fillStyle = '#fff';
    g.beginPath(); g.roundRect ? g.roundRect(18, 10, 28, 44, 4) : g.rect(18, 10, 28, 44); g.fill();
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(18, 34, 28, 20);
  },
  // 7 FLAME: teardrop (tip up) with a hot core
  (g) => {
    g.beginPath();
    g.moveTo(32, 3);
    g.bezierCurveTo(44, 22, 52, 34, 50, 44);
    g.bezierCurveTo(47, 58, 17, 58, 14, 44);
    g.bezierCurveTo(12, 34, 20, 22, 32, 3);
    const gr = g.createRadialGradient(32, 44, 2, 32, 38, 30);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.7)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fill();
  },
  // 8 DISC: small solid dot with soft edge
  (g) => radial(g, 32, 32, 24, [[0, 'rgba(255,255,255,1)'], [0.75, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]),
  // 9 LINE: long thin line with faded ends (speed lines)
  (g) => {
    const gr = g.createLinearGradient(0, 2, 0, 62);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.5, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.fillRect(29, 2, 6, 60);
  },
  // 10 SHOCK: thick shockwave ring with inner gradient
  (g) => {
    const gr = g.createRadialGradient(32, 32, 14, 32, 32, 30);
    gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(0.62, 'rgba(255,255,255,0.35)'); gr.addColorStop(0.85, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr;
    g.beginPath(); g.arc(32, 32, 30, 0, Math.PI * 2); g.fill();
  },
  // 11 PLUS: thin cross twinkle
  (g) => {
    radial(g, 32, 32, 10, [[0, 'rgba(255,255,255,1)'], [1, 'rgba(255,255,255,0)']]);
    for (const [w, h] of [[4, 56], [56, 4]]) {
      const gr = g.createRadialGradient(32, 32, 0, 32, 32, 28);
      gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr;
      g.fillRect(32 - w / 2, 32 - h / 2, w, h);
    }
  },
  // 12 SHARD: glassy triangle
  (g) => {
    g.beginPath(); g.moveTo(32, 6); g.lineTo(54, 52); g.lineTo(12, 44); g.closePath();
    g.fillStyle = 'rgba(255,255,255,0.85)'; g.fill();
    g.strokeStyle = '#fff'; g.lineWidth = 3; g.stroke();
    g.fillStyle = 'rgba(255,255,255,1)'; g.beginPath(); g.moveTo(32, 10); g.lineTo(40, 30); g.lineTo(28, 28); g.closePath(); g.fill();
  },
  // 13 PUFF: rounder dust puff with a lit top
  (g) => {
    radial(g, 32, 34, 27, [[0, 'rgba(235,235,235,0.9)'], [0.7, 'rgba(220,220,220,0.55)'], [1, 'rgba(210,210,210,0)']]);
    radial(g, 28, 26, 14, [[0, 'rgba(255,255,255,0.7)'], [1, 'rgba(255,255,255,0)']]);
  },
  // 14 COIN: tiny coin (rim + face), tints gold
  (g) => {
    g.fillStyle = '#b0b0b0'; g.beginPath(); g.arc(32, 32, 24, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#fff'; g.beginPath(); g.arc(32, 32, 18, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#d0d0d0'; g.fillRect(29, 20, 6, 24);
  },
  // 15 CHUNK: rough debris chunk
  (g) => {
    g.beginPath(); g.moveTo(14, 22); g.lineTo(34, 10); g.lineTo(52, 24); g.lineTo(48, 48); g.lineTo(24, 54); g.lineTo(10, 40); g.closePath();
    g.fillStyle = '#d8d8d8'; g.fill();
    g.fillStyle = '#ffffff'; g.beginPath(); g.moveTo(14, 22); g.lineTo(34, 10); g.lineTo(52, 24); g.lineTo(32, 30); g.closePath(); g.fill();
    g.fillStyle = '#9a9a9a'; g.beginPath(); g.moveTo(24, 54); g.lineTo(48, 48); g.lineTo(40, 38); g.closePath(); g.fill();
  },
];

export function makeAtlas() {
  const c = document.createElement('canvas');
  c.width = c.height = CELL * 4;
  const g = c.getContext('2d');
  DRAW.forEach((fn, i) => {
    g.save();
    g.translate((i % 4) * CELL, Math.floor(i / 4) * CELL);
    g.beginPath(); g.rect(0, 0, CELL, CELL); g.clip();
    fn(g);
    g.restore();
  });
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.generateMipmaps = true;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.magFilter = THREE.LinearFilter;
  tex.needsUpdate = true;
  return tex;
}
