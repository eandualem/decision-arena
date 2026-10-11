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
  lanes, two rows deep. The slots rotate from race to race, so over as many
  races as there are runners everyone starts once from every slot. The page
  keeps the count in the browser, so a reload or a restarted server carries
  on the rotation instead of starting it again.
- **Speed.** Everyone shares a base speed that rises over the race. Each
  runner's pace rises while it runs cleanly (up to +10%) and with the boost
  pickup, and drops for a moment after a stumble, so the better runner pulls
  ahead.
- **Contact.** Running into the back of another runner is a stumble.
  Cutting across into one bounces you back to your lane. Jumping over
  another runner, or running on the train roofs above it, passes it.
- **Crashes.** A crash knocks a runner down for 0.7 s. It then gets up and
  runs through obstacles for 2 s while it gets going again. A crash costs
  ground rather than ending the race. Landing from a jetpack or pogo stick
  protects a runner the same way for under a second. Either way it blinks,
  so a runner passing through an obstacle always shows why.
- **No other way through.** Two cases let a runner pass a barrier untouched,
  and neither does now. Bouncing off a train's side, while reaching a
  barrier in the same step, skipped the barrier. Being pushed back behind
  another runner could land a runner inside a barrier. Rail Dash forgives a
  runner it finds already inside an obstacle, which suits one player but not
  these two. The step is now checked again after a side bounce, and a
  runner is only pushed back into clear space.
- **The collapse.** The ground falls away behind the pack. The edge is at
  most 40 m behind the leader at the start, closing to 20 m, and runs a
  little slower than the runners. A runner it reaches tumbles into the
  chasm and is out once the ground under it breaks, so a crash early in
  the race
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
  and drops. Buildings and stacked containers go as soon as the lip reaches
  their back: they lean back and sink into the chasm in one piece, so none
  stands sliced at the edge. Rubble falls with them, and dust billows up along the
  whole edge. Under the lip a lumpy bank of earth leans back as it falls
  away into a dark chasm, showing its layers.
- **The camera.** One steady view from behind and to the right, 45 degrees
  off the track, looking along it. It frames every runner still in the race
  and 34 m of track ahead of the leader, centred on screen, as close as that
  allows (15 to 44 m), so it moves in as runners go out and still keeps two
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

## 5. Models in the race

**Choice.** The game runs in the browser; a small Python server reaches the
models. The page and the server talk over one WebSocket. Each model runner
keeps one question in flight: the page sends what the runner sees, the
server asks the model, and the move it answers is applied the moment it
arrives, after which the page asks again (see 3). The server turns what the
runner sees into a short text and five options, in the request shape Entune
uses: left, right, jump, roll and keep going, each described.

What a runner sees, in this order:
- **Itself:** its lane and what it is doing (running, in the air and when it
  lands, rolling and when it stands up, changing lanes from which lane to
  which, on a train's roof, wearing spring shoes, protected after a crash or
  a landing), its speed, how long its own model's answers have taken (the
  mean of its last five), and its last move.
- **The lanes,** its own first, over the next 100 m: up to four obstacles
  each. Each obstacle has its distance, when the runner reaches it at its
  current speed (a train coming at it closes at both speeds), and how long
  after its answer arrives that is. A ramp is told together with the train
  it leads onto. A train beside the runner in the next lane says that moving
  into that lane now bounces it off. On a roof, barriers are marked as on
  the ground below.
- **The others:** its place, and every other runner still racing, with its
  lane, its gap and whether it is down after a crash.
- **The collapse:** how far behind the ground is breaking and whether that
  is gaining on it.

The instructions give the rules a decision needs. The game's timing windows,
measured by stepping its physics: when a jump clears a low barrier or a
buffer stop, and how long a roll stays low. That changing lanes into the side
of a train or barrier bounces a runner back. That a ramp leads onto its
train's roof, and that a roof ends in a drop unless the next roof starts
within 3 m. That spring shoes clear trains.

The lanes come before the standings because they decide the move. A
100 m look-ahead is over 3 s at top speed, enough for two answers. Up to four
obstacles a lane keeps the text short.

Every runner gets the same fields and the same text; only its own position,
and its own model's answer time, differ. Telling a model its answer time is
what lets it act on time: an answer made at 0.5 s lands 7 m later at 14 m/s,
and without it, models jumped and rolled while obstacles were still far off.
The text states facts and the rules of the game; it never says which move
to make.

Players are chosen when the server starts (`--players jev,openai,laya`). By
default every model whose key is set races, up to six, with no bots; bots
run only when named, or when no model can. The models: Jev, OpenAI and
Perplexity through their own APIs, Cloudflare's Clef-flash, Microsoft
Decision-1 and Liquid D1 through Vercel's AI Gateway (one key for both), and
two models on this computer: Laya, and Liquid's open d1-3B, served by
llama.cpp's `llama-server`. Both local servers answer the same System One
questions as Jev; the command starts each on a private port with a key of its
own and stops it when the command ends. API keys come from the environment or a `.env` file
and stay in the server. Each model is asked one question as the command
starts; if any does not answer, the command stops and says which, and which
key to check. During a race a failed or unusable answer is shown and the
runner asks again half a second later. One key shows or hides the decision panel:
per model its last choice, the probability of each move, its latency and
decisions per second, and its record over the races since the page loaded.
The record shows how often it finished first, second and third, and coins
a minute on the track. The cards are ordered by it: most wins first, then
most seconds, and so on. Coins count per minute, not in total, because a
race stops when one runner is left. Models aren't told where coins are, and
coins change nothing in the race, so coins a minute is a side measure.

**Why.** Keys never reach a page, the model code is plain Python that tests
can drive with recorded answers, and the game keeps its own clock.

d1-3B races only when named. On a 16 GB Mac, with the game drawing in the
browser, it held so much of the shared GPU memory that the race dropped from
about 50 frames a second to about 6, even when only Laya was answering. Laya
alone costs a few frames a second; running it on the CPU didn't help and made
its answers three times slower, so it stays on the GPU.

Why d1-3B as the second local model: among open-weight decision models that
run on a laptop, it is small (3B parameters, 2.9 GB at 8 bits), its maker
reports it on the same Decision Index as Jev (48.6 against Jev's 57.9), and
llama.cpp serves it with no extra code. The 27B open models (Perplexity's
decider, Clef) score higher but need more memory than a 16 GB laptop has
to spare. Its weights are under Liquid's LFM Open License, not this project's
MIT licence: the command downloads them from Liquid's page, and they are never
shipped with this project.

**Rejected.** Calling the models from the page: the keys would sit in the
browser. Sending pixels or the raw obstacle list: decision models answer
questions about text, and Entune's tested shape is a described state and
described options. Saying when to jump or roll for each obstacle: that
would be our choice, not the model's.
