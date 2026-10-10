# Decisions

Stack and design choices for Decision Arena, with the reason for each and the
alternative it replaced. Newest last.

## 1. Python server, browser canvas

**Choice.** A small Python program runs the game and talks to the models. It
serves one web page that draws the game on a canvas. Start everything with one
command:

```bash
uv run decision-arena
```

It opens the page at `http://127.0.0.1:8000`.

- **Python 3.12+ with [uv](https://docs.astral.sh/uv/).** The decision models
  this demo starts with are reached the way
  [Entune](https://github.com/eandualem/entune) reaches them, over HTTP with
  [httpx](https://www.python-httpx.org/). Laya, the local model, is itself a
  Python server (`uv tool install 'laya[serve]'`).
- **[Starlette](https://www.starlette.io/) and
  [Uvicorn](https://www.uvicorn.org/)** serve the page and one WebSocket.
- **The page is plain HTML and JavaScript**, with no build step. The server
  sends each tick's state; the page draws it and animates between ticks.

**Why.** API keys stay in the server's environment and never reach the
browser. The game runs in one process on one clock, so every model sees the
same moment. A canvas makes glowing trails and smooth motion easy.

**Rejected.** A browser-only game would need the API keys in the browser and
could not start Laya. A Node server would duplicate a request code path that
already exists and works in Python.

## 2. The server owns the clock

**Choice.** The game advances on a fixed tick, 200 ms by default and set with
`--tick`. At the start of each tick the server sends the same snapshot to
every model at once. A model's answer counts for the next move only if it
arrives before the tick ends. A late or failed answer counts as "keep
straight" and is shown as a missed tick. With `--no-clock`, each tick waits
for every model to answer.

**Why.** The same snapshot at the same moment is the fairness rule. Running
the same match with and without the clock separates how well a model decides
from how fast.

## 3. What a model is asked

**Choice.** Each tick asks one question with three options: `left`,
`straight` and `right`, relative to the cycle's heading. The state is a small
text map of the cells around the cycle, turned so that the cycle always faces
up, so left on the map is the model's left. Each option says what lies that
way: how many free cells there are before a wall or trail.

**Why.** The map keeps the input short; Laya reads about 512 tokens. Turning
the map removes the most common source of wrong turns, mixing up compass
directions with left and right. The option text states facts and never
recommends a move, so the choice is the model's.

## 4. Adding a model

**Choice.** A model is a Python class with a name and one async method:
given the question, return the chosen move and the probability of each
option. Included adapters:

| Model | Runs | Needs |
|---|---|---|
| Jev | TypeSafe cloud | `TYPESAFE_API_KEY` |
| Laya | this computer | `uv tool install 'laya[serve]'` |
| OpenAI Decisions API (`gpt-6-luna`) | OpenAI cloud | `OPENAI_API_KEY` |
| Perplexity Decisions API (`pplx-decider-v1.1-27b`) | Perplexity cloud | `PERPLEXITY_API_KEY` |
| Greedy | this computer, no model | nothing |

Greedy takes the direction with the most free cells. It is a baseline to beat,
and it makes the demo run with no keys at all.

**Why.** Jev, Laya, OpenAI and Perplexity share one request shape, so their
adapters share one client. A model with a different API, such as a chat model,
needs only its own adapter.

Keys come only from the environment. They are never written to logs or shown
on the page.

## 5. Tests use recorded answers

**Choice.** Tests run the game with fake models and replay recorded API
answers through an httpx mock transport. They make no network calls.

**Why.** Tests stay fast, free and repeatable. A live match against a paid
API is a manual run.
