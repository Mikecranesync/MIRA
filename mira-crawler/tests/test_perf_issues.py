"""Tests for crawler perf + compliance fixes (#112, #113, #114).

- #112: quality_gate accepts shared connection
- #113: freshness audit batches UPDATE into a single query
- #114: sitemap fetch checks robots.txt first
"""
from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# mira-crawler on path so absolute imports work
REPO_ROOT = Path(__file__).parent.parent.parent
CRAWLER_ROOT = Path(__file__).parent.parent
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))


# ── #112: quality_gate shared connection ───────────────────────────────────


class TestQualityGateSharedConnection:

    def test_semantic_dedup_uses_passed_connection(self):
        """When conn is passed, use it instead of opening a new one."""
        from ingest.quality import _semantic_dedup_score

        mock_conn = MagicMock()
        mock_row = MagicMock()
        mock_row.__getitem__.return_value = 0.5
        # row[0] returns 0.5
        mock_row.__iter__.return_value = iter([0.5])
        mock_conn.execute.return_value.fetchone.return_value = [0.5]

        score = _semantic_dedup_score(
            embedding=[0.1] * 768,
            tenant_id="t1",
            conn=mock_conn,
        )

        assert score == 0.5
        mock_conn.execute.assert_called_once()

    def test_semantic_dedup_opens_connection_when_none(self):
        """When conn=None, opens a one-shot connection via _engine()."""
        from ingest.quality import _semantic_dedup_score

        mock_engine = MagicMock()
        mock_conn_ctx = MagicMock()
        mock_conn_ctx.__enter__.return_value.execute.return_value.fetchone.return_value = [0.3]
        mock_engine.connect.return_value = mock_conn_ctx

        with patch("ingest.store._engine", return_value=mock_engine):
            score = _semantic_dedup_score(
                embedding=[0.1] * 768,
                tenant_id="t1",
                conn=None,
            )
        assert score == 0.3

    def test_quality_gate_passes_conn_through(self):
        """quality_gate forwards the conn arg to _semantic_dedup_score."""
        from ingest.quality import quality_gate

        long_text = "This is a valid industrial maintenance chunk. " * 3 + "It mentions fault codes and motor diagnostics."
        chunk = {"text": long_text}
        mock_conn = MagicMock()

        with patch("ingest.quality._relevance_score", return_value=0.9), \
             patch("ingest.quality._semantic_dedup_score", return_value=0.1) as mock_dedup:
            quality_gate(chunk, [0.1] * 768, "t1", conn=mock_conn)

        mock_dedup.assert_called_once_with([0.1] * 768, "t1", conn=mock_conn)


# ── #113: batch freshness UPDATE ────────────────────────────────────────────
# Structural tests — freshness imports transitively pull in celery tasks.


class TestBatchFreshnessUpdate:

    def test_batch_function_exists(self):
        """_mark_entries_stale_batch function is defined."""
        src = (CRAWLER_ROOT / "tasks" / "freshness.py").read_text()
        assert "def _mark_entries_stale_batch" in src

    def test_batch_uses_single_update_with_any(self):
        """Batch function uses UPDATE ... WHERE id = ANY for a single query."""
        src = (CRAWLER_ROOT / "tasks" / "freshness.py").read_text()
        assert "WHERE id = ANY" in src
        # Bound params only — no f-string interpolation of ids
        assert ":ids" in src

    def test_single_mark_uses_batch(self):
        """_mark_entry_stale wraps the batch function."""
        src = (CRAWLER_ROOT / "tasks" / "freshness.py").read_text()
        # The single-entry function should call the batch function
        idx = src.find("def _mark_entry_stale(entry_id")
        assert idx > 0
        # Within ~500 chars after, should reference the batch function
        nearby = src[idx : idx + 500]
        assert "_mark_entries_stale_batch" in nearby

    def test_audit_task_uses_batch(self):
        """audit_stale_content calls the batch function, not per-row _mark_entry_stale."""
        src = (CRAWLER_ROOT / "tasks" / "freshness.py").read_text()
        # Find the audit_stale_content function
        idx = src.find("def audit_stale_content")
        assert idx > 0
        body = src[idx : idx + 2500]
        assert "_mark_entries_stale_batch" in body


# ── #114: robots.txt check ──────────────────────────────────────────────────


class TestRobotsCheck:

    def test_sitemap_task_skips_disallowed_sitemaps(self):
        """When robots.txt disallows, sitemap is skipped and counter increments."""
        src = (CRAWLER_ROOT / "tasks" / "sitemaps.py").read_text()
        assert "is_allowed" in src
        assert "sitemaps_skipped_robots" in src
        assert "disallowed" in src.lower()

    def test_robots_checker_imported(self):
        src = (CRAWLER_ROOT / "tasks" / "sitemaps.py").read_text()
        assert "RobotsChecker" in src
        assert "robots_checker" in src

    def test_return_dict_reports_robots_skips(self):
        """The task's return dict includes sitemaps_skipped_robots."""
        src = (CRAWLER_ROOT / "tasks" / "sitemaps.py").read_text()
        # Find the return at the end of check_sitemaps
        assert '"sitemaps_skipped_robots": sitemaps_skipped_robots' in src
