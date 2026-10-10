// Unified input: keyboard, touch/mouse swipes, double-tap, gamepad.
// Produces discrete actions: 'left' | 'right' | 'up' | 'down' | 'hoverboard' | 'pause' | 'confirm' | 'back'
//  * Every action is emitted as EV.INPUT {action, source} (UI listens to this)
//  * Gameplay actions are also queued; Game calls input.drain() once per frame while running.
//  * Taps emit EV.TAP {x, y}; a double tap on the play field emits the 'hoverboard' action.
// Pointer events that start on interactive UI (button, a, input, [data-ui], .ui-interactive) are ignored,
// so UI buttons never trigger swipes/taps.
import { EV } from './events.js';

const KEYMAP = {
  ArrowLeft: 'left', KeyA: 'left',
  ArrowRight: 'right', KeyD: 'right',
  ArrowUp: 'up', KeyW: 'up',
  ArrowDown: 'down', KeyS: 'down',
  Space: 'hoverboard',
  Enter: 'confirm', NumpadEnter: 'confirm',
  Escape: 'pause', KeyP: 'pause',
  Backspace: 'back',
};
const GAMEPLAY = new Set(['left', 'right', 'up', 'down', 'hoverboard']);
const INTERACTIVE = 'button, a, input, select, textarea, label, [data-ui], .ui-interactive';

export class Input {
  constructor(ctx) {
    this.ctx = ctx;
    this.events = ctx.events;
    this.queue = [];
    this.enabled = true;
    this.lastAction = null;
    this._p = null;
    this._lastTap = { t: -1e9, x: 0, y: 0 };
    this._pad = { buttons: [], axes: [0, 0] };
    this._onKey = this._onKey.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    window.addEventListener('keydown', this._onKey, { passive: false });
    window.addEventListener('pointerdown', this._onDown, { passive: false });
    window.addEventListener('pointermove', this._onMove, { passive: false });
    window.addEventListener('pointerup', this._onUp);
    window.addEventListener('pointercancel', () => { this._p = null; });
    // iOS: stop double-tap zoom / scroll bounce on the play field
    window.addEventListener('touchmove', (e) => { if (!e.target.closest?.(INTERACTIVE + ', .ui-scroll')) e.preventDefault(); }, { passive: false });
    window.addEventListener('dblclick', (e) => e.preventDefault());
  }

  get swipeThreshold() { return Math.max(18, Math.min(window.innerWidth, window.innerHeight) * 0.034); }

  fire(action, source = 'code') {
    if (!this.enabled) return;
    this.lastAction = action;
    if (GAMEPLAY.has(action)) this.queue.push(action);
    this.events.emit(EV.INPUT, { action, source });
  }

  /** Returns and clears queued gameplay actions (in order). */
  drain() {
    if (!this.queue.length) return EMPTY;
    const q = this.queue; this.queue = [];
    return q;
  }
  clear() { this.queue.length = 0; }

  _onKey(e) {
    if (e.target && e.target.closest && e.target.closest('input, textarea, select')) return;
    const action = KEYMAP[e.code];
    if (!action) return;
    e.preventDefault();
    if (e.repeat) return;
    this.fire(action, 'key');
  }

  _onDown(e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    if (e.target && e.target.closest && e.target.closest(INTERACTIVE)) return;
    this._p = { id: e.pointerId, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, t: performance.now(), lastDir: null, moved: 0, swiped: false };
  }

  _onMove(e) {
    const p = this._p;
    if (!p || p.id !== e.pointerId) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    const dist = Math.hypot(dx, dy);
    p.moved = Math.max(p.moved, Math.hypot(e.clientX - p.x0, e.clientY - p.y0));
    const need = p.lastDir ? this.swipeThreshold * 1.6 : this.swipeThreshold;
    if (dist >= need) {
      const dir = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 'right' : 'left') : (dy > 0 ? 'down' : 'up');
      // re-anchor so an L-shaped gesture can produce a second, different action
      p.x = e.clientX; p.y = e.clientY;
      if (dir !== p.lastDir) { p.lastDir = dir; p.swiped = true; this.fire(dir, 'swipe'); }
    }
  }

  _onUp(e) {
    const p = this._p;
    if (!p || p.id !== e.pointerId) return;
    this._p = null;
    const dt = performance.now() - p.t;
    if (!p.swiped && p.moved < 14 && dt < 350) {
      const now = performance.now();
      this.events.emit(EV.TAP, { x: e.clientX, y: e.clientY });
      const lt = this._lastTap;
      if (now - lt.t < 320 && Math.hypot(e.clientX - lt.x, e.clientY - lt.y) < 60) {
        this.fire('hoverboard', 'doubletap');
        this._lastTap = { t: -1e9, x: 0, y: 0 };
      } else this._lastTap = { t: now, x: e.clientX, y: e.clientY };
    }
  }

  /** Poll gamepads (called every frame by main). */
  update() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : null;
    if (!pads) return;
    const pad = [...pads].find((p) => p && p.connected);
    if (!pad) return;
    const map = { 0: 'up', 1: 'down', 2: 'hoverboard', 3: 'up', 12: 'up', 13: 'down', 14: 'left', 15: 'right', 9: 'pause', 8: 'back' };
    pad.buttons.forEach((b, i) => {
      const was = this._pad.buttons[i] || false;
      if (b.pressed && !was && map[i]) this.fire(i === 0 && this.ctx.game?.state === 'menu' ? 'confirm' : map[i], 'pad');
      this._pad.buttons[i] = b.pressed;
    });
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    const [px, py] = this._pad.axes;
    if (ax < -0.55 && px >= -0.55) this.fire('left', 'pad');
    if (ax > 0.55 && px <= 0.55) this.fire('right', 'pad');
    if (ay < -0.55 && py >= -0.55) this.fire('up', 'pad');
    if (ay > 0.55 && py <= 0.55) this.fire('down', 'pad');
    this._pad.axes = [ax, ay];
  }
}
const EMPTY = Object.freeze([]);
