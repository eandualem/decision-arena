import asyncio
import json

import httpx
import pytest

from decision_arena import apis
from decision_arena.game import Game

KEY = "test-key-not-real"


def ask(shape, reply, status=200):
    """Ask once through a mock transport; return the answer and the request sent."""
    sent = {}

    def handle(request):
        sent["auth"] = request.headers["authorization"]
        sent["body"] = json.loads(request.content)
        return httpx.Response(status, json=reply)

    model = apis.DecisionAPI("Test", "https://example.test/v1", "m", KEY, shape,
                             httpx.MockTransport(handle))
    question = Game(24, 18, 2).question(0)
    return asyncio.run(model.decide(question)), sent


SYSTEMONE = {
    "answers": {
        "move": {
            "type": "choice",
            "choice": "right",
            "probabilities": {"left": 0.1, "straight": 0.2, "right": 0.69},
        }
    }
}


def test_systemone_request_and_answer():
    answer, sent = ask("systemone", SYSTEMONE)
    assert sent["auth"] == f"Bearer {KEY}"
    question = sent["body"]["questions"]["move"]
    assert sent["body"]["model"] == "m" and "^" in sent["body"]["state"]
    assert question["type"] == "choice" and set(question["criteria"]) == {
        "left", "straight", "right"
    }
    assert answer.move == "right"  # probabilities summing to 0.99 are accepted
    assert answer.probabilities == {"left": 0.1, "straight": 0.2, "right": 0.69}


def test_openai_request_and_answer():
    reply = {
        "answers": [
            {
                "name": "move",
                "type": "choice",
                "choice": "left",
                "probabilities": [
                    {"value": "left", "probability": 0.7},
                    {"value": "straight", "probability": 0.2},
                    {"value": "right", "probability": 0.1},
                ],
            }
        ]
    }
    answer, sent = ask("openai", reply)
    assert "^" in sent["body"]["input"]
    assert [c["value"] for c in sent["body"]["questions"][0]["choices"]] == [
        "left", "straight", "right"
    ]
    assert answer.move == "left" and answer.probabilities["left"] == 0.7


def test_malformed_answer_raises_so_the_tick_is_missed():
    bad = {"answers": {"move": {"choice": "up", "probabilities": {"left": 1.0}}}}
    with pytest.raises(ValueError):
        ask("systemone", bad)


def test_an_error_never_echoes_the_key():
    with pytest.raises(RuntimeError) as error:
        ask("systemone", {"error": f"invalid api key {KEY}"}, status=401)
    assert KEY not in str(error.value) and "HTTP 401" in str(error.value)


def test_missing_key_names_the_variable(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(apis.MissingKey, match="TYPESAFE_API_KEY"):
        apis.jev()
