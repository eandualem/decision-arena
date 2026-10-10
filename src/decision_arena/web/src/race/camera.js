// Pack camera: faces the start grid before the race, then follows from behind and above so the whole pack
// stays in view, widening as the runners spread out. Keeps inside the scenery-free corridor.
import * as THREE from 'three';
import { clamp, lerp, damp } from '../core/utils.js';

const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

export class PackCamera {
  constructor(ctx, race) {
    this.ctx = ctx;
    this.race = race;
    this.cam = ctx.camera;
    this.mode = 'grid';
    this.pos = new THREE.Vector3(0, 2, -8);
    this.look = new THREE.Vector3(0, 1, 0);
    this.fov = 55;
    this.from = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 55 };
    this.blendT = 0; this.blendDur = 0;
    this.fx = 0; this.fy = 0; this.rearZ = 0; this.leadZ = 0; this.spread = 0;
    this.trauma = 0; this.clock = 0;
    this._t = { pos: new THREE.Vector3(), look: new THREE.Vector3(), fov: 60 };
    this._look = new THREE.Vector3();
  }

  toGrid() { this.mode = 'grid'; this.blendDur = 0; this._snap = true; }
  toFollow(blend = 1.2) {
    this.from.pos.copy(this.pos); this.from.look.copy(this.look); this.from.fov = this.fov;
    this.blendT = 0; this.blendDur = blend;
    this.mode = 'follow';
    this._resetFollow = true;
  }
  shake(amount) { this.trauma = Math.min(1, this.trauma + amount); }

  _pack() {
    const rs = this.race.runners;
    const alive = rs.filter((r) => r.alive || r.status === 'won');
    const list = alive.length ? alive : rs;
    let lead = Infinity, rear = -Infinity, sx = 0, sy = 0;
    for (const r of list) {
      const b = r.b;
      lead = Math.min(lead, b.z); rear = Math.max(rear, b.z);
      sx += b.x; sy += r.player.flight ? Math.min(b.y, 4) : b.y;
    }
    const n = Math.max(1, list.length);
    return { lead, rear, x: sx / n, y: sy / n };
  }

  _gridPose(out) {
    const p = this._pack();
    // in front of the grid, low, looking back at the runners' faces
    out.pos.set(1.2, 1.9, p.lead - 7.5);
    out.look.set(0, 1.0, (p.lead + p.rear) / 2 + 0.5);
    out.fov = 58;
  }

  _followPose(raw, out) {
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
    const s = this.spread;
    out.pos.set(clamp(this.fx, -3.6, 3.6), this.fy + 4.6 + s * 0.08, this.rearZ + 7.5 + s * 0.15);
    out.look.set(this.fx * 0.6, this.fy + 1.1, this.leadZ - 10);
    out.fov = 62 + Math.min(10, s * 0.35);
  }

  update(raw) {
    const T = this._t;
    if (this.mode === 'grid') this._gridPose(T); else this._followPose(raw, T);
    if (this._snap) { this.pos.copy(T.pos); this.look.copy(T.look); this.fov = T.fov; this._snap = false; }
    else if (this.blendT < this.blendDur) {
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
