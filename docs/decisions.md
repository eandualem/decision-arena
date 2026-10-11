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
- **The collapse.** The ground falls away behind the pack. The edge is at
  most 30 m behind the leader at the start, closing to 6 m. A runner it
  reaches tumbles into the chasm and is out once the ground under it
  breaks, so a crash early in the race
  can be survived and a crash late in it cannot. The last runner left wins,
  and the ground keeps breaking up to just behind the winner. What the
  ground takes keeps its shape as it goes. Nothing breaks along a straight
  line: the lip is ragged. The track breaks off in slabs (ballast, sleepers
  and rails on a block of soil), each lane running a little ahead of or
  behind the others and each slab at its own moment, and the ground either
  side crumbles along a wandering line. The same rule decides what the
  shaders hide, where slabs and rubble break off and when a runner falls, so
  they always agree. Trains, ramps and
  barriers stay whole: each holds until about a third of it hangs over the
  edge, then loses its balance, tips back until it stands almost on end,
  and drops. Buildings and stacked containers sink and lean back into the
  chasm in one piece. Rubble falls with them, and dust billows up along the
  whole edge. Under the lip a lumpy bank of earth leans back as it falls
  away into a dark chasm, showing its layers.
- **The camera.** One steady view from behind and to the right, 45 degrees
  off the track, looking along it. It frames every runner still in the race
  and 22 m of track ahead of the leader, centred on screen, as close as that
  allows (9 to 40 m), so it moves in as runners go out and still keeps two
  far apart in view. The collapse joins the frame only when it is within
  7 m of the last runner. Scenery on the near side is cut away, and a rail
  yard of idle tracks, behind a low railing, takes its place, so nothing
  stands between the camera and the race. At the finish it settles on the
  winner. **C** switches to a view of the pack from straight behind.

**Why.** Every rule creates contact between runners: overtakes, blocks,
comebacks and a pressure that rises over the race.

**Rejected.** Ending a runner's race on its first crash, as Rail Dash does.
In simulated races most runners went out within seconds, and the sweeper
never mattered. A chaser on the track (a sweeping machine, then a runaway
train): it had to pass through the trains on the track. Moving the ground's
vertices down: connected surfaces folded instead of breaking. Breaking
trains and buildings into boxes of debris: a train that shatters into cubes
does not look like a train falling. A camera director cutting between close
shots like a sports broadcast: close shots hid the other runners, so you
could not follow the race. Showing the earth under the cut-away near side:
a cliff and a dark void took a third of the screen. Cutting the world with
one clipping plane at the edge: everything was sliced along one straight
line, which looks nothing like ground giving way. Keeping the collapse in
view all the time: half the screen showed the ground behind the runners
instead of what is coming at them.

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
