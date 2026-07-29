"""Entry point so `python tools/proveit/` runs the CLI — see cli.py."""
from __future__ import annotations

import sys
from pathlib import Path

# Make the flat sibling modules importable whether invoked as a directory or a script.
_HERE = str(Path(__file__).resolve().parent)
if _HERE not in sys.path:
    sys.path.insert(0, _HERE)

from cli import main  # noqa: E402

if __name__ == "__main__":
    raise SystemExit(main())
