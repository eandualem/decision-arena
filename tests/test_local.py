import asyncio
import os
import sys

import pytest

from decision_arena import apis, local
from decision_arena.game import Game

# A stand-in for `laya.serve`: answers health checks and System One questions, and
# only with the token it was started with.
FAKE_SERVE = '''
import json, os
from http.server import BaseHTTPRequestHandler, HTTPServer

class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass

    def reply(self, status, body):
        data = json.dumps(body).encode()
        self.send_response(status)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        self.reply(200, {"status": "ok"})

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers["content-length"])))
        if self.headers.get("authorization") != "Bearer " + os.environ["LAYA_API_KEY"]:
            return self.reply(401, {"error": "unauthorized"})
        name = next(iter(body["questions"]))
        options = list(body["questions"][name]["criteria"])
        probabilities = {o: (1.0 if o == options[-1] else 0.0) for o in options}
        self.reply(200, {"answers": {name: {"type": "choice", "choice": options[-1],
                                            "probabilities": probabilities}}})

def main():
    HTTPServer(("127.0.0.1", int(os.environ["LAYA_PORT"])), Handler).serve_forever()
'''


def test_without_the_engine_laya_says_how_to_install(monkeypatch, tmp_path):
    monkeypatch.setenv("UV_TOOL_DIR", str(tmp_path))
    monkeypatch.setattr(local.Path, "home", lambda: tmp_path)
    monkeypatch.setattr(local.shutil, "which", lambda name: None)
    with pytest.raises(apis.MissingKey, match="uv tool install 'laya\\[serve\\]'"):
        local.laya()


def test_laya_starts_its_server_and_answers(monkeypatch, tmp_path):
    engine = tmp_path / "tools" / "laya" / "bin"
    engine.mkdir(parents=True)
    (engine / "python").symlink_to(sys.executable)
    (tmp_path / "pkg" / "laya").mkdir(parents=True)
    (tmp_path / "pkg" / "laya" / "__init__.py").write_text("")
    (tmp_path / "pkg" / "laya" / "serve.py").write_text(FAKE_SERVE)
    monkeypatch.setenv("UV_TOOL_DIR", str(tmp_path / "tools"))
    monkeypatch.setenv("PYTHONPATH", str(tmp_path / "pkg"))

    model = local.laya(ready_seconds=20)
    try:
        answer = asyncio.run(model.decide(Game(24, 18, 2).question(0)))
        assert answer.move == "right" and answer.probabilities["right"] == 1.0
    finally:
        model.process.stdin.close()  # as when the arena exits
        model.process.wait(timeout=5)
    assert model.process.returncode == 0
    assert os.environ.get("LAYA_API_KEY") is None  # the token stays with the server
