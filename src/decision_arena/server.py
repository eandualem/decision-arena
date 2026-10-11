"""The command: serve the race page on this computer, open it in the browser, and ask the
decision models for their runners' moves."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import shutil
import threading
import time
import webbrowser
from collections.abc import Callable
from pathlib import Path
from typing import Any

import uvicorn
from dotenv import load_dotenv
from starlette.applications import Starlette
from starlette.responses import JSONResponse
from starlette.routing import Mount, Route, WebSocketRoute
from starlette.staticfiles import StaticFiles
from starlette.websockets import WebSocket, WebSocketDisconnect

from decision_arena import apis, local
from decision_arena.models import Model, question

WEB = Path(__file__).parent / "web"

# The players the command knows, by the name you type, in the order it seats them when you
# name none. "bot" is a seat without a model.
PLAYERS: dict[str, Callable[[], Model]] = {
    "jev": apis.jev,
    "openai": apis.openai,
    "perplexity": apis.perplexity,
    "laya": local.laya,
    "d1": local.d1,
    "clef": apis.clef,
    "microsoft": apis.microsoft,
    "liquid": apis.liquid,
}

# Models on this computer: each checks itself as it starts, with its own first question.
LOCAL = {
    "laya": lambda: local.engine_python() is not None,
    "d1": lambda: shutil.which("llama-server") is not None,
}

# A question every model is asked once at the start, so a key that does not work stops the
# command before the race rather than a runner during it.
PROBE = {
    "lane": 0, "doing": ["running"], "roof": False, "speed": 10, "answer": None, "last": None,
    "place": 1, "of": 1, "others": [], "edge": 30, "edgeSpeed": 9, "lanes": [[], [], []],
}


def app(models: list[Model | None] | None = None) -> Starlette:
    """The page, the list of seats, and the socket the page asks its models through.
    `models` has one entry per seat: a model, or None for a bot."""
    seats = models or []

    async def players(_request: Any) -> JSONResponse:
        return JSONResponse([{"name": m.name if m else None} for m in seats])

    async def socket(websocket: WebSocket) -> None:
        # Only this page may ask: any other site open in the browser could otherwise spend the
        # models' keys. The host must be this computer too, so a renamed host cannot pass.
        host, origin = websocket.headers.get("host", ""), websocket.headers.get("origin")
        if host.rsplit(":", 1)[0] not in ("127.0.0.1", "localhost") or (
            origin is not None and origin != f"http://{host}"
        ):
            await websocket.close(code=1008)
            return
        await websocket.accept()
        send = asyncio.Lock()
        asking: dict[int, asyncio.Task[None]] = {}

        async def ask(seat: int, seq: int, seen: dict[str, Any]) -> None:
            model = seats[seat]
            assert model is not None
            started = time.perf_counter()
            try:
                answer = await model.decide(question(seen))
                reply = {"type": "move", "move": answer.move, "probabilities": answer.probabilities}
            except Exception as exc:  # the runner shows it and asks again
                reply = {"type": "error", "error": str(exc)[:200] or type(exc).__name__}
            reply |= {"seat": seat, "seq": seq, "ms": round((time.perf_counter() - started) * 1000)}
            with contextlib.suppress(Exception):  # the page may have gone
                async with send:
                    await websocket.send_text(json.dumps(reply))

        try:
            while True:
                message = json.loads(await websocket.receive_text())
                seat = message.get("seat")
                # one question in flight per runner: a new one (a new race's) replaces the last
                if (
                    message.get("type") == "ask"
                    and isinstance(seat, int)
                    and 0 <= seat < len(seats)
                    and seats[seat] is not None
                ):
                    if seat in asking:
                        asking[seat].cancel()
                    asking[seat] = asyncio.create_task(ask(seat, message.get("seq"), message["seen"]))
        except (WebSocketDisconnect, ValueError, KeyError, TypeError):
            pass
        finally:
            for task in asking.values():
                task.cancel()

    return Starlette(
        routes=[
            Route("/players.json", players),
            WebSocketRoute("/ws", socket),
            Mount("/", StaticFiles(directory=WEB, html=True)),
        ]
    )


def load_env() -> None:
    """Read API keys from `.env` in the current folder; a variable already set in the
    shell wins."""
    load_dotenv(Path.cwd() / ".env", override=False)


def available() -> list[str]:
    """The players that can run here: their keys are set, or, on this computer, their
    engine is installed."""
    names = []
    for name, make in PLAYERS.items():
        if name in LOCAL:
            if LOCAL[name]():
                names.append(name)
            continue
        try:
            make()
        except apis.MissingKey:
            continue
        names.append(name)
    return names


async def check(names: list[str]) -> list[str]:
    """Ask each named API model the probe question at once (on its own client, as the race's
    run in another event loop); say what failed for each one that did. Models on this
    computer check themselves as they start."""

    async def one(name: str) -> str | None:
        model = PLAYERS[name]()
        try:
            await model.decide(question(PROBE))
        except Exception as exc:
            where = getattr(model, "key_name", None)
            fix = f" Check {where} in .env, or choose other players." if where else ""
            return f"{model.name} did not answer ({str(exc)[:160]}).{fix}"
        finally:
            if close := getattr(model, "aclose", None):  # not part of a Model: only if it has one
                await close()
        return None

    found = await asyncio.gather(*(one(n) for n in names if n != "bot" and n not in LOCAL))
    return [f for f in found if f]


def main(argv: list[str] | None = None) -> None:
    load_env()
    parser = argparse.ArgumentParser(
        prog="decision-arena", description="Decision models race each other in a 3D runner game."
    )
    parser.add_argument(
        "--players",
        default="",
        help=f"comma-separated, one per runner: {', '.join(PLAYERS)} or bot "
        "(default: every model with its key set, up to six; bots if none)",
    )
    parser.add_argument("--runners", type=int, help="two to six runners (default: one per player)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open the page")
    args = parser.parse_args(argv)
    names = [n.strip().lower() for n in args.players.split(",") if n.strip()] or available()[:6]
    if len(names) == 1:
        names.append("bot")  # a race needs two
    runners = args.runners or len(names) or 4
    if not 2 <= runners <= 6:
        parser.error("--runners takes 2 to 6")
    if len(names) > runners:
        parser.error(f"{len(names)} players need at least {len(names)} runners")
    unknown = [n for n in names if n != "bot" and n not in PLAYERS]
    if unknown:
        parser.error(f"unknown player {unknown[0]!r}: choose from {', '.join(PLAYERS)} or bot")
    try:
        failed = asyncio.run(check(names))
        if failed:
            print("Not starting. " + " ".join(failed), flush=True)
            raise SystemExit(1)
        models = [None if n == "bot" else PLAYERS[n]() for n in names]
    except apis.MissingKey as exc:
        parser.error(str(exc))
    print("Players: " + ", ".join(m.name if m else "bot" for m in models), flush=True)
    models += [None] * (runners - len(models))
    url = f"http://127.0.0.1:{args.port}/?runners={runners}"
    print(f"Decision Arena at {url}", flush=True)
    server = uvicorn.Server(
        uvicorn.Config(app(models), host="127.0.0.1", port=args.port, log_level="warning")
    )
    if not args.no_browser:
        threading.Thread(target=_open_when_listening, args=(server, url), daemon=True).start()
    with contextlib.suppress(KeyboardInterrupt):  # Ctrl+C ends the demo quietly
        server.run()


def _open_when_listening(server: uvicorn.Server, url: str) -> None:
    while not server.started:
        if server.should_exit:
            return
        time.sleep(0.05)
    webbrowser.open(url)
