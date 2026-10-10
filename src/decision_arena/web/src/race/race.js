// The race (stands in for Rail Dash's single-player Game as ctx.game): a start grid, a shared base speed,
// runners bumping and passing each other, the ground collapsing behind them, places and the finish.
// Other systems read `info` (world streaming, effects, audio) and `rig` (effects anchors): both follow the pack.
import { EV } from '../core/events.js';
import { SPEED, PHYS, PLAYER } from '../config.js';
import { HW, HD } from '../gameplay/physics.js';
import { collapseUniform } from '../core/curve.js';
import { Runner } from './runner.js';
import { PackCamera } from './camera.js';

export const RACE = {
  rampSeconds: 110,     // base speed rises from SPEED.start toward SPEED.max on this time scale
  startGap: 30,         // the collapsing edge may be at most this far behind the leader at the start...
  minGap: 6,            // ...shrinking to this...
  closeRate: 0.12,      // ...by this many metres per second
  collapsePace: 0.96,   // the edge's own speed, as a fraction of the base speed
  reach: -0.5,          // a runner this far behind the edge has lost the ground under it
  gridRow: 3.6,         // metres between grid rows
  countdown: 0.8,       // seconds per 3-2-1 step
  bumpCooldown: 0.5,    // seconds after a bump before the same runner can bump again
};

// Starting slots, front row first; the middle lane leads each row.
const SLOTS = [[0, 0], [-1, 0], [1, 0], [0, 1], [-1, 1], [1, 1]];

export class Race {
  constructor(ctx) {
    this.ctx = ctx;
    this.state = 'boot';
    this.info = {
      state: 'boot', time: 0, playerX: 0, playerY: 0, playerZ: 0, lane: 0, targetLane: 0, speed: 0, distance: 0,
      grounded: true, rolling: false, onTrain: false, vy: 0,
      jetpack: false, pogo: false, headstart: false, magnet: false, sneakers: false, multiplier: false, hoverboard: false, invulnerable: false,
      chaserZ: 30, chaserVisible: false,
    };
    this.focus = { ...this.info };
    this.runners = [];
    this.order = [];
    this.rig = null;
    this.races = 0;
    this.t = 0;
    this.base = 0;
    this.winner = null;
    this.countdown = { n: 0, t: 0 };
    this.collapse = { z: 30, speed: 0, dustT: 0 };
    this.camera = new PackCamera(ctx, this);
    this._cols = [];
  }

  start() {
    // keys, mystery boxes and the like belong to single-player progression and do nothing in a race
    this.ctx.level.skipPickups = new Set(['key', 'mysteryBox', 'letter', 'token', 'hoverboardItem']);
  }

  frameInfo() { return this.info; }
  /** Like `info`, but centred on the leader, with its power-ups: effects and sound follow the leader. */
  focusInfo() { return this.focus; }
  isFrozen() { return false; }

  _set(s) {
    const prev = this.state;
    if (prev === s) return;
    this.state = s;
    this.info.state = s;
    this.ctx.events.emit(EV.STATE, { state: s, prev });
  }

  /** seats: [{name, color, character, outfit, controller(runner) -> {think(dt), reset()}}] */
  setup(seats) {
    for (const r of this.runners) r.dispose();
    this.runners = seats.map((seat, index) => {
      const r = new Runner(this, { ...seat, index });
      r.controller = seat.controller(r);
      return r;
    });
    this.toGrid();
  }

  // ------------------------------------------------------------------ flow
  toGrid() {
    const ctx = this.ctx;
    ctx.level.reset({});
    ctx.env.reset?.();
    // Rotate the slots each race, so over several races everyone starts from every slot.
    const n = this.runners.length;
    this.runners.forEach((r, i) => {
      const [lane, row] = SLOTS[(i + this.races) % n];
      r.reset(lane, row * RACE.gridRow);
    });
    this.order = this.runners.slice();
    this._places();
    this.t = 0;
    this.base = 0;
    this.winner = null;
    const rear = Math.max(...this.runners.map((r) => r.b.z));
    this.collapse.z = rear + RACE.startGap - 6;
    this.camera.toGrid();
    this._refreshInfo();   // before the next level.update, which would otherwise stream around the last race
    this._set('menu');
  }

  go() {
    if (this.state !== 'menu' && this.state !== 'gameover') return;
    if (this.state === 'gameover') { this.races++; this.toGrid(); }
    this.countdown.n = 3; this.countdown.t = 0;
    this.camera.toFollow(RACE.countdown * 3);
    this._set('intro');
    this.ctx.events.emit(EV.COUNTDOWN, { n: 3 });
  }

  // ------------------------------------------------------------------ frame
  update(dt, raw) {
    if (this.state === 'intro') this._updateCountdown(raw);
    else if (this.state === 'running') this._updateRace(dt);
    else if (this.state === 'gameover') this._crumbleToWinner(dt);
    const mode = this.state === 'running' ? 'run' : 'menu';
    for (const r of this.runners) r.updateRig(dt, raw, r.alive ? mode : 'menu');
    // the ground falls away behind the edge once the race is on, and stays down until the next grid
    const on = this.state === 'running' || this.state === 'gameover';
    // once the edge has stopped behind the winner, what is falling keeps falling on the clock alone
    const after = this.state === 'gameover' && this.stopT != null ? this.t - this.stopT : 0;
    collapseUniform.value.set(this.collapse.z, on ? 1 : 0, after, 0);
    this.camera.update(raw);
    this._refreshInfo();
  }

  _updateCountdown(raw) {
    const c = this.countdown;
    c.t += raw;
    if (c.t < RACE.countdown) return;
    c.t -= RACE.countdown;
    c.n--;
    this.ctx.events.emit(EV.COUNTDOWN, { n: Math.max(0, c.n) });
    if (c.n > 0) return;
    for (const r of this.runners) { r.status = 'running'; r.rig.trigger?.('start'); }
    this._set('running');
  }

  _updateRace(dt) {
    if (dt <= 0) return;
    this.t += dt;
    this.base = SPEED.start + (SPEED.max - SPEED.start) * (1 - Math.exp(-this.t / RACE.rampSeconds));
    for (const r of this.runners) { r.prevX = r.b.x; r.prevZ = r.b.z; }
    for (const r of this.runners) r.update(dt, this.base);
    this._contacts();
    this._updateCollapse(dt);
    this._places();
    const alive = this.runners.filter((r) => r.alive);
    if (alive.length <= 1 && (this.runners.length > 1 || alive.length === 0)) this._finish(alive[0] || this.order[0]);
  }

  // ------------------------------------------------------------------ runners touching
  /** Running into the back of another runner is a stumble; cutting across into one bounces you back. A runner
   *  high enough above another (a jump, a roof) passes over it. */
  _contacts() {
    const list = this.runners;
    for (let i = 0; i < list.length; i++) {
      const a = list[i];
      if (!a.active || a.player.flight || a.player.invulnT > 0) continue;
      for (let j = i + 1; j < list.length; j++) {
        const b = list[j];
        if (!b.active || b.player.flight || b.player.invulnT > 0) continue;
        const A = a.b, B = b.b;
        // Two runners that swapped sides within one step crossed paths, however far apart they ended up.
        const crossed = Math.sign(a.prevX - b.prevX) * Math.sign(A.x - B.x) < 0;
        if (Math.abs(A.x - B.x) >= 2 * HW + 0.06 && !crossed) continue;
        const ha = A.rollT > 0 ? PLAYER.rollHeight : PLAYER.height;
        const hb = B.rollT > 0 ? PLAYER.rollHeight : PLAYER.height;
        if (A.y >= B.y + hb - 0.15 || B.y >= A.y + ha - 0.15) continue;
        const dz = B.z - A.z;
        const passed = Math.sign((a.prevZ ?? A.z) - (b.prevZ ?? B.z)) * Math.sign(-dz) < 0;   // ran through within a step
        if (Math.abs(dz) >= 2 * HD + 0.1 && !passed) continue;
        const mover = A.laneT < 1 ? a : B.laneT < 1 ? b : null;
        if (crossed) {
          if (A.laneT < 1) this._bounce(a);
          if (B.laneT < 1) this._bounce(b);
          continue;
        }
        if (mover && Math.abs(dz) < 0.45) { this._bounce(mover); continue; }
        // Who was behind before this step, so a runner that passed through another within it is the rear one.
        const rear = (a.prevZ ?? A.z) > (b.prevZ ?? B.z) ? a : b, front = rear === a ? b : a;
        rear.b.z = front.b.z + 2 * HD + 0.12;
        if (this.t - (rear.bumpT ?? -9) < RACE.bumpCooldown) continue;
        rear.bumpT = this.t;
        rear.stumble('runner');
      }
    }
  }

  _bounce(r) {
    if (this.t - r.bounceT < RACE.bumpCooldown) return;   // bounced back already: let it get home
    r.bounceT = this.t;
    const b = r.b;
    const back = b.fromLane;
    b.fromLane = b.lane; b.lane = back; b.laneX0 = b.x; b.laneT = 0; b.laneDur = PHYS.laneSwitchTime * 1.3;
    this.camera.shake(0.12);
  }

  /** The other runners as moving obstacles, for a bot planning around them: the ones it could touch,
   *  by the same rules as `_contacts()`. */
  runnerColliders(self, out) {
    if (self.player.invulnT > 0) return;
    for (const r of this.runners) {
      if (r === self || !r.active || r.player.flight || r.player.invulnT > 0) continue;
      const b = r.b;
      const c = r._col || (r._col = { id: 1e6 + r.index, kind: 'runner', lane: 0, minX: 0, maxX: 0, minY: 0, maxY: 0, minZ: 0, maxZ: 0, vz: 0, top: 'none', ramp: null, moving: true });
      c.lane = b.lane; c.minX = b.x - HW; c.maxX = b.x + HW;
      c.minY = b.y; c.maxY = b.y + (b.rollT > 0 ? PLAYER.rollHeight : PLAYER.height);
      c.minZ = b.z - HD; c.maxZ = b.z + HD; c.vz = -r.speed;
      out.push(c);
    }
  }

  /** After the finish the ground keeps crumbling, up to just behind the winner. */
  _crumbleToWinner(dt) {
    const C = this.collapse, w = this.winner;
    if (dt > 0) this.t += dt;   // the race clock runs on, so what is falling keeps falling
    if (dt <= 0 || this.stopT != null) return;
    const stop = w ? w.b.z + 3 : C.z;
    C.z = Math.min(C.z, Math.max(stop, C.z - Math.max(C.speed, 10) * dt));   // never back
    if (C.z <= stop + 1e-6) this.stopT = this.t;
  }

  // ------------------------------------------------------------------ the collapsing ground
  /** The edge advances behind the pack; everything behind it, track, trains and runners, falls away. */
  _updateCollapse(dt) {
    const C = this.collapse;
    const lead = this.order.find((r) => r.alive);
    const ramp = Math.min(1, this.t / 1.2);
    C.speed = this.base * RACE.collapsePace * (0.3 + 0.7 * ramp);
    C.z -= C.speed * dt;
    const gap = Math.max(RACE.minGap, RACE.startGap - this.t * RACE.closeRate);
    if (lead && C.z > lead.b.z + gap) { C.speed += (C.z - (lead.b.z + gap)) / dt; C.z = lead.b.z + gap; }
    for (const r of this.runners) {
      if (r.alive && r.b.z >= C.z - RACE.reach) {
        r.caught();
        this.camera.shake(0.35);
      }
    }
    // dust thrown up along the edge, and a rumble as it nears the pack
    C.dustT -= dt;
    if (C.dustT <= 0) {
      C.dustT = 0.06;
      this.ctx.fx?.burst?.('land', { x: (Math.random() - 0.5) * 9, y: 0, z: C.z + Math.random() * 2 }, { hard: true });
      if (Math.random() < 0.2) this.ctx.fx?.burst?.('crash', { x: (Math.random() - 0.5) * 8, y: 0.3, z: C.z + 1 });
    }
    const rear = Math.max(...this.runners.filter((r) => r.alive).map((r) => r.b.z), -Infinity);
    if (C.z - rear < 10) this.camera.rumble(0.3);
  }

  // ------------------------------------------------------------------ places and the finish
  onStumble(r) { this.camera.shake(0.15); }
  onCrash(r) { this.camera.shake(0.45); }
  onOut(r) { this.camera.shake(0.3); }

  _places() {
    // Running runners by distance, then the ones who are out, latest out first.
    this.order = this.runners.slice().sort((a, b) => {
      if (a.alive !== b.alive) return a.alive ? -1 : 1;
      if (a.alive) return a.b.z - b.b.z;
      return b.outAt - a.outAt || a.b.z - b.b.z;
    });
    this.order.forEach((r, i) => { r.place = i + 1; });
  }

  _finish(winner) {
    this.winner = winner || null;
    this.stopT = null;
    if (winner && winner.alive) {
      winner.status = 'won';
      winner.rig.trigger?.('celebrate');
    }
    this._set('gameover');
    this.ctx.events.emit(EV.RUN_END, { winner: winner?.name, time: this.t });
  }

  // ------------------------------------------------------------------ what the other systems read
  _refreshInfo() {
    const I = this.info;
    const inRace = this.runners.filter((r) => r.alive || r.status === 'won');
    const pack = inRace.length ? inRace : this.runners;
    const lead = this.order[0] || this.runners[0];
    let front = Infinity, rear = -Infinity;
    for (const r of pack) { front = Math.min(front, r.b.z); rear = Math.max(rear, r.b.z); }
    const b = lead ? lead.b : { x: 0, y: 0, z: 0, lane: 0, vy: 0, grounded: true, rollT: 0 };
    I.state = this.state;
    I.time = this.ctx.time;
    I.playerX = b.x; I.playerY = b.y;
    I.playerZ = Number.isFinite(front) ? (front + rear) / 2 : 0;   // the world streams around the middle of the pack
    I.lane = b.lane; I.targetLane = b.lane;
    // The world's pace (moving trains, spawning) follows the fastest runner, never one that is down.
    I.speed = this.state === 'running' ? Math.max(this.base, ...this.runners.map((r) => (r.active ? r.speed : 0))) : 0;
    I.distance = -I.playerZ;
    I.grounded = b.grounded; I.rolling = b.rollT > 0; I.vy = b.vy;
    I.onTrain = false;
    I.chaserZ = this.collapse.z; I.chaserVisible = false;
    this.rig = lead ? lead.rig : null;
    const F = this.focus, f = lead && lead.player.flight;
    Object.assign(F, I);
    F.playerZ = b.z; F.distance = -b.z;
    F.speed = this.state === 'running' && lead ? lead.speed : 0;
    F.jetpack = !!f && f.kind === 'jetpack'; F.pogo = !!f && f.kind === 'pogo';
    F.magnet = !!lead && lead.timers.magnet > 0; F.sneakers = !!lead && lead.timers.sneakers > 0;
    F.multiplier = !!lead && lead.timers.boost > 0;
    F.grounded = b.grounded && !f;
  }
}
