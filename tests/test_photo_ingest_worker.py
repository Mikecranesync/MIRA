"""Offline tests for `mira-bots/shared/workers/photo_ingest_worker.py`.

These cover the pure-Python guard rails: confidence scoring + the four
early-exit paths (no tenant, parse error, missing manufacturer, missing
model). The NeonDB write path is exercised by the Staging Gate workflow
against the staging Neon branch.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

# Make mira-bots importable from the repo root.
REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

# psycopg2 is a transitive import; on dev workstations without it installed
# we can still import the module and call the pure functions, because the
# import lives at module top-level and never runs against a real connection
# in these tests. If psycopg2 isn't available, skip the file — CI installs
# the bot requirements (which include psycopg2-binary) and runs everything.
pytest.importorskip("psycopg2", reason="psycopg2-binary required for this module's import")

from shared.workers.photo_ingest_worker import (  # noqa: E402
    _MIN_PROPOSAL_CONFIDENCE,
    _score,
    propose_from_nameplate,
)

# ── _score ────────────────────────────────────────────────────────────────


class TestScore:
    def test_empty_fields_scores_zero(self):
        assert _score({}) == 0.0

    def test_all_eight_fields_populated_caps_at_ceiling(self):
        full = {
            "manufacturer": "AutomationDirect",
            "model": "GS10",
            "serial": "AD24-1",
            "voltage": "230V",
            "fla": "5A",
            "hp": "1",
            "frequency": "60Hz",
            "rpm": "1750",
        }
        # 8/8 populated = 1.0, capped at 0.95.
        assert _score(full) == 0.95

    def test_unknown_sentinel_penalises(self):
        # Same 2/8 coverage as `partial` below; "Unknown" should drop it lower.
        partial = {"manufacturer": "AB", "model": "PF525"}
        with_unknown = {"manufacturer": "Unknown", "model": "PF525"}
        assert _score(with_unknown) < _score(partial)

    def test_score_never_exceeds_one(self):
        many = {k: "x" for k in (
            "manufacturer", "model", "serial", "voltage",
            "fla", "hp", "frequency", "rpm",
        )}
        assert _score(many) <= 1.0


# ── propose_from_nameplate early exits ────────────────────────────────────


class TestEarlyExits:
    """All four early-exit paths return {} without touching NeonDB."""

    def test_no_tenant_id_returns_empty(self):
        assert propose_from_nameplate("", {"manufacturer": "AB", "model": "PF525"}) == {}

    def test_parse_error_returns_empty(self):
        assert propose_from_nameplate(
            "78917b56-f85f-43bb-9a08-1bb98a6cd6c3",
            {"parse_error": "unparseable response"},
        ) == {}

    def test_missing_manufacturer_returns_empty(self):
        assert propose_from_nameplate(
            "78917b56-f85f-43bb-9a08-1bb98a6cd6c3",
            {"manufacturer": "", "model": "PF525"},
        ) == {}

    def test_missing_model_returns_empty(self):
        assert propose_from_nameplate(
            "78917b56-f85f-43bb-9a08-1bb98a6cd6c3",
            {"manufacturer": "AB", "model": ""},
        ) == {}


# ── _MIN_PROPOSAL_CONFIDENCE sanity ───────────────────────────────────────


def test_min_confidence_is_in_band():
    # If this drifts above 0.5 the Hub UI sort by-confidence stops working;
    # if it drifts to 0 we flood /proposals with noise. Floor must stay
    # below the "medium" cutoff and above the noise floor.
    assert 0.1 < _MIN_PROPOSAL_CONFIDENCE < 0.5
