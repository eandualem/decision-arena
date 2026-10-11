// Rail Dash audio engine (AUDIOFX): one WebAudio graph shared by music and SFX.
// Works with a realtime AudioContext or an OfflineAudioContext (the harness renders through the same chain).
//
//   music tracks --> musicDuck (gain) --> musicLP (lowpass, pause/dying duck) --> musicVol --\
//   sfx voices   --------------------------------------------------------------> sfxVol ---+--> master
//   sends (post-fader: musicRev / sfxRev) --> reverb (convolver) -------------------------/     |
//   master --> glue compressor --> soft-clip ceiling (never exceeds +-0.98) --> destination <---/
//
// Everything is synthesized: noise buffers, a generated impulse response, oscillators and filters.

export const mtof = (m) => 440 * Math.pow(2, (m - 69) / 12);

// Mix calibration (measured in harness/audio.html; see report there).
export const MIX = {
  master: 0.82,
  music: 0.5,    // x settings.music
  sfx: 0.9,      // x settings.sfx
  reverbReturn: 0.9,
};

/** Soft-clip transfer curve over the input domain [-2, 2] (fed through a 0.5 pre-gain). Linear to 0.7, asymptote 0.98. */
function softClipCurve(n = 4096) {
  const c = new Float32Array(n);
  const knee = 0.7, room = 0.28;
  for (let i = 0; i < n; i++) {
    const x = ((i / (n - 1)) * 2 - 1) * 2;
    const a = Math.abs(x);
    const y = a < knee ? a : knee + room * Math.tanh((a - knee) / room);
    c[i] = Math.sign(x) * y;
  }
  return c;
}

function makeNoise(ac, seconds) {
  const len = Math.floor(ac.sampleRate * seconds);
  const buf = ac.createBuffer(1, len, ac.sampleRate);
  const d = buf.getChannelData(0);
  let s = 0x1234567;
  for (let i = 0; i < len; i++) { s = (s * 1664525 + 1013904223) >>> 0; d[i] = (s / 4294967296) * 2 - 1; }
  return buf;
}

/** Vinyl crackle loop: faint warm hiss + sparse clicks and pops (lo-fi menu groove). */
function makeCrackle(ac, seconds = 4) {
  const sr = ac.sampleRate, len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  let s = 0x2468ace;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = 0; i < len; i++) { lp += 0.08 * ((rnd() * 2 - 1) - lp); d[i] = lp * 0.18; }
    const pops = Math.floor(seconds * 9);
    for (let k = 0; k < pops; k++) {
      const at = Math.floor(rnd() * (len - 400));
      const amp = (0.25 + rnd() * 0.75) * (rnd() < 0.15 ? 1 : 0.35);
      const w = 6 + Math.floor(rnd() * 30);
      for (let j = 0; j < w; j++) d[at + j] += amp * (rnd() * 2 - 1) * Math.exp(-j / (w * 0.35));
    }
    // seamless loop: short crossfade at the ends
    const xf = Math.floor(sr * 0.02);
    for (let i = 0; i < xf; i++) { const g = i / xf; d[i] = d[i] * g + d[len - xf + i] * (1 - g); }
  }
  return buf;
}

/** Generated stereo impulse response: pre-delay, a few early reflections, darkening exponential tail. */
function makeImpulse(ac, seconds = 1.7, decay = 3.0) {
  const sr = ac.sampleRate, len = Math.floor(sr * seconds);
  const buf = ac.createBuffer(2, len, sr);
  let s = 0x51ed27;
  const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return (s / 4294967296) * 2 - 1; };
  const pre = Math.floor(sr * 0.012);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    let lp = 0;
    for (let i = pre; i < len; i++) {
      const t = (i - pre) / (len - pre);
      const coef = 0.55 - 0.45 * t;          // one-pole lowpass: brighter early, darker late
      lp += coef * (rnd() - lp);
      d[i] = lp * Math.pow(1 - t, decay);
    }
    const er = [0.017, 0.023, 0.031, 0.043, 0.057];
    er.forEach((sec, k) => { const i = Math.floor(sr * (sec + ch * 0.0023 * (k + 1))); if (i < len) d[i] += (0.5 - k * 0.07) * (k % 2 ? -1 : 1); });
  }
  return buf;
}

export class AudioEngine {
  /** @param {BaseAudioContext} ac */
  constructor(ac, opts = {}) {
    this.ac = ac;
    this.sr = ac.sampleRate;
    this.offline = typeof OfflineAudioContext !== 'undefined' && ac instanceof OfflineAudioContext;
    // shared buffers
    this.white = makeNoise(ac, 2);
    this.crackle = null; // built lazily (menu track)
    // master chain
    this.master = ac.createGain();
    this.master.gain.value = MIX.master;
    const out = opts.destination || ac.destination;
    if (opts.bypassMaster) {
      this.master.connect(out);
    } else {
      this.comp = ac.createDynamicsCompressor();
      this.comp.threshold.value = -12;
      this.comp.knee.value = 12;
      this.comp.ratio.value = 2.5;
      this.comp.attack.value = 0.005;
      this.comp.release.value = 0.22;
      this.clipPre = ac.createGain();
      this.clipPre.gain.value = 0.5;
      this.clip = ac.createWaveShaper();
      this.clip.curve = softClipCurve();
      this.clip.oversample = '2x';
      this.master.connect(this.comp);
      this.comp.connect(this.clipPre);
      this.clipPre.connect(this.clip);
      this.clip.connect(out);
    }
    // music bus
    this.musicVol = ac.createGain();
    this.musicVol.gain.value = MIX.music * 0.6;
    this.musicLP = ac.createBiquadFilter();
    this.musicLP.type = 'lowpass';
    this.musicLP.frequency.value = 20000;
    this.musicLP.Q.value = 0.5;
    this.musicDuck = ac.createGain();
    this.musicIn = this.musicDuck;
    this.musicDuck.connect(this.musicLP);
    this.musicLP.connect(this.musicVol);
    this.musicVol.connect(this.master);
    // sfx bus
    this.sfxVol = ac.createGain();
    this.sfxVol.gain.value = MIX.sfx * 0.85;
    this.sfxIn = this.sfxVol;
    this.sfxVol.connect(this.master);
    // reverb (shared, post-fader sends)
    this.reverb = ac.createConvolver();
    this.reverb.buffer = makeImpulse(ac);
    this.reverbOut = ac.createGain();
    this.reverbOut.gain.value = MIX.reverbReturn;
    this.reverb.connect(this.reverbOut);
    this.reverbOut.connect(this.master);
    this.musicRev = ac.createGain();
    this.musicRev.gain.value = this.musicVol.gain.value;
    this.musicRev.connect(this.reverb);
    this.sfxRev = ac.createGain();
    this.sfxRev.gain.value = this.sfxVol.gain.value;
    this.sfxRev.connect(this.reverb);
    this.musicLevel = 0.6; this.sfxLevel = 0.85; this.duckGain = 1;
    this.hasPanner = typeof ac.createStereoPanner === 'function';
  }

  get now() { return this.ac.currentTime; }

  getCrackle() { return this.crackle || (this.crackle = makeCrackle(this.ac)); }

  // ------------------------------------------------------------------ levels
  setVolumes(music, sfx, tc = 0.08) {
    this.musicLevel = Math.max(0, Math.min(1, +music || 0));
    this.sfxLevel = Math.max(0, Math.min(1, +sfx || 0));
    const t = this.now;
    const m = MIX.music * this.musicLevel, s = MIX.sfx * this.sfxLevel;
    this.musicVol.gain.setTargetAtTime(m, t, tc);
    this.musicRev.gain.setTargetAtTime(m * this.duckGain, t, tc);
    this.sfxVol.gain.setTargetAtTime(s, t, tc);
    this.sfxRev.gain.setTargetAtTime(s, t, tc);
  }

  /** Music duck: gain multiplier and lowpass cutoff (pause, countdown, dying, revive offer). */
  setDuck(gain, cutoff, tc = 0.12) {
    const t = this.now;
    this.duckGain = gain;
    this.musicDuck.gain.setTargetAtTime(gain, t, tc);
    this.musicLP.frequency.setTargetAtTime(cutoff, t, tc);
    this.musicRev.gain.setTargetAtTime(MIX.music * this.musicLevel * gain, t, tc);
  }

  // ------------------------------------------------------------------ node helpers
  gain(v = 1, dest = null) {
    const g = this.ac.createGain();
    g.gain.value = v;
    if (dest) g.connect(dest);
    return g;
  }

  filter(type, freq, q = 0.7, dest = null) {
    const f = this.ac.createBiquadFilter();
    f.type = type;
    f.frequency.value = freq;
    f.Q.value = q;
    if (dest) f.connect(dest);
    return f;
  }

  panner(pan, dest) {
    if (!this.hasPanner) return dest;
    const p = this.ac.createStereoPanner();
    p.pan.value = Math.max(-1, Math.min(1, pan));
    p.connect(dest);
    return p;
  }

  /**
   * One-shot oscillator with pitch glide and an attack / exponential-decay envelope.
   * o: {type, wave, f, f1, glide, t, a, d, peak, detune, hold}
   */
  tone(dest, o) {
    const ac = this.ac, t = o.t;
    const osc = ac.createOscillator();
    if (o.wave) osc.setPeriodicWave(o.wave); else osc.type = o.type || 'sine';
    const f = Math.max(1, o.f);
    osc.frequency.setValueAtTime(f, t);
    if (o.f1) {
      const gt = t + (o.glide ?? (o.a || 0.002) + (o.d || 0.2));
      if (o.lin) osc.frequency.linearRampToValueAtTime(o.f1, gt);
      else osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.f1), gt);
    }
    if (o.detune) osc.detune.value = o.detune;
    const g = ac.createGain();
    const a = o.a ?? 0.002, d = o.d ?? 0.2, hold = o.hold || 0, peak = o.peak ?? 0.5;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    osc.connect(g);
    g.connect(dest);
    osc.start(t);
    osc.stop(t + a + hold + d + 0.02);
    return { osc, g, end: t + a + hold + d };
  }

  /**
   * One-shot filtered noise burst. o: {t, a, d, hold, peak, type, f, f1, glide, q, rate}
   */
  noise(dest, o) {
    const ac = this.ac, t = o.t;
    const src = ac.createBufferSource();
    src.buffer = this.white;
    src.loop = true;
    if (o.rate) src.playbackRate.value = o.rate;
    const flt = ac.createBiquadFilter();
    flt.type = o.type || 'bandpass';
    flt.frequency.setValueAtTime(o.f || 1000, t);
    if (o.f1) flt.frequency.exponentialRampToValueAtTime(o.f1, t + (o.glide ?? ((o.a || 0.002) + (o.d || 0.2))));
    flt.Q.value = o.q ?? 0.8;
    const g = ac.createGain();
    const a = o.a ?? 0.002, d = o.d ?? 0.2, hold = o.hold || 0, peak = o.peak ?? 0.5;
    g.gain.setValueAtTime(0, t);
    if (o.expAttack) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); }
    else g.gain.linearRampToValueAtTime(peak, t + a);
    if (hold) g.gain.setValueAtTime(peak, t + a + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + a + hold + d);
    src.connect(flt);
    flt.connect(g);
    g.connect(dest);
    const end = t + a + hold + d;
    this._nz = ((this._nz || 0) + 0.3719) % 1.5;
    src.start(t, this._nz);
    src.stop(end + 0.02);
    return { src, flt, g, end };
  }

  /** Inharmonic bell / metal partials: ratios[], gains[], decays[] around base frequency f. */
  bell(dest, t, f, ratios, gains, decays, type = 'sine') {
    let end = t;
    for (let i = 0; i < ratios.length; i++) {
      const r = this.tone(dest, { type, f: f * ratios[i], t, a: 0.0015, d: decays[i] ?? decays[decays.length - 1], peak: gains[i] ?? 0.1 });
      end = Math.max(end, r.end);
    }
    return end;
  }

  /** Stop helper for persistent sources (safe to call twice). */
  static stopAll(nodes, t) {
    for (const n of nodes) { try { n.stop(t); } catch { /* already stopped */ } }
  }
}

/** Cached PeriodicWaves per context (brassy lead, organ-ish pad, etc.). */
const waveCache = new WeakMap();
export function getWave(ac, name) {
  let m = waveCache.get(ac);
  if (!m) waveCache.set(ac, (m = new Map()));
  if (m.has(name)) return m.get(name);
  const N = 24;
  const real = new Float32Array(N), imag = new Float32Array(N);
  for (let n = 1; n < N; n++) {
    let a = 0;
    if (name === 'lead') a = (n % 2 ? 1 : 0.55) / Math.pow(n, 1.05) * (n > 12 ? 0.5 : 1);           // square-ish with softened evens
    else if (name === 'brass') a = 1 / n * Math.exp(-n / 9);                                             // mellow saw
    else if (name === 'reed') a = (n % 2 ? 1 : 0.2) / n * Math.exp(-n / 14);                             // horn / reed
    else if (name === 'organ') a = [0, 1, 0.6, 0.25, 0.3, 0.08, 0.12, 0, 0.1][n] || 0;
    else if (name === 'pulse25') a = (2 / (n * Math.PI)) * Math.abs(Math.sin(n * Math.PI * 0.25)) * Math.exp(-n / 18);
    else a = n === 1 ? 1 : 0;
    imag[n] = a;
  }
  const w = ac.createPeriodicWave(real, imag, { disableNormalization: false });
  m.set(name, w);
  return w;
}
