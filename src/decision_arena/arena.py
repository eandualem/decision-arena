"""Running matches: the clock, the questions each tick and the series tally."""

from __future__ import annotations

import asyncio
import logging
import statistics
import time
from collections.abc import Awaitable, Callable
from dataclasses import dataclass, field
from typing import Any

from decision_arena.game import Game, Question
from decision_arena.models import Answer, Model

log = logging.getLogger(__name__)
Emit = Callable[[dict[str, Any]], Awaitable[None]]


@dataclass
class Settings:
    width: int = 24
    height: int = 18
    tick: float = 0.2  # seconds
    clock: bool = True  # False: every tick waits for every model
    games: int = 5  # best of
    pause: float = 2.0  # seconds between games


@dataclass
class Seat:
    """One model's place in a series, with what the decision panel shows."""

    model: Model
    name: str
    wins: int = 0
    asked: int = 0
    missed: int = 0
    latencies: list[float] = field(default_factory=list)  # seconds, answers that arrived

    def panel(self) -> dict[str, Any]:
        return {
            "name": self.name,
            "wins": self.wins,
            "asked": self.asked,
            "missed": self.missed,
            "medianMs": round(statistics.median(self.latencies) * 1000)
            if self.latencies
            else None,
        }


def seats(models: list[Model]) -> list[Seat]:
    """Number repeated names, so two Greedy players read Greedy 1 and Greedy 2."""
    names = [m.name for m in models]
    seen: dict[str, int] = {}
    out = []
    for model in models:
        name = model.name
        if names.count(name) > 1:
            seen[name] = seen.get(name, 0) + 1
            name = f"{name} {seen[name]}"
        out.append(Seat(model, name))
    return out


async def _timed(model: Model, question: Question) -> tuple[Answer, float]:
    started = time.monotonic()
    answer = await model.decide(question)
    return answer, time.monotonic() - started


async def play(game: Game, players: list[Seat], settings: Settings, emit: Emit, number: int) -> None:
    """One game. Each tick every live cycle is asked at once about the same snapshot; an
    answer missing at the end of the tick, late or failed, keeps the cycle straight."""
    loop = asyncio.get_running_loop()
    await emit(_frame(game, players, settings, number, [None] * len(players), []))
    while not game.over:
        started = loop.time()
        tasks = {
            i: asyncio.create_task(_timed(players[i].model, game.question(i)))
            for i, cycle in enumerate(game.cycles)
            if cycle.alive
        }
        _, pending = await asyncio.wait(
            tasks.values(), timeout=settings.tick if settings.clock else None
        )
        for task in pending:
            # Cancelled, not awaited: a model's cleanup never holds up the tick.
            task.add_done_callback(_discard)
            task.cancel()
        moves, decisions = ["straight"] * len(players), [None] * len(players)
        for i, task in tasks.items():
            seat = players[i]
            seat.asked += 1
            answer = None
            if task not in pending:
                try:
                    answer, latency = task.result()
                except Exception as exc:  # a failed answer is a missed tick, never a crash
                    log.warning("%s: %s", seat.name, exc)
            if answer is None or answer.move not in ("left", "straight", "right"):
                seat.missed += 1
                decisions[i] = {"move": "straight", "missed": True}
                continue
            seat.latencies.append(latency)
            moves[i] = answer.move
            decisions[i] = {
                "move": answer.move,
                "probabilities": answer.probabilities,
                "latencyMs": round(latency * 1000),
                "missed": False,
            }
        # Moves land on the tick boundary, however early the answers came.
        await asyncio.sleep(max(0.0, started + settings.tick - loop.time()))
        crashed = game.step(moves)
        if game.over and game.winner is not None:
            players[game.winner].wins += 1
        await emit(_frame(game, players, settings, number, decisions, crashed))


def _discard(task: asyncio.Task[Any]) -> None:
    if not task.cancelled():
        task.exception()  # retrieved, so a late failure is not reported as unhandled


async def series(models: list[Model], settings: Settings, emit: Emit) -> list[Seat]:
    """Best of `games`: stop once no one can catch the leader. Starts rotate each game."""
    players = seats(models)
    for number in range(settings.games):
        game = Game(settings.width, settings.height, len(players), rotation=number)
        await play(game, players, settings, emit, number)
        wins = sorted((p.wins for p in players), reverse=True)
        if wins[0] > wins[1] + settings.games - number - 1:
            break
        await asyncio.sleep(settings.pause)
    await emit({"type": "series", "players": [p.panel() for p in players]})
    return players


def _frame(
    game: Game,
    players: list[Seat],
    settings: Settings,
    number: int,
    decisions: list[dict[str, Any] | None],
    crashed: list[int],
) -> dict[str, Any]:
    return {
        "type": "frame",
        "game": number + 1,
        "games": settings.games,
        "tick": game.tick,
        "tickMs": round(settings.tick * 1000),
        "clock": settings.clock,
        "width": game.width,
        "height": game.height,
        "cycles": [
            {"trail": c.trail, "heading": c.heading, "alive": c.alive} for c in game.cycles
        ],
        "players": [p.panel() for p in players],
        "decisions": decisions,
        "crashed": crashed,
        "over": game.over,
        "winner": game.winner,
    }
