// Train body cross-section + side layout, shared by the texture painter (art.js) and the geometry (models.js)
// so doors, windows and stripes painted on the atlas land exactly where the 3D shell expects them.
import { TRAIN } from '../config.js';

export const CAR_LEN = TRAIN.carLength;       // 12.5
export const HALF_W = TRAIN.width / 2;        // 1.15
export const BODY_BOTTOM = 0.64;              // underside of the shell (bogies below)
export const CORNER_R = 0.15;                 // bottom corner radius
export const SIDE_TOP = 2.5;                  // vertical side ends, roof curve begins
export const ROOF_EDGE_X = 0.72;              // where the roof curve meets the (almost flat) roof
export const ROOF_EDGE_Y = 3.03;
export const ROOF_Y = TRAIN.height;           // 3.1 at the center (walkable)
export const NOSE_LEN = 0.42;                 // cab nose taper length (inside the car length)

/**
 * Right half of the body profile, from the bottom center to the roof center.
 * Each point: {x, y, zone} with zone 'under' | 'side' | 'roof'. Zone boundaries are duplicated so UV seams are clean.
 */
export function bodyProfile() {
  const P = [];
  const push = (x, y, zone) => P.push({ x, y, zone });
  // underside
  push(0, BODY_BOTTOM, 'under');
  push(HALF_W - CORNER_R, BODY_BOTTOM, 'under');
  // bottom corner (side zone starts here)
  const cx = HALF_W - CORNER_R, cy = BODY_BOTTOM + CORNER_R;
  for (let i = 0; i <= 5; i++) {
    const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2);
    push(cx + Math.cos(a) * CORNER_R, cy + Math.sin(a) * CORNER_R, 'side');
  }
  // vertical side (a couple of extra points keep lighting smooth)
  push(HALF_W, 1.4, 'side');
  push(HALF_W, 2.1, 'side');
  // upper curve: quarter ellipse from (HALF_W, SIDE_TOP) to (ROOF_EDGE_X, ROOF_EDGE_Y)
  const ex = ROOF_EDGE_X, ey = SIDE_TOP, rx = HALF_W - ROOF_EDGE_X, ry = ROOF_EDGE_Y - SIDE_TOP;
  for (let i = 0; i <= 8; i++) {
    const a = (i / 8) * (Math.PI / 2);
    push(ex + Math.cos(a) * rx, ey + Math.sin(a) * ry, 'side');
  }
  // roof (roof zone), gentle crown up to ROOF_Y at x = 0
  for (let i = 0; i <= 4; i++) {
    const x = ROOF_EDGE_X * (1 - i / 4);
    push(x, ROOF_Y - (ROOF_Y - ROOF_EDGE_Y) * (x / ROOF_EDGE_X) ** 2, 'roof');
  }
  return P;
}

/** Arc-length parametrisation of the 'side' zone: s(y) for points on the vertical side, and the total. */
export function sideArc() {
  const P = bodyProfile().filter((p) => p.zone === 'side');
  let s = 0;
  const pts = [{ ...P[0], s: 0 }];
  for (let i = 1; i < P.length; i++) {
    s += Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y);
    pts.push({ ...P[i], s });
  }
  const total = s;
  const sCorner = pts[5].s;                 // end of the bottom corner = start of the vertical side (y = BODY_BOTTOM + CORNER_R)
  const yVert0 = BODY_BOTTOM + CORNER_R;
  const sOfY = (y) => sCorner + (y - yVert0);  // valid for y in [yVert0, SIDE_TOP]
  return { pts, total, sOfY, sSideTop: sOfY(SIDE_TOP) };
}

// Side layout in car-local meters (z from 0 at one end to CAR_LEN; symmetric around the middle)
export const SIDE = {
  skirtTop: 0.98,           // lower skirt band
  stripeY0: 1.46, stripeY1: 1.54,
  winY0: 1.6, winY1: 2.3,   // window band
  doors: [[2.45, 3.95], [8.55, 10.05]],
  doorTop: 2.36,
  windows: [[0.7, 2.05], [4.35, 6.1], [6.4, 8.15], [10.45, 11.8]],
};

// Cab front layout (x in [-HALF_W, HALF_W], y in [BODY_BOTTOM, ROOF_Y])
export const CAB = {
  winX: 0.9, winY0: 1.8, winY1: 2.7, winR: 0.2,
  plateY0: 2.76, plateY1: 2.96, plateX: 0.46,
  lampX: 0.7, lampY: 1.16, lampR: 0.17,
  tailX: 0.97, tailR: 0.075,
  bandY0: 1.42, bandY1: 1.6,
  skirtY1: 0.94,
};
