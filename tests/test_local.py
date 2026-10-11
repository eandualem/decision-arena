import asyncio
import os
import sys

import httpx
import pytest

from decision_arena import apis, local
from decision_arena.models import question

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
        if os.environ.get("FAKE_BROKEN"):
            return self.reply(500, {"error": "inference failed"})
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


def fake_engine(monkeypatch, tmp_path):
    engine = tmp_path / "tools" / "laya" / "bin"
    engine.mkdir(parents=True)
    (engine / "python").symlink_to(sys.executable)
    (tmp_path / "pkg" / "laya").mkdir(parents=True)
    (tmp_path / "pkg" / "laya" / "__init__.py").write_text("")
    (tmp_path / "pkg" / "laya" / "serve.py").write_text(FAKE_SERVE)
    monkeypatch.setenv("UV_TOOL_DIR", str(tmp_path / "tools"))
    monkeypatch.setenv("PYTHONPATH", str(tmp_path / "pkg"))


def test_laya_starts_its_server_and_answers(monkeypatch, tmp_path, seen):
    fake_engine(monkeypatch, tmp_path)
    model = local.laya(ready_seconds=20)
    try:
        answer = asyncio.run(model.decide(question(seen)))
        assert answer.move == "keep" and answer.probabilities["keep"] == 1.0
    finally:
        model.process.stdin.close()  # as when the command exits
        model.process.wait(timeout=5)
    assert model.process.returncode == 0
    assert os.environ.get("LAYA_API_KEY") is None  # the token stays with the server


def test_a_server_that_cannot_answer_fails_at_startup(monkeypatch, tmp_path):
    fake_engine(monkeypatch, tmp_path)
    monkeypatch.setenv("FAKE_BROKEN", "1")
    with pytest.raises(apis.MissingKey, match="could not answer"):
        local.laya(ready_seconds=20)


def test_without_llama_server_d1_says_how_to_install(monkeypatch):
    monkeypatch.setattr(local.shutil, "which", lambda name: None)
    with pytest.raises(apis.MissingKey, match="brew install llama.cpp"):
        local.d1()


def test_d1_starts_llama_server_and_stops_it_with_the_command(monkeypatch, tmp_path, seen):
    # a stand-in llama-server: the fake server above, on the port and key it is given
    fake = tmp_path / "llama-server"
    fake.write_text(
        f"#!{sys.executable}\nimport os, sys\na = sys.argv\n"
        "if a[1:] == ['--version']: print('version: 0.6.0 (build 11552, commit 0)'); sys.exit()\n"
        "assert a[a.index('-hf') + 1] == 'LiquidAI/d1-3B-GGUF:Q8_0'\n"
        "os.environ['LAYA_PORT'] = a[a.index('--port') + 1]\n"
        "os.environ['LAYA_API_KEY'] = a[a.index('--api-key') + 1]\n" + FAKE_SERVE + "main()\n"
    )
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    model = local.d1(ready_seconds=20)
    try:
        assert asyncio.run(model.decide(question(seen))).move == "keep"
    finally:
        model.process.stdin.close()  # as when the command exits
        model.process.wait(timeout=5)
    with pytest.raises(httpx.ConnectError):  # the server went with it
        httpx.get(model._url.removesuffix("/v1/systemone") + "/health", trust_env=False)


def test_d1_says_when_llama_server_is_too_old(monkeypatch, tmp_path):
    fake = tmp_path / "llama-server"
    fake.write_text(f"#!{sys.executable}\nprint('version: 0.6.0 (build 11429, commit 0)')\n")
    fake.chmod(0o755)
    monkeypatch.setenv("PATH", f"{tmp_path}{os.pathsep}{os.environ['PATH']}")
    with pytest.raises(apis.MissingKey, match="build 11483 or newer; .* is build 11429"):
        local.d1()
