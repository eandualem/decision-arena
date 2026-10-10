import asyncio

from decision_arena.arena import Settings, play, seats, series
from decision_arena.game import Game
from decision_arena.models import Answer, Greedy


class Slow:
    name = "Slow"

    async def decide(self, question):
        await asyncio.sleep(0.2)
        return Answer("left", {"left": 1.0, "straight": 0.0, "right": 0.0})


class Broken:
    name = "Broken"

    async def decide(self, question):
        raise RuntimeError("no answer")


def run(models, settings):
    frames = []

    async def emit(frame):
        frames.append(frame)

    async def go():
        players = seats(models)
        game = Game(settings.width, settings.height, len(players))
        try:
            await asyncio.wait_for(play(game, players, settings, emit, 0), 0.5)
        except TimeoutError:  # a few ticks are enough
            pass
        return players

    return asyncio.run(go()), frames


def test_a_late_answer_is_a_missed_tick_and_keeps_straight():
    players, frames = run([Greedy(0), Slow()], Settings(tick=0.05))
    slow = players[1]
    assert slow.missed == slow.asked > 0
    decision = frames[-1]["decisions"][1]
    assert decision == {"move": "straight", "missed": True}


def test_a_failed_answer_is_a_missed_tick():
    players, _ = run([Greedy(0), Broken()], Settings(tick=0.05))
    assert players[1].missed == players[1].asked > 0


def test_no_clock_waits_for_every_model():
    players, frames = run([Greedy(0), Slow()], Settings(tick=0.05, clock=False))
    assert players[1].missed == 0
    assert frames[-1]["decisions"][1]["move"] == "left"
    assert frames[-1]["decisions"][1]["latencyMs"] >= 200


def test_repeated_names_are_numbered():
    assert [s.name for s in seats([Greedy(), Greedy(), Slow()])] == [
        "Greedy 1",
        "Greedy 2",
        "Slow",
    ]


def test_series_stops_once_the_leader_cannot_be_caught():
    async def emit(frame):
        pass

    settings = Settings(width=8, height=8, tick=0.001, games=3, pause=0)
    players = asyncio.run(series([Greedy(1), Broken()], settings, emit))
    # Broken always keeps straight into the wall; Greedy turns away and wins twice.
    assert [p.wins for p in players] == [2, 0]


class SlowToCancel:
    name = "SlowToCancel"

    async def decide(self, question):
        try:
            await asyncio.sleep(1)
        except asyncio.CancelledError:
            await asyncio.sleep(0.3)  # cleanup after being cancelled
            raise


def test_frames_land_on_tick_boundaries_whatever_the_models_do():
    times = []

    async def go():
        loop = asyncio.get_running_loop()

        async def emit(frame):
            times.append(loop.time())

        players = seats([Greedy(0), SlowToCancel()])
        game = Game(24, 18, 2)
        try:
            await asyncio.wait_for(play(game, players, Settings(tick=0.05), emit, 0), 0.4)
        except TimeoutError:
            pass

    asyncio.run(go())
    gaps = [b - a for a, b in zip(times[1:], times[2:])]  # after the opening frame
    assert len(gaps) >= 4
    assert all(0.04 < gap < 0.08 for gap in gaps)
