"""Put the package root on sys.path so `import mira_plc_parser` works when pytest is run from the
repo root, and expose the fixtures dir."""
import sys
from pathlib import Path

import pytest

PKG_ROOT = Path(__file__).resolve().parents[1]
if str(PKG_ROOT) not in sys.path:
    sys.path.insert(0, str(PKG_ROOT))

FIXTURES = Path(__file__).resolve().parent / "fixtures"


@pytest.fixture(scope="session")
def fixtures():
    return FIXTURES


@pytest.fixture(scope="session")
def conveyor_l5x():
    return (FIXTURES / "conveyor.L5X").read_text(encoding="utf-8")


@pytest.fixture(scope="session")
def gs10_csv():
    return (FIXTURES / "gs10_tags.csv").read_text(encoding="utf-8")
