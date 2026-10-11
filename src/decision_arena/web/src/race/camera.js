// Pack camera: faces the start grid before the race, then follows the pack. Two views: 'angle', looking
// forward along the track from behind and to the right, so you see both the runners and what is coming at
// them (the default), and 'chase', from behind and above. The angled camera stands outside the track, so
// everything on the near side of the corridor is cut away (a world clipping plane at the corridor edge, with a
// soil skirt below it) and the far side's street becomes the backdrop.
import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/utils.js';

const EDGE = 4.8;           // the corridor's right edge: scenery starts here
const AZIMUTH = Math.PI / 4;  // 45 degrees between looking from behind and looking from the side
const ELEVATION = 0.6;      // camera height per metre of horizontal distance (about 31 degrees down)
const FILL = 0.85;          // the pack fills at most this much of the screen

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function soilTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#7a654a'); grd.addColorStop(0.001, '#4a3828'); grd.addColorStop(0.005, '#1c1420'); grd.addColorStop(0.03, '#0b0810'); grd.addColorStop(1, '#050307');
  g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

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
    this.cut = [new THREE.Plane(new THREE.Vector3(-1, 0, 0), EDGE)];   // keep x <= EDGE
    const skirt = new THREE.Mesh(
      // deep and long, so beyond the cut there is a cliff falling into darkness rather than open sky
      // (the haze fades its far end into the horizon)
      new THREE.PlaneGeometry(1200, 1200, 480, 12),
      new THREE.MeshBasicMaterial({ map: soilTexture() }),
    );
    skirt.rotation.y = Math.PI / 2;      // faces +X, toward the camera
    // half a metre inside the cut: the world's slight bend nudges it outward when seen from far away
    skirt.position.set(EDGE - 0.5, -600, 0);
    skirt.frustumCulled = false;
    skirt.visible = false;
    ctx.scene.add(skirt);
    this.skirt = skirt;
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
    this._resetFollow = true;
  }
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }
  /** Keep at least this much shake: a steady rumble, the same at any frame rate. */
  rumble(level) { this.trauma = Math.max(this.trauma, level); }
  toggleView() {
    this.view = this.view === 'angle' ? 'chase' : 'angle';
    if (this.mode === 'follow') this.toFollow(0.8);
  }

  _pack() {
    const rs = this.race.runners;
    const alive = rs.filter((r) => r.alive || r.status === 'won');
    const list = alive.length ? alive : rs;
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

  _followPose(raw, out) {
    if (this.view === 'angle') return this._anglePose(raw, out);
    const p = this._pack();
    if (this._resetFollow) {
      this._resetFollow = false;
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

  _anglePose(raw, out) {
    const p = this._pack();
    // bring the collapsing edge into the shot once it closes on the last runner
    const C = this.race.collapse;
    const near = C.z - p.rear < 16;
    const rear = near ? Math.max(p.rear, C.z + 5) : p.rear;
    if (this._resetFollow) {
      this._resetFollow = false;
      this.cz = (p.lead + rear) / 2; this.dist = 18; this.my = p.y;
    }
    this.cz = damp(this.cz, (p.lead + rear) / 2, 4, raw);
    this.my = damp(this.my, (p.bottom + p.top) / 2, 3, raw);
    // aim a little ahead of the pack's middle, so what is coming at the leaders is in view
    out.look.set(-0.6, this.my + 1, this.cz - 5);
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
      for (const r of this.race.runners) {
        if (r.alive || r.status === 'won' || r.status === 'ready') { fit(r.b.x, r.b.y, r.b.z); fit(r.b.x, r.b.y + 2.2, r.b.z); }
      }
      // and, once the edge is close, a stretch of the ground falling away behind it
      if (near) { fit(-3, 0, C.z + 3); fit(3, 0, C.z + 3); fit(0, -4, C.z + 10); }
      dist = clamp(dist * clamp(m / FILL, 0.8, 1.6), 12, 70);
    }
    // widen at once, tighten gently
    this.dist = dist > this.dist ? dist : damp(this.dist, dist, 1.5, raw);
    out.pos.copy(out.look).addScaledVector(this._off, this.dist);
    out.fov = 50;
  }

  /** Cut away the near side for the angled view; restore the full world otherwise. */
  _cutaway(on) {
    this.ctx.renderer.clippingPlanes = on ? this.cut : [];
    this.skirt.visible = on;
    if (on) this.skirt.position.z = this.pos.z;
    // The world normally bends down toward the horizon and sways a little. Seen from outside the track that
    // would push distant geometry across the cut, so the world is flat while it is on (see flatten()).
    this.flat = on;
  }

  /** Called after the environment has set this frame's bend. */
  flatten() {
    if (this.flat) this.ctx.curve.value.set(0, 0, this.ctx.curve.value.z);
  }

  /** How much narrower than a 16:10 screen this one is (0 on wide screens), so all three lanes stay in view. */
  _narrow() { return Math.max(0, 1.6 / (this.cam.aspect || 1.6) - 1); }

  update(raw) {
    const T = this._t;
    if (this.mode === 'grid') this._gridPose(T); else this._followPose(raw, T);
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
