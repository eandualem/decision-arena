// Seedable RNG (mulberry32) with helpers. new RNG(seed) or RNG.random() for a time-seeded one.
export class RNG {
  constructor(seed = (Math.random() * 2 ** 32) >>> 0) { this.seed(seed); }
  static random() { return new RNG(); }
  seed(s) { this._s = (s >>> 0) || 0x9e3779b9; this.initialSeed = this._s; return this; }
  next() { // [0, 1)
    let t = (this._s = (this._s + 0x6d2b79f5) >>> 0);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + (b - a) * this.next(); }
  int(a, b) { return Math.floor(this.range(a, b + 1)); } // inclusive
  chance(p) { return this.next() < p; }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  sign() { return this.next() < 0.5 ? -1 : 1; }
  shuffle(arr) { for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(this.next() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; } return arr; }
  /** items: [{w: weight, ...}] or [[item, weight], ...] -> item */
  weighted(items) {
    const isPair = Array.isArray(items[0]);
    let total = 0; for (const it of items) total += isPair ? it[1] : it.w;
    let r = this.next() * total;
    for (const it of items) { r -= isPair ? it[1] : it.w; if (r <= 0) return isPair ? it[0] : it; }
    return isPair ? items[items.length - 1][0] : items[items.length - 1];
  }
}
