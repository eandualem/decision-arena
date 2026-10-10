// The chaser: a runaway locomotive as wide as the track, closing in on the pack from behind. Whoever its plow
// reaches is out. Built from simple shapes. Origin on the ground at the tip of the plow's base, facing -Z; the
// body extends toward +Z. API: update(dt, {mode:'idle'|'run', speed}), trigger('catch'), dispose().
import * as THREE from 'three';

const W = 7.6;              // spans all three lanes (lane centres at -2.6, 0, 2.6); the corridor is 9.6 wide
const WHEEL_R = 0.95;
const WHEEL_Z = [2.4, 4.8, 7.2, 9.6];
const PUFFS = 16;

function canvasTexture(w, h, draw) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const stripes = () => canvasTexture(256, 32, (g) => {
  g.fillStyle = '#ffc21a'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#16161c';
  for (let x = -32; x < 288; x += 32) { g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.fill(); }
});

const glow = () => canvasTexture(64, 64, (g) => {
  const r = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  r.addColorStop(0, 'rgba(255,255,255,1)'); r.addColorStop(0.3, 'rgba(255,240,190,.6)'); r.addColorStop(1, 'rgba(255,220,150,0)');
  g.fillStyle = r; g.fillRect(0, 0, 64, 64);
});

export class ChaserRig {
  constructor(opts = {}) {
    const cast = opts.castShadow !== false;
    this.object = new THREE.Group();
    this.object.name = 'runaway-train';
    this._geos = []; this._mats = []; this._texs = [];
    const geo = (g) => (this._geos.push(g), g);
    const mat = (m) => (this._mats.push(m), m);
    const tex = (t) => (this._texs.push(t), t);
    const add = (parent, g, m, x, y, z, shadow = cast) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = shadow;
      parent.add(o);
      return o;
    };
    const O = this.object;

    const red = mat(new THREE.MeshStandardMaterial({ color: 0xc0182f, roughness: 0.45, metalness: 0.2 }));
    const dark = mat(new THREE.MeshStandardMaterial({ color: 0x1b1c24, roughness: 0.7, metalness: 0.3 }));
    const gold = mat(new THREE.MeshStandardMaterial({ color: 0xffc23a, roughness: 0.35, metalness: 0.6 }));
    const hazard = mat(new THREE.MeshStandardMaterial({ map: tex(stripes()), roughness: 0.6 }));
    hazard.map.wrapS = THREE.RepeatWrapping; hazard.map.repeat.set(5, 1);
    this.lampMat = mat(new THREE.MeshBasicMaterial({ color: 0xfff1b8 }));
    this.windowMat = mat(new THREE.MeshBasicMaterial({ color: 0xffcf73 }));
    this.markerMat = mat(new THREE.MeshBasicMaterial({ color: 0xff3a3a }));

    // plow: two slanted red panels meeting at the front, with yellow bars
    const half = Math.hypot(W / 2, 1.5), ang = Math.atan2(1.5, W / 2);
    const panel = geo(new THREE.BoxGeometry(half, 1.15, 0.14));
    const bar = geo(new THREE.BoxGeometry(half, 0.09, 0.2));
    for (const side of [-1, 1]) {
      const p = new THREE.Group();
      p.position.set(side * W / 4, 0, -0.75);
      p.rotation.y = side * ang;
      O.add(p);
      add(p, panel, red, 0, 0.58, 0);
      for (const y of [0.3, 0.62, 0.94]) add(p, bar, gold, 0, y, -0.04, false);
    }
    // buffer beam with hazard stripes, frame and running boards
    add(O, geo(new THREE.BoxGeometry(W, 0.55, 0.7)), hazard, 0, 1.45, 0.35);
    add(O, geo(new THREE.BoxGeometry(6.4, 0.8, 11, 1, 1, 6)), dark, 0, 1.45, 6.2);
    for (const side of [-1, 1]) add(O, geo(new THREE.BoxGeometry(0.7, 0.18, 10.5, 1, 1, 6)), red, side * 3.45, 2.3, 6.2);
    for (const side of [-1, 1]) add(O, geo(new THREE.BoxGeometry(0.4, 0.2, 0.4)), this.markerMat, side * 3.4, 1.85, 0.05, false);

    // boiler, bands, smokebox, dome, smokestack
    const boiler = add(O, geo(new THREE.CylinderGeometry(1.55, 1.55, 8, 28, 5)), red, 0, 3.45, 5);
    boiler.rotation.x = Math.PI / 2;
    for (const z of [1.6, 4.4, 7.2]) {
      const band = add(O, geo(new THREE.CylinderGeometry(1.6, 1.6, 0.22, 28)), gold, 0, 3.45, z, false);
      band.rotation.x = Math.PI / 2;
    }
    const smokebox = add(O, geo(new THREE.CylinderGeometry(1.62, 1.62, 1.1, 28)), dark, 0, 3.45, 0.95);
    smokebox.rotation.x = Math.PI / 2;
    add(O, geo(new THREE.SphereGeometry(0.62, 18, 10, 0, Math.PI * 2, 0, Math.PI / 2)), gold, 0, 4.95, 4.4);
    add(O, geo(new THREE.CylinderGeometry(0.72, 0.45, 1.7, 18)), dark, 0, 5.6, 1.5);

    // headlamp, its glow and the beam ahead
    const lamp = add(O, geo(new THREE.CylinderGeometry(0.5, 0.5, 0.35, 20)), this.lampMat, 0, 3.85, 0.3, false);
    lamp.rotation.x = Math.PI / 2;
    this.halo = new THREE.Sprite(mat(new THREE.SpriteMaterial({ map: tex(glow()), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true })));
    this.halo.scale.set(3.2, 3.2, 1);
    this.halo.position.set(0, 3.85, 0.05);
    O.add(this.halo);
    this.beamMat = mat(new THREE.MeshBasicMaterial({ color: 0xfff0b0, transparent: true, opacity: 0.12, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    const beam = add(O, geo(new THREE.ConeGeometry(2.6, 10, 24, 1, true)), this.beamMat, 0, 2.6, -4.8, false);
    beam.rotation.x = -Math.PI / 2 + 0.12;

    // cab with lit windows
    add(O, geo(new THREE.BoxGeometry(3.8, 2.9, 3.2, 1, 1, 2)), red, 0, 3.75, 10.2);
    add(O, geo(new THREE.BoxGeometry(4.4, 0.25, 3.8, 1, 1, 2)), dark, 0, 5.3, 10.2);
    const win = geo(new THREE.PlaneGeometry(1.1, 0.9));
    for (const side of [-1, 1]) {
      const w = add(O, win, this.windowMat, side * 1.91, 4.3, 10.2, false);
      w.rotation.y = side * Math.PI / 2;
    }
    for (const x of [-0.95, 0.95]) {
      const w = add(O, win, this.windowMat, x, 4.3, 8.59, false);
      w.rotation.y = Math.PI;
    }

    // wheels with spokes, joined by a coupling rod on each side
    this.wheels = [];
    const wheel = geo(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.3, 24));
    const spoke = geo(new THREE.BoxGeometry(0.32, WHEEL_R * 1.8, 0.12));
    const rod = geo(new THREE.BoxGeometry(0.16, 0.16, WHEEL_Z[3] - WHEEL_Z[0]));
    this.rods = [];
    for (const side of [-1, 1]) {
      for (const z of WHEEL_Z) {
        const g = new THREE.Group();
        g.position.set(side * 3.5, WHEEL_R, z);
        O.add(g);
        const w = add(g, wheel, red, 0, 0, 0);
        w.rotation.z = Math.PI / 2;
        for (const a of [0, Math.PI / 2]) { const s = add(g, spoke, gold, side * 0.17, 0, 0, false); s.rotation.x = a; }
        this.wheels.push(g);
      }
      const r = add(O, rod, gold, side * 3.75, WHEEL_R, (WHEEL_Z[0] + WHEEL_Z[3]) / 2, false);
      this.rods.push(r);
    }

    // smoke puffs, recycled
    this.puffMat = [];
    this.puffs = [];
    const puffGeo = geo(new THREE.IcosahedronGeometry(1, 1));
    for (let i = 0; i < PUFFS; i++) {
      const m = mat(new THREE.MeshLambertMaterial({ color: 0xf2f0ee, transparent: true, opacity: 0, depthWrite: false }));
      const p = new THREE.Mesh(puffGeo, m);
      p.visible = false;
      O.add(p);
      this.puffs.push({ mesh: p, mat: m, age: 9, life: 1, vy: 0 });
    }
    this.puffT = 0;
    this.next = 0;
    this.t = 0;
    this.phase = 0;
    this.flash = 0;
  }

  trigger(name) {
    if (name === 'catch') { this.flash = 1; for (let k = 0; k < 4; k++) this._puff(1.6); }
  }

  _puff(scale = 1) {
    const p = this.puffs[this.next];
    this.next = (this.next + 1) % PUFFS;
    p.age = 0; p.life = 1.4 + Math.random() * 0.6; p.vy = 2.6 + Math.random() * 1.2; p.scale = scale;
    p.mesh.position.set((Math.random() - 0.5) * 0.4, 6.5, 1.5);
    p.mesh.visible = true;
  }

  update(dt, s = {}) {
    if (!(dt > 0)) return;
    this.t += dt;
    const running = s.mode === 'run' || s.mode === 'catch';
    const speed = running ? Math.max(6, s.speed || 14) : 0;
    // wheels turn with the speed; the coupling rods circle with them
    this.phase += (speed / WHEEL_R) * dt;
    for (const w of this.wheels) w.rotation.x = -this.phase;
    for (const r of this.rods) { r.position.y = WHEEL_R + Math.cos(this.phase) * 0.42; r.position.z = (WHEEL_Z[0] + WHEEL_Z[3]) / 2 - Math.sin(this.phase) * 0.42; }
    // smoke: quick puffs while running, a lazy one now and then while waiting
    this.puffT -= dt;
    if (this.puffT <= 0) { this._puff(running ? 1 : 0.7); this.puffT = running ? 0.11 : 0.6; }
    for (const p of this.puffs) {
      if (p.age >= p.life) { p.mesh.visible = false; continue; }
      p.age += dt;
      const k = p.age / p.life;
      p.mesh.position.y += p.vy * dt;
      p.mesh.position.z += (speed * 0.85 + 1.5) * dt;   // left behind as the train charges on
      p.mesh.scale.setScalar((0.5 + k * 1.6) * (p.scale || 1));
      p.mat.opacity = 0.85 * (1 - k) * Math.min(1, p.age * 8);
    }
    // headlamp flicker, and a flash on a catch
    this.flash = Math.max(0, this.flash - dt * 2.5);
    const f = 0.92 + 0.08 * Math.sin(this.t * 31) + this.flash * 0.8;
    this.halo.scale.setScalar(3.2 * f + this.flash * 3);
    this.beamMat.opacity = (running ? 0.13 : 0.07) * f + this.flash * 0.2;
    this.markerMat.color.setScalar(0.6 + 0.4 * (Math.sin(this.t * 6) > 0 ? 1 : 0));
    this.markerMat.color.r = 1;
  }

  dispose() {
    this.object.removeFromParent();
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) m.dispose();
    for (const t of this._texs) t.dispose();
  }
}
