// Race camera. Before the race it faces the start grid. During the race it holds one steady view: from behind
// and to the right, 45 degrees off the track, looking along it, so you see every runner still in the race and
// what is coming at them, as close as that allows: it moves in as runners go out. The ground breaking away
// behind them joins the frame only when it is about to take someone. The camera stands outside the track, so the
// scenery on the near side is cut away and open ground takes its place; the far side's street is the backdrop.
// C switches to a view from straight behind.
import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/utils.js';
import { YARD } from './collapse.js';

const EDGE = 4.8;             // the corridor's right edge: scenery starts here
const CORRIDOR = 5.35;        // where the track's gravel shoulder ends
const AZIMUTH = Math.PI / 4;  // 45 degrees between looking from behind and looking from the side
const ELEVATION = 0.78;       // camera height per metre of horizontal distance (about 38 degrees down)
const FILL = 0.88;            // the pack fills at most this much of the screen
const NEAR = 9, FAR = 40;     // metres: never closer than this, never further than this
const AHEAD = 22;             // metres of track ahead of the leader kept in view
const CLOSE = 7;              // the edge joins the frame once it is this close to the last runner
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

const RAIL_POST = 2.5;         // metres between the railing's posts

/** A low steel railing along the open ground, 400 m of it, broken off at the collapse like the rest. */
function railing(ground) {
  const mat = new THREE.MeshLambertMaterial({ color: 0x8d949c });
  mat.clippingPlanes = [ground.plane];
  ground.edged(mat);
  const n = 160, posts = new THREE.InstancedMesh(new THREE.BoxGeometry(0.08, 1.1, 0.08), mat, n + 1);
  for (let i = 0; i <= n; i++) posts.setMatrixAt(i, new THREE.Matrix4().makeTranslation(0, 0.55, (i - n / 2) * RAIL_POST));
  const g = new THREE.Group();
  g.add(posts);
  for (const y of [0.55, 1.08]) {
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.06, n * RAIL_POST), mat);
    bar.position.y = y;
    g.add(bar);
  }
  g.position.x = CORRIDOR + 0.3;
  g.traverse((o) => { o.frustumCulled = false; o.castShadow = true; });
  g.visible = false;
  return g;
}

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class PackCamera {
  constructor(ctx, race) {
    this.ctx = ctx;
    this.race = race;
    this.cam = ctx.camera;
    this.mode = 'grid';
    this.view = ctx.params?.get?.('view') === 'chase' ? 'chase' : 'angle';
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
    race.ground.edged(apron.material);
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
    race.ground.edged(yardMat);
    this.yard = new THREE.Mesh(ctx.env.track.geometry, yardMat);
    this.yard.matrixAutoUpdate = false;
    this.yard.frustumCulled = false;
    this.yard.receiveShadow = true;
    this.yard.visible = false;
    ctx.scene.add(this.yard);
    // and between them a low railing: the runners keep to their own track
    this.railing = railing(race.ground);
    ctx.scene.add(this.railing);
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

  /** From behind and to the right, 45 degrees off the track: every runner still in it and the track ahead of
   *  them, centred on screen. The ground breaking away behind joins the frame only once it is close to the last
   *  runner. */
  _anglePose(raw, out) {
    const p = this._pack(), C = this.race.collapse;
    const w = this.race.state === 'gameover' && this.race.winner;
    const runners = w ? [w] : this._alive();
    const pts = this._pts || (this._pts = []);
    let n = 0;
    const add = (x, y, z) => { const v = pts[n] || (pts[n] = new THREE.Vector3()); v.set(x, y, z); n++; };
    for (const r of runners) { add(r.b.x, r.b.y, r.b.z); add(r.b.x, r.b.y + 2.8, r.b.z); }   // feet, and head with its name tag
    if (w) {
      // at the finish: just the winner, between the title above and the button below
      add(w.b.x, w.b.y + 6, w.b.z); add(w.b.x, w.b.y - 0.8, w.b.z);
    } else {
      // what is coming at them: the track ahead of the leader, all three lanes
      add(-2.6, 0, p.lead - AHEAD); add(2.6, 0, p.lead - AHEAD);
      // and the edge, once it is about to take someone
      if (C.z - p.rear < CLOSE) { add(-2.6, 0, C.z + 1.5); add(2.6, 0, C.z + 1.5); }
    }
    pts.length = n;

    // The camera looks one fixed way, so it is placed directly: as close as it can be with every point inside
    // the frame, and centred on them (see _place). Never closer than NEAR or further than FAR from the pack;
    // when even FAR cannot fit them (a tall, narrow screen), the view widens instead.
    const aspect = this.cam.aspect || 1.6, base = Math.min(80, 50 + this._narrow() * 6);   // a little wider on a narrow screen
    const c = this._c || (this._c = new THREE.Vector3());
    let fov = base;
    for (; ; fov = Math.min(95, fov * 1.08)) {
      const depth = this._place(pts, Math.tan((fov * Math.PI) / 360) * FILL, aspect, c);
      if (depth <= FAR || fov >= 95) {
        if (depth < NEAR) c.addScaledVector(this._off, NEAR - depth);
        break;
      }
    }
    // (kept relative to the front of the frame, so it does not lag behind a running pack)
    const front = w ? w.b.z : p.lead;
    c.z -= front;
    if (this._reset || !this.aim) { this.aim = c.clone(); this.fovFit = fov; }
    const back = this._v.subVectors(c, this.aim).dot(this._off) > 0;   // backing away: quickly, so nobody leaves the frame
    const k = back ? 7 : 2.5;
    this.aim.set(damp(this.aim.x, c.x, k, raw), damp(this.aim.y, c.y, k, raw), damp(this.aim.z, c.z, k, raw));
    out.pos.copy(this.aim); out.pos.z += front;
    out.look.copy(out.pos).addScaledVector(this._off, -20);
    this.fovFit = damp(this.fovFit, fov, fov > this.fovFit ? 7 : 2.5, raw);
    out.fov = this.fovFit;
  }

  /** Where a camera looking along -_off, with half-angles tan `t` (vertically) and tan `t * aspect`, stands as
   *  close as it can with every point inside its view, centred on them. Writes it to `out`; returns its depth
   *  to the points' middle. Each point bounds the camera by a pair of planes, so this is exact, in one step. */
  _place(pts, t, aspect, out) {
    const D = this._D || (this._D = new THREE.Vector3()), R = this._R || (this._R = new THREE.Vector3()), U = this._U || (this._U = new THREE.Vector3());
    D.copy(this._off).negate();
    R.crossVectors(D, THREE.Object3D.DEFAULT_UP).normalize();
    U.crossVectors(R, D);
    const tx = t * aspect;
    let lx = -Infinity, hx = Infinity, ly = -Infinity, hy = Infinity, md = 0;
    for (const q of pts) {
      const r = q.dot(R), u = q.dot(U), d = q.dot(D);
      lx = Math.max(lx, r - tx * d); hx = Math.min(hx, r + tx * d);
      ly = Math.max(ly, u - t * d); hy = Math.min(hy, u + t * d);
      md += d;
    }
    md /= pts.length;
    // the camera at a*R + b*U + e*D sees point q when |q.R - a| <= tx (q.D - e), and the same for U
    const e = Math.min((hx - lx) / (2 * tx), (hy - ly) / (2 * t));
    out.copy(R).multiplyScalar((lx + hx) / 2).addScaledVector(U, (ly + hy) / 2).addScaledVector(D, e);
    return md - e;
  }

  /** Cut away the near side for the angled view; restore the full world otherwise. */
  _cutaway(on) {
    this.cut.constant = on ? EDGE : 1e6;
    this.race.ground.nearCut = on;
    this.race.ground.yardX = on ? YARD : null;
    this.apron.visible = this.yard.visible = this.railing.visible = on;
    if (on) {
      // each on its own grid, so they stand still as the camera moves
      this.apron.position.z = Math.round(this.pos.z / 4) * 4;
      this.railing.position.z = Math.round(this.pos.z / RAIL_POST) * RAIL_POST;
    }
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
    if (this.mode === 'follow' && this.view === 'chase') T.fov = Math.min(80, T.fov + this._narrow() * 6);
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
