from decision_arena.models import MOVES, question


def test_the_question_describes_the_runner_and_each_lane(seen):
    q = question(seen)
    assert "You are in the middle lane, running, at 14 m/s." in q.state
    assert "Your last move was jump." in q.state
    assert "Your answers take about 0.38 s, so your move is made about 5 m further on." in q.state
    assert "You are 2nd of 4. Rex is level with you in the middle lane." in q.state
    assert "Mira is 3 m ahead of you in the left lane." in q.state
    assert "Tom is 11 m behind you in the right lane, down after a crash." in q.state
    assert "breaking away 9 m behind you, gaining 2 m/s on you." in q.state
    assert "Your lane (middle): clear for 100 m. Left lane:" in q.state
    assert (
        "Left lane: a low barrier (jump over it) 12 m ahead, reached in 0.87 s"
        " (0.49 s after your answer)." in q.state
    )
    # a train coming at you closes at your speed plus its own
    assert (
        "Right lane: a train coming at you at 12 m/s, 32 m long, 22 m ahead,"
        " reached in 0.84 s (0.46 s after your answer)." in q.state
    )
    assert tuple(q.options) == MOVES


def test_a_move_off_the_track_says_nothing_happens(seen):
    q = question(seen | {"lane": -1})
    assert "nothing happens" in q.options["left"] and "nothing happens" not in q.options["right"]


def test_the_first_question_has_no_answer_time_and_a_roof_train_is_under_you(seen):
    lanes = [[], [{"kind": "train", "at": -4.0, "length": 25.0, "moving": False, "speed": 0}], []]
    q = question(seen | {"answer": None, "roof": True, "lanes": lanes})
    assert "Your answers take" not in q.state and "after your answer" not in q.state
    assert "Your lane (middle): a standing train, 25 m long, under you for another 21 m (1.48 s)." in q.state


def test_a_ramp_is_told_with_its_train_and_a_train_beside_you_blocks_that_lane(seen):
    lanes = [
        [{"kind": "train", "at": -3.0, "length": 20.0, "moving": False, "speed": 0}],
        [{"kind": "barrierJump", "at": 30.0, "length": 0.4, "moving": False, "speed": 0}],
        [
            {"kind": "ramp", "at": 18.0, "length": 8.5, "moving": False, "speed": 0},
            {"kind": "train", "at": 26.5, "length": 37.0, "moving": False, "speed": 0},
        ],
    ]
    q = question(seen | {"lanes": lanes})
    assert (
        "Left lane: a standing train, 20 m long, beside you for another 17 m (1.20 s):"
        " moving into this lane now bounces you off it." in q.state
    )
    assert "Right lane: a ramp 18 m ahead, reached in 1.27 s (0.89 s after your answer)," in q.state
    assert "up onto a standing train's roof, 37 m long." in q.state
    # on a roof, the same train is no wall, and ground barriers pass below
    q = question(seen | {"lanes": lanes, "roof": True})
    assert "bounces you off it" not in q.state
    assert "(on the ground, below your roof)" in q.state
