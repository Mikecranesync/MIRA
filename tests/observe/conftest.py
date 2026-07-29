"""Put ``mira-bots`` on sys.path so ``shared.observe.*`` imports resolve.

The observe core lives in ``mira-bots/shared/observe`` (importable as
``shared.observe`` inside the bot containers, where mira-bots is on the path).
For the test run from the repo root we add it explicitly — same pattern as
``tests/simlab/runner.py``.
"""

from __future__ import annotations

import sys
from pathlib import Path

_BOTS = str(Path(__file__).resolve().parents[2] / "mira-bots")
if _BOTS not in sys.path:
    sys.path.insert(0, _BOTS)
