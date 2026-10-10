from starlette.testclient import TestClient

from decision_arena.arena import Settings
from decision_arena.models import Greedy
from decision_arena.server import Arena, app


def test_page_starts_a_series_and_receives_frames():
    arena = Arena([Greedy(0), Greedy(1)], Settings(width=8, height=8, tick=0.001, games=1))
    with TestClient(app(arena)) as client:
        assert "Decision Arena" in client.get("/").text
        with client.websocket_connect("/ws") as ws:
            assert ws.receive_json() == {
                "type": "hello",
                "players": ["Greedy 1", "Greedy 2"],
                "width": 8,
                "height": 8,
            }
            ws.send_json({"type": "start"})
            messages = []
            while not messages or messages[-1]["type"] != "series":
                messages.append(ws.receive_json())
    assert messages[0]["type"] == "frame" and messages[0]["tick"] == 0
    assert any(m.get("over") for m in messages)
