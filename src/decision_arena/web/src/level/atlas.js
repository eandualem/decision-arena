// Tiny texture-atlas helper: shelf packing of named regions + UV remapping for geometries.
// Regions are defined in "design pixels"; the backing canvas may be drawn at a lower scale (quality),
// UVs are normalized so they do not care.

export class Atlas {
  constructor(W, H, pad = 10) {
    this.W = W; this.H = H; this.pad = pad;
    this.cx = pad; this.cy = pad; this.rowH = 0;
    this.r = Object.create(null);
  }
  add(name, w, h) {
    const p = this.pad;
    if (this.cx + w + p > this.W) { this.cx = p; this.cy += this.rowH + p; this.rowH = 0; }
    if (this.cy + h + p > this.H) throw new Error(`atlas overflow placing ${name}`);
    const reg = { name, x: this.cx, y: this.cy, w, h };
    this.r[name] = reg;
    this.cx += w + p;
    this.rowH = Math.max(this.rowH, h);
    return reg;
  }
  get(name) { const r = this.r[name]; if (!r) throw new Error('no atlas region ' + name); return r; }
  /** GL uv rect for a region (canvas textures are flipped: v = 1 at the top row). inset in design px. */
  uv(name, inset = 1.5) {
    const r = this.get(name);
    return {
      u0: (r.x + inset) / this.W, u1: (r.x + r.w - inset) / this.W,
      v0: 1 - (r.y + r.h - inset) / this.H, v1: 1 - (r.y + inset) / this.H,
    };
  }
  /** uv of the center of a region (for flat-colored parts) */
  center(name) { const r = this.get(name); return [(r.x + r.w / 2) / this.W, 1 - (r.y + r.h / 2) / this.H]; }
}

/** Remap a geometry's 0..1 uvs into an atlas uv rect (in place). */
export function remapUV(geo, rect) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, rect.u0 + (rect.u1 - rect.u0) * uv.getX(i), rect.v0 + (rect.v1 - rect.v0) * uv.getY(i));
  }
  uv.needsUpdate = true;
  return geo;
}

/** Point every uv of the geometry at one texel (flat color regions). */
export function flatUV(geo, [u, v]) {
  const uv = geo.attributes.uv;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, u, v);
  uv.needsUpdate = true;
  return geo;
}
