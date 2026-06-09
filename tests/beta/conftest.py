"""Markers for the beta-readiness gate suite.

Inherits sys.path setup (mira-bots on path) from the parent tests/conftest.py.
"""

from __future__ import annotations


def pytest_configure(config):
    config.addinivalue_line(
        "markers",
        "beta_gate: RELEASE GATE — must pass before any external beta tester is invited",
    )
