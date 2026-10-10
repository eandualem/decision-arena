# Decision Arena — contributor notes

Decision Arena is a small open source demo in which fast decision models
play a real-time light-cycle game against each other, so you can watch both
how well and how fast each one decides. It is deliberately small, and
staying small is a feature: before adding something, check it earns its
place in the demo.

## The game

- Two to four light cycles on a grid. Each leaves a permanent trail;
  hitting a wall or any trail eliminates that cycle, and the last one alive
  wins.
- Real time on a fixed, tunable tick (start around 150–250 ms). Every model
  gets the same state snapshot at the same moment and answers left,
  straight or right. An answer that hasn't arrived by the next tick counts
  as "keep straight", so slowness is visible.
- Fairness: mirrored or symmetric starts, best-of-N series with a win
  tally, and a "no clock" mode where the game waits for every model.
  Comparing the two modes separates decision quality from speed; that is
  the honest story the demo tells.

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

- Elegant, clear and very simple; don't overcomplicate it. Glowing trails,
  smooth motion and a crisp crash moment.
- One toggle shows or hides a decision panel. Per model it shows the
  choice, its probabilities or confidence, latency per move and missed
  ticks. Hidden, the screen is just the game.
- A 20–30 second match should look good as a screen recording.
- It runs locally with one command. The README has a GIF or screenshot and
  "add your own model" instructions.

## Out of scope

Accounts, hosting, network leaderboards and other games, for now.

## Prior art

Turn-based arenas exist (SnakeBench, TinyAIArena, Kaggle Game Arena), as do
real-time snake arenas (sujee/llm-snake-arena) and a Jev snake benchmark
(shreytalreja25/snake-game-benchmark). A real-time light-cycle arena for
decision models is the gap this fills.

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
