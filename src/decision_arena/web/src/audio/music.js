// Rail Dash music player (AUDIOFX): sample-accurate lookahead sequencer over the compiled songs.
//   music.play('menu' | 'run' | null)  crossfades tracks
//   music.schedule(horizon)            schedules every step whose time < horizon (called ~every frame + a timer)
//   music.setIntensity(0..1)           run-track layers: 1 groove (always in runs), 2 energy (~0.55+), 3 peak (~0.88+)
//   music.stinger('gameover')          short original jingle on the music bus
import { SONGS } from './songs.js';
import { INSTRUMENTS, Echo } from './instruments.js';
import { mtof, getWave } from './engine.js';

const LAYERS = 4;

class TrackPlayer {
  /** opts (tests): { startBar, solo: Set of instrument ids } */
  constructor(E, song, t0, opts = {}) {
    this.E = E;
    this.song = song;
    this.name = song.name;
    this.sd = 60 / song.bpm / 4;
    this.swing = song.swing * this.sd;
    this.bus = E.gain(0, E.musicIn);
    this.wet = E.gain(0, E.musicRev);
    this.layers = [];
    this.layerWet = [];
    this.layerTarget = [];
    this.layerOffAt = [];
    for (let i = 0; i < LAYERS; i++) {
      const on = i <= 1 ? 1 : 0;
      this.layers.push(E.gain(on, this.bus));
      this.layerWet.push(E.gain(on, this.wet));
      this.layerTarget.push(on);
      this.layerOffAt.push(on ? Infinity : -1e9);
    }
    const beat = 60 / song.bpm;
    this.echo = new Echo(E, this.bus, song.echo.beats * beat, song.echo.fb, song.echo.cut);
    this.inst = {};
    for (const [id, d] of Object.entries(song.instruments)) {
      if (opts.solo && !opts.solo.has(id)) continue;
      const Cls = INSTRUMENTS[d.type];
      const L = Math.min(LAYERS - 1, d.layer || 0);
      const inst = new Cls(E, { out: this.layers[L], wet: this.layerWet[L], echo: this.echo.input }, d.cfg || {}, t0);
      inst.layer = L;
      this.inst[id] = inst;
    }
    this.barIdx = Math.max(0, Math.min(song.bars.length - 1, opts.startBar | 0));
    this.solo = opts.solo || null;
    this.step = 0;
    this.barTime = t0;
    this.t0 = t0;
    this.dead = false;
  }

  fade(level, t, tc) {
    const g = level * this.song.gain;
    this.bus.gain.setTargetAtTime(g, t, tc);
    this.wet.gain.setTargetAtTime(g, t, tc);
  }

  setLayer(i, level, now) {
    if (Math.abs(this.layerTarget[i] - level) < 0.02) return;
    this.layerTarget[i] = level;
    this.layerOffAt[i] = level > 0.001 ? Infinity : now;
    const tc = level > this.layers[i].gain.value ? 0.5 : 0.9;
    this.layers[i].gain.setTargetAtTime(level, now, tc);
    this.layerWet[i].gain.setTargetAtTime(level, now, tc);
  }

  schedule(until) {
    const E = this.E, sd = this.sd, bars = this.song.bars;
    const now = E.ac.currentTime;
    // stalled (tab throttled, long frame): skip ahead instead of dumping a burst of late notes
    if (this.barTime + this.step * sd < now - 0.12) {
      while (this.barTime + this.step * sd < now) this._advance();
    }
    let guard = 0;
    while (this.barTime + this.step * sd < until && guard++ < 256) {
      const bar = bars[this.barIdx];
      const evs = bar.steps[this.step];
      for (let k = 0; k < evs.length; k++) {
        const ev = evs[k];
        const inst = this.inst[ev.i];
        if (!inst || (this.solo && !this.solo.has(ev.i))) continue;
        const stepT = this.barTime + this.step * sd;
        if (this.layerTarget[inst.layer] <= 0.001 && stepT > this.layerOffAt[inst.layer] + 2.5) continue;
        const t = this.barTime + ev.s * sd + ((Math.floor(ev.s) & 1) ? this.swing : 0);
        if (t < now - 0.01) continue;
        try { inst.play(Math.max(t, now), ev, sd); } catch (e) { if (!this._warned) { this._warned = true; console.warn('[audio] note failed', ev.i, e); } }
      }
      this._advance();
    }
  }

  _advance() {
    this.step++;
    if (this.step >= 16) {
      this.step = 0;
      this.barTime += 16 * this.sd;
      this.barIdx++;
      if (this.barIdx >= this.song.bars.length) this.barIdx = this.song.loopBar;
    }
  }

  /** Current position (for tests / debug): section name + bar */
  get position() { const b = this.song.bars[this.barIdx]; return `${b.section}:${b.bar}`; }

  stop(t) {
    if (this.dead) return;
    this.dead = true;
    for (const inst of Object.values(this.inst)) { try { inst.stop(t); } catch { /* */ } }
    this.fade(0, t, 0.05);
  }

  disconnect() {
    try { this.bus.disconnect(); this.wet.disconnect(); } catch { /* */ }
  }
}

export class Music {
  constructor(E) {
    this.E = E;
    this.cur = null;
    this.dying = [];
    this.intensity = 0.4;
    this.boost = 0;
  }

  get track() { return this.cur ? this.cur.name : null; }

  /** Crossfade to a track ('menu' | 'run' | null). opts: {restart, fadeIn (time constant s), at (start time)} */
  play(name, opts = {}) {
    const E = this.E;
    if (this.cur && this.cur.name === name && !opts.restart) return;
    const now = E.ac.currentTime;
    if (this.cur) {
      const old = this.cur;
      old.fade(0, now, opts.fadeOut ?? 0.22);
      old.killAt = now + (opts.fadeOut ?? 0.22) * 7;
      this.dying.push(old);
    }
    this.cur = null;
    if (!name || !SONGS[name]) return;
    const t0 = Math.max(now + 0.06, opts.at ?? 0);
    const tp = new TrackPlayer(E, SONGS[name], t0, opts);
    const tc = opts.fadeIn ?? 0.02;
    tp.bus.gain.setValueAtTime(0, now);
    tp.wet.gain.setValueAtTime(0, now);
    tp.fade(1, t0, tc);
    this.cur = tp;
    this._applyLayers(true);
  }

  setIntensity(x, boost = 0) {
    this.intensity = Math.max(0, Math.min(1, x));
    this.boost = boost;
    this._applyLayers(false);
  }

  _applyLayers() {
    const tp = this.cur;
    if (!tp) return;
    const now = this.E.ac.currentTime;
    if (tp.name !== 'run') { for (let i = 0; i < LAYERS; i++) tp.setLayer(i, 1, now); return; }
    const x = Math.max(this.intensity, this.boost);
    const ramp = (a, b) => Math.max(0, Math.min(1, (x - a) / (b - a)));
    tp.setLayer(0, 1, now);
    tp.setLayer(1, x >= 0.2 ? 1 : ramp(0.1, 0.2), now);
    tp.setLayer(2, Math.round(ramp(0.5, 0.6) * 20) / 20, now);
    tp.setLayer(3, Math.round(ramp(0.84, 0.92) * 20) / 20, now);
  }

  schedule(horizon) {
    const now = this.E.ac.currentTime;
    if (this.cur) this.cur.schedule(horizon);
    for (let i = this.dying.length - 1; i >= 0; i--) {
      const tp = this.dying[i];
      if (now >= tp.killAt) {
        tp.stop(now);
        const d = tp;
        if (!this.E.offline) setTimeout(() => d.disconnect(), 800);
        this.dying.splice(i, 1);
      } else tp.schedule(Math.min(horizon, tp.killAt));
    }
  }

  /** Stop everything immediately (context teardown / offline tests). */
  stopAll(t = this.E.ac.currentTime) {
    if (this.cur) { this.cur.stop(t); this.cur = null; }
    for (const tp of this.dying) tp.stop(t);
    this.dying.length = 0;
  }

  // ------------------------------------------------------------------ stingers
  /** 'gameover': descending A-minor run into a sighing Am(add9) with a bass "womp" (~2.4 s). */
  stinger(name, t = this.E.ac.currentTime + 0.03) {
    const E = this.E, ac = E.ac;
    const bus = E.gain(1, E.musicIn);
    const wet = E.gain(0.3, E.musicRev);
    bus.connect(wet);
    const lp = E.filter('lowpass', 2600, 0.8, bus);
    const lead = getWave(ac, 'lead');
    const sd = 60 / 116 / 4;
    if (name === 'gameover') {
      const line = [[76, 0], [74, 1], [72, 2], [71, 3]];
      for (const [n, s] of line) E.tone(lp, { wave: lead, f: mtof(n), t: t + s * sd, a: 0.006, hold: sd * 0.6, d: 0.16, peak: 0.13 });
      const tl = t + 4 * sd;
      // final long A4 with a slow droop and vibrato
      const o = ac.createOscillator();
      o.setPeriodicWave(lead);
      o.frequency.setValueAtTime(mtof(69), tl);
      o.frequency.setValueAtTime(mtof(69), tl + 0.55);
      o.frequency.exponentialRampToValueAtTime(mtof(68), tl + 1.2);
      const vib = ac.createOscillator();
      vib.frequency.value = 5.2;
      const vg = E.gain(0);
      vg.gain.setValueAtTime(0, tl);
      vg.gain.linearRampToValueAtTime(18, tl + 0.5);
      vib.connect(vg);
      vg.connect(o.detune);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, tl);
      g.gain.linearRampToValueAtTime(0.14, tl + 0.02);
      g.gain.setTargetAtTime(0.09, tl + 0.05, 0.3);
      g.gain.setTargetAtTime(0, tl + 1.0, 0.18);
      o.connect(g);
      g.connect(lp);
      o.start(tl); vib.start(tl);
      o.stop(tl + 2); vib.stop(tl + 2);
      // bass womp A2 -> G#2
      const b = ac.createOscillator();
      b.type = 'sawtooth';
      b.frequency.setValueAtTime(mtof(45), tl);
      b.frequency.setValueAtTime(mtof(45), tl + 0.6);
      b.frequency.exponentialRampToValueAtTime(mtof(43.5), tl + 1.3);
      const bf = E.filter('lowpass', 700, 3, bus);
      bf.frequency.setValueAtTime(1400, tl);
      bf.frequency.exponentialRampToValueAtTime(260, tl + 1.3);
      const bg = ac.createGain();
      bg.gain.setValueAtTime(0, tl);
      bg.gain.linearRampToValueAtTime(0.28, tl + 0.01);
      bg.gain.setTargetAtTime(0, tl + 1.0, 0.15);
      b.connect(bg);
      bg.connect(bf);
      b.start(tl);
      b.stop(tl + 2);
      // soft pad Am(add9)
      for (const n of [57, 60, 64, 71]) {
        for (const dt of [-8, 8]) {
          E.tone(E.filter('lowpass', 1300, 0.5, bus), { type: 'sawtooth', f: mtof(n), detune: dt, t: tl, a: 0.12, hold: 0.7, d: 0.9, peak: 0.018 });
        }
      }
      // snare + low tom hit at the top
      E.noise(bus, { t, a: 0.001, d: 0.28, peak: 0.22, type: 'highpass', f: 1500, q: 0.6 });
      E.tone(bus, { type: 'sine', f: 140, f1: 70, glide: 0.2, t, a: 0.002, d: 0.4, peak: 0.35 });
      if (!E.offline) setTimeout(() => { try { bus.disconnect(); } catch { /* */ } }, 4000);
      return 2.6;
    }
    return 0;
  }
}
