from decision_arena.models import MOVES, question


def test_the_question_describes_the_runner_and_each_lane(seen):
    q = question(seen)
    assert "You are in the middle lane, running, at 14 m/s." in q.state
    assert "Your last move was jump." in q.state
    assert "Rex is level with you, in the middle lane." in q.state
    assert "You are 2nd of 4." in q.state and "Mira is 3 m ahead of you, in the left lane." in q.state
    assert "breaking away 9 m behind you" in q.state
    assert "Left lane: a low barrier (jump over it) in 12 m." in q.state
    assert "Middle lane: clear for 60 m." in q.state
    assert "Right lane: a train coming at you at 12 m/s, 32 m long, in 22 m." in q.state
    assert tuple(q.options) == MOVES


def test_a_move_off_the_track_says_nothing_happens(seen):
    q = question(seen | {"lane": -1})
    assert "nothing happens" in q.options["left"] and "nothing happens" not in q.options["right"]
