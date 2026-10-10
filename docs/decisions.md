# Decisions

Stack and design choices for Decision Arena, with the reason for each and the
alternative it replaced. Newest last.

## 1. A race on the Rail Dash runner engine, in the browser

**Choice.** The game is a 3D runner race built on the Rail Dash engine: its
track, trains, barriers, ramps, power-ups, characters, effects and sound. The
engine runs in the browser with [three.js](https://threejs.org/) 0.186.0,
which is vendored, so the demo works offline. A small Python program serves
the page and, from the next step, talks to the decision models, so API keys
never reach the browser. Start everything with one command:

```bash
uv run decision-arena
```

**Why.** A race where four to six models compete at once is far more exciting
to watch than a calm grid game, and the engine already looks good, runs at 60
frames per second and has physics written per runner. Its single-player
progression (shop, missions, menus) is left out.

**Rejected.** A light-cycle game on a 2D canvas: built first, but too calm to
watch and practical for only two to four players.

## 2. The race

- **Start.** Up to six runners start on a staggered grid across the three
  lanes, two rows deep. The slots rotate from race to race, so everyone gets
  every start.
- **Speed.** Everyone shares a base speed that rises over the race. Each
  runner's pace rises while it runs cleanly (up to +10%) and with the boost
  pickup, and drops for a moment after a stumble, so the better runner pulls
  ahead.
- **Contact.** Running into the back of another runner is a stumble.
  Cutting across into one bounces you back to your lane. Jumping over
  another runner, or running on the train roofs above it, passes it.
- **Crashes.** A crash knocks a runner down for 0.7 s. It then gets up and
  runs through obstacles for 2 s while it gets going again. A crash costs
  ground rather than ending the race.
- **The sweeper.** A track-cleaning machine as wide as the track follows the
  pack. It is at most 30 m behind the leader at the start, closing to 6 m.
  Whoever it reaches is out, so a crash early in the race can be survived
  and a crash late in it cannot. The last runner left wins.

**Why.** Every rule creates contact between runners: overtakes, blocks,
comebacks and a pressure that rises over the race.

**Rejected.** Ending a runner's race on its first crash, as Rail Dash does.
In simulated races most runners went out within seconds, and the sweeper
never mattered.

## 3. How a model decides: no ticks

**Choice.** Each runner has its own loop. It sends its model the current
state. The moment an answer arrives, it applies the move (left, right, jump,
roll or keep going) and sends the next state straight away. A fast model makes
several decisions while a slow one makes one, and the world keeps moving while
a model thinks. The state includes what the runner is already doing (in the
air, changing lanes, rolling) and the move it made last.

**Why.** Every model gets to use its own speed, and it is never idle. A
slow model acting on an older picture is the honest cost of being slow.

**Rejected.** A fixed tick where every model is asked at the same moment and
a late answer counts as "keep going". A cloud model taking about half a
second would almost never act.

## 4. Bots

**Choice.** Rail Dash's autopilot, which plans moves with the game's own
physics, can drive any runner. It plans around the other runners too. An
optional reaction lag makes bots of different speeds. With four bots,
simulated races last about 20 to 45 seconds.

**Why.** The demo runs with no keys at all, and the bots are a baseline the
models have to beat.
