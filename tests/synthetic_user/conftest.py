"""Shared fixtures for the synthetic_user test suite.

All tests in this package are offline — no network calls, no LLM, no running
services.  This conftest ensures the repo root is importable so that the
``tests.synthetic_user.*`` package can be resolved regardless of how pytest is
invoked.
"""

from __future__ import annotations

import os
import sys

import pytest

# ---------------------------------------------------------------------------
# Path bootstrap
# ---------------------------------------------------------------------------

_REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
if _REPO not in sys.path:
    sys.path.insert(0, _REPO)


# ---------------------------------------------------------------------------
# Pytest markers
# ---------------------------------------------------------------------------


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "offline: pure-offline test, no network or LLM")
