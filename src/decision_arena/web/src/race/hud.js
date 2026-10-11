// The race overlay (plain DOM over the canvas): a name tag above each runner, the standings, the countdown,
// the start button, the winner, and the decision panel (D shows or hides it): per model runner its last move,
// the probability it gave each move, its latency and its decisions per second, and its record over the races since the
// page loaded (finishes, and coins a minute on the track), the cards ordered by that record. Tags follow the curved-world bend so they stay on their runners.
import * as THREE from 'three';
import { EV } from '../core/events.js';
import { FONT_CSS } from '../ui/fonts.js';

const CSS = `
${FONT_CSS}
#hud { position: fixed; inset: 0; pointer-events: none; font-family: 'Nunito', system-ui, sans-serif; color: #fff;
  -webkit-font-smoothing: antialiased; }
#hud .brand { position: absolute; left: 18px; top: 14px; font-family: 'Luckiest Guy', system-ui; letter-spacing: .06em;
  font-size: 18px; text-shadow: 0 2px 0 rgba(0,0,0,.35); opacity: .9; }
#hud .board { position: absolute; left: 14px; top: 44px; min-width: 230px; background: rgba(12, 10, 32, .62);
  border-radius: 14px; padding: 8px 10px; backdrop-filter: blur(6px); box-shadow: 0 6px 24px rgba(0,0,0,.25); }
#hud .row { display: grid; grid-template-columns: 22px 14px 1fr auto; align-items: center; gap: 8px; padding: 4px 2px;
  font-weight: 800; font-size: 15px; height: 30px; box-sizing: border-box; transition: transform .25s ease, opacity .25s ease; }
#hud .row .pos { font-family: 'Luckiest Guy', system-ui; font-size: 17px; text-align: center; opacity: .85; }
#hud .row .dot { width: 12px; height: 12px; border-radius: 50%; box-shadow: 0 0 10px currentColor; background: currentColor; }
#hud .row .gap { font-variant-numeric: tabular-nums; font-size: 13px; opacity: .8; font-weight: 700; }
#hud .row.out { opacity: .45; }
#hud .row.out .name { text-decoration: line-through; }
#hud .tag { position: absolute; transform: translate(-50%, -100%); white-space: nowrap; font-weight: 900; font-size: 14px;
  padding: 3px 10px 3px 8px; border-radius: 999px; background: rgba(12, 10, 32, .7); display: flex; gap: 6px;
  align-items: center; border: 2px solid currentColor; will-change: transform, left, top; }
#hud .tag b { font-family: 'Luckiest Guy', system-ui; font-weight: 400; font-size: 14px; }
#hud .tag span { color: #fff; }
#hud .center { position: absolute; inset: 0; display: flex; flex-direction: column; align-items: center;
  justify-content: center; gap: 14px; text-align: center; }
#hud .big { font-family: 'Luckiest Guy', system-ui; font-size: clamp(48px, 11vw, 140px); line-height: 1;
  text-shadow: 0 6px 0 rgba(0,0,0,.3), 0 0 40px rgba(255,255,255,.25); transform: scale(.6); opacity: 0;
  transition: transform .35s cubic-bezier(.2,1.6,.4,1), opacity .2s; }
#hud .big.show { transform: scale(1); opacity: 1; }
#hud .sub { position: absolute; bottom: calc(9vh + 70px); left: 0; right: 0; font-weight: 800; font-size: 18px; opacity: 0; transition: opacity .3s; text-shadow: 0 2px 6px rgba(0,0,0,.5); }
#hud .sub.show { opacity: .95; }
#hud button { position: absolute; bottom: 9vh; left: 50%; transform: translateX(-50%); pointer-events: auto; font-family: 'Luckiest Guy', system-ui; font-size: 22px; letter-spacing: .04em;
  color: #fff; background: linear-gradient(#ff5fa2, #e8337d); border: 0; border-radius: 16px; padding: 12px 28px;
  box-shadow: 0 6px 0 #a3185a, 0 10px 24px rgba(0,0,0,.3); cursor: pointer; }
#hud button:active { transform: translate(-50%, 3px); box-shadow: 0 3px 0 #a3185a; }
#hud .panel { position: absolute; right: 14px; top: 14px; display: flex; flex-direction: column; gap: 8px; width: 248px; }
#hud .panel[hidden] { display: none; }
#hud .card { background: rgba(12, 10, 32, .66); border-radius: 14px; padding: 8px 10px 9px; backdrop-filter: blur(6px);
  box-shadow: 0 6px 24px rgba(0,0,0,.25); border-left: 4px solid currentColor; }
#hud .card.out { opacity: .45; }
#hud .card .head { display: flex; align-items: center; gap: 8px; font-weight: 900; font-size: 15px; color: #fff; }
#hud .card .head .move { margin-left: auto; font-family: 'Luckiest Guy', system-ui; font-weight: 400; font-size: 16px;
  letter-spacing: .04em; color: currentColor; }
#hud .card .bar { display: grid; grid-template-columns: 40px 1fr 34px; align-items: center; gap: 6px; font-size: 11px;
  font-weight: 800; height: 15px; color: rgba(255,255,255,.75); }
#hud .card .bar i { display: block; height: 7px; border-radius: 4px; background: rgba(255,255,255,.14); overflow: hidden; }
#hud .card .bar i b { display: block; height: 100%; width: 0; background: currentColor; border-radius: 4px; transition: width .12s; }
#hud .card .bar.on { color: #fff; }
#hud .card .bar span:last-child { text-align: right; font-variant-numeric: tabular-nums; }
#hud .card .stats { display: flex; justify-content: space-between; margin-top: 4px; font-size: 12px; font-weight: 800;
  font-variant-numeric: tabular-nums; color: rgba(255,255,255,.85); }
#hud .card .record { margin-top: 3px; font-size: 10px; font-weight: 800; font-variant-numeric: tabular-nums;
  color: rgba(255,255,255,.7); white-space: nowrap; display: flex; flex-wrap: wrap; justify-content: space-between; column-gap: 6px; }
#hud .card .record[hidden] { display: none; }
#hud .card .err { font-size: 11px; color: #ff9c9c; margin-top: 3px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
`;
const MOVES = ['left', 'right', 'jump', 'roll', 'keep'];
const MOVE_LABEL = { left: 'left', right: 'right', jump: 'jump', roll: 'roll', keep: 'keep going' };

const ORDINAL = ['1st', '2nd', '3rd', '4th', '5th', '6th'];

export class Hud {
  constructor(ctx, race, { onStart }) {
    this.ctx = ctx;
    this.race = race;
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `<div class="brand">DECISION ARENA</div><div class="board"></div><div class="tags"></div>
      <div class="center"><div class="big"></div><div class="sub"></div><button hidden>Start race</button></div>
      <div class="panel"></div>`;
    document.body.appendChild(this.root);
    this.board = this.root.querySelector('.board');
    this.tagsEl = this.root.querySelector('.tags');
    this.big = this.root.querySelector('.big');
    this.sub = this.root.querySelector('.sub');
    this.button = this.root.querySelector('button');
    this.button.onclick = () => onStart();
    this.panel = this.root.querySelector('.panel');
    this.cards = new Map();
    this.records = new Map();   // model name -> its record since the page loaded
    this.rows = new Map();
    this.tags = new Map();
    this._v = new THREE.Vector3();
    this._bigUntil = 0;
    ctx.events.on(EV.COUNTDOWN, ({ n }) => this._flash(n > 0 ? String(n) : 'GO!', '#fff', 0.7));
    ctx.events.on(EV.STATE, ({ state }) => this._onState(state));
  }

  build() {
    this.board.replaceChildren();
    this.tagsEl.replaceChildren();
    this.rows.clear();
    this.tags.clear();
    for (const r of this.race.runners) {
      const row = document.createElement('div');
      row.className = 'row';
      row.innerHTML = '<span class="pos"></span><span class="dot"></span><span class="name"></span><span class="gap"></span>';
      row.querySelector('.dot').style.color = r.color;
      row.querySelector('.name').textContent = r.name;
      this.board.appendChild(row);
      this.rows.set(r, row);
      const tag = document.createElement('div');
      tag.className = 'tag';
      tag.style.color = r.color;
      tag.innerHTML = '<b></b><span></span>';
      tag.querySelector('span').textContent = r.name;
      this.tagsEl.appendChild(tag);
      this.tags.set(r, tag);
    }
    this._buildPanel();
  }

  /** A card per model runner; no panel at all when every runner is a bot. */
  _buildPanel() {
    this.panel.replaceChildren();
    this.cards.clear();
    for (const r of this.race.runners) {
      if (!r.controller?.shown) continue;
      const card = document.createElement('div');
      card.className = 'card';
      card.style.color = r.color;
      card.innerHTML = `<div class="head"><span class="name"></span><span class="move"></span></div>
        ${MOVES.map((m) => `<div class="bar" data-m="${m}"><span>${m}</span><i><b></b></i><span></span></div>`).join('')}
        <div class="stats"><span class="ms"></span><span class="rate"></span></div><div class="record" hidden><span></span><span></span></div><div class="err"></div>`;
      card.querySelector('.name').textContent = r.name;
      this.panel.appendChild(card);
      this.cards.set(r, card);
    }
    this.panel.hidden = !this.cards.size;
  }

  /** At each finish: add every model's result to its record, and order the cards by record. A race ends when one
   *  runner is left, so coins count per minute on the track, not in total. */
  _record() {
    for (const r of this.cards.keys()) {
      const rec = this.records.get(r.name) || { races: 0, places: [], coins: 0, time: 0 };
      rec.races++;
      rec.places[r.place - 1] = (rec.places[r.place - 1] || 0) + 1;
      rec.coins += r.coins;
      rec.time += r.status === 'caught' ? r.outAt : this.race.t;   // on the track until out, crashes included
      this.records.set(r.name, rec);
    }
    const n = this.race.runners.length;
    const rate = (rec) => (rec.time > 0 ? (rec.coins * 60) / rec.time : 0);
    // most wins first, then most seconds, and so on, then coins a minute
    const key = (r) => { const rec = this.records.get(r.name); return [...Array.from({ length: n }, (_, i) => rec.places[i] || 0), rate(rec)]; };
    const order = [...this.cards.keys()].sort((a, b) => {
      const ka = key(a), kb = key(b);
      for (let i = 0; i < ka.length; i++) if (ka[i] !== kb[i]) return kb[i] - ka[i];
      return 0;
    });
    for (const r of order) {
      const rec = this.records.get(r.name), card = this.cards.get(r);
      const p = (i) => rec.places[i] || 0;
      const record = card.querySelector('.record');
      record.hidden = false;
      record.firstElementChild.textContent = `${rec.races} race${rec.races > 1 ? 's' : ''} · 1st ${p(0)} · 2nd ${p(1)} · 3rd ${p(2)}`;
      record.lastElementChild.textContent = `${Math.round(rate(rec))} coins/min`;   // its own line when the counts get long
      this.panel.appendChild(card);
    }
  }

  togglePanel() { if (this.cards.size) this.panel.hidden = !this.panel.hidden; }

  _updatePanel() {
    if (this.panel.hidden) return;
    for (const [r, card] of this.cards) {
      const s = r.controller.shown;
      card.classList.toggle('out', r.status === 'caught');
      card.querySelector('.move').textContent = s.move ? MOVE_LABEL[s.move] : '…';
      for (const bar of card.querySelectorAll('.bar')) {
        const p = s.probabilities?.[bar.dataset.m] ?? 0;
        bar.classList.toggle('on', bar.dataset.m === s.move);
        bar.querySelector('b').style.width = `${Math.round(p * 100)}%`;
        bar.lastElementChild.textContent = s.probabilities ? `${Math.round(p * 100)}%` : '';
      }
      card.querySelector('.ms').textContent = s.ms != null ? `${s.ms} ms` : '';
      card.querySelector('.rate').textContent = `${s.rate.toFixed(1)} decisions/s`;
      card.querySelector('.err').textContent = s.error || '';
    }
  }

  _onState(state) {
    if (state === 'menu') {
      this._show('', '');
      this.sub.textContent = this.race.runners.map((r) => r.name).join('  ·  ');
      this.sub.classList.add('show');
      this.button.textContent = 'Start race';
      this.button.hidden = false;
    } else if (state === 'intro') {
      this.button.hidden = true;
      this.sub.classList.remove('show');
    } else if (state === 'gameover') {
      this._record();
      const w = this.race.winner;
      this._show(w ? `${w.name} wins!` : 'Everyone is out', w ? w.color : '#fff');
      this.sub.textContent = `${this.race.t.toFixed(1)} s`;
      this.sub.classList.add('show');
      this.button.textContent = 'Race again';
      this.button.hidden = false;
    }
  }

  _show(text, color) {
    this.big.textContent = text;
    this.big.style.color = color || '#fff';
    this.big.classList.toggle('show', !!text);
    this._bigUntil = Infinity;
  }

  _flash(text, color, seconds) {
    this._show(text, color);
    this._bigUntil = this.ctx.realTime + seconds;
  }

  update() {
    if (this.ctx.realTime > this._bigUntil) { this.big.classList.remove('show'); this._bigUntil = 0; }
    const race = this.race, lead = race.order[0];
    const rowH = 30;
    for (const r of race.runners) {
      const row = this.rows.get(r);
      if (!row) continue;
      row.style.transform = `translateY(${(r.place - 1 - race.runners.indexOf(r)) * rowH}px)`;
      row.querySelector('.pos').textContent = r.place;
      const out = r.status === 'caught';
      row.classList.toggle('out', out);
      row.querySelector('.gap').textContent = out ? 'caught' : r.status === 'down' ? 'crashed!'
        : r === lead || !lead ? (r.status === 'won' ? 'winner' : 'leader')
        : `-${Math.max(0, r.b.z - lead.b.z).toFixed(1)} m`;
      this._placeTag(r);
    }
    this._updatePanel();
  }

  /** Screen position of a point above the runner, bent like the world shader bends it. */
  _placeTag(r) {
    const tag = this.tags.get(r);
    const cam = this.ctx.camera, v = this._v, c = this.ctx.curve.value, b = r.b;
    v.set(b.x, b.y + 2.25, b.z).applyMatrix4(cam.matrixWorldInverse);
    const depth = -v.z;
    if (depth < 0.5) { tag.style.display = 'none'; return; }
    const d = Math.max(0, depth - c.z);
    v.x += c.x * d * d; v.y -= c.y * d * d;
    v.applyMatrix4(cam.projectionMatrix);
    if (Math.abs(v.x) > 1.2 || Math.abs(v.y) > 1.2) { tag.style.display = 'none'; return; }
    tag.style.display = '';
    tag.style.left = `${(v.x * 0.5 + 0.5) * innerWidth}px`;
    tag.style.top = `${(-v.y * 0.5 + 0.5) * innerHeight}px`;
    if (r.fall && r.fall.t > 0.4) { tag.style.display = 'none'; return; }   // gone down with the ground
    tag.style.opacity = r.status === 'caught' ? '0.45' : '1';
    tag.querySelector('b').textContent = ORDINAL[r.place - 1] || '';
  }
}
