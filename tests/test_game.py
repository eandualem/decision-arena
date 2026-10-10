from decision_arena.game import DOWN, LEFT, RIGHT, UP, Cycle, Game, starts


def test_two_player_starts_mirror_each_other():
    (ax, ay, ah), (bx, by, bh) = starts(32, 24, 2)
    assert (ax + bx, ay, ah, bh) == (31, by, RIGHT, LEFT)


def test_hitting_a_wall_or_trail_crashes():
    game = Game(10, 10, 2)
    game.cycles[0] = Cycle(0, 5, LEFT, trail=[(0, 5)])
    game.occupied.add((0, 5))
    assert game.step(["straight", "straight"]) == [0]
    assert game.over and game.winner == 1


def test_two_cycles_entering_one_cell_both_crash():
    game = Game(10, 10, 2)
    game.cycles = [Cycle(3, 5, RIGHT, trail=[(3, 5)]), Cycle(5, 5, LEFT, trail=[(5, 5)])]
    game.occupied = {(3, 5), (5, 5)}
    assert game.step(["straight", "straight"]) == [0, 1]
    assert game.over and game.winner is None


def test_map_is_turned_so_the_cycle_faces_up():
    game = Game(20, 20, 2)
    game.cycles[0] = Cycle(10, 10, RIGHT, trail=[(10, 10)])
    game.occupied.add((11, 10))  # one cell ahead, in the direction of travel
    game.occupied.add((10, 11))  # one cell to its right: south when facing east
    rows = game.question(0).state.splitlines()
    assert rows[4][5] == "#"  # straight ahead, just above ^
    assert rows[5][6] == "#"  # just right of ^
    assert rows[5][5] == "^"


def test_options_state_free_cells_each_way():
    game = Game(10, 10, 2)
    game.cycles[0] = Cycle(1, 1, UP, trail=[(1, 1)])
    question = game.question(0)
    assert question.free == {"left": 1, "straight": 1, "right": 8}
    assert question.options["right"] == "Turn right: 8 free cells in a line before a wall or trail."


def test_rotation_shifts_starts():
    a, b = Game(32, 24, 2), Game(32, 24, 2, rotation=1)
    assert (a.cycles[0].x, a.cycles[0].heading) == (b.cycles[1].x, b.cycles[1].heading)
    assert Game(32, 24, 4).cycles[1].heading == DOWN
