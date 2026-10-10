// Rail Dash continuous sounds (AUDIOFX): power-up loops and the Doppler train horn.
// Loops are created on demand, faded with setTargetAtTime and torn down after they fade out.
import { getWave } from './engine.js';
import { LANE_WIDTH } from '../config.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

class Loop {
  constructor(E, out, level) {
    this.E = E;
    this.out = E.gain(0, out);
    this.level = 0;
    this.base = level;
    this.srcs = [];
    this.dead = false;
  }
  _start(t) { for (const s of this.srcs) s.start(t); }
  fadeIn(tc = 0.12) { this.set(1, tc); }
  set(mult, tc = 0.15) {
    const v = this.base * mult;
    if (Math.abs(v - this.level) < 0.002) return;
    this.level = v;
    this.out.gain.setTargetAtTime(v, this.E.ac.currentTime, tc);
  }
  stop(tc = 0.12) {
    if (this.dead) return;
    this.dead = true;
    const t = this.E.ac.currentTime;
    this.out.gain.cancelScheduledValues(t);
    this.out.gain.setTargetAtTime(0, t, tc);
    for (const s of this.srcs) { try { s.stop(t + tc * 8); } catch { /* */ } }
  }
  update() {}
}

/** Jetpack / rocket-start thrust: band-passed noise roar with flutter + a low sawtooth rumble. */
export class JetLoop extends Loop {
  constructor(E, out, rocket = false) {
    super(E, out, rocket ? 0.23 : 0.18);
    const ac = E.ac, t = ac.currentTime;
    const n = ac.createBufferSource();
    n.buffer = E.white;
    n.loop = true;
    this.bp = E.filter('bandpass', rocket ? 950 : 560, 0.7);
    const lp = E.filter('lowpass', rocket ? 3600 : 2200, 0.5, this.out);
    n.connect(this.bp);
    this.bp.connect(lp);
    const flutter = ac.createOscillator();
    flutter.frequency.value = rocket ? 13 : 9;
    flutter.connect(E.gain(rocket ? 160 : 110, this.bp.frequency));
    const rum = ac.createOscillator();
    rum.type = 'sawtooth';
    rum.frequency.value = rocket ? 55 : 46;
    rum.connect(E.gain(0.55, E.filter('lowpass', 170, 0.8, this.out)));
    this.srcs.push(n, flutter, rum);
    this._start(t);
    this.fadeIn(0.18);
  }
}

/** Coin magnet: soft A/E hum with a slow "wub" tremolo and a faint shimmering whine. */
export class MagnetLoop extends Loop {
  constructor(E, out) {
    super(E, out, 0.11);
    const ac = E.ac, t = ac.currentTime;
    const trem = E.gain(0.6, this.out);
    const lfo = ac.createOscillator();
    lfo.frequency.value = 5.2;
    lfo.connect(E.gain(0.4, trem.gain));
    const mk = (type, f, g, dest) => { const o = ac.createOscillator(); o.type = type; o.frequency.value = f; o.connect(E.gain(g, dest)); this.srcs.push(o); return o; };
    mk('sine', 110, 0.5, trem);
    mk('sine', 164.8, 0.35, trem);
    mk('triangle', 220, 0.22, trem);
    const whine = mk('sine', 1760, 0.035, this.out);
    const vib = ac.createOscillator();
    vib.frequency.value = 6.5;
    vib.connect(E.gain(9, whine.frequency));
    this.srcs.push(lfo, vib);
    this._start(t);
    this.fadeIn(0.25);
  }
}

/** Hoverboard: detuned low saws through a slowly swept resonant lowpass; pitch rises a little with speed. */
export class HoverLoop extends Loop {
  constructor(E, out) {
    super(E, out, 0.095);
    const ac = E.ac, t = ac.currentTime;
    this.flt = E.filter('lowpass', 520, 5, this.out);
    const sweep = ac.createOscillator();
    sweep.frequency.value = 0.8;
    sweep.connect(E.gain(160, this.flt.frequency));
    this.oscs = [];
    for (const [type, mult, g, det] of [['sawtooth', 1, 0.5, -6], ['sawtooth', 1, 0.5, 7], ['square', 2, 0.12, 0]]) {
      const o = ac.createOscillator();
      o.type = type;
      o.frequency.value = 82.41 * mult;
      o.detune.value = det;
      o.connect(E.gain(g, this.flt));
      this.oscs.push([o, mult]);
      this.srcs.push(o);
    }
    this.srcs.push(sweep);
    this._start(t);
    this.fadeIn(0.2);
    this._pitch = 1;
  }
  update(info) {
    const p = 1 + clamp(((info.speed || 14) - 14) / 60, 0, 0.3);
    if (Math.abs(p - this._pitch) < 0.004) return;
    this._pitch = p;
    const t = this.E.ac.currentTime;
    for (const [o, mult] of this.oscs) o.frequency.setTargetAtTime(82.41 * mult * p, t, 0.3);
  }
}

/**
 * Oncoming train: two-tone reed horn (F#4 + A4) with blasts on approach and a long blast through the pass,
 * Doppler-shifted from the train's closing speed vs the player, attenuated by distance, panned by lane,
 * plus a rumble that swells as the train nears.
 */
export class TrainVoice {
  constructor(E, out, p) {
    this.E = E;
    this.id = p.id;
    this.lane = p.lane;
    this.z = p.z;
    this.speed = p.speed || 10;
    this.age = 0;
    this.done = false;
    const ac = E.ac, t = ac.currentTime;
    this.panNode = E.hasPanner ? ac.createStereoPanner() : null;
    const head = this.panNode || out;
    if (this.panNode) this.panNode.connect(out);
    this.dist = E.gain(0, head);
    this.gate = E.gain(0, this.dist);
    const lp = E.filter('lowpass', 1600, 0.7, this.gate);
    const body = E.filter('peaking', 820, 1.2, lp);
    body.gain.value = 5;
    this.oscs = [];
    const reed = getWave(ac, 'reed');
    for (const [f, g] of [[369.99, 0.15], [440, 0.13], [369.99 * 1.005, 0.08], [440 * 0.996, 0.07]]) {
      const o = ac.createOscillator();
      o.setPeriodicWave(reed);
      o.frequency.value = f;
      o.connect(E.gain(g, body));
      this.oscs.push([o, f]);
    }
    // rumble: low noise, amplitude-modulated at ~7 Hz (wheels over rail joints)
    this.rumble = E.gain(0, head);
    const rumbleMod = E.gain(0.6, this.rumble);
    const n = ac.createBufferSource();
    n.buffer = E.white;
    n.loop = true;
    n.playbackRate.value = 0.5;
    n.connect(E.filter('lowpass', 150, 0.9, rumbleMod));
    const clack = ac.createOscillator();
    clack.frequency.value = 7;
    clack.connect(E.gain(0.4, rumbleMod.gain));
    this.srcs = [n, clack, ...this.oscs.map((x) => x[0])];
    for (const s of this.srcs) s.start(t);
    // approach pattern: short + long blast
    this._blast(t + 0.03, 0.28);
    this._blast(t + 0.46, 0.85);
    this.longBlast = false;
    this._dop = 1;
  }

  _blast(t, len) {
    const g = this.gate.gain;
    g.setTargetAtTime(1, t, 0.025);
    g.setTargetAtTime(0, t + len, 0.07);
  }

  /** simDt: simulation seconds since last frame (0 while paused); info: game.info; col: live collider or null */
  update(simDt, rawDt, info, col) {
    if (this.done) return;
    this.age += rawDt;
    if (col) { this.z = col.maxZ; if (col.vz > 0) this.speed = col.vz; } else this.z += this.speed * simDt;
    const t = this.E.ac.currentTime;
    const dz = this.z - info.playerZ; // negative: train front is ahead of the player
    const dx = this.lane * LANE_WIDTH - (info.playerX || 0);
    const dy = Math.max(1.2, Math.abs(2 - (info.playerY || 0)));
    const dist = Math.hypot(dx, dy, dz);
    const closing = this.speed + (info.speed || 0);
    const radial = (dz * closing) / dist; // d(dist)/dt: < 0 approaching, > 0 receding
    const dop = clamp(260 / (260 + radial), 0.72, 1.35); // exaggerated speed of sound for a cartoon Doppler
    if (Math.abs(dop - this._dop) > 0.001) {
      this._dop = dop;
      for (const [o, f] of this.oscs) o.frequency.setTargetAtTime(f * dop, t, 0.03);
    }
    const loud = clamp(16 / (dist + 6), 0.28, 1);
    this.dist.gain.setTargetAtTime(dz > 0 ? loud * clamp(1 - dz / 40, 0, 1) : loud, t, 0.05);
    this.rumble.gain.setTargetAtTime(clamp(1 - dist / 50, 0, 1) * 0.35, t, 0.08);
    if (this.panNode) this.panNode.pan.setTargetAtTime(clamp(dx / 7, -0.85, 0.85), t, 0.05);
    if (!this.longBlast && dz > -34 && dz < 0 && this.age > 1.4) {
      this.longBlast = true;
      this._blast(t, clamp(-dz / Math.max(8, closing), 0.3, 2.5) + 0.45);
    }
    if (dz > 42 || this.age > 16) this.stop();
  }

  stop() {
    if (this.done) return;
    this.done = true;
    const t = this.E.ac.currentTime;
    this.dist.gain.cancelScheduledValues(t);
    this.dist.gain.setTargetAtTime(0, t, 0.08);
    this.rumble.gain.cancelScheduledValues(t);
    this.rumble.gain.setTargetAtTime(0, t, 0.08);
    for (const s of this.srcs) { try { s.stop(t + 0.7); } catch { /* */ } }
  }
}
