// A bot runner: Rail Dash's autopilot, which plans with the exact game physics, optionally slowed by a
// reaction lag so bots of different speeds show the same story the models do.
import { Autopilot } from '../gameplay/autopilot.js';

const NONE = [];

export class Bot {
  constructor(runner, lag = 0) {
    this.runner = runner;
    this.lag = lag;          // seconds between deciding a move and making it
    this.pilot = new Autopilot(runner);
    this.queue = [];
    this.t = 0;
    this.out = [];
  }

  reset() { this.pilot.reset(); this.queue.length = 0; this.t = 0; }

  think(dt) {
    this.t += dt;
    if (!this.lag) return this.pilot.think(dt, NONE);
    const out = this.out;
    out.length = 0;
    // One decision at a time: plan again only once the last one has been made.
    if (!this.queue.length) for (const a of this.pilot.think(dt, NONE)) this.queue.push({ a, at: this.t + this.lag });
    while (this.queue.length && this.queue[0].at <= this.t) out.push(this.queue.shift().a);
    return out;
  }
}
