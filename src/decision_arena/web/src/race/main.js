// Decision Arena bootstrap: Rail Dash's renderer, world, level, characters, effects and audio, with the race
// in place of the single-player game. Adapted from Rail Dash's src/main.js (no shop, menus or touch input).
import * as THREE from 'three';
import { installCurvedWorld, curveUniform } from '../core/curve.js';
import { EventBus, EV } from '../core/events.js';
import { RNG } from '../core/rng.js';
import { setMaxAnisotropy } from '../core/tex.js';
import * as CONFIG from '../config.js';
import { AudioSystem } from '../audio/audio.js';
import { Environment } from '../world/environment.js';
import { Level } from '../level/level.js';
import { Characters } from '../characters/characters.js';
import { FX } from '../fx/fx.js';
import { Race } from './race.js';
import { Bot } from './bots.js';
import { Hud } from './hud.js';

installCurvedWorld();

const params = new URLSearchParams(location.search);

// The runners: one per seat, each with its own character and colour.
export const LOOKS = [
  { character: 'zed', color: '#ff9f1c' },
  { character: 'mira', color: '#ff4f9a' },
  { character: 'pixel', color: '#3cc8ff' },
  { character: 'rex', color: '#5be36b' },
  { character: 'juno', color: '#b67dff' },
  { character: 'koa', color: '#ffe14a' },
];
const BOT_LAGS = [0, 0.12, 0.25, 0.4, 0.6, 0.8];   // seconds: bots of different speeds

function botSeats(n) {
  return LOOKS.slice(0, n).map((look, i) => ({
    name: look.character[0].toUpperCase() + look.character.slice(1),
    color: look.color,
    character: look.character,
    outfit: null,
    controller: (runner) => new Bot(runner, BOT_LAGS[i]),
  }));
}

// ---------------------------------------------------------------- renderer / scene / camera
const quality = params.get('quality') || 'high';
const container = document.getElementById('game');
const renderer = new THREE.WebGLRenderer({ antialias: quality !== 'low', powerPreference: 'high-performance', stencil: false });
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = quality !== 'low';
renderer.shadowMap.type = THREE.PCFShadowMap;
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, quality === 'high' ? 2 : 1.5));
setMaxAnisotropy(renderer.capabilities.getMaxAnisotropy());
container.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(62, 1, 0.1, CONFIG.VIEW.cameraFar);
scene.add(camera);

const ctx = {
  renderer, scene, camera, container, events: new EventBus(), config: CONFIG, curve: curveUniform,
  rng: new RNG(), params, debug: params.has('debug'), isTouch: false, isMobile: false,
  quality, qualitySetting: quality, time: 0, realTime: 0, timeScale: 1, pixelRatio: 1, maxPixelRatio: 2,
};
window.__arena = ctx;   // for tests and debugging

function resize() {
  const w = container.clientWidth || innerWidth, h = container.clientHeight || innerHeight;
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  ctx.events.emit(EV.RESIZE, { w, h, aspect: w / h });
}
addEventListener('resize', resize);

// ---------------------------------------------------------------- systems
ctx.audio = new AudioSystem(ctx);
ctx.env = new Environment(ctx);
ctx.level = new Level(ctx);
ctx.characters = new Characters(ctx);
ctx.game = new Race(ctx);
ctx.fx = new FX(ctx);
for (const n of ['audio', 'env', 'level', 'characters', 'game', 'fx']) ctx[n].start?.();
resize();

const race = ctx.game;
const start = () => { ctx.audio.unlock?.(); race.go(); };
const hud = new Hud(ctx, race, { onStart: start });
const runners = Math.max(2, Math.min(6, +params.get('runners') || 4));
race.setup(botSeats(runners));
hud.build();
hud._onState(race.state);
addEventListener('keydown', (e) => { if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); start(); } });
document.addEventListener('visibilitychange', () => ctx.audio.setSuspended?.(document.hidden));

// ---------------------------------------------------------------- frame loop
let last = performance.now();
renderer.setAnimationLoop((now) => {
  let raw = (now - last) / 1000;
  last = now;
  if (!(raw > 0)) raw = 1 / 60;
  raw = Math.min(raw, 0.05);
  const dt = raw * ctx.timeScale;
  ctx.time += dt;
  ctx.realTime += raw;
  const info = race.frameInfo();
  ctx.level.update(dt, info);
  race.update(dt, raw);
  ctx.env.update(dt, info);
  ctx.fx.update(dt, info);
  ctx.audio.update(raw, info);
  hud.update();
  renderer.render(scene, camera);
});
window.__ready = true;
ctx.events.emit(EV.READY, {});
