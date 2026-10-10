// Rail Dash audio (AUDIOFX): original synthesized music + SFX, driven by game events and state.
// Public API (CONTRACTS 6.6): constructor(ctx), start(), unlock(), setSuspended(hidden), play(name, opts),
// music(track), update(raw, info). Extra: `names` (list of SFX), `engine`, `track`.
import { EV } from '../core/events.js';
import { AudioEngine, mtof } from './engine.js';
import { Music } from './music.js';
import { SFX } from './sfx.js';
import { JetLoop, MagnetLoop, HoverLoop, TrainVoice } from './loops.js';

const LOOKAHEAD = 0.32;       // seconds of music scheduled ahead
const MAX_VOICES = 28;        // one-shot SFX voice cap
// Coin pitch ladder (A minor pentatonic, climbs through a quick streak, then cycles the top four).
const COIN_SCALE = [81, 84, 86, 88, 91, 93, 96, 98, 100];
const COIN_RESET = 0.5;       // seconds without a coin before the ladder resets
const POWERUP_TYPES = new Set(['jetpack', 'sneakers', 'magnet', 'multiplier', 'pogo']);
// Music duck presets per game state: [gain, lowpass cutoff Hz]
const DUCK = {
  none: [1, 20000], paused: [0.5, 650], countdown: [0.62, 1100], dying: [0.5, 480], revive: [0.42, 560],
};

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export class AudioSystem {
  constructor(ctx) {
    this.ctx = ctx;
    this.ac = null;
    this.E = null;
    this.M = null;
    this.unlocked = false;
    this.hidden = false;
    this.wantTrack = null;
    this.voices = [];
    this.lastPlay = Object.create(null);
    this.coinState = { last: -9, streak: 0 };
    this.loops = Object.create(null);
    this.trains = new Map();
    this.state = 'boot';
    this.duck = 'none';
    this._lastSim = null;
    this._results = null;
    this._pendingGameOver = false;
    this._menuAt = 0;
    this._barkAt = -9;
    this._tmpCols = [];
    this.vol = { music: 0.6, sfx: 0.85 };
    this.names = Object.keys(SFX);
  }

  get engine() { return this.E; }
  get track() { return this.M ? this.M.track : this.wantTrack; }

  start() {
    this._applySettings(this.ctx.meta?.settings);
    const E = this.ctx.events, on = (ev, fn) => E.on(ev, (p) => { try { fn(p || {}); } catch (e) { console.warn('[audio]', ev, e); } });
    on(EV.STATE, ({ state, prev }) => this._onState(state, prev));
    on(EV.RUN_START, () => { this._results = null; this.play('whistle', { delay: 0.35 }); this.play('bark', { delay: 0.95 }); this.coinState.streak = 0; });
    on(EV.COUNTDOWN, ({ n }) => (n > 0 ? this.play('tick', { freq: n === 1 ? 1174.7 : 880 }) : this.play('go')));
    on(EV.JUMP, (p) => this.play(p.super ? 'superJump' : p.double ? 'doubleJump' : 'jump'));
    on(EV.ROLL, () => this.play('roll'));
    on(EV.LAND, (p) => this.play(p.hard ? 'landHard' : 'land', { metal: !!p.onTrain }));
    on(EV.LANE, (p) => this.play('lane', { pan: clamp(((p.to ?? 0) - (p.from ?? 0)) * 0.3 + (p.to ?? 0) * 0.2, -0.7, 0.7) }));
    on(EV.STUMBLE, () => this.play('stumble'));   // Decision Arena: no guard whistle or dog bark
    on(EV.CRASH, () => this.play('crash'));
    on(EV.CAUGHT, () => this.play('caught'));
    on(EV.REVIVE, () => { this.play('revive'); this._setDuck('none'); });
    on(EV.REVIVE_OFFER, () => this.play('reviveOffer'));
    on(EV.COIN, (p) => this._coin(p));
    on(EV.PICKUP, (p) => this._pickup(p));
    on(EV.POWERUP_START, ({ type }) => {
      if (type === 'jetpack') this.play('jetpack');
      else if (type === 'magnet') this.play('magnet', { delay: 0.05 });
      else if (type === 'multiplier') this.play('multiplier', { delay: 0.12 });
      else if (type === 'sneakers') this.play('sneakers', { delay: 0.08 });
      else if (type === 'pogo') this.play('pogo');
    });
    on(EV.POWERUP_END, ({ type }) => { if (type !== 'pogo') this.play('powerdown', { vol: type === 'jetpack' ? 1 : 0.7 }); });
    on(EV.HOVERBOARD_START, () => this.play('hoverOn'));
    on(EV.HOVERBOARD_BREAK, () => this.play('hoverBreak'));
    on(EV.HOVERBOARD_END, () => this.play('hoverOff'));
    on(EV.HEADSTART_START, () => this.play('headstart'));
    on(EV.HEADSTART_END, () => this.play('whoosh', { dur: 0.6 }));
    on(EV.SCORE_BOOSTER, () => this.play('boost'));
    on(EV.MISSION_COMPLETE, () => this.play('mission'));
    on(EV.MISSION_SET_COMPLETE, () => this.play('setComplete', { delay: 0.25 }));
    on(EV.DAILY_COMPLETE, () => this.play('mission'));
    on(EV.RUN_RESULTS, (r) => { this._results = r; });
    on(EV.REWARD, (r) => {
      const src = String(r.source || '');
      if (/mystery|box/i.test(src)) this.play('mysteryReveal');
      // missions / daily word already get fanfares; in-run pickups have their own sounds
      else if (this.state !== 'running' && this.state !== 'intro' && !/pickup|mission|^daily$|run|bank/i.test(src)) this.play('purchase');
    });
    on(EV.META_CHANGED, ({ reason }) => { if (reason === 'purchase') this.play('purchase'); });
    on(EV.UI_CLICK, () => this.play('click'));
    on(EV.TOAST, ({ kind }) => { if (kind === 'warn') this.play('error'); });
    on(EV.TUTORIAL_HINT, () => this.play('letter', { vol: 0.55 }));
    on(EV.TRAIN_APPROACH, (p) => this._trainApproach(p));
    on(EV.CHASER, ({ state }) => { if (state === 'catching' || state === 'near') this._bark(0, state === 'near' ? 0.7 : 1); });
    on(EV.SETTINGS, ({ key, settings }) => { if (!key || key === 'music' || key === 'sfx') this._applySettings(settings); });
    // Some browsers need resume() inside a later gesture (main.js only calls unlock() once).
    this._gesture = () => {
      if (!this.ac) return;
      if (this.ac.state !== 'running' && !this.hidden) this.ac.resume?.().catch(() => {});
      else if (this.ac.state === 'running') this._removeGesture();
    };
    for (const n of ['pointerdown', 'keydown', 'touchend']) window.addEventListener(n, this._gesture, true);
    this._onState(this.ctx.game?.state || 'boot');
  }

  _removeGesture() {
    for (const n of ['pointerdown', 'keydown', 'touchend']) window.removeEventListener(n, this._gesture, true);
  }

  // ------------------------------------------------------------------ lifecycle
  /** Build the graph on a given context (unlock() does this with a realtime context; the harness passes an offline one). */
  _attach(ac, engineOpts) {
    this.ac = ac;
    this.E = new AudioEngine(ac, engineOpts);
    this.M = new Music(this.E);
    this.loopBus = this.E.gain(1, this.E.sfxIn);
    this.E.setVolumes(this.vol.music, this.vol.sfx, 0.01);
    this._setDuck(this.duck, true);
    if (this.wantTrack) this.M.play(this.wantTrack, { fadeIn: 0.25 });
  }

  unlock() {
    try {
      if (!this.ac) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return;
        this._attach(new AC({ latencyHint: 'interactive' }));
        this._timer = setInterval(() => this._schedule(), 50);
        this.ac.onstatechange = () => { if (this.ac.state === 'running') this._schedule(); };
      }
      if (this.ac.state !== 'running' && !this.hidden) this.ac.resume?.().catch(() => {});
      // iOS: a (silent) buffer started inside the gesture unlocks output
      const b = this.ac.createBuffer(1, 1, 22050);
      const s = this.ac.createBufferSource();
      s.buffer = b;
      s.connect(this.ac.destination);
      s.start(0);
      this.unlocked = true;
      this._setDuck(this.duck, true);
      if (this.wantTrack && this.M.track !== this.wantTrack) this.M.play(this.wantTrack, { fadeIn: 0.25 });
    } catch (e) {
      console.warn('[audio] unlock failed', e);
    }
  }

  setSuspended(hidden) {
    this.hidden = !!hidden;
    if (!this.ac) return;
    try {
      if (hidden) this.ac.suspend?.().catch(() => {});
      else if (this.unlocked) this.ac.resume?.().catch(() => {});
    } catch { /* ignore */ }
  }

  _applySettings(s) {
    s = s || this.ctx.meta?.settings || {};
    this.vol.music = clamp(+(s.music ?? 0.6) || 0, 0, 1);
    this.vol.sfx = clamp(+(s.sfx ?? 0.85) || 0, 0, 1);
    this.E?.setVolumes(this.vol.music, this.vol.sfx);
  }

  _live() { return !!this.E && (this.E.offline || this.ac.state === 'running'); }

  // ------------------------------------------------------------------ public API
  /**
   * One-shot SFX by name (see `names`). opts: { vol = 1 (mix multiplier), pan (-1..1), delay (s), ...recipe opts }.
   * Returns the sound's duration in seconds (0 if not played).
   */
  play(name, opts = {}) {
    if (!this._live()) return 0;
    const def = SFX[name];
    if (!def) return 0;
    const E = this.E, now = E.now;
    const last = this.lastPlay[name] ?? -9;
    if (def.gap && now - last < def.gap) return 0;
    this._reap(now);
    let same = 0, oldest = null;
    for (const v of this.voices) if (v.name === name) { same++; if (!oldest || v.t < oldest.t) oldest = v; }
    if (same >= (def.max || 3) && oldest) this._steal(oldest, now);
    if (this.voices.length >= MAX_VOICES) this._steal(this.voices[0], now);
    const t = now + 0.004 + Math.max(0, opts.delay || 0);
    const vg = E.gain((opts.vol ?? 1) * def.vol);
    vg.connect(opts.pan ? E.panner(opts.pan, E.sfxIn) : E.sfxIn);
    if (def.rev) vg.connect(E.gain(def.rev, E.sfxRev));
    let dur = 0.5;
    try { dur = def.fn(E, t, opts, vg) || 0.5; } catch (e) { console.warn('[audio] sfx failed', name, e); }
    this.voices.push({ name, g: vg, t, end: t + dur + 0.05 });
    this.lastPlay[name] = now;
    return dur;
  }

  /** Crossfade music: 'menu' | 'run' | null. */
  music(track, opts = {}) {
    this.wantTrack = track || null;
    if (this.M) this.M.play(this.wantTrack, opts);
  }

  update(raw, info) {
    const sim = info ? info.time : 0;
    const simDt = this._lastSim == null ? 0 : clamp(sim - this._lastSim, 0, 0.1);
    this._lastSim = sim;
    if (!this.E || !info) return;
    const now = this.E.now;
    this._schedule();
    // game over: stinger (or the new-best fanfare) once RUN_RESULTS has had a chance to arrive
    if (this._pendingGameOver) {
      this._pendingGameOver = false;
      // Decision Arena ends with a winner, so use the fanfare rather than the defeat jingle.
      if (this.ctx.game?.winner || this._results?.isNewBest) { this.play('highScore', { delay: 0.1 }); this._menuAt = now + 3.4; }
      else { this.M.stinger('gameover'); this._menuAt = now + 3.0; }
    }
    if (this._menuAt && now >= this._menuAt) {
      this._menuAt = 0;
      if (this.state === 'gameover') this.music('menu', { fadeIn: 1.2 });
    }
    const active = this.state === 'running' || this.state === 'intro';
    // music intensity: speed plus flight boosts
    if (this.M.track === 'run') {
      const x = 0.3 + 0.7 * clamp(((info.speed || 14) - 14) / 10, 0, 1);
      const boost = info.jetpack || info.headstart ? 1 : info.pogo ? 0.8 : info.hoverboard ? 0.62 : 0;
      this.M.setIntensity(x, active ? boost : 0);
    }
    // continuous loops
    const flying = active && (info.jetpack || info.headstart);
    this._loop('jet', flying && !info.headstart, () => new JetLoop(this.E, this.loopBus, false));
    this._loop('rocket', active && !!info.headstart, () => new JetLoop(this.E, this.loopBus, true));
    this._loop('magnet', active && !!info.magnet, () => new MagnetLoop(this.E, this.loopBus));
    this._loop('hover', active && !!info.hoverboard, () => new HoverLoop(this.E, this.loopBus));
    this.loops.hover?.update(info);
    // trains: Doppler horns
    if (this.trains.size) {
      const lvl = this.ctx.level;
      for (const [id, v] of this.trains) {
        let col = null;
        if (lvl?.getColliders && simDt > 0) {
          const cols = lvl.getColliders(v.z - 14, v.z + 14, this._tmpCols);
          for (let i = 0; i < cols.length; i++) if (cols[i].id === id) { col = cols[i]; break; }
        }
        v.update(simDt, raw, info, col);
        if (v.done) this.trains.delete(id);
      }
    }
  }

  // ------------------------------------------------------------------ internals
  _schedule() {
    if (!this._live()) return;
    this.M.schedule(this.ac.currentTime + LOOKAHEAD);
    this._reap(this.ac.currentTime);
  }

  _reap(now) {
    const v = this.voices;
    let j = 0;
    for (let i = 0; i < v.length; i++) if (v[i].end > now) v[j++] = v[i];
    v.length = j;
  }

  _steal(voice, now) {
    try { voice.g.gain.cancelScheduledValues(now); voice.g.gain.setTargetAtTime(0, now, 0.012); } catch { /* */ }
    voice.end = now;
    this._reap(now + 0.001);
  }

  _setDuck(mode, force = false) {
    if (!DUCK[mode]) mode = 'none';
    if (mode === this.duck && !force) return;
    this.duck = mode;
    if (!this.E) return;
    const [g, f] = DUCK[mode];
    this.E.setDuck(g, f, mode === 'none' ? 0.18 : 0.1);
    // continuous sounds (loops + train horns) are silent unless the run is live
    this.loopBus?.gain.setTargetAtTime(mode === 'none' ? 1 : 0, this.E.now, 0.06);
  }

  _onState(state, prev) {
    this.state = state;
    switch (state) {
      case 'menu':
        this._menuAt = 0;
        this._setDuck('none');
        this._stopContinuous();
        this.music('menu', { fadeIn: 0.4 });
        break;
      case 'intro':
        this._menuAt = 0;
        this._setDuck('none');
        this._stopContinuous();
        this.music('run', { restart: true, fadeOut: 0.15 });
        this.play('whoosh', { dur: 0.8, vol: 0.8 });
        break;
      case 'running':
        this._setDuck('none');
        if (!this.M?.track && this.wantTrack !== 'run') this.music('run');
        break;
      case 'paused': this._setDuck('paused'); break;
      case 'countdown': this._setDuck('countdown'); break;
      case 'dying':
        this._setDuck('dying');
        this._stopContinuous();
        break;
      case 'revive': this._setDuck('revive'); break;
      case 'gameover':
        this._setDuck('none');
        this._stopContinuous();
        this.music(null, { fadeOut: 0.1 });
        this._pendingGameOver = !!this.E;
        break;
      default: break;
    }
    void prev;
  }

  _stopContinuous() {
    for (const k of Object.keys(this.loops)) { this.loops[k].stop(0.08); delete this.loops[k]; }
    for (const v of this.trains.values()) v.stop();
    this.trains.clear();
  }

  _loop(name, on, make) {
    const cur = this.loops[name];
    if (on && !cur && this._live()) {
      try { this.loops[name] = make(); } catch (e) { console.warn('[audio] loop failed', name, e); }
    } else if (!on && cur) {
      cur.stop(name === 'magnet' ? 0.2 : 0.12);
      delete this.loops[name];
    }
  }

  _coin(p) {
    if (!this._live()) return;
    const now = this.E.now, c = this.coinState;
    c.streak = now - c.last < COIN_RESET ? c.streak + 1 : 0;
    c.last = now;
    const n = COIN_SCALE.length;
    const idx = c.streak < n ? c.streak : n - 4 + ((c.streak - n) % 4);
    // several coins in one frame (magnet showers): stagger into a quick arpeggio instead of stacking
    const t = Math.max(now, c.next || 0);
    if (t - now > 0.12) return;
    c.next = t + 0.04;
    this.play('coin', { freq: mtof(COIN_SCALE[idx]), vol: (p.magnet ? 0.8 : 1) * (1 - idx * 0.03), delay: t - now });
  }

  _pickup(p) {
    const type = p.type;
    if (POWERUP_TYPES.has(type) || type === 'hoverboardItem') this.play('powerup');
    else if (type === 'key') this.play('key');
    else if (type === 'mysteryBox') this.play('mysteryBox');
    else if (type === 'letter') this.play('letter');
    else if (type === 'token') this.play('token');
    else this.play('powerup', { vol: 0.8 });
  }

  _bark(delay = 0, vol = 1) {
    if (!this.E) return;
    const now = this.E.now;
    if (now - this._barkAt < 2.5) return;
    this._barkAt = now;
    this.play('bark', { delay, vol });
  }

  _trainApproach(p) {
    if (!this._live() || (this.state !== 'running' && this.state !== 'intro')) return;
    if (this.trains.has(p.id)) return;
    if (this.trains.size >= 2) {
      // keep the two nearest: drop the farthest existing voice if the new one is closer
      let far = null;
      for (const v of this.trains.values()) if (!far || v.z < far.z) far = v;
      if (far && far.z < p.z) { far.stop(); this.trains.delete(far.id); } else return;
    }
    try { this.trains.set(p.id, new TrainVoice(this.E, this.loopBus, p)); } catch (e) { console.warn('[audio] train voice failed', e); }
  }
}
