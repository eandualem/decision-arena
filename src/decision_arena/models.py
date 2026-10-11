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

INSTRUCTIONS = (
    "Choose this runner's next move. Crashing into a barrier or the front of a train "
    "knocks it down and costs ground; the ground breaking away behind it ends its race. "
    "A lane change takes 0.13 s, a jump about 0.6 s, a roll 0.6 s."
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
    """The question for one runner, from what the page says it sees:

    lane (-1, 0, 1), doing (list of what it is doing), speed (m/s), last (its last move, or
    None), place, of, ahead and behind ({name, gap, lane} or None), edge (metres behind),
    lanes (three lists, left to right, of {kind, at, length, moving, speed}).
    """
    lane = int(seen["lane"])
    doing = ", ".join(seen.get("doing") or ["running"])
    parts = [
        "A race on three train-track lanes, left, middle and right, all running forward.",
        f"You are in the {LANES[lane]} lane, {doing}, at {float(seen['speed']):.0f} m/s.",
    ]
    if seen.get("last"):
        parts.append(f"Your last move was {seen['last']}.")
    parts.append(f"You are {_ordinal(int(seen['place']))} of {int(seen['of'])}.")
    for key, where in (("ahead", "ahead of you"), ("behind", "behind you")):
        other = seen.get(key)
        if other:
            gap = "level with you" if other["gap"] < 1 else f"{other['gap']:.0f} m {where}"
            parts.append(f"{other['name']} is {gap}, in the {LANES[int(other['lane'])]} lane.")
    parts.append(f"The ground is breaking away {seen['edge']:.0f} m behind you.")
    for i, things in enumerate(seen["lanes"]):
        parts.append(f"{LANES[i - 1].capitalize()} lane: {_lane(things)}.")
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


def _lane(things: list[dict[str, Any]]) -> str:
    if not things:
        return "clear for 60 m"
    said = []
    for t in things:
        at = float(t["at"])
        where = "beside you" if at <= 0 else f"in {at:.0f} m"
        if t["kind"] == "train":
            length = f"{float(t['length']):.0f} m long"
            if t.get("moving"):
                said.append(f"a train coming at you at {float(t['speed']):.0f} m/s, {length}, {where}")
            else:
                said.append(f"a standing train, {length}, {where}")
        else:
            said.append(f"{KINDS.get(t['kind'], 'an obstacle')} {where}")
    return ", then ".join(said)


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
