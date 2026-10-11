// Tiny synchronous event bus + canonical event names. Owned by the orchestrator.
// Always use EV.* constants (typos in raw strings fail silently).
// Payload shapes are documented in CONTRACTS.md section "Events".

export const EV = {
  // --- app / run flow (emitted by Game unless noted)
  STATE: 'game:state',                 // {state, prev}
  RUN_START: 'run:start',              // {characterId, outfit, boardId, tutorial}
  RUN_END: 'run:end',                  // {score, coins, distance, time, multiplier, cause, stats, pickups}
  RUN_RESULTS: 'run:results',          // (Meta) processed summary for the game-over screen
  REVIVE_OFFER: 'revive:offer',        // {cost, keys, timeout}
  COUNTDOWN: 'game:countdown',         // {n} 3,2,1,0 (0 = go)

  // --- player (Game)
  JUMP: 'player:jump',                 // {x,y,z, super:boolean, double:boolean}
  ROLL: 'player:roll',                 // {x,y,z, airborne:boolean}
  LAND: 'player:land',                 // {x,y,z, fallHeight, onTrain:boolean, hard:boolean}
  LANE: 'player:lane',                 // {from, to, x}
  STUMBLE: 'player:stumble',           // {x,y,z, side:-1|1, kind}
  CRASH: 'player:crash',               // {x,y,z, kind}
  CAUGHT: 'player:caught',             // {x,y,z}
  REVIVE: 'player:revive',             // {cost}
  INVULNERABLE: 'player:invulnerable', // {duration}

  // --- collectibles (Game, after processing level.collect results)
  COIN: 'coin:collect',                // {x,y,z, total, magnet:boolean, sky:boolean}
  PICKUP: 'pickup:collect',            // {type, x,y,z, letter?}
  POWERUP_START: 'powerup:start',      // {type, duration}
  POWERUP_END: 'powerup:end',          // {type}
  HOVERBOARD_START: 'hoverboard:start',// {boardId, duration}
  HOVERBOARD_BREAK: 'hoverboard:break',// {x,y,z}
  HOVERBOARD_END: 'hoverboard:end',    // {}
  HEADSTART_START: 'headstart:start',  // {distance}
  HEADSTART_END: 'headstart:end',      // {}
  SCORE_BOOSTER: 'scorebooster:use',   // {bonus}

  // --- level / world (Level)
  OBSTACLE_PASS: 'obstacle:pass',      // {kind, lane, playerLane, relation:'over'|'under'|'beside'|'onTop'|'through', moving}
  TRAIN_APPROACH: 'train:approach',    // {id, lane, z, speed}
  TUTORIAL_HINT: 'tutorial:hint',      // {action:'jump'|'roll'|'left'|'right'|'hoverboard'|'any', text, z}
  TUTORIAL_CLEAR: 'tutorial:clear',    // {action}
  TUTORIAL_DONE: 'tutorial:done',      // {}
  CHASER: 'chaser:state',              // (Game) {state:'near'|'far'|'catching'}

  // --- meta / progression (Meta)
  META_CHANGED: 'meta:changed',        // {reason}
  MISSION_PROGRESS: 'mission:progress',// {mission}
  MISSION_COMPLETE: 'mission:complete',// {mission, setIndex}
  MISSION_SET_COMPLETE: 'missionset:complete', // {setIndex, multiplier}
  DAILY_LETTER: 'daily:letter',        // {letter, index, word, found}
  DAILY_COMPLETE: 'daily:complete',    // {word, reward}
  REWARD: 'reward',                    // {type, amount, source}
  SETTINGS: 'settings:changed',        // {key, value, settings}
  TOAST: 'toast',                      // {text, icon?, kind?:'info'|'good'|'warn', duration?}  (anyone)

  // --- app (main.js)
  READY: 'app:ready',                  // {}
  RESIZE: 'app:resize',                // {w, h, aspect}
  QUALITY: 'app:quality',              // {quality:'low'|'medium'|'high', setting}

  // --- input (Input)
  INPUT: 'input:action',               // {action:'left'|'right'|'up'|'down'|'hoverboard'|'pause'|'confirm'|'back', source}
  TAP: 'input:tap',                    // {x, y}

  // --- UI commands (UI emits; Game handles unless noted)
  UI_PLAY: 'ui:play',
  UI_PAUSE: 'ui:pause',
  UI_RESUME: 'ui:resume',
  UI_HOME: 'ui:home',
  UI_RESTART: 'ui:restart',
  UI_REVIVE: 'ui:revive',              // accept revive offer
  UI_REVIVE_DECLINE: 'ui:reviveDecline',
  UI_HOVERBOARD: 'ui:hoverboard',
  UI_HEADSTART: 'ui:headstart',
  UI_SCORE_BOOSTER: 'ui:scoreBooster',
  UI_PREVIEW_CHARACTER: 'ui:previewCharacter', // {id, outfit}
  UI_PREVIEW_BOARD: 'ui:previewBoard',         // {id|null}
  UI_SCREEN: 'ui:screen',              // {name}  current UI screen (camera/scene may react)
  UI_CLICK: 'ui:click',                // {} button feedback sound (Audio)
};

export class EventBus {
  constructor() { this._h = new Map(); this.debug = false; }
  on(name, fn) {
    if (!name) throw new Error('EventBus.on: missing event name');
    let set = this._h.get(name);
    if (!set) this._h.set(name, (set = new Set()));
    set.add(fn);
    return () => set.delete(fn);
  }
  once(name, fn) { const off = this.on(name, (p) => { off(); fn(p); }); return off; }
  off(name, fn) { this._h.get(name)?.delete(fn); }
  emit(name, payload = {}) {
    if (this.debug) console.log('[ev]', name, payload);
    const set = this._h.get(name);
    if (!set) return;
    for (const fn of [...set]) {
      try { fn(payload); } catch (e) { console.error(`[events] handler for "${name}" threw:`, e); }
    }
  }
}
