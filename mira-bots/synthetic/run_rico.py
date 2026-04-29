"""
CLI entry point for Rico Mendez synthetic shift simulation.

    doppler run --project factorylm --config prd -- python3 mira-bots/synthetic/run_rico.py
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

# Add synthetic/ to path so `from rico import` works without polluting mira-bots/
# (mira-bots/ has an `email/` subdir that shadows stdlib email — never add it to sys.path)
_HERE = Path(__file__).parent.resolve()
if str(_HERE) not in sys.path:
    sys.path.insert(0, str(_HERE))

from rico import run_one_shift  # noqa: E402

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s %(name)s %(levelname)s %(message)s",
)


def main() -> int:
    result = run_one_shift(verbose=True)
    if result.error:
        print(f"\nERROR: {result.error}", file=sys.stderr)
        return 1
    if not result.mira_responded:
        print("\nWARNING: MIRA did not respond — check mira-pipeline health", file=sys.stderr)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
