// One racer: a physics body (gameplay/player.js), its character rig, its pace and power-ups, and whatever
// drives it (a bot or a decision model, set by the race). Exposes `player`, `run`, `ctx` and `_cfg()` in the
// shape the autopilot expects, so the autopilot can drive a runner unchanged.
import { EV } from '../core/events.js';
import { PHYS, FLIGHT, TRAIN, POWERUPS, LANE_WIDTH } from '../config.js';
import { clamp, damp } from '../core/utils.js';
import { createCfg, resetBody, bodyBox } from '../gameplay/physics.js';
import { Player } from '../gameplay/player.js';

export const PACE = {
  streakGain: 0.004,    // pace gained per second of clean running...
  streakMax: 0.1,       // ...up to +10%
  boost: 0.22,          // the boost pickup adds this much pace...
  boostTime: 3.5,       // ...for this long
  stumbleDip: 0.32,     // a stumble costs this fraction of speed, recovering over about a second
  startRamp: 0.6,       // seconds to reach race speed after the start or a crash
  crashDown: 0.7,       // a crash knocks a runner down for this long...
  ghost: 2.0,           // ...then it runs through obstacles for this long while it gets going again
  stumbleGap: 0.35,     // contacts closer together than this count as one stumble
};
const TIMED = ['jetpack', 'sneakers', 'magnet', 'pogo', 'boost'];

export class Runner {
  constructor(race, seat) {
    this.race = race;
    this.ctx = race.ctx;
    this.index = seat.index;
    this.name = seat.name;
    this.color = seat.color;
    this.character = seat.character;
    this.player = new Player(this);
    this.rig = this.ctx.characters.createPlayer(seat.character, seat.outfit);
    this.ctx.scene.add(this.rig.object);
    this.cfg = createCfg();
    this.timers = Object.fromEntries(TIMED.map((t) => [t, 0]));
    this.controller = null;
    this.lean = 0;
    this._box = { minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0 };
    this._collect = { magnet: false, dt: 0, speed: 0, owner: seat.index };
    this._rs = { mode: 'menu', speed: 0, grounded: true, vy: 0, rolling: false, lean: 0, flying: false, pogo: false, board: false, sneakers: false, magnet: false, blink: false, screen: 'race' };
    this._propKey = -1;
    this.reset(0, 0);
  }

  get b() { return this.player.b; }
  /** Still in the race: running, or down after a crash. */
  get alive() { return this.status === 'running' || this.status === 'down'; }
  /** Moving and deciding. */
  get active() { return this.status === 'running'; }

  reset(lane, z) {
    this.player.reset(z);
    resetBody(this.player.b, z, lane);
    for (const t of TIMED) this.timers[t] = 0;
    this.status = 'ready';       // ready | running | down | caught | won
    this.downT = 0;
    this.crashes = 0;
    this.bumpT = -9;
    this.bounceT = -9;
    this.speed = 0;
    this.streak = 0;
    this.dip = 0;
    this.startRamp = 0;
    this.coins = 0;
    this.place = this.index + 1;
    this.outAt = 0;
    this.lastMove = 'keep going';
    this.run = { t: 0, lastStumbleT: -99 };   // the autopilot reads these
    this.stats = { jumps: 0, rolls: 0, laneChanges: 0, stumbles: 0, crashes: 0, decisions: 0 };
    this.rig.object.position.set(this.b.x, this.b.y, this.b.z);
    this.rig.object.visible = true;
    this.controller?.reset?.();
    this._updateProps();
  }

  /** Pace multiplier on the race's base speed: clean running and boosts raise it, stumbles cut it. */
  get pace() {
    return 1 + Math.min(PACE.streakMax, this.streak * PACE.streakGain) + (this.timers.boost > 0 ? PACE.boost : 0);
  }

  _cfg() {
    const c = this.cfg;
    c.jumpV = this.timers.sneakers > 0 ? PHYS.superJumpVelocity : PHYS.jumpVelocity;
    c.doubleJump = false; c.glide = false; c.zap = false;
    c.invulnerable = this.player.invulnT > 0;
    c.strict = false; c.inflateZ = 0;
    return c;
  }

  // ------------------------------------------------------------------ actions: left | right | up | down
  act(a) {
    if (!this.active) return;
    const P = this.player, b = P.b, E = this.ctx.events;
    if (a === 'left' || a === 'right') {
      const from = b.lane;
      if (P.lane(a === 'left' ? -1 : 1, false)) {
        this.stats.laneChanges++;
        E.emit(EV.LANE, { from, to: b.lane, x: b.lane * LANE_WIDTH, runner: this.index });
      }
    } else if (a === 'up') {
      const res = P.jump(this._cfg());
      if (res === 'jump' || res === 'double') this._onJump(res === 'double');
    } else if (a === 'down') {
      const res = P.roll();
      if (res) {
        this.stats.rolls++;
        E.emit(EV.ROLL, { x: b.x, y: b.y, z: b.z, airborne: res === 'air', runner: this.index });
        this.rig.trigger?.('roll');
      }
    }
  }

  _onJump(double) {
    const b = this.b;
    this.stats.jumps++;
    this.ctx.events.emit(EV.JUMP, { x: b.x, y: b.y, z: b.z, super: this.timers.sneakers > 0, double, runner: this.index });
    this.rig.trigger?.(double ? 'doubleJump' : 'jump');
  }

  // ------------------------------------------------------------------ per frame while racing
  update(dt, baseSpeed) {
    if (dt <= 0) return;
    if (this.status === 'down') { this._down(dt); return; }
    if (!this.active) return;
    this.run.t += dt;
    const actions = this.controller ? this.controller.think(dt) : [];
    for (let i = 0; i < actions.length; i++) this.act(actions[i]);
    this._tickTimers(dt);
    this.streak += dt;
    this.dip = Math.max(0, this.dip - dt * 1.1);
    this.startRamp = Math.min(1, this.startRamp + dt / PACE.startRamp);
    const ramp = 1 - (1 - this.startRamp) * (1 - this.startRamp);
    this.speed = baseSpeed * this.pace * (1 - PACE.stumbleDip * this.dip) * (0.3 + 0.7 * ramp);
    const ev = this.player.update(dt, this.speed, this._cfg());
    this._afterMove(ev);
    if (this.active) this._pickups(dt);
  }

  _afterMove(ev) {
    const b = this.b, E = this.ctx.events;
    if (ev.jumped) this._onJump(false);
    if (ev.landed) {
      E.emit(EV.LAND, { x: b.x, y: b.y, z: b.z, fallHeight: ev.fallHeight, onTrain: b.y >= TRAIN.height - 0.3, hard: ev.fallHeight > 2.7, runner: this.index });
      this.rig.trigger?.('land');
      if (ev.flightLanded) this._flightLanded(ev.flightLanded);
    }
    if (ev.hitType === 'stumble') this.stumble(ev.hit?.kind || 'train', ev.hitSide);
    else if (ev.hitType === 'crash') this.crash(ev.hit);
  }

  stumble(kind, side = 1) {
    if (!this.active || this.run.t - this.run.lastStumbleT < PACE.stumbleGap) return;
    const b = this.b;
    this.stats.stumbles++;
    this.streak = 0;
    this.dip = 1;
    this.run.lastStumbleT = this.run.t;
    this.ctx.events.emit(EV.STUMBLE, { x: b.x, y: b.y, z: b.z, side: side || 1, kind, runner: this.index });
    this.rig.trigger?.('stumble');
    this.race.onStumble(this);
  }

  /** A crash knocks the runner down; it gets up again, losing ground the sweeper may make up. */
  crash(hit) {
    if (!this.active) return;
    const b = this.b;
    this.player.die(hit);
    this.ctx.events.emit(EV.CRASH, { x: b.x, y: b.y, z: b.z, kind: hit?.kind || 'train', runner: this.index });
    this.rig.trigger?.('crash');
    this.stats.crashes++;
    this.crashes++;
    this.status = 'down';
    this.downT = PACE.crashDown;
    this.speed = 0;
    this.streak = 0;
    for (const t of TIMED) this.timers[t] = 0;
    this._updateProps();
    this.race.onCrash(this);
  }

  _down(dt) {
    this.player.deathUpdate(dt);
    this.downT -= dt;
    if (this.downT > 0) return;
    this.player.revive();
    this.player.invulnT = PACE.ghost;
    this.player.blinkT = PACE.ghost;
    this.status = 'running';
    this.startRamp = 0;
    this.dip = 0;
    this.rig.trigger?.('revive');
  }

  caught() {
    if (!this.alive) return;
    const b = this.b;
    this.player.die(null);
    this.ctx.events.emit(EV.CAUGHT, { x: b.x, y: b.y, z: b.z, runner: this.index });
    this.rig.trigger?.('caught');
    this._out('caught');
  }

  _out(cause) {
    this.status = cause;
    this.outAt = this.race.t;
    for (const t of TIMED) this.timers[t] = 0;
    this.speed = 0;
    this._updateProps();
    this.race.onOut(this);
  }

  // ------------------------------------------------------------------ pickups and power-ups
  _pickups(dt) {
    const o = this._collect;
    o.magnet = this.timers.magnet > 0; o.dt = dt; o.speed = this.speed;
    const got = this.ctx.level.collect(bodyBox(this.b, this._box), o);
    if (!got || !got.length) return;
    const E = this.ctx.events;
    for (let i = 0; i < got.length; i++) {
      const g = got[i];
      if (g.type === 'coin') {
        this.coins++;
        E.emit(EV.COIN, { x: g.x, y: g.y, z: g.z, total: this.coins, magnet: !!g.magnet, sky: !!g.sky, runner: this.index });
        continue;
      }
      E.emit(EV.PICKUP, { type: g.type, x: g.x, y: g.y, z: g.z, runner: this.index });
      // The 2x-score pickup has no score to double in a race: it is the speed boost instead.
      const type = g.type === 'multiplier' ? 'boost' : g.type;
      if (TIMED.includes(type)) this._startPowerup(type);
    }
  }

  _startPowerup(type) {
    const P = this.player, b = P.b, E = this.ctx.events, lvl = this.ctx.level;
    const d = type === 'boost' ? PACE.boostTime : POWERUPS[type]?.base ?? 8;
    if (type === 'jetpack') {
      P.startFlight('jetpack', FLIGHT.jetpackAltitude);
      lvl.spawnSkyTrail?.({ fromZ: b.z - this.speed * 0.75, length: this.speed * d, y: FLIGHT.jetpackAltitude, kind: 'jetpack' });
    } else if (type === 'pogo') {
      if (P.flight) return;
      P.startPogo(d);
    }
    this.timers[type] = d;
    E.emit(EV.POWERUP_START, { type: type === 'boost' ? 'multiplier' : type, duration: d, runner: this.index });
    this._updateProps();
  }

  _tickTimers(dt) {
    for (const type of TIMED) {
      if (type === 'pogo' || this.timers[type] <= 0) continue;
      this.timers[type] -= dt;
      if (this.timers[type] <= 0) {
        this.timers[type] = 0;
        this.ctx.events.emit(EV.POWERUP_END, { type: type === 'boost' ? 'multiplier' : type, runner: this.index });
        if (type === 'jetpack') this.player.descend();
        this._updateProps();
      }
    }
    if (this.timers.pogo > 0) this.timers.pogo = Math.max(0.001, this.timers.pogo - dt);   // ends on landing
  }

  _flightLanded(kind) {
    const P = this.player;
    if (kind === 'pogo') this.timers.pogo = 0;
    P.invulnT = Math.max(P.invulnT, kind === 'pogo' ? 0.6 : 0.9);
    this._updateProps();
  }

  _updateProps() {
    const f = this.player.flight;
    const jet = !!f && f.kind !== 'pogo', pogo = !!f && f.kind === 'pogo', magnet = this.timers.magnet > 0;
    const key = (jet ? 1 : 0) | (pogo ? 2 : 0) | (magnet ? 4 : 0);
    if (key === this._propKey) return;
    this._propKey = key;
    this.rig.setProps?.({ jetpack: jet, pogo, magnet });
  }

  // ------------------------------------------------------------------ rig
  updateRig(dt, raw, mode) {
    const P = this.player, b = P.b;
    const out = this.status === 'down' || this.status === 'caught';
    const adt = out || mode === 'menu' ? raw : dt;
    if (this.status === 'caught') P.deathUpdate(raw);
    this._updateProps();
    this.rig.object.position.set(b.x, b.y, b.z);
    this.lean = damp(this.lean, clamp(b.vx / 28, -1, 1), 16, adt);
    const s = this._rs;
    s.mode = out ? 'dead' : mode;
    s.speed = this.active ? this.speed : 0;
    s.grounded = b.grounded && !P.flight;
    s.vy = b.vy;
    s.rolling = b.rollT > 0 && !out;
    s.lean = this.lean;
    s.flying = !!P.flight && P.flight.kind !== 'pogo';
    s.pogo = !!P.flight && P.flight.kind === 'pogo';
    s.sneakers = this.timers.sneakers > 0;
    s.magnet = this.timers.magnet > 0;
    s.blink = P.blinkT > 0 && !out;
    this.rig.update(adt, s);
  }

  dispose() {
    this.ctx.scene.remove(this.rig.object);
    this.rig.dispose?.();
  }
}
