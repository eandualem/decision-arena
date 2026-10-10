"""The light-cycle grid: starts, moves, crashes and what each cycle is asked."""

from __future__ import annotations

from dataclasses import dataclass, field

MOVES = ("left", "straight", "right")
TURNS = {"left": -1, "straight": 0, "right": 1}
# Headings clockwise from up; y grows downward.
STEPS = ((0, -1), (1, 0), (0, 1), (-1, 0))
UP, RIGHT, DOWN, LEFT = range(4)
VIEW = 5  # cells the map shows on each side of the cycle

INSTRUCTIONS = (
    "You ride a light cycle on a grid. Every cycle moves one cell each tick and leaves a"
    " permanent trail. Hitting a wall or any trail, your own included, ends your game; the"
    " last cycle moving wins. The map is turned so that you always face up: ^ is you,"
    " # is a wall or trail, x is another cycle, . is free. Choose your next move."
)


@dataclass
class Cycle:
    x: int
    y: int
    heading: int
    alive: bool = True
    trail: list[tuple[int, int]] = field(default_factory=list)


@dataclass(frozen=True)
class Question:
    """What one cycle is asked this tick. `free` holds the same counts the options state,
    for a model that reads numbers rather than text."""

    state: str
    options: dict[str, str]
    free: dict[str, int]
    instructions: str = INSTRUCTIONS


def starts(width: int, height: int, players: int) -> list[tuple[int, int, int]]:
    """Symmetric starting cells and headings: mirrored for two, one per quadrant turning
    clockwise for three or four."""
    if not 2 <= players <= 4:
        raise ValueError("A game has two to four cycles")
    left, right = width // 4, width - 1 - width // 4
    if players == 2:
        return [(left, height // 2, RIGHT), (right, height // 2, LEFT)]
    top, bottom = height // 4, height - 1 - height // 4
    return [(left, top, RIGHT), (right, top, DOWN), (right, bottom, LEFT), (left, bottom, UP)][
        :players
    ]


class Game:
    def __init__(self, width: int, height: int, players: int, rotation: int = 0) -> None:
        """`rotation` shifts which start each player takes, so a series can give every
        player every start."""
        places = starts(width, height, players)
        shift = rotation % players
        places = places[shift:] + places[:shift]
        self.width, self.height = width, height
        self.cycles = [Cycle(x, y, heading, trail=[(x, y)]) for x, y, heading in places]
        self.occupied = {(x, y) for x, y, _ in places}
        self.tick = 0

    @property
    def over(self) -> bool:
        return sum(c.alive for c in self.cycles) <= 1

    @property
    def winner(self) -> int | None:
        alive = [i for i, c in enumerate(self.cycles) if c.alive]
        return alive[0] if self.over and alive else None

    def blocked(self, x: int, y: int) -> bool:
        return not (0 <= x < self.width and 0 <= y < self.height) or (x, y) in self.occupied

    def free(self, cycle: Cycle, move: str) -> int:
        """Free cells in a straight line from the cycle after making `move`."""
        dx, dy = STEPS[(cycle.heading + TURNS[move]) % 4]
        n, x, y = 0, cycle.x + dx, cycle.y + dy
        while not self.blocked(x, y):
            n, x, y = n + 1, x + dx, y + dy
        return n

    def question(self, i: int) -> Question:
        cycle = self.cycles[i]
        others = {(c.x, c.y) for j, c in enumerate(self.cycles) if j != i and c.alive}
        fx, fy = STEPS[cycle.heading]
        rx, ry = STEPS[(cycle.heading + 1) % 4]
        rows = []
        for down in range(-VIEW, VIEW + 1):
            row = []
            for across in range(-VIEW, VIEW + 1):
                x = cycle.x + across * rx - down * fx
                y = cycle.y + across * ry - down * fy
                if (across, down) == (0, 0):
                    row.append("^")
                elif (x, y) in others:
                    row.append("x")
                else:
                    row.append("#" if self.blocked(x, y) else ".")
            rows.append("".join(row))
        free = {move: self.free(cycle, move) for move in MOVES}
        said = {"left": "Turn left", "straight": "Keep straight", "right": "Turn right"}
        options = {
            move: f"{said[move]}: {n} free cell{'s' * (n != 1)} in a line before a wall or trail."
            for move, n in free.items()
        }
        return Question("\n".join(rows), options, free)

    def step(self, moves: list[str]) -> list[int]:
        """Move every live cycle by its move; return the cycles that crashed. Two cycles
        entering the same cell both crash. A crashed cycle stays on its last cell."""
        ahead: dict[int, tuple[int, int]] = {}
        for i, cycle in enumerate(self.cycles):
            if cycle.alive:
                cycle.heading = (cycle.heading + TURNS[moves[i]]) % 4
                dx, dy = STEPS[cycle.heading]
                ahead[i] = (cycle.x + dx, cycle.y + dy)
        cells = list(ahead.values())
        crashed = [i for i, cell in ahead.items() if self.blocked(*cell) or cells.count(cell) > 1]
        for i, cell in ahead.items():
            cycle = self.cycles[i]
            if i in crashed:
                cycle.alive = False
            else:
                cycle.x, cycle.y = cell
                cycle.trail.append(cell)
                self.occupied.add(cell)
        self.tick += 1
        return crashed
