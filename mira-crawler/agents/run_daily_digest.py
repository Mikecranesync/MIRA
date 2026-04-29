"""
System — Daily Digest — 00:00 ET (04:00 UTC).
Reads the full daily_context.json and sends a summary of what all 12 agents did.
"""
from __future__ import annotations

import sys
from pathlib import Path

_HERE = Path(__file__).parent.resolve()
_CRAWLER_ROOT = _HERE.parent
_REPO = _CRAWLER_ROOT.parent
sys.path.insert(0, str(_CRAWLER_ROOT))

from agents.orchestrator import run_daily_digest  # noqa: E402

if __name__ == "__main__":
    result = run_daily_digest()
    print(f"Daily digest sent — {result['done']}/{result['total']} agents · {result['errors']} errors")
