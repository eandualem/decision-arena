# Decision Arena — contributor notes

Decision Arena is a small open source demo in which fast decision models
race each other in a real-time 3D runner game, so you can watch both how
well and how fast each one decides. It is deliberately small, and staying
small is a feature: before adding something, check it earns its place in
the demo.

## The game

- Four to six runners share one three-lane track with trains, barriers,
  ramps and power-ups, built on the Rail Dash runner engine. A chaser
  closes in from behind; crashing or being caught puts a runner out, and
  the last runner standing wins.
- Runners compete directly: they can block, bump and overtake each other,
  and a runner's pace rises while it runs cleanly and drops when it
  stumbles.
- No ticks. Each model gets the current state, answers with one move
  (left, right, jump, roll or keep going), and gets the next state the
  moment its answer is applied. A fast model makes several decisions while
  a slow one makes one, and the world keeps moving while a model thinks;
  that is the speed story the demo tells.
- Fairness: everyone runs the same track from a shared start, and the
  state a model sees includes what its runner is already doing.
- Original work only: the game is Decision Arena on the Rail Dash engine.
  Never use the names, characters, logos, art, music or UI of any other
  runner game, and never compare the game to one by name in anything
  user-visible, the README or other public text. Characters, the chaser,
  graffiti, sounds and names stay our own.

## Decision models

- Integrate models the way
  [Entune](https://github.com/eandualem/entune) already does. Read, never
  change: `src/entune/processing/jev_client.py`, `jev.py` and `laya.py`,
  `src/entune/app/decision_models.py`, `docs/decision-model-results.md` and
  `docs/models.md`.
- Contestants: Jev (TypeSafe, cloud) and Laya (local), plus any other fast
  decision model that is easy to add, such as GPT-6 Luna or Gemini Flash.
  A simple adapter interface lets anyone add their own model.
- Ask the `entune` agent about the integration when its code doesn't
  settle a question.
- API keys come from the environment only (for example
  `TYPESAFE_API_KEY`) and are never committed, logged or shown on screen.
  Tests use fake or recorded responses; a live run against a paid API
  needs the maintainer's go-ahead with its expected cost.

## Look and feel

- Exciting and playful, but clear: a camera that keeps the whole pack in
  view, a colour and name per runner, and crisp crashes and overtakes.
- One toggle shows or hides a decision panel. Per model it shows the
  choice, its probabilities or confidence, latency and decisions per
  second. Hidden, the screen is just the race.
- A race of a minute or two should look good as a screen recording.
- It runs locally with one command. The README has a GIF or screenshot and
  "add your own model" instructions.

## Out of scope

Accounts, hosting, network leaderboards, and Rail Dash's single-player
progression (shop, missions, rewards), for now.

## Prior art

Turn-based arenas exist (SnakeBench, TinyAIArena, Kaggle Game Arena), as do
real-time snake arenas (sujee/llm-snake-arena), a Jev snake benchmark
(shreytalreja25/snake-game-benchmark) and two-player fighting-game matches
between language models. A real-time race in which four to six decision
models compete at once, each at its own speed, is the gap this fills.

## Working on it

`main` is the default and integration branch. Every change lands through a
reviewed pull request into `main`, with conventional commits (`feat:`,
`fix:`, `docs:`, `chore:`) and a body saying why. Record stack and design
decisions in `docs/decisions.md` before implementing them.

This repository is public: everything in it, and every issue, PR, commit
and comment, is written for publication.

## Local continuity

At startup, read `.backbone/memory/SCRATCHPAD.md` when present and update
it at handoffs. It is never tracked; the shared project-context policy
governs it.
