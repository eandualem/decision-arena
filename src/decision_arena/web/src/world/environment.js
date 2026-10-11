// WORLD owner: Environment = track, side scenery (streamed chunks), sky, fog, lights, tone mapping, themes and the
// curved-world sway. Public API (CONTRACTS.md 6.1): constructor(ctx), start(), reset(), update(dt, info),
// sun, hemi, themes, setTheme(id).
import * as THREE from 'three';
import { EV } from '../core/events.js';
import { damp } from '../core/utils.js';
import { CURVE, VIEW } from '../config.js';
import { THEMES, THEME_LIST } from './themes.js';
import { buildAtlases } from './textures.js';
import { buildTrack, PERIOD } from './track.js';
import { Scenery, CHUNK } from './scenery.js';
import { Chunks, kOf } from './chunks.js';
import { Sky } from './sky.js';

const TONE = { aces: THREE.ACESFilmicToneMapping, neutral: THREE.NeutralToneMapping, agx: THREE.AgXToneMapping, none: THREE.NoToneMapping };
const SWAY_AMP = 0.00105;          // max |curve.x| during runs
const SHADOW_DIST = 80;            // light distance from its target
const BEHIND_RUN = VIEW.despawnBehind + 4, BEHIND_MENU = VIEW.menuBackdrop + 4, AHEAD = VIEW.spawnAhead + 6;

/**
 * Workaround for core/curve.js (read-only for WORLD): it means to skip the bend in shadow depth passes via
 * `!defined(DEPTH_PACKING)`, but three r186 only defines DEPTH_PACKING in the FRAGMENT prefix, so shadow casters
 * were bent in light space (tens of meters at the sun's distance) and every shadow landed off-map. Opting the
 * depth/distance materials out of the curve restores consistent (unbent) shadow maps for all modules.
 */
export function fixShadowCurve() {
  const noop = function () {};
  if (THREE.MeshDepthMaterial.prototype.onBeforeCompile !== noop && !THREE.MeshDepthMaterial.prototype.__rdNoCurve) {
    THREE.MeshDepthMaterial.prototype.onBeforeCompile = noop;
    THREE.MeshDistanceMaterial.prototype.onBeforeCompile = noop;
    THREE.MeshDepthMaterial.prototype.__rdNoCurve = true;
  }
}

export class Environment {
  constructor(ctx) {
    this.ctx = ctx;
    const { scene } = ctx;
    fixShadowCurve();
    this.themes = THEME_LIST;
    this.quality = ctx.quality || 'high';
    this.atlas = buildAtlases(this.quality);

    // ---------------------------------------------------------------- materials (shared by every chunk)
    const matO = new THREE.MeshLambertMaterial({ map: this.atlas.mainTex, vertexColors: true });
    matO.shadowSide = THREE.DoubleSide;
    matO.name = 'world-atlas';
    const matC = new THREE.MeshLambertMaterial({ map: this.atlas.cutTex, vertexColors: true, alphaTest: 0.42, side: THREE.DoubleSide });
    matC.name = 'world-cutout';
    const matG = new THREE.MeshBasicMaterial({
      map: this.atlas.cutTex, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      fog: false, side: THREE.DoubleSide,
    });
    matG.name = 'world-glow';
    this.mats = { o: matO, n: matO, c: matC, g: matG };

    // ---------------------------------------------------------------- lights, fog
    this.hemi = new THREE.HemisphereLight(0xd6ecff, 0xa08a6e, 1.3);
    this.hemi.name = 'world-hemi';
    scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xfff2d6, 3);
    this.sun.name = 'world-sun';
    this.sunDir = new THREE.Vector3(-0.5, 0.78, -0.42).normalize();   // world light direction (rig applied)
    this.discDir = new THREE.Vector3(0, 1, 0);
    this.rigAngle = Math.PI;   // 0 = run rig, PI = menu rig (camera looks back at the player)
    this._rigDirty = true;
    this._lightX = new THREE.Vector3(); this._lightY = new THREE.Vector3();
    this._tmp = new THREE.Vector3();
    this._configureShadows();
    scene.add(this.sun, this.sun.target);
    scene.fog = new THREE.Fog(0xc9e8f6, 42, 250);
    scene.background = new THREE.Color(0xc9e8f6);

    // ---------------------------------------------------------------- sky, track, scenery
    this.sky = new Sky(ctx, this.quality);
    scene.add(this.sky.group);
    this.track = new THREE.Mesh(buildTrack(this.atlas, this.quality), matO);
    this.track.name = 'world-track';
    this.track.receiveShadow = true;
    this.track.frustumCulled = false;
    this.track.matrixAutoUpdate = false;
    scene.add(this.track);
    this.scenery = new Scenery(this.atlas, this.quality);
    this.chunks = new Chunks(scene, this.scenery, this.mats);

    // ---------------------------------------------------------------- state
    this.sway = { t: 0, amp: 0 };
    this.curveY = CURVE.y;
    this.theme = null;
    this.themeId = null;
    this._fresh = false;
    this._minZ = 0;
    this._state = 'boot';
    this._seedBase = (Math.random() * 1e9) >>> 0;
    this._resets = 0;
    this.setTheme('day');

    ctx.events.on(EV.SETTINGS, ({ key, value }) => { if (key === 'theme') this.setTheme(value); });
    ctx.events.on(EV.QUALITY, ({ quality }) => this._setQuality(quality));
  }

  // ------------------------------------------------------------------ lifecycle
  start() {
    const forced = this.ctx.params?.get?.('theme');
    const t = (forced && THEMES[forced]) ? forced : this.ctx.meta?.settings?.theme;
    this.setTheme(THEMES[t] ? t : 'day');
    this.reset();
  }

  /** Rebuild the world around z = 0. Cheap if the world is still fresh from the previous reset. */
  reset() {
    this.sway.t = 0;
    this._setRig(Math.PI);
    if (this._fresh && this._minZ > -12) { this._placeStatic(0, 'menu'); return; }
    this._resets++;
    this.scenery.reset((this._seedBase + this._resets * 7919) >>> 0);
    this.chunks.clear();
    // build what is visible right away synchronously, stream the rest over the next frames
    this.chunks.update(kOf(BEHIND_MENU), kOf(-110), 0, 99);
    this._fresh = true;
    this._minZ = 0;
    this._placeStatic(0, 'menu');
  }

  update(dt, info) {
    const pz = info?.playerZ ?? 0;
    const state = info?.state ?? 'menu';
    this._state = state;
    const menu = state === 'menu' || state === 'boot';
    if (pz < this._minZ) this._minZ = pz;
    if (pz < -12) this._fresh = false;

    // streaming: at most one chunk per frame (two if we fell behind)
    const kMin = kOf(pz + (menu ? BEHIND_MENU : BEHIND_RUN));
    const kMax = kOf(pz - AHEAD);
    const missing = this.chunks.update(kMin, kMax, kOf(pz - 30), 1);
    if (missing > 2) this.chunks.update(kMin, kMax, kOf(pz - 30), 1);

    // light rig follows the camera direction (menu looks back, run looks forward), blended during the intro swoop
    const rigTarget = menu ? Math.PI : 0;
    if (Math.abs(this.rigAngle - rigTarget) > 1e-4) {
      const k = 1 - Math.exp(-4.5 * Math.max(dt, 1 / 120));
      this._setRig(Math.abs(this.rigAngle - rigTarget) < 0.002 ? rigTarget : this.rigAngle + (rigTarget - this.rigAngle) * k);
    }

    this._placeStatic(pz, state);

    // curved world: gentle sideways sway while running, eases back to 0 in the menu
    if (dt > 0) {
      const running = state === 'running' || state === 'intro';
      if (running) this.sway.t += dt;
      const target = running ? 1 : menu ? 0 : this.sway.amp;
      this.sway.amp = damp(this.sway.amp, target, running ? 0.3 : 1.5, dt);
      const t = this.sway.t;
      const wave = Math.sin(t * 0.23 + 0.4) * 0.62 + Math.sin(t * 0.097 + 2.1) * 0.38;
      const c = this.ctx.curve.value;
      c.x = SWAY_AMP * wave * this.sway.amp;
      c.y = damp(c.y, this.curveY, 2.5, dt);
      this.sky.update(dt, this.ctx.camera, -c.x * 95);
    } else {
      this.sky.update(0, this.ctx.camera, -this.ctx.curve.value.x * 95);
    }
  }

  _placeStatic(pz, state) {
    // track treadmill (snapped to its texture/sleeper period so it looks static)
    this.track.position.z = Math.round(pz / PERIOD) * PERIOD;
    this.track.updateMatrix();
    // sun shadow follows the player (in the menu the camera looks backward: cover the area behind the start line)
    const menu = state === 'menu' || state === 'boot';
    const tz = menu ? pz + 14 : pz - 19;
    const T = this.sun.target.position.set(0, 0, tz);
    const tx = T.dot(this._lightX), ty = T.dot(this._lightY);
    T.addScaledVector(this._lightX, Math.round(tx / this._texelX) * this._texelX - tx);
    T.addScaledVector(this._lightY, Math.round(ty / this._texelY) * this._texelY - ty);
    this.sun.position.copy(T).addScaledVector(this.sunDir, SHADOW_DIST);
    this.sun.target.updateMatrixWorld();
  }

  /** Rotate the theme's light/disc directions about Y by `a` (0 = run camera rig, PI = menu rig). */
  _setRig(a) {
    this.rigAngle = a;
    const th = this.theme;
    if (!th) return;
    const c = Math.cos(a), s = Math.sin(a);
    const [x, y, z] = th.sun.dir;
    this.sunDir.set(x * c + z * s, y, -x * s + z * c).normalize();
    const [dx, dy, dz] = th.sun.discDir || th.sun.dir;
    this.discDir.set(dx * c + dz * s, dy, -dx * s + dz * c).normalize();
    this.sky.uniforms.uSunDir.value.copy(this.discDir);
    this._fitShadow();
  }

  // ------------------------------------------------------------------ themes
  setTheme(id) {
    const th = THEMES[id] || THEMES.day;
    this.theme = th; this.themeId = th.id;
    const { scene, renderer } = this.ctx;
    this.sun.color.setHex(th.sun.color);
    this.sun.intensity = th.sun.intensity;
    this.sun.shadow.intensity = th.shadow.intensity;
    this.hemi.color.setHex(th.hemi.sky);
    this.hemi.groundColor.setHex(th.hemi.ground);
    this.hemi.intensity = th.hemi.intensity;
    scene.fog.color.setHex(th.fog.color);
    scene.fog.near = th.fog.near; scene.fog.far = th.fog.far;
    scene.background.setHex(th.fog.color);
    const forcedTm = this.ctx.params?.get?.('tm');
    renderer.toneMapping = TONE[forcedTm] ?? TONE[th.toneMapping] ?? THREE.NeutralToneMapping;
    const ex = parseFloat(this.ctx.params?.get?.('exposure'));
    renderer.toneMappingExposure = Number.isFinite(ex) ? ex : th.exposure;
    this.sky.setTheme(th);
    this._setRig(this.rigAngle);
    this.mats.g.color.setScalar(th.glow);
    this.chunks.setGlowVisible(th.glow > 0.01);
    this.curveY = th.curveY ?? CURVE.y;
    this._placeStatic(this.ctx.game?.info?.playerZ ?? 0, this._state);
  }

  // ------------------------------------------------------------------ shadows
  _configureShadows() {
    const q = this.quality;
    const s = this.sun;
    s.castShadow = q !== 'low';
    const size = q === 'high' ? 2048 : 1024;
    if (s.shadow.mapSize.x !== size) {
      s.shadow.mapSize.set(size, size);
      if (s.shadow.map) { s.shadow.map.dispose(); s.shadow.map = null; }
    }
    s.shadow.bias = -0.0005;
    s.shadow.normalBias = 0.03;
    s.shadow.radius = q === 'high' ? 1.6 : 1.2;
  }
  /** Fit the orthographic shadow camera to x in [-12, 12], z in [player + 12, player - 50], y in [0, 17]. */
  _fitShadow() {
    const d = this.sunDir;
    const X = this._lightX.set(0, 1, 0).cross(d);
    if (X.lengthSq() < 1e-6) X.set(1, 0, 0);
    X.normalize();
    const Y = this._lightY.copy(d).cross(X).normalize();
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    const p = this._tmp;
    for (const cx of [-12.5, 12.5]) for (const cy of [-0.5, 17]) for (const cz of [-31.5, 31.5]) {
      p.set(cx, cy, cz);
      const a = p.dot(X), b = p.dot(Y), c = p.dot(d);
      x0 = Math.min(x0, a); x1 = Math.max(x1, a); y0 = Math.min(y0, b); y1 = Math.max(y1, b); z0 = Math.min(z0, c); z1 = Math.max(z1, c);
    }
    const cam = this.sun.shadow.camera;
    cam.left = x0 - 1; cam.right = x1 + 1; cam.bottom = y0 - 1; cam.top = y1 + 1;
    cam.near = Math.max(0.5, SHADOW_DIST - z1 - 8);
    cam.far = SHADOW_DIST - z0 + 8;
    cam.updateProjectionMatrix();
    const n = this.sun.shadow.mapSize.x;
    this._texelX = (cam.right - cam.left) / n;
    this._texelY = (cam.top - cam.bottom) / n;
  }

  _setQuality(q) {
    if (!q || q === this.quality) return;
    this.quality = q;
    this.scenery.quality = q;
    this._configureShadows();
    this._fitShadow();
    const aniso = q === 'low' ? 2 : 8;
    this.atlas.mainTex.anisotropy = aniso; this.atlas.cutTex.anisotropy = aniso;
    this.atlas.mainTex.needsUpdate = true; this.atlas.cutTex.needsUpdate = true;
    // rebuild streamed scenery with the new density (same seed -> same layout)
    const pz = this.ctx.game?.info?.playerZ ?? 0;
    const menu = this._state === 'menu' || this._state === 'boot';
    this.chunks.clear();
    this.chunks.update(kOf(pz + (menu ? BEHIND_MENU : BEHIND_RUN)), kOf(pz - 110), kOf(pz), 99);
  }

  /** Debug helper: chunk/triangle counts. */
  stats() { return { ...this.chunks.counts(), build: { ...this.chunks.stats }, track: (this.track.geometry.index.count / 3) | 0 }; }
}
