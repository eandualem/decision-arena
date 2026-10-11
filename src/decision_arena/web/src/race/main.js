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
import { Gateway, ModelPlayer } from './models.js';
import { Hud } from './hud.js';

installCurvedWorld();

const params = new URLSearchParams(location.search);

// The runners' characters, each with a second outfit for an image twin (or a second runner of that character).
export const LOOKS = [
  { character: 'zed', alt: 'midnight' },
  { character: 'mira', alt: 'sunset' },
  { character: 'pixel', alt: 'retro' },
  { character: 'rex', alt: 'lava' },
  { character: 'juno', alt: 'arctic' },
  { character: 'koa', alt: 'storm' },
  { character: 'luna', alt: 'eclipse' },
];
// One colour per seat, up to nine.
const COLORS = ['#ff9f1c', '#ff4f9a', '#3cc8ff', '#5be36b', '#b67dff', '#ffe14a', '#ff6b5b', '#4fe3d0', '#c9d3ff'];
const BOT_LAGS = [0, 0.12, 0.25, 0.4, 0.6, 0.8, 0.3, 0.5, 0.7];   // seconds: bots of different speeds

/** One seat per runner. `players` is the server's list (one entry per seat: a model's name, or null for a
 *  bot); a model seat is named after its model and asks it through the gateway. */
function seats(n, players) {
  const gateway = players.some((p) => p.name) ? new Gateway(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`) : null;
  // A model and its image twin share a character, whichever is seated first; the twin wears the second outfit.
  const base = (i) => players[i]?.name?.replace(/ image$/, '') ?? `bot ${i}`;
  const looks = new Map();
  for (let i = 0; i < n; i++) if (!looks.has(base(i))) looks.set(base(i), looks.size);
  const out = [];
  for (let i = 0; i < n; i++) {
    const model = players[i]?.name, image = !!players[i]?.image, k = looks.get(base(i));
    const look = LOOKS[k % LOOKS.length];
    out.push({
      name: model || look.character[0].toUpperCase() + look.character.slice(1),
      color: COLORS[i],
      character: look.character,
      outfit: image || k >= LOOKS.length ? look.alt : null,
      controller: model ? (runner) => new ModelPlayer(runner, i, gateway, image) : (runner) => new Bot(runner, BOT_LAGS[i]),
    });
  }
  return out;
}

/** The players the server was started with; none when the page is served without it. */
async function players() {
  try {
    const r = await fetch('players.json');
    return r.ok ? await r.json() : [];
  } catch { return []; }
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
const list = await players();
const runners = Math.max(2, Math.min(9, list.length || +params.get('runners') || 4));
race.setup(seats(runners, list));
hud.build();
hud._onState(race.state);
addEventListener('keydown', (e) => {
  if (e.code === 'Space' || e.code === 'Enter') { e.preventDefault(); start(); }
  if (e.code === 'KeyC') race.camera.toggleView();
  if (e.code === 'KeyD') hud.togglePanel();
});
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
  race.camera.flatten();
  ctx.fx.update(dt, race.focusInfo());
  ctx.audio.update(raw, race.focusInfo());
  hud.update();
  renderer.render(scene, camera);
});
window.__ready = true;
ctx.events.emit(EV.READY, {});
