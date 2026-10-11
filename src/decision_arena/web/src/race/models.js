// Runners driven by decision models. The models live behind the server (it holds their keys); the page asks
// through one WebSocket. Each model runner keeps one question in flight: it sends what it sees, applies the
// move the moment the answer arrives, and asks again straight away, so a fast model decides more often than a
// slow one and the race never waits for anyone (docs/decisions.md, 3 and 5).
import { TRAIN, PHYS } from '../config.js';
import { HW } from '../gameplay/physics.js';

const RANGE = 100;         // metres ahead a runner sees: over 3 s at top speed
const RETRY = 0.5;         // seconds before asking again after a failed answer
const RATE_WINDOW = 5;     // seconds over which decisions per second are counted
const ANSWERS = 5;         // a model's answer time is the mean of its last this many
const MOVE = { left: 'left', right: 'right', jump: 'up', roll: 'down', keep: null };
const LANE = { '-1': 'left', 0: 'middle', 1: 'right' };

/** The page's end of the socket, shared by every model runner. */
export class Gateway {
  constructor(url) {
    this.url = url;
    this.ws = null;
    this.open = false;
    this.waiting = new Map();   // seat -> its runner's controller
    this._connect();
  }

  _connect() {
    const ws = (this.ws = new WebSocket(this.url));
    ws.onopen = () => { this.open = true; };
    ws.onclose = () => {
      this.open = false;
      for (const c of this.waiting.values()) c.answered({ type: 'error', error: 'the server went away', seq: c.seq });
      setTimeout(() => this._connect(), 1000);
    };
    ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      this.waiting.get(m.seat)?.answered(m);
    };
  }

  ask(seat, seq, seen) {
    if (!this.open) return false;
    this.ws.send(JSON.stringify({ type: 'ask', seat, seq, seen }));
    return true;
  }
}

/** Drives one runner with a decision model, through the gateway. Same shape as a Bot (race/bots.js). */
export class ModelPlayer {
  constructor(runner, seat, gateway) {
    this.runner = runner;
    this.seat = seat;
    this.gateway = gateway;
    gateway.waiting.set(seat, this);
    this.out = [];
    this.reset();
  }

  reset() {
    this.seq = (this.seq || 0) + 1;   // answers to questions from an earlier race are dropped
    this.pending = false;
    this.wait = 0;
    this.t = 0;
    this.last = null;        // its last move
    this.moves = [];         // the moves to make this frame
    this.times = [];         // when each recent answer arrived, for decisions per second
    this.took = [];          // how long its recent answers took, in seconds
    // what the decision panel shows
    this.shown = { move: null, probabilities: null, ms: null, rate: 0, error: null, decisions: 0 };
  }

  think(dt) {
    this.t += dt;
    this.wait -= dt;
    const out = this.out;
    out.length = 0;
    for (const a of this.moves) out.push(a);
    this.moves.length = 0;
    const r = this.runner;
    // a move just answered is made this frame, so the next question waits a frame and shows it made
    if (!out.length && !this.pending && this.wait <= 0 && r.active && r.race.state === 'running') {
      if (this.gateway.ask(this.seat, ++this.seq, see(r, this))) this.pending = true;
    }
    while (this.times.length && this.times[0] < this.t - RATE_WINDOW) this.times.shift();
    this.shown.rate = this.times.length / Math.min(RATE_WINDOW, Math.max(this.t, 1));
    return out;
  }

  answered(m) {
    if (m.seq !== this.seq) return;   // an answer to a question from before a reset
    this.pending = false;
    const s = this.shown;
    s.ms = m.ms ?? null;
    if (m.ms != null) { this.took.push(m.ms / 1000); if (this.took.length > ANSWERS) this.took.shift(); }
    if (m.type !== 'move') { s.error = m.error || 'no answer'; this.wait = RETRY; return; }
    s.error = null;
    s.move = m.move;
    s.probabilities = m.probabilities;
    s.decisions++;
    this.times.push(this.t);
    this.last = m.move;
    this.runner.stats.decisions++;
    const a = MOVE[m.move];
    if (a) this.moves.push(a);
  }
}

/** What a runner sees, in the shape server's models.question() reads. Every runner gets the same fields; only
 *  its own position, and its own model's answer time, differ. */
export function see(r, player) {
  const b = r.b, race = r.race;
  const roof = b.grounded && b.y >= TRAIN.height - 0.3;
  const doing = [];
  if (b.laneT < 1) doing.push(`changing lanes from the ${LANE[b.fromLane]} to the ${LANE[b.lane]} lane`);
  if (r.player.flight) doing.push(r.player.flight.kind === 'jetpack' ? 'flying on a jetpack' : 'bouncing on a pogo stick');
  else if (!b.grounded) {
    // when it lands on what is under it now, under gravity alone
    const ground = r.ctx.level.supportHeight(b.x, b.z, HW, b.y);
    const t = (b.vy + Math.sqrt(Math.max(0, b.vy * b.vy + 2 * PHYS.gravity * (b.y - ground)))) / PHYS.gravity;
    doing.push(`in the air, landing in ${t.toFixed(2)} s`);
  } else if (roof) doing.push('running on a train roof');
  if (b.rollT > 0) doing.push(b.grounded ? `rolling, standing up in ${b.rollT.toFixed(2)} s` : 'dropping to roll as it lands');
  if (r.timers.sneakers > 0) doing.push(`wearing spring shoes (jumps clear trains) for ${r.timers.sneakers.toFixed(0)} s more`);
  if (r.player.invulnT > 0) doing.push(`protected for ${r.player.invulnT.toFixed(1)} s: obstacles don't knock you down`);
  if (!doing.length) doing.push('running');

  const lanes = [[], [], []];
  for (const c of r.ctx.level.getColliders(b.z - RANGE, b.z + 1, (see._cols ||= []))) {
    if (c.kind === 'runner' || c.lane < -1 || c.lane > 1) continue;
    if (c.maxZ < b.z - RANGE || c.minZ > b.z) continue;   // out of range, or already behind
    lanes[c.lane + 1].push({
      kind: c.kind, at: +(b.z - c.maxZ).toFixed(1), length: +(c.maxZ - c.minZ).toFixed(1),
      moving: c.vz > 0, speed: +Math.max(0, c.vz).toFixed(1),
    });
  }
  for (const l of lanes) l.sort((p, q) => p.at - q.at);

  // every other runner still in the race, nearest first
  const others = race.order
    .filter((o) => o !== r && o.alive)
    .map((o) => ({ name: o.name, gap: +(b.z - o.b.z).toFixed(1), lane: o.b.lane, down: o.status === 'down' }))
    .sort((p, q) => Math.abs(p.gap) - Math.abs(q.gap));
  const order = race.order.filter((o) => o.alive);
  const took = player.took;
  return {
    lane: b.lane, doing, roof, speed: +r.speed.toFixed(1),
    answer: took.length ? +(took.reduce((x, y) => x + y, 0) / took.length).toFixed(2) : null,
    last: player.last,
    place: order.indexOf(r) + 1, of: order.length,
    others,
    edge: +Math.max(0, race.collapse.z - b.z).toFixed(1), edgeSpeed: +race.collapse.speed.toFixed(1),
    lanes,
  };
}
