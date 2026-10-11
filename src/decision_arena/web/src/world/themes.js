// WORLD: visual themes. Every value here is applied instantly by Environment.setTheme (no geometry rebuild).
// Directions point FROM the scene TOWARD the light, expressed for the RUN camera (x right, y up, z toward the
// camera; forward is -z). The light rig turns 180 degrees for the menu camera (which looks back at the player),
// so the character's face is lit on the title screen. `sun.dir` = light direction, `sun.disc` = where the sun/moon
// disc is drawn in the sky (they may differ: stylized lighting).

export const THEMES = {
  day: {
    id: 'day', name: 'Sunny Day',
    sky: { zenith: 0x2f9be8, mid: 0x5ec8f5, horizon: 0xd4f1ff, below: 0xc4e6f4, horizonSharp: 3.2 },
    fog: { color: 0xc9e8f6, near: 42, far: 250 },
    sun: { color: 0xfff0d4, intensity: 3.5, dir: [-0.72, 0.64, 0.3], discDir: [-0.5, 0.62, -0.6], disc: 0xfffbe8, discSize: 0.9994, glow: 0xfff3c8, glowAmt: 0.55 },
    hemi: { sky: 0xd2ecff, ground: 0xb09774, intensity: 1.1 },
    exposure: 1.0, toneMapping: 'neutral',
    shadow: { intensity: 0.86 },
    glow: 0,               // night lights (lit windows, lamp halos, neon) strength
    lampHead: 0.0,
    clouds: { lit: 0xffffff, shade: 0xc8dcf0, rim: 0xffffff, opacity: 1 },
    far: { color: 0x9fc6de, haze: 0xcbe9f7, window: 0x000000, windowAmt: 0, hills: 0x8cc59a },
    stars: 0, moon: 0,
    curveY: 0.0021,
  },
  sunset: {
    id: 'sunset', name: 'Golden Hour',
    sky: { zenith: 0x4a5bb8, mid: 0xd9709a, horizon: 0xffc278, below: 0xf2a979, horizonSharp: 2.2 },
    fog: { color: 0xf0b48a, near: 36, far: 230 },
    sun: { color: 0xffc58a, intensity: 3.0, dir: [-0.86, 0.3, 0.22], discDir: [-0.42, 0.075, -0.9], disc: 0xfff1c2, discSize: 0.9988, glow: 0xffb35c, glowAmt: 1.0 },
    hemi: { sky: 0xffc9b0, ground: 0x7a5a6a, intensity: 1.15 },
    exposure: 1.0, toneMapping: 'neutral',
    shadow: { intensity: 0.66 },
    glow: 0.55,
    lampHead: 0.6,
    clouds: { lit: 0xffd2a6, shade: 0xb0679a, rim: 0xfff0c8, opacity: 1 },
    far: { color: 0xa87092, haze: 0xf2b38e, window: 0xffd27a, windowAmt: 0.35, hills: 0x9a6a86 },
    stars: 0, moon: 0,
    curveY: 0.0021,
  },
  night: {
    id: 'night', name: 'Neon Night',
    sky: { zenith: 0x060b2a, mid: 0x14245e, horizon: 0x3a4d8f, below: 0x2a3a72, horizonSharp: 2.6 },
    fog: { color: 0x26356c, near: 34, far: 215 },
    sun: { color: 0xa9c4ff, intensity: 1.35, dir: [0.55, 0.72, 0.3], discDir: [0.38, 0.4, -0.84], disc: 0xf4f6ff, discSize: 0.99955, glow: 0x8fa8ff, glowAmt: 0.35 },
    hemi: { sky: 0x6f86d8, ground: 0x2c2a4a, intensity: 1.25 },
    exposure: 1.18, toneMapping: 'neutral',
    shadow: { intensity: 0.55 },
    glow: 1.0,
    lampHead: 1.0,
    clouds: { lit: 0x6a78b0, shade: 0x2a3263, rim: 0xa9b8ff, opacity: 0.85 },
    far: { color: 0x1d2a5c, haze: 0x2e3f7a, window: 0xffd98a, windowAmt: 1.0, hills: 0x18244c },
    stars: 1, moon: 1,
    curveY: 0.0021,
  },
};

export const THEME_LIST = Object.values(THEMES).map(({ id, name }) => ({ id, name }));
