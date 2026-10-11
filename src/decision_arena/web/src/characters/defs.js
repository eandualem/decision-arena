// Character + hoverboard roster (DATA ONLY). Owned by the orchestrator; shared by Characters, Meta and UI.
// Ids, unlock rules and abilities are fixed. The CHARACTERS agent keeps all visual configuration in its own
// files keyed by these ids. Unlock types: 'default' (owned from the start), 'coins', 'keys', 'tokens'.

export const CHARACTERS = [
  { id: 'zed',   name: 'Zed',   tagline: 'Spray first, ask later.',        unlock: { type: 'default', price: 0 },
    outfits: [{ id: 'street', name: 'Street', unlock: { type: 'default', price: 0 } }, { id: 'midnight', name: 'Midnight', unlock: { type: 'coins', price: 3000 } }, { id: 'neon', name: 'Neon', unlock: { type: 'coins', price: 8000 } }] },
  { id: 'mira',  name: 'Mira',  tagline: 'Never met a wall she didn\'t tag.', unlock: { type: 'coins', price: 6000 },
    outfits: [{ id: 'bomber', name: 'Bomber', unlock: { type: 'default', price: 0 } }, { id: 'sunset', name: 'Sunset', unlock: { type: 'coins', price: 5000 } }] },
  { id: 'rex',   name: 'Rex',   tagline: 'Rawr means "outta my way".',     unlock: { type: 'coins', price: 15000 },
    outfits: [{ id: 'jungle', name: 'Jungle', unlock: { type: 'default', price: 0 } }, { id: 'lava', name: 'Lava', unlock: { type: 'coins', price: 8000 } }] },
  { id: 'pixel', name: 'Pixel', tagline: 'Beep boop. Running mode: ON.',   unlock: { type: 'coins', price: 30000 },
    outfits: [{ id: 'chrome', name: 'Chrome', unlock: { type: 'default', price: 0 } }, { id: 'retro', name: 'Retro', unlock: { type: 'coins', price: 10000 } }] },
  { id: 'juno',  name: 'Juno',  tagline: 'Helmet on. Brakes off.',         unlock: { type: 'keys', price: 30 },
    outfits: [{ id: 'derby', name: 'Derby', unlock: { type: 'default', price: 0 } }, { id: 'arctic', name: 'Arctic', unlock: { type: 'keys', price: 15 } }] },
  { id: 'koa',   name: 'Koa',   tagline: 'Rides rails like waves.',        unlock: { type: 'keys', price: 60 },
    outfits: [{ id: 'tropic', name: 'Tropic', unlock: { type: 'default', price: 0 } }, { id: 'storm', name: 'Storm', unlock: { type: 'keys', price: 20 } }] },
  { id: 'luna',  name: 'Luna',  tagline: 'Season hunt exclusive.',         unlock: { type: 'tokens', price: 60 },
    outfits: [{ id: 'nova', name: 'Nova', unlock: { type: 'default', price: 0 } }, { id: 'eclipse', name: 'Eclipse', unlock: { type: 'tokens', price: 40 } }] },
];

// Hoverboard abilities (applied by Game while the board is active):
//   none       - plain board
//   superJump  - jumps are higher (PHYS.boardJumpBonus) while riding
//   speed      - +12% run speed and +12% score gain while riding
//   zap        - lane switches are instant and side hits don't stumble while riding
//   doubleJump - one extra jump while airborne
//   glide      - lower gravity while falling (floaty landings)
export const BOARDS = [
  { id: 'classic',  name: 'Daybreak',    ability: 'none',       desc: 'The trusty first ride.',          unlock: { type: 'default', price: 0 } },
  { id: 'bouncer',  name: 'Bouncer',     ability: 'superJump',  desc: 'Springs you higher on every jump.', unlock: { type: 'coins', price: 9000 } },
  { id: 'nitro',    name: 'Nitro',       ability: 'speed',      desc: 'Faster ride, faster score.',      unlock: { type: 'coins', price: 14000 } },
  { id: 'glider',   name: 'Glider',      ability: 'glide',      desc: 'Floats down like a feather.',     unlock: { type: 'coins', price: 11000 } },
  { id: 'zapper',   name: 'Zapper',      ability: 'zap',        desc: 'Snap between lanes instantly.',   unlock: { type: 'keys', price: 25 } },
  { id: 'twin',     name: 'Double Deck', ability: 'doubleJump', desc: 'Jump again in mid-air.',          unlock: { type: 'keys', price: 45 } },
];

export const characterById = (id) => CHARACTERS.find((c) => c.id === id) || CHARACTERS[0];
export const boardById = (id) => BOARDS.find((b) => b.id === id) || BOARDS[0];
