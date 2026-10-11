// Shared materials for characters, boards, props and the chaser.
// Slots: body (vertex colors, matte), print (vertex colors x per-outfit atlas), shiny (glossy / chrome with a
// tiny procedural env map), glow (unlit vertex colors), glass (transparent visor/bubble).
import * as THREE from 'three';

let env = null;          // PMREM texture (outdoor gradient) for glossy materials
let envRenderer = null;
const shared = {};

/** Build (once) a small outdoor environment map: sky gradient, warm horizon, ground, bright sun. */
export function initEnvironment(renderer) {
  if (env || !renderer) return env;
  envRenderer = renderer;
  try {
    const scene = new THREE.Scene();
    const geo = new THREE.SphereGeometry(10, 32, 16);
    const col = [];
    const top = new THREE.Color(0x4fb4f0), hor = new THREE.Color(0xfff0d8), gnd = new THREE.Color(0x6e6254), deep = new THREE.Color(0x3a332b);
    const c = new THREE.Color();
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) {
      const y = p.getY(i) / 10;
      if (y > 0) c.copy(hor).lerp(top, Math.pow(y, 0.6)); else c.copy(gnd).lerp(deep, Math.min(1, -y * 2));
      c.multiplyScalar(y > 0 ? 1.15 : 0.8);
      col.push(c.r, c.g, c.b);
    }
    geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    const dome = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide }));
    scene.add(dome);
    const sun = new THREE.Mesh(new THREE.SphereGeometry(1.1, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(9, 8.4, 7.2) }));
    sun.position.set(-4, 6.5, -5);
    scene.add(sun);
    const fill = new THREE.Mesh(new THREE.SphereGeometry(2.2, 12, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(1.6, 1.7, 1.9) }));
    fill.position.set(6, 3, 5);
    scene.add(fill);
    const pm = new THREE.PMREMGenerator(renderer);
    const rt = pm.fromScene(scene, 0.02);
    pm.dispose();
    geo.dispose(); dome.material.dispose(); sun.geometry.dispose(); sun.material.dispose(); fill.geometry.dispose(); fill.material.dispose();
    env = rt.texture;
    for (const m of Object.values(shared)) if (m.userData.wantsEnv) { m.envMap = env; m.needsUpdate = true; }
  } catch (e) {
    console.warn('[characters] env map unavailable', e);
  }
  return env;
}
export function getEnvMap() { return env; }

function remember(key, make) {
  if (!shared[key]) shared[key] = make();
  return shared[key];
}

/** Matte vertex-colored material shared by every character. */
export function bodyMaterial() {
  return remember('body', () => new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.74, metalness: 0.0 }));
}
/** Glossy plastic / chrome (vertex colors). metal: 0 plastic .. 1 chrome */
export function shinyMaterial(kind = 'gloss') {
  return remember('shiny_' + kind, () => {
    const chrome = kind === 'chrome';
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true,
      roughness: chrome ? 0.22 : 0.3,
      metalness: chrome ? 0.85 : 0.1,
      envMap: env,
      envMapIntensity: chrome ? 1.15 : 0.55,
    });
    m.userData.wantsEnv = true;
    return m;
  });
}
/** Unlit glowing parts (vertex colors, not tone mapped so they pop). */
export function glowMaterial() {
  return remember('glow', () => new THREE.MeshBasicMaterial({ vertexColors: true, toneMapped: false }));
}
/** Per-instance glow material (for pulsing / flashing). */
export function makeGlowMaterial(color = 0xffffff) {
  return new THREE.MeshBasicMaterial({ vertexColors: true, color, toneMapped: false });
}
/** Transparent glass (bubble helmet, visors). */
export function glassMaterial() {
  return remember('glass', () => {
    const m = new THREE.MeshStandardMaterial({
      vertexColors: true, transparent: true, opacity: 0.28, roughness: 0.04, metalness: 0.1,
      envMap: env, envMapIntensity: 1.4, depthWrite: false, side: THREE.FrontSide,
    });
    m.userData.wantsEnv = true;
    return m;
  });
}
/** Additive soft glow (board underglow, flashlight beam): uses a map with a radial / linear falloff. */
export function additiveMaterial(map, color = 0xffffff, opacity = 1) {
  return new THREE.MeshBasicMaterial({
    map, color, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false, side: THREE.DoubleSide,
  });
}
/** Vertex-colored material multiplied by an atlas texture (per character outfit). */
export function printMaterial(map) {
  return new THREE.MeshStandardMaterial({ vertexColors: true, map, roughness: 0.78, metalness: 0.0 });
}
/** Face material: canvas texture on a sphere patch. `screen` = unlit glowing display (robots). */
export function faceMaterial(map, screen = false) {
  if (screen) return new THREE.MeshBasicMaterial({ map, toneMapped: false });
  return new THREE.MeshStandardMaterial({ map, roughness: 0.72, metalness: 0.0 });
}

// ------------------------------------------------------------------ small shared textures
const texCache = {};
/** Radial soft glow sprite (white center -> transparent) */
export function radialTexture() {
  if (texCache.radial) return texCache.radial;
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, 'rgba(255,255,255,1)'); grd.addColorStop(0.35, 'rgba(255,255,255,0.55)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (texCache.radial = t);
}
/** Flame / beam gradient: bright at v = 0, transparent at v = 1 (cones built with the base at v = 0). */
export function flameTexture() {
  if (texCache.flame) return texCache.flame;
  const c = document.createElement('canvas'); c.width = 8; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 64, 0, 0);
  grd.addColorStop(0, 'rgba(255,255,235,1)'); grd.addColorStop(0.25, 'rgba(255,210,120,0.9)'); grd.addColorStop(0.6, 'rgba(255,120,40,0.45)'); grd.addColorStop(1, 'rgba(255,60,0,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 8, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (texCache.flame = t);
}
/** Linear falloff along v (1 at v=1 -> 0 at v=0): for beams / trails */
export function beamTexture() {
  if (texCache.beam) return texCache.beam;
  const c = document.createElement('canvas'); c.width = 8; c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createLinearGradient(0, 0, 0, 64);
  grd.addColorStop(0, 'rgba(255,255,255,0.9)'); grd.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grd; g.fillRect(0, 0, 8, 64);
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
  return (texCache.beam = t);
}
