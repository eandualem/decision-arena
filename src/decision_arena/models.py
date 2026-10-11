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
    "0.64 s of rolling: roll too early and you stand up before it. Changing lanes into the "
    "side of a train or barrier bounces you back and costs speed. Trains are too high to jump "
    "onto, except with spring shoes; a ramp runs straight up onto its train's roof. On a roof, "
    "ground obstacles pass below you; where the roof ends you drop to the ground, unless the "
    "next roof starts within 3 m. Running into another runner's back trips you, changing "
    "lanes into one bounces you back, and jumping takes you over one."
)

LANES = {-1: "left", 0: "middle", 1: "right"}
RANGE = 100  # metres ahead a runner sees (race/models.js)
SHOWN = 4  # obstacles described per lane, nearest first

# What each obstacle is, and what gets a runner past it.
KINDS = {
    "barrierJump": "a low barrier (jump over it)",
    "barrierRoll": "a high barrier (roll under it)",
    "bumper": "a buffer stop (jump over it)",
}


@dataclass(frozen=True)
class Question:
    state: str
    options: dict[str, str]
    instructions: str = INSTRUCTIONS
    image: str | None = None  # a JPEG data URI of the runner's view, for an image twin


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
    lanes (three lists, left to right, nearest first, of {kind, at, length, moving, speed}),
    and, for an image twin, image (a JPEG data URI of the runner's view).
    """
    lane = int(seen["lane"])
    speed = float(seen["speed"])
    answer = seen.get("answer")
    doing = ", ".join(seen.get("doing") or ["running"])
    parts = ["A race on three train-track lanes, left, middle and right, all running forward."]
    if seen.get("image"):
        parts.append(
            "A picture of your view, from just behind and above you, looking ahead, is attached."
        )
    parts.append(f"You are in the {LANES[lane]} lane, {doing}, at {speed:.0f} m/s.")
    if answer is not None:
        parts.append(
            f"Your answers take about {answer:.2f} s, so your move is made about "
            f"{answer * speed:.0f} m further on."
        )
    if seen.get("last"):
        parts.append(f"Your last move was {seen['last']}.")
    roof = bool(seen.get("roof"))
    for i in [lane, *(other for other in (-1, 0, 1) if other != lane)]:
        name = f"Your lane ({LANES[i]})" if i == lane else f"{LANES[i].capitalize()} lane"
        text = _lane(
            seen["lanes"][i + 1], speed, answer, mine=i == lane, next_to=abs(i - lane) == 1, roof=roof
        )
        parts.append(f"{name}: {text}.")
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
    options = {
        "left": "move one lane to the left"
        + (" (you are already in the left lane: nothing happens)" if lane == -1 else ""),
        "right": "move one lane to the right"
        + (" (you are already in the right lane: nothing happens)" if lane == 1 else ""),
        "jump": "jump: clears low barriers and buffer stops",
        "roll": "roll: slides under high barriers",
        "keep": "keep going as you are",
    }
    return Question(" ".join(parts), options, image=seen.get("image") or None)


def _lane(
    things: list[dict[str, Any]], speed: float, answer: float | None,
    mine: bool, next_to: bool, roof: bool,
) -> str:
    """One lane, nearest first. `mine`: the runner's own lane; `next_to`: one lane change away;
    `roof`: the runner is on a train roof. A ramp and the train it leads onto are one item."""
    if not things:
        return f"clear for {RANGE} m"
    said: list[str] = []
    i = 0
    while i < len(things) and len(said) < SHOWN:
        t = things[i]
        at, length = float(t["at"]), float(t["length"])
        closing = speed + (float(t["speed"]) if t.get("moving") else 0)  # m/s it nears you at
        onto = things[i + 1] if t["kind"] == "ramp" and i + 1 < len(things) else None
        if onto and not (onto["kind"] == "train" and abs(float(onto["at"]) - at - length) < 1):
            onto = None
        if at <= 0:  # beside (or under) you: say how far it goes on
            left = length + at
            where = f"{'under' if mine and (roof or onto) else 'beside'} you"
            where += f", reaching its roof in {left:.0f} m" if onto else f" for another {left:.0f} m"
            if closing >= 1:
                where += f" ({left / closing:.2f} s)"
            if next_to and t["kind"] == "train" and not roof:
                where += ": moving into this lane now bounces you off it"
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
        if onto:
            said.append(
                f"a ramp {where}, up onto a standing train's roof, {float(onto['length']):.0f} m long"
            )
            i += 2
            continue
        if t["kind"] == "train":
            what = (
                f"a train coming at you at {float(t['speed']):.0f} m/s, {length:.0f} m long"
                if t.get("moving") else f"a standing train, {length:.0f} m long"
            )
            said.append(f"{what}, {where}")
        elif t["kind"] == "ramp":  # a ramp whose train is out of sight
            said.append(f"a ramp up onto a train's roof, {where}")
        else:
            below = " (on the ground, below your roof)" if roof else ""
            said.append(f"{KINDS.get(t['kind'], 'an obstacle')} {where}{below}")
        i += 1
    return "; then ".join(said)


def _ordinal(n: int) -> str:
    suffix = "th" if 10 <= n % 100 <= 20 else {1: "st", 2: "nd", 3: "rd"}.get(n % 10, "th")
    return f"{n}{suffix}"
