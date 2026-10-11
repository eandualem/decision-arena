import json

from starlette.testclient import TestClient

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
    client = TestClient(app([fake, None]))
    assert client.get("/players.json").json() == [{"name": "Fake"}, {"name": None}]
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "ask", "seat": 0, "seq": 7, "seen": seen}))
        reply = json.loads(ws.receive_text())
    assert reply["type"] == "move" and reply["move"] == "roll" and reply["seq"] == 7
    assert reply["probabilities"]["roll"] == 0.9 and isinstance(reply["ms"], int)
    assert "middle lane" in fake.asked[0].state


def test_a_failed_answer_is_reported_to_the_runner(seen):
    client = TestClient(app([Broken()]))
    with client.websocket_connect("/ws") as ws:
        ws.send_text(json.dumps({"type": "ask", "seat": 0, "seq": 1, "seen": seen}))
        reply = json.loads(ws.receive_text())
    assert reply == reply | {"type": "error", "seat": 0, "seq": 1, "error": "HTTP 500: inference failed"}
