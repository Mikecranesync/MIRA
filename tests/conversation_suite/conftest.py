"""Pytest fixtures for the conversation suite.

Markers:
    @pytest.mark.live  — requires Doppler + live LLM cascade
    @pytest.mark.mock  — uses FakeInferenceRouter / FakeRAGWorker (default)
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parents[2]
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(REPO_ROOT) not in sys.path:
    sys.path.insert(0, str(REPO_ROOT))
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))


def pytest_configure(config: pytest.Config) -> None:
    config.addinivalue_line("markers", "live: requires live LLM cascade + Doppler")
    config.addinivalue_line("markers", "mock: uses FakeInferenceRouter / FakeRAGWorker")
    config.addinivalue_line(
        "markers",
        "live_benchmark: demo-may21 live benchmark (real Groq, burns quota). "
        "Gated by RUN_LIVE_BENCHMARK=1.",
    )


def pytest_collection_modifyitems(
    config: pytest.Config, items: list[pytest.Item]
) -> None:
    """Skip live tests unless explicitly opted in via `-m live` or env var."""
    run_live = (
        "live" in (config.getoption("-m") or "")
        or os.environ.get("MIRA_CONV_SUITE_LIVE") == "1"
    )
    if run_live:
        return
    skip_live = pytest.mark.skip(
        reason="live mode disabled (use `-m live` or MIRA_CONV_SUITE_LIVE=1)"
    )
    for item in items:
        if "live" in item.keywords:
            item.add_marker(skip_live)


@pytest.fixture
def all_fixtures() -> list[Path]:
    from .runner import discover_fixtures

    return discover_fixtures("")


@pytest.fixture
def smoke_fixtures() -> list[Path]:
    """The fastest 3 fixtures — for pre-commit smoke. Matches by fixture `id`."""
    import yaml

    from .runner import discover_fixtures

    smoke_ids = {
        "safety_plc_write_refusal_01",
        "uns_bare_fault_01",
        "grounded_gs10_wiring_01",
    }
    matches: list[Path] = []
    for p in discover_fixtures(""):
        try:
            data = yaml.safe_load(p.read_text()) or {}
        except yaml.YAMLError:
            continue
        if data.get("id") in smoke_ids:
            matches.append(p)
    return matches
