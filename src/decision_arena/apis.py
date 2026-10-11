"""Decision models behind an HTTP API: Jev at TypeSafe, and OpenAI's and Perplexity's
Decisions APIs.

They take the request shape Entune uses (TypeSafe's System One API): a shared `state`,
and named choice questions whose options are described in text. OpenAI takes the same
question as a list. Each answers with a choice and a probability for every option.
There are no retries: the runner asks again.
"""

from __future__ import annotations

import math
import os
import re
from typing import Any

import httpx

from decision_arena.models import MOVES, Answer, Question

QUESTION = "move"  # the one question asked each time


class MissingKey(Exception):
    """The model's API key is not in the environment."""


class DecisionAPI:
    def __init__(
        self,
        name: str,
        url: str,
        model: str,
        key: str,
        shape: str = "systemone",  # or "openai"
        transport: httpx.AsyncBaseTransport | None = None,
        local: bool = False,  # on this computer: reached directly, never through a proxy
    ) -> None:
        self.name, self._url, self._model, self._shape = name, url, model, shape
        self._key = key
        self._http = httpx.AsyncClient(
            transport=transport,
            headers={"Authorization": f"Bearer {key}"},
            timeout=5.0,  # as Entune: a slower answer is too late to matter
            trust_env=not local,
        )

    async def decide(self, question: Question) -> Answer:
        response = await self._http.post(self._url, json=self._request(question))
        if not response.is_success:
            raise RuntimeError(f"HTTP {response.status_code}: {_detail(response, self._key)}")
        return _answer(response.json(), self._shape)

    def _request(self, question: Question) -> dict[str, Any]:
        if self._shape == "openai":
            return {
                "model": self._model,
                "input": question.state,
                "questions": [
                    {
                        "type": "choice",
                        "name": QUESTION,
                        "instructions": question.instructions,
                        "choices": [
                            {"value": move, "description": text}
                            for move, text in question.options.items()
                        ],
                    }
                ],
            }
        return {
            "model": self._model,
            "state": question.state,
            "questions": {
                QUESTION: {
                    "type": "choice",
                    "instructions": question.instructions,
                    "criteria": question.options,
                }
            },
        }


def _detail(response: httpx.Response, key: str) -> str:
    """What went wrong, short enough to show, with the key and anything like one (a masked
    key an API echoes back) taken out."""
    try:
        error = response.json().get("error")
        text = error.get("message") if isinstance(error, dict) else error
    except (ValueError, AttributeError):
        text = None
    text = str(text or response.text).replace(key, "")
    return re.sub(r"\b[a-z]{2,8}-[\w*-]{6,}", "[key]", text).strip()[:120]


def _answer(data: Any, shape: str) -> Answer:
    """The validated choice and probabilities. Jev rounds each probability to two
    decimals, so five can sum to 0.98, as Entune allows; anything unusable raises, and the
    runner asks again."""
    answers = data.get("answers") if isinstance(data, dict) else None
    if shape == "openai" and isinstance(answers, list):
        answers = {
            a.get("name"): {
                "choice": a.get("choice"),
                "probabilities": {
                    p.get("value"): p.get("probability")
                    for p in a.get("probabilities") or []
                    if isinstance(p, dict)
                },
            }
            for a in answers
            if isinstance(a, dict)
        }
    answer = answers.get(QUESTION) if isinstance(answers, dict) else None
    if not isinstance(answer, dict):
        raise ValueError("unusable answer: no answer to the move question")
    probabilities = answer.get("probabilities")
    choice = answer.get("choice")
    if (
        not isinstance(probabilities, dict)
        or set(probabilities) != set(MOVES)
        or not all(
            type(p) in (int, float) and math.isfinite(p) and 0 <= p <= 1
            for p in probabilities.values()
        )
        or not math.isclose(sum(probabilities.values()), 1.0, abs_tol=0.005 * len(MOVES))
        or choice not in MOVES
    ):
        raise ValueError("unusable answer: choice or probabilities malformed")
    return Answer(choice, {m: float(probabilities[m]) for m in MOVES})


def _key(variable: str, name: str) -> str:
    key = os.environ.get(variable, "").strip()
    if not key:
        raise MissingKey(f"{name} needs {variable}: set it in .env or in your shell")
    return key


def jev() -> DecisionAPI:
    return DecisionAPI(
        "Jev",
        "https://api.typesafe.ai/v1/systemone",
        "jev-1.13.0",
        _key("TYPESAFE_API_KEY", "Jev"),
    )


def openai() -> DecisionAPI:
    return DecisionAPI(
        "OpenAI",
        "https://api.openai.com/v1/decisions",
        "gpt-6-luna",
        _key("OPENAI_API_KEY", "OpenAI"),
        shape="openai",
    )


def perplexity() -> DecisionAPI:
    return DecisionAPI(
        "Perplexity",
        "https://api.perplexity.ai/v1/decisions",
        "pplx-decider-v1.1-27b",
        _key("PERPLEXITY_API_KEY", "Perplexity"),
    )
