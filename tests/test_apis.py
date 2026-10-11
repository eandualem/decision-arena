import asyncio
import json

import httpx
import pytest

from conftest import SEEN

from decision_arena import apis
from decision_arena.models import MOVES, question

KEY = "test-key-not-real"


def ask(shape, reply, status=200, seen=None):
    """Ask once through a mock transport; return the answer and the request sent."""
    sent = {}

    def handle(request):
        sent["auth"] = request.headers["authorization"]
        sent["body"] = json.loads(request.content)
        return httpx.Response(status, json=reply)

    model = apis.DecisionAPI("Test", "https://example.test/v1", "m", KEY, shape,
                             httpx.MockTransport(handle))
    return asyncio.run(model.decide(question(seen or SEEN))), sent


SYSTEMONE = {
    "answers": {
        "move": {
            "type": "choice",
            "choice": "right",
            "probabilities": {"left": 0.1, "right": 0.29, "jump": 0.2, "roll": 0.2, "keep": 0.2},
        }
    }
}


def test_systemone_request_and_answer():
    answer, sent = ask("systemone", SYSTEMONE)
    assert sent["auth"] == f"Bearer {KEY}"
    question = sent["body"]["questions"]["move"]
    assert sent["body"]["model"] == "m" and "middle lane" in sent["body"]["state"]
    assert question["type"] == "choice" and tuple(question["criteria"]) == MOVES
    assert answer.move == "right"  # probabilities summing to 0.99 are accepted
    assert answer.probabilities["right"] == 0.29


def test_openai_request_and_answer():
    reply = {
        "answers": [
            {
                "name": "move",
                "type": "choice",
                "choice": "left",
                "probabilities": [
                    {"value": m, "probability": p}
                    for m, p in zip(MOVES, (0.7, 0.1, 0.1, 0.05, 0.05), strict=True)
                ],
            }
        ]
    }
    answer, sent = ask("openai", reply)
    assert "middle lane" in sent["body"]["input"]
    assert tuple(c["value"] for c in sent["body"]["questions"][0]["choices"]) == MOVES
    assert answer.move == "left" and answer.probabilities["left"] == 0.7


def test_malformed_answer_raises_so_the_runner_asks_again():
    bad = {"answers": {"move": {"choice": "up", "probabilities": {"left": 1.0}}}}
    with pytest.raises(ValueError):
        ask("systemone", bad)


def test_an_error_never_echoes_the_key():
    with pytest.raises(RuntimeError) as error:
        ask("systemone", {"error": f"invalid api key {KEY}"}, status=401)
    assert KEY not in str(error.value) and "HTTP 401" in str(error.value)


def test_an_echoed_masked_key_is_taken_out():
    reply = {"error": {"message": "Incorrect API key provided: sk-proj-****abcd. Check it."}}
    with pytest.raises(RuntimeError) as error:
        ask("openai", reply, status=401)
    assert str(error.value) == "HTTP 401: Incorrect API key provided: [key]. Check it."


def test_missing_key_names_the_variable(monkeypatch):
    monkeypatch.delenv("TYPESAFE_API_KEY", raising=False)
    with pytest.raises(apis.MissingKey, match="TYPESAFE_API_KEY"):
        apis.jev()
