// Pack camera: faces the start grid before the race, then follows the pack. Two views: 'side', a broadcast
// view from the right of the track that pans with the pack (the default), and 'chase', from behind and above.
// The side camera stands outside the track: everything on the near side of the corridor is cut away (a world
// clipping plane at the corridor edge, with a soil skirt below it), so the race reads like a diorama with the
// far side's buildings as the backdrop.
const EDGE = 4.8;           // the corridor's right edge: scenery starts here
const SIDE_CURVE = 0.0004;  // the world bends down toward the horizon; much less in the side view
const DEG = 180 / Math.PI;

function soilTexture() {
  const c = document.createElement('canvas');
  c.width = 8; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#8a7558'); grd.addColorStop(0.04, '#5b4632'); grd.addColorStop(0.35, '#3a2a20'); grd.addColorStop(1, '#1d1420');
  g.fillStyle = grd; g.fillRect(0, 0, 8, 256);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/utils.js';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class PackCamera {
  constructor(ctx, race) {
    this.ctx = ctx;
    this.race = race;
    this.cam = ctx.camera;
    this.mode = 'grid';
    this.view = ctx.params?.get?.('view') === 'chase' ? 'chase' : 'side';
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
      new THREE.PlaneGeometry(500, 40, 200, 4),
      new THREE.MeshBasicMaterial({ map: soilTexture(), fog: false }),
    );
    skirt.rotation.y = Math.PI / 2;      // faces +X, toward the side camera
    // half a metre inside the cut: the world's slight bend nudges it outward when seen from far away
    skirt.position.set(EDGE - 0.5, -20, 0);
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
  toggleView() {
    this.view = this.view === 'side' ? 'chase' : 'side';
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
    if (this.view === 'side') return this._sidePose(raw, out);
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

  _sidePose(raw, out) {
    const p = this._pack();
    // bring the chaser into the shot once it closes on the last runner
    const S = this.race.sweeper;
    const rear = S.rig?.object.visible && S.z - p.rear < 16 ? Math.max(p.rear, S.z + 4) : p.rear;
    if (this._resetFollow) {
      this._resetFollow = false;
      this.fy = p.y; this.cz = (p.lead + rear) / 2; this.spread = rear - p.lead;
    }
    this.fy = damp(this.fy, p.y, 3, raw);
    this.cz = damp(this.cz, (p.lead + rear) / 2, 4, raw);
    this.spread = damp(this.spread, clamp(rear - p.lead, 0, 45), 3, raw);
    this.rise = damp(this.rise || 0, Math.max(0, p.top - p.bottom - 1.5), 3, raw);
    const s = this.spread, up = this.rise;
    // stand back far enough for the whole pack, measured from where the camera actually is (it trails a fast
    // pack a little), raised like a stadium camera; on a narrow screen the width decides, so step further back
    const aspect = this.cam.aspect || 1.6;
    const halfW = Math.max(s / 2, Math.abs(p.lead - this.cz), Math.abs(rear - this.cz)) + 4;
    const half = Math.min(0.5, Math.atan(Math.tan(32 * Math.PI / 180) * aspect));   // widest half-angle at a 64 degree cap
    const dist = Math.max(13, halfW / Math.tan(half)) + up * 0.6;
    // aim above the runners, so the track sits in the lower third with the street rising behind it
    out.pos.set(dist, this.fy + 1 + dist * 0.22 + up * 0.5, this.cz);
    out.look.set(0, this.fy + 1.1 + dist * 0.1 + up * 0.45, this.cz);
    const d = out.pos.distanceTo(out.look);
    const hfov = 2 * Math.atan(halfW / d);
    out.fov = clamp(2 * Math.atan(Math.tan(hfov / 2) / aspect) * DEG, 30, 70);
  }

  /** Cut away the near side for the side view; restore the full world otherwise. */
  _cutaway(on) {
    const r = this.ctx.renderer, env = this.ctx.env;
    r.clippingPlanes = on ? this.cut : [];
    this.skirt.visible = on;
    if (on) this.skirt.position.z = this.pos.z;
    if (env) { env._themeCurveY ??= env.curveY; env.curveY = on ? SIDE_CURVE : env._themeCurveY; }
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

    // cut away the near side from the moment the camera heads out to its side position
    this._cutaway(this.mode === 'follow' && this.view === 'side');

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
