// Race camera. Before the race it faces the start grid. During the race a director cuts between close shots,
// like a sports broadcast: behind the leaders, the whole pack, a low fast angle, a look back at the leaders'
// faces, and a "danger" shot when the collapsing ground is about to take someone. At the finish it settles on
// the winner, with the collapse behind the camera. Every shot stays inside the scenery-free corridor over the
// track (and below the bridges), so the buildings on both sides stay whole. C switches to a fixed view of the
// whole pack from behind.
import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/utils.js';

const SIDE = 4.2;           // furthest a camera goes from the track's centre (scenery starts at 4.8)
const CEILING = 12.2;       // bridges over the track are above 13 m
const ROTATION = [['lead', 6], ['pack', 4.5], ['low', 4], ['lead', 5], ['front', 2.8]];
const DANGER = 6;           // metres between the edge and a runner that call for the danger shot

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class PackCamera {
  constructor(ctx, race) {
    this.ctx = ctx;
    this.race = race;
    this.cam = ctx.camera;
    this.mode = 'grid';
    this.view = ctx.params?.get?.('view') === 'chase' ? 'chase' : 'director';
    this.shot = 'lead';
    this.shotT = 0;
    this.step = 0;
    this.danger = null;
    this.pos = new THREE.Vector3(0, 2, -8);
    this.look = new THREE.Vector3(0, 1, 0);
    this.fov = 55;
    this.from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
    this.blendT = 0; this.blendDur = 0;
    this.f = new THREE.Vector3();     // the leaders, smoothed
    this.d = new THREE.Vector3();     // the runner in danger, smoothed
    this.fx = 0; this.fy = 0; this.rearZ = 0; this.leadZ = 0; this.spread = 0;
    this.trauma = 0; this.clock = 0;
    this._t = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
    this._look = new THREE.Vector3();
  }

  toGrid() {
    this.mode = 'grid'; this.blendDur = 0;
    // settle on the grid now, so a transition started before the next frame starts from here
    this._gridPose(this._t);
    this.pos.copy(this._t.pos); this.look.copy(this._t.look); this.fov = this._t.fov;
  }
  toFollow(blend = 1.2) {
    this._blend(blend);
    this.mode = 'follow';
    this.shot = 'lead'; this.shotT = 0; this.step = 0; this.danger = null;
    this._reset = true;
  }
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  /** Keep at least this much shake: a steady rumble, the same at any frame rate. */
  rumble(level) { this.trauma = Math.max(this.trauma, level); }
  toggleView() {
    this.view = this.view === 'director' ? 'chase' : 'director';
    if (this.mode === 'follow') { this._blend(0.8); this._reset = true; }
  }

  _blend(dur) {
    this.from.pos.copy(this.pos); this.from.look.copy(this.look); this.from.fov = this.fov;
    this.blendT = 0; this.blendDur = dur;
  }

  /** Runners still in it, leader first (everyone, if nobody is). */
  _alive() {
    const list = this.race.order.filter((r) => r.alive || r.status === 'won' || r.status === 'ready');
    return list.length ? list : this.race.runners;
  }

  _pack() {
    const list = this._alive();
    let lead = Infinity, rear = -Infinity, sx = 0, sy = 0, top = 0, bottom = Infinity;
    for (const r of list) {
      const b = r.b;
      lead = Math.min(lead, b.z); rear = Math.max(rear, b.z);
      sx += b.x; sy += b.y;
      top = Math.max(top, b.y); bottom = Math.min(bottom, b.y);
    }
    const n = Math.max(1, list.length);
    return { lead, rear, x: sx / n, y: sy / n, top, bottom };
  }

  _gridPose(out) {
    const p = this._pack();
    // in front of the grid, low, looking back at the runners' faces; further back on a narrow screen
    out.pos.set(1.2, 1.9, p.lead - 7.5 - this._narrow() * 2.6);
    out.look.set(0, 1.0, (p.lead + p.rear) / 2 + 0.5);
    out.fov = 58;
  }

  /** The whole pack from behind and above (the C view, and one of the director's shots). */
  _packPose(raw, out) {
    const p = this._pack();
    if (this._reset) {
      this.fx = p.x * 0.5; this.fy = p.y; this.rearZ = p.rear; this.leadZ = p.lead; this.spread = p.rear - p.lead;
    }
    this.fx = damp(this.fx, p.x * 0.5, 3, raw);
    this.fy = damp(this.fy, p.y, 3, raw);
    this.rearZ = damp(this.rearZ, p.rear, 8, raw);
    this.leadZ = damp(this.leadZ, p.lead, 8, raw);
    this.spread = damp(this.spread, clamp(p.rear - p.lead, 0, 30), 2, raw);
    this.rise = damp(this.rise || 0, Math.max(0, p.top - p.bottom - 1.5), 3, raw);
    const s = this.spread, up = this.rise, nw = this._narrow();
    out.pos.set(clamp(this.fx, -3.6, 3.6), this.fy + 4.6 + s * 0.08 + up * 0.45 + nw * 1.2, this.rearZ + 7.5 + s * 0.15 + up * 1.1 + nw * 2.2);
    out.look.set(this.fx * 0.6, this.fy + 1.1 + up * 0.3, this.leadZ - 10);
    out.fov = 62 + Math.min(10, s * 0.35);
  }

  /** Pick the shot: the winner at the end, the runner in danger when the ground is about to take them, else the
   *  next shot in the rotation when this one has run its time. Returns true when the shot changed. */
  _direct(raw) {
    const race = this.race;
    this.shotT += raw;
    let want = this.shot;
    if (race.state === 'gameover') want = 'winner';
    else {
      const alive = race.order.filter((r) => r.alive);
      const last = alive.length > 1 ? alive[alive.length - 1] : null;
      const edge = race.collapse.z;
      const d = this.danger;
      if (d && (d.alive ? edge - d.b.z > DANGER + 3 : (d.fall?.t ?? 9) > 0.6)) this.danger = null;
      if (!this.danger && last && edge - last.b.z < DANGER) this.danger = last;
      if (this.danger) want = 'danger';
      else if (this.shot === 'danger' || this.shot === 'winner' || this.shotT > ROTATION[this.step][1]) {
        if (this.shot !== 'danger' && this.shot !== 'winner') this.step = (this.step + 1) % ROTATION.length;
        want = ROTATION[this.step][0];
        const p = this._pack();
        if (want === 'pack' && p.rear - p.lead > 22) want = 'lead';   // a far pack shot shows nothing well
        if (want === this.shot) { this.shotT = 0; return false; }
      }
    }
    if (want === this.shot) return false;
    this.shot = want;
    this.shotT = 0;
    return true;
  }

  _directorPose(raw, out) {
    const changed = this._direct(raw);
    const alive = this._alive();
    const a = alive[0], b = alive[1] && Math.abs(alive[1].b.z - a.b.z) < 8 ? alive[1] : a;
    const fx = (a.b.x + b.b.x) / 2, fy = Math.min(a.b.y, b.b.y), fz = (a.b.z + b.b.z) / 2;
    const rise = Math.abs(a.b.y - b.b.y);   // one leader high above the other (a jetpack, a pogo bounce)
    if (changed || this._reset) {
      if (!this._reset) this._blend(this.shot === 'danger' ? 0.5 : 0.8);
      this.f.set(fx, fy, fz);
      if (this.danger) this.d.copy(this.danger.b);
      if (this.shot === 'pack') this._reset = true;   // its smoothing starts from where the pack is now
    }
    // the leaders (the first two, if close), smoothed so the camera never jitters with their steps
    this.f.set(damp(this.f.x, fx, 3, raw), damp(this.f.y, fy, 4, raw), damp(this.f.z, fz, 10, raw));
    this.lift = damp(this.lift || 0, rise, 4, raw);
    const F = this.f;
    switch (this.shot) {
      case 'pack': this._packPose(raw, out); break;
      case 'low':     // low and fast, from behind on the left, just outside the left lane's trains
        out.pos.set(-4.15, F.y + 1.7, F.z + 5);
        out.look.set(0.4, F.y + 1.2, F.z - 10);
        out.fov = 64;
        break;
      case 'front':   // ahead of the leaders, looking back at their faces, above any train roof
        out.pos.set(-3.4, F.y + 4.6, F.z - 10);
        out.look.set(0.4, F.y + 1.2, F.z + 1.5);
        out.fov = 52;
        break;
      case 'danger': {   // in front of the runner the ground is about to take, the collapse behind them
        const r = this.danger;
        if (r) this.d.set(damp(this.d.x, r.b.x, 4, raw), damp(this.d.y, r.alive ? r.b.y : this.d.y, 4, raw), damp(this.d.z, r.b.z, 10, raw));
        const D = this.d;
        out.pos.set(3.3, D.y + 4.2, D.z - 7.5);   // above any train roof
        out.look.set(-0.3, D.y + 0.8, D.z + 3);
        out.fov = 58;
        break;
      }
      case 'winner': {   // circling slowly behind the winner, so the collapse stays behind the camera
        const w = this.race.winner || a;
        const ang = 0.35 + Math.min(this.shotT, 12) * 0.06;
        out.pos.set(Math.sin(ang) * 6, w.b.y + 4, w.b.z + Math.cos(ang) * 6);   // above any train alongside
        out.look.set(w.b.x, w.b.y + 1.1, w.b.z - 2);
        out.fov = 50;
        break;
      }
      default:        // 'lead': behind and to the right of the leaders, seeing what is ahead of them
        out.pos.set(3.9, F.y + 3.6, F.z + 7);
        out.look.set(-0.6, F.y + 1.1, F.z - 9);
        out.fov = 60;
    }
    if (this.shot !== 'pack') {
      // both leaders in frame when one is high above the other: aim between them and step back
      const up = this.shot === 'danger' || this.shot === 'winner' ? 0 : this.lift;
      out.look.y += up * 0.5;
      out.pos.y += up * 0.7;
      // on a narrow screen, step back along the view as well as widening it, so the outer lanes fit
      const k = 1 + up * 0.12 + this._narrow() * 0.4;
      out.pos.sub(out.look).multiplyScalar(k).add(out.look);
    }
    out.pos.x = clamp(out.pos.x, -SIDE, SIDE);
    out.pos.y = Math.min(out.pos.y, CEILING);
  }

  /** How much narrower than a 16:10 screen this one is (0 on wide screens), so all three lanes stay in view. */
  _narrow() { return Math.max(0, 1.6 / (this.cam.aspect || 1.6) - 1); }

  update(raw) {
    const T = this._t;
    if (this.mode === 'grid') this._gridPose(T);
    else if (this.view === 'chase') this._packPose(raw, T);
    else this._directorPose(raw, T);
    this._reset = false;
    // a little wider on a narrow screen, so all three lanes fit
    if (this.mode !== 'grid') T.fov = Math.min(80, T.fov + this._narrow() * 6);
    if (this.blendT < this.blendDur) {
      this.blendT += raw;
      const w = easeInOut(clamp(this.blendT / this.blendDur));
      this.pos.lerpVectors(this.from.pos, T.pos, w);
      if (this.mode === 'follow' && this.from.pos.distanceTo(T.pos) > 12) this.pos.y += Math.sin(Math.PI * w) * 1.5;   // swing over long moves
      this.look.lerpVectors(this.from.look, T.look, w);
      this.fov = lerp(this.from.fov, T.fov, w);
    } else if (this.mode === 'grid') {
      const k = 1 - Math.exp(-5 * raw);
      this.pos.lerp(T.pos, k); this.look.lerp(T.look, k); this.fov += (T.fov - this.fov) * k;
    } else { this.pos.copy(T.pos); this.look.copy(T.look); this.fov = T.fov; }

    this.clock += raw;
    this.trauma = Math.max(0, this.trauma - raw * 1.6);
    const amt = this.trauma * this.trauma, t = this.clock;
    const sx = amt * 0.3 * Math.sin(t * 37.1), sy = amt * 0.22 * Math.sin(t * 43.3 + 0.7);
    const cam = this.cam;
    cam.position.set(this.pos.x + sx, this.pos.y + sy, this.pos.z);
    this._look.set(this.look.x + sx * 0.5, this.look.y + sy * 0.5, this.look.z);
    cam.lookAt(this._look);
    cam.fov = this.fov;
    cam.updateProjectionMatrix();
  }
}
