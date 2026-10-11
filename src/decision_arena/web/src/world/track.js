// WORLD: the three tracks (ballast beds, sleepers, rails) and the gravel between them.
// The track is uniform, so it is one merged mesh that "treadmills": it snaps to the player's z in steps of
// PERIOD (a multiple of the sleeper spacing and the ballast texture period), which looks perfectly static.
import * as THREE from 'three';
import { GeoBuilder, lin, shade } from './builder.js';
import { LANE_WIDTH, TRACK } from '../config.js';
import { mulberry } from './graffiti.js';

export const PERIOD = TRACK.sleeperSpacing * 4;    // 3.8 m: 4 sleepers, one ballast texture repeat
const SEG = PERIOD / 2;                             // 1.9 m segments (curved world subdivision)
const NEAR = 84, FAR = -272;                        // local z extent (covers player + 80 .. player - 270)

export const BED = { top: -0.05, half: 1.16, foot: 1.3, low: -0.15, shoulder: 5.3 };
export const SLEEPER = { half: 1.06, y0: -0.07, y1: 0.03, depth: 0.25 };
export const RAIL = { y0: 0.03, footY: 0.052, webY: 0.12, top: 0.165, headHalf: 0.038, webHalf: 0.016, footHalf: 0.07 };

export function buildTrack(A, quality) {
  const b = new GeoBuilder(60000, 90000);
  const rBallast = A.R('ballast'), rSlope = A.R('bedSlope'), rGravel = A.R('gravel');
  const rTop = A.R('sleeperTop'), rSide = A.R('sleeperSide'), rWhite = A.R('white');
  const W = lin(0xffffff);
  const nSeg = Math.round((NEAR - FAR) / SEG);
  const R = mulberry(31337);
  const lanes = [-1, 0, 1];

  for (let i = 0; i < nSeg; i++) {
    const z0 = NEAR - i * SEG;             // near edge of the segment
    const v0 = (i % 2) * 0.5, v1 = v0 + 0.5;
    for (const lane of lanes) {
      const cx = lane * LANE_WIDTH;
      // bed top (u across x, v along -z)
      b.quad(cx - BED.half, BED.top, z0, BED.half * 2, 0, 0, 0, 0, -SEG, rBallast, W, W, 0, 1, v0, v1);
      // slopes (outer to inner)
      const dy = BED.top - BED.low, dx = BED.foot - BED.half;
      const cs = shade(W, 0.9);
      b.quad(cx + BED.half, BED.top, z0, dx, -dy, 0, 0, 0, -SEG, rSlope, cs, cs, 0, 1, v0, v1);
      b.quad(cx - BED.foot, BED.low, z0, dx, dy, 0, 0, 0, -SEG, rSlope, cs, cs, 1, 0, v0, v1);
    }
    // outer shoulders (gravel), both sides: from the outer bed foot to the chunk ground
    const xa = LANE_WIDTH + BED.foot, xb = BED.shoulder + 0.05;
    const gv0 = ((i % 4) * 0.25), gv1 = gv0 + 0.25;
    const cg = shade(W, 0.95);
    b.quad(xa, BED.low, z0, xb - xa, 0, 0, 0, 0, -SEG, rGravel, cg, cg, 0, (xb - xa) / 7.6, gv0, gv1);
    b.quad(-xb, BED.low, z0, xb - xa, 0, 0, 0, 0, -SEG, rGravel, cg, cg, 0, (xb - xa) / 7.6, gv0, gv1);
  }

  // sleepers
  const nSl = Math.round((NEAR - FAR) / TRACK.sleeperSpacing);
  const sTop = lin(0xffffff);
  for (let i = 0; i < nSl; i++) {
    const zc = NEAR - (i + 0.5) * TRACK.sleeperSpacing;
    for (const lane of lanes) {
      const cx = lane * LANE_WIDTH + (R() - 0.5) * 0.04;
      const k = 0.86 + R() * 0.2;
      const old = R() < 0.07 ? 0.72 : 1;
      const c = [sTop[0] * k * old, sTop[1] * k * old, sTop[2] * k * old];
      const cSide = shade(c, 0.85);
      const hz = SLEEPER.depth / 2, x0 = cx - SLEEPER.half, x1 = cx + SLEEPER.half;
      const zj = zc + (R() - 0.5) * 0.03;
      // top (u along +x)
      b.quad(x0, SLEEPER.y1, zj + hz, x1 - x0, 0, 0, 0, 0, -SLEEPER.depth, rTop, c, c);
      // front (+z) and back (-z)
      b.quad(x0, SLEEPER.y0, zj + hz, x1 - x0, 0, 0, 0, SLEEPER.y1 - SLEEPER.y0, 0, rSide, shade(cSide, 0.8), cSide);
      b.quad(x1, SLEEPER.y0, zj - hz, x0 - x1, 0, 0, 0, SLEEPER.y1 - SLEEPER.y0, 0, rSide, shade(cSide, 0.7), shade(cSide, 0.9));
      // ends
      b.quad(x1, SLEEPER.y0, zj + hz, 0, 0, -SLEEPER.depth, 0, SLEEPER.y1 - SLEEPER.y0, 0, rSide, cSide, cSide, 0, 0.1);
      b.quad(x0, SLEEPER.y0, zj - hz, 0, 0, SLEEPER.depth, 0, SLEEPER.y1 - SLEEPER.y0, 0, rSide, cSide, cSide, 0, 0.1);
    }
  }

  // rails: profile extruded along z (head top, head sides, web sides, foot tops) in PERIOD segments
  const headTop = lin(0xf1f4f8), headSide = lin(0xa9b0b9), headLow = lin(0x7d848d);
  const web = lin(0x6b5f55), foot = lin(0x7a6a5c);
  const nR = Math.round((NEAR - FAR) / PERIOD);
  const P = RAIL;
  for (const lane of lanes) {
    for (const side of [-1, 1]) {
      const rx = lane * LANE_WIDTH + side * TRACK.railGauge / 2;
      for (let i = 0; i < nR; i++) {
        const z0 = NEAR - i * PERIOD, L = -PERIOD;
        // head top
        b.quad(rx - P.headHalf, P.top, z0, P.headHalf * 2, 0, 0, 0, 0, L, rWhite, headTop, headTop);
        // head sides (outer faces), slightly tapered
        b.quad(rx + P.headHalf, P.webY, z0, 0, 0, L, 0, P.top - P.webY, 0, rWhite, headLow, headSide);            // +x face
        b.quad(rx - P.headHalf, P.webY, z0 + L, 0, 0, -L, 0, P.top - P.webY, 0, rWhite, headLow, headSide);       // -x face
        // web
        b.quad(rx + P.webHalf, P.footY, z0, 0, 0, L, 0, P.webY - P.footY, 0, rWhite, shade(web, 0.7), web);
        b.quad(rx - P.webHalf, P.footY, z0 + L, 0, 0, -L, 0, P.webY - P.footY, 0, rWhite, shade(web, 0.7), web);
        // foot tops (sloped outward)
        b.quad(rx + P.webHalf, P.footY, z0, P.footHalf - P.webHalf, P.y0 - P.footY, 0, 0, 0, L, rWhite, foot, foot);
        b.quad(rx - P.footHalf, P.y0, z0, P.footHalf - P.webHalf, P.footY - P.y0, 0, 0, 0, L, rWhite, foot, foot);
      }
    }
  }

  const geo = new THREE.BufferGeometry();
  b.toGeometry(geo, 2);
  return geo;
}
