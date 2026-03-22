"""Regime 5 — Nemotron Bulk Q&A Tests.

BLOCKED: Requires NVIDIA_API_KEY in Doppler.
All tests auto-skip via conftest.py fixture when key is not available.
"""

from __future__ import annotations

import pytest

from tests.scoring.composite import CaseResult, build_case_result


@pytest.mark.regime5
class TestBulkQA:
    """Nemotron bulk Q&A evaluation — skipped until NVIDIA_API_KEY provisioned."""

    def test_placeholder(self):
        """Placeholder — will be activated when NVIDIA_API_KEY is available."""
        pass


async def regime5_runner(mode: str = "offline") -> list[CaseResult]:
    """Regime 5 runner stub — returns empty results until unblocked."""
    return []
