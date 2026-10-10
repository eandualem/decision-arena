// The sweeper: a wide track-cleaning machine that closes in on the pack from behind. It spans all three
// lanes; whoever it reaches is out. Built from simple shapes (origin at the centre of its footprint on the
// ground, facing -Z). API: update(dt, {mode:'idle'|'run'|'catch'|'celebrate', speed}), trigger(name), dispose().
import * as THREE from 'three';

const WIDTH = 7.4;      // spans all three lanes (lane centres at -2.6, 0, 2.6)
const DEPTH = 2.2;
const BRUSH_R = 0.42;

function stripeTexture() {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 32;
  const g = c.getContext('2d');
  g.fillStyle = '#ffc21a'; g.fillRect(0, 0, 256, 32);
  g.fillStyle = '#1b1d24';
  for (let x = -32; x < 256 + 32; x += 32) {
    g.beginPath(); g.moveTo(x, 32); g.lineTo(x + 16, 32); g.lineTo(x + 32, 0); g.lineTo(x + 16, 0); g.closePath(); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.RepeatWrapping;
  t.repeat.set(6, 1);
  return t;
}

export class ChaserRig {
  constructor(opts = {}) {
    const cast = opts.castShadow !== false;
    this.object = new THREE.Group();
    this.object.name = 'sweeper';
    this._geos = [];
    this._mats = [];
    const geo = (g) => (this._geos.push(g), g);
    const mat = (m) => (this._mats.push(m), m);
    const mesh = (g, m, x, y, z, shadow = cast) => {
      const o = new THREE.Mesh(g, m);
      o.position.set(x, y, z);
      o.castShadow = shadow;
      this.object.add(o);
      return o;
    };

    const body = mat(new THREE.MeshStandardMaterial({ color: 0x2c3140, roughness: 0.6, metalness: 0.25 }));
    const dark = mat(new THREE.MeshStandardMaterial({ color: 0x14161c, roughness: 0.85 }));
    const stripes = mat(new THREE.MeshStandardMaterial({ map: stripeTexture(), roughness: 0.7 }));
    this.bristleMat = mat(new THREE.MeshStandardMaterial({ color: 0xff8a1f, roughness: 0.9, emissive: 0x401800 }));
    this.eyeMat = mat(new THREE.MeshBasicMaterial({ color: 0x46e6ff }));
    this.beaconMat = mat(new THREE.MeshBasicMaterial({ color: 0xffa020 }));
    this.barMat = mat(new THREE.MeshBasicMaterial({ color: 0xff3048 }));

    // chassis with a hazard-striped front
    mesh(geo(new THREE.BoxGeometry(WIDTH, 0.9, DEPTH)), body, 0, 0.8, 0);
    mesh(geo(new THREE.BoxGeometry(WIDTH + 0.02, 0.32, 0.04)), stripes, 0, 0.92, -DEPTH / 2 - 0.02, false);
    this.bar = mesh(geo(new THREE.BoxGeometry(WIDTH - 0.4, 0.08, 0.06)), this.barMat, 0, 1.2, -DEPTH / 2 - 0.03, false);

    // spinning brush across the front
    this.brush = new THREE.Group();
    this.brush.position.set(0, BRUSH_R + 0.02, -DEPTH / 2 - BRUSH_R * 0.8);
    this.object.add(this.brush);
    const core = new THREE.Mesh(geo(new THREE.CylinderGeometry(BRUSH_R, BRUSH_R, WIDTH - 0.2, 14, 1)), this.bristleMat);
    core.rotation.z = Math.PI / 2;
    core.castShadow = cast;
    this.brush.add(core);
    const tuftGeo = geo(new THREE.BoxGeometry(WIDTH - 0.3, 0.1, 0.1));
    for (let k = 0; k < 6; k++) {
      const a = (k / 6) * Math.PI * 2;
      const tuft = new THREE.Mesh(tuftGeo, dark);
      tuft.position.set(0, Math.cos(a) * BRUSH_R, Math.sin(a) * BRUSH_R);
      this.brush.add(tuft);
    }

    // wheels
    const wheel = geo(new THREE.CylinderGeometry(0.38, 0.38, 0.32, 16));
    for (const [x, z] of [[-WIDTH / 2 + 0.5, -0.6], [WIDTH / 2 - 0.5, -0.6], [-WIDTH / 2 + 0.5, 0.75], [WIDTH / 2 - 0.5, 0.75]]) {
      const w = mesh(wheel, dark, x, 0.38, z);
      w.rotation.z = Math.PI / 2;
    }

    // cab with a scanning visor
    mesh(geo(new THREE.BoxGeometry(2.1, 1.1, 1.5)), body, 0, 1.8, 0.2);
    mesh(geo(new THREE.BoxGeometry(1.8, 0.34, 0.06)), dark, 0, 1.95, -0.57, false);
    this.eye = mesh(geo(new THREE.BoxGeometry(0.34, 0.16, 0.05)), this.eyeMat, 0, 1.95, -0.6, false);

    // beacons
    const beacon = geo(new THREE.CylinderGeometry(0.13, 0.15, 0.24, 12));
    this.beacons = [mesh(beacon, this.beaconMat, -0.7, 2.47, 0.2, false), mesh(beacon, this.beaconMat, 0.7, 2.47, 0.2, false)];

    this.t = 0;
    this.catchT = 9;
    this.mode = 'idle';
  }

  trigger(name) {
    if (name === 'catch') this.catchT = 0;
  }

  update(dt, s = {}) {
    if (!(dt > 0)) return;
    this.t += dt;
    this.catchT += dt;
    const mode = s.mode || 'idle';
    const moving = mode === 'run' || mode === 'catch';
    const speed = moving ? Math.max(s.speed || 14, 6) : 0;
    this.brush.rotation.x -= (speed / BRUSH_R) * dt * 0.6 + (moving ? 0 : dt * 2);
    // visor scans side to side; red while catching
    const catching = this.catchT < 0.9 || mode === 'catch';
    this.eye.position.x = Math.sin(this.t * (catching ? 9 : 2.4)) * 0.7;
    this.eyeMat.color.setHex(catching ? 0xff3048 : 0x46e6ff);
    // beacons alternate; faster while moving
    const ph = (this.t * (moving ? 4 : 1.2)) % 1;
    this.beaconMat.color.setScalar(1);
    this.beacons[0].visible = ph < 0.5;
    this.beacons[1].visible = ph >= 0.5;
    this.barMat.color.setRGB(1, 0.19 + 0.3 * (catching ? Math.abs(Math.sin(this.t * 20)) : 0.5 + 0.5 * Math.sin(this.t * 3)), 0.28);
  }

  dispose() {
    this.object.removeFromParent();
    for (const g of this._geos) g.dispose();
    for (const m of this._mats) { m.map?.dispose(); m.dispose(); }
  }
}
