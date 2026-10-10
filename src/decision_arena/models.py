"""Decision models: one async method that turns a question into a move.

To add your own, write a class with a `name` and an async `decide(question)` that
returns an `Answer`, and register it in `MODELS` in server.py.
"""

from __future__ import annotations

import random
from dataclasses import dataclass
from typing import Protocol

from decision_arena.game import MOVES, Question


@dataclass(frozen=True)
class Answer:
    move: str  # left, straight or right
    probabilities: dict[str, float]  # each move's probability, as the model gave them


class Model(Protocol):
    name: str

    async def decide(self, question: Question) -> Answer: ...


class Greedy:
    """No model: the move with the most free cells, ties broken at random. A baseline to
    beat, and the way to run the demo with no keys."""

    name = "Greedy"

    def __init__(self, seed: int | None = None) -> None:
        self._random = random.Random(seed)

    async def decide(self, question: Question) -> Answer:
        most = max(question.free.values())
        move = self._random.choice([m for m in MOVES if question.free[m] == most])
        return Answer(move, {m: float(m == move) for m in MOVES})

