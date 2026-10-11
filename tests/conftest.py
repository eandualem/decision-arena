import pytest

# What the page says a runner sees, as race/models.js see() builds it.
SEEN = {
    "lane": 0,
    "doing": ["running"],
    "speed": 14.2,
    "last": "jump",
    "place": 2,
    "of": 4,
    "ahead": {"name": "Mira", "gap": 3.2, "lane": -1},
    "behind": {"name": "Rex", "gap": 0.4, "lane": 0},
    "edge": 9.4,
    "lanes": [
        [{"kind": "barrierJump", "at": 12.3, "length": 0.6, "moving": False, "speed": 0}],
        [],
        [{"kind": "train", "at": 22.0, "length": 31.5, "moving": True, "speed": 12.0}],
    ],
}


@pytest.fixture
def seen():
    return SEEN
