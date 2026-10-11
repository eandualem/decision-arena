"""The command: serve the race page on this computer and open it in the browser."""

from __future__ import annotations

import argparse
import contextlib
import threading
import time
import webbrowser
from pathlib import Path

import uvicorn
from starlette.applications import Starlette
from starlette.routing import Mount
from starlette.staticfiles import StaticFiles

WEB = Path(__file__).parent / "web"


def app() -> Starlette:
    return Starlette(routes=[Mount("/", StaticFiles(directory=WEB, html=True))])


def main(argv: list[str] | None = None) -> None:
    parser = argparse.ArgumentParser(
        prog="decision-arena", description="Decision models race each other in a 3D runner game."
    )
    parser.add_argument("--runners", type=int, default=4, help="two to six runners (default 4)")
    parser.add_argument("--port", type=int, default=8000)
    parser.add_argument("--no-browser", action="store_true", help="don't open the page")
    args = parser.parse_args(argv)
    if not 2 <= args.runners <= 6:
        parser.error("--runners takes 2 to 6")
    url = f"http://127.0.0.1:{args.port}/?runners={args.runners}"
    print(f"Decision Arena at {url}", flush=True)
    server = uvicorn.Server(
        uvicorn.Config(app(), host="127.0.0.1", port=args.port, log_level="warning")
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
