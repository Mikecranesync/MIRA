"""Put the package root on sys.path so `import mira_plc_parser` works when pytest is run from the
repo root, and expose the fixtures dir."""
import sys
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

FIXTURES = Path(__file__).resolve().parent / "fixtures"
REPO_ROOT = PKG_ROOT.parent


@pytest.fixture(scope="session")
def fixtures():
    return FIXTURES


@pytest.fixture(scope="session")
def real_ccw_st():
    """The real 557-line Micro820 CCW export -- held-out generalization input (skips if absent)."""
    p = REPO_ROOT / "plc" / "Micro820_v4.1.9_Program.st"
    if not p.exists():
        pytest.skip("real CCW export plc/Micro820_v4.1.9_Program.st not present")
    return p.read_text(encoding="utf-8", errors="replace")


@pytest.fixture(scope="session")
def conveyor_l5x():
    return (FIXTURES / "conveyor.L5X").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def gs10_csv():
    return (FIXTURES / "gs10_tags.csv").read_text(encoding="utf-8")
