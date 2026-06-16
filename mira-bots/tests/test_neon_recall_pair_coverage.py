"""Tests for kb_has_pair_coverage — the strict vendor+model KB probe.

The legacy ``kb_has_coverage`` filters only by manufacturer, which lets
chimeric pairs like ("AutomationDirect", "820") look covered (4,284
AutomationDirect chunks exist; none of them have model "820"). The new
function adds the model filter so the caller can detect chimeras.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, "mira-bots")

# Need NEON_DATABASE_URL set or kb_has_pair_coverage short-circuits to
# (False, 0) before any SQL runs.
os.environ.setdefault("NEON_DATABASE_URL", "postgres://test:test@localhost/test")

from shared.neon_recall import kb_has_pair_coverage  # noqa: E402


def _mock_engine_with_count(count: int):
    """Build a MagicMock create_engine that returns the given row count."""
    row = MagicMock()
    row.__getitem__ = lambda self, idx: count
    conn = MagicMock()
    conn.execute.return_value.fetchone.return_value = row
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    return engine


def test_blank_vendor_returns_zero():
    covered, count = kb_has_pair_coverage("", "820", "tenant-1")
    assert covered is False
    assert count == 0


def test_blank_model_returns_zero():
    covered, count = kb_has_pair_coverage("AutomationDirect", "", "tenant-1")
    assert covered is False
    assert count == 0


def test_both_blank_returns_zero():
    covered, count = kb_has_pair_coverage("", "", "tenant-1")
    assert covered is False
    assert count == 0


def test_missing_neon_url_returns_zero():
    with patch.dict(os.environ, {"NEON_DATABASE_URL": ""}):
        covered, count = kb_has_pair_coverage("AutomationDirect", "820", "tenant-1")
    assert covered is False
    assert count == 0


def test_pair_covered_when_count_meets_threshold():
    """Default threshold is 1 — any non-zero count counts as 'pair exists'."""
    with patch(
        "sqlalchemy.create_engine", return_value=_mock_engine_with_count(7)
    ):
        covered, count = kb_has_pair_coverage(
            "AutomationDirect", "GS11", "tenant-1"
        )
    assert covered is True
    assert count == 7


def test_pair_not_covered_when_count_is_zero():
    """The chimera case: vendor exists, but no row pairs it with this model."""
    with patch(
        "sqlalchemy.create_engine", return_value=_mock_engine_with_count(0)
    ):
        covered, count = kb_has_pair_coverage(
            "AutomationDirect", "820", "tenant-1"
        )
    assert covered is False
    assert count == 0


def test_threshold_is_configurable():
    """Higher threshold via env var means more chunks needed to count as covered."""
    with patch.dict(os.environ, {"MIRA_KB_PAIR_COVERAGE_MIN_CHUNKS": "10"}):
        # Reload the module-level constant to pick up new env value
        import importlib

        from shared import neon_recall

        importlib.reload(neon_recall)
        with patch(
            "sqlalchemy.create_engine",
            return_value=_mock_engine_with_count(5),
        ):
            covered, count = neon_recall.kb_has_pair_coverage(
                "AutomationDirect", "GS11", "tenant-1"
            )
        assert covered is False
        assert count == 5

        with patch(
            "sqlalchemy.create_engine",
            return_value=_mock_engine_with_count(12),
        ):
            covered, count = neon_recall.kb_has_pair_coverage(
                "AutomationDirect", "GS11", "tenant-1"
            )
        assert covered is True
        assert count == 12
    # Reload one more time so test order doesn't leak the env mutation.
    import importlib

    from shared import neon_recall

    importlib.reload(neon_recall)


def test_db_error_returns_negative_one():
    """DB failures distinguish 'couldn't check' (-1) from 'no rows' (0)."""

    def boom(*args, **kwargs):
        raise RuntimeError("connection refused")

    with patch("sqlalchemy.create_engine", side_effect=boom):
        covered, count = kb_has_pair_coverage(
            "AutomationDirect", "GS11", "tenant-1"
        )
    assert covered is False
    assert count == -1


def test_sql_filters_on_both_vendor_and_model():
    """The bug fix: the SQL must reference both manufacturer AND model_number."""
    captured = {}

    def capture_execute(stmt, params):
        captured["sql"] = str(stmt)
        captured["params"] = params
        row = MagicMock()
        row.__getitem__ = lambda self, idx: 3
        result = MagicMock()
        result.fetchone.return_value = row
        return result

    conn = MagicMock()
    conn.execute = capture_execute
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)

    with patch("sqlalchemy.create_engine", return_value=engine):
        kb_has_pair_coverage("AutomationDirect", "GS11", "tenant-1")

    sql = captured["sql"].lower()
    assert "manufacturer" in sql
    assert "model_number" in sql
    assert captured["params"]["vendor_pat"] == "%AutomationDirect%"
    assert captured["params"]["model_pat"] == "%GS11%"
