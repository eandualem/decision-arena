// Chunk generator: strings hand-authored patterns (patterns.js) together, picks them by difficulty tier,
// randomly permutes / mirrors their lanes, spaces them by tier + speed, and schedules pickups
// (power-ups, mystery boxes, keys, letters, tokens) into the pattern's reachable slots.
// Pure JS (no THREE / DOM): the node validator drives exactly this code.
import { RNG } from '../core/rng.js';
import { PATTERNS, ChunkBuilder } from './patterns.js';
import { tierAt, nominalSpeedAt, COIN_SPACING } from './layout.js';

const POWER_WEIGHTS = [['magnet', 3], ['jetpack', 2], ['sneakers', 2.2], ['multiplier', 2], ['pogo', 1.2]];
// seconds of free running inserted after a chunk, per tier [min, max]
const GAP_T = [[1.75, 2.35], [1.05, 1.5], [0.82, 1.15], [0.64, 0.9]];
const LIVERIES = 5;

export class Generator {
  constructor() {
    this.b = new ChunkBuilder();
    this.rng = new RNG(1);
  }

  /**
   * @param {object} o
   *   seed, startD (first distance that may hold content), speedAt(d) -> design speed,
   *   plan {letters, tokens}, tier (force a tier, validator), patterns (restrict ids, validator)
   */
  reset(o = {}) {
    const r = (this.rng = new RNG(o.seed ?? 12345));
    this.speedAt = o.speedAt || nominalSpeedAt;
    this.cursor = o.startD ?? 40;
    this.forceTier = o.tier ?? null;
    this.only = o.patterns || null;
    this.recent = [];
    this.chunkNo = 0;
    const plan = o.plan || { letters: [], tokens: false };
    // pickup schedule (absolute distances)
    const base = Math.max(0, this.cursor - 40);
    this.nextPower = base + r.range(150, 230);
    this.nextBox = base + r.range(700, 1150);
    this.nextKey = base + r.range(1400, 2300);
    this.letters = (plan.letters || []).slice(0, 2);
    this.nextLetter = Math.max(260, base + r.range(270, 520));
    this.tokens = !!plan.tokens;
    this.nextToken = base + r.range(330, 600);
    this.noPickups = !!o.noPickups;
  }

  _choose(tier, d) {
    const r = this.rng;
    const items = [];
    for (const p of PATTERNS) {
      if (this.only && !this.only.includes(p.id)) continue;
      if (d < p.minD) continue;
      let w = p.w[tier];
      if (!(w > 0)) continue;
      const k = this.recent.indexOf(p.id);
      if (k === 0) w *= 0.12; else if (k > 0) w *= 0.45;
      items.push([p, w]);
    }
    if (!items.length) return PATTERNS.find((p) => p.id === 'breather');
    return r.weighted(items);
  }

  /** Build the next chunk. Returns absolute (d-space) content. */
  next() {
    const r = this.rng;
    const d0 = this.cursor;
    const tier = this.forceTier ?? tierAt(d0);
    const v = this.speedAt(d0);
    const pat = this._choose(tier, d0);
    const b = this.b.begin(r, tier, v, d0);
    pat.build(b);
    this.recent.unshift(pat.id);
    if (this.recent.length > 3) this.recent.length = 3;

    const chunk = {
      no: this.chunkNo++, id: pat.id, tier, v, d0, d1: d0 + b.len,
      statics: [], movings: [], coins: [], pickups: [],
    };
    for (const s of b.statics) {
      chunk.statics.push({
        kind: s.kind, lane: s.lane, dNear: s.dNear + d0, dFar: s.dFar + d0, cars: s.cars || 0, ramp: !!s.ramp,
        liv: r.int(0, LIVERIES - 1), seed: (r.next() * 1e9) | 0,
      });
    }
    for (const m of b.movings) {
      chunk.movings.push({
        kind: 'train', moving: true, lane: m.lane, cars: m.cars, len: m.len, dMeet: m.dMeet + d0, vt: m.vt,
        clear0: m.clear0 + d0, clear1: m.clear1 + d0, liv: r.int(0, LIVERIES - 1), seed: (r.next() * 1e9) | 0,
      });
    }
    for (const c of b.coins) chunk.coins.push({ x: c.x, d: c.d + d0, y: c.y });
    if (!this.noPickups) this._placePickups(chunk, b.slots.map((s) => ({ ...s, d: s.d + d0 })));

    const [g0, g1] = GAP_T[tier];
    const gap = Math.max(12, r.range(g0, g1) * v + 2);
    this.cursor = chunk.d1 + gap;
    // occasionally a short coin line in the gap (never across the next chunk start)
    if (tier <= 1 && r.chance(0.35) && gap > 18) {
      const lane = r.pick([-1, 0, 1]);
      for (let d = chunk.d1 + 5; d < this.cursor - 6; d += COIN_SPACING) chunk.coins.push({ x: lane * 2.6, d, y: 0.9 });
    }
    chunk.gapEnd = this.cursor;
    return chunk;
  }

  _placePickups(chunk, slots) {
    const r = this.rng;
    if (!slots.length) return;
    const end = chunk.d1;
    // everything that is due, most overdue first (power-ups get a head start so rare items never starve them)
    const due = [];
    if (this.nextPower <= end) due.push(['power', end - this.nextPower + 60]);
    if (this.nextKey <= end) due.push(['key', end - this.nextKey]);
    if (this.letters.length && this.nextLetter <= end && chunk.d0 > 250) due.push(['letter', end - this.nextLetter]);
    if (this.tokens && this.nextToken <= end) due.push(['token', end - this.nextToken]);
    if (this.nextBox <= end) due.push(['mysteryBox', end - this.nextBox]);
    due.sort((a, b) => b[1] - a[1]);
    const take = (preferRoof) => {
      let i = -1;
      if (preferRoof) i = slots.findIndex((s) => s.roof);
      if (i < 0) i = r.int(0, slots.length - 1);
      return slots.splice(i, 1)[0];
    };
    const put = (type, s, extra) => chunk.pickups.push({ type, x: s.lane * 2.6, lane: s.lane, d: s.d, y: s.y, ...extra });
    for (const [what] of due) {
      if (!slots.length) break;
      if (what === 'power') { put(r.weighted(POWER_WEIGHTS), take(r.chance(0.6))); this.nextPower = Math.max(this.nextPower, chunk.d0) + r.range(150, 300); }
      else if (what === 'key') { put('key', take(true)); this.nextKey = Math.max(this.nextKey, chunk.d0) + r.range(1500, 2500); }
      else if (what === 'letter') { put('letter', take(false), { letter: this.letters.shift() }); this.nextLetter = Math.max(this.nextLetter, chunk.d0) + r.range(550, 1100); }
      else if (what === 'token') { put('token', take(false)); this.nextToken = Math.max(this.nextToken, chunk.d0) + r.range(400, 700); }
      else if (what === 'mysteryBox') { put('mysteryBox', take(false)); this.nextBox = Math.max(this.nextBox, chunk.d0) + r.range(800, 1500); }
    }
  }
}
