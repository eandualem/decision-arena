from starlette.testclient import TestClient

from decision_arena.server import app


def test_serves_the_race_page_and_its_modules():
    client = TestClient(app())
    page = client.get("/")
    assert page.status_code == 200 and "src/race/main.js" in page.text
    assert client.get("/src/race/main.js").status_code == 200
    assert client.get("/vendor/three/three.module.js").status_code == 200
