// Race broadcast: the lineup, standings, track danger and final classification.
// UI reads race state; it never changes the simulation clock or the race rules.
import * as THREE from 'three';
import { EV } from '../core/events.js';
import { FONT_CSS } from '../ui/fonts.js';

const SHOTS = { lead: 'Leaders', pack: 'Whole pack', low: 'Trackside', front: 'Head on', danger: 'Collapse watch', winner: 'Winner' };
const clock = (t) => `${Math.floor(t / 60).toString().padStart(2, '0')}:${Math.floor(t % 60).toString().padStart(2, '0')}`;
const setText = (el, value) => { const s = String(value); if (el.textContent !== s) el.textContent = s; };

export class Hud {
  constructor(ctx, race, { onStart }) {
    this.ctx = ctx;
    this.race = race;
    const style = document.createElement('style');
    style.textContent = FONT_CSS;
    document.head.appendChild(style);
    this.root = document.createElement('div');
    this.root.id = 'hud';
    this.root.innerHTML = `
      <div class="shade" aria-hidden="true"></div>
      <header class="topbar">
        <div class="brand"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 21 9 3h4L7 21H3Zm8 0 6-18h4l-6 18h-4Z" fill="currentColor"/></svg>DECISION ARENA</div>
        <div class="session"><i></i><span class="local">LOCAL RACE / </span>BOT EXHIBITION</div>
      </header>
      <section class="lobby" aria-label="Race lineup">
        <div class="intro-copy"><div class="eyebrow">Think fast. Keep your ground.</div>
          <h1>Decision<span>Arena</span></h1>
          <p>One track. No second chances at the edge.<br>Watch the fastest decisions pull ahead.</p>
          <button class="primary start">Start race <b aria-hidden="true">↗</b></button><span class="start-hint">or press Space</span>
        </div>
        <div class="roster-wrap"><div class="roster-title"><span class="eyebrow">On the starting grid</span><span class="eyebrow">Bots / reaction delay</span></div><div class="roster"></div></div>
      </section>
      <div class="race-ui" hidden>
        <section class="board" aria-label="Live standings"><div class="board-head"><span class="eyebrow">Race order</span><span class="round"></span></div><div class="rows"></div></section>
        <div class="shot-label"></div>
        <div class="telemetry"><div class="metric"><span class="eyebrow">Race time</span><strong class="race-time">00:00</strong></div><div class="metric"><span class="eyebrow">In the race</span><strong class="alive-count"></strong></div></div>
        <div class="edge-watch"><div class="edge-head"><span class="eyebrow">Track collapse</span><strong></strong></div><div class="edge-track"><i></i></div><div class="edge-note"><span></span><span>ground remaining</span></div></div>
      </div>
      <div class="tags" aria-hidden="true"></div>
      <div class="callout" role="status" aria-atomic="true"><div class="eyebrow"></div><strong></strong><small></small></div>
      <div class="countdown" hidden aria-live="polite"><span class="eyebrow">Get ready</span><strong></strong></div>
      <section class="results" hidden aria-label="Race results">
        <div class="champion"><div class="eyebrow">Arena winner</div><h2></h2><p></p><img class="champion-art" alt="">
          <div class="champion-facts"><div><strong class="finish-time"></strong><span class="eyebrow">Race duration</span></div><div><strong class="finish-coins"></strong><span class="eyebrow">Coins collected</span></div></div>
          <button class="primary again">Race again <b aria-hidden="true">↗</b></button></div>
        <div class="classification"><div class="eyebrow">Official result</div><h2>Race classification</h2>
          <div class="result-head"><span>#</span><span>Runner</span><span>Time</span><span>Coins</span><span>Crashes</span></div><div class="result-rows"></div>
          <div class="result-foot">Time is how long each runner stayed in the race.<br>Starting positions rotate every race.</div></div>
      </section>
      <footer class="toolbar"><div class="controls"><button class="control camera" title="Switch camera (C)"><kbd>C</kbd><span></span></button><button class="control sound" title="Mute sound (M)" aria-pressed="false"><kbd>M</kbd><span>Sound on</span></button></div><span class="engine">Last runner standing / Rail Dash engine</span></footer>`;
    document.body.appendChild(this.root);
    const $ = (s) => this.root.querySelector(s);
    this.lobby = $('.lobby'); this.roster = $('.roster'); this.raceUI = $('.race-ui');
    this.board = $('.rows'); this.tagsEl = $('.tags'); this.results = $('.results');
    this.callout = $('.callout'); this.countdown = $('.countdown'); this.shade = $('.shade');
    this.time = $('.race-time'); this.alive = $('.alive-count'); this.round = $('.round'); this.shot = $('.shot-label');
    this.edge = $('.edge-watch'); this.edgeValue = $('.edge-head strong'); this.edgeBar = $('.edge-track i'); this.edgeName = $('.edge-note span');
    this.cameraButton = $('.camera'); this.soundButton = $('.sound');
    for (const button of this.root.querySelectorAll('.primary')) button.onclick = () => { button.blur(); onStart(); };
    this.cameraButton.onclick = (e) => { this.toggleCamera(); if (e.detail > 0) this.cameraButton.blur(); };
    this.soundButton.onclick = (e) => { this.toggleSound(); if (e.detail > 0) this.soundButton.blur(); };
    this.rows = new Map(); this.tags = new Map(); this.portraits = new Map();
    this._v = new THREE.Vector3(); this._placed = [];
    this._calloutUntil = 0; this._calloutPriority = 0; this._countUntil = 0; this._resultsAt = Infinity;
    this._nextBoard = 0; this.muted = false;
    this._incidents = { crash: [], out: [] };
    ctx.events.on(EV.COUNTDOWN, ({ n }) => this._count(n));
    ctx.events.on(EV.STATE, ({ state }) => this._onState(state));
    ctx.events.on(EV.CRASH, ({ runner }) => {
      const r = race.runners[runner];
      if (r) this._incidents.crash.push(r);
    });
    ctx.events.on(EV.CAUGHT, ({ runner }) => {
      const r = race.runners[runner];
      if (r) this._incidents.out.push(r);
    });
    ctx.events.on(EV.POWERUP_START, ({ runner, type }) => {
      const r = race.runners[runner];
      if (r && type === 'multiplier') this._announce('Speed boost', r.name, 'Making up ground', r.color, 1);
    });
  }

  build() {
    this.board.replaceChildren(); this.tagsEl.replaceChildren(); this.roster.replaceChildren();
    this.rows.clear(); this.tags.clear(); this.portraits.clear();
    this.roster.style.setProperty('--count', this.race.runners.length);
    this.board.style.height = `calc(${this.race.runners.length} * var(--row-height))`;
    for (const r of this.race.runners) {
      const portrait = this.ctx.characters.renderPortrait('character', r.character, null, 192);
      this.portraits.set(r, portrait);
      const card = document.createElement('div');
      card.className = 'entrant'; card.style.setProperty('--runner', r.color);
      card.innerHTML = '<img alt=""><span class="seat"></span><strong></strong><small></small>';
      card.querySelector('img').src = portrait; card.querySelector('img').hidden = !portrait;
      card.querySelector('.seat').textContent = String(r.index + 1).padStart(2, '0');
      card.querySelector('strong').textContent = r.name;
      const delay = r.controller?.lag;
      card.querySelector('small').textContent = delay === 0 ? 'No added delay' : delay > 0 ? `${Math.round(delay * 1000)} ms delay` : 'Runner';
      this.roster.appendChild(card);
      const row = document.createElement('div');
      row.className = 'row'; row.style.setProperty('--runner', r.color);
      row.innerHTML = '<span class="pos"></span><span class="stripe"></span><span class="identity"><span class="name"></span><span class="pace"><i></i></span></span><span class="gap"></span>';
      row.querySelector('.name').textContent = r.name;
      this.board.appendChild(row);
      this.rows.set(r, { el: row, pos: row.querySelector('.pos'), gap: row.querySelector('.gap'), pace: row.querySelector('.pace i') });
      const tag = document.createElement('div');
      tag.className = 'tag'; tag.style.setProperty('--runner', r.color);
      tag.innerHTML = '<b></b><span></span><small class="tag-status"></small>';
      tag.querySelector('span').textContent = r.name;
      this.tagsEl.appendChild(tag);
      this.tags.set(r, { el: tag, pos: tag.querySelector('b'), status: tag.querySelector('small') });
    }
  }

  toggleCamera() { this.race.camera.toggleView(); this._controls(); }
  toggleSound() {
    this.muted = !this.muted;
    this.ctx.audio.unlock?.();
    this.ctx.events.emit(EV.SETTINGS, { settings: { music: this.muted ? 0 : 0.6, sfx: this.muted ? 0 : 0.85 } });
    this._controls();
  }
  _controls() {
    setText(this.cameraButton.querySelector('span'), this.race.camera.view === 'director' ? 'Director camera' : 'Chase camera');
    setText(this.soundButton.querySelector('span'), this.muted ? 'Sound off' : 'Sound on');
    this.soundButton.setAttribute('aria-pressed', String(this.muted));
    this.soundButton.title = this.muted ? 'Unmute sound (M)' : 'Mute sound (M)';
  }

  _onState(state) {
    this.root.dataset.state = state;
    this.lobby.hidden = state !== 'menu'; this.results.hidden = true;
    this.root.dataset.results = 'false';
    this.raceUI.hidden = state !== 'running' && state !== 'intro';
    this.tagsEl.hidden = state === 'menu';
    this.shade.classList.toggle('finish-shade', state === 'gameover');
    this._nextBoard = 0;
    if (state === 'menu' || state === 'intro') {
      this._resultsAt = Infinity;
      this.callout.classList.remove('show'); this._calloutUntil = 0;
      this.countdown.hidden = true; this._countUntil = 0;
      this._leader = null; this._candidate = null; this._candidateAt = 0; this._finalTwo = false;
      this._incidents.crash.length = this._incidents.out.length = 0;
    } else if (state === 'gameover') {
      this.countdown.hidden = true;
      this._resultsAt = this.ctx.realTime + 1.6;
      const w = this.race.winner;
      this._announce('Race finished', w ? `${w.name} wins` : 'All runners out', `${this.race.t.toFixed(1)} seconds`, w?.color || '#d5ff5f', 5);
      this._buildResults();
    }
    this._controls();
  }

  _count(n) {
    this.countdown.hidden = false;
    this.countdown.querySelector('.eyebrow').textContent = n > 0 ? 'Get ready' : 'Keep your ground';
    // Replacing the numeral restarts its entrance animation without forcing a layout read.
    const numeral = document.createElement('strong');
    numeral.textContent = n > 0 ? String(n) : 'GO';
    this.countdown.querySelector('strong').replaceWith(numeral);
    this._countUntil = n > 0 ? Infinity : this.ctx.realTime + 0.65;
  }

  _announce(label, title, detail, color, priority) {
    const now = this.ctx.realTime;
    if (now < this._calloutUntil && priority < this._calloutPriority) return false;
    setText(this.callout.querySelector('.eyebrow'), label);
    setText(this.callout.querySelector('strong'), title);
    setText(this.callout.querySelector('small'), detail);
    this.callout.style.setProperty('--callout', color);
    this.callout.classList.add('show');
    this._calloutUntil = now + 2.2; this._calloutPriority = priority;
    return true;
  }

  _buildResults() {
    const race = this.race, w = race.winner, $ = (s) => this.results.querySelector(s);
    this.results.style.setProperty('--winner', w?.color || '#d5ff5f');
    $('.champion .eyebrow').textContent = w ? 'Arena winner' : 'Race finished';
    $('.champion h2').textContent = w?.name || 'All out';
    $('.champion p').textContent = w?.status === 'won' ? 'Last runner standing.' : 'The collapse took the whole field.';
    const img = $('.champion-art');
    const portrait = this.portraits.get(w);
    img.hidden = !portrait; if (portrait) img.src = portrait;
    $('.finish-time').textContent = `${race.t.toFixed(1)} s`;
    $('.finish-coins').textContent = w ? String(w.coins) : '—';
    const rows = $('.result-rows'); rows.replaceChildren();
    for (const r of race.order) {
      const row = document.createElement('div');
      row.className = `result-row${r === w ? ' first' : ''}`;
      row.style.setProperty('--runner', r.color);
      row.innerHTML = '<span class="pos"></span><span class="result-name"></span><span></span><span></span><span></span>';
      [r.place, r.name, `${(r.status === 'caught' ? r.outAt : race.t).toFixed(1)} s`, r.coins, r.stats.crashes]
        .forEach((value, i) => { row.children[i].textContent = value; });
      rows.appendChild(row);
    }
  }

  update() {
    const now = this.ctx.realTime, race = this.race;
    // Collapse can take several runners in the same frame. Announce them together, after all events arrive.
    const out = this._incidents.out, crash = this._incidents.crash, group = out.length ? out : crash;
    if (group.length) {
      this._announce(out.length ? 'Eliminated' : 'Crash', group.map((r) => r.name).join(' + '),
        out.length ? 'Taken by the collapse' : 'Back up soon. The ground keeps moving.',
        out.length && group.length === 1 ? group[0].color : '#ffad82', out.length ? 4 : 2);
      out.length = crash.length = 0;
    }
    if (now > this._calloutUntil) this.callout.classList.remove('show');
    if (now > this._countUntil) this.countdown.hidden = true;
    if (race.state === 'gameover' && now >= this._resultsAt) {
      this.results.hidden = false; this.tagsEl.hidden = true;
      this.root.dataset.results = 'true'; this.callout.classList.remove('show'); this._resultsAt = Infinity;
    }
    if (now >= this._nextBoard) { this._updateBoard(); this._nextBoard = now + 0.1; }
    if (!this.tagsEl.hidden) {
      // The renderer otherwise updates this after the HUD, leaving tags a frame behind each camera cut.
      this.ctx.camera.updateMatrixWorld();
      this._placed.length = 0;
      for (const r of race.order) this._placeTag(r);
    }
  }

  _updateBoard() {
    const race = this.race, lead = race.order[0], active = race.order.filter((r) => r.alive);
    setText(this.time, clock(race.t));
    setText(this.alive, `${race.state === 'intro' ? race.runners.length : active.length}/${race.runners.length}`);
    setText(this.round, `RACE ${String(race.races + 1).padStart(2, '0')}`);
    setText(this.shot, race.camera.view === 'chase' ? 'Camera / whole pack' : `Director / ${SHOTS[race.camera.shot] || 'Starting grid'}`);
    for (const r of race.runners) {
      const row = this.rows.get(r); if (!row) continue;
      row.el.style.transform = `translateY(calc(${r.place - 1} * var(--row-height)))`;
      setText(row.pos, r.place);
      row.el.classList.toggle('out', r.status === 'caught');
      row.el.classList.toggle('down', r.status === 'down');
      row.el.classList.toggle('leader', r === lead);
      const gap = r.status === 'caught' ? 'OUT' : r.status === 'down' ? 'CRASH' : r.timers.boost > 0 ? 'BOOST' :
        r === lead ? 'LEAD' : `−${Math.max(0, r.b.z - lead.b.z).toFixed(1)} m`;
      setText(row.gap, gap);
      row.pace.style.transform = `scaleX(${Math.min(1, Math.max(0, r.speed / Math.max(1, race.base * 1.32)))})`;
      row.el.title = `${r.name}: ${gap}. Speed ${r.speed.toFixed(1)} metres per second.`;
      const tag = this.tags.get(r);
      setText(tag.pos, String(r.place).padStart(2, '0'));
      setText(tag.status, r.status === 'down' ? 'CRASH' : r.timers.boost > 0 ? 'BOOST' : '');
    }
    const rear = active[active.length - 1];
    this.edge.hidden = !rear || race.state !== 'running';
    if (rear) {
      const distance = Math.max(0, race.collapse.z - rear.b.z);
      setText(this.edgeValue, `${distance.toFixed(1)} m`);
      setText(this.edgeName, rear.name);
      this.edgeBar.style.transform = `scaleX(${Math.min(1, distance / 30)})`;
      this.edge.classList.toggle('danger', distance < 6);
    }
    if (race.state !== 'running') return;
    if (!this._leader) this._leader = lead;
    if (lead !== this._candidate) { this._candidate = lead; this._candidateAt = race.t; }
    if (lead !== this._leader && race.t > 2 && race.t - this._candidateAt > 0.6) {
      if (this._announce('New leader', lead.name, 'Moves to the front', lead.color, 1)) this._leader = lead;
    }
    if (active.length === 2 && race.runners.length > 2 && !this._finalTwo) {
      this._finalTwo = this._announce('Final two', 'Head to head', `${active[0].name} / ${active[1].name}`, '#d5ff5f', 3);
    }
  }

  /** Project with the world's curve and separate labels that would overlap on screen. */
  _placeTag(r) {
    const record = this.tags.get(r); if (!record) return;
    const tag = record.el, cam = this.ctx.camera, v = this._v, c = this.ctx.curve.value, b = r.b;
    if (r.fall && r.fall.t > 0.4) { tag.hidden = true; return; }
    v.set(b.x, b.y + 2.25, b.z).applyMatrix4(cam.matrixWorldInverse);
    const depth = -v.z;
    if (depth < 0.5) { tag.hidden = true; return; }
    const d = Math.max(0, depth - c.z);
    v.x += c.x * d * d; v.y -= c.y * d * d;
    v.applyMatrix4(cam.projectionMatrix);
    if (Math.abs(v.x) > 1 || Math.abs(v.y) > 1) { tag.hidden = true; return; }
    const x = (v.x * 0.5 + 0.5) * innerWidth;
    let y = (-v.y * 0.5 + 0.5) * innerHeight;
    for (let i = 0; i < this._placed.length; i++) {
      const p = this._placed[i];
      if (Math.abs(x - p.x) < 105 && Math.abs(y - p.y) < 28) { y = p.y - 29; i = -1; }
    }
    this._placed.push({ x, y });
    tag.hidden = y < 58;
    tag.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    tag.style.opacity = r.status === 'caught' ? '0.4' : '1';
  }
}
