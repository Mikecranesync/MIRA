"""Put tools/legoland on sys.path so the offline transforms import as plain modules."""

import sys
from pathlib import Path

_TOOLS_LEGOLAND = Path(__file__).resolve().parents[2] / "tools" / "legoland"
if str(_TOOLS_LEGOLAND) not in sys.path:
    sys.path.insert(0, str(_TOOLS_LEGOLAND))
