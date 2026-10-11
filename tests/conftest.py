import pytest

# What the page says a runner sees, as race/models.js see() builds it.
SEEN = {
    "lane": 0,
    "doing": ["running"],
    "roof": False,
    "speed": 14.2,
    "answer": 0.38,
    "last": "jump",
    "place": 2,
    "of": 4,
    "others": [
        {"name": "Rex", "gap": -0.4, "lane": 0, "down": False},
        {"name": "Mira", "gap": 3.2, "lane": -1, "down": False},
        {"name": "Tom", "gap": -11.0, "lane": 1, "down": True},
    ],
    "edge": 9.4,
    "edgeSpeed": 16.0,
    "lanes": [
        [{"kind": "barrierJump", "at": 12.3, "length": 0.6, "moving": False, "speed": 0}],
        [],
        [{"kind": "train", "at": 22.0, "length": 31.5, "moving": True, "speed": 12.0}],
    ],
}


@pytest.fixture
def seen():
    return SEEN
