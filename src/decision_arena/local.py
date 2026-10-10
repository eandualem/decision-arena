"""Laya: an open-weight decision model from Convai Innovations, run on this computer.

Its engine is the `laya` package with its server extra, installed once with
`uv tool install 'laya[serve]'` (about 750 MB including PyTorch). Choosing Laya starts
that installation's server on 127.0.0.1, as Entune does, and it ends when this program
ends. The first start downloads its English model, about 850 MB. The server answers the
same System One questions as Jev.
"""

from __future__ import annotations

import os
import secrets
import shutil
import socket
import subprocess
import tempfile
import time
from pathlib import Path

import httpx

from decision_arena.apis import DecisionAPI, MissingKey

INSTALL = "uv tool install 'laya[serve]'"
# The server exits when this program closes the pipe, or exits for any reason.
LAUNCH = (
    "import os, sys, threading\n"
    "threading.Thread(target=lambda: (sys.stdin.read(), os._exit(0)), daemon=True).start()\n"
    "from laya.serve import main\n"
    "main()\n"
)
# The first answer pays the warm-up; a game's first tick should not.
WARM_UP = {
    "model": "laya",
    "state": "Decision Arena is starting.",
    "questions": {
        "warm_up": {
            "type": "choice",
            "instructions": "Is this a test?",
            "criteria": {"yes": None, "no": None},
        }
    },
}


def engine_python() -> Path | None:
    """The Python of the `laya` tool installation, or None when there is none."""
    roots = [Path(os.environ["UV_TOOL_DIR"])] if os.environ.get("UV_TOOL_DIR") else []
    roots.append(Path.home() / ".local" / "share" / "uv" / "tools")
    for root in roots:
        python = root / "laya" / "bin" / "python"
        if python.exists():
            return python
    found = shutil.which("laya-serve")
    if found and (python := Path(found).resolve().parent / "python").exists():
        return python
    return None


def laya(ready_seconds: float = 1800.0) -> DecisionAPI:
    """Start Laya's server, wait until it has answered once, and return it as a player."""
    python = engine_python()
    if python is None:
        raise MissingKey(f"Laya needs its engine. Install it with: {INSTALL}")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    token = secrets.token_urlsafe(32)  # without it, any page in a browser could ask
    log_path = Path(tempfile.gettempdir()) / "decision-arena-laya.log"
    env = {
        **os.environ,
        "LAYA_HOST": "127.0.0.1",
        "LAYA_PORT": str(port),
        "LAYA_MODELS": "english",
        "LAYA_PRELOAD": "1",
        "LAYA_LOG_LEVEL": "warning",
        "LAYA_API_KEY": token,
        "HF_HUB_DISABLE_TELEMETRY": "1",
    }
    print("Starting Laya (its first start downloads about 850 MB)…", flush=True)
    with log_path.open("wb") as log:
        process = subprocess.Popen(
            [str(python), "-c", LAUNCH],
            stdin=subprocess.PIPE,
            stdout=log,
            stderr=subprocess.STDOUT,
            env=env,
        )
    url = f"http://127.0.0.1:{port}"
    deadline = time.monotonic() + ready_seconds
    with httpx.Client(timeout=5.0, trust_env=False) as http:
        while True:
            if process.poll() is not None:
                raise MissingKey(f"Laya stopped while starting; see {log_path}")
            if time.monotonic() > deadline:
                process.kill()
                raise MissingKey(f"Laya did not start in time; see {log_path}")
            try:
                if http.get(f"{url}/health").json().get("status") == "ok":
                    break
            except (httpx.HTTPError, ValueError, AttributeError):
                pass
            time.sleep(0.5)
        try:
            warm = http.post(
                f"{url}/v1/systemone",
                json=WARM_UP,
                headers={"Authorization": f"Bearer {token}"},
                timeout=60.0,
            )
            warm.raise_for_status()
        except httpx.HTTPError as exc:
            process.kill()
            raise MissingKey(f"Laya started but could not answer ({exc}); see {log_path}") from exc
    model = DecisionAPI("Laya", f"{url}/v1/systemone", "laya", token, local=True)
    model.process = process  # held so the pipe, and so the server, lives as long as we do
    return model
