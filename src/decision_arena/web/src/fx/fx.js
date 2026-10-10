// Rail Dash visual effects (AUDIOFX). Public API (CONTRACTS 6.7): constructor(ctx), start(), update(dt, info),
// burst(kind, pos, opts). Two pooled particle systems, one draw call each:
//   world  - world-space particles (curved-world aware) for sparkles, dust, flames, smoke, rings, debris, stars
//   screen - camera-attached, NO_CURVE, drawn on top: speed lines and confetti
// Everything is event driven (see start()) plus continuous emitters read from `info` and ctx.game.rig.anchors.
// Freezes when dt === 0. Particle counts scale with ctx.quality; reduceMotion drops speed lines and trims confetti.
import * as THREE from 'three';
import { EV } from '../core/events.js';
import { POWERUPS } from '../config.js';
import { ParticleSystem, MODE } from './particles.js';
import { makeAtlas, SPR } from './sprites.js';

const QUALITY = { low: 0.45, medium: 0.7, high: 1 };
const CAPACITY = { low: 900, medium: 1500, high: 2400 };
const TAU = Math.PI * 2;
const col = (hex) => new THREE.Color(hex);

const C = {
  white: col('#ffffff'), gold: col('#ffd23f'), coin: col('#ffc21a'), coinHi: col('#fff3b0'),
  dust: col('#cdb896'), dustHi: col('#efe4cf'), roof: col('#b9bcc6'), roofHi: col('#eceef3'),
  smoke: col('#c4c1cf'), smokeDark: col('#8e8a9c'),
  flameHot: col('#fff6c8'), flame: col('#ffb13b'), flameEnd: col('#ff4d1a'),
  spark: col('#fff3a8'), sparkEnd: col('#ff8a2a'), debris: col('#6d5c4c'), debris2: col('#8f96a3'),
  star: col('#ffd23f'), magnet: col('#ff3b5c'), magnetHi: col('#ffc2cf'),
  green: col('#39d353'), greenHi: col('#d4ffa8'), pink: col('#ff4fa3'), cyan: col('#44dbff'),
  purple: col('#b86bff'), purpleHi: col('#ecd6ff'), blue: col('#3ab7ff'), blueHi: col('#d6f3ff'),
  violet: col('#7b5cff'), lime: col('#c6ff3d'), orange: col('#ff7a1a'), ink: col('#1b1238'),
};
const CONFETTI = [C.pink, C.lime, C.cyan, C.gold, C.violet, C.orange, C.white, col('#ff5a4f')];
const PU_COLOR = {};
for (const [k, v] of Object.entries(POWERUPS)) PU_COLOR[k] = col(v.color);
PU_COLOR.hoverboardItem = C.pink;

// deterministic PRNG (mulberry32) so harness screenshots are reproducible
let seed = 0x9e3779b9;
function rnd() {
  let t = (seed = (seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + (b - a) * rnd();
const pick = (arr) => arr[(rnd() * arr.length) | 0];

// ---------------------------------------------------------------------------------------------------------
// Spray presets: frame, mode, add, colours, size [min,max] -> end size (x start when rel), life, speed, direction
// dir: 'sphere' | 'hemi' (upper) | 'ring' (XZ) | 'up' (narrow cone) | 'down' | 'back' (+Z cone)
// ---------------------------------------------------------------------------------------------------------
const P = {
  coinSpark: { frame: SPR.SPARKLE, add: 1, c0: C.white, c1: C.gold, size: [0.3, 0.46], end: 0.12, rel: true, life: [0.3, 0.45], speed: [1.8, 3.6], dir: 'sphere', up: 1.2, drag: 4, follow: 1, spin: 8, alpha: 1 },
  coinGlow: { frame: SPR.GLOW, add: 1, c0: C.coinHi, c1: C.coin, size: [0.75, 0.85], end: 1.4, life: [0.16, 0.2], speed: [0, 0], dir: 'sphere', follow: 1, alpha: 0.8 },
  dust: { frame: SPR.PUFF, add: 0, c0: C.dustHi, c1: C.white, size: [0.3, 0.46], end: 2.6, rel: true, life: [0.45, 0.75], speed: [1.4, 3.2], dir: 'ring', up: 0.6, drag: 3.5, grav: -0.8, follow: 0.85, spin: 1.5, alpha: 0.8, jitter: 0.18, fpow: 1.3 },
  dustBig: { frame: SPR.SMOKE, add: 0, c0: C.dustHi, c1: C.white, size: [0.55, 0.9], end: 2.8, rel: true, life: [0.8, 1.3], speed: [2, 5], dir: 'hemi', up: 0.8, drag: 3, grav: -0.4, follow: 0.6, spin: 1, alpha: 0.8, jitter: 0.45, fpow: 1.2 },
  ring: { frame: SPR.RING, mode: MODE.FLAT, add: 0, c0: C.dustHi, c1: C.dustHi, size: [0.35, 0.45], end: 2.6, life: [0.32, 0.38], speed: [0, 0], follow: 0.85, alpha: 0.55 },
  ringAdd: { frame: SPR.RING, mode: MODE.FLAT, add: 1, c0: C.white, c1: C.white, size: [0.35, 0.45], end: 2.6, life: [0.34, 0.4], speed: [0, 0], follow: 1, alpha: 0.9 },
  greenSpark: { frame: SPR.SPARKLE, add: 1, c0: C.greenHi, c1: C.green, size: [0.22, 0.3], end: 0.1, rel: true, life: [0.4, 0.6], speed: [2.5, 4.5], dir: 'ring', up: 2.4, drag: 3, follow: 1, spin: 7 },
  greenStreak: { frame: SPR.SPARK, mode: MODE.STRETCH, add: 1, c0: C.greenHi, c1: C.green, size: [0.07, 0.09], end: 0.05, life: [0.3, 0.4], speed: [6, 9], dir: 'up', drag: 2, grav: 9, follow: 1, stretch: 0.05 },
  flash: { frame: SPR.GLOW, add: 1, c0: C.white, c1: C.white, size: [1.6, 1.8], end: 3.6, life: [0.14, 0.18], speed: [0, 0], follow: 1, alpha: 0.95 },
  crashSpark: { frame: SPR.SPARK, mode: MODE.STRETCH, add: 1, c0: C.spark, c1: C.sparkEnd, size: [0.09, 0.14], end: 0.04, life: [0.35, 0.7], speed: [6, 12], dir: 'hemi', up: 2, drag: 1.4, grav: 14, follow: 0, stretch: 0.06 },
  debris: { frame: SPR.CHUNK, add: 0, c0: C.debris, c1: C.debris, size: [0.16, 0.3], end: 1, rel: true, life: [0.8, 1.2], speed: [3, 7], dir: 'hemi', up: 3, drag: 0.8, grav: 16, follow: 0, spin: 9, alpha: 1, fin: 0.01, fpow: 0.4 },
  starBurst: { frame: SPR.STAR, add: 0, c0: C.star, c1: C.gold, size: [0.34, 0.46], end: 0.7, rel: true, life: [0.6, 0.85], speed: [3.5, 6], dir: 'hemi', up: 3, drag: 2.5, grav: 3, follow: 0.7, spin: 7, fin: 0.02, fpow: 0.7 },
  puSpark: { frame: SPR.SPARKLE, add: 1, c0: C.white, c1: C.white, size: [0.34, 0.5], end: 0.1, rel: true, life: [0.45, 0.75], speed: [3.5, 7], dir: 'sphere', up: 0.8, drag: 4, follow: 1, spin: 9 },
  puRing: { frame: SPR.SHOCK, add: 1, c0: C.white, c1: C.white, size: [0.6, 0.7], end: 3.8, life: [0.42, 0.46], speed: [0, 0], follow: 1, alpha: 1, fpow: 1.2 },
  puGlow: { frame: SPR.GLOW, add: 1, c0: C.white, c1: C.white, size: [1.8, 2.0], end: 3.2, life: [0.25, 0.3], speed: [0, 0], follow: 1, alpha: 0.7 },
  plusUp: { frame: SPR.PLUS, add: 1, c0: C.blueHi, c1: C.blue, size: [0.25, 0.4], end: 0.1, rel: true, life: [0.6, 0.9], speed: [0.5, 1.6], dir: 'sphere', up: 2.2, drag: 2, follow: 1, spin: 3 },
  shard: { frame: SPR.SHARD, add: 0.35, c0: C.cyan, c1: C.pink, size: [0.14, 0.26], end: 0.8, rel: true, life: [0.6, 0.9], speed: [3, 7], dir: 'hemi', up: 2, drag: 1, grav: 12, follow: 0.4, spin: 12, fin: 0.01, fpow: 0.6 },
  zap: { frame: SPR.SPARK, mode: MODE.STRETCH, add: 1, c0: C.white, c1: C.cyan, size: [0.05, 0.08], end: 0.02, life: [0.2, 0.35], speed: [6, 12], dir: 'sphere', drag: 2, grav: 4, follow: 0.5, stretch: 0.05 },
  flameBurst: { frame: SPR.FLAME, mode: MODE.STRETCH, add: 1, c0: C.flameHot, c1: C.flameEnd, size: [0.2, 0.3], end: 0.5, rel: true, life: [0.25, 0.4], speed: [4, 8], dir: 'down', drag: 3, follow: 0.6, stretch: 0.06 },
  smokeBurst: { frame: SPR.SMOKE, add: 0, c0: C.smoke, c1: C.smokeDark, size: [0.4, 0.6], end: 3, rel: true, life: [0.9, 1.4], speed: [1.5, 3.5], dir: 'ring', up: -0.5, drag: 2.5, grav: -0.6, follow: 0.2, spin: 1, alpha: 0.5, jitter: 0.3, fpow: 1.3 },
  reviveSpark: { frame: SPR.SPARKLE, add: 1, c0: C.white, c1: C.cyan, size: [0.25, 0.35], end: 0.1, rel: true, life: [0.6, 0.9], speed: [4, 8], dir: 'ring', up: 3, drag: 3, follow: 1, spin: 8 },
};


export class FX {
  constructor(ctx) {
    this.ctx = ctx;
    this.quality = ctx.quality || 'high';
    this.q = QUALITY[this.quality] ?? 1;
    this.reduceMotion = false;
    this.tex = makeAtlas();
    this.world = new ParticleSystem({ capacity: CAPACITY[this.quality] ?? 2400, texture: this.tex, parent: ctx.scene, curved: true, renderOrder: 20, name: 'fx-world' });
    this.screen = new ParticleSystem({ capacity: 420, texture: this.tex, parent: ctx.camera, curved: false, depthTest: false, renderOrder: 990, name: 'fx-screen' });
    this.acc = Object.create(null);
    this.last = { x: 0, y: 0, z: 0, ok: false };
    this.t = 0;
    this.speedLines = 0;
    this.enabled = true;
    this._noz = [new THREE.Vector3(), new THREE.Vector3()];
  }

  start() {
    const E = this.ctx.events;
    const on = (ev, fn) => E.on(ev, (p) => { try { fn(p || {}); } catch (e) { console.warn('[fx]', ev, e); } });
    this._readSettings(this.ctx.meta?.settings);
    on(EV.SETTINGS, ({ settings }) => this._readSettings(settings));
    on(EV.QUALITY, ({ quality }) => { this.quality = quality; this.q = QUALITY[quality] ?? 1; });
    on(EV.STATE, ({ state }) => { if (state === 'menu' || state === 'intro') this.clear(); });
    on(EV.RUN_START, () => this.clear());
    on(EV.COIN, (p) => this.burst('coin', p));
    on(EV.JUMP, (p) => this.burst(p.super ? 'spring' : 'jump', p));
    on(EV.LAND, (p) => this.burst('land', p, { hard: p.hard, onTrain: p.onTrain }));
    on(EV.ROLL, (p) => { if (!p.airborne) this.burst('roll', p, { onTrain: this._info().onTrain }); });
    on(EV.LANE, (p) => {
      const i = this._info();
      if (i.grounded && !i.jetpack && !i.hoverboard && !i.headstart) this.burst('lane', this._player(), { dir: Math.sign((p.to ?? 0) - (p.from ?? 0)), onTrain: i.onTrain });
    });
    on(EV.STUMBLE, (p) => this.burst('stumble', p, { side: p.side }));
    on(EV.CRASH, (p) => this.burst('crash', p));
    on(EV.CAUGHT, (p) => this.burst('caught', p.x != null ? p : this._player()));
    on(EV.PICKUP, (p) => this._pickup(p));
    on(EV.POWERUP_START, ({ type }) => {
      if (type === 'jetpack') this.burst('jetIgnite', this._player());
      else if (type === 'pogo') this.burst('pogo', this._player());
    });
    on(EV.HOVERBOARD_START, () => this.burst('hoverOn', this._player()));
    on(EV.HOVERBOARD_BREAK, (p) => this.burst('hoverBreak', p.x != null ? p : this._player()));
    on(EV.HEADSTART_START, () => this.burst('headstart', this._player()));
    on(EV.REVIVE, () => this.burst('revive', this._player()));
    on(EV.MISSION_COMPLETE, () => { if (this._live()) this.burst('sparkle', this._player(), { color: C.gold, count: 14, y: 1.2 }); });
    on(EV.MISSION_SET_COMPLETE, () => this.burst('confetti', null, { count: 70 }));
    on(EV.RUN_RESULTS, (r) => { if (r.isNewBest) this.burst('confetti', null, { count: 100 }); });
  }

  _readSettings(s) {
    s = s || this.ctx.meta?.settings || {};
    this.reduceMotion = !!s.reduceMotion;
  }
  _info() { return this.ctx.game?.info || {}; }
  _player() { const i = this._info(); return { x: i.playerX || 0, y: i.playerY || 0, z: i.playerZ || 0 }; }
  _live() { const s = this._info().state; return s === 'running' || s === 'intro'; }
  _n(n) { return Math.max(1, Math.round(n * this.q)); }
  _rate(key, perSec, dt) {
    const a = (this.acc[key] || 0) + perSec * dt;
    const n = Math.floor(a);
    this.acc[key] = a - n;
    return n;
  }

  clear() {
    this.world.clear();
    this.screen.clear();
  }

  get count() { return this.world.count + this.screen.count; }

  // ------------------------------------------------------------------ generic spray
  _spray(ps, n, x, y, z, p, s = 1, c0 = null, c1 = null, ox = 0, oy = 0, oz = 0) {
    for (let k = 0; k < n; k++) {
      const i = ps.alloc();
      if (i < 0) return;
      let dx = 0, dy = 0, dz = 0;
      switch (p.dir) {
        case 'ring': { const a = rnd() * TAU; dx = Math.cos(a); dz = Math.sin(a); break; }
        case 'hemi': { const a = rnd() * TAU, u = rnd(); const r = Math.sqrt(1 - u * u); dx = Math.cos(a) * r; dy = u; dz = Math.sin(a) * r; break; }
        case 'up': { const a = rnd() * TAU, r = rnd() * 0.35; dx = Math.cos(a) * r; dy = 1; dz = Math.sin(a) * r; break; }
        case 'down': { const a = rnd() * TAU, r = rnd() * 0.35; dx = Math.cos(a) * r; dy = -1; dz = Math.sin(a) * r + 0.25; break; }
        case 'back': { const a = rnd() * TAU, r = rnd() * 0.4; dx = Math.cos(a) * r; dy = Math.sin(a) * r; dz = 1; break; }
        case 'sphere': { const a = rnd() * TAU, u = rnd() * 2 - 1; const r = Math.sqrt(1 - u * u); dx = Math.cos(a) * r; dy = u; dz = Math.sin(a) * r; break; }
        default: break;
      }
      const sp = rr(p.speed[0], p.speed[1]) * (p.speedScale === false ? 1 : Math.sqrt(s));
      const j = (p.jitter || 0) * s;
      ps.pos(i, x + (rnd() - 0.5) * 2 * j, y + (rnd() - 0.5) * j, z + (rnd() - 0.5) * 2 * j);
      ps.vel(i, dx * sp + ox, dy * sp + (p.up || 0) + oy, dz * sp + oz);
      ps.look(i, p.frame, p.mode || 0, p.add ?? 1);
      const s0 = rr(p.size[0], p.size[1]) * s;
      ps.shape(i, s0, p.rel ? s0 * p.end : p.end * s, rnd() * TAU, (rnd() - 0.5) * 2 * (p.spin || 0));
      ps.color(i, c0 || p.c0, c1 || c0 || p.c1);
      ps.fade(i, rr(p.life[0], p.life[1]), p.alpha ?? 1, p.fin ?? 0.08, p.fpow ?? 1);
      ps.phys(i, p.drag || 0, p.grav || 0, p.follow || 0, p.stretch || 0);
    }
  }

  /** Cartoon stars orbiting a point (dizzy). */
  _dizzy(x, y, z, n, life, r = 0.46) {
    const ps = this.world;
    for (let k = 0; k < n; k++) {
      const i = ps.alloc();
      if (i < 0) return;
      ps.look(i, SPR.STAR, MODE.BILL, 0);
      ps.shape(i, 0.32, 0.26, 0, 3);
      ps.color(i, C.star, C.gold);
      ps.fade(i, life, 1, 0.05, 0.6);
      ps.phys(i, 0, 0, 1, 0);
      ps.orbit(i, x, y, z, r, (k / n) * TAU, 6.5, 0.07);
      ps.pos(i, x + r, y, z);
    }
  }

  // ------------------------------------------------------------------ public: one-shot bursts
  /**
   * kind: 'coin' | 'dust' | 'jump' | 'land' | 'roll' | 'lane' | 'spring' | 'stumble' | 'crash' | 'caught' | 'powerup' | 'key'
   *     | 'mystery' | 'letter' | 'token' | 'hoverOn' | 'hoverBreak' | 'jetIgnite' | 'headstart' | 'pogo' | 'revive'
   *     | 'sparkle' | 'flash' | 'confetti'
   * pos: {x,y,z} world position (feet for player events); opts: {type, color, count, scale, hard, onTrain, dir, y}
   */
  burst(kind, pos, opts = {}) {
    if (!this.enabled) return;
    const W = this.world, n = (v) => this._n(v);
    const x = pos?.x ?? 0, y = pos?.y ?? 0, z = pos?.z ?? 0;
    const s = opts.scale ?? 1;
    const roof = opts.onTrain ? [C.roof, C.roofHi] : [C.dust, C.dustHi];
    switch (kind) {
      case 'coin': {
        const zc = Math.max(z, this._info().playerZ ?? z) + 0.6; // in front of the runner (camera side)
        this._spray(W, 1, x, y + 0.25, zc, P.coinGlow, s);
        this._spray(W, n(6), x, y + 0.25, zc, P.coinSpark, s);
        break;
      }
      case 'dust':
        this._spray(W, n(opts.count ?? 8), x, y + 0.1, z, P.dust, s, roof[0], roof[1]);
        break;
      case 'jump':
        this._spray(W, n(4), x, y + 0.05, z + 0.2, P.dust, 0.8 * s, roof[0], roof[1], 0, 0, 1.5);
        break;
      case 'land': {
        const hard = !!opts.hard;
        this._spray(W, n(hard ? 12 : 6), x, y + 0.08, z, P.dust, (hard ? 1.25 : 0.9) * s, roof[0], roof[1]);
        if (hard) this._spray(W, 1, x, y + 0.04, z, P.ring, 1.1 * s, roof[1]);
        break;
      }
      case 'roll':
        this._spray(W, n(7), x, y + 0.08, z + 0.3, P.dust, 0.9 * s, roof[0], roof[1], 0, 0, 2.5);
        break;
      case 'lane': {
        const d = opts.dir || 0;
        this._spray(W, n(5), x - d * 0.3, y + 0.08, z + 0.2, P.dust, 0.75 * s, roof[0], roof[1], -d * 2.2, 0, 1.2);
        break;
      }
      case 'spring':
        this._spray(W, 1, x, y + 0.05, z, P.ringAdd, 0.9 * s, C.greenHi, C.green);
        this._spray(W, n(12), x, y + 0.1, z, P.greenSpark, s);
        this._spray(W, n(6), x, y + 0.2, z, P.greenStreak, s);
        break;
      case 'pogo':
        this._spray(W, 1, x, y + 0.05, z, P.ringAdd, 1.2 * s, C.purpleHi, C.purple);
        this._spray(W, n(10), x, y + 0.1, z, P.greenSpark, s, C.purpleHi, C.purple);
        this._spray(W, n(6), x, y + 0.08, z, P.dust, s);
        break;
      case 'stumble':
        this._spray(W, n(8), x, y + 0.3, z, P.dust, 1.1 * s);
        this._spray(W, 1, x + (opts.side || 0) * 0.35, y + 1.0, z - 0.2, P.flash, 0.45 * s);
        this._spray(W, n(5), x + (opts.side || 0) * 0.35, y + 1.0, z - 0.2, P.crashSpark, 0.7 * s);
        this._dizzy(x, y + 1.95, z, 3, 1.2, 0.36);
        break;
      case 'crash':
        this._spray(W, 1, x, y + 1.1, z + 0.3, P.flash, 1.2 * s);
        this._spray(W, n(22), x, y + 1.0, z + 0.2, P.crashSpark, s, null, null, 0, 0, 2);
        this._spray(W, n(10), x, y + 0.9, z + 0.3, P.debris, s, null, null, 0, 0, 1.5);
        this._spray(W, n(14), x, y + 0.4, z + 0.4, P.dustBig, s);
        this._spray(W, n(6), x, y + 1.3, z + 0.3, P.starBurst, s);
        this._dizzy(x, y + 2.0, z, 5, 2.4, 0.5);
        break;
      case 'caught':
        this._spray(W, n(18), x, y + 0.6, z + 0.4, P.dustBig, 1.1 * s);
        this._spray(W, n(4), x, y + 1.3, z, P.starBurst, 0.9 * s);
        this._dizzy(x, y + 1.95, z, 4, 2.0);
        break;
      case 'powerup': {
        const c = opts.color || PU_COLOR[opts.type] || C.gold;
        const zc = z + 0.5;
        this._spray(W, 1, x, y, zc, P.puGlow, s, c);
        this._spray(W, 1, x, y, zc, P.puRing, s, C.white, c);
        this._spray(W, n(22), x, y, zc, P.puSpark, s, C.white, c);
        break;
      }
      case 'key':
        this._spray(W, 1, x, y, z, P.puGlow, 0.9 * s, C.blueHi, C.blue);
        this._spray(W, 1, x, y, z, P.puRing, 0.8 * s, C.white, C.blue);
        this._spray(W, n(12), x, y, z, P.plusUp, s);
        break;
      case 'mystery':
        this._spray(W, 1, x, y, z, P.puGlow, s, C.violet);
        this._spray(W, n(14), x, y, z, P.puSpark, s, C.white, C.violet);
        this._spray(W, n(6), x, y, z, P.puSpark, s, C.white, C.gold);
        this._spray(W, n(5), x, y + 0.2, z, P.starBurst, 0.8 * s);
        break;
      case 'letter':
      case 'token':
        this._spray(W, 1, x, y, z, P.coinGlow, 1.3 * s, kind === 'letter' ? C.pink : C.lime);
        this._spray(W, n(12), x, y, z, P.coinSpark, 1.2 * s, C.white, kind === 'letter' ? C.pink : C.lime);
        break;
      case 'hoverOn':
        this._spray(W, 1, x, y + 0.08, z, P.ringAdd, 1.1 * s, C.white, C.pink);
        this._spray(W, n(14), x, y + 0.2, z, P.zap, s, C.white, C.pink);
        this._spray(W, 1, x, y + 0.4, z, P.flash, 0.6 * s, C.pink);
        break;
      case 'hoverBreak':
        this._spray(W, 1, x, y + 0.5, z, P.flash, 0.9 * s, C.cyan);
        this._spray(W, n(14), x, y + 0.25, z, P.shard, s);
        this._spray(W, n(12), x, y + 0.3, z, P.zap, s);
        this._spray(W, n(6), x, y + 0.1, z, P.dust, s);
        break;
      case 'jetIgnite':
        this._spray(W, n(12), x, y + 0.9, z + 0.35, P.flameBurst, s);
        this._spray(W, n(10), x, y + 0.4, z + 0.4, P.smokeBurst, s);
        this._spray(W, 1, x, y + 0.8, z + 0.35, P.flash, 0.7 * s, C.flame);
        break;
      case 'headstart':
        this._spray(W, 1, x, y + 0.8, z, P.puRing, 1.6 * s, C.white, C.orange);
        this._spray(W, n(20), x, y + 0.9, z + 0.35, P.flameBurst, 1.3 * s);
        this._spray(W, n(16), x, y + 0.4, z + 0.5, P.smokeBurst, 1.2 * s);
        this._spray(W, 1, x, y + 0.8, z, P.flash, 1.2 * s, C.flameHot);
        break;
      case 'revive': {
        const r1 = W.alloc();
        if (r1 >= 0) {
          W.pos(r1, x, y + 0.06, z); W.look(r1, SPR.SHOCK, MODE.FLAT, 1); W.shape(r1, 0.6 * s, 11 * s);
          W.color(r1, C.white, C.cyan); W.fade(r1, 0.75, 1, 0.02, 1.4); W.phys(r1, 0, 0, 1);
        }
        this._spray(W, 1, x, y + 1, z, P.puRing, 1.5 * s, C.white, C.cyan);
        this._spray(W, 1, x, y + 1, z, P.flash, 1.1 * s, C.blueHi);
        this._spray(W, n(26), x, y + 0.3, z, P.reviveSpark, s);
        for (let k = 0, m = n(12); k < m; k++) {
          const i = W.alloc();
          if (i < 0) break;
          W.look(i, SPR.SPARKLE, MODE.BILL, 1); W.shape(i, 0.3, 0.05, 0, 6);
          W.color(i, C.white, C.cyan); W.fade(i, 1.0, 1, 0.05, 1); W.phys(i, 0, 0, 1);
          W.orbit(i, x, y + 0.1, z, 0.85, (k / m) * TAU, 7, 0); W.vel(i, 0, 2.2, 0); W.pos(i, x, y, z);
        }
        break;
      }
      case 'sparkle': {
        const c = opts.color || C.gold;
        this._spray(W, n(opts.count ?? 10), x, y + (opts.y ?? 0), z, P.coinSpark, 1.3 * s, C.white, c);
        break;
      }
      case 'flash':
        this._spray(W, 1, x, y, z, P.flash, s, opts.color || C.white);
        break;
      case 'confetti':
        this._confetti(Math.round((opts.count ?? 80) * (this.reduceMotion ? 0.4 : 1) * Math.max(0.6, this.q)));
        break;
      default:
        break;
    }
  }

  _pickup(p) {
    const t = p.type;
    if (POWERUPS[t] || t === 'hoverboardItem') this.burst('powerup', p, { type: t });
    else if (t === 'key') this.burst('key', p);
    else if (t === 'mysteryBox') this.burst('mystery', p);
    else if (t === 'letter' || t === 'token') this.burst(t, p);
    else this.burst('sparkle', p);
  }

  // ------------------------------------------------------------------ screen layer
  _halfH(d) { const cam = this.ctx.camera; return d * Math.tan(((cam.fov || 62) * Math.PI) / 360); }

  _confetti(count) {
    const S = this.screen, cam = this.ctx.camera, asp = cam.aspect || 1.6;
    const d = 5, hh = this._halfH(d), hw = hh * asp;
    for (let k = 0; k < count; k++) {
      const i = S.alloc();
      if (i < 0) return;
      const side = k % 2 ? 1 : -1;
      // two cannons from the bottom corners, aimed up and inward
      S.pos(i, side * hw * rr(0.75, 1.0), -hh * rr(0.85, 1.05), -d + rr(-0.6, 0.6));
      const a = rr(0.25, 0.75), sp = rr(5.5, 9.5) * (hh / 3);
      S.vel(i, -side * Math.cos(a) * sp * 0.55, Math.sin(a) * sp + rr(1, 3), rr(-0.4, 0.4));
      S.look(i, SPR.CONFETTI, MODE.FLIP, 0);
      S.shape(i, rr(0.13, 0.2) * (hh / 3), undefined, rnd() * TAU, rr(-9, 9));
      S.s1[i] = S.s0[i];
      S.color(i, pick(CONFETTI));
      S.fade(i, rr(2.2, 3.2), 1, 0.01, 0.35);
      S.phys(i, 1.1, 5.5 * (hh / 3), 0, 0);
    }
  }

  _speedLines(dt, info, live) {
    let target = 0;
    if (live && !this.reduceMotion) {
      if (info.headstart) target = 1;
      else if (info.jetpack) target = 0.7;
      else target = Math.max(0, Math.min(0.45, ((info.speed || 0) - 23) / 12));
    }
    this.speedLines += (target - this.speedLines) * (1 - Math.exp(-4 * dt));
    const k = this.speedLines;
    if (k < 0.03) return;
    const S = this.screen, cam = this.ctx.camera, asp = cam.aspect || 1.6;
    const m = this._rate('lines', 95 * k * (0.5 + 0.5 * this.q), dt);
    for (let j = 0; j < m; j++) {
      const i = S.alloc();
      if (i < 0) return;
      const d = rr(16, 42), a = rnd() * TAU;
      const R = this._halfH(d) * rr(0.62, 1.2);
      const V = rr(95, 135);
      S.pos(i, Math.cos(a) * R * asp, Math.sin(a) * R, -d);
      S.vel(i, 0, 0, V);
      S.look(i, SPR.LINE, MODE.STRETCH, 1);
      S.shape(i, d * rr(0.0045, 0.0075));
      S.color(i, C.white);
      S.fade(i, (d - 2) / V, 0.5 * k, 0.25, 0.4);
      S.phys(i, 0, 0, 0, 0.8);
    }
  }

  // ------------------------------------------------------------------ continuous emitters
  _anchor(name) {
    const rig = this.ctx.game?.rig;
    const a = rig?.anchors?.[name];
    if (!a) return null;
    a.updateWorldMatrix(true, false);
    return a;
  }

  _jet(dt, info, rocket) {
    const W = this.world;
    const jl = this._anchor('jetL'), jr = this._anchor('jetR');
    const back = jl && jr ? null : this._anchor('back');
    const noz = this._noz;
    if (jl && jr) { jl.getWorldPosition(noz[0]); jr.getWorldPosition(noz[1]); }
    else if (back) { back.localToWorld(noz[0].set(-0.15, -0.28, 0.06)); back.localToWorld(noz[1].set(0.15, -0.28, 0.06)); }
    else { noz[0].set(info.playerX - 0.15, info.playerY + 0.9, info.playerZ + 0.35); noz[1].set(info.playerX + 0.15, info.playerY + 0.9, info.playerZ + 0.35); }
    const boost = rocket ? 1.6 : 1;
    const nf = this._rate('flame', 150 * this.q * boost, dt);
    const ns = this._rate('smoke', 40 * this.q * boost, dt);
    for (let k = 0; k < nf; k++) {
      const p = noz[k % noz.length];
      const i = W.alloc();
      if (i < 0) break;
      W.pos(i, p.x + rr(-0.04, 0.04), p.y - 0.05, p.z + rr(-0.04, 0.04));
      W.vel(i, rr(-0.5, 0.5), -rr(7, 10) * boost, rr(1.5, 3));
      W.look(i, SPR.FLAME, MODE.STRETCH, 1);
      W.shape(i, rr(0.2, 0.28) * boost, 0.1 * boost);
      W.color(i, rnd() < 0.2 ? C.flameHot : C.flame, C.flameEnd);
      W.fade(i, rr(0.12, 0.2), 0.8, 0.05, 0.7);
      W.phys(i, 3, 0, 1, 0.24);
    }
    for (let k = 0; k < ns; k++) {
      const p = noz[k % noz.length];
      const i = W.alloc();
      if (i < 0) break;
      W.pos(i, p.x + rr(-0.05, 0.05), p.y - 0.55 * boost, p.z + rr(0, 0.2));
      W.vel(i, rr(-0.8, 0.8), -rr(2, 3.5), rr(-0.5, 0.5));
      W.look(i, SPR.SMOKE, MODE.BILL, 0);
      W.shape(i, rr(0.35, 0.5) * boost, rr(1.6, 2.4) * boost, rnd() * TAU, rr(-1, 1));
      W.color(i, C.smoke, C.smokeDark);
      W.fade(i, rr(0.7, 1.1), 0.5, 0.12, 1.2);
      W.phys(i, 1.5, -0.8, 0.55, 0);
    }
    // nozzle glow flicker
    for (let k = 0; k < noz.length; k++) {
      const p = noz[k];
      const i = W.alloc();
      if (i < 0) break;
      W.pos(i, p.x, p.y - 0.12, p.z + 0.02);
      W.look(i, SPR.GLOW, MODE.BILL, 1);
      W.shape(i, rr(0.5, 0.65) * boost, 0.35 * boost);
      W.color(i, C.flameHot, C.flame);
      W.fade(i, 0.05, 0.8, 0.01, 1);
      W.phys(i, 0, 0, 1, 0);
    }
  }

  _hover(dt, info) {
    const W = this.world;
    const x = info.playerX, y = info.playerY, z = info.playerZ;
    if (this._rate('hoverPad', 30, dt) > 0) {
      const i = W.alloc();
      if (i >= 0) {
        W.pos(i, x, y + 0.03, z); W.look(i, SPR.GLOW, MODE.FLAT, 1); W.shape(i, 1.9, 2.1, 0, 0);
        W.color(i, C.pink, C.cyan); W.fade(i, 0.1, 0.7, 0.3, 1); W.phys(i, 0, 0, 1, 0);
      }
    }
    const ng = this._rate('hoverGlow', 50 * this.q, dt);
    for (let k = 0; k < ng; k++) {
      const i = W.alloc();
      if (i < 0) break;
      const c = k % 2 ? C.pink : C.cyan;
      W.pos(i, x + (k % 2 ? -0.22 : 0.22) + rr(-0.06, 0.06), y + 0.12, z + rr(0.55, 0.8));
      W.vel(i, rr(-0.3, 0.3), rr(-0.1, 0.4), rr(1, 2.5));
      W.look(i, SPR.GLOW, MODE.BILL, 1);
      W.shape(i, rr(0.4, 0.55), 0.06);
      W.color(i, c, c);
      W.fade(i, rr(0.28, 0.42), 0.95, 0.05, 1);
      W.phys(i, 1, 0, 0.6, 0);
    }
    const nsp = this._rate('hoverSpark', 12 * this.q, dt);
    for (let k = 0; k < nsp; k++) {
      const i = W.alloc();
      if (i < 0) break;
      W.pos(i, x + rr(-0.3, 0.3), y + 0.08, z + 0.6);
      W.vel(i, rr(-1.5, 1.5), rr(1, 3), rr(1, 3));
      W.look(i, SPR.SPARK, MODE.STRETCH, 1);
      W.shape(i, 0.05, 0.02);
      W.color(i, C.white, C.cyan);
      W.fade(i, rr(0.2, 0.35), 1, 0.02, 1);
      W.phys(i, 1, 9, 0.5, 0.05);
    }
  }

  _magnet(dt, info) {
    const W = this.world;
    const x = info.playerX, y = info.playerY, z = info.playerZ;
    if (this._rate('magRing', 2.4, dt) > 0) {
      const i = W.alloc();
      if (i >= 0) {
        W.pos(i, x, y + 0.06, z); W.look(i, SPR.SHOCK, MODE.FLAT, 1); W.shape(i, 0.6, 2.8);
        W.color(i, C.magnetHi, C.magnet); W.fade(i, 0.6, 0.85, 0.05, 1.1); W.phys(i, 0, 0, 1, 0);
      }
    }
    if (this._rate('magAura', 12, dt) > 0) {
      const i = W.alloc();
      if (i >= 0) {
        W.pos(i, x, y + 0.95, z + 0.1); W.look(i, SPR.GLOW, MODE.BILL, 1); W.shape(i, 2.0, 2.3);
        W.color(i, C.magnet, C.magnet); W.fade(i, 0.16, 0.32, 0.4, 1); W.phys(i, 0, 0, 1, 0);
      }
    }
    const ns = this._rate('magSwirl', 40 * this.q, dt);
    for (let k = 0; k < ns; k++) {
      const i = W.alloc();
      if (i < 0) break;
      const dir = k % 2 ? 1 : -1;
      W.look(i, k % 3 ? SPR.SPARKLE : SPR.GLOW, MODE.BILL, 1);
      W.shape(i, rr(0.22, 0.34), 0.06, 0, 5);
      W.color(i, C.white, C.magnet);
      W.fade(i, rr(0.4, 0.6), 0.95, 0.1, 1);
      W.phys(i, 0, 0, 1, 0);
      W.orbit(i, x, y + rr(0.25, 1.1), z, rr(0.6, 0.85), rnd() * TAU, 7.5 * dir, 0.05);
      W.vel(i, 0, rr(0.6, 1.4), 0);
      W.pos(i, x, y + 0.5, z);
    }
  }

  _sneakers(dt, info) {
    const W = this.world;
    const n = this._rate('sneak', 11 * this.q, dt);
    for (let k = 0; k < n; k++) {
      const i = W.alloc();
      if (i < 0) break;
      W.pos(i, info.playerX + rr(-0.22, 0.22), info.playerY + 0.08, info.playerZ + rr(0, 0.35));
      W.vel(i, rr(-0.6, 0.6), rr(0.8, 1.8), rr(0.5, 1.5));
      W.look(i, SPR.SPARKLE, MODE.BILL, 1);
      W.shape(i, rr(0.14, 0.2), 0.03, rnd() * TAU, 6);
      W.color(i, C.greenHi, C.green);
      W.fade(i, rr(0.3, 0.45), 1, 0.05, 1);
      W.phys(i, 2, 0, 0.7, 0);
    }
  }

  _multiplier(dt, info) {
    const W = this.world;
    const n = this._rate('mult', 4.5 * this.q, dt);
    for (let k = 0; k < n; k++) {
      const i = W.alloc();
      if (i < 0) break;
      const a = rnd() * TAU;
      W.pos(i, info.playerX + Math.cos(a) * 0.45, info.playerY + rr(1.5, 2.0), info.playerZ + Math.sin(a) * 0.3);
      W.vel(i, 0, rr(0.6, 1.2), 0);
      W.look(i, SPR.PLUS, MODE.BILL, 1);
      W.shape(i, rr(0.16, 0.24), 0.02, 0, 2);
      W.color(i, C.white, C.gold);
      W.fade(i, rr(0.5, 0.7), 0.9, 0.15, 1);
      W.phys(i, 1, 0, 1, 0);
    }
  }

  // ------------------------------------------------------------------ frame
  update(dt, info) {
    if (!info) return;
    // player displacement since last frame (particles with `follow` ride along with the runner)
    let fx = 0, fy = 0, fz = 0;
    const L = this.last;
    if (L.ok) {
      fx = info.playerX - L.x; fy = info.playerY - L.y; fz = info.playerZ - L.z;
      if (Math.abs(fx) + Math.abs(fy) + Math.abs(fz) > 12) fx = fy = fz = 0; // teleport (reset / new run)
    }
    L.x = info.playerX || 0; L.y = info.playerY || 0; L.z = info.playerZ || 0; L.ok = true;
    if (!(dt > 0)) return; // frozen (paused / countdown)
    this.t += dt;
    const live = info.state === 'running' || info.state === 'intro';
    if (live) {
      if (info.jetpack || info.headstart) this._jet(dt, info, !!info.headstart);
      if (info.hoverboard) this._hover(dt, info);
      if (info.magnet) this._magnet(dt, info);
      if (info.sneakers && info.grounded) this._sneakers(dt, info);
      if (info.multiplier) this._multiplier(dt, info);
    }
    this._speedLines(dt, info, live);
    this.world.update(dt, fx, fy, fz);
    this.screen.update(dt);
  }

  dispose() {
    this.world.dispose();
    this.screen.dispose();
    this.tex.dispose();
  }
}
