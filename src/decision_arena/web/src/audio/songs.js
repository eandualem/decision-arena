// Rail Dash original music (AUDIOFX). Pure data + a tiny compiler; no WebAudio here (node-testable).
//
// Two original tracks, both written for this game:
//   'menu' - "Yard Lights": laid-back lo-fi boom-bap, 86 BPM, heavy swing, F major jazz changes
//            (ii-V-I-vi turnaround / IV-III7-vi), Rhodes-style FM keys, kalimba + flute melodies, vinyl crackle.
//   'run'  - "Rail Rush": electro-funk breakbeat, 116 BPM, light swing, A dorian vamp (i7-IV9) with a
//            tresillo-rhythm synth hook, octave funk bass, off-beat stabs, arps and a build/drop break.
//
// A song compiles to bars[]; each bar has 16 sixteenth steps holding events
//   { i: instrument id, s: step (0..15.99), n: midi | midi[], d: length in steps, v: velocity 0..1, l: legato, c: cutoff mult }
// Instruments are bound to intensity layers (0 base, 1 groove, 2 energy, 3 peak) in `instruments`.

const PC = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
/** 'C#4' -> 61, 'Bb3' -> 58 (C4 = 60). */
export function nm(s) {
  const m = /^([A-G])(#|b)?(-?\d)$/.exec(s);
  if (!m) throw new Error('bad note ' + s);
  return 12 * (+m[3] + 1) + PC[m[1]] + (m[2] === '#' ? 1 : m[2] === 'b' ? -1 : 0);
}
const notes = (str) => str.trim().split(/\s+/).map(nm);

/** Melody bar: "E5:0:3 D5:3:3~ G5:10:2:0.7" = note:step:length[:velocity], trailing ~ = legato (glide into next). */
function mel(str, v = 0.9) {
  if (!str || !str.trim()) return [];
  return str.trim().split(/\s+/).map((tok) => {
    let l = false;
    if (tok.endsWith('~')) { l = true; tok = tok.slice(0, -1); }
    const [n, s, d, vv] = tok.split(':');
    return { n: nm(n), s: +s, d: +d, v: vv ? +vv : v, l };
  });
}

const VEL = { X: 1, x: 0.8, o: 0.55, g: 0.3 };
/** Drum grid: 16 chars, X x o g = velocities, anything else = rest. */
function grid(str) {
  const out = [];
  for (let i = 0; i < str.length; i++) { const v = VEL[str[i]]; if (v) out.push({ s: i, v }); }
  return out;
}

/** Chord table entry: [bass root, voicing, bass colour interval] */
function chordTable(src) {
  const t = {};
  for (const [name, [root, voicing, color]] of Object.entries(src)) t[name] = { name, root: nm(root), v: notes(voicing), color };
  return t;
}

// Bass templates: [step, interval | 'C' colour | 'A' approach (next root +-1) , length, velocity]
const BASS = {
  funk:  [[0, 0, 2, 1], [3, 0, 1, 0.6], [4, 12, 1, 0.9], [6, 0, 1, 0.72], [8, 0, 2, 0.95], [10, 7, 1, 0.8], [11, 12, 1, 0.6], [12, 0, 1, 0.85], [14, 'C', 1, 0.75], [15, 'A', 1, 0.7]],
  funkB: [[0, 0, 2, 1], [2, 12, 1, 0.8], [3, 0, 1, 0.6], [6, 0, 2, 0.8], [8, 0, 1, 0.95], [9, 12, 1, 0.7], [10, 'C', 1, 0.7], [12, 7, 1, 0.85], [13, 12, 1, 0.6], [14, 0, 1, 0.8], [15, 'A', 1, 0.7]],
  disco: [[0, 0, 2, 1], [2, 12, 2, 0.75], [4, 0, 2, 0.95], [6, 12, 2, 0.75], [8, 0, 2, 0.95], [10, 12, 2, 0.75], [12, 0, 2, 0.95], [14, 12, 1, 0.75], [15, 'A', 1, 0.7]],
  long:  [[0, 0, 7, 0.9], [8, 7, 6, 0.8], [14, 'A', 2, 0.7]],
  intro: [[0, 0, 2, 1], [3, 0, 1, 0.6], [6, 0, 1, 0.72], [8, 0, 2, 0.95], [11, 0, 1, 0.6], [14, 'C', 1, 0.7], [15, 'A', 1, 0.7]],
  lofi:  [[0, 0, 9, 0.95], [10, 7, 4, 0.75], [14, 'A', 2, 0.65]],
  lofi2: [[0, 0, 6, 0.95], [7, 0, 3, 0.7], [10, 7, 4, 0.75], [14, 'A', 2, 0.65]],
  split: [[0, 0, 7, 0.9], [8, 0, 6, 0.85], [14, 'A', 2, 0.7]],
};

function bassLine(tpl, ch, next, extra = {}) {
  const out = [];
  for (const [s, iv, d, v] of BASS[tpl]) {
    let n;
    if (iv === 'C') n = ch.root + ch.color;
    else if (iv === 'A') {
      if (!next || next.root === ch.root) n = ch.root + 7;
      else n = next.root + (next.root > ch.root ? -1 : 1);
    } else n = ch.root + iv;
    out.push({ i: 'bass', s, n, d, v, ...extra });
  }
  return out;
}

function compile(def) {
  // pass 1: lay out chords for every bar of the arrangement
  const layout = [];
  for (const secName of def.arrangement) {
    const sec = def.sections[secName];
    const chords = sec.chords.trim().split(/\s+/);
    chords.forEach((c, b) => layout.push({ section: secName, variant: secName, bar: b, bars: chords.length, chord: c }));
  }
  const loopBar = def.arrangement.slice(0, def.loopFrom).reduce((n, s) => n + def.sections[s].chords.trim().split(/\s+/).length, 0);
  const ch = (name) => { const c = def.chords[name]; if (!c) throw new Error('unknown chord ' + name); return c; };
  // pass 2: events
  const bars = layout.map((L, idx) => {
    const nextIdx = idx + 1 < layout.length ? idx + 1 : loopBar;
    const [c1, c2] = L.chord.split('|');
    const chord = ch(c1), chord2 = c2 ? ch(c2) : null;
    const nextChord = ch(layout[nextIdx].chord.split('|')[0]);
    const events = def.sections[L.section].build({ b: L.bar, bars: L.bars, ch: chord, ch2: chord2, next: nextChord, grid, mel, bassLine });
    const steps = Array.from({ length: 16 }, () => []);
    for (const e of events) {
      if (e.s < 0 || e.s >= 16) throw new Error(`event outside bar in ${L.section}:${L.bar}`);
      steps[Math.floor(e.s)].push(e);
    }
    return { section: L.section, bar: L.bar, chord: L.chord, events, steps };
  });
  return { name: def.name, title: def.title, bpm: def.bpm, swing: def.swing, gain: def.gain ?? 1, echo: def.echo, instruments: def.instruments, bars, loopBar };
}

const hits = (id, str, extra) => grid(str).map((h) => ({ i: id, s: h.s, v: h.v, ...extra }));
const mels = (id, str, v, extra) => mel(str, v).map((m) => ({ i: id, ...m, ...extra }));

// =====================================================================================================
// RUN: "Rail Rush" (A dorian, 116 BPM)
// =====================================================================================================
const RUN_CHORDS = chordTable({
  Am7:    ['A2', 'E4 G4 A4 C5', 10],
  D9:     ['D2', 'E4 F#4 A4 C5', 10],
  Fmaj9:  ['F2', 'E4 G4 A4 C5', 9],
  G6:     ['G2', 'D4 E4 G4 B4', 9],
  Em7:    ['E2', 'D4 E4 G4 B4', 10],
  E7:     ['E2', 'D4 E4 G#4 B4', 10],
  Dm7:    ['D2', 'D4 F4 A4 C5', 10],
  G:      ['G2', 'D4 G4 B4 D5', 9],
  Cmaj7:  ['C3', 'C4 E4 G4 B4', 9],
  E7sus4: ['E2', 'D4 E4 A4 B4', 10],
});

// The hook: tresillo (3+3+4) call over the i-IV vamp, stepwise answer over bVI-bVII-i-V.
const HOOK = [
  'E5:0:3 D5:3:3 E5:6:4 G5:10:2 A5:12:4',
  'G5:2:1 F#5:3:3 E5:6:2 D5:8:4 E5:12:4',
  'E5:0:3 D5:3:3 E5:6:4 G5:10:2 A5:12:4',
  'A5:0:2 B5:2:2 A5:4:2 F#5:6:3 E5:9:3 D5:12:2 E5:14:2',
  'A5:0:3 G5:3:3 E5:6:4 C5:10:2 E5:12:4',
  'D5:0:3 E5:3:3 G5:6:4 E5:10:2 D5:12:4',
  'E5:0:3 C5:3:3 A4:6:4 B4:10:2 C5:12:4',
  'G#4:0:3 B4:3:3 D5:6:2 E5:8:2 G#5:10:2 B5:12:4',
];
// B section: lyrical descending counter-line
const COUNTER = [
  'A5:0:6 G5:6:2 E5:8:8',
  'D5:0:4 E5:4:2 G5:6:2 B5:8:6 A5:14:2',
  'G5:0:6 E5:6:2 D5:8:4 B4:12:4',
  'C5:0:4 E5:4:4 A5:8:8',
  'F5:0:6 E5:6:2 D5:8:4 C5:12:4',
  'B4:0:4 D5:4:4 G5:8:6 F5:14:2',
  'E5:0:6 D5:6:2 C5:8:4 B4:12:4',
  'B4:0:2 D5:2:2 E5:4:2 G#5:6:4 B5:10:6',
];
const BREAK_LEAD = ['E5:0:6 D5:6:6 E5:12:4', 'G5:0:8 A5:8:8', 'A5:0:6 G5:6:6 E5:12:4', 'C5:0:12'];

const RD = {
  k1: 'X......x..x.....', k2: 'X.x....x..x...o.', k4: 'X...X...X...X...',
  s1: '....X.......X...', s2: '....X....g..X..g', sF: '....X.......XoxX',
  s8: 'o.o.o.o.x.x.x.x.', roll: 'ggggooooxxxxXXXX',
  h16: 'xgxgxgxgxgxgxg.g', h8: 'x.x.x.x.x.x.x.x.', oh: '..............x.',
  sh: '..o...o...o...o.', cl: '....x.......x...',
};
const ARP = [0, 1, 2, 3, 4, 3, 2, 1, 0, 1, 2, 3, 4, 3, 2, 1];

function arp(ch, oct, v = 0.75) {
  const pool = [...ch.v, ch.v[0] + 12];
  return ARP.map((k, s) => ({ i: 'arp', s, n: pool[k] + oct, d: 1, v: v * (s % 4 === 0 ? 1 : 0.75) }));
}
const stabs = (ch, v = 1) => [[2, 0.7], [6, 0.8], [10, 0.7], [14, 0.85]].map(([s, vv]) => ({ i: 'stab', s, n: ch.v, d: 1, v: vv * v }));
const pad = (ch, v = 0.8, d = 16) => [{ i: 'pad', s: 0, n: ch.v, d, v }];

function runDrums(b, bars, { fill = true, kick2 = true } = {}) {
  const last = b === bars - 1;
  return [
    ...hits('kick', kick2 && b % 2 === 1 ? RD.k2 : RD.k1),
    ...hits('snare', last && fill ? RD.sF : b % 2 === 1 ? RD.s2 : RD.s1),
    ...hits('clap', RD.cl),
    ...hits('hat', RD.h16),
    ...hits('ohat', RD.oh),
    ...hits('shaker', RD.sh),
    ...(b === 0 ? [{ i: 'crash', s: 0, v: 0.9 }] : []),
  ];
}

function hookSection({ b, bars, ch, next }, { lead2 = 'none', arpOct = 0, bass = 'funk' } = {}) {
  const ev = [...runDrums(b, bars), ...bassLine(b % 4 === 3 ? 'funkB' : bass, ch, next), ...stabs(ch), ...mels('lead', HOOK[b], 0.9)];
  if (lead2 === 'all' || (lead2 === 'half' && b >= 4)) ev.push(...mels('lead2', HOOK[b], 0.85));
  ev.push(...arp(ch, arpOct, 0.6));
  return ev;
}

const RUN_DEF = {
  name: 'run', title: 'Rail Rush', bpm: 116, swing: 0.08, gain: 1,
  echo: { beats: 0.75, fb: 0.3, cut: 2600 },
  instruments: {
    kick:   { type: 'kick', layer: 0, cfg: { level: 0.78, f0: 170, f1: 52, pitchT: 0.07, decay: 0.3, click: 0.32 } },
    snare:  { type: 'snare', layer: 0, cfg: { level: 0.5, tone: 196, hp: 1300, decay: 0.2, rev: 0.12 } },
    clap:   { type: 'clap', layer: 1, cfg: { level: 0.36, rev: 0.18 } },
    hat:    { type: 'hat', layer: 1, cfg: { level: 0.12, decay: 0.04 } },
    ohat:   { type: 'hat', layer: 1, cfg: { level: 0.1, decay: 0.26 } },
    shaker: { type: 'shaker', layer: 2, cfg: { level: 0.9 } },
    crash:  { type: 'crash', layer: 0, cfg: { level: 0.4, rev: 0.2 } },
    riser:  { type: 'riser', layer: 0, cfg: { level: 0.48 } },
    bass:   { type: 'mono', layer: 0, cfg: { level: 0.3, wave: 'sawtooth', wave2: 'square', mix2: 0.35, detune2: -6, sub: 0.4, cut: 420, env: 1900, q: 7, fdecay: 0.06, atk: 0.003, dec: 0.18, sus: 0.55, rel: 0.035, gate: 0.85 } },
    stab:   { type: 'stab', layer: 0, cfg: { level: 0.13, cut: 900, env: 2600, q: 3, decay: 0.12, rev: 0.12 } },
    pad:    { type: 'pad', layer: 0, cfg: { level: 0.055, cut: 1500, atk: 0.35, rel: 0.6, rev: 0.35 } },
    arp:    { type: 'pluck', layer: 2, cfg: { level: 0.54, decay: 0.16, cut: 3800, echo: 0.3, rev: 0.12, pan: 0.25 } },
    lead:   { type: 'mono', layer: 1, cfg: { level: 0.23, wave: 'lead', wave2: 'sawtooth', mix2: 0.3, detune2: 8, cut: 1500, env: 2600, q: 2.2, fdecay: 0.12, atk: 0.006, dec: 0.25, sus: 0.72, rel: 0.07, glide: 0.03, vib: 14, vibRate: 5.6, vibDelay: 0.16, gate: 0.9, echo: 0.22, rev: 0.16 } },
    lead2:  { type: 'mono', layer: 3, cfg: { level: 0.15, oct: 12, wave: 'pulse25', cut: 2200, env: 1800, q: 1.2, fdecay: 0.1, atk: 0.008, dec: 0.2, sus: 0.7, rel: 0.08, vib: 10, vibRate: 5.6, vibDelay: 0.2, gate: 0.85, echo: 0.3, rev: 0.2, pan: -0.2 } },
  },
  chords: RUN_CHORDS,
  sections: {
    intro: {
      chords: 'Am7 D9 Am7 D9',
      build: ({ b, ch, next }) => [
        ...hits('kick', b < 2 ? 'X.......X.......' : RD.k1),
        ...hits('hat', b < 1 ? RD.h8 : RD.h16),
        ...(b >= 2 ? hits('snare', b === 3 ? RD.sF : RD.s1) : []),
        ...(b === 3 ? hits('clap', RD.cl) : []),
        ...bassLine('intro', ch, next, { c: 0.35 + b * 0.18 }),
        ...(b >= 2 ? stabs(ch, 0.8) : []),
      ],
    },
    A: {
      chords: 'Am7 D9 Am7 D9 Fmaj9 G6 Am7 E7',
      build: (x) => hookSection(x, { arpOct: 0 }),
    },
    A2: {
      chords: 'Am7 D9 Am7 D9 Fmaj9 G6 Am7 E7',
      build: (x) => hookSection(x, { lead2: 'half', arpOct: 0 }),
    },
    A3: {
      chords: 'Am7 D9 Am7 D9 Fmaj9 G6 Am7 E7',
      build: (x) => hookSection(x, { lead2: 'all', arpOct: 12 }),
    },
    B: {
      chords: 'Fmaj9 G6 Em7 Am7 Dm7 G Cmaj7 E7',
      build: ({ b, bars, ch, next }) => [
        ...runDrums(b, bars, { kick2: false }),
        ...bassLine('disco', ch, next),
        ...pad(ch),
        ...mels('lead', COUNTER[b], 0.85),
        ...arp(ch, 12, 0.5),
      ],
    },
    B2: {
      chords: 'Fmaj9 G6 Em7 Am7 Dm7 G Cmaj7 E7',
      build: ({ b, bars, ch, next }) => [
        ...runDrums(b, bars),
        ...bassLine(b % 2 ? 'funkB' : 'disco', ch, next),
        ...pad(ch, 0.7),
        ...stabs(ch, 0.7),
        ...mels('lead', COUNTER[b], 0.9),
        ...mels('lead2', COUNTER[b], 0.8),
        ...arp(ch, 12, 0.5),
      ],
    },
    break: {
      chords: 'Am7 Am7 Fmaj9 Fmaj9 Dm7 Dm7 E7sus4 E7',
      build: ({ b, ch, next }) => {
        const ev = [...bassLine('long', ch, next, { c: 0.6 }), ...pad(ch, 0.85), ...arp(ch, 12, b < 4 ? 0.45 : 0.7)];
        if (b < 4) {
          ev.push(...hits('hat', RD.h8), ...hits('snare', '....o.......o...'), ...mels('lead', BREAK_LEAD[b], 0.6, { c: 0.55 }));
        } else {
          ev.push(...hits('hat', RD.h16));
          if (b < 7) ev.push(...hits('kick', RD.k4));
          if (b === 6) ev.push(...hits('snare', RD.s8));
          if (b === 7) ev.push(...hits('snare', RD.roll), ...hits('kick', 'X...X...X.......'));
          if (b === 4) ev.push({ i: 'riser', s: 0, d: 64, v: 1 });
        }
        return ev;
      },
    },
  },
  arrangement: ['intro', 'A', 'B', 'A2', 'break', 'A3', 'B2'],
  loopFrom: 1,
};

// =====================================================================================================
// MENU: "Yard Lights" (F major lo-fi, 86 BPM)
// =====================================================================================================
const MENU_CHORDS = chordTable({
  Gm9:     ['G2', 'Bb3 D4 F4 A4', 7],
  C13:     ['C3', 'Bb3 D4 E4 A4', 7],
  Fmaj9:   ['F2', 'A3 C4 E4 G4', 7],
  Dm9:     ['D2', 'F3 A3 C4 E4', 7],
  Am7:     ['A2', 'G3 C4 E4 A4', 7],
  'D7#9':  ['D2', 'F#3 C4 F4 A4', 7],
  Bbmaj9:  ['Bb2', 'A3 C4 D4 F4', 7],
  A7b9:    ['A2', 'G3 Bb3 C#4 E4', 7],
  'Dm9/C': ['C3', 'F3 A3 C4 E4', 7],
  Bbmaj7:  ['Bb2', 'F3 A3 Bb3 D4', 7],
  Gm7:     ['G2', 'F3 Bb3 D4 F4', 7],
  C7sus4:  ['C3', 'G3 Bb3 C4 F4', 7],
  C7:      ['C3', 'E3 Bb3 D4 G4', 7],
});

const KALIMBA_A = [
  'D5:0:2 F5:2:2 A5:4:4 G5:10:2 F5:12:4',
  'G5:0:6 E5:6:2 D5:8:8',
  'A5:0:3 G5:3:3 E5:6:2 C5:8:8',
  'D5:0:4 F5:4:2 E5:6:10',
  'D5:0:2 F5:2:2 A5:4:4 C6:10:2 Bb5:12:4',
  'A5:0:6 G5:6:2 E5:8:8',
  'E5:0:3 D5:3:3 C5:6:2 A4:8:4 C5:12:4',
  'A4:0:4 C5:4:2 D5:6:2 F5:8:4 D5:12:4',
];
const KALIMBA_B = [
  'D5:0:2 F5:2:1 G5:3:1 A5:4:4 G5:10:2 F5:12:2 D5:14:2',
  'E5:0:2 G5:2:4 E5:6:2 D5:8:6 C5:14:2',
  'A5:0:3 G5:3:3 E5:6:2 C5:8:4 D5:12:2 E5:14:2',
  'F5:0:4 E5:4:2 D5:6:10',
  'D5:0:2 F5:2:1 G5:3:1 A5:4:4 C6:10:2 D6:12:4',
  'Bb5:0:4 A5:4:2 G5:6:2 E5:8:8',
  'C6:0:3 A5:3:3 G5:6:2 E5:8:4 D5:12:2 C5:14:2',
  'D5:0:4 F#5:4:2 A5:6:2 C6:8:4 A5:12:4',
];
const FLUTE = [
  'F5:0:6 A5:6:6 C6:12:4',
  'Bb5:0:4 A5:4:4 G5:8:4 E5:12:4',
  'F5:0:8 E5:8:8',
  'D5:0:12',
  'D5:0:4 F5:4:4 A5:8:8',
  'G5:0:6 E5:6:2 C5:8:8',
  'Bb4:0:4 D5:4:4 F5:8:4 G5:12:4',
  'F5:0:8 E5:8:8',
];

const MD = {
  k1: 'X......x..x.....', k2: 'X.........x....o', s1: '....X.......X...', s2: '....X.......X..g',
  h1: 'x.xgx.x.x.xgx.x.', h2: 'x.x.x.xgx.x.x.xg', rim: '..........o.....',
};
const keysComp = (ch, b, ch2) => {
  if (ch2) return [{ i: 'keys', s: 0, n: ch.v, d: 8, v: 0.68 }, { i: 'keys', s: 8, n: ch2.v, d: 8, v: 0.62 }];
  return b % 2 === 0 ? [{ i: 'keys', s: 0, n: ch.v, d: 15, v: 0.7 }] : [{ i: 'keys', s: 0, n: ch.v, d: 9, v: 0.68 }, { i: 'keys', s: 10, n: ch.v, d: 6, v: 0.5 }];
};
function menuDrums(b, bars, opts = {}) {
  const ev = [...hits('kick', b % 2 ? MD.k2 : MD.k1), ...hits('snare', b % 4 === 3 ? MD.s2 : MD.s1), ...hits('hat', b % 2 ? MD.h2 : MD.h1)];
  if (opts.rim) ev.push(...hits('rim', MD.rim));
  if (b === bars - 1) ev.push({ i: 'snare', s: 14, v: 0.3 }, { i: 'snare', s: 15, v: 0.45 });
  return ev;
}
const menuBass = (ch, ch2, next, b) => (ch2 ? bassLine('split', ch, next) : bassLine(b % 2 ? 'lofi2' : 'lofi', ch, next));

const MENU_DEF = {
  name: 'menu', title: 'Yard Lights', bpm: 86, swing: 0.22, gain: 1,
  echo: { beats: 0.75, fb: 0.35, cut: 2200 },
  instruments: {
    kick:    { type: 'kick', layer: 0, cfg: { level: 0.72, f0: 120, f1: 44, pitchT: 0.06, decay: 0.45, click: 0.12 } },
    snare:   { type: 'snare', layer: 0, cfg: { level: 0.34, tone: 175, hp: 900, lp: 5200, decay: 0.24, rev: 0.22, late: 0.012 } },
    hat:     { type: 'hat', layer: 0, cfg: { level: 0.09, decay: 0.05, hp: 6200, lp: 9000 } },
    rim:     { type: 'rim', layer: 0, cfg: { level: 0.12, rev: 0.25 } },
    bass:    { type: 'mono', layer: 0, cfg: { level: 0.28, wave: 'organ', sub: 0.4, cut: 520, env: 300, q: 0.8, fdecay: 0.2, atk: 0.012, dec: 0.4, sus: 0.8, rel: 0.12, gate: 0.92 } },
    keys:    { type: 'keys', layer: 0, cfg: { level: 0.25, cut: 2300, rev: 0.28 } },
    kalimba: { type: 'kalimba', layer: 0, cfg: { level: 0.64, echo: 0.3, rev: 0.3, pan: 0.15 } },
    flute:   { type: 'mono', layer: 0, cfg: { level: 0.29, wave: 'triangle', wave2: 'sine', mix2: 0.25, detune2: 1200, cut: 2600, env: 900, q: 0.7, fdecay: 0.2, atk: 0.07, dec: 0.4, sus: 0.85, rel: 0.16, glide: 0.06, vib: 16, vibRate: 5, vibDelay: 0.25, gate: 0.95, breath: 0.05, echo: 0.18, rev: 0.35, pan: -0.15 } },
    crackle: { type: 'crackle', layer: 0, cfg: { level: 0.4 } },
  },
  chords: MENU_CHORDS,
  sections: {
    A0: {
      chords: 'Gm9 C13 Fmaj9 Dm9 Gm9 C13 Am7 D7#9',
      build: ({ b, bars, ch, ch2, next }) => [
        ...keysComp(ch, b, ch2),
        ...(b >= 1 ? menuBass(ch, ch2, next, b) : []),
        ...(b >= 1 ? menuDrums(b, bars) : b === 0 ? [{ i: 'snare', s: 14, v: 0.25 }, { i: 'snare', s: 15, v: 0.4 }] : []),
      ],
    },
    A1: {
      chords: 'Gm9 C13 Fmaj9 Dm9 Gm9 C13 Am7 D7#9',
      build: ({ b, bars, ch, ch2, next }) => [...keysComp(ch, b, ch2), ...menuBass(ch, ch2, next, b), ...menuDrums(b, bars), ...mels('kalimba', KALIMBA_A[b], 0.85)],
    },
    B1: {
      chords: 'Bbmaj9 A7b9 Dm9 Dm9/C Bbmaj7 Am7 Gm7 C7sus4|C7',
      build: ({ b, bars, ch, ch2, next }) => [...keysComp(ch, b, ch2), ...menuBass(ch, ch2, next, b), ...menuDrums(b, bars, { rim: true }), ...mels('flute', FLUTE[b], 0.85)],
    },
    A2: {
      chords: 'Gm9 C13 Fmaj9 Dm9 Gm9 C13 Am7 D7#9',
      build: ({ b, bars, ch, ch2, next }) => [...keysComp(ch, b, ch2), ...menuBass(ch, ch2, next, b), ...menuDrums(b, bars, { rim: true }), ...mels('kalimba', KALIMBA_B[b], 0.85)],
    },
    B2: {
      chords: 'Bbmaj9 A7b9 Dm9 Dm9/C Bbmaj7 Am7 Gm7 C7sus4|C7',
      build: ({ b, bars, ch, ch2, next }) => [
        ...keysComp(ch, b, ch2),
        ...menuBass(ch, ch2, next, b),
        ...(b === 4 || b === 5 ? hits('hat', MD.h1) : menuDrums(b, bars)),
      ],
    },
  },
  arrangement: ['A0', 'A1', 'B1', 'A2', 'B2'],
  loopFrom: 1,
};

export const SONGS = { run: compile(RUN_DEF), menu: compile(MENU_DEF) };
export const SONG_DEFS = { run: RUN_DEF, menu: MENU_DEF };
