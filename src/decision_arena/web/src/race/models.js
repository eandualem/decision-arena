// Runners driven by decision models. The models live behind the server (it holds their keys); the page asks
// through one WebSocket. Each model runner keeps one question in flight: it sends what it sees, applies the
// move the moment the answer arrives, and asks again straight away, so a fast model decides more often than a
// slow one and the race never waits for anyone (docs/decisions.md, 3 and 5).
import { TRAIN } from '../config.js';

const RANGE = 60;          // metres ahead a runner sees
const RETRY = 0.5;         // seconds before asking again after a failed answer
const RATE_WINDOW = 5;     // seconds over which decisions per second are counted
const MOVE = { left: 'left', right: 'right', jump: 'up', roll: 'down', keep: null };

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
    if (!this.pending && this.wait <= 0 && r.active && r.race.state === 'running') {
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

/** What a runner sees, in the shape server's models.question() reads. */
export function see(r, player) {
  const b = r.b, race = r.race;
  const doing = [];
  if (b.laneT < 1) doing.push('changing lanes');
  if (r.player.flight) doing.push(r.player.flight.kind === 'jetpack' ? 'flying on a jetpack' : 'bouncing on a pogo stick');
  else if (!b.grounded) doing.push('in the air');
  else if (b.y >= TRAIN.height - 0.3) doing.push('running on a train roof');
  if (b.rollT > 0) doing.push('rolling');
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

  // the runners just ahead and just behind
  const order = race.order.filter((o) => o.alive);
  const i = order.indexOf(r);
  const near = (o) => o && { name: o.name, gap: +Math.abs(o.b.z - b.z).toFixed(1), lane: o.b.lane };
  return {
    lane: b.lane, doing, speed: +r.speed.toFixed(1),
    last: player.last,
    place: i + 1, of: order.length,
    ahead: near(order[i - 1]), behind: near(order[i + 1]),
    edge: +Math.max(0, race.collapse.z - b.z).toFixed(1),
    lanes,
  };
}
