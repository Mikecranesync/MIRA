"""Tests for drift_monitor — cosine math, sampling, drift computation.

Offline tests covering vector math, query sampling with mock SQLite,
fixture loading, and end-to-end drift computation with synthetic embeddings.
"""
from __future__ import annotations

import asyncio
import json
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

import pytest

REPO_ROOT = Path(__file__).parent.parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from tools.drift_monitor import (
    DriftMonitor,
    DriftMonitorConfig,
    centroid,
    compute_drift,
    cosine_distance,
    cosine_similarity,
    load_fixture_inputs,
    sample_production_queries,
)


# ── Math tests ─────────────────────────────────────────────────────────────


class TestCosine:

    def test_identical_vectors(self):
        v = [1.0, 2.0, 3.0]
        assert cosine_similarity(v, v) == pytest.approx(1.0)
        assert cosine_distance(v, v) == pytest.approx(0.0)

    def test_orthogonal_vectors(self):
        assert cosine_similarity([1.0, 0.0], [0.0, 1.0]) == pytest.approx(0.0)
        assert cosine_distance([1.0, 0.0], [0.0, 1.0]) == pytest.approx(1.0)

    def test_opposite_vectors(self):
        assert cosine_similarity([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(-1.0)
        assert cosine_distance([1.0, 0.0], [-1.0, 0.0]) == pytest.approx(2.0)

    def test_zero_vector(self):
        """Zero vectors return similarity 0 (avoid divide-by-zero)."""
        assert cosine_similarity([0.0, 0.0], [1.0, 1.0]) == 0.0

    def test_dim_mismatch_raises(self):
        with pytest.raises(ValueError):
            cosine_similarity([1.0], [1.0, 2.0])


class TestCentroid:

    def test_single_vector(self):
        assert centroid([[1.0, 2.0, 3.0]]) == [1.0, 2.0, 3.0]

    def test_two_vectors(self):
        result = centroid([[0.0, 0.0], [2.0, 4.0]])
        assert result == [1.0, 2.0]

    def test_empty_list(self):
        assert centroid([]) == []

    def test_dim_mismatch_raises(self):
        with pytest.raises(ValueError):
            centroid([[1.0, 2.0], [1.0]])


# ── Sampling tests ─────────────────────────────────────────────────────────


class TestSampleQueries:

    def test_samples_recent_messages(self, tmp_path):
        db = tmp_path / "mira.db"
        con = sqlite3.connect(str(db))
        con.execute("""
            CREATE TABLE interactions (
                id INTEGER PRIMARY KEY,
                chat_id TEXT,
                user_message TEXT,
                bot_response TEXT,
                created_at TIMESTAMP
            )
        """)
        now = datetime.now(timezone.utc).isoformat()
        con.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, created_at) "
            "VALUES (?, ?, ?, ?)",
            ("c1", "GS20 overcurrent fault", "reply", now),
        )
        con.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, created_at) "
            "VALUES (?, ?, ?, ?)",
            ("c2", "PowerFlex 525 F4 undervoltage", "reply", now),
        )
        con.commit()
        con.close()

        queries = sample_production_queries(db, 10, 7)
        assert len(queries) == 2
        assert any("GS20" in q for q in queries)

    def test_filters_short_messages(self, tmp_path):
        db = tmp_path / "mira.db"
        con = sqlite3.connect(str(db))
        con.execute("""
            CREATE TABLE interactions (
                id INTEGER PRIMARY KEY,
                chat_id TEXT,
                user_message TEXT,
                bot_response TEXT,
                created_at TIMESTAMP
            )
        """)
        now = datetime.now(timezone.utc).isoformat()
        con.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, created_at) "
            "VALUES (?, ?, ?, ?)",
            ("c1", "hi", "reply", now),  # too short
        )
        con.execute(
            "INSERT INTO interactions (chat_id, user_message, bot_response, created_at) "
            "VALUES (?, ?, ?, ?)",
            ("c2", "long enough query", "reply", now),
        )
        con.commit()
        con.close()

        queries = sample_production_queries(db, 10, 7)
        assert queries == ["long enough query"]

    def test_missing_db_returns_empty(self, tmp_path):
        queries = sample_production_queries(tmp_path / "nope.db", 10, 7)
        assert queries == []


class TestLoadFixtures:

    def test_loads_first_user_turn(self, tmp_path):
        f = tmp_path / "01_test.yaml"
        f.write_text(
            "id: test_01\n"
            "description: test fixture\n"
            "expected_final_state: Q1\n"
            "max_turns: 3\n"
            "expected_keywords: []\n"
            "expected_vendor: Test\n"
            "turns:\n"
            "  - role: user\n"
            "    content: first user message\n"
            "  - role: user\n"
            "    content: second user message\n"
        )
        results = load_fixture_inputs(tmp_path)
        assert len(results) == 1
        assert results[0][0] == "test_01"
        assert results[0][1] == "first user message"

    def test_skips_non_numeric_prefix(self, tmp_path):
        (tmp_path / "vision_smoke.yaml").write_text(
            "id: vsmoke\nturns:\n  - role: user\n    content: test\n"
        )
        results = load_fixture_inputs(tmp_path)
        assert results == []


# ── Drift computation tests ────────────────────────────────────────────────


class TestComputeDrift:

    def test_identical_distributions_no_drift(self):
        # Prod and fixtures have same centroid
        prod = [("q1", [1.0, 0.0]), ("q2", [0.0, 1.0])]
        fixt = [("f1", [1.0, 0.0]), ("f2", [0.0, 1.0])]
        report = compute_drift(prod, fixt, threshold=0.15, top_n=5)
        assert report.drift_score < 0.01
        assert not report.drift_flagged

    def test_shifted_distribution_flags_drift(self):
        # Prod vectors are in one region, fixtures in another
        prod = [("q1", [1.0, 0.0, 0.0]), ("q2", [1.0, 0.0, 0.1])]
        fixt = [("f1", [0.0, 1.0, 0.0]), ("f2", [0.0, 1.0, 0.1])]
        report = compute_drift(prod, fixt, threshold=0.15, top_n=5)
        assert report.drift_score > 0.15
        assert report.drift_flagged

    def test_top_unfamiliar_ordered_by_distance(self):
        """Queries farthest from any fixture come first in top_unfamiliar."""
        prod = [
            ("close", [1.0, 0.0, 0.0]),   # matches fixture
            ("far", [0.0, 0.0, 1.0]),     # no fixture nearby
            ("medium", [0.5, 0.5, 0.5]),
        ]
        fixt = [("f1", [1.0, 0.0, 0.0])]
        report = compute_drift(prod, fixt, threshold=0.15, top_n=3)
        assert len(report.top_unfamiliar) == 3
        # "far" should be first (most unfamiliar)
        assert report.top_unfamiliar[0]["query"] == "far"

    def test_empty_prod_returns_error(self):
        fixt = [("f1", [1.0, 0.0])]
        report = compute_drift([], fixt, threshold=0.15, top_n=5)
        assert report.error == "no_prod_queries"
        assert not report.drift_flagged

    def test_empty_fixtures_returns_error(self):
        prod = [("q1", [1.0, 0.0])]
        report = compute_drift(prod, [], threshold=0.15, top_n=5)
        assert report.error == "no_fixtures"
        assert not report.drift_flagged

    def test_top_n_limits_output(self):
        prod = [(f"q{i}", [float(i), 0.0, 0.0]) for i in range(20)]
        fixt = [("f1", [5.0, 0.0, 0.0])]
        report = compute_drift(prod, fixt, threshold=0.15, top_n=3)
        assert len(report.top_unfamiliar) == 3


# ── Report output tests ────────────────────────────────────────────────────


class TestReportOutput:

    def test_to_dict_serializable(self, tmp_path):
        prod = [("q1", [1.0, 0.0])]
        fixt = [("f1", [1.0, 0.0])]
        report = compute_drift(prod, fixt, threshold=0.15, top_n=5)
        d = report.to_dict()
        # Must be JSON-serializable
        json.dumps(d)

    def test_markdown_format(self):
        prod = [("q1", [1.0, 0.0])]
        fixt = [("f1", [1.0, 0.0])]
        report = compute_drift(prod, fixt, threshold=0.15, top_n=5)
        md = report.to_markdown()
        assert "Drift score" in md
        assert "stable" in md or "DRIFT" in md

    def test_drift_flagged_in_markdown(self):
        prod = [("q1", [1.0, 0.0, 0.0])]
        fixt = [("f1", [0.0, 0.0, 1.0])]
        report = compute_drift(prod, fixt, threshold=0.15, top_n=5)
        md = report.to_markdown()
        assert "DRIFT" in md


# ── Monitor class integration ──────────────────────────────────────────────


class TestDriftMonitorIntegration:

    def test_missing_data_returns_insufficient(self, tmp_path):
        """Missing DB + no fixtures → report with error flag."""
        cfg = DriftMonitorConfig(
            db_path=tmp_path / "nope.db",
            ollama_url="http://nope",
            embed_model="nomic-embed-text",
            fixtures_dir=tmp_path / "empty",
            output_dir=tmp_path / "out",
        )
        monitor = DriftMonitor(cfg)
        report = asyncio.run(monitor.run(dry_run=True))
        assert report.error == "insufficient_data"

    def test_write_report_creates_weekly_file(self, tmp_path):
        cfg = DriftMonitorConfig(
            db_path=tmp_path / "nope.db",
            ollama_url="http://nope",
            embed_model="nomic-embed-text",
            fixtures_dir=tmp_path / "empty",
            output_dir=tmp_path / "drift",
        )
        monitor = DriftMonitor(cfg)
        # Run to generate a report even with insufficient data — should write
        report = asyncio.run(monitor.run(dry_run=False))
        # One JSON file in the output dir, named YYYY-WNN.json
        files = list((tmp_path / "drift").glob("*.json"))
        assert len(files) == 1
        data = json.loads(files[0].read_text())
        assert "drift_score" in data
