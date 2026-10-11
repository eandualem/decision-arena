// Rail Dash music instruments (AUDIOFX). Every instrument: constructor(E, dest, cfg) with
//   dest = { out: dry layer bus, wet: reverb send (layer-gated), echo: tempo-synced delay input }
//   play(t, ev, stepDur)   ev = { n: midi | midi[], d: steps, v: 0..1, l: legato, c: cutoff mult }
//   stop(t)                release persistent nodes (tracks call it when they are dropped)
// Mono voices (bass, lead, flute) keep their oscillators running and are driven by automation, so a busy
// 16th-note line costs no node allocations; drums and polyphonic parts allocate small per-note graphs.
import { mtof, getWave } from './engine.js';

const clampT = (ac, t) => Math.max(t, ac.currentTime);

function sends(E, node, dest, cfg) {
  if (cfg.rev && dest.wet) node.connect(E.gain(cfg.rev, dest.wet));
  if (cfg.echo && dest.echo) node.connect(E.gain(cfg.echo, dest.echo));
}

function outWithPan(E, dest, cfg) {
  return cfg.pan ? E.panner(cfg.pan, dest.out) : dest.out;
}

/** Plays a noise burst through `into` with a percussive envelope (drum helper). */
function noiseHit(E, into, t, peak, a, tau, len, rate = 1) {
  const ac = E.ac;
  const src = ac.createBufferSource();
  src.buffer = E.white;
  src.loop = true;
  src.playbackRate.value = rate;
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + a);
  g.gain.setTargetAtTime(0, t + a, tau);
  src.connect(g);
  g.connect(into);
  E._nz = ((E._nz || 0) + 0.3719) % 1.5;
  src.start(t, E._nz);
  src.stop(t + a + len);
  return g;
}

// =====================================================================================================
// Drums
// =====================================================================================================
export class Kick {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.8, f0: 150, f1: 46, pitchT: 0.07, decay: 0.4, click: 0.2 }, cfg);
    this.out = outWithPan(E, dest, this.c);
    this.clickF = E.filter('bandpass', 3200, 0.6, this.out);
  }
  play(t, ev) {
    const { E, c } = this, ac = E.ac;
    const v = (ev.v ?? 1) * c.level;
    const o = ac.createOscillator();
    o.frequency.setValueAtTime(c.f0, t);
    o.frequency.exponentialRampToValueAtTime(c.f1, t + c.pitchT);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + 0.003);
    g.gain.setValueAtTime(v, t + 0.018);
    g.gain.setTargetAtTime(0, t + 0.018, c.decay / 4.5);
    o.connect(g);
    g.connect(this.out);
    o.start(t);
    o.stop(t + 0.02 + c.decay * 1.5);
    if (c.click) noiseHit(E, this.clickF, t, v * c.click, 0.0005, 0.004, 0.03);
  }
  stop() {}
}

export class Snare {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.5, tone: 190, hp: 1200, lp: 9000, decay: 0.2, late: 0 }, cfg);
    this.out = outWithPan(E, dest, this.c);
    this.bus = E.gain(1, this.out);
    sends(E, this.bus, dest, this.c);
    this.lp = E.filter('lowpass', this.c.lp, 0.5, this.bus);
    this.hp = E.filter('highpass', this.c.hp, 0.7, this.lp);
  }
  play(t, ev) {
    const { E, c } = this;
    t += c.late;
    const v = (ev.v ?? 1) * c.level;
    noiseHit(E, this.hp, t, v, 0.001, c.decay / 4, c.decay * 1.6);
    E.tone(this.bus, { type: 'triangle', f: c.tone * 1.25, f1: c.tone, glide: 0.04, t, a: 0.001, d: 0.12, peak: v * 0.8 });
  }
  stop() {}
}

export class Clap {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.3 }, cfg);
    this.out = outWithPan(E, dest, this.c);
    this.bus = E.gain(1, this.out);
    sends(E, this.bus, dest, this.c);
    this.bp = E.filter('bandpass', 1150, 1.1, this.bus);
  }
  play(t, ev) {
    const { E, c } = this, ac = E.ac;
    const v = (ev.v ?? 1) * c.level;
    const src = ac.createBufferSource();
    src.buffer = E.white;
    src.loop = true;
    const g = ac.createGain();
    const p = g.gain;
    p.setValueAtTime(0, t);
    for (let k = 0; k < 3; k++) {
      const s = t + k * 0.011;
      p.linearRampToValueAtTime(v, s + 0.001);
      p.linearRampToValueAtTime(v * 0.15, s + 0.009);
    }
    p.linearRampToValueAtTime(v, t + 0.035);
    p.setTargetAtTime(0, t + 0.035, 0.045);
    src.connect(g);
    g.connect(this.bp);
    E._nz = ((E._nz || 0) + 0.3719) % 1.5;
    src.start(t, E._nz);
    src.stop(t + 0.35);
  }
  stop() {}
}

export class Hat {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.12, decay: 0.045, hp: 7000, lp: 14000 }, cfg);
    this.out = outWithPan(E, dest, this.c);
    this.lp = E.filter('lowpass', this.c.lp, 0.5, this.out);
    this.hp = E.filter('highpass', this.c.hp, 0.8, this.lp);
  }
  play(t, ev) {
    const v = (ev.v ?? 1) * this.c.level;
    noiseHit(this.E, this.hp, t, v, 0.0008, this.c.decay / 3.2, this.c.decay * 2.2);
  }
  stop() {}
}

export class Shaker {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.07 }, cfg);
    this.out = outWithPan(E, dest, Object.assign({ pan: 0.3 }, this.c));
    this.bp = E.filter('bandpass', 7000, 0.8, this.out);
  }
  play(t, ev) {
    const v = (ev.v ?? 1) * this.c.level;
    noiseHit(this.E, this.bp, t, v, 0.01, 0.03, 0.16);
  }
  stop() {}
}

export class Rim {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.12 }, cfg);
    this.out = outWithPan(E, dest, Object.assign({ pan: -0.2 }, this.c));
    this.bus = E.gain(1, this.out);
    sends(E, this.bus, dest, this.c);
    this.bp = E.filter('bandpass', 2600, 2, this.bus);
  }
  play(t, ev) {
    const { E } = this;
    const v = (ev.v ?? 1) * this.c.level;
    E.tone(this.bus, { type: 'triangle', f: 1650, t, a: 0.0005, d: 0.05, peak: v * 0.6 });
    E.tone(this.bus, { type: 'sine', f: 480, t, a: 0.0005, d: 0.06, peak: v * 0.5 });
    noiseHit(E, this.bp, t, v * 0.6, 0.0005, 0.006, 0.04);
  }
  stop() {}
}

export class Crash {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.1 }, cfg);
    this.out = outWithPan(E, dest, Object.assign({ pan: 0.15 }, this.c));
    this.bus = E.gain(1, this.out);
    sends(E, this.bus, dest, this.c);
    this.hp = E.filter('highpass', 4200, 0.6, this.bus);
  }
  play(t, ev) {
    const v = (ev.v ?? 1) * this.c.level;
    noiseHit(this.E, this.hp, t, v, 0.002, 0.42, 2.2, 0.85);
  }
  stop() {}
}

/** Noise riser over ev.d steps (build-ups): band-passed noise sweeping up with a rising swell. */
export class Riser {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.09 }, cfg);
    this.out = outWithPan(E, dest, this.c);
    this.bus = E.gain(1, this.out);
    sends(E, this.bus, dest, Object.assign({ rev: 0.25 }, this.c));
  }
  play(t, ev, sd) {
    const { E, c } = this, ac = E.ac;
    const dur = ev.d * sd;
    const src = ac.createBufferSource();
    src.buffer = E.white;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 2.2;
    f.frequency.setValueAtTime(350, t);
    f.frequency.exponentialRampToValueAtTime(7500, t + dur);
    const g = ac.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(c.level * (ev.v ?? 1), t + dur * 0.97);
    g.gain.linearRampToValueAtTime(0, t + dur + 0.02);
    src.connect(f);
    f.connect(g);
    g.connect(this.bus);
    src.start(t);
    src.stop(t + dur + 0.05);
  }
  stop() {}
}

// =====================================================================================================
// Mono synth (bass, lead, flute): persistent oscillators, automation-driven envelopes and glide
// =====================================================================================================
export class Mono {
  constructor(E, dest, cfg, t0) {
    this.E = E;
    const c = (this.c = Object.assign({
      level: 0.3, wave: 'sawtooth', wave2: null, mix2: 0.5, detune2: 7, sub: 0, oct: 0,
      cut: 1200, env: 2000, q: 4, fdecay: 0.12, atk: 0.004, dec: 0.2, sus: 0.6, rel: 0.06,
      glide: 0.03, vib: 0, vibRate: 5.5, vibDelay: 0.2, gate: 0.9, breath: 0,
    }, cfg));
    const ac = E.ac;
    this.out = outWithPan(E, dest, c);
    this.amp = E.gain(0, this.out);
    sends(E, this.amp, dest, c);
    this.flt = E.filter('lowpass', c.cut, c.q, this.amp);
    this.oscs = [];
    const mk = (wave, gain, detune = 0) => {
      const o = ac.createOscillator();
      if (['sine', 'square', 'sawtooth', 'triangle'].includes(wave)) o.type = wave; else o.setPeriodicWave(getWave(ac, wave));
      o.detune.value = detune;
      o.connect(E.gain(gain, this.flt));
      this.oscs.push(o);
      return o;
    };
    this.o1 = mk(c.wave, 1);
    this.o2 = c.wave2 ? mk(c.wave2, c.mix2, c.detune2) : null;
    this.sub = c.sub ? mk('sine', c.sub, -1200) : null;
    if (c.vib) {
      this.lfo = ac.createOscillator();
      this.lfo.frequency.value = c.vibRate;
      this.vibG = E.gain(0);
      this.lfo.connect(this.vibG);
      for (const o of this.oscs) this.vibG.connect(o.detune);
      this.oscs.push(this.lfo);
    }
    if (c.breath) {
      const n = ac.createBufferSource();
      n.buffer = E.white;
      n.loop = true;
      this.breathF = E.filter('bandpass', 2400, 1.2);
      n.connect(this.breathF);
      this.breathF.connect(E.gain(c.breath, this.amp));
      this.oscs.push(n);
    }
    const start = Math.max(t0 ?? ac.currentTime, ac.currentTime);
    for (const o of this.oscs) o.start(start);
    this.legatoUntil = -1;
    this.freqParams = [this.o1.frequency, this.o2?.frequency, this.sub?.frequency].filter(Boolean);
  }

  play(t, ev, sd) {
    const { c, E } = this;
    t = clampT(E.ac, t);
    const midi = (Array.isArray(ev.n) ? ev.n[0] : ev.n) + c.oct;
    const f = mtof(midi);
    const v = ev.v ?? 1;
    const len = ev.d * sd * (ev.l ? 1.02 : c.gate);
    const amp = this.amp.gain, cut = this.flt.frequency;
    const legato = t <= this.legatoUntil + 0.25 * sd;
    for (const p of this.freqParams) {
      p.cancelScheduledValues(t);
      if (legato && c.glide) p.setTargetAtTime(f, t, c.glide); else p.setValueAtTime(f, t);
    }
    amp.cancelScheduledValues(t);
    cut.cancelScheduledValues(t);
    const peak = c.level * v;
    const a4 = c.atk * 4;
    if (!legato) amp.setTargetAtTime(peak, t, c.atk);
    else amp.setTargetAtTime(peak * 0.9, t, 0.02);
    if (len > a4 + 0.01) amp.setTargetAtTime(peak * c.sus, t + a4, c.dec);
    amp.setTargetAtTime(0, t + Math.max(len, a4 + 0.005), c.rel);
    const cm = ev.c ?? 1;
    const base = c.cut * cm;
    if (!legato) {
      cut.setTargetAtTime(Math.min(16000, base + c.env * v * cm), t, 0.003);
      cut.setTargetAtTime(base, t + 0.015, c.fdecay);
    }
    if (this.vibG) {
      const vg = this.vibG.gain;
      vg.cancelScheduledValues(t);
      vg.setTargetAtTime(0, t, 0.02);
      if (len > 0.28) vg.setTargetAtTime(c.vib, t + c.vibDelay, 0.12);
    }
    this.legatoUntil = ev.l ? t + ev.d * sd : -1;
  }

  stop(t) {
    t = clampT(this.E.ac, t);
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(0, t, 0.03);
    for (const o of this.oscs) { try { o.stop(t + 0.3); } catch { /* */ } }
  }
}

// =====================================================================================================
// Paraphonic stab: 4 persistent saw pairs through one filter + one envelope
// =====================================================================================================
export class Stab {
  constructor(E, dest, cfg, t0) {
    this.E = E;
    const c = (this.c = Object.assign({ level: 0.08, cut: 900, env: 2500, q: 3, decay: 0.09 }, cfg));
    const ac = E.ac;
    this.out = outWithPan(E, dest, c);
    this.amp = E.gain(0, this.out);
    sends(E, this.amp, dest, c);
    this.flt = E.filter('lowpass', c.cut, c.q, this.amp);
    this.oscs = [];
    this.voices = [];
    for (let i = 0; i < 4; i++) {
      const a = ac.createOscillator(), b = ac.createOscillator();
      a.type = 'sawtooth'; b.type = 'square';
      b.detune.value = 8;
      a.connect(this.flt);
      b.connect(E.gain(0.35, this.flt));
      this.oscs.push(a, b);
      this.voices.push([a, b]);
    }
    const start = Math.max(t0 ?? ac.currentTime, ac.currentTime);
    for (const o of this.oscs) o.start(start);
  }
  play(t, ev, sd) {
    const { c, E } = this;
    t = clampT(E.ac, t);
    const ns = Array.isArray(ev.n) ? ev.n : [ev.n];
    const v = ev.v ?? 1;
    for (let i = 0; i < 4; i++) {
      const f = mtof(ns[i % ns.length]);
      for (const o of this.voices[i]) { o.frequency.cancelScheduledValues(t); o.frequency.setValueAtTime(f, t); }
    }
    const amp = this.amp.gain, cut = this.flt.frequency;
    amp.cancelScheduledValues(t);
    cut.cancelScheduledValues(t);
    amp.setTargetAtTime(c.level * v, t, 0.0015);
    const hold = Math.max(0.02, ev.d * sd * 0.6 - 0.02);
    amp.setTargetAtTime(0, t + hold, c.decay);
    cut.setTargetAtTime(c.cut + c.env * v, t, 0.002);
    cut.setTargetAtTime(c.cut, t + 0.01, 0.05);
  }
  stop(t) {
    t = clampT(this.E.ac, t);
    this.amp.gain.cancelScheduledValues(t);
    this.amp.gain.setTargetAtTime(0, t, 0.02);
    for (const o of this.oscs) { try { o.stop(t + 0.2); } catch { /* */ } }
  }
}

// =====================================================================================================
// Poly instruments (per-note graphs)
// =====================================================================================================
export class Pad {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.03, cut: 1500, atk: 0.35, rel: 0.6 }, cfg);
    this.out = outWithPan(E, dest, this.c);
    this.bus = E.gain(1, this.out);
    sends(E, this.bus, dest, this.c);
    this.flt = E.filter('lowpass', this.c.cut, 0.6, this.bus);
  }
  play(t, ev, sd) {
    const { E, c } = this, ac = E.ac;
    t = clampT(ac, t);
    const ns = Array.isArray(ev.n) ? ev.n : [ev.n];
    const len = ev.d * sd;
    const v = (ev.v ?? 1) * c.level;
    const g = ac.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(v, t + c.atk);
    g.gain.setValueAtTime(v, t + Math.max(c.atk, len - 0.05));
    g.gain.setTargetAtTime(0, t + Math.max(c.atk, len - 0.05), c.rel / 3);
    g.connect(this.flt);
    const end = t + len + c.rel * 2;
    for (const n of ns) {
      for (const dt of [-9, 9]) {
        const o = ac.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = mtof(n);
        o.detune.value = dt;
        o.connect(g);
        o.start(t);
        o.stop(end);
      }
    }
  }
  stop() {}
}

/** Bright pluck for arpeggios: triangle + sine octave, fast decay. */
export class Pluck {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.06, decay: 0.16, cut: 3800 }, cfg);
    this.out = outWithPan(E, dest, this.c);
    this.bus = E.gain(1, this.out);
    sends(E, this.bus, dest, this.c);
    this.flt = E.filter('lowpass', this.c.cut, 0.8, this.bus);
  }
  play(t, ev) {
    const { E, c } = this;
    t = clampT(E.ac, t);
    const ns = Array.isArray(ev.n) ? ev.n : [ev.n];
    const v = (ev.v ?? 1) * c.level;
    for (const n of ns) {
      const f = mtof(n);
      E.tone(this.flt, { type: 'triangle', f, t, a: 0.002, d: c.decay * 2.2, peak: v });
      E.tone(this.flt, { type: 'sine', f: f * 2, t, a: 0.001, d: c.decay, peak: v * 0.35 });
    }
  }
  stop() {}
}

/** Rhodes-style electric piano: 1:1 FM with a decaying index + a short tine partial, tremolo on the bus. */
export class Keys {
  constructor(E, dest, cfg, t0) {
    this.E = E;
    this.c = Object.assign({ level: 0.075, cut: 2300 }, cfg);
    const ac = E.ac;
    this.out = outWithPan(E, dest, this.c);
    this.trem = E.gain(0.88, this.out);
    sends(E, this.trem, dest, this.c);
    this.flt = E.filter('lowpass', this.c.cut, 0.6, this.trem);
    this.lfo = ac.createOscillator();
    this.lfo.frequency.value = 4.3;
    this.lfo.connect(E.gain(0.12, this.trem.gain));
    this.lfo.start(Math.max(t0 ?? ac.currentTime, ac.currentTime));
    this.drift = 0;
  }
  play(t, ev, sd) {
    const { E, c } = this, ac = E.ac;
    t = clampT(ac, t);
    const ns = Array.isArray(ev.n) ? ev.n : [ev.n];
    const len = ev.d * sd;
    const v = (ev.v ?? 1) * c.level;
    this.drift = Math.max(-9, Math.min(9, this.drift + (Math.random() - 0.5) * 6)); // lo-fi tape drift
    ns.forEach((n, k) => {
      const f = mtof(n);
      const st = t + k * 0.006; // tiny strum
      const car = ac.createOscillator(), mod = ac.createOscillator();
      car.frequency.value = f;
      mod.frequency.value = f;
      car.detune.value = this.drift + (Math.random() - 0.5) * 8;
      const idx = ac.createGain();
      idx.gain.setValueAtTime(f * 1.6, st);
      idx.gain.setTargetAtTime(f * 0.28, st, 0.22);
      mod.connect(idx);
      idx.connect(car.frequency);
      const g = ac.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(v, st + 0.004);
      g.gain.setTargetAtTime(v * 0.45, st + 0.004, 1.3);
      g.gain.setTargetAtTime(0, st + len, 0.12);
      car.connect(g);
      g.connect(this.flt);
      const end = st + len + 0.8;
      car.start(st); mod.start(st);
      car.stop(end); mod.stop(end);
      E.tone(this.flt, { type: 'sine', f: f * 4, t: st, a: 0.001, d: 0.25, peak: v * 0.12 });
    });
  }
  stop(t) { try { this.lfo.stop(clampT(this.E.ac, t) + 0.1); } catch { /* */ } }
}

/** Kalimba: sine body + inharmonic tine partial + thumb click. */
export class Kalimba {
  constructor(E, dest, cfg) {
    this.E = E;
    this.c = Object.assign({ level: 0.14 }, cfg);
    this.out = outWithPan(E, dest, this.c);
    this.bus = E.gain(1, this.out);
    sends(E, this.bus, dest, this.c);
    this.click = E.filter('lowpass', 2500, 0.7, this.bus);
  }
  play(t, ev) {
    const { E, c } = this;
    t = clampT(E.ac, t);
    const f = mtof(Array.isArray(ev.n) ? ev.n[0] : ev.n);
    const v = (ev.v ?? 1) * c.level;
    E.tone(this.bus, { type: 'sine', f, t, a: 0.0015, d: 1.3, peak: v });
    E.tone(this.bus, { type: 'sine', f: f * 5.4, t, a: 0.001, d: 0.14, peak: v * 0.22 });
    E.tone(this.bus, { type: 'sine', f: f * 2, t, a: 0.001, d: 0.35, peak: v * 0.12 });
    noiseHit(E, this.click, t, v * 0.25, 0.0005, 0.004, 0.02);
  }
  stop() {}
}

/** Vinyl crackle bed (starts with the track, loops forever). */
export class Crackle {
  constructor(E, dest, cfg, t0) {
    this.E = E;
    const ac = E.ac;
    this.c = Object.assign({ level: 0.2 }, cfg);
    this.src = ac.createBufferSource();
    this.src.buffer = E.getCrackle();
    this.src.loop = true;
    this.g = E.gain(this.c.level, E.filter('highpass', 300, 0.5, dest.out));
    this.src.connect(this.g);
    this.src.start(Math.max(t0 ?? ac.currentTime, ac.currentTime));
  }
  play() {}
  stop(t) { try { this.src.stop(clampT(this.E.ac, t) + 0.3); } catch { /* */ } }
}

/** Tempo-synced feedback echo (dotted eighth by default). */
export class Echo {
  constructor(E, out, time, fb = 0.3, cut = 2600) {
    this.E = E;
    const ac = E.ac;
    this.input = E.gain(1);
    this.delay = ac.createDelay(2);
    this.delay.delayTime.value = time;
    this.lp = E.filter('lowpass', cut, 0.5);
    this.hp = E.filter('highpass', 250, 0.5);
    this.fb = E.gain(fb);
    this.input.connect(this.delay);
    this.delay.connect(this.lp);
    this.lp.connect(this.hp);
    this.hp.connect(this.fb);
    this.fb.connect(this.delay);
    this.hp.connect(out);
  }
}

export const INSTRUMENTS = {
  kick: Kick, snare: Snare, clap: Clap, hat: Hat, shaker: Shaker, rim: Rim, crash: Crash, riser: Riser,
  mono: Mono, stab: Stab, pad: Pad, pluck: Pluck, keys: Keys, kalimba: Kalimba, crackle: Crackle,
};
