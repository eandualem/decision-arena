"""Decision models: one async method that turns a question into a move.

To add your own, write a class with a `name` and an async `decide(question)` that
returns an `Answer`, and add it to `PLAYERS` in server.py.

The page sends what a runner sees (see `question`); this module turns it into the text
and the five described options a decision model is asked.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Protocol

MOVES = ("left", "right", "jump", "roll", "keep")

# The timing windows are the game's own: measured by stepping its physics (gameplay/physics.js)
# at 14, 20 and 28 m/s; they hardly change with speed.
INSTRUCTIONS = (
    "Choose this runner's next move. Crashing into a barrier or the front of a train "
    "knocks it down and costs ground; the ground breaking away behind it ends its race. "
    "Your move is made when your answer arrives, so allow for your answer time. "
    "A lane change takes 0.13 s. A jump lasts 0.61 s and clears a low barrier you reach "
    "0.10 to 0.55 s after jumping, or a buffer stop you reach 0.14 to 0.50 s after: jump "
    "too early and you land before it. A roll gets you under a high barrier you reach within "
    "0.64 s of rolling: roll too early and you stand up before it. Trains are too high to "
    "jump onto except up a ramp. Running into another runner's back trips you, changing "
    "lanes into one bounces you back, and jumping takes you over one."
)

LANES = {-1: "left", 0: "middle", 1: "right"}

# What each obstacle is, and what gets a runner past it.
KINDS = {
    "barrierJump": "a low barrier (jump over it)",
    "barrierRoll": "a high barrier (roll under it)",
    "bumper": "a buffer stop (jump over it)",
    "ramp": "a ramp up onto a train roof (run up it)",
}


@dataclass(frozen=True)
class Question:
    state: str
    options: dict[str, str]
    instructions: str = INSTRUCTIONS


@dataclass(frozen=True)
class Answer:
    move: str  # one of MOVES
    probabilities: dict[str, float]  # each move's probability, as the model gave them


class Model(Protocol):
    name: str

    async def decide(self, question: Question) -> Answer: ...


def question(seen: dict[str, Any]) -> Question:
    """The question for one runner, from what the page says it sees (race/models.js see()):

    lane (-1, 0, 1), doing (list of what it is doing), roof (on a train roof), speed (m/s),
    answer (its model's recent answer time in seconds, or None before its first), last (its
    last move, or None), place, of, others (every other runner still racing: {name, gap
    (metres, ahead is positive), lane, down}), edge (metres behind) and edgeSpeed (m/s),
    lanes (three lists, left to right, of {kind, at, length, moving, speed}).
    """
    lane = int(seen["lane"])
    speed = float(seen["speed"])
    answer = seen.get("answer")
    doing = ", ".join(seen.get("doing") or ["running"])
    parts = [
        "A race on three train-track lanes, left, middle and right, all running forward.",
        f"You are in the {LANES[lane]} lane, {doing}, at {speed:.0f} m/s.",
    ]
    if answer is not None:
        parts.append(
            f"Your answers take about {answer:.2f} s, so your move is made about "
            f"{answer * speed:.0f} m further on."
        )
    if seen.get("last"):
        parts.append(f"Your last move was {seen['last']}.")
    parts.append(f"You are {_ordinal(int(seen['place']))} of {int(seen['of'])}.")
    for other in seen.get("others") or []:
        gap = float(other["gap"])
        where = (
            "level with you" if abs(gap) < 1
            else f"{abs(gap):.0f} m {'ahead of' if gap > 0 else 'behind'} you"
        )
        down = ", down after a crash" if other.get("down") else ""
        parts.append(f"{other['name']} is {where} in the {LANES[int(other['lane'])]} lane{down}.")
    edge, edge_speed = float(seen["edge"]), float(seen.get("edgeSpeed") or 0)
    closing = edge_speed - speed
    pace = (
        f", gaining {closing:.0f} m/s on you" if closing >= 0.5
        else ", and you are pulling away from it" if closing <= -0.5 else ""
    )
    parts.append(f"The ground is breaking away {edge:.0f} m behind you{pace}.")
    order = [lane, *(other for other in (-1, 0, 1) if other != lane)]
    for i in order:
        name = f"Your lane ({LANES[i]})" if i == lane else f"{LANES[i].capitalize()} lane"
        mine = i == lane and bool(seen.get("roof"))
        parts.append(f"{name}: {_lane(seen['lanes'][i + 1], speed, answer, mine)}.")
    options = {
        "left": "move one lane to the left"
        + (" (you are already in the left lane: nothing happens)" if lane == -1 else ""),
        "right": "move one lane to the right"
        + (" (you are already in the right lane: nothing happens)" if lane == 1 else ""),
        "jump": "jump: clears low barriers and buffer stops",
        "roll": "roll: slides under high barriers",
        "keep": "keep going as you are",
    }
    return Question(" ".join(parts), options)


def _lane(things: list[dict[str, Any]], speed: float, answer: float | None, on_roof: bool) -> str:
    """One lane, nearest first. `on_roof`: this is the runner's lane and it is on a roof, so
    a train beside it is the one under it."""
    if not things:
        return "clear for 60 m"
    said = []
    for t in things:
        at, length = float(t["at"]), float(t["length"])
        closing = speed + (float(t["speed"]) if t.get("moving") else 0)  # m/s it nears you at
        train = t["kind"] == "train"
        if at <= 0:  # beside (or under) you: say how far it goes on
            left = length + at
            where = f"{'under' if on_roof else 'beside'} you for another {left:.0f} m"
            if closing >= 1:
                where += f" ({left / closing:.2f} s)"
        else:
            where = f"{at:.0f} m ahead"
            if closing >= 1:
                reached = at / closing
                where += f", reached in {reached:.2f} s"
                if answer is not None:
                    after = reached - answer
                    where += (
                        f" ({after:.2f} s after your answer)" if after >= 0
                        else " (before your answer arrives)"
                    )
        if train:
            what = (
                f"a train coming at you at {float(t['speed']):.0f} m/s, {length:.0f} m long"
                if t.get("moving") else f"a standing train, {length:.0f} m long"
            )
            said.append(f"{what}, {where}")
        else:
            said.append(f"{KINDS.get(t['kind'], 'an obstacle')} {where}")
    return "; then ".join(said)


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
