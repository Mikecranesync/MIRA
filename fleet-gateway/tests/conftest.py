from __future__ import annotations

import sys
from pathlib import Path

import pytest

TESTS_DIR = Path(__file__).resolve().parent
ROOT = TESTS_DIR.parent
sys.path.insert(0, str(TESTS_DIR))
sys.path.insert(0, str(ROOT))

from fleet_gateway.cao import FakeCAO
from fleet_gateway.service import build_service
from helpers import AUTH_HEADER, LAUNCH_OK, TEST_BEARER

assert AUTH_HEADER and LAUNCH_OK and TEST_BEARER


@pytest.fixture
def data_dir(tmp_path: Path) -> Path:
    return tmp_path / "gw-data"


@pytest.fixture
def cao() -> FakeCAO:
    return FakeCAO()


@pytest.fixture
def service(data_dir: Path, cao: FakeCAO):
    return build_service(
        bearer_token=TEST_BEARER,
        cao=cao,
        data_dir=data_dir,
        requester="foreman-test",
    )


@pytest.fixture
def auth() -> str:
    return AUTH_HEADER


@pytest.fixture
def launch_ok() -> dict:
    return dict(LAUNCH_OK)
