"""Put tools/proveit on sys.path so the offline transforms import as plain modules."""
import sys
from pathlib import Path

_TOOLS_PROVEIT = Path(__file__).resolve().parents[2] / "tools" / "proveit"
if str(_TOOLS_PROVEIT) not in sys.path:
    sys.path.insert(0, str(_TOOLS_PROVEIT))
