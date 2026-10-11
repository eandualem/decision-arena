"""The command: serve the race page on this computer, open it in the browser, and ask the
decision models for their runners' moves."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
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

# The players the command knows, by the name you type. "bot" is a seat without a model.
PLAYERS: dict[str, Callable[[], Model]] = {
    "jev": apis.jev,
    "laya": local.laya,
    "openai": apis.openai,
    "perplexity": apis.perplexity,
}


def app(models: list[Model | None] | None = None) -> Starlette:
    """The page, the list of seats, and the socket the page asks its models through.
    `models` has one entry per seat: a model, or None for a bot."""
    seats = models or []

    async def players(_request: Any) -> JSONResponse:
        return JSONResponse([{"name": m.name if m else None} for m in seats])

    async def socket(websocket: WebSocket) -> None:
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
                # one question in flight per runner; anything else is ignored
                if (
                    message.get("type") == "ask"
                    and isinstance(seat, int)
                    and 0 <= seat < len(seats)
                    and seats[seat] is not None
                    and (seat not in asking or asking[seat].done())
                ):
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


def main(argv: list[str] | None = None) -> None:
    load_env()
    parser = argparse.ArgumentParser(
        prog="decision-arena", description="Decision models race each other in a 3D runner game."
    )
    parser.add_argument(
        "--players",
        default="",
        help=f"comma-separated, one per runner: {', '.join(PLAYERS)} or bot (default: all bots)",
    )
    parser.add_argument("--runners", type=int, help="two to six runners (default 4, or one per player)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open the page")
    args = parser.parse_args(argv)
    names = [n.strip().lower() for n in args.players.split(",") if n.strip()]
    runners = args.runners or max(4, len(names))
    if not 2 <= runners <= 6:
        parser.error("--runners takes 2 to 6")
    if len(names) > runners:
        parser.error(f"{len(names)} players need at least {len(names)} runners")
    unknown = [n for n in names if n != "bot" and n not in PLAYERS]
    if unknown:
        parser.error(f"unknown player {unknown[0]!r}: choose from {', '.join(PLAYERS)} or bot")
    try:
        models = [None if n == "bot" else PLAYERS[n]() for n in names]
    except apis.MissingKey as exc:
        parser.error(str(exc))
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
