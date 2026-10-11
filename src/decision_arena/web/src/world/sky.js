// WORLD: sky dome (gradient + sun/moon + stars), painted clouds and the far skyline / hills ring.
// All of these follow the camera and are NOT bent by the curved world (custom shaders without project_vertex).
import * as THREE from 'three';
import { makeCanvas } from '../core/tex.js';
import { mulberry } from './graffiti.js';

const SKY_VERT = /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = /* glsl */`
uniform vec3 uZenith, uMid, uHorizon, uBelow, uSunDir, uSunColor, uGlowColor;
uniform float uSunSize, uGlowAmt, uStars, uMoon, uTime, uHorizonSharp;
varying vec3 vDir;
float hash13(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  vec3 d = normalize(vDir);
  float h = d.y;
  vec3 col;
  if (h >= 0.0) {
    float t1 = 1.0 - exp(-h * uHorizonSharp * 3.0);
    col = mix(uHorizon, uMid, clamp(t1 * 1.25, 0.0, 1.0));
    col = mix(col, uZenith, smoothstep(0.18, 0.95, h));
  } else {
    col = mix(uHorizon, uBelow, smoothstep(0.0, 0.12, -h));
  }
  vec3 sd3 = normalize(uSunDir);
  float sd = dot(d, sd3);
  // wide glow + tight glow around the sun (and a warm band along the horizon under it)
  float g1 = pow(max(sd, 0.0), 6.0), g2 = pow(max(sd, 0.0), 48.0);
  float band = pow(max(dot(normalize(vec3(d.x, 0.0, d.z)), normalize(vec3(sd3.x, 0.0, sd3.z))), 0.0), 3.0) * exp(-abs(h) * 9.0);
  col += uGlowColor * (g1 * 0.35 + g2 * 0.9 + band * 0.45) * uGlowAmt;
  // disc (sun or moon)
  float disc = smoothstep(uSunSize, uSunSize + 0.00035, sd);
  vec3 discCol = uSunColor;
  if (uMoon > 0.5) {
    vec3 q = d * 900.0;
    float crater = hash13(floor(q * 0.7)) * 0.18;
    discCol *= 1.0 - crater;
  }
  col = mix(col, discCol, disc);
  // stars
  if (uStars > 0.0 && h > 0.02) {
    vec3 p = d * 260.0;
    vec3 cell = floor(p);
    float r = hash13(cell);
    if (r > 0.965) {
      vec3 c = cell + 0.5 + (vec3(hash13(cell + 7.1), hash13(cell + 3.3), hash13(cell + 5.7)) - 0.5) * 0.6;
      float dist = length(p - c);
      float tw = 0.65 + 0.35 * sin(uTime * (1.5 + r * 5.0) + r * 91.0);
      float s = smoothstep(0.22, 0.0, dist) * tw * smoothstep(0.02, 0.25, h);
      col += vec3(0.85, 0.9, 1.0) * s * uStars * (r > 0.992 ? 1.6 : 0.8);
    }
  }
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const LAYER_VERT = /* glsl */`
attribute float aLayer;
varying vec2 vUv;
varying float vLayer;
void main() {
  vUv = uv; vLayer = aLayer;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const LAYER_FRAG = /* glsl */`
uniform sampler2D map;
uniform vec3 uColor, uHaze, uWindow, uHills, uLit, uShade;
uniform float uWindowAmt, uOpacity;
varying vec2 vUv;
varying float vLayer;
void main() {
  vec4 t = texture2D(map, vUv);
  if (t.a < 0.01) discard;
  vec3 col;
  if (vLayer < 0.5) {            // skyline: r = near/far shade, g = windows; haze by height in the band
    float hv = (vUv.y - 0.5) * 2.0;
    vec3 base = mix(uHaze, uColor, 0.3 + 0.7 * t.r);
    col = mix(uHaze, base, smoothstep(0.08, 0.62, hv));
    col += uWindow * t.g * uWindowAmt * smoothstep(0.1, 0.5, hv);
  } else if (vLayer < 1.5) {     // hills
    float hv = vUv.y * 2.0;
    vec3 base = mix(uHaze, uHills, 0.4 + 0.6 * t.r);
    col = mix(uHaze, base, smoothstep(0.1, 0.75, hv));
  } else {                       // clouds: r = lighting
    col = mix(uShade, uLit, t.r);
    gl_FragColor = vec4(col, t.a * uOpacity);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
    return;
  }
  gl_FragColor = vec4(col, t.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

// ------------------------------------------------------------------ canvases
function paintFar(quality) {
  const W = 2048, H = 512;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const R = mulberry(4242);
  g.clearRect(0, 0, W, H);
  // ---- skyline band: rows 0..255. Channel use: r = layer shade, g = window light, b = vertical position (0 bottom .. 1 top)
  const band = 256;
  const drawBldg = (x, w, h, shade, detail) => {
    const draw = (xx) => {
      const top = band - h;
      g.fillStyle = `rgb(${shade},0,0)`;
      g.fillRect(xx, top, w, h);
      if (detail.roof === 1) { g.fillRect(xx + w * 0.3, top - 10, w * 0.4, 10); }
      if (detail.roof === 2) { g.fillRect(xx + w * 0.47, top - 30, 3, 30); }
      if (detail.roof === 3) { g.beginPath(); g.moveTo(xx, top); g.lineTo(xx + w / 2, top - w * 0.4); g.lineTo(xx + w, top); g.fill(); }
      if (detail.roof === 4) { g.fillRect(xx + w * 0.2, top - 14, 8, 14); g.fillRect(xx + w * 0.18, top - 20, 12, 6); }
      // windows (green channel)
      if (quality !== 'low') {
        g.globalCompositeOperation = 'lighter';
        for (let yy = top + 6; yy < band - 20; yy += 7) for (let wx = xx + 3; wx < xx + w - 3; wx += 5) {
          if (R() < 0.3) { g.fillStyle = `rgb(0,${(160 + R() * 95) | 0},0)`; g.fillRect(wx, yy, 2, 3); }
        }
        g.globalCompositeOperation = 'source-over';
      }
    };
    draw(x); if (x + w > W) draw(x - W); if (x < 0) draw(x + W);
  };
  // back layer (hazier), then front layer
  for (const [shade, count, hMin, hMax] of [[70, 70, 50, 150], [190, 55, 30, 110], [255, 26, 20, 70]]) {
    for (let i = 0; i < count; i++) {
      const w = 18 + R() * 50, h = hMin + Math.pow(R(), 1.6) * (hMax - hMin);
      drawBldg(R() * W, w, h, shade, { roof: R() < 0.5 ? 0 : 1 + ((R() * 4) | 0) });
    }
  }
  // a couple of tall landmark towers
  for (let i = 0; i < 3; i++) drawBldg(((i + 0.3 + R() * 0.4) / 3) * W, 34, 190 + R() * 50, 120, { roof: 2 });
  // ---- hills band: rows 256..511
  const hb0 = 256, hb = 256;
  const layers = [[110, 0.55, 0.0035, 60], [255, 0.35, 0.006, 40]];
  for (const [shade, base, freq, amp] of layers) {
    g.beginPath(); g.moveTo(0, hb0 + hb);
    const ph = R() * 10;
    for (let x = 0; x <= W; x += 4) {
      const t = (x / W) * Math.PI * 2;
      const y = hb0 + hb * (1 - base) - (Math.sin(t * 3 + ph) * 0.5 + Math.sin(t * 7 + ph * 2) * 0.3 + Math.sin(t * 13 + ph) * 0.2) * amp - amp * 0.5;
      g.lineTo(x, y);
    }
    g.lineTo(W, hb0 + hb); g.closePath();
    g.fillStyle = `rgb(${shade},0,0)`; g.fill();
  }
  // tree bumps on the front hills
  for (let i = 0; i < 160; i++) {
    const x = R() * W;
    const t = (x / W) * Math.PI * 2;
    const y = hb0 + hb * 0.65 - 20 + Math.sin(t * 5) * 6;
    g.fillStyle = 'rgb(200,0,0)';
    g.beginPath(); g.arc(x, y + R() * 50, 3 + R() * 5, 0, Math.PI * 2); g.fill();
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // data channels, not colors
  t.wrapS = THREE.RepeatWrapping;
  t.anisotropy = 4;
  t.needsUpdate = true;
  return t;
}

function paintClouds() {
  const W = 1024, H = 512;
  const c = makeCanvas(W, H), g = c.getContext('2d');
  const R = mulberry(777);
  // 4 cloud cells (512 x 256). r channel = lighting (1 lit top, 0 shaded bottom), alpha = coverage
  for (let k = 0; k < 4; k++) {
    const ox = (k % 2) * 512, oy = ((k / 2) | 0) * 256;
    const puffs = [];
    const n = 7 + ((R() * 5) | 0);
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      const x = ox + 70 + t * 372 + (R() - 0.5) * 30;
      const r = (38 + R() * 42) * (1 - Math.abs(t - 0.5) * 0.9);
      puffs.push({ x, y: oy + 180 - r * 0.7 - R() * 20, r });
    }
    for (let i = 0; i < 4; i++) puffs.push({ x: ox + 150 + R() * 212, y: oy + 110 - R() * 30, r: 40 + R() * 26 });
    // flat base
    g.fillStyle = 'rgb(60,60,60)';
    g.beginPath(); g.ellipse(ox + 256, oy + 186, 190, 22, 0, 0, Math.PI * 2); g.fill();
    for (const p of puffs) {
      const gr = g.createRadialGradient(p.x - p.r * 0.35, p.y - p.r * 0.45, p.r * 0.1, p.x, p.y, p.r * 1.05);
      gr.addColorStop(0, 'rgb(255,255,255)'); gr.addColorStop(0.55, 'rgb(225,225,225)'); gr.addColorStop(1, 'rgb(120,120,120)');
      g.fillStyle = gr;
      g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    }
    // flatten the bottom
    g.clearRect(ox, oy + 196, 512, 60);
  }
  // soften edges: blur pass by drawing to a second canvas
  const c2 = makeCanvas(W, H), g2 = c2.getContext('2d');
  g2.filter = 'blur(2px)';
  g2.drawImage(c, 0, 0);
  const t = new THREE.CanvasTexture(c2);
  t.colorSpace = THREE.NoColorSpace;
  t.needsUpdate = true;
  return t;
}

// ------------------------------------------------------------------ Sky
export class Sky {
  constructor(ctx, quality) {
    this.ctx = ctx;
    this.group = new THREE.Group();
    this.group.name = 'world-sky';
    this.uniforms = {
      uZenith: { value: new THREE.Color() }, uMid: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() }, uBelow: { value: new THREE.Color() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uGlowColor: { value: new THREE.Color() },
      uSunSize: { value: 0.9995 }, uGlowAmt: { value: 0.5 }, uStars: { value: 0 }, uMoon: { value: 0 }, uTime: { value: 0 }, uHorizonSharp: { value: 3 },
    };
    const skyMat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG,
      side: THREE.BackSide, depthWrite: false, depthTest: false, fog: false,
    });
    skyMat.defines = { NO_CURVE: '' };
    this.dome = new THREE.Mesh(new THREE.SphereGeometry(440, 48, 24), skyMat);
    this.dome.renderOrder = -1000;
    this.dome.frustumCulled = false;
    this.group.add(this.dome);

    // ---- far layers + clouds share one shader (layer attribute picks the look)
    this.farTex = paintFar(quality);
    this.cloudTex = paintClouds();
    this.farU = {
      map: { value: this.farTex }, uColor: { value: new THREE.Color() }, uHaze: { value: new THREE.Color() }, uWindow: { value: new THREE.Color() },
      uHills: { value: new THREE.Color() }, uWindowAmt: { value: 0 }, uLit: { value: new THREE.Color() }, uShade: { value: new THREE.Color() }, uOpacity: { value: 1 },
    };
    const farMat = new THREE.ShaderMaterial({ uniforms: this.farU, vertexShader: LAYER_VERT, fragmentShader: LAYER_FRAG, transparent: true, depthWrite: false, fog: false });
    farMat.defines = { NO_CURVE: '' };
    this.far = new THREE.Mesh(this._ringGeometry(quality), farMat);
    this.far.renderOrder = -2; this.far.frustumCulled = false;
    this.group.add(this.far);

    this.cloudU = Object.assign({}, this.farU, { map: { value: this.cloudTex } });
    const cloudMat = new THREE.ShaderMaterial({ uniforms: this.cloudU, vertexShader: LAYER_VERT, fragmentShader: LAYER_FRAG, transparent: true, depthWrite: false, fog: false, side: THREE.DoubleSide });
    cloudMat.defines = { NO_CURVE: '' };
    this.clouds = new THREE.Mesh(this._cloudGeometry(quality), cloudMat);
    this.clouds.renderOrder = -3; this.clouds.frustumCulled = false;
    this.cloudPivot = new THREE.Group();
    this.cloudPivot.add(this.clouds);
    this.group.add(this.cloudPivot);
    this.farPivot = this.far;
    this.cloudAngle = 0;
  }

  _ringGeometry(quality) {
    // skyline ring (radius 285) and hills ring (radius 320); the texture repeats 3x around
    const pos = [], uv = [], layer = [], idx = [];
    const ring = (radius, y0, y1, v0, v1, lay, reps, seg) => {
      const base = pos.length / 3;
      for (let i = 0; i <= seg; i++) {
        const a = (i / seg) * Math.PI * 2;
        const x = Math.sin(a) * radius, z = -Math.cos(a) * radius;
        pos.push(x, y0, z, x, y1, z);
        const u = (i / seg) * reps;
        uv.push(u, v0, u, v1);
        layer.push(lay, lay);
      }
      for (let i = 0; i < seg; i++) {
        const a = base + i * 2;
        // faces point inward (toward the camera at the center)
        idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
      }
    };
    if (quality !== 'low') ring(330, -60, 40, 0.0, 0.5, 1, 2, 96);  // hills (bottom half of the texture)
    ring(290, -45, 65, 0.5, 1.0, 0, 3, 128);                          // skyline (top half)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
    g.setIndex(idx);
    return g;
  }

  _cloudGeometry(quality) {
    const R = mulberry(99);
    const pos = [], uv = [], layer = [], idx = [];
    const n = quality === 'low' ? 9 : 16;
    const items = [];
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + (R() - 0.5) * 0.3;
      const radius = 300 + R() * 90;
      const w = 90 + R() * 110, h = w * 0.5;
      const elev = 0.05 + Math.pow(R(), 1.5) * 0.3;
      items.push({ a, radius, w, h, y: Math.tan(elev) * radius, cell: (R() * 4) | 0 });
    }
    items.sort((p, q) => q.radius - p.radius); // far first
    for (const it of items) {
      const cx = Math.sin(it.a) * it.radius, cz = -Math.cos(it.a) * it.radius;
      const tx = Math.cos(it.a), tz = Math.sin(it.a); // tangent
      const base = pos.length / 3;
      const hw = it.w / 2;
      pos.push(cx - tx * hw, it.y, cz - tz * hw, cx + tx * hw, it.y, cz + tz * hw, cx + tx * hw, it.y + it.h, cz + tz * hw, cx - tx * hw, it.y + it.h, cz - tz * hw);
      const u0 = (it.cell % 2) * 0.5, v0 = 0.5 - ((it.cell / 2) | 0) * 0.5;
      uv.push(u0, v0, u0 + 0.5, v0, u0 + 0.5, v0 + 0.5, u0, v0 + 0.5);
      layer.push(2, 2, 2, 2);
      idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('aLayer', new THREE.Float32BufferAttribute(layer, 1));
    g.setIndex(idx);
    return g;
  }

  setTheme(th) {
    const u = this.uniforms;
    u.uZenith.value.setHex(th.sky.zenith); u.uMid.value.setHex(th.sky.mid);
    u.uHorizon.value.setHex(th.sky.horizon); u.uBelow.value.setHex(th.sky.below);
    u.uHorizonSharp.value = th.sky.horizonSharp;
    u.uSunColor.value.setHex(th.sun.disc); u.uGlowColor.value.setHex(th.sun.glow);
    u.uSunSize.value = th.sun.discSize; u.uGlowAmt.value = th.sun.glowAmt;
    u.uStars.value = th.stars; u.uMoon.value = th.moon;
    const f = this.farU;
    f.uColor.value.setHex(th.far.color); f.uHaze.value.setHex(th.far.haze); f.uWindow.value.setHex(th.far.window);
    f.uWindowAmt.value = th.far.windowAmt; f.uHills.value.setHex(th.far.hills);
    f.uLit.value.setHex(th.clouds.lit); f.uShade.value.setHex(th.clouds.shade); f.uOpacity.value = th.clouds.opacity;
  }

  update(dt, camera, sway) {
    this.group.position.copy(camera.position);
    this.uniforms.uTime.value += dt;
    this.cloudAngle += dt * 0.0025;
    this.cloudPivot.rotation.y = this.cloudAngle + sway;
    this.far.rotation.y = sway;
  }
}
