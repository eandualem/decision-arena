// PlayerRig: procedural animation state machine driven only by update(dt, s) + trigger(name).
import * as THREE from 'three';
import { J, R, NJ, newPose, lerpPose, blendJoints, ARM_R } from './skeleton.js';
import { CharacterBody } from './model.js';
import * as A from './anim.js';
import { makeJetpack, makePogo, makeMagnet, makeCan, makeCoil, POGO_TIP } from './props.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const sat = (v) => clamp(v, 0, 1);
const damp = (a, b, l, dt) => a + (b - a) * (1 - Math.exp(-l * dt));
const easeInOut = (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
const ROLL_DUR = 0.62;

// crossfade durations (seconds) into a state
const FADE_IN = { idle: 0.35, boardIdle: 0.3, run: 0.14, air: 0.09, roll: 0.06, board: 0.2, boardAir: 0.1, boardDuck: 0.08,
  fly: 0.3, pogo: 0.14, crash: 0.05, caught: 0.08, celebrate: 0.2, start: 0.12, revive: 0.1 };
// faces per state
const FACE = { idle: 'idle', boardIdle: 'cool', run: 'run', air: 'excited', roll: 'focus', board: 'cool', boardAir: 'excited', boardDuck: 'focus',
  fly: 'excited', pogo: 'excited', crash: 'hurt', caught: 'sad', celebrate: 'happy', start: 'cool', revive: 'excited' };
const ONESHOT_DUR = { celebrate: 1.7, start: A.START_DUR, revive: 0.75 };

function mulberry(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), s | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion();

export class PlayerRig {
  constructor(def, model, opts = {}) {
    this.id = def.id;
    this.outfit = model.outfit;
    this.def = def;
    this.model = model;
    this.body = new CharacterBody(model, { name: 'player', castShadow: opts.castShadow });
    this.object = this.body.object;
    this.height = model.height;
    this.rand = mulberry(hashStr(def.id + (opts.seed || '')));
    const rp = model.rp, b = this.body;

    // ---------------- anchors (FX reads world positions)
    const info = model.info;
    const mk = (name) => { const o = new THREE.Object3D(); o.name = 'anchor:' + name; return o; };
    this.anchors = {
      back: b.attach('chest', mk('back'), (info.anchors && info.anchors.back) || [0, rp[J.chest].y + 0.02, 0.32]),
      handR: b.attach('handR', mk('handR'), [rp[J.handR].x, rp[J.handR].y - 0.08, rp[J.handR].z]),
      handL: b.attach('handL', mk('handL'), [rp[J.handL].x, rp[J.handL].y - 0.08, rp[J.handL].z]),
      feet: mk('feet'),
      head: b.attach('head', mk('head'), (info.anchors && info.anchors.headTop) || [0, 1.66, 0]),
      jetL: null, jetR: null,
    };
    this.object.add(this.anchors.feet);

    // ---------------- props
    this.jet = makeJetpack();
    b.attach('chest', this.jet.group, [0, rp[J.chest].y + 0.0, info.jetpackZ ?? 0.3]);
    this.jet.group.visible = false;
    this.anchors.jetL = this.jet.jetL; this.anchors.jetR = this.jet.jetR;
    this.pogoProp = makePogo();
    this.body.inner.add(this.pogoProp.group);
    this.pogoProp.group.visible = false;
    this.magnet = makeMagnet();
    b.attach('handR', this.magnet.group, [rp[J.handR].x - 0.005, rp[J.handR].y - 0.03, rp[J.handR].z - 0.01]);
    this.magnet.group.visible = false;
    this.can = makeCan();
    b.attach('handR', this.can.group, [rp[J.handR].x - 0.01, rp[J.handR].y - 0.06, rp[J.handR].z - 0.02]);
    this.can.group.rotation.x = -1.2;
    this.can.group.visible = false;
    this.coils = [];
    for (const fj of ['footL', 'footR']) {
      const c = makeCoil();
      const fp = rp[J[fj]];
      b.attach(fj, c.group, [fp.x, 0.005, fp.z - 0.05]);
      c.group.visible = false;
      this.coils.push(c);
    }
    this.props = { jetpack: false, pogo: false, magnet: false };
    this.board = null;

    // ---------------- animation state
    this.pose = newPose(); this.base = newPose(); this.target = newPose(); this.snap = newPose(); this.tmp = newPose();
    this.state = ''; this.stateT = 0; this.fade = 1; this.fadeDur = 0.2;
    this.time = 0; this.phase = 0;
    this.one = null; this.oneT = 0; this.oneDur = 0;
    this.airT = 9; this.rollT = 9; this.rollActive = false; this.landT = 9; this.landHard = 0;
    this.stumbleT = 9; this.stumbleSide = 1;
    this.deathKind = 'crash'; this.deadT = 0; this.wasDead = false;
    this.lean = 0; this.magnetW = 0; this.jetW = 0; this.lift = 0; this.pogoComp = 0;
    this.flip = { on: false, t: 0, dur: 0.5, delay: 0, hurry: false };
    this.spin = { on: false, t: 0, dur: 0.6, dir: 1 };
    this.prevVy = 0; this.pogoTrick = false;
    // menu idle
    this.look = { yaw: 0, pitch: 0, tYaw: 0, tPitch: 0.05, eyeX: 0, eyeY: 0, next: 1.2 };
    this.gesture = null; this.gestureT = 0; this.nextGesture = 2.5 + this.rand() * 2.5;
    this.blinkIn = 1.5 + this.rand() * 2; this.blinking = 0;
    this.faceExpr = 'idle';
    this.visible = true; this.blinkClock = 0;
    this._s = { mode: 'menu', speed: 0, grounded: true, vy: 0, rolling: false, lean: 0 };
    this._init = false;
    // secondary motion on extra bones (antenna, tail, buns...)
    this.jiggles = (model.extras || []).filter((e) => e.jiggle).map((e) => ({
      bone: this.body.byName[e.name], cfg: e.jiggle, ax: 0, az: 0, vx: 0, vz: 0,
      prev: new THREE.Vector3(), prevVel: new THREE.Vector3(), has: false,
    }));
  }

  // =================================================================== public API
  trigger(name) {
    switch (name) {
      case 'jump': this.airT = 0; if (this.rollActive) this._endRoll(); break;
      case 'doubleJump': this.airT = 0.05; this._startFlip(0.46, 0.02); if (this.rollActive) this._endRoll(); break;
      case 'roll': this.rollT = 0; this.rollActive = true; if (!this.board && !this._lastBoard) this._startFlip(0.46, 0.05); break;
      case 'land': this.landT = 0; this.landHard = Math.min(1, Math.max(0.5, -this.prevVy / 20)); break;
      case 'stumble': this.stumbleT = 0; this.stumbleSide = this.lean > 0.05 ? -1 : this.lean < -0.05 ? 1 : (this.rand() < 0.5 ? -1 : 1); break;
      case 'crash': this.deathKind = 'crash'; this.deadT = 0; this._cancelOne(); break;
      case 'caught': this.deathKind = 'caught'; this.deadT = 0; this._cancelOne(); break;
      case 'revive': this._setOne('revive'); this._startSpin(0.6, 1); this.deadT = 0; break;
      case 'celebrate': this._setOne('celebrate'); break;
      case 'start': this._setOne('start'); this.phase = 0; break;
      default: break;
    }
  }

  setBoard(board) {
    if (this.board === board) return;
    if (this.board && this.board.object.parent === this.body.carve) this.body.carve.remove(this.board.object);
    this.board = board || null;
    if (this.board) {
      this.body.carve.add(this.board.object);
      this.board.object.position.set(0, 0, 0);
      this.board.object.rotation.set(0, 0, 0);
    }
  }

  setProps(p = {}) {
    if ('jetpack' in p) this.props.jetpack = !!p.jetpack;
    if ('pogo' in p) this.props.pogo = !!p.pogo;
    if ('magnet' in p) this.props.magnet = !!p.magnet;
  }

  dispose() {
    this.setBoard(null);
    this.jet.dispose(); this.magnet.dispose();
    this.body.dispose();
  }

  // =================================================================== internals
  _setOne(name) { this.one = name; this.oneT = 0; this.oneDur = ONESHOT_DUR[name] || 1; }
  _cancelOne() { this.one = null; }
  _startFlip(dur, delay) { const f = this.flip; f.on = true; f.t = 0; f.dur = dur; f.delay = delay; f.hurry = false; }
  _startSpin(dur, dir) { const s = this.spin; s.on = true; s.t = 0; s.dur = dur; s.dir = dir; }
  _endRoll() { this.rollActive = false; this.rollT = 9; if (this.flip.on) this.flip.hurry = true; }

  _pickState(s) {
    const mode = s.mode || 'menu';
    if (mode === 'dead') return this.deathKind === 'caught' ? 'caught' : 'crash';
    if (this.one && this.oneT < this.oneDur) return this.one;
    const onBoard = !!this.board || !!s.board;
    if (mode === 'menu') return onBoard ? 'boardIdle' : 'idle';
    if (s.flying) return 'fly';
    if (s.pogo) return 'pogo';
    if (onBoard) return s.rolling ? 'boardDuck' : (s.grounded === false ? 'boardAir' : 'board');
    if (this.rollActive || s.rolling) return 'roll';
    if (s.grounded === false) return 'air';
    return 'run';
  }

  _enter(st, prev) {
    // snapshot the current base pose for the crossfade; normalize root angles
    this.snap.set(this.base);
    for (const k of [R.pitch, R.yaw, R.roll]) { let a = this.snap[k] % TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; this.snap[k] = a; }
    this.fadeDur = FADE_IN[st] ?? 0.16;
    if (prev === 'roll' || prev === 'boardDuck') this.fadeDur = Math.max(this.fadeDur, 0.14);
    if (prev === 'fly') this.fadeDur = 0.3;
    if (prev === 'crash' || prev === 'caught') this.fadeDur = 0.12;
    if (!prev) this.fadeDur = 0;
    this.fade = this.fadeDur > 0 ? 0 : 1;
    this.stateT = 0;
    if (st === 'roll' && !this.rollActive) { this.rollActive = true; this.rollT = 0; this._startFlip(0.46, 0.05); }
    if ((st === 'boardDuck' || st === 'board' || st === 'boardAir') && this.flip.on) this.flip.hurry = true;
    if (prev === 'roll' && st !== 'roll') this._endRoll();
    if (st !== 'idle') this.gesture = null;
    if (st === 'pogo') { this.pogoTrick = false; }
  }

  update(dt, s) {
    s = s || this._s;
    if (!(dt >= 0)) dt = 0;
    const first = !this._init;
    this._init = true;
    const frozen = dt === 0 && !first;
    // invulnerability blink
    if (s.blink && !frozen) { this.blinkClock += dt; this.object.visible = Math.floor(this.blinkClock * 12) % 2 === 0; }
    else if (!s.blink) { this.object.visible = true; this.blinkClock = 0; }
    this._propsVisibility(s);
    this._lastBoard = !!s.board;
    if (frozen) return;
    this.time += dt;
    const mode = s.mode || 'menu';

    // ---- timers
    this.oneT += dt; this.airT += dt; this.landT += dt; this.stumbleT += dt; this.deadT += dt; this.stateT += dt;
    if (this.rollActive) { this.rollT += dt; if (this.rollT >= ROLL_DUR && !s.rolling) this._endRoll(); if (this.rollT > ROLL_DUR + 0.3) this._endRoll(); }
    if (this.one && this.oneT >= this.oneDur) this.one = null;
    if (mode !== 'dead' && this.wasDead && !this.one) { /* revived without trigger */ }
    this.wasDead = mode === 'dead';
    const speed = s.speed > 0 ? s.speed : 14;
    const vy = s.vy || 0;
    this.lean = damp(this.lean, mode === 'dead' ? 0 : clamp(s.lean || 0, -1, 1), 14, dt);

    // ---- state
    const st = this._pickState(s);
    if (st !== this.state) { this._enter(st, this.state); this.state = st; }
    if (this.fade < 1) this.fade = Math.min(1, this.fade + dt / Math.max(0.001, this.fadeDur));

    // ---- run phase (keeps running under other states so fades back into the run are continuous)
    if (mode !== 'menu') this.phase = (this.phase + dt * TAU * (1.9 + speed * 0.045)) % (TAU * 1000);

    // ---- evaluate the target pose for the state
    const T = this.target;
    const runC = { k: sat((speed - 14) / 16), spring: !!s.sneakers };
    let face = FACE[st] || 'run';
    let lookX = 0, lookY = 0;
    switch (st) {
      case 'idle': face = this._idle(T, dt, s); lookX = this.look.eyeX; lookY = this.look.eyeY; break;
      case 'run': A.run(T, this.phase, runC); lookY = -0.3; break;
      case 'air': {
        A.air(T, { vy, t: this.airT, flail: sat((-vy - 8) / 10) * sat(this.airT - 0.3) });
        face = vy < -14 ? 'surprised' : (this.flip.on ? 'happy' : 'excited');
        break;
      }
      case 'roll': A.roll(T, Math.min(this.rollT, ROLL_DUR - 0.001), ROLL_DUR); break;
      case 'board': case 'boardIdle': case 'boardAir': case 'boardDuck': {
        A.board(T, { t: this.time, lean: st === 'boardIdle' ? 0 : this.lean, air: st === 'boardAir' ? 1 : 0, crouch: st === 'boardDuck' ? 1 : 0,
          grab: st === 'boardAir' ? sat((this.airT - 0.12) / 0.2) * (1 - sat((vy + 8) / -6)) : 0 });
        break;
      }
      case 'fly': A.fly(T, this.time, { boost: 0 }); break;
      case 'pogo': {
        // compress the spring on the way down near the ground and at launch
        const launch = 1 - sat(this.stateT / 0.18);
        this.pogoComp = damp(this.pogoComp, Math.max(launch, vy < -6 ? 0 : 0), 20, dt);
        A.pogo(T, this.time, { vy, compress: this.pogoComp });
        if (this.prevVy > 1.5 && vy <= 1.5 && !this.pogoTrick) { this.pogoTrick = true; this._startSpin(0.7, 1); }
        face = vy > 2 ? 'excited' : this.spin.on ? 'happy' : 'surprised';
        break;
      }
      case 'crash': A.crash(T, this.deadT); face = this.deadT < 0.7 ? 'hurt' : 'dizzy'; break;
      case 'caught': A.caught(T, this.deadT); face = this.deadT < 0.3 ? 'surprised' : 'sad'; break;
      case 'celebrate': A.celebrate(T, this.oneT); break;
      case 'start': {
        A.run(this.tmp, this.phase, runC);
        A.startPose(T, this.oneT, this.tmp);
        face = this.oneT < 0.46 ? 'cool' : this.oneT < 0.7 ? 'surprised' : 'run';
        break;
      }
      case 'revive': A.revive(T, this.oneT); break;
      default: A.stand(T);
    }

    // ---- crossfade into the base pose
    if (this.fade < 1) lerpPose(this.base, this.snap, T, easeInOut(this.fade));
    else this.base.set(T);
    const P = this.pose;
    P.set(this.base);

    // ---- overlays
    const running = st === 'run' || st === 'air' || st === 'board' || st === 'boardAir';
    if (this.landT < 0.26 && (st === 'run' || st === 'board' || st === 'roll')) {
      const w = Math.pow(1 - this.landT / 0.26, 2) * this.landHard;
      if (st !== 'roll') A.land(P, w);
    }
    if (this.stumbleT < 0.65 && (running || st === 'roll')) {
      const w = A.smooth(0, 0.06, this.stumbleT) * (1 - A.smooth(0.3, 0.65, this.stumbleT));
      A.stumble(P, this.stumbleT, w, this.stumbleSide);
      if (w > 0.3) face = 'scared';
    }
    // magnet in the right hand
    const magOn = (this.props.magnet || !!s.magnet) && (running || st === 'idle' || st === 'boardIdle' || st === 'start');
    this.magnetW = damp(this.magnetW, magOn ? 1 : 0, 10, dt);
    if (this.magnetW > 0.001) { A.magnetArm(this.tmp, this.time); blendJoints(P, this.tmp, this.magnetW, ARM_R); }
    // lane lean (bank + look into the move)
    if (mode === 'run' && st !== 'crash' && st !== 'caught') {
      const L = this.lean;
      P[J.spine * 3 + 2] += -L * 0.12;
      P[J.head * 3 + 1] += -L * 0.16;
      P[J.head * 3 + 2] += L * 0.08;
      if (st === 'run' || st === 'air') {
        P[J.armL * 3 + 2] -= Math.max(0, L) * 0.55;
        P[J.armR * 3 + 2] += Math.max(0, -L) * 0.55;
        P[J.thighL * 3 + 2] -= Math.max(0, -L) * 0.2;
        P[J.thighR * 3 + 2] += Math.max(0, L) * 0.2;
      }
    }
    const onBoardState = st === 'board' || st === 'boardAir' || st === 'boardDuck' || st === 'boardIdle';
    this.body.carve.rotation.z = -this.lean * (onBoardState ? 0.42 : st === 'fly' ? 0.5 : 0.26);
    this.body.carve.rotation.y = -this.lean * (onBoardState ? 0.12 : 0.2);

    // ---- flip / spin channels
    const f = this.flip;
    if (f.on) {
      f.t += dt * (f.hurry ? 3.2 : 1);
      const u = sat((f.t - f.delay) / f.dur);
      this.body.flipX = -TAU * easeInOut(u);
      if (u >= 1) { f.on = false; this.body.flipX = 0; }
    } else this.body.flipX = 0;
    const sp = this.spin;
    if (sp.on) {
      sp.t += dt;
      const u = sat(sp.t / sp.dur);
      this.body.spinY = sp.dir * TAU * easeInOut(u);
      if (u >= 1) { sp.on = false; this.body.spinY = 0; }
    } else this.body.spinY = 0;

    // ---- vertical lift (board deck, pogo, spring kicks)
    let liftT = 0;
    if (onBoardState && this.board) liftT = this.board.topY ?? 0.24;
    else if (onBoardState) liftT = 0.2;
    if (st === 'pogo') liftT = POGO_TIP - 0.12 * this.pogoComp;
    if (s.sneakers && !onBoardState && st !== 'pogo' && st !== 'fly') liftT += 0.07;
    this.lift = st === 'pogo' || onBoardState ? damp(this.lift, liftT, 22, dt) : damp(this.lift, liftT, 14, dt);
    this.body.lift = this.lift;

    this.body.applyPose(P);
    this.prevVy = vy;

    // ---- props animation
    if (this.pogoProp.group.visible) this.pogoProp.spring.scale.y = 1 - 0.35 * this.pogoComp;
    if (this.jet.group.visible) {
      const on = !!s.flying;
      const fl = 0.85 + Math.sin(this.time * 47) * 0.1 + Math.sin(this.time * 31) * 0.08;
      for (const fm of this.jet.flames) { fm.visible = on; fm.scale.set(1, fl * (1 + Math.max(0, -this.lean * 0) ), 1); }
    }
    if (this.magnet.group.visible) this.magnet.glow.material.opacity = 0.35 + 0.2 * Math.sin(this.time * 9);

    // ---- face
    this._faceUpdate(dt, face, lookX, lookY);
    // ---- secondary motion
    if (this.jiggles.length) this._jiggle(dt);
  }

  _propsVisibility(s) {
    const jet = this.props.jetpack || !!s.flying;
    this.jet.group.visible = jet;
    this.body.setGroupVisible('back', !jet);
    this.pogoProp.group.visible = this.props.pogo || !!s.pogo;
    this.magnet.group.visible = this.props.magnet || !!s.magnet;
    const snk = !!s.sneakers;
    for (const c of this.coils) c.group.visible = snk;
    const g = this.gesture && A.GESTURES[this.gesture];
    const canOn = (this.state === 'start' && this.oneT > 0.04 && this.oneT < 0.62) || (this.state === 'idle' && g && g.prop === 'can');
    this.can.group.visible = !!canOn && !this.magnet.group.visible;
    if (this.board) this.board.object.visible = !(s.flying || s.pogo);
  }

  // ---------------- menu idle: breathing, weight shift, looking around, occasional gesture
  _idle(T, dt, s) {
    const L = this.look;
    L.next -= dt;
    if (L.next <= 0) {
      if (this.rand() < 0.45) { L.tYaw = 0; L.tPitch = 0.05; }
      else { L.tYaw = (this.rand() * 2 - 1) * 0.55; L.tPitch = (this.rand() * 2 - 1) * 0.16; }
      L.next = 1.4 + this.rand() * 2.4;
    }
    // eyes lead, head follows
    L.eyeX = damp(L.eyeX, -L.tYaw * 1.4, 18, dt);
    L.eyeY = damp(L.eyeY, -L.tPitch * 2.2, 18, dt);
    L.yaw = damp(L.yaw, L.tYaw, 3.2, dt);
    L.pitch = damp(L.pitch, L.tPitch, 3.2, dt);
    A.idle(T, this.time, { lookYaw: L.yaw, lookPitch: L.pitch, tilt: 0.04 });
    let face = 'idle';
    // gestures
    const menuScreen = s.screen;
    if (!this.gesture) {
      this.nextGesture -= dt;
      if (this.nextGesture <= 0 && this.stateT > 1.2) {
        const list = this.def.gestures || ['wave'];
        this.gesture = list[Math.floor(this.rand() * list.length)];
        this.gestureT = 0;
        const G = A.GESTURES[this.gesture];
        if (G && G.spin) this._startSpin(1.1, this.rand() < 0.5 ? -1 : 1);
      }
    }
    if (this.gesture) {
      const G = A.GESTURES[this.gesture];
      if (!G) this.gesture = null;
      else {
        this.gestureT += dt;
        const w = A.smooth(0, 0.3, this.gestureT) * (1 - A.smooth(G.dur - 0.35, G.dur, this.gestureT));
        G.fn(T, this.gestureT, w);
        if (w > 0.35 && G.face) face = G.face;
        if (this.gestureT >= G.dur) { this.gesture = null; this.nextGesture = 4.5 + this.rand() * 4.5; }
      }
    }
    void menuScreen;
    return face;
  }

  /** Force a specific menu gesture now (UI "tap the character" / showcase). */
  playGesture(name) {
    if (!A.GESTURES[name]) return false;
    this.gesture = name; this.gestureT = 0;
    if (A.GESTURES[name].spin) this._startSpin(1.1, 1);
    return true;
  }

  _faceUpdate(dt, expr, lx, ly) {
    const f = this.body.face;
    if (!f) return;
    this.blinkIn -= dt;
    if (this.blinking > 0) { this.blinking -= dt; }
    else if (this.blinkIn <= 0) { this.blinking = 0.11; this.blinkIn = 1.8 + this.rand() * 3.2; if (this.rand() < 0.15) this.blinkIn = 0.25; }
    this.faceExpr = expr;
    f.set(expr, lx, ly, this.blinking > 0);
  }

  _jiggle(dt) {
    if (dt <= 0) return;
    for (const j of this.jiggles) {
      const bone = j.bone, c = j.cfg;
      bone.parent.getWorldPosition(_v);
      if (!j.has) { j.prev.copy(_v); j.prevVel.set(0, 0, 0); j.has = true; continue; }
      _v2.copy(_v).sub(j.prev).divideScalar(dt);          // velocity
      j.prev.copy(_v);
      if (_v2.lengthSq() > 3600) { j.prevVel.set(0, 0, 0); continue; } // teleport
      const acc = _v.copy(_v2).sub(j.prevVel).divideScalar(dt);
      j.prevVel.copy(_v2);
      bone.parent.getWorldQuaternion(_q).invert();
      acc.applyQuaternion(_q);
      const g = c.gain ?? 0.0025;
      // upright appendages (antenna, buns): lean against the acceleration around x/z.
      // trailing appendages (tails): bounce with vertical acceleration (x), swing sideways around y.
      const tail = !!c.wag;
      const tx = clamp(tail ? acc.y * g * 0.6 : acc.z * g + acc.y * g * (c.vert ?? 0.5), -0.9, 0.9);
      const tz = clamp(tail ? acc.x * g : -acc.x * g, -0.9, 0.9);
      const k = c.k ?? 120, d = c.d ?? 12;
      j.vx += (-(j.ax - tx) * k - j.vx * d) * dt; j.ax += j.vx * dt;
      j.vz += (-(j.az - tz) * k - j.vz * d) * dt; j.az += j.vz * dt;
      j.ax = clamp(j.ax, -1, 1); j.az = clamp(j.az, -1, 1);
      const base = c.base || [0, 0, 0];
      if (tail) {
        const wag = Math.sin(this.time * c.wag[0]) * c.wag[1] * (1 + (this.state === 'run' ? 0.6 : 0));
        bone.rotation.set(base[0] + j.ax, base[1] + j.az + wag, base[2]);
      } else {
        bone.rotation.set(base[0] + j.ax, base[1], base[2] + j.az);
      }
    }
  }
}
