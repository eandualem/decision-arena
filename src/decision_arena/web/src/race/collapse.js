// The ground collapsing behind the race. The world (track, scenery, trains, props, coins) is cut cleanly at the
// edge with a clipping plane, and the edge sheds real debris as it advances: chunks of ballast, sleepers and
// rails, and pieces of every train or barrier it passes, tumbling down into a dark pit. A soil face shows where
// the ground broke. Runners are not cut: one the edge reaches falls with the debris (see Runner._falling).
import * as THREE from 'three';

const CLIPPED = ['world-track', 'world-chunks', 'level'];   // what the cut applies to
const MAX = 700;              // debris pieces alive at once
const GRAVITY = 26;
const PIT = 34;               // how deep the pit floor is

const BALLAST = [0x8a7d6c, 0x6f655a, 0x9a8e7c, 0x5c544b, 0x7b6f61];
const SLEEPER = [0x6b4a32, 0x5a3e2a];
const RAIL = [0x9aa3ad, 0x7f8790];
const TRAIN = [0x9fb0bd, 0x6c7d8a, 0xd8dee4, 0x3e8f9c, 0xc0392b, 0xe0b23a];
const BARRIER = [0xd63c3c, 0xf2f2f2, 0xffc21a];

function soilFace() {
  const c = document.createElement('canvas');
  c.width = 64; c.height = 256;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 256);
  grd.addColorStop(0, '#6e5a44'); grd.addColorStop(0.08, '#4a3a2c'); grd.addColorStop(0.5, '#241a18'); grd.addColorStop(1, '#0b080d');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 256);
  for (let i = 0; i < 140; i++) {   // stones in the broken face
    g.fillStyle = `rgba(${150 + Math.random() * 60},${130 + Math.random() * 50},${110 + Math.random() * 40},${0.25 + Math.random() * 0.3})`;
    g.fillRect(Math.random() * 64, Math.random() * 120, 1 + Math.random() * 3, 1 + Math.random() * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(12, 1);
  return t;
}

export class Collapse {
  constructor(ctx) {
    this.ctx = ctx;
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e6);   // keeps z <= constant
    this.on = false;
    this.z = 1e6;
    this.cursor = null;      // where the next row of debris breaks off
    this._passed = new Set();

    // debris: one instanced mesh of boxes, each with its own size, colour, spin and fall
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.count = 0;
    this.mesh.setColorAt(0, new THREE.Color());
    ctx.scene.add(this.mesh);
    this.pieces = [];
    this._m = new THREE.Matrix4(); this._q = new THREE.Quaternion(); this._e = new THREE.Euler();
    this._p = new THREE.Vector3(); this._s = new THREE.Vector3(); this._c = new THREE.Color();

    // the broken face of the ground, and the dark pit beneath
    this.face = new THREE.Mesh(new THREE.PlaneGeometry(90, PIT, 36, 4), new THREE.MeshBasicMaterial({ map: soilFace(), fog: false }));
    this.face.frustumCulled = false;
    this.pit = new THREE.Mesh(new THREE.PlaneGeometry(400, 500, 8, 200), new THREE.MeshBasicMaterial({ color: 0x0a070d }));
    this.pit.rotation.x = -Math.PI / 2;
    this.pit.frustumCulled = false;
    for (const o of [this.face, this.pit]) { o.visible = false; ctx.scene.add(o); }
  }

  /** Give the world's materials the cut. Called once the world exists; runners are never cut. */
  start() {
    this.ctx.renderer.localClippingEnabled = true;
    const planes = [this.plane];
    for (const name of CLIPPED) {
      this.ctx.scene.getObjectByName(name)?.traverse((o) => {
        if (!o.material) return;
        for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
          if (m.clippingPlanes !== planes) { m.clippingPlanes = planes; m.needsUpdate = true; }
        }
      });
    }
  }

  reset() {
    this.on = false;
    this.z = 1e6;
    this.cursor = null;
    this.plane.constant = 1e6;
    this.pieces.length = 0;
    this.mesh.count = 0;
    this._passed.clear();
    this.face.visible = this.pit.visible = false;
  }

  /** Move the edge to z (it only ever advances) and let the debris fall. */
  update(dt, z, active) {
    if (active) {
      if (!this.on) { this.on = true; this.cursor = z; }
      if (z < this.z) this.z = z;
      if (this.cursor !== null && this.z < this.cursor) this._shed(this.z);
      this.plane.constant = this.z;
      this.face.position.set(0, -PIT / 2, this.z);
      this.pit.position.set(0, -PIT, this.z + 250);
      this.face.visible = this.pit.visible = true;
    }
    if (dt > 0) this._fall(dt);
  }

  /** The ground from zNew to zOld (behind it) breaks away: track debris, and pieces of whatever stood there. */
  _shed(zNew) {
    // a row every 0.45 m of ground, wherever the frames fall, so the amount is the same at any frame rate
    const recs = this.ctx.level.recs;
    for (; this.cursor > zNew; this.cursor -= 0.45) {
      const z = this.cursor;
      for (let k = 0; k < 4; k++) this._spawn((Math.random() - 0.5) * 9.4, 0.15, z, 0.25 + Math.random() * 0.5, BALLAST);
      if (Math.random() < 0.5) for (const lane of [-1, 0, 1]) this._spawn(lane * 2.6 + (Math.random() - 0.5), 0.2, z, 0, SLEEPER, [2.2, 0.16, 0.26]);
      if (Math.random() < 0.35) for (const lane of [-1, 0, 1]) for (const s of [-0.62, 0.62]) this._spawn(lane * 2.6 + s, 0.25, z, 0, RAIL, [0.09, 0.14, 0.9 + Math.random()]);
      // whatever stood on this row breaks up too: trains a few chunks per row, a barrier in one burst
      for (const rec of recs) {
        const c = rec.col;
        if (c.maxZ < z - 0.45 || c.minZ > z) continue;
        const train = rec.kind === 'train' || rec.kind === 'ramp';
        if (!train && this._passed.has(rec.id)) continue;
        if (!train) this._passed.add(rec.id);
        for (let i = 0, n = train ? 2 : 7; i < n; i++) {
          const x = c.minX + Math.random() * (c.maxX - c.minX), y = c.minY + Math.random() * (c.maxY - c.minY);
          this._spawn(x, y, z, train ? 0.5 + Math.random() * 0.8 : 0.2 + Math.random() * 0.35, train ? TRAIN : BARRIER);
        }
      }
    }
  }

  _spawn(x, y, z, size, palette, dims) {
    if (this.pieces.length >= MAX) this.pieces.shift();
    const s = dims || [size * (0.7 + Math.random() * 0.6), size * (0.5 + Math.random() * 0.6), size * (0.7 + Math.random() * 0.6)];
    this.pieces.push({
      x, y, z, s,
      vx: (Math.random() - 0.5) * 2.5, vy: Math.random() * 2.5 - 0.5, vz: 1 + Math.random() * 3,
      rx: Math.random() * 6, ry: Math.random() * 6, rz: Math.random() * 6,
      wx: (Math.random() - 0.5) * 9, wy: (Math.random() - 0.5) * 9, wz: (Math.random() - 0.5) * 9,
      delay: Math.random() * 0.25,   // some pieces hang for a moment before they go
      color: palette[(Math.random() * palette.length) | 0],
    });
  }

  _fall(dt) {
    const P = this.pieces, M = this.mesh;
    let n = 0;
    for (let i = 0; i < P.length; i++) {
      const p = P[i];
      if (p.delay > 0) p.delay -= dt;
      else {
        p.vy -= GRAVITY * dt;
        p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
        p.rx += p.wx * dt; p.ry += p.wy * dt; p.rz += p.wz * dt;
      }
      if (p.y < -PIT + 1) continue;
      this._q.setFromEuler(this._e.set(p.rx, p.ry, p.rz));
      this._m.compose(this._p.set(p.x, p.y, p.z), this._q, this._s.set(p.s[0], p.s[1], p.s[2]));
      M.setMatrixAt(n, this._m);
      M.setColorAt(n, this._c.setHex(p.color));
      P[n++] = p;
    }
    P.length = n;
    M.count = n;
    M.instanceMatrix.needsUpdate = true;
    if (M.instanceColor) M.instanceColor.needsUpdate = true;
  }
}
