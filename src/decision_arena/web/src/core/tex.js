// Procedural canvas texture helpers. All art in Rail Dash is generated at runtime (no image files).
import * as THREE from 'three';

let maxAniso = 4;
export function setMaxAnisotropy(n) { maxAniso = Math.max(1, n | 0); }

export function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

/**
 * Create a CanvasTexture by drawing into a fresh 2D canvas.
 * @param {number} w @param {number} h
 * @param {(g: CanvasRenderingContext2D, w: number, h: number) => void} draw
 * @param {{repeat?: [number, number], wrap?: boolean, srgb?: boolean, anisotropy?: number, mipmaps?: boolean, nearest?: boolean}} [o]
 */
export function canvasTexture(w, h, draw, o = {}) {
  const c = makeCanvas(w, h);
  const g = c.getContext('2d');
  draw(g, w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = o.srgb === false ? THREE.NoColorSpace : THREE.SRGBColorSpace;
  t.anisotropy = Math.min(maxAniso, o.anisotropy ?? 8);
  if (o.wrap || o.repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  if (o.repeat) t.repeat.set(o.repeat[0], o.repeat[1]);
  if (o.mipmaps === false) { t.generateMipmaps = false; t.minFilter = THREE.LinearFilter; }
  if (o.nearest) { t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.generateMipmaps = false; }
  t.needsUpdate = true;
  return t;
}

/** Deterministic value-noise fill helper for gritty surfaces. */
export function speckle(g, w, h, count, colors, minR = 0.5, maxR = 2, rand = Math.random) {
  for (let i = 0; i < count; i++) {
    g.fillStyle = colors[(rand() * colors.length) | 0];
    const r = minR + rand() * (maxR - minR);
    g.fillRect(rand() * w, rand() * h, r, r);
  }
}
