// Shared constants for Rail Dash. Owned by the orchestrator. Agents: READ ONLY.
// If you need a new tunable, keep it local to your module (export it from your own files).
//
// Units: meters and seconds. Coordinate system: forward (running direction) = -Z, up = +Y, right = +X.
// The player starts at z = 0 and runs toward negative z. "distance" = -player.z.

export const GAME_NAME = 'Rail Dash';
export const SAVE_KEY = 'raildash.save.v1';

// ---------------------------------------------------------------- lanes / track
export const LANE_WIDTH = 2.6;               // x distance between lane centers
export const LANES = [-1, 0, 1];             // lane indices, x = lane * LANE_WIDTH
export const laneX = (lane) => lane * LANE_WIDTH;

export const TRACK = {
  railGauge: 1.25,          // distance between the two rails of one track (visual only)
  sleeperSpacing: 0.95,     // visual only
  corridorHalfWidth: 4.8,   // |x| < this is the gameplay corridor: scenery must stay out above y = 0.3
  overheadClearance: 13,    // anything spanning the corridor (bridges, gantries, roofs) must have its underside above this y
};

// ---------------------------------------------------------------- player body & physics
export const PLAYER = {
  halfWidth: 0.34,          // collision half-extent in x
  halfDepth: 0.3,           // collision half-extent in z
  height: 1.7,              // standing/running collision height (feet at y, head at y + height)
  rollHeight: 0.85,         // collision height while rolling
};

export const PHYS = {
  gravity: 38,              // m/s^2 (snappy, arcade)
  jumpVelocity: 11.6,       // apex ~1.77 m, airtime ~0.61 s
  superJumpVelocity: 18.5,  // with Spring Kicks (super sneakers): apex ~4.5 m, clears trains
  boardJumpBonus: 1.12,     // multiplier on jump velocity for the 'superJump' hoverboard ability
  fastFallVelocity: -34,    // swipe down while airborne
  laneSwitchTime: 0.13,     // seconds for a full lane change
  rollDuration: 0.62,
  stepUp: 0.45,             // max height the player can step onto without jumping (ramp slopes, roof seams)
  coyoteTime: 0.08,         // jump grace after leaving a surface
  jumpBuffer: 0.16,         // buffered jump before landing
};

// ---------------------------------------------------------------- obstacles (dimensions shared by level + gameplay)
export const TRAIN = {
  width: 2.3,               // must stay < LANE_WIDTH
  height: 3.1,              // roof (walkable) at y = height
  carLength: 12.5,
  carGap: 0.7,              // gap between coupled cars (roof is continuous for gameplay: treat as walkable)
  rampLength: 8.5,          // ramp rises from y=0 to y=height over this length, attached to a train's near end
  movingSpeedMin: 7,        // oncoming trains move toward the player (+z) at this speed range
  movingSpeedMax: 12,
};

export const BARRIER = {
  width: 2.2,
  depth: 0.35,
  jumpHeight: 1.05,         // 'barrierJump': solid from y=0 to 1.05 -> must jump
  rollClear: 1.05,          // 'barrierRoll': free space from y=0 to 1.05 -> must roll under
  rollTop: 2.55,            //                solid from y=rollClear to rollTop (can be cleared with a super jump)
  bumperHeight: 1.35,       // 'bumper' (track-end buffer stop): solid 0..1.35, depth ~1.2 -> jump over it
};

// ---------------------------------------------------------------- speed / distance
export const SPEED = {
  start: 14,                // m/s at run start
  max: 30,                  // asymptotic max
  rampSeconds: 200,         // speed = start + (max-start) * (1 - exp(-t / rampSeconds))
  headstart: 58,            // m/s during a headstart (rocket start)
  headstartDistance: 900,   // meters covered by one headstart
};

export const FLIGHT = {
  jetpackAltitude: 8.2,     // feet y while flying with the jetpack
  headstartAltitude: 8.2,
  pogoApex: 10.5,           // feet y at the top of a pogo bounce
  skyCeiling: 11.5,         // nothing in the world may occupy the corridor between train roofs and this height
};

// ---------------------------------------------------------------- world streaming
export const VIEW = {
  spawnAhead: 240,          // content must exist from player.z down to player.z - spawnAhead
  despawnBehind: 40,        // recycle content once it is this far behind the player (z > player.z + despawnBehind)
  menuBackdrop: 70,         // at the menu the camera looks backward: content must also exist for z in [0, +70]
  cameraFar: 460,
};

// Default curved-world bend (see core/curve.js). Environment may animate x (sideways sway) during runs.
export const CURVE = { x: 0.0, y: 0.0021, start: 8 };

// ---------------------------------------------------------------- power-ups & items
// Timed power-up durations: base + perLevel * upgradeLevel (upgradeLevel 0..UPGRADE.maxLevel).
export const POWERUPS = {
  jetpack:    { name: 'Jetpack',      base: 8,  perLevel: 1.8, color: '#ff7a1a' },
  sneakers:   { name: 'Spring Kicks', base: 10, perLevel: 2.2, color: '#39d353' },
  magnet:     { name: 'Coin Magnet',  base: 10, perLevel: 2.2, color: '#ff3b5c' },
  multiplier: { name: '2x Score',     base: 10, perLevel: 2.2, color: '#ffd23f' },
  pogo:       { name: 'Pogo Stick',   base: 2.6, perLevel: 0,  color: '#b86bff' }, // single giant bounce, not upgradable
};
export const POWERUP_TYPES = ['jetpack', 'sneakers', 'magnet', 'multiplier', 'pogo'];
export const UPGRADE = { maxLevel: 6, prices: [500, 1000, 2000, 4000, 8000, 16000] };

export const HOVERBOARD = { duration: 30, breakInvulnerable: 1.6 };
export const MAGNET = { radius: 9, pullSpeed: 38 };     // coins within radius (any lane) fly to the player
export const REVIVE = { baseCost: 1, timeout: 4.5, invulnerable: 2.5, clearAhead: 45 };  // cost doubles each revive in a run
export const STUMBLE = { window: 4.5 };                 // a 2nd stumble within this many seconds = caught
export const CHASER = { nearGap: 2.4, farGap: 32, introTime: 3.2 };
export const MULTIPLIER = { max: 30 };                  // mission-set multiplier cap
export const SCORE = { perMeter: 1, perCoin: 0 };       // score += meters * multiplier (x2 with 2x power-up)

// Item ids used by inventory/shop/pickups
export const ITEMS = {
  hoverboard:   { name: 'Hoverboard',    desc: 'Double-tap to ride for 30 s. Absorbs one crash.' },
  headstart:    { name: 'Rocket Start',  desc: 'Blast ahead at the start of a run.' },
  scoreBooster: { name: 'Score Booster', desc: 'Adds +5 to your multiplier for one run.' },
  mysteryBox:   { name: 'Mystery Box',   desc: 'Coins, keys, boards, maybe a jackpot.' },
  key:          { name: 'Key',           desc: 'Spend keys to keep running after a crash.' },
};

// Pickup kinds that can exist in the level (collectibles). 'coin' is separate and very common.
export const PICKUPS = ['jetpack', 'sneakers', 'magnet', 'multiplier', 'pogo', 'mysteryBox', 'key', 'letter', 'token', 'hoverboardItem'];
