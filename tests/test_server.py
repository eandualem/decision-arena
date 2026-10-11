import asyncio
import json

import pytest
from starlette.testclient import TestClient
from starlette.websockets import WebSocketDisconnect

from decision_arena.models import Answer
from decision_arena.server import app


class Fake:
    """A model that always rolls, and remembers what it was asked."""

    name = "Fake"

    def __init__(self):
        self.asked = []

    async def decide(self, question):
        self.asked.append(question)
        return Answer("roll", {"left": 0, "right": 0, "jump": 0.1, "roll": 0.9, "keep": 0})


class Slow:
    """Answers its first question only after a long wait, every later one at once."""

    name = "Slow"

    def __init__(self):
        self.calls = 0

    async def decide(self, question):
        self.calls += 1
        if self.calls == 1:
            await asyncio.sleep(30)
        return Answer("jump", {"left": 0, "right": 0, "jump": 1.0, "roll": 0, "keep": 0})


HERE = {"host": "127.0.0.1:8000", "origin": "http://127.0.0.1:8000"}  # the page, on this computer


def local(models):
    return TestClient(app(models))


class Broken:
    name = "Broken"

    async def decide(self, question):
        raise RuntimeError("HTTP 500: inference failed")


def test_serves_the_race_page_and_its_modules():
    client = TestClient(app())
    page = client.get("/")
    assert page.status_code == 200 and "src/race/main.js" in page.text
    assert client.get("/src/race/main.js").status_code == 200
    assert client.get("/vendor/three/three.module.js").status_code == 200
    assert client.get("/players.json").json() == []


def test_a_model_seat_answers_the_question_its_runner_asks(seen):
    fake = Fake()
    client = local([fake, None])
    assert client.get("/players.json").json() == [
        {"name": "Fake", "image": False},
        {"name": None, "image": False},
    ]
    with client.websocket_connect("/ws", headers=HERE) as ws:
        ws.send_text(json.dumps({"type": "ask", "seat": 0, "seq": 7, "seen": seen}))
        reply = json.loads(ws.receive_text())
    assert reply["type"] == "move" and reply["move"] == "roll" and reply["seq"] == 7
    assert reply["probabilities"]["roll"] == 0.9 and isinstance(reply["ms"], int)
    assert "middle lane" in fake.asked[0].state


def test_a_failed_answer_is_reported_to_the_runner(seen):
    client = local([Broken()])
    with client.websocket_connect("/ws", headers=HERE) as ws:
        ws.send_text(json.dumps({"type": "ask", "seat": 0, "seq": 1, "seen": seen}))
        reply = json.loads(ws.receive_text())
    assert reply == reply | {"type": "error", "seat": 0, "seq": 1, "error": "HTTP 500: inference failed"}


@pytest.mark.parametrize(
    "headers",
    [
        HERE | {"origin": "https://example.com"},  # another site open in the browser
        {"host": "rebound.example:8000", "origin": "http://rebound.example:8000"},  # a renamed host
    ],
)
def test_only_this_page_on_this_computer_may_ask(headers):
    with pytest.raises(WebSocketDisconnect) as closed:
        with local([Fake()]).websocket_connect("/ws", headers=headers):
            pass
    assert closed.value.code == 1008


def test_a_new_question_replaces_one_still_in_flight(seen):
    with local([Slow()]).websocket_connect("/ws", headers=HERE) as ws:
        ws.send_text(json.dumps({"type": "ask", "seat": 0, "seq": 1, "seen": seen}))
        ws.send_text(json.dumps({"type": "ask", "seat": 0, "seq": 2, "seen": seen}))
        reply = json.loads(ws.receive_text())
    assert reply["seq"] == 2 and reply["move"] == "jump"


class Rejected:
    name = "Rejected"
    key_name = "REJECTED_API_KEY"

    async def decide(self, question):
        raise RuntimeError("HTTP 401: Incorrect API key provided: [key]")

    async def aclose(self):
        pass


def test_a_key_that_does_not_work_stops_the_command_and_says_which(monkeypatch, capsys):
    from decision_arena import server

    monkeypatch.setattr(server, "PLAYERS", {"rejected": Rejected, "fine": Fake})
    with pytest.raises(SystemExit):
        server.main(["--players", "rejected,fine", "--no-browser"])
    said = capsys.readouterr().out
    assert "Rejected did not answer (HTTP 401" in said and "Check REJECTED_API_KEY in .env" in said
    assert "Fake" not in said


def test_with_no_model_to_race_it_says_why_bots_race(monkeypatch, capsys):
    from decision_arena import server

    monkeypatch.setattr(server, "available", lambda: [])
    monkeypatch.setattr(server.uvicorn.Server, "run", lambda self: None)
    server.main(["--no-browser"])
    out = capsys.readouterr().out
    assert "No model has a key set, so four built-in bots race." in out
    assert "?runners=4" in out
