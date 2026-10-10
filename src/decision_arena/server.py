"""The command: serve the page, run a series when the page asks, stream every tick."""

from __future__ import annotations

import argparse
import asyncio
import contextlib
import json
import logging
import threading
import time
import webbrowser
from importlib.resources import files
from typing import Any

import uvicorn
from starlette.applications import Starlette
from starlette.responses import HTMLResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from decision_arena.arena import Settings, seats, series
from decision_arena.models import MODELS, Model


class Arena:
    """Runs one series at a time and sends its frames to every open page."""

    def __init__(self, models: list[Model], settings: Settings) -> None:
        self.models, self.settings = models, settings
        # Each open page has its own outbox, so a page that stops reading never holds up
        # the game clock; one that falls this far behind stops receiving.
        self.pages: dict[WebSocket, asyncio.Queue[str]] = {}
        self.running: asyncio.Task[Any] | None = None
        self._closing: set[asyncio.Task[Any]] = set()

    def start(self) -> None:
        if self.running is None or self.running.done():
            self.running = asyncio.create_task(series(self.models, self.settings, self.send))

    async def send(self, message: dict[str, Any]) -> None:
        text = json.dumps(message)
        for page, outbox in list(self.pages.items()):
            try:
                outbox.put_nowait(text)
            except asyncio.QueueFull:
                # Closed in the background, so the page says it is disconnected.
                self.pages.pop(page, None)
                closing = asyncio.create_task(_close(page))
                self._closing.add(closing)
                closing.add_done_callback(self._closing.discard)


async def _close(page: WebSocket) -> None:
    with contextlib.suppress(Exception):
        await page.close(code=1013)  # try again later


async def _deliver(page: WebSocket, outbox: asyncio.Queue[str]) -> None:
    with contextlib.suppress(Exception):  # a closed page is cleaned up by its handler
        while True:
            await page.send_text(await outbox.get())


def app(arena: Arena) -> Starlette:
    page = files("decision_arena").joinpath("static/index.html").read_text()

    async def index(_request: Any) -> HTMLResponse:
        return HTMLResponse(page)

    async def socket(websocket: WebSocket) -> None:
        await websocket.accept()
        await websocket.send_text(
            json.dumps(
                {
                    "type": "hello",
                    "players": [s.name for s in seats(arena.models)],
                    "width": arena.settings.width,
                    "height": arena.settings.height,
                }
            )
        )
        outbox: asyncio.Queue[str] = asyncio.Queue(maxsize=32)
        arena.pages[websocket] = outbox
        delivery = asyncio.create_task(_deliver(websocket, outbox))
        try:
            while True:
                if json.loads(await websocket.receive_text()).get("type") == "start":
                    arena.start()
        except WebSocketDisconnect:
            pass
        finally:
            arena.pages.pop(websocket, None)
            delivery.cancel()

    return Starlette(routes=[Route("/", index), WebSocketRoute("/ws", socket)])


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="decision-arena", description="Decision models play a real-time light-cycle game."
    )
    parser.add_argument(
        "models",
        nargs="*",
        default=["greedy", "greedy"],
        help=f"two to four of: {', '.join(sorted(MODELS))} (default: greedy greedy)",
    )
    parser.add_argument("--tick", type=int, default=200, help="milliseconds per tick (default 200)")
    parser.add_argument(
        "--no-clock", action="store_true", help="wait for every model each tick"
    )
    parser.add_argument("--games", type=int, default=5, help="best of N games (default 5)")
    parser.add_argument("--size", default="24x18", help="grid width x height (default 24x18)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open the page")
    args = parser.parse_args(argv)
    if not 2 <= len(args.models) <= 4:
        parser.error("choose two to four players")
    if unknown := sorted(set(args.models) - set(MODELS)):
        parser.error(f"unknown model: {', '.join(unknown)}")
    width, _, height = args.size.partition("x")
    if not (width.isdigit() and height.isdigit() and int(width) >= 8 and int(height) >= 8):
        parser.error("--size takes WIDTHxHEIGHT, each at least 8")
    if not 20 <= args.tick <= 5000 or args.games < 1:
        parser.error("--tick takes 20 to 5000 ms and --games at least 1")
    settings = Settings(
        int(width), int(height), args.tick / 1000, not args.no_clock, args.games
    )
    arena = Arena([MODELS[name]() for name in args.models], settings)
    url = f"http://127.0.0.1:{args.port}"
    logging.basicConfig(level=logging.WARNING, format="%(message)s")
    print(f"Decision Arena at {url}")

    server = uvicorn.Server(
        uvicorn.Config(app(arena), host="127.0.0.1", port=args.port, log_level="warning")
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
