import json
import shutil
import subprocess
from pathlib import Path

import pytest

WEB = Path(__file__).parent.parent / "src" / "decision_arena" / "web" / "src"

# A train alongside on the right and a barrier ahead in the middle; the runner turns right
# just before the barrier, bounces off the train's side, and must still meet the barrier.
SWEEP = """
const P = await import(process.argv[1] + '/gameplay/physics.js');
const { BARRIER, TRAIN } = await import(process.argv[1] + '/config.js');
const kinds = { barrierJump: [0, BARRIER.jumpHeight, BARRIER.depth],
  barrierRoll: [BARRIER.rollClear, BARRIER.rollTop, BARRIER.depth], bumper: [0, BARRIER.bumperHeight, 1.2] };
const through = {};
for (const [kind, [y0, y1, depth]] of Object.entries(kinds)) {
  through[kind] = 0;
  for (let k = 0; k < 40; k++) {
    const at = 0.3 + k * 0.05;
    const cols = [
      { id: 2, kind: 'train', lane: 1, minX: 1.45, maxX: 3.75, minY: 0, maxY: TRAIN.height, minZ: -60, maxZ: 5,
        vz: 0, top: 'walk', ramp: null },
      { id: 1, kind, lane: 0, minX: -1.1, maxX: 1.1, minY: y0, maxY: y1, minZ: -at - depth, maxZ: -at,
        vz: 0, top: 'none', ramp: null },
    ];
    const W = { cols, tOff: 0, support: (x, z, hw, m) => P.supportFromCols(cols, 0, x, z, hw, m) };
    const b = P.resetBody(P.createBody(), 0, 0); b.speed = 20;
    const cfg = P.createCfg(), ev = P.createEvents();
    P.laneChange(b, 1);
    let crashed = false;
    for (let i = 0; i < 36 && !crashed; i++) {
      P.clearEvents(ev); P.stepBody(b, 1 / 60, W, cfg, ev); crashed = ev.hitType === 'crash';
    }
    if (!crashed) through[kind]++;
  }
}
console.log(JSON.stringify(through));
"""


@pytest.mark.skipif(shutil.which("node") is None, reason="needs Node.js")
def test_a_bounce_off_a_train_never_lets_a_runner_through_a_barrier():
    out = subprocess.run(
        ["node", "--input-type=module", "-e", SWEEP, str(WEB)],
        capture_output=True, text=True, check=True, timeout=60,
    )
    assert json.loads(out.stdout) == {"barrierJump": 0, "barrierRoll": 0, "bumper": 0}
