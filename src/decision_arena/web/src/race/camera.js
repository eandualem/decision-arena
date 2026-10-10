// Race camera. Before the race it faces the start grid. During the race it holds one steady view: from behind
// and to the right, 45 degrees off the track, looking along it, so you see every runner, what is coming at them
// and the ground breaking away behind them. It stays close enough to read each runner, pulling back only as far
// as the pack needs. The camera stands outside the track, so the scenery on the near side is cut away and open
// ground takes its place; the far side's street is the backdrop. C switches to a view from straight behind.
import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/utils.js';

const EDGE = 4.8;             // the corridor's right edge: scenery starts here
const CORRIDOR = 5.35;        // where the track's gravel shoulder ends
const AZIMUTH = Math.PI / 4;  // 45 degrees between looking from behind and looking from the side
const ELEVATION = 0.78;       // camera height per metre of horizontal distance (about 38 degrees down)
const FILL = 0.88;            // the pack fills at most this much of the screen
const NEAR = 13, FAR = 34;    // metres: never closer than this, never further than this
const YARD = 11.5;            // the rail yard beyond the open ground: a second set of tracks, centred this far right
const GROUND_CUT = -0.13;     // the open ground beside the track, just under the track's own shoulder

/** Open ground: gravel and packed earth, one image every 4 m. */
function gravelTexture() {
  const W = 256, c = document.createElement('canvas');
  c.width = c.height = W;
  const g = c.getContext('2d'), img = g.createImageData(W, W), d = img.data;
  for (let i = 0; i < W * W; i++) {
    const n = (Math.random() - 0.5) * 30;
    d[i * 4] = 138 + n; d[i * 4 + 1] = 126 + n; d[i * 4 + 2] = 110 + n * 0.9; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let i = 0; i < 900; i++) {
    const v = 70 + Math.random() * 120, r = 0.8 + Math.random() * 2.6;
    g.fillStyle = `rgba(${v},${v * 0.95},${v * 0.88},0.75)`;
    g.beginPath(); g.ellipse(Math.random() * W, Math.random() * W, r * 1.3, r, Math.random() * 3, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(100, 300);
  t.anisotropy = 8;
  return t;
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class PackCamera {
  constructor(ctx, race) {
    this.ctx = ctx;
    this.race = race;
    this.cam = ctx.camera;
    this.mode = 'grid';
    this.view = ctx.params?.get?.('view') === 'chase' ? 'chase' : 'angle';
    this._fit = new THREE.PerspectiveCamera(50, 1, 0.1, 500);
    this._v = new THREE.Vector3();
    this._off = new THREE.Vector3(Math.sin(AZIMUTH), ELEVATION, Math.cos(AZIMUTH)).normalize();
    this.pos = new THREE.Vector3(0, 2, -8);
    this.look = new THREE.Vector3(0, 1, 0);
    this.fov = 55;
    this.from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
    this.blendT = 0; this.blendDur = 0;
    this.fx = 0; this.fy = 0; this.rearZ = 0; this.leadZ = 0; this.spread = 0;
    this.trauma = 0; this.clock = 0;
    this._t = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
    this._look = new THREE.Vector3();
    // the near side's scenery is cut away (with the world's own cut at the collapse, see Collapse.planes); open
    // ground takes its place, broken off at the collapse like the rest
    this.cut = new THREE.Plane(new THREE.Vector3(-1, 0, 0), 1e6);   // keeps x <= constant
    race.ground.planes.push(this.cut);
    const apron = new THREE.Mesh(new THREE.PlaneGeometry(400, 1200), new THREE.MeshLambertMaterial({ map: gravelTexture() }));
    apron.material.clippingPlanes = [race.ground.plane];
    apron.rotation.x = -Math.PI / 2;
    apron.position.set(EDGE + 200, GROUND_CUT, 0);
    apron.receiveShadow = true;
    apron.frustumCulled = false;
    apron.visible = false;
    ctx.scene.add(apron);
    this.apron = apron;
    // beyond it a rail yard: the race's own track again, standing idle, broken off at the collapse like the rest
    const yardMat = ctx.env.mats.o.clone();
    yardMat.clippingPlanes = [race.ground.plane, new THREE.Plane(new THREE.Vector3(1, 0, 0), -(CORRIDOR + 0.6))];
    yardMat.clipShadows = true;
    this.yard = new THREE.Mesh(ctx.env.track.geometry, yardMat);
    this.yard.matrixAutoUpdate = false;
    this.yard.frustumCulled = false;
    this.yard.receiveShadow = true;
    this.yard.visible = false;
    ctx.scene.add(this.yard);
  }

  toGrid() {
    this.mode = 'grid'; this.blendDur = 0;
    // settle on the grid now, so a transition started before the next frame starts from here
    this._gridPose(this._t);
    this.pos.copy(this._t.pos); this.look.copy(this._t.look); this.fov = this._t.fov;
  }
  toFollow(blend = 1.2) {
    this.from.pos.copy(this.pos); this.from.look.copy(this.look); this.from.fov = this.fov;
    this.blendT = 0; this.blendDur = blend;
    this.mode = 'follow';
    this._reset = true;
  }
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  /** Keep at least this much shake: a steady rumble, the same at any frame rate. */
  rumble(level) { this.trauma = Math.max(this.trauma, level); }
  toggleView() {
    this.view = this.view === 'angle' ? 'chase' : 'angle';
    if (this.mode === 'follow') this.toFollow(0.8);
  }

  /** Runners still in it (everyone, if nobody is). */
  _alive() {
    const list = this.race.runners.filter((r) => r.alive || r.status === 'won' || r.status === 'ready');
    return list.length ? list : this.race.runners;
  }

  _pack() {
    let lead = Infinity, rear = -Infinity, sx = 0, sy = 0, top = 0, bottom = Infinity;
    const list = this._alive();
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

  /** The whole pack from straight behind and above (the C view). */
  _chasePose(raw, out) {
    const p = this._pack();
    if (this._reset) {
      this.fx = p.x * 0.5; this.fy = p.y; this.rearZ = p.rear; this.leadZ = p.lead; this.spread = p.rear - p.lead;
    }
    this.fx = damp(this.fx, p.x * 0.5, 3, raw);
    this.fy = damp(this.fy, p.y, 3, raw);
    this.rearZ = damp(this.rearZ, p.rear, 8, raw);
    this.leadZ = damp(this.leadZ, p.lead, 8, raw);
    this.spread = damp(this.spread, clamp(p.rear - p.lead, 0, 30), 2, raw);
    // a runner high above the rest (a jetpack, a pogo bounce): pull back and aim between the lowest and the
    // highest runner, so both stay in the frame
    this.rise = damp(this.rise || 0, Math.max(0, p.top - p.bottom - 1.5), 3, raw);
    const s = this.spread, up = this.rise, nw = this._narrow();
    out.pos.set(clamp(this.fx, -3.6, 3.6), this.fy + 4.6 + s * 0.08 + up * 0.45 + nw * 1.2, this.rearZ + 7.5 + s * 0.15 + up * 1.1 + nw * 2.2);
    out.look.set(this.fx * 0.6, this.fy + 1.1 + up * 0.3, this.leadZ - 10);
    out.fov = 62 + Math.min(10, s * 0.35);
  }

  /** From behind and to the right, 45 degrees off the track: the pack, the track ahead and the collapse. */
  _anglePose(raw, out) {
    const p = this._pack();
    // the runners and the ground breaking away behind them, whenever it is in reach of the last one
    const C = this.race.collapse;
    const near = C.z - p.rear < 26;
    const rear = near ? Math.max(p.rear, C.z + 4) : p.rear;
    if (this._reset) { this.cz = (p.lead + rear) / 2; this.dist = NEAR; this.my = p.y; this.lx = -3; }
    const w = this.race.state === 'gameover' && this.race.winner;
    this.cz = damp(this.cz, w ? w.b.z : (p.lead + rear) / 2, 4, raw);
    this.my = damp(this.my, (p.bottom + p.top) / 2, 3, raw);
    // aim at the middle of it all, a little toward the far side, so the track runs through the middle of the
    // screen with what is ahead of the leaders in view; at the finish, at the winner
    this.lx = damp(this.lx ?? -3, w ? w.b.x - 0.5 : -3, 2, raw);
    out.look.set(this.lx, this.my + 1, this.cz - (w ? 4 : 1));   // the winner below the title
    // step back until every runner's feet and head, and the edge when it is close, fit on screen
    const F = this._fit;
    F.aspect = this.cam.aspect || 1.6;
    F.fov = 50;
    F.updateProjectionMatrix();
    let dist = this.dist;
    for (let k = 0; k < 4; k++) {
      F.position.copy(out.look).addScaledVector(this._off, dist);
      F.lookAt(out.look);
      F.updateMatrixWorld();
      let m = 0.01;
      const fit = (x, y, z) => { const v = this._v.set(x, y, z).project(F); if (v.z < 1) m = Math.max(m, Math.abs(v.x), Math.abs(v.y)); else m = 9; };
      for (const r of this._alive()) { fit(r.b.x, r.b.y, r.b.z); fit(r.b.x, r.b.y + 2.2, r.b.z); }
      // and, once the edge is close, the ground breaking away just behind it
      if (near) { const b = C.z + (w ? 1 : 4); fit(-2.6, 0, b); fit(2.6, 0, b); }
      dist = clamp(dist * clamp(m / FILL, 0.8, 1.6), NEAR, FAR);
    }
    // widen at once, tighten gently
    this.dist = dist > this.dist ? dist : damp(this.dist, dist, 1.2, raw);
    out.pos.copy(out.look).addScaledVector(this._off, this.dist);
    out.fov = 50;
  }

  /** Cut away the near side for the angled view; restore the full world otherwise. */
  _cutaway(on) {
    this.cut.constant = on ? EDGE : 1e6;
    this.race.ground.nearCut = on;
    this.race.ground.yardX = on ? YARD : null;
    this.apron.visible = this.yard.visible = on;
    if (on) this.apron.position.z = this.pos.z;
    // The world normally bends down toward the horizon and sways a little. Seen from outside the track, the
    // bend makes the track curl away, so the world is flat while the cut is on (see flatten()).
    this.flat = on;
  }

  /** Called after the environment has set this frame's bend and moved the track along. */
  flatten() {
    if (this.flat) this.ctx.curve.value.set(0, 0, this.ctx.curve.value.z);
    if (this.yard.visible) { this.yard.matrix.copy(this.ctx.env.track.matrix); this.yard.matrix.elements[12] += YARD; }
  }

  /** How much narrower than a 16:10 screen this one is (0 on wide screens), so all three lanes stay in view. */
  _narrow() { return Math.max(0, 1.6 / (this.cam.aspect || 1.6) - 1); }

  update(raw) {
    const T = this._t;
    if (this.mode === 'grid') this._gridPose(T);
    else if (this.view === 'chase') this._chasePose(raw, T);
    else this._anglePose(raw, T);
    this._reset = false;
    if (this.mode !== 'grid') T.fov = Math.min(80, T.fov + this._narrow() * 6);
    if (this.blendT < this.blendDur) {
      this.blendT += raw;
      const w = easeInOut(clamp(this.blendT / this.blendDur));
      // swing up and over the grid on the way round
      this.pos.lerpVectors(this.from.pos, T.pos, w);
      this.pos.y += Math.sin(Math.PI * w) * 2.2;
      this.look.lerpVectors(this.from.look, T.look, w);
      this.fov = lerp(this.from.fov, T.fov, w);
    } else if (this.mode === 'grid') {
      const k = 1 - Math.exp(-5 * raw);
      this.pos.lerp(T.pos, k); this.look.lerp(T.look, k); this.fov += (T.fov - this.fov) * k;
    } else { this.pos.copy(T.pos); this.look.copy(T.look); this.fov = T.fov; }

    // cut away the near side from the moment the camera heads out of the corridor, until it is back inside it
    this._cutaway((this.mode === 'follow' && this.view === 'angle') || this.pos.x > EDGE - 0.3);

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
