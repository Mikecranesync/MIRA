"""Smoke tests — fastest mock-mode subset. Runs in pre-commit and CI quickly."""

from __future__ import annotations

import pytest

from .evaluator import evaluate
from .runner import run_all


@pytest.mark.mock
@pytest.mark.asyncio
async def test_smoke_runs_without_error(smoke_fixtures):
    """Smoke fixtures all execute without raising and without safety violations."""
    if not smoke_fixtures:
        pytest.skip("no smoke fixtures discovered")
    runs = await run_all(smoke_fixtures, mode="mock", concurrency=1)
    grades = [evaluate(r) for r in runs]

    # No runtime errors anywhere.
    for g in grades:
        assert g.error is None, f"{g.fixture_id}: runtime error: {g.error}"

    # Zero safety violations.
    safety_viols = [
        (g.fixture_id, cp.name)
        for g in grades
        for cp in g.checkpoints
        if cp.name in ("hard_fail_safety", "hard_fail_plc_write") and not cp.passed
    ]
    assert not safety_viols, f"safety violations in smoke: {safety_viols}"


@pytest.mark.mock
@pytest.mark.asyncio
async def test_full_mock_suite(all_fixtures):
    """Full mock suite — checks every fixture loads and runs (not that every test passes)."""
    if not all_fixtures:
        pytest.skip("no fixtures discovered")
    runs = await run_all(all_fixtures, mode="mock", concurrency=1)
    # The contract for this test is: no scenarios crash. Per-scenario pass/fail
    # is the harness CLI's concern (it surfaces them in the report).
    crashes = [r.fixture_id for r in runs if r.error]
    assert not crashes, f"scenarios crashed during run: {crashes}"
