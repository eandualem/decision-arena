// Rail Dash sound effects (AUDIOFX): every sound is an original synthesis recipe (no samples).
// A recipe is fn(E, t, o, out) -> duration (s). `out` is the voice gain (already routed/panned by AudioSystem).
// Table entries: { fn, vol (mix level), rev (reverb send), max (simultaneous voices), gap (min seconds between) }.
// Pitched material sits in A minor / A major so it blends with the run track ("Rail Rush" is in A dorian).
import { mtof, getWave } from './engine.js';

/** Deterministic tiny PRNG so offline renders are reproducible. */
function prng(seed) {
  let s = (Math.floor(seed * 1000003) ^ 0x9e3779b9) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** Spring "boing": sine sweep with a fast decaying vibrato. */
function boing(E, out, t, f0, f1, dur, peak, vibHz = 18, vibDepth = 0.28) {
  const ac = E.ac;
  const o = ac.createOscillator();
  o.frequency.setValueAtTime(f0, t);
  o.frequency.exponentialRampToValueAtTime(f1, t + dur * 0.7);
  const lfo = ac.createOscillator();
  lfo.frequency.setValueAtTime(vibHz, t);
  lfo.frequency.linearRampToValueAtTime(vibHz * 0.6, t + dur);
  const lg = ac.createGain();
  lg.gain.setValueAtTime(f0 * vibDepth, t);
  lg.gain.exponentialRampToValueAtTime(f1 * 0.004, t + dur);
  lfo.connect(lg);
  lg.connect(o.frequency);
  const g = ac.createGain();
  g.gain.setValueAtTime(0, t);
  g.gain.linearRampToValueAtTime(peak, t + 0.006);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g);
  g.connect(out);
  o.start(t); lfo.start(t);
  o.stop(t + dur + 0.02); lfo.stop(t + dur + 0.02);
  return dur;
}

/** Pea-whistle trill (guard): sine carrier with square-wave FM + breath noise. */
function whistle(E, out, t, blasts, f = 2750, level = 0.3) {
  const ac = E.ac;
  let tt = t;
  for (const dur of blasts) {
    const o = ac.createOscillator();
    o.frequency.value = f;
    const lfo = ac.createOscillator();
    lfo.type = 'square';
    lfo.frequency.value = 26;
    const lg = E.gain(f * 0.035);
    lfo.connect(lg);
    lg.connect(o.frequency);
    const g = ac.createGain();
    g.gain.setValueAtTime(0, tt);
    g.gain.linearRampToValueAtTime(level, tt + 0.012);
    g.gain.setValueAtTime(level, tt + Math.max(0.013, dur - 0.025));
    g.gain.linearRampToValueAtTime(0, tt + dur);
    o.connect(g);
    g.connect(out);
    o.start(tt); lfo.start(tt);
    o.stop(tt + dur + 0.01); lfo.stop(tt + dur + 0.01);
    E.noise(out, { t: tt, a: 0.01, hold: Math.max(0, dur - 0.04), d: 0.03, peak: level * 0.16, type: 'bandpass', f, q: 3 });
    tt += dur + 0.07;
  }
  return tt - t;
}

function brassNote(E, dest, t, midi, len, peak, cut = 2400) {
  const lp = E.filter('lowpass', cut * 0.45, 1.2, dest);
  lp.frequency.setValueAtTime(cut * 0.45, t);
  lp.frequency.linearRampToValueAtTime(cut, t + 0.03);
  lp.frequency.setTargetAtTime(cut * 0.6, t + 0.05, 0.15);
  E.tone(lp, { wave: getWave(E.ac, 'brass'), f: mtof(midi), t, a: 0.012, hold: len * 0.7, d: Math.max(0.12, len * 0.6), peak });
  E.tone(lp, { wave: getWave(E.ac, 'brass'), f: mtof(midi), detune: 9, t, a: 0.014, hold: len * 0.7, d: Math.max(0.12, len * 0.6), peak: peak * 0.6 });
}

function sparkle(E, out, t, n, fLo, fHi, span, peak, seed) {
  const r = prng(seed);
  for (let k = 0; k < n; k++) {
    const tt = t + r() * span;
    E.tone(out, { type: 'sine', f: fLo + r() * (fHi - fLo), t: tt, a: 0.001, d: 0.08 + r() * 0.12, peak: peak * (0.5 + r() * 0.5) });
  }
}

const BELL = [1, 2.76, 5.4];

export const SFX = {
  // ---------------------------------------------------------------- core movement
  coin: {
    vol: 0.598, rev: 0.08, max: 4,
    fn(E, t, o, out) {
      const f = o.freq || 1760;
      E.tone(out, { type: 'sine', f: f * 0.985, f1: f, glide: 0.016, t, a: 0.0015, d: 0.26, peak: 0.6 });
      E.tone(out, { type: 'sine', f: f * 2, t, a: 0.001, d: 0.1, peak: 0.14 });
      E.tone(out, { type: 'triangle', f: f * 3, t, a: 0.001, d: 0.035, peak: 0.07 });
      return 0.28;
    },
  },
  jump: {
    vol: 0.971, max: 2,
    fn(E, t, o, out) {
      E.tone(out, { type: 'triangle', f: 250, f1: 640, glide: 0.12, t, a: 0.004, d: 0.19, peak: 0.55 });
      E.tone(out, { type: 'sine', f: 500, f1: 1280, glide: 0.12, t, a: 0.004, d: 0.1, peak: 0.12 });
      E.noise(out, { t, a: 0.012, d: 0.13, peak: 0.35, type: 'bandpass', f: 1200, f1: 3400, q: 1.1 });
      return 0.25;
    },
  },
  doubleJump: {
    vol: 1.27, max: 2,
    fn(E, t, o, out) {
      E.tone(out, { type: 'triangle', f: 420, f1: 980, glide: 0.1, t, a: 0.003, d: 0.17, peak: 0.5 });
      E.noise(out, { t, a: 0.01, d: 0.12, peak: 0.14, type: 'bandpass', f: 2000, f1: 5000, q: 1.2 });
      sparkle(E, out, t + 0.03, 3, 2600, 4200, 0.1, 0.08, t);
      return 0.3;
    },
  },
  superJump: {
    vol: 0.828, rev: 0.1, max: 2,
    fn(E, t, o, out) {
      boing(E, out, t, 190, 600, 0.5, 0.55, 19, 0.3);
      E.tone(out, { type: 'triangle', f: 380, f1: 1200, glide: 0.3, t, a: 0.005, d: 0.3, peak: 0.12 });
      E.noise(out, { t, a: 0.001, d: 0.04, peak: 0.18, type: 'bandpass', f: 2200, q: 1 });
      return 0.55;
    },
  },
  pogo: {
    vol: 0.712, rev: 0.12, max: 1,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sine', f: 120, f1: 55, glide: 0.12, t, a: 0.002, d: 0.22, peak: 0.55 });
      boing(E, out, t + 0.02, 140, 540, 0.8, 0.55, 15, 0.35);
      E.noise(out, { t: t + 0.05, a: 0.1, d: 0.4, peak: 0.16, type: 'bandpass', f: 500, f1: 2600, glide: 0.4, q: 0.9, expAttack: true });
      return 0.85;
    },
  },
  roll: {
    vol: 0.846, max: 2,
    fn(E, t, o, out) {
      E.noise(out, { t, a: 0.03, d: 0.27, peak: 0.9, type: 'bandpass', f: 2600, f1: 420, glide: 0.25, q: 1.3 });
      E.tone(out, { type: 'sine', f: 135, f1: 52, glide: 0.1, t: t + 0.035, a: 0.003, d: 0.2, peak: 0.5 });
      return 0.32;
    },
  },
  land: {
    vol: 0.826, max: 2, gap: 0.05,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sine', f: 125, f1: 52, glide: 0.08, t, a: 0.002, d: 0.17, peak: 0.5 });
      E.noise(out, { t, a: 0.002, d: 0.1, peak: 0.16, type: 'lowpass', f: 1000, q: 0.5 });
      if (o.metal) E.bell(out, t, 392, [1, 2.71, 4.3], [0.06, 0.04, 0.02], [0.16, 0.1, 0.07]);
      return 0.2;
    },
  },
  landHard: {
    vol: 0.672, max: 2, gap: 0.05,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sine', f: 105, f1: 36, glide: 0.14, t, a: 0.002, d: 0.34, peak: 0.8 });
      E.noise(out, { t, a: 0.002, d: 0.24, peak: 0.34, type: 'lowpass', f: 1700, f1: 400, glide: 0.2, q: 0.6 });
      E.noise(out, { t: t + 0.01, a: 0.004, d: 0.16, peak: 0.1, type: 'bandpass', f: 3200, q: 1.5 });
      if (o.metal) E.bell(out, t, 330, [1, 2.71, 4.3, 6.1], [0.1, 0.06, 0.04, 0.02], [0.3, 0.2, 0.12, 0.08]);
      return 0.36;
    },
  },
  lane: {
    vol: 1.5, max: 2,
    fn(E, t, o, out) {
      E.noise(out, { t, a: 0.035, d: 0.14, peak: 1.2, type: 'bandpass', f: 650, f1: 2500, glide: 0.12, q: 1.6 });
      return 0.2;
    },
  },
  stumble: {
    vol: 1.05, max: 1,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sine', f: 580, f1: 180, glide: 0.09, t, a: 0.001, d: 0.22, peak: 0.6 });
      E.tone(out, { type: 'triangle', f: 1900, t, a: 0.0005, d: 0.03, peak: 0.22 });
      E.noise(out, { t, a: 0.001, d: 0.14, peak: 0.22, type: 'lowpass', f: 700 });
      return 0.26;
    },
  },
  crash: {
    vol: 0.95, rev: 0.12, max: 1,
    fn(E, t, o, out) {
      E.noise(out, { t, a: 0.001, d: 0.6, peak: 0.55, type: 'lowpass', f: 2800, f1: 260, glide: 0.4, q: 0.7 });
      E.tone(out, { type: 'sine', f: 115, f1: 32, glide: 0.32, t, a: 0.002, d: 0.65, peak: 0.85 });
      E.bell(out, t + 0.004, 287, [1, 2.32, 3.87, 5.43, 6.9], [0.16, 0.12, 0.08, 0.06, 0.04], [1.2, 0.85, 0.6, 0.45, 0.3]);
      E.noise(out, { t: t + 0.02, a: 0.01, d: 0.45, peak: 0.1, type: 'bandpass', f: 4300, q: 2 });
      return 1.25;
    },
  },
  caught: {
    vol: 0.488, rev: 0.12, max: 1,
    fn(E, t, o, out) {
      whistle(E, out, t, [0.12, 0.4], 2750, 0.28);
      const t0 = t + 0.66;
      brassNote(E, out, t0, 62, 0.1, 0.32, 1900);
      brassNote(E, out, t0 + 0.16, 62, 0.1, 0.32, 1900);
      const lp = E.filter('lowpass', 1600, 1, out);
      E.tone(lp, { wave: getWave(E.ac, 'brass'), f: mtof(57), f1: mtof(55.6), glide: 0.62, t: t0 + 0.32, a: 0.012, hold: 0.4, d: 0.35, peak: 0.36 });
      E.tone(out, { type: 'sine', f: 110, f1: 98, glide: 0.6, t: t0 + 0.32, a: 0.01, hold: 0.35, d: 0.3, peak: 0.3 });
      return 1.5;
    },
  },

  // ---------------------------------------------------------------- pickups / power-ups
  powerup: {
    vol: 0.894, rev: 0.25, max: 2,
    fn(E, t, o, out) {
      [81, 84, 88, 93, 96].forEach((n, k) => {
        const tt = t + k * 0.045, f = mtof(n);
        E.tone(out, { type: 'triangle', f, t: tt, a: 0.002, d: 0.32, peak: 0.3 });
        E.tone(out, { type: 'sine', f: f * 2, t: tt, a: 0.001, d: 0.14, peak: 0.08 });
      });
      E.noise(out, { t, a: 0.06, d: 0.4, peak: 0.07, type: 'highpass', f: 7000, q: 0.5 });
      return 0.6;
    },
  },
  jetpack: {
    vol: 1.02, rev: 0.1, max: 1,
    fn(E, t, o, out) {
      E.noise(out, { t, a: 0.1, d: 0.6, peak: 0.55, type: 'bandpass', f: 380, f1: 2600, glide: 0.4, q: 0.7, expAttack: true });
      E.noise(out, { t: t + 0.05, a: 0.12, d: 0.45, peak: 0.35, type: 'bandpass', f: 900, f1: 1800, glide: 0.3, q: 1.2, expAttack: true });
      E.tone(out, { type: 'sine', f: 92, f1: 36, glide: 0.3, t, a: 0.005, d: 0.45, peak: 0.4 });
      E.noise(out, { t, a: 0.001, d: 0.06, peak: 0.3, type: 'highpass', f: 2500 });
      return 0.75;
    },
  },
  headstart: {
    vol: 0.964, rev: 0.12, max: 1,
    fn(E, t, o, out) {
      E.noise(out, { t, a: 0.12, d: 1.0, peak: 0.6, type: 'lowpass', f: 200, f1: 4200, glide: 0.55, q: 1.2, expAttack: true });
      E.tone(out, { type: 'sine', f: 75, f1: 30, glide: 0.5, t, a: 0.005, d: 0.8, peak: 0.42 });
      E.noise(out, { t: t + 0.1, a: 0.2, d: 0.6, peak: 0.45, type: 'bandpass', f: 700, f1: 3200, glide: 0.6, q: 1, expAttack: true });
      return 1.2;
    },
  },
  magnet: {
    vol: 0.825, rev: 0.15, max: 1,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sine', f: 110, f1: 220, glide: 0.3, t, a: 0.02, d: 0.5, peak: 0.45 });
      E.tone(out, { type: 'triangle', f: 220, f1: 440, glide: 0.3, t, a: 0.02, d: 0.35, peak: 0.12 });
      E.bell(out, t + 0.18, 1318.5, BELL, [0.14, 0.05, 0.02], [0.5, 0.25, 0.12]);
      return 0.7;
    },
  },
  multiplier: {
    vol: 0.718, rev: 0.22, max: 1,
    fn(E, t, o, out) {
      E.bell(out, t, 1318.5, BELL, [0.28, 0.09, 0.04], [0.7, 0.35, 0.18]);
      E.bell(out, t + 0.11, 1760, BELL, [0.3, 0.1, 0.04], [0.95, 0.4, 0.2]);
      return 1.1;
    },
  },
  sneakers: {
    vol: 1, rev: 0.1, max: 1,
    fn(E, t, o, out) {
      boing(E, out, t, 300, 720, 0.22, 0.4, 22, 0.22);
      boing(E, out, t + 0.13, 420, 980, 0.26, 0.4, 22, 0.22);
      return 0.42;
    },
  },
  hoverOn: {
    vol: 1.13, rev: 0.1, max: 1,
    fn(E, t, o, out) {
      const lp = E.filter('lowpass', 400, 4, out);
      lp.frequency.setValueAtTime(400, t);
      lp.frequency.exponentialRampToValueAtTime(3400, t + 0.35);
      E.tone(lp, { type: 'sawtooth', f: 82, f1: 520, glide: 0.35, t, a: 0.02, d: 0.5, peak: 0.35 });
      E.tone(lp, { type: 'sawtooth', f: 83, f1: 527, glide: 0.35, t, a: 0.02, d: 0.5, peak: 0.25 });
      E.tone(out, { type: 'square', f: 1500, f1: 520, glide: 0.08, t: t + 0.3, a: 0.002, d: 0.12, peak: 0.07 });
      return 0.55;
    },
  },
  hoverBreak: {
    vol: 0.95, rev: 0.12, max: 1,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sawtooth', f: 2200, f1: 70, glide: 0.28, t, a: 0.001, d: 0.34, peak: 0.4 });
      E.noise(out, { t, a: 0.001, d: 0.32, peak: 0.8, type: 'highpass', f: 2800, q: 0.7 });
      sparkle(E, out, t + 0.02, 8, 2500, 6500, 0.22, 0.16, t + 1);
      return 0.6;
    },
  },
  hoverOff: {
    vol: 1.3, max: 1,
    fn(E, t, o, out) {
      const lp = E.filter('lowpass', 900, 2, out);
      E.tone(lp, { type: 'sawtooth', f: 420, f1: 60, glide: 0.42, t, a: 0.01, d: 0.45, peak: 0.3 });
      return 0.5;
    },
  },
  key: {
    vol: 0.727, rev: 0.25, max: 1,
    fn(E, t, o, out) {
      E.bell(out, t, 1318.5, [1, 2.01, 3.99], [0.3, 0.1, 0.05], [0.6, 0.3, 0.15]);
      E.bell(out, t + 0.075, 1975.5, [1, 2.01, 3.99], [0.3, 0.1, 0.05], [0.85, 0.35, 0.18]);
      E.noise(out, { t, a: 0.02, d: 0.3, peak: 0.05, type: 'highpass', f: 8000 });
      return 1.0;
    },
  },
  mysteryBox: {
    vol: 1.25, rev: 0.25, max: 1,
    fn(E, t, o, out) {
      [72, 74, 76, 78, 80, 82, 84, 86].forEach((n, k) => E.tone(out, { type: 'triangle', f: mtof(n), t: t + k * 0.035, a: 0.002, d: 0.24, peak: 0.2 }));
      sparkle(E, out, t + 0.1, 6, 3000, 6000, 0.3, 0.06, t + 2);
      return 0.7;
    },
  },
  mysteryReveal: {
    vol: 0.612, rev: 0.25, max: 1,
    fn(E, t, o, out) {
      brassNote(E, out, t, 84, 0.07, 0.22, 2800);
      for (const n of [77, 81, 84, 89]) brassNote(E, out, t + 0.12, n, 0.5, 0.12, 3000);
      sparkle(E, out, t + 0.12, 10, 2500, 6000, 0.5, 0.06, t + 3);
      return 1.3;
    },
  },
  letter: {
    vol: 0.653, rev: 0.12, max: 1,
    fn(E, t, o, out) {
      const lp = E.filter('lowpass', 3200, 0.8, out);
      E.tone(lp, { type: 'square', f: mtof(79), t, a: 0.002, hold: 0.05, d: 0.08, peak: 0.2 });
      E.tone(lp, { type: 'square', f: mtof(86), t: t + 0.075, a: 0.002, hold: 0.06, d: 0.16, peak: 0.2 });
      return 0.35;
    },
  },
  token: {
    vol: 0.761, rev: 0.12, max: 2,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sine', f: 880, t, a: 0.001, d: 0.3, peak: 0.4 });
      E.tone(out, { type: 'sine', f: 3520, t, a: 0.001, d: 0.05, peak: 0.1 });
      E.tone(out, { type: 'sine', f: 1318.5, t: t + 0.07, a: 0.001, d: 0.4, peak: 0.4 });
      E.tone(out, { type: 'sine', f: 5274, t: t + 0.07, a: 0.001, d: 0.05, peak: 0.08 });
      return 0.5;
    },
  },
  boost: {
    vol: 1.11, rev: 0.2, max: 1,
    fn(E, t, o, out) {
      const lp = E.filter('lowpass', 2400, 2, out);
      E.tone(lp, { type: 'sawtooth', f: 180, f1: 1100, glide: 0.25, t, a: 0.01, d: 0.3, peak: 0.25 });
      E.bell(out, t + 0.22, 1760, BELL, [0.25, 0.08, 0.03], [0.8, 0.35, 0.15]);
      return 1.0;
    },
  },
  powerdown: {
    vol: 1.15, max: 1,
    fn(E, t, o, out) {
      E.tone(out, { type: 'triangle', f: mtof(88), t, a: 0.002, d: 0.12, peak: 0.3 });
      E.tone(out, { type: 'triangle', f: mtof(81), t: t + 0.08, a: 0.002, d: 0.2, peak: 0.3 });
      return 0.3;
    },
  },

  // ---------------------------------------------------------------- progression / UI
  mission: {
    vol: 0.465, rev: 0.22, max: 1,
    fn(E, t, o, out) {
      [[76, 0, 0.09], [81, 0.09, 0.09], [83, 0.18, 0.09], [88, 0.27, 0.45]].forEach(([n, dt, len]) => brassNote(E, out, t + dt, n, len, 0.24, 3200));
      for (const n of [69, 76, 83]) brassNote(E, out, t + 0.27, n, 0.4, 0.07, 2200);
      sparkle(E, out, t + 0.28, 5, 3500, 6500, 0.3, 0.05, t + 4);
      return 1.0;
    },
  },
  setComplete: {
    vol: 0.6, rev: 0.25, max: 1,
    fn(E, t, o, out) {
      for (let k = 0; k < 12; k++) E.noise(out, { t: t + k * 0.04, a: 0.001, d: 0.08, peak: 0.08 + k * 0.012, type: 'highpass', f: 1300, q: 0.6 });
      const t1 = t + 0.5;
      [[69, 0], [76, 0.1], [81, 0.2]].forEach(([n, dt]) => brassNote(E, out, t1 + dt, n, 0.08, 0.22, 3000));
      for (const n of [69, 76, 81, 83, 88]) brassNote(E, out, t1 + 0.32, n, 0.9, 0.08, 3200);
      E.noise(out, { t: t1 + 0.32, a: 0.002, d: 1.4, peak: 0.12, type: 'highpass', f: 4500, q: 0.5 });
      E.tone(out, { type: 'sine', f: 110, t: t1 + 0.32, a: 0.01, hold: 0.4, d: 0.6, peak: 0.3 });
      sparkle(E, out, t1 + 0.32, 10, 3000, 7000, 0.8, 0.05, t + 5);
      return 2.3;
    },
  },
  highScore: {
    vol: 0.681, rev: 0.25, max: 1,
    fn(E, t, o, out) {
      [69, 73, 76, 81, 85, 88].forEach((n, k) => brassNote(E, out, t + k * 0.065, n, 0.07, 0.18, 3200));
      const t1 = t + 0.42;
      for (const n of [69, 73, 76, 81]) brassNote(E, out, t1, n, 1.0, 0.09, 3400);
      E.tone(out, { type: 'sine', f: 110, t: t1, a: 0.01, hold: 0.5, d: 0.6, peak: 0.28 });
      E.noise(out, { t: t1, a: 0.002, d: 1.5, peak: 0.12, type: 'highpass', f: 4500, q: 0.5 });
      sparkle(E, out, t1, 14, 3000, 7500, 1.0, 0.05, t + 6);
      return 2.1;
    },
  },
  revive: {
    vol: 0.963, rev: 0.3, max: 1,
    fn(E, t, o, out) {
      E.noise(out, { t, a: 0.34, d: 0.08, peak: 0.4, type: 'highpass', f: 700, f1: 3000, glide: 0.34, q: 0.8, expAttack: true });
      const t1 = t + 0.34;
      for (const [f, k] of [[1318.5, 0], [1760, 1], [1975.5, 2]]) E.bell(out, t1 + k * 0.03, f, BELL, [0.16, 0.05, 0.02], [1.0, 0.45, 0.2]);
      E.tone(out, { type: 'sine', f: 220, f1: 440, glide: 0.2, t: t1, a: 0.01, d: 0.5, peak: 0.2 });
      return 1.4;
    },
  },
  reviveOffer: {
    vol: 1.03, rev: 0.2, max: 1,
    fn(E, t, o, out) {
      E.bell(out, t, mtof(76), BELL, [0.2, 0.06, 0.02], [0.5, 0.25, 0.1]);
      E.bell(out, t + 0.14, mtof(81), BELL, [0.2, 0.06, 0.02], [0.7, 0.3, 0.12]);
      return 0.8;
    },
  },
  tick: {
    vol: 0.919, max: 1,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sine', f: o.freq || 880, t, a: 0.001, d: 0.12, peak: 0.7 });
      E.tone(out, { type: 'triangle', f: (o.freq || 880) * 3, t, a: 0.0005, d: 0.025, peak: 0.12 });
      return 0.14;
    },
  },
  go: {
    vol: 0.898, rev: 0.15, max: 1,
    fn(E, t, o, out) {
      const lp = E.filter('lowpass', 3500, 0.7, out);
      E.tone(lp, { type: 'square', f: mtof(81), t, a: 0.004, hold: 0.12, d: 0.35, peak: 0.16 });
      E.tone(lp, { type: 'square', f: mtof(88), t, a: 0.004, hold: 0.12, d: 0.35, peak: 0.13 });
      E.noise(out, { t, a: 0.05, d: 0.3, peak: 0.16, type: 'bandpass', f: 800, f1: 3200, glide: 0.25, q: 1 });
      return 0.5;
    },
  },
  click: {
    vol: 0.808, max: 2, gap: 0.03,
    fn(E, t, o, out) {
      E.tone(out, { type: 'sine', f: 1500, f1: 900, glide: 0.03, t, a: 0.001, d: 0.05, peak: 0.6 });
      E.noise(out, { t, a: 0.0005, d: 0.012, peak: 0.25, type: 'highpass', f: 5000 });
      return 0.06;
    },
  },
  purchase: {
    vol: 1.16, rev: 0.18, max: 1, gap: 0.25,
    fn(E, t, o, out) {
      E.noise(out, { t, a: 0.001, d: 0.06, peak: 0.42, type: 'bandpass', f: 2200, q: 1.5 });
      E.tone(out, { type: 'sine', f: 180, f1: 90, glide: 0.05, t, a: 0.001, d: 0.08, peak: 0.25 });
      E.bell(out, t + 0.06, 2093, [1, 1.5, 2.4, 3.1], [0.26, 0.1, 0.1, 0.05], [0.65, 0.42, 0.3, 0.2]);
      sparkle(E, out, t + 0.1, 6, 3000, 5200, 0.28, 0.07, t + 7);
      return 0.9;
    },
  },
  error: {
    vol: 0.395, max: 1, gap: 0.25,
    fn(E, t, o, out) {
      const lp = E.filter('lowpass', 1100, 1, out);
      for (const [dt, len] of [[0, 0.1], [0.15, 0.14]]) {
        E.tone(lp, { type: 'square', f: 146.8, t: t + dt, a: 0.004, hold: len, d: 0.05, peak: 0.26 });
        E.tone(lp, { type: 'square', f: 155.6, t: t + dt, a: 0.004, hold: len, d: 0.05, peak: 0.2 });
      }
      return 0.4;
    },
  },
  whistle: {
    vol: 0.365, rev: 0.15, max: 1, gap: 0.6,
    fn(E, t, o, out) { return whistle(E, out, t, [0.08, 0.22], 2900, 0.26); },
  },
  bark: {
    vol: 1.23, rev: 0.08, max: 1, gap: 0.5,
    fn(E, t, o, out) {
      const ac = E.ac;
      const bp = E.filter('bandpass', 1300, 1.4, out);
      for (const [dt, f0, f1] of [[0, 900, 500], [0.17, 780, 420]]) {
        const tt = t + dt;
        const osc = ac.createOscillator();
        osc.type = 'square';
        osc.frequency.setValueAtTime(f0, tt);
        osc.frequency.exponentialRampToValueAtTime(f1, tt + 0.08);
        const chop = ac.createGain();
        chop.gain.value = 0.5;
        const lfo = ac.createOscillator();
        lfo.type = 'square';
        lfo.frequency.value = 62;
        const lg = E.gain(0.5);
        lfo.connect(lg);
        lg.connect(chop.gain);
        const g = ac.createGain();
        g.gain.setValueAtTime(0, tt);
        g.gain.linearRampToValueAtTime(0.4, tt + 0.006);
        g.gain.setValueAtTime(0.4, tt + 0.05);
        g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.11);
        osc.connect(chop);
        chop.connect(g);
        g.connect(bp);
        osc.start(tt); lfo.start(tt);
        osc.stop(tt + 0.13); lfo.stop(tt + 0.13);
      }
      return 0.32;
    },
  },
  horn: {
    vol: 0.296, rev: 0.2, max: 1,
    fn(E, t, o, out) {
      const lp = E.filter('lowpass', 1500, 0.7, out);
      for (const [dt, len] of [[0, 0.28], [0.4, 0.8]]) {
        for (const f of [370, 440]) {
          E.tone(lp, { wave: getWave(E.ac, 'reed'), f, t: t + dt, a: 0.03, hold: len, d: 0.15, peak: 0.28 });
          E.tone(lp, { wave: getWave(E.ac, 'reed'), f: f * 1.004, t: t + dt, a: 0.03, hold: len, d: 0.15, peak: 0.18 });
        }
      }
      return 1.4;
    },
  },
  whoosh: {
    vol: 0.874, max: 2,
    fn(E, t, o, out) {
      const d = o.dur || 0.45;
      E.noise(out, { t, a: d * 0.35, d: d * 0.65, peak: 1.2, type: 'bandpass', f: 380, f1: 2400, glide: d * 0.5, q: 1.1, expAttack: true });
      return d;
    },
  },
};
