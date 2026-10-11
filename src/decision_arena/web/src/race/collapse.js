// The ground collapsing behind the race. Nothing is cut in a straight line: the ground breaks along a ragged lip
// (breakAt, shared by the world's shaders and the code here), and what breaks away keeps its shape as it goes:
//  - the track breaks off in slabs (ballast, sleepers and rails on a block of soil), each lane and each stretch
//    of it at its own moment, that tip over the lip and fall;
//  - trains, ramps and barriers stay whole: each holds until the edge passes its middle, then loses its balance,
//    tips back over the lip until it stands almost upright, and drops;
//  - buildings sink and lean back into the chasm in one piece;
//  - rubble falls with them, and dust billows up from the chasm along the whole edge.
// Under the lip a broken bank of earth, lumpy and leaning back, shows its layers as it falls away into a dark
// chasm. Runners are not cut: one whose ground breaks falls with it (see Runner.caught).
import * as THREE from 'three';
import { applyCurve } from '../core/curve.js';
import { GeoBuilder, lin, shade } from '../world/builder.js';
import { BED, SLEEPER, RAIL } from '../world/track.js';
import { LANE_WIDTH, TRACK } from '../config.js';
import { ParticleSystem } from '../fx/particles.js';
import { kOf } from '../world/chunks.js';
import { CHUNK } from '../world/scenery.js';

export const PIT = 40;          // how deep the chasm is
export const YARD = 11.5;       // the rail yard the angled camera puts beyond the near side (see PackCamera)
const GRAVITY = 22;
const SLAB = 1.9;               // metres of track per slab: the track's own segment length (world/track.js)
const SLAB_DEPTH = 1.7;         // soil under a slab
const GRID = 84;                // track segments start at z = 84 (mod SLAB), see world/track.js
const ROCKS = 520;              // rubble pieces alive at once
const SLABS = 200;              // slabs of each kind alive at once
const DUST = { low: 450, medium: 800, high: 1200 };
const CORRIDOR = 5.35;          // the track's corridor, out to the foot of the walls and platforms either side
const LANES_END = LANE_WIDTH + BED.foot;   // where the outer lanes' beds end and the gravel shoulders begin
const SIDE = 180;               // how far the broken bank reaches on either side
const CUT_TOP = -0.12;          // the top of the bank: just under the ground beside the track
const CAP = 2.2;                // metres ahead of the edge in which cut walls show as solid: as far as the lip reaches
// How ragged the lip is. Track breaks a slab at a time: each lane runs ahead or behind by up to RUN / 2, slowly
// along its length, and each slab by up to HOLD / 2 more. Elsewhere the lip wanders by WAVE / 2 and crumbles by
// CRUMB / 2. (Kept gentle enough along the track that nothing breaks before the ground behind it.)
const HOLD = 1.1, RUN = 3.0, WAVE = 3.0, CRUMB = 0.5;
const REACH = SLAB + (HOLD + RUN) / 2 + 0.05;   // nothing further than this behind the edge still stands

// ------------------------------------------------------------------ where the ground breaks
/** A hash in [0, 1) of two whole numbers: in 32-bit integers, so it is exactly the shader's caHash. */
function hash(x, y) {
  let h = Math.imul(x | 0, 0x27d4eb2d) ^ Math.imul(y | 0, 0x165667b1);
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 8) / 16777216;
}
const ease = (f) => f * f * (3 - 2 * f);
function noise2(x, y) {
  const i = Math.floor(x), j = Math.floor(y), u = ease(x - i), v = ease(y - j);
  const a = hash(i, j) + (hash(i + 1, j) - hash(i, j)) * u, b = hash(i, j + 1) + (hash(i + 1, j + 1) - hash(i, j + 1)) * u;
  return a + (b - a) * v;
}
function noise1(t, k) { const i = Math.floor(t), u = ease(t - i); return hash(i, k) + (hash(i + 1, k) - hash(i, k)) * u; }

/** Where the edge must have reached for the ground at (x, z) to break: it is gone once edge < breakAt(x, z).
 *  `yard` is the rail yard's centre, or null. The track (and the yard's) breaks a whole slab at a time, the slabs
 *  laneSlab and shoulderSlab build; everything else along a wandering, crumbling line. */
export function breakAt(x, z, yard) {
  let xr = x, id = 0;
  if (yard !== null && x > CORRIDOR + 0.6) { xr = x - yard; id = 10; }
  const ax = Math.abs(xr);
  if (ax < CORRIDOR) {
    const col = id + (ax < LANES_END ? Math.max(-1, Math.min(1, Math.floor(xr / LANE_WIDTH + 0.5))) : Math.sign(xr) * 2);
    const sg = Math.floor((z - GRID) / SLAB), front = GRID + sg * SLAB;
    return front - (HOLD * (hash(col, sg) - 0.5) + RUN * (noise1(front / 13, col) - 0.5));
  }
  return z - (WAVE * (noise2(x / 5, z / 9) - 0.5) + CRUMB * (noise2(x / 1.5 + 17, z / 2) - 0.5));
}

// The same, in the shaders of everything the collapse breaks (see edged()): three.js's clipping chunks gain a
// test of the fragment's world position against breakAt.
const BREAK_GLSL = /* glsl */`
#ifdef COLLAPSE_EDGE
uniform vec2 uCollapse;
float caHash( vec2 p ) {
	uvec2 q = uvec2( ivec2( p ) );
	uint h = q.x * 0x27d4eb2du ^ q.y * 0x165667b1u;
	h = ( h ^ ( h >> 15 ) ) * 0x85ebca6bu;
	h = ( h ^ ( h >> 13 ) ) * 0xc2b2ae35u;
	h ^= h >> 16;
	return float( h >> 8 ) / 16777216.0;
}
float caNoise( vec2 p ) {
	vec2 i = floor( p ), f = p - i, u = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( caHash( i ), caHash( i + vec2( 1.0, 0.0 ) ), u.x ), mix( caHash( i + vec2( 0.0, 1.0 ) ), caHash( i + vec2( 1.0 ) ), u.x ), u.y );
}
float caNoise1( float t, float k ) { float i = floor( t ), f = t - i, u = f * f * ( 3.0 - 2.0 * f ); return mix( caHash( vec2( i, k ) ), caHash( vec2( i + 1.0, k ) ), u ); }
float caBreak( vec2 p ) {
	float xr = p.x, id = 0.0;
	if ( uCollapse.y < 1e5 && p.x > ${(CORRIDOR + 0.6).toFixed(3)} ) { xr = p.x - uCollapse.y; id = 10.0; }
	float ax = abs( xr );
	if ( ax < ${CORRIDOR.toFixed(3)} ) {
		float col = id + ( ax < ${LANES_END.toFixed(3)} ? clamp( floor( xr / ${LANE_WIDTH.toFixed(3)} + 0.5 ), -1.0, 1.0 ) : sign( xr ) * 2.0 );
		float sg = floor( ( p.y - ${GRID.toFixed(1)} ) / ${SLAB.toFixed(3)} ), front = ${GRID.toFixed(1)} + sg * ${SLAB.toFixed(3)};
		return front - ( ${HOLD.toFixed(3)} * ( caHash( vec2( col, sg ) ) - 0.5 ) + ${RUN.toFixed(3)} * ( caNoise1( front / 13.0, col ) - 0.5 ) );
	}
	return p.y - ( ${WAVE.toFixed(3)} * ( caNoise( vec2( p.x / 5.0, p.y / 9.0 ) ) - 0.5 ) + ${CRUMB.toFixed(3)} * ( caNoise( vec2( p.x / 1.5 + 17.0, p.y / 2.0 ) ) - 0.5 ) );
}
#endif
`;
const BREAK_TEST = /* glsl */`
#ifdef COLLAPSE_EDGE
	{ vec3 caW = transpose( mat3( viewMatrix ) ) * ( - vClipPosition - viewMatrix[ 3 ].xyz ); if ( caBreak( caW.xz ) > uCollapse.x ) discard; }
#endif
`;
{
  const head = '#if NUM_CLIPPING_PLANES > 0\n';
  const C = THREE.ShaderChunk;
  if (C.clipping_planes_fragment.startsWith(head) && C.clipping_planes_pars_fragment.startsWith(head)) {
    C.clipping_planes_pars_fragment = head + BREAK_GLSL + C.clipping_planes_pars_fragment.slice(head.length);
    C.clipping_planes_fragment = head + BREAK_TEST + C.clipping_planes_fragment.slice(head.length);
  } else console.warn('[collapse] clipping chunks changed; the ground breaks in a straight line');
}
const edgeUniform = { value: new THREE.Vector2(1e6, 1e6) };
function edgeCompile(shader) { applyCurve(shader); shader.uniforms.uCollapse = edgeUniform; }
/** Shadows break the same way: three.js casts them with its own depth materials, which take a material's clipping
 *  planes but nothing else, so a depth material carrying `plane` runs the test too. */
function edgeShadows(plane) {
  for (const D of [THREE.MeshDepthMaterial.prototype, THREE.MeshDistanceMaterial.prototype]) {
    if (D.__collapseEdge) continue;
    D.__collapseEdge = true;
    const before = D.onBeforeCompile, cuts = (m) => !!m.clippingPlanes && m.clippingPlanes.includes(plane);
    D.customProgramCacheKey = function () { return before.toString() + (cuts(this) ? 'collapse-edge' : ''); };
    D.onBeforeCompile = function (shader, renderer) {
      before.call(this, shader, renderer);
      if (!cuts(this)) return;
      shader.uniforms.uCollapse = edgeUniform;
      shader.fragmentShader = '#define COLLAPSE_EDGE\n' + shader.fragmentShader;
    };
  }
}

/** Let the ground break raggedly in this material (it must also have the collapse's clipping plane). */
function edged(m) {
  if (m.onBeforeCompile === edgeCompile) return;
  m.defines = Object.assign({}, m.defines, { COLLAPSE_EDGE: '' });
  m.onBeforeCompile = edgeCompile;
  m.needsUpdate = true;
}

const rnd = Math.random;
const _m = new THREE.Matrix4(), _t = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler();
const _p = new THREE.Vector3(), _s = new THREE.Vector3(), _c = new THREE.Color();
const col = (hex) => new THREE.Color(hex);
const DUST_LIGHT = [col('#e2d3b8'), col('#a89a86')], DUST_DEEP = [col('#7d6b58'), col('#3e342c')];
const SOIL = [0x6e5440, 0x5c4534, 0x7b6249, 0x4f3d30];
const STONE = [0x8a7d6c, 0x6f655a, 0x9a8e7c, 0x5c544b];
const CONCRETE = [0x9c9890, 0x7f7b74, 0xb0aaa0, 0x8a5a48];

// ------------------------------------------------------------------ the earth's layers
let earthCanvas = null;
/** Smooth value noise in [0, 1], tiling across every `period` cells. */
function noise(x, y, period) {
  const h = (i, j) => { let n = (((i % period) + period) % period) * 374761393 + j * 668265263; n = (n ^ (n >>> 13)) * 1274126177; return ((n ^ (n >>> 16)) >>> 0) / 4294967296; };
  const i = Math.floor(x), j = Math.floor(y), fx = x - i, fy = y - j;
  const u = fx * fx * (3 - 2 * fx), v = fy * fy * (3 - 2 * fy);
  return (h(i, j) * (1 - u) + h(i + 1, j) * u) * (1 - v) + (h(i, j + 1) * (1 - u) + h(i + 1, j + 1) * u) * v;
}

/** Layers of earth, 40 m deep (top of the image = ground level), darkening into the chasm. */
function earthImage() {
  if (earthCanvas) return earthCanvas;
  const W = 256, H = 1024, c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d'), img = g.createImageData(W, H), d = img.data;
  // depth (m) at which each layer ends, and its colour: topsoil, clay, sand, red clay, gravel, rock
  const layers = [[0.6, [70, 54, 40]], [2.8, [116, 88, 62]], [4.4, [150, 124, 92]], [7.6, [124, 84, 58]], [9.2, [140, 120, 96]], [15, [98, 90, 84]], [22, [82, 75, 70]], [99, [64, 57, 52]]];
  for (let y = 0; y < H; y++) {
    const depth = (y / H) * PIT;
    const dark = Math.min(1, Math.max(0, (depth - 8) / 28));
    for (let x = 0; x < W; x++) {
      // wavy layer boundaries, blended softly
      const warp = (noise(x / 32, y / 40, 8) - 0.5) * 1.8 + (noise(x / 8, y / 9, 32) - 0.5) * 0.35;
      const dd = depth + warp;
      let r = 0, gr = 0, b = 0, wsum = 0;
      for (let k = 0; k < layers.length; k++) {
        const top = k ? layers[k - 1][0] : -99, bot = layers[k][0];
        const w = Math.max(0, Math.min(1, (dd - top) / 0.25 + 0.5)) * Math.max(0, Math.min(1, (bot - dd) / 0.25 + 0.5));
        if (w > 0) { r += layers[k][1][0] * w; gr += layers[k][1][1] * w; b += layers[k][1][2] * w; wsum += w; }
      }
      r /= wsum; gr /= wsum; b /= wsum;
      // clumps, grain and fine horizontal bedding
      const n = (noise(x / 4, y / 4, 64) - 0.5) * 34 + (noise(x / 2, y / 1.5, 128) - 0.5) * 22
        + Math.sin(y * 0.9 + noise(x / 16, y / 16, 16) * 6) * 4;
      const k = 1 - dark * 0.85;
      const i = (y * W + x) * 4;
      d[i] = (r + n) * k; d[i + 1] = (gr + n * 0.95) * k; d[i + 2] = (b + n * 0.85) * k; d[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  // pebbles set in the clay and gravel: a little lighter than their layer, with a shadow beneath
  for (let i = 0; i < 520; i++) {
    const y = 20 + Math.pow(rnd(), 1.3) * H * 0.42, x = rnd() * W, r = 0.7 + rnd() * rnd() * 3.2;
    const f = 1 - Math.max(0, (y / H * PIT - 8) / 28) * 0.85;
    const v = (95 + rnd() * 70) * f;
    g.fillStyle = `rgba(20,14,10,${0.35 * f})`;
    g.beginPath(); g.ellipse(x + 0.4, y + 0.8, r * 1.3, r * 0.9, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = `rgba(${v},${v * 0.9},${v * 0.78},0.85)`;
    g.beginPath(); g.ellipse(x, y, r * 1.25, r * 0.85, (rnd() - 0.5) * 0.6, 0, Math.PI * 2); g.fill();
  }
  // roots in the topsoil
  g.strokeStyle = 'rgba(38,26,16,0.55)';
  for (let i = 0; i < 46; i++) {
    let x = rnd() * W, y = rnd() * 10;
    g.lineWidth = 0.5 + rnd() * 0.9;
    g.beginPath(); g.moveTo(x, y);
    for (let k = 0; k < 6; k++) { x += (rnd() - 0.5) * 7; y += 2 + rnd() * 6; g.lineTo(x, y); }
    g.stroke();
  }
  return (earthCanvas = c);
}

/** The earth texture for a face `width` metres wide (one image every 16 m). */
export function earthTexture(width) {
  const t = new THREE.CanvasTexture(earthImage());
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(width / 16, 1);
  t.anisotropy = 4;
  return t;
}

// The bank under the lip: a ribbon across the world, following the lip (see Collapse._bank), lumpy and leaning
// back as it goes down. Depths of its rows below the top, in metres of the PIT.
const ROWS = [0, 0.25, 0.7, 1.4, 2.4, 4, 7, 12, 19, 28, 40];
/** Where the bank has a column of vertices: closely near the track, sparsely far out, and twice at each place
 *  the track's slabs meet (one for each slab), so the lip can step there. */
function bankColumns(yard) {
  const xs = [];
  for (let x = -SIDE; x <= SIDE + 1e-6; x += Math.abs(x) < 40 ? 0.75 : 4) xs.push(x);
  const joins = [0, LANE_WIDTH / 2, LANES_END, CORRIDOR];
  for (const c of [0, yard]) for (const j of joins) for (const s of [-1, 1]) if (j > 0 || s > 0) xs.push(c + s * j - 1e-3, c + s * j + 1e-3);
  xs.push(CORRIDOR + 0.6 - 1e-3, CORRIDOR + 0.6 + 1e-3);
  return xs.sort((p, q) => p - q);
}

function bank(xs) {
  const n = xs.length, r = ROWS.length, g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * r * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(n * r * 3), 3).setUsage(THREE.DynamicDrawUsage));
  g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * r * 2), 2).setUsage(THREE.DynamicDrawUsage));
  const idx = [];
  for (let i = 0; i + 1 < n; i++) {
    for (let k = 0; k + 1 < r; k++) {
      const a = i * r + k, b = a + 1, c = a + r + 1, d = a + r;   // top left, below it, below right, top right
      idx.push(a, b, c, a, c, d);
    }
  }
  g.setIndex(idx);
  const mat = new THREE.MeshLambertMaterial({ map: earthTexture(16), emissive: 0x2a2018, emissiveIntensity: 0.6, side: THREE.DoubleSide });
  const m = new THREE.Mesh(g, mat);
  m.frustumCulled = false;
  m.receiveShadow = true;
  return m;
}

// ------------------------------------------------------------------ dust
/** Sixteen billows of dust (a 4 x 4 atlas, as the particle system expects): clumps of soft lumps, lit from
 *  above, each a different shape. */
function dustAtlas() {
  const S = 128, c = document.createElement('canvas');
  c.width = c.height = S * 4;
  const g = c.getContext('2d');
  for (let f = 0; f < 16; f++) {
    const ox = (f % 4) * S, oy = ((f / 4) | 0) * S;
    for (let k = 0; k < 26; k++) {
      // lumps gathered toward the middle, smaller toward the rim
      const a = rnd() * Math.PI * 2, d = Math.pow(rnd(), 0.8) * S * 0.26;
      const x = ox + S / 2 + Math.cos(a) * d, y = oy + S / 2 + Math.sin(a) * d * 0.8, r = S * (0.1 + rnd() * 0.12) * (1 - d / (S * 0.5));
      const lit = 0.75 + 0.25 * (1 - (y - oy) / S);   // brighter on top
      const v = Math.round(255 * lit);
      const grd = g.createRadialGradient(x, y - r * 0.2, 0, x, y, r);
      grd.addColorStop(0, `rgba(${v},${v},${v},0.42)`);
      grd.addColorStop(0.55, `rgba(${v},${v},${v},0.22)`);
      grd.addColorStop(1, `rgba(${v},${v},${v},0)`);
      g.fillStyle = grd;
      g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

// ------------------------------------------------------------------ slabs of track
/** A lane's ballast bed, two sleepers and its rails on a block of soil, SLAB long, centred on x = 0, z = 0.
 *  `v0` is where in the ballast texture it starts, so the slab matches the stretch of track it replaces. */
function laneSlab(A, v0) {
  const b = new GeoBuilder(1500, 2400), W = lin(0xffffff), h = SLAB / 2;
  const rBallast = A.R('ballast'), rSlope = A.R('bedSlope'), rTop = A.R('sleeperTop'), rSide = A.R('sleeperSide'), rWhite = A.R('white');
  b.quad(-BED.half, BED.top, h, BED.half * 2, 0, 0, 0, 0, -SLAB, rBallast, W, W, 0, 1, v0, v0 + 0.5);
  const dy = BED.top - BED.low, dx = BED.foot - BED.half, cs = shade(W, 0.9);
  b.quad(BED.half, BED.top, h, dx, -dy, 0, 0, 0, -SLAB, rSlope, cs, cs, 0, 1, v0, v0 + 0.5);
  b.quad(-BED.foot, BED.low, h, dx, dy, 0, 0, 0, -SLAB, rSlope, cs, cs, 1, 0, v0, v0 + 0.5);
  soil(b, A, BED.foot * 2);
  // sleepers, where the track has them (every 0.95 m, a quarter of a segment from each end)
  const sTop = lin(0xffffff), sSide = shade(sTop, 0.85);
  for (const zc of [h / 2, -h / 2]) {
    const hz = SLEEPER.depth / 2, x0 = -SLEEPER.half, x1 = SLEEPER.half, H = SLEEPER.y1 - SLEEPER.y0;
    b.quad(x0, SLEEPER.y1, zc + hz, x1 - x0, 0, 0, 0, 0, -SLEEPER.depth, rTop, sTop, sTop);
    b.quad(x0, SLEEPER.y0, zc + hz, x1 - x0, 0, 0, 0, H, 0, rSide, shade(sSide, 0.8), sSide);
    b.quad(x1, SLEEPER.y0, zc - hz, x0 - x1, 0, 0, 0, H, 0, rSide, shade(sSide, 0.7), shade(sSide, 0.9));
    b.quad(x1, SLEEPER.y0, zc + hz, 0, 0, -SLEEPER.depth, 0, H, 0, rSide, sSide, sSide, 0, 0.1);
    b.quad(x0, SLEEPER.y0, zc - hz, 0, 0, SLEEPER.depth, 0, H, 0, rSide, sSide, sSide, 0, 0.1);
  }
  // rails: head, sides and web (as in world/track.js), with their broken ends
  const head = lin(0xf1f4f8), side = lin(0xa9b0b9), low = lin(0x7d848d), web = lin(0x6b5f55), P = RAIL, L = -SLAB;
  for (const s of [-1, 1]) {
    const rx = s * TRACK.railGauge / 2;
    b.quad(rx - P.headHalf, P.top, h, P.headHalf * 2, 0, 0, 0, 0, L, rWhite, head, head);
    b.quad(rx + P.headHalf, P.webY, h, 0, 0, L, 0, P.top - P.webY, 0, rWhite, low, side);
    b.quad(rx - P.headHalf, P.webY, h + L, 0, 0, -L, 0, P.top - P.webY, 0, rWhite, low, side);
    b.quad(rx + P.webHalf, P.footY, h, 0, 0, L, 0, P.webY - P.footY, 0, rWhite, shade(web, 0.7), web);
    b.quad(rx - P.webHalf, P.footY, h + L, 0, 0, -L, 0, P.webY - P.footY, 0, rWhite, shade(web, 0.7), web);
    for (const z of [h, -h]) b.box(rx, (P.y0 + P.top) / 2, z, P.headHalf * 2, P.top - P.y0, 0.02, rWhite, low);
  }
  return finish(b);
}

/** The gravel shoulder beside the outer lanes, on a block of soil, centred on x = 0, z = 0. */
function shoulderSlab(A) {
  const b = new GeoBuilder(400, 600), W = shade(lin(0xffffff), 0.95);
  const w = BED.shoulder + 0.05 - (LANE_WIDTH + BED.foot), h = SLAB / 2;
  b.quad(-w / 2, BED.low, h, w, 0, 0, 0, 0, -SLAB, A.R('gravel'), W, W, 0, w / 7.6, 0, 0.25);
  soil(b, A, w);
  return finish(b);
}

/** The block of soil under a slab, `w` wide, its top at the bed's foot. */
function soil(b, A, w) {
  const top = lin(0x7a5c42), bottom = lin(0x3e2e22);
  b.box(0, BED.low - SLAB_DEPTH / 2, 0, w, SLAB_DEPTH, SLAB, A.R('dirt'), bottom, { cT: top, tile: 2.5, tileV: 2.5, skip: 'py' });
}

function finish(b) {
  const g = new THREE.BufferGeometry();
  b.toGeometry(g, 1);
  g.setDrawRange(0, b.ni);
  return g;
}

/** A lumpy rock, roughly 1 m across. */
function rock() {
  const g = new THREE.IcosahedronGeometry(0.5, 0).toNonIndexed();
  const p = g.attributes.position, seen = new Map();
  for (let i = 0; i < p.count; i++) {
    const key = `${p.getX(i).toFixed(3)},${p.getY(i).toFixed(3)},${p.getZ(i).toFixed(3)}`;
    if (!seen.has(key)) seen.set(key, 0.7 + rnd() * 0.5);
    const k = seen.get(key);
    p.setXYZ(i, p.getX(i) * k, p.getY(i) * k * 0.8, p.getZ(i) * k);
  }
  g.computeVertexNormals();
  return g;
}

/** A pool of instances of one shape, each moved by its own piece. */
class Pool {
  constructor(scene, geo, mat, cap, colors) {
    this.mesh = new THREE.InstancedMesh(geo, mat, cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.mesh.count = 0;
    if (colors) this.mesh.setColorAt(0, _c.set(0xffffff));
    this.cap = cap;
    this.items = [];
    scene.add(this.mesh);
  }
  add(item) { if (this.items.length >= this.cap) this.items.shift(); this.items.push(item); return item; }
  clear() { this.items.length = 0; this.mesh.count = 0; }
}

/** Where an obstacle loses its balance: once a third of a train, or half of anything else, hangs over the edge. */
const balance = (r) => r.col.maxZ - (r.col.maxZ - r.col.minZ) * (r.kind === 'train' ? 0.35 : 0.5);

// ------------------------------------------------------------------ the collapse
export class Collapse {
  constructor(ctx) {
    this.ctx = ctx;
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);   // keeps z <= constant
    this.planes = [this.plane];   // the world's cuts: this one, and the camera's (see PackCamera)
    this.on = false;
    this.z = 1e6;
    this.bodies = [];        // whole things falling: trains, ramps, barriers, buildings
    this.nearCut = false;    // the camera has cut the near side away (see PackCamera)...
    this.yardX = null;       // ...and put a rail yard this far to the right
  }

  /** Whether the ground at (x, z) has broken away, once the edge is at `edge`. */
  gone(x, z, edge = this.z) { return breakAt(x, z, this.yardX) > edge; }

  /** Let the ground break raggedly in a material cut by this.plane (see breakAt). */
  edged(m) { edged(m); }

  /** Called once the world exists: the cut, the chasm, and the pieces the ground breaks into. */
  start() {
    const ctx = this.ctx, scene = ctx.scene, env = ctx.env, vis = ctx.level.vis;
    ctx.renderer.localClippingEnabled = true;
    edgeShadows(this.plane);
    const planes = this.planes;
    const clip = (o) => {
      if (!o.material) return;
      for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
        // what is cut away casts no shadow either
        if (m.clippingPlanes !== planes) { m.clippingPlanes = planes; m.clipShadows = true; m.needsUpdate = true; }
        edged(m);
      }
    };
    scene.getObjectByName('world-track')?.traverse(clip);
    scene.getObjectByName('world-chunks')?.traverse(clip);
    // trains, ramps and barriers fall whole, so they are not cut; coins, power-ups and headlight beams are
    const whole = new Set([vis.trains.mesh, vis.props.mesh, vis.decals.mesh, vis.glow.mesh]);
    ctx.level.root.traverse((o) => { if (!whole.has(o)) clip(o); });

    // falling buildings keep the world's look, without the cut
    this.mats = {};
    const others = this.planes.filter((p) => p !== this.plane);
    for (const k of ['o', 'n', 'c', 'g']) { this.mats[k] = env.mats[k].clone(); this.mats[k].clippingPlanes = others; }

    // what the cut slices open (walls, platforms, bridge decks) shows solid inside: its inner faces, near the
    // edge, in one flat dark colour
    this.capPlane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 1e6);   // keeps z >= edge - CAP
    const capMat = new THREE.MeshBasicMaterial({ color: 0x3b332d, side: THREE.BackSide, clippingPlanes: [...this.planes, this.capPlane] });
    edged(capMat);
    this.caps = [];
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(new THREE.BufferGeometry(), capMat);
      m.matrixAutoUpdate = false;
      m.frustumCulled = false;
      m.visible = false;
      this.caps.push(m);
      scene.add(m);
    }

    // slabs of track, and rubble
    const A = env.atlas;
    // (never cut: they fall in the chasm, the rail yard's beyond the camera's cut too)
    const slabMat = env.mats.o.clone();
    slabMat.clippingPlanes = null;
    this.slabs = [laneSlab(A, 0), laneSlab(A, 0.5), shoulderSlab(A)].map((g) => new Pool(scene, g, slabMat, SLABS));
    this.rocks = new Pool(scene, rock(), new THREE.MeshLambertMaterial({ flatShading: true }), ROCKS, true);

    // dust: its own pool, so the race's own effects never run short
    const q = ctx.quality || 'high';
    this.dust = new ParticleSystem({ capacity: DUST[q] ?? 900, texture: dustAtlas(), parent: scene, curved: true, renderOrder: 19, name: 'collapse-dust' });
    this.dustScale = (DUST[q] ?? 900) / DUST.high;

    // the bank of broken earth under the lip, and the chasm's dark floor far below
    this.bankXs = bankColumns(YARD);
    this.face = bank(this.bankXs);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshBasicMaterial({ color: 0x120e0b, fog: false }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.frustumCulled = false;
    for (const o of [this.face, this.floor]) { o.visible = false; scene.add(o); }
    this.reset();
  }

  reset() {
    this.on = false;
    this.z = 1e6;
    this.plane.constant = 1e6;
    this.cols = null;        // each line of slabs (lanes and shoulders), and the next slab to break in it
    this.rubbleZ = null;     // where the next row of rubble and dust breaks off
    for (const b of this.bodies) this._remove(b);
    this.bodies.length = 0;
    for (const p of this.slabs || []) p.clear();
    this.rocks?.clear();
    this.dust?.clear();
    if (this.floor) for (const o of [this.face, this.floor, ...this.caps]) o.visible = false;
    edgeUniform.value.set(1e6, 1e6);
  }

  /** Move the edge to z (it only ever advances) and let everything that broke away fall. */
  update(dt, z, active) {
    if (active) {
      if (!this.on) {
        this.on = true;
        this.rubbleZ = z;
      }
      if (z < this.z) this.z = z;
      this._break();
      // the plane only trims what stands well behind the lip (and keeps it out of the shadows); the shaders
      // break the rest along the lip
      this.plane.constant = this.z + REACH;
      edgeUniform.value.set(this.z, this.yardX ?? 1e6);
      this._bank();
      this._caps();
      this.floor.position.set(0, -PIT, this.z);
      for (const o of [this.face, this.floor]) o.visible = true;
    }
    if (dt > 0) {
      for (const p of this.slabs) this._slabs(p, dt);
      this._rocks(dt);
      for (let i = this.bodies.length - 1; i >= 0; i--) {
        if (this._body(this.bodies[i], dt)) { this._remove(this.bodies[i]); this.bodies.splice(i, 1); }
      }
    }
    this.dust.update(dt);
  }

  /** How far back the lip is at x: the back of the last slab still standing on the track, or where the
   *  wandering line crosses the edge elsewhere. */
  _lip(x) {
    const E = this.z, yard = this.yardX;
    const xr = yard !== null && x > CORRIDOR + 0.6 ? x - yard : x;
    if (Math.abs(xr) < CORRIDOR) {
      let sg = Math.floor((E - REACH - GRID) / SLAB);
      while (sg < 1e6 && breakAt(x, GRID + (sg + 1.5) * SLAB, yard) <= E) sg++;
      return GRID + (sg + 1) * SLAB;
    }
    let z = E;
    for (let k = 0; k < 4; k++) z = E + z - breakAt(x, z, yard);
    return z;
  }

  /** Lay the bank along the lip, each part's top level with the ground there: a street behind a retaining wall
   *  stands a few metres above the track; the near side cut away by the camera is open ground. */
  _bank() {
    const E = this.z, xs = this.bankXs, r = ROWS.length, scenery = this.ctx.env.scenery, k = kOf(E);
    const g = this.face.geometry, P = g.attributes.position.array, UV = g.attributes.uv.array;
    const tops = [-1, 1].map((s) => { const Z = scenery._zone(s, k); return Z.type === 'wall' ? Z.h - 0.02 : CUT_TOP; });
    for (let i = 0; i < xs.length; i++) {
      const x = xs[i], zl = this._lip(x);
      const top = Math.abs(x) < CORRIDOR || (x > 0 && this.nearCut) ? CUT_TOP : tops[x < 0 ? 0 : 1];
      for (let j = 0; j < r; j++) {
        // down the bank: crumbly and leaning back near the lip, steeper below, lumpy all the way
        const d = ROWS[j] * (top + PIT) / PIT;
        const y = top - d - (j === 0 ? 0.12 * noise2(x / 0.7, 3) : 0);
        const z = zl - 0.2 + Math.min(d, 2.5) * 0.35 + Math.max(0, d - 2.5) * 0.08 + (noise2(x / 1.2, d) - 0.5) * 0.8 * Math.min(1, d / 0.4);
        const o = (i * r + j) * 3;
        P[o] = x; P[o + 1] = y; P[o + 2] = z;
        UV[(i * r + j) * 2] = (x + (z - E) * 0.5) / 16;
        UV[(i * r + j) * 2 + 1] = 1 - (top - y) / PIT;
      }
    }
    g.attributes.position.needsUpdate = g.attributes.uv.needsUpdate = true;
    g.computeVertexNormals();
  }

  /** Give the chunks the edge is cutting through their solid insides. */
  _caps() {
    this.capPlane.constant = -(this.z - CAP);
    let n = 0;
    for (const c of this.ctx.env.chunks.active.values()) {
      const zN = -c.k * CHUNK;
      if (zN < this.z - CAP || zN - CHUNK > this.z) continue;
      for (const key of ['o', 'n']) {
        if (n >= this.caps.length || !c.meshes[key].visible) continue;
        this.caps[n].geometry = c.meshes[key].geometry;
        this.caps[n++].visible = true;
      }
    }
    for (; n < this.caps.length; n++) this.caps[n].visible = false;
  }

  // ------------------------------------------------------------------ breaking
  _break() {
    const edge = this.z;
    // slabs of track, each as its stretch of ground breaks (so each replaces exactly what broke away)
    if (!this.cols) {
      const u = (LANES_END + BED.shoulder + 0.05) / 2;
      this.cols = [-u, -LANE_WIDTH, 0, LANE_WIDTH, u].map((x) => ({ x, yard: false }));
      this.cols.push(...this.cols.map((c) => ({ x: c.x, yard: true })));
    }
    for (const c of this.cols) {
      const x = c.yard ? (this.yardX === null ? null : this.yardX + c.x) : c.x;
      if (x === null) { c.sg = null; continue; }
      // a line starts at the first slab still standing (what broke before it is not seen)
      if (c.sg == null) c.sg = Math.floor((edge + REACH - GRID) / SLAB);
      for (; breakAt(x, GRID + (c.sg + 0.5) * SLAB, this.yardX) > edge; c.sg--) {
        const pool = Math.abs(c.x) > LANES_END ? this.slabs[2] : this.slabs[(c.sg + 1) & 1];
        this._slab(pool, x, GRID + (c.sg + 0.5) * SLAB);
      }
    }
    // rubble and dust, a row every 0.6 m, so the amount is the same at any frame rate
    for (; this.rubbleZ > edge; this.rubbleZ -= 0.6) this._row();
    // trains, ramps and barriers go over once enough of them hangs over the edge; until then they stand, and
    // runners can still run on them and into them
    const level = this.ctx.level;
    for (let i = level.recs.length - 1; i >= 0; i--) {
      const r = level.recs[i];
      if (this.gone((r.col.minX + r.col.maxX) / 2, balance(r))) this._takeObstacle(r);
    }
    // and buildings the edge is about to cut into
    for (const c of this.ctx.env.chunks.active.values()) {
      for (const blk of c.blocks || []) {
        if (blk.taken) continue;
        // (anywhere along its back: the lip wanders)
        const [x0, , , x1, , z1] = blk.box;
        for (let x = x0; x < x1 + 1; x += 1) if (this.gone(Math.min(x, x1), z1 + 1.5)) { this._takeBuilding(c, blk); break; }
      }
    }
  }

  _slab(pool, x, zc) {
    pool.add({
      x, y: 0, z: zc - SLAB / 2,       // the hinge: the slab's front edge, still on the ground ahead
      th: 0, w: 0, roll: 0, rw: (rnd() - 0.5) * 1.6, yaw: (rnd() - 0.5) * 0.1, vy: -rnd() * 1.5, vz: 0.4 + rnd() * 1.4,
      vx: (rnd() - 0.5) * 0.8,
      hold: rnd() < 0.3 ? 0.2 + rnd() * 0.5 : rnd() * 0.12,   // some hang on for a moment: a ragged edge
      tip: 3 + rnd() * 9,
    });
  }

  /** Rubble and dust off the lip, wherever along it each piece breaks away. */
  _row() {
    const n = (k) => Math.round(k * this.dustScale + rnd() * 0.5);
    const rock = (x, y, size, palette) => this._rock(x, y, this._lip(x) - 0.3, size, palette);
    // ballast and clods off the track, chunks of pavement and wall from the street on either side
    for (let k = 0; k < 4; k++) rock((rnd() - 0.5) * 10, -0.1, 0.12 + rnd() * 0.22, STONE);
    for (let k = 0; k < 2; k++) rock((rnd() - 0.5) * 12, -0.6, 0.3 + rnd() * 0.5, SOIL);
    if (rnd() < 0.7) { const s = rnd() < 0.5 ? -1 : 1; rock(s * (5.5 + rnd() * 18), 0, 0.5 + rnd() * 0.9, CONCRETE); }
    // dust thrown up along the lip, and darker dust rising out of the chasm
    for (let k = 0; k < n(3); k++) {
      const wide = rnd() < 0.55 ? 7 : 26, x = (rnd() - 0.5) * 2 * wide;
      this._puff(x, -1.6 + rnd() * 1.8, this._lip(x) + 0.4 + rnd() * 2.4, 2 + rnd() * 2.2, 2.8, 2.4 + rnd() * 1.8, 0.75 + rnd() * 0.25, DUST_LIGHT, 0.6 + rnd() * 1.8);
    }
    if (rnd() < 0.8 * this.dustScale + 0.2) {
      this._puff((rnd() - 0.5) * 40, -5 - rnd() * 14, this.z + 3 + rnd() * 6, 4 + rnd() * 3, 2, 3 + rnd() * 1.8, 0.55, DUST_DEEP, 2 + rnd() * 2.5);
    }
  }

  _rock(x, y, z, size, palette) {
    this.rocks.add({
      x, y, z, s: size,
      vx: (rnd() - 0.5) * 1.6, vy: rnd() * 1.6 - 0.6, vz: rnd() * 2.2,
      rx: rnd() * 6, ry: rnd() * 6, rz: rnd() * 6, wx: (rnd() - 0.5) * 7, wy: (rnd() - 0.5) * 7, wz: (rnd() - 0.5) * 7,
      hold: rnd() * 0.2,
      color: palette[(rnd() * palette.length) | 0],
    });
  }

  /** One billow of dust: size grows `grow` times over its life as it rises. */
  _puff(x, y, z, size, grow, life, alpha, colors, rise) {
    const D = this.dust, i = D.alloc();
    if (i < 0) return;
    D.pos(i, x, y, z);
    D.vel(i, (rnd() - 0.5) * 1.4, rise, 0.3 + rnd() * 1.2);
    D.look(i, (rnd() * 16) | 0, 0, 0);
    D.shape(i, size, size * grow, (rnd() - 0.5) * 0.5, (rnd() - 0.5) * 0.3);   // kept upright: lit from above
    D.color(i, colors[0], colors[1]);
    D.fade(i, life, alpha, 0.14, 1.5);
    D.phys(i, 0.5, -0.15, 0, 0);
  }

  /** A great cloud of dust where something heavy goes over: across `w` metres, up to `h` high. */
  _plume(x, z, w, h, n) {
    for (let k = 0; k < Math.round(n * this.dustScale); k++) {
      const s = 2 + rnd() * 3 + w * 0.08;
      this._puff(x + (rnd() - 0.5) * w, rnd() * h * 0.4 - 1, z + (rnd() - 0.3) * 3, s, 2.4, 2.8 + rnd() * 2, 0.6, DUST_LIGHT, 1 + rnd() * 3);
    }
  }

  // ------------------------------------------------------------------ whole things
  _takeObstacle(r) {
    const level = this.ctx.level, vis = level.vis, c = r.col;
    const train = r.kind === 'train';
    const moving = r.moving ? r.vt : 0;
    const handle = level.detach(r);
    if (handle == null || handle === -1) return;
    const parts = [];
    const take = (bank, id) => { const m = new THREE.Matrix4(); bank.mesh.getMatrixAt(id, m); parts.push({ bank, id, m }); };
    let glows = [];
    if (train) {
      for (const pc of handle.pieces) take(pc.bank, pc.id);
      for (const pc of handle.decals) take(pc.bank, pc.id);
      glows = handle.glows.map((gl) => ({ gl, p: new THREE.Vector3(gl.x, gl.y, gl.z) }));
      if (handle.beam) {   // its headlight beam lies on the track, which is gone
        const i = vis.beamItems.indexOf(handle.beam);
        if (i >= 0) vis.beamItems.splice(i, 1);
        handle.beam = null;
      }
    } else take(vis.props, handle);
    const x = (c.minX + c.maxX) / 2, zb = balance(r);
    this.bodies.push({
      kind: train ? 'train' : 'prop', handle, parts, glows,
      pivot0: new THREE.Vector3(x, 0, zb), P: new THREE.Vector3(x, 0, zb),
      // a train is heavy and slow to go over; a barrier just topples
      alpha: train ? 1.1 + rnd() * 0.5 : r.kind === 'ramp' ? 3 : 7, drop: train ? 1.0 : 0.3, max: 1.45, gravity: train ? 15 : GRAVITY,
      th: 0, w: 0, roll: 0, rw: (rnd() - 0.5) * 0.35, vy: 0, vz: moving, phase: 'hold', w0: c.maxX - c.minX, h: c.maxY,
      bottom: PIT + (c.maxZ - c.minZ),
    });
  }

  _takeBuilding(chunk, blk) {
    blk.taken = true;
    const group = new THREE.Group();
    group.matrixAutoUpdate = false;
    for (const key of ['o', 'n', 'c', 'g']) {
      const [v0, i0] = blk.a[key], [v1, i1] = blk.b[key];
      if (i1 <= i0) continue;
      const src = chunk.meshes[key].geometry, g = new THREE.BufferGeometry();
      for (const [name, n] of [['position', 3], ['normal', 3], ['uv', 2], ['color', 3]]) {
        g.setAttribute(name, new THREE.BufferAttribute(src.getAttribute(name).array.slice(v0 * n, v1 * n), n));
      }
      const idx = src.index.array.slice(i0, i1);
      for (let i = 0; i < idx.length; i++) idx[i] -= v0;
      g.setIndex(new THREE.BufferAttribute(idx, 1));
      const mesh = new THREE.Mesh(g, this.mats[key]);
      mesh.matrixAutoUpdate = false;
      mesh.frustumCulled = false;
      mesh.receiveShadow = key === 'o' || key === 'n';
      mesh.castShadow = key === 'n';
      if (key === 'g') { mesh.renderOrder = 5; mesh.visible = this.ctx.env.chunks.glowVisible; }
      group.add(mesh);
      // and gone from the chunk: its triangles collapse to nothing
      src.index.array.fill(v0, i0, i1);
      src.index.addUpdateRange(i0, i1 - i0);
      src.index.needsUpdate = true;
    }
    this.ctx.scene.add(group);
    const [x0, y0, z0, x1, y1, z1] = blk.box;
    const x = (x0 + x1) / 2, zb = z1 - (z1 - z0) * 0.3;
    this.bodies.push({
      kind: 'building', group,
      pivot0: new THREE.Vector3(x, y0, zb), P: new THREE.Vector3(x, y0, zb),
      // a building does not topple: it sinks into the chasm, leaning back as it goes
      alpha: 0.5 + rnd() * 0.3, drop: 0, max: 0.3 + rnd() * 0.25, gravity: 9 + rnd() * 4,
      th: 0, w: 0, roll: 0, rw: (rnd() - 0.5) * 0.12, vy: 0, vz: 0, phase: 'hold', w0: x1 - x0, h: y1 - y0, zb,
      bottom: PIT + (y1 - y0) + 4,
    });
  }

  /** Move one whole thing; returns true once it is gone into the chasm. */
  _body(b, dt) {
    if (b.phase === 'hold') {
      // it holds while most of it still stands on the ground
      b.P.z += b.vz * dt;
      if (this.z > b.P.z) return this._pose(b);   // P starts where it loses its balance
      b.phase = 'tip';
      this._plume(b.P.x, b.P.z, Math.max(3, b.w0), b.h, b.kind === 'building' ? 26 : b.kind === 'train' ? 12 : 3);
    }
    // over it goes, faster and faster, until it stands almost on end; then it drops
    if (b.th < b.max) b.w += b.alpha * dt;
    else b.w *= Math.exp(-4 * dt);
    b.th = Math.min(b.max + 0.08, b.th + b.w * dt);
    b.roll += b.rw * dt;
    if (b.phase === 'tip' && b.th >= b.drop) b.phase = 'fall';
    if (b.phase === 'fall') {
      b.vy -= (b.gravity || GRAVITY) * dt;
      b.P.y += b.vy * dt;
    }
    b.vz = b.kind === 'building' ? 0.6 : Math.max(b.vz * Math.exp(-0.8 * dt), 1.2);   // away from the lip
    b.P.z += b.vz * dt;
    this._pose(b);
    return b.P.y < b.pivot0.y - b.bottom;
  }

  /** Place every part of a whole thing: turned about its pivot, then moved with it. */
  _pose(b) {
    _q.setFromEuler(_e.set(b.th, 0, b.roll));
    _t.makeTranslation(-b.pivot0.x, -b.pivot0.y, -b.pivot0.z);
    _m.compose(b.P, _q, _s.set(1, 1, 1)).multiply(_t);
    if (b.group) { b.group.matrix.copy(_m); b.group.matrixWorldNeedsUpdate = true; return false; }
    for (const p of b.parts) p.bank.set(p.id, _t.multiplyMatrices(_m, p.m));
    for (const g of b.glows) { _p.copy(g.p).applyMatrix4(_m); g.gl.x = _p.x; g.gl.y = _p.y; g.gl.z = _p.z; }
    return false;
  }

  _remove(b) {
    const vis = this.ctx.level.vis;
    if (b.kind === 'train') vis.removeTrain(b.handle);
    else if (b.kind === 'prop') vis.removeProp(b.handle);
    else {
      this.ctx.scene.remove(b.group);
      for (const m of b.group.children) m.geometry.dispose();
    }
  }

  // ------------------------------------------------------------------ slabs and rubble
  _slabs(pool, dt) {
    const M = pool.mesh, items = pool.items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const s = items[i];
      if (s.hold > 0) s.hold -= dt;
      else {
        // its back has nothing under it: it tips over the lip, then slides off and falls
        s.w += s.tip * dt;
        s.th += s.w * dt;
        if (s.th > 0.35) {
          s.vy -= GRAVITY * dt;
          s.y += s.vy * dt;
          s.x += s.vx * dt;
          s.z += s.vz * dt;
          s.roll += s.rw * dt;
          s.w *= Math.exp(-1.2 * dt);
        }
      }
      if (s.y < -PIT - 2) continue;
      // the slab's centre is half a slab behind its hinge, turned with it
      _q.setFromEuler(_e.set(s.th, s.yaw, s.roll));
      _p.set(0, 0, SLAB / 2).applyQuaternion(_q).add(_s.set(s.x, s.y, s.z));
      M.setMatrixAt(n, _m.compose(_p, _q, _s.set(1, 1, 1)));
      items[n++] = s;
    }
    items.length = n;
    M.count = n;
    M.instanceMatrix.needsUpdate = true;
  }

  _rocks(dt) {
    const R = this.rocks, M = R.mesh, items = R.items;
    let n = 0;
    for (let i = 0; i < items.length; i++) {
      const p = items[i];
      if (p.hold > 0) p.hold -= dt;
      else {
        p.vy -= GRAVITY * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
      }
      if (p.y < -PIT - 1) continue;
      _q.setFromEuler(_e.set(p.rx, p.ry, p.rz));
      M.setMatrixAt(n, _m.compose(_p.set(p.x, p.y, p.z), _q, _s.set(p.s, p.s, p.s)));
      M.setColorAt(n, _c.setHex(p.color));
      items[n++] = p;
    }
    items.length = n;
    M.count = n;
    M.instanceMatrix.needsUpdate = true;
    if (M.instanceColor) M.instanceColor.needsUpdate = true;
  }
}
