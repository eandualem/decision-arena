# Decision Arena

Fast decision models race each other in a real-time 3D runner game. Up to six
runners share three train-track lanes full of barriers, ramps and trains, while
the ground breaks away behind them. Each runner is driven by a different
decision model, and the last one standing wins.

There are no turns. A model answers with one move, the move is made the moment
the answer arrives, and the model is asked again straight away. A fast model
decides several times while a slow one decides once, and the world keeps moving
while a model thinks. You see both how well and how fast each model decides.

![Five decision models racing, with the decision panel open](docs/images/race.jpg)

## Run it

You need [uv](https://docs.astral.sh/uv/) and a key for at least one model.

```bash
cp .env.example .env      # then fill in the keys you have
uv run decision-arena
```

The page opens in your browser. Press Space to start a race, D to show or hide
the decision panel, and C to switch camera.

By default every model with a key races, up to six. Choose players with
`--players`, for example `uv run decision-arena --players jev,openai,laya`.
`--runners` sets the number of runners (two to six); `bot` fills a seat with a
built-in runner that isn't a model. `--port` and `--no-browser` do what they
say.

| Player | Model | Key in `.env` |
|---|---|---|
| `jev` | Jev 1.13 at TypeSafe | `TYPESAFE_API_KEY` |
| `openai` | GPT-6 Luna, OpenAI Decisions API | `OPENAI_API_KEY` |
| `perplexity` | Perplexity Decider 1.1 | `PERPLEXITY_API_KEY` |
| `laya` | Laya, on your computer | none: install it with `uv tool install 'laya[serve]'` |
| `d1` | Liquid d1-3B, on your computer | none: needs llama.cpp build 11483 or newer (see below) |
| `clef` | Cloudflare Clef-flash on Workers AI | `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_AUTH_TOKEN` |
| `microsoft` | Microsoft Decision-1, through Vercel's AI Gateway | `AI_GATEWAY_API_KEY` |
| `liquid` | Liquid D1, through Vercel's AI Gateway | `AI_GATEWAY_API_KEY` |

For d1-3B, install a [llama.cpp release](https://github.com/ggml-org/llama.cpp/releases)
from build b11483 on, so that `llama-server` is on your `PATH`; `brew install llama.cpp`
works too once Homebrew's version reaches that build. The command checks the build and
says if it's too old.

The two local models download on their first start: about 850 MB for Laya and
2.9 GB for d1-3B. After that they start in seconds. d1-3B's weights come from
[Liquid's page](https://huggingface.co/LiquidAI/d1-3B-GGUF) under Liquid's LFM
Open License, separate from this project's MIT licence. That license doesn't
cover commercial use by a company with $10 million or more in annual revenue.

Before the race, every model is asked one question. If any of them fails to
answer, the command stops and tells you which model failed and which key to
check, so you can replace it:

```text
Not starting. OpenAI did not answer (HTTP 401: Incorrect API key provided: [key]. You can find your API key at https://platform.openai.com/account/api-keys.). Check OPENAI_API_KEY in .env, or choose other players.
```

Keys stay in the local server. They are never sent to the page, logged or shown
on screen.

## Fair races

- **Same track.** Every runner in a race runs the same track from a shared
  start. Each race gets a new track.
- **Every start slot.** The grid has three slots in the front row and three
  just behind it. The slots rotate one place every race, so over as many races
  as there are runners (five races for five models), each model starts once
  from every slot. The rotation carries on across page reloads and server
  restarts.
- **Same question.** Every model is asked by the same code, with the same
  fields and the same wording. Only the runner's own position and its own
  model's answer time differ.
- **Same moves.** Every model chooses from the same five moves, which the game
  applies the same way for every runner.
- **No waiting.** The game never waits for a model. Speed is part of the
  contest, which is why each model is told how long its own answers take.

## What each model is asked

Each time, a model gets one question: a description of what its runner sees,
instructions, and five described moves. Here is a real question from a
five-model race, sent to Perplexity as it ran in the right lane:

**State**

> A race on three train-track lanes, left, middle and right, all running
> forward. You are in the right lane, running, at 14 m/s. Your answers take
> about 0.54 s, so your move is made about 8 m further on. Your last move was
> keep. You are 3rd of 5. Jev is level with you in the middle lane. OpenAI is
> level with you in the left lane. Clef is 4 m behind you in the middle lane.
> Laya is 4 m behind you in the left lane. The ground is breaking away 40 m
> behind you. Your lane (right): a low barrier (jump over it) 14 m ahead,
> reached in 0.99 s (0.45 s after your answer). Left lane: a high barrier (roll
> under it) 15 m ahead, reached in 1.02 s (0.48 s after your answer); then a
> ramp up onto a train roof (run up it) 59 m ahead, reached in 4.05 s (3.51 s
> after your answer). Middle lane: a low barrier (jump over it) 16 m ahead,
> reached in 1.09 s (0.55 s after your answer).

**Instructions** (the same in every question)

> Choose this runner's next move. Crashing into a barrier or the front of a
> train knocks it down and costs ground; the ground breaking away behind it
> ends its race. Your move is made when your answer arrives, so allow for your
> answer time. A lane change takes 0.13 s. A jump lasts 0.61 s and clears a low
> barrier you reach 0.10 to 0.55 s after jumping, or a buffer stop you reach
> 0.14 to 0.50 s after: jump too early and you land before it. A roll gets you
> under a high barrier you reach within 0.64 s of rolling: roll too early and
> you stand up before it. Trains are too high to jump onto except up a ramp.
> Running into another runner's back trips you, changing lanes into one bounces
> you back, and jumping takes you over one.

**Moves**

| Move | Description |
|---|---|
| `left` | move one lane to the left |
| `right` | move one lane to the right (you are already in the right lane: nothing happens) |
| `jump` | jump: clears low barriers and buffer stops |
| `roll` | roll: slides under high barriers |
| `keep` | keep going as you are |

### What goes into the state

- **Your runner:** its lane; what it is doing (running, changing lanes, in the
  air and when it lands, rolling and when it stands up, on a train roof,
  wearing spring shoes); its speed; and its last move.
- **Your answer time:** the mean of its model's last five answer times, and how
  far the runner travels in that time. It's left out of the first question of
  a race, because there is no answer time yet.
- **The other runners:** place, and every other runner still racing, nearest
  first, with its lane, its gap, and whether it is down after a crash.
- **The collapse:** how far behind the ground is breaking away, and whether it
  is gaining.
- **The lanes:** your own lane first, then the other two. Each lists the next
  60 m in order. For each obstacle you get its distance and when you reach it
  at your current speed; a train coming at you closes at both speeds. You also
  get how long after your answer arrives that is. A train beside or under you
  says how far it goes on.

The text gives facts and the game's rules. It never says which move to make.
The jump and roll windows come from the game itself: they were measured by
stepping its physics (`gameplay/physics.js`) at 14, 20 and 28 m/s.

### The request

Jev, Perplexity, Clef, Laya and d1-3B take the System One request shape:

```json
{
  "model": "jev-1.13.0",
  "state": "A race on three train-track lanes, ...",
  "questions": {
    "move": {
      "type": "choice",
      "instructions": "Choose this runner's next move. ...",
      "criteria": {
        "left": "move one lane to the left",
        "right": "move one lane to the right (you are already in the right lane: nothing happens)",
        "jump": "jump: clears low barriers and buffer stops",
        "roll": "roll: slides under high barriers",
        "keep": "keep going as you are"
      }
    }
  }
}
```

OpenAI, Microsoft and Liquid take the OpenAI Decisions shape. It carries the
same text, with the moves as a list:

```json
{
  "model": "gpt-6-luna",
  "input": "A race on three train-track lanes, ...",
  "questions": [
    {
      "type": "choice",
      "name": "move",
      "instructions": "Choose this runner's next move. ...",
      "choices": [
        { "value": "left", "description": "move one lane to the left" },
        { "value": "jump", "description": "jump: clears low barriers and buffer stops" }
      ]
    }
  ]
}
```

(The example lists two of the five choices; every request sends all five.)

Each model answers with its choice and a probability for each move. The
decision panel shows both, with the model's latency and decisions per second.
An answer that isn't one of the five moves, or whose probabilities don't add
up, is shown as an error, and the runner asks again half a second later.

### Check it yourself

- `src/decision_arena/web/src/race/models.js`, `see()`: what the page reports
  a runner sees.
- `src/decision_arena/models.py`, `question()`: how that becomes the text
  above.
- `src/decision_arena/apis.py`: the requests sent to each API.
- `uv run pytest`: runs the tests, with recorded answers and no keys.

## Add your own model

A model is a class with a `name` and an async `decide` method that turns a
`Question` into an `Answer`:

```python
from decision_arena.models import Answer, Question


class AlwaysJump:
    name = "Jumper"

    async def decide(self, question: Question) -> Answer:
        # question.state is the text above, question.options the five described moves
        return Answer("jump", {"left": 0, "right": 0, "jump": 1, "roll": 0, "keep": 0})
```

Add it to `PLAYERS` in `src/decision_arena/server.py`, under the name you want
to type:

```python
PLAYERS = {
    ...,
    "jumper": AlwaysJump,
}
```

Then race it: `uv run decision-arena --players jumper,jev`.

If your model already serves the System One or OpenAI Decisions shape over
HTTP, you don't need a class: add a function to `apis.py` like the ones there.

```python
def mine() -> DecisionAPI:
    return _api("Mine", "https://example.com/v1/decisions", "my-model", "MY_API_KEY", "openai")
```

## More

[docs/decisions.md](docs/decisions.md) records how the game and the race are
designed, and why. The game is built on the Rail Dash runner engine, in the
browser with three.js. MIT licensed.
