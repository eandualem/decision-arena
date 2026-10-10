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
    const planned = this.pilot.think(dt, NONE);
    if (!this.lag) return planned;
    for (const a of planned) this.queue.push({ a, at: this.t + this.lag });
    const out = this.out;
    out.length = 0;
    while (this.queue.length && this.queue[0].at <= this.t) out.push(this.queue.shift().a);
    return out;
  }
}
