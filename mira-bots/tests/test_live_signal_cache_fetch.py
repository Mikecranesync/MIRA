"""PR 4 — live-signal-cache reader tests (PRD #3048).

Tests the read-back path: fetch_live_signal_cache() assembles a synthetic
snapshot envelope from cache rows, enforcing three critical guards:
1. Empty tag set → no overlay (fact #7 / #3060)
2. simulated=true never presented as real telemetry (fact #6)
3. Quality mapping is downgrade-only (fact from advisor)
"""

from __future__ import annotations

import os
import sys
import unittest.mock
from datetime import datetime, timezone

os.environ.setdefault("NEON_DATABASE_URL", "")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_live_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "staging")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Import after env setup
from shared.prior_decisions import _live_tag_rows_to_dict


class TestLiveTagRowsToDict(unittest.TestCase):
    """Tests for _live_tag_rows_to_dict, the synthetic envelope builder."""

    def test_empty_rows_guard(self):
        """Empty tag set must produce an envelope with empty tags (boundary guard #7/#3060).

        augment_with_live rejects tags: [] as invalid — this function's job is to
        refuse to invent evidence when none exists.
        """
        result = _live_tag_rows_to_dict([])

        self.assertEqual(result["tags"], [])
        self.assertEqual(result["machine_state"], "unknown")
        self.assertEqual(result["active_conditions"], [])
        self.assertEqual(result["schema_version"], "factorylm.machine-snapshot.v1")

    def test_quality_downgrade_mapping(self):
        """Quality mapping must downgrade unknown/unrecognized to uncertain, never to good."""
        rows = [
            {
                "plc_tag": "tag1",
                "last_value_numeric": 42.0,
                "last_value_text": None,
                "last_value_bool": None,
                "last_seen_at": "2026-01-01T00:00:00Z",
                "latest_quality": "unknown_quality",  # Unrecognized
                "properties": None,
            }
        ]

        result = _live_tag_rows_to_dict(rows)

        # Unrecognized quality should be downgraded to uncertain
        self.assertEqual(result["tags"][0]["quality"], "uncertain")

    def test_good_quality_preserved(self):
        """Good quality is preserved as-is."""
        rows = [
            {
                "plc_tag": "tag1",
                "last_value_numeric": 42.0,
                "last_value_text": None,
                "last_value_bool": None,
                "last_seen_at": "2026-01-01T00:00:00Z",
                "latest_quality": "good",
                "properties": None,
            }
        ]

        result = _live_tag_rows_to_dict(rows)

        self.assertEqual(result["tags"][0]["quality"], "good")

    def test_snapshot_metadata_recovery(self):
        """Machine state and active conditions are recovered from properties.factorylm_snapshot."""
        rows = [
            {
                "plc_tag": "tag1",
                "last_value_numeric": 1.0,
                "last_value_text": None,
                "last_value_bool": None,
                "last_seen_at": "2026-01-01T00:00:00Z",
                "latest_quality": "good",
                "properties": {
                    "factorylm_snapshot": {
                        "machine_state": "running",
                        "active_conditions": ["condition1"],
                        "snapshot_id": "snap-123",
                        "captured_at": "2026-01-01T00:00:00Z",
                        "provenance": {"producer": "plc_bridge"},
                    }
                },
            }
        ]

        result = _live_tag_rows_to_dict(rows)

        self.assertEqual(result["machine_state"], "running")
        self.assertEqual(result["active_conditions"], ["condition1"])
        self.assertEqual(result["snapshot_id"], "snap-123")

    def test_tag_value_fallback_chain(self):
        """Tag value falls back: numeric → bool → text."""
        # Test numeric-first
        row_numeric = {
            "plc_tag": "numeric",
            "last_value_numeric": 42.0,
            "last_value_text": None,
            "last_value_bool": None,
            "last_seen_at": "2026-01-01T00:00:00Z",
            "latest_quality": "good",
            "properties": None,
        }

        # Test bool second (no numeric)
        row_bool = {
            "plc_tag": "bool",
            "last_value_numeric": None,
            "last_value_text": None,
            "last_value_bool": True,
            "last_seen_at": "2026-01-01T00:00:00Z",
            "latest_quality": "good",
            "properties": None,
        }

        # Test text third
        row_text = {
            "plc_tag": "text",
            "last_value_numeric": None,
            "last_value_text": "hello",
            "last_value_bool": None,
            "last_seen_at": "2026-01-01T00:00:00Z",
            "latest_quality": "good",
            "properties": None,
        }

        result = _live_tag_rows_to_dict([row_numeric, row_bool, row_text])

        self.assertEqual(result["tags"][0]["value"], 42.0)
        self.assertEqual(result["tags"][1]["value"], True)
        self.assertEqual(result["tags"][2]["value"], "hello")

    def test_observed_at_field(self):
        """observed_at is set to last_seen_at (receiver time, not producer timestamp)."""
        rows = [
            {
                "plc_tag": "tag1",
                "last_value_numeric": 1.0,
                "last_value_text": None,
                "last_value_bool": None,
                "last_seen_at": "2026-01-01T12:30:45Z",
                "latest_quality": "good",
                "properties": None,
            }
        ]

        result = _live_tag_rows_to_dict(rows)

        self.assertEqual(result["tags"][0]["observed_at"], "2026-01-01T12:30:45Z")

    def test_multiple_tags_preserved(self):
        """Multiple tags are all preserved, not truncated."""
        rows = [
            {
                "plc_tag": f"tag{i}",
                "last_value_numeric": float(i),
                "last_value_text": None,
                "last_value_bool": None,
                "last_seen_at": "2026-01-01T00:00:00Z",
                "latest_quality": "good",
                "properties": None,
            }
            for i in range(10)
        ]

        result = _live_tag_rows_to_dict(rows)

        self.assertEqual(len(result["tags"]), 10)
        self.assertEqual(result["tags"][0]["tag_path"], "tag0")
        self.assertEqual(result["tags"][9]["tag_path"], "tag9")

    def test_captured_at_override(self):
        """captured_at_override is used when no snapshot metadata exists."""
        rows = [
            {
                "plc_tag": "tag1",
                "last_value_numeric": 1.0,
                "last_value_text": None,
                "last_value_bool": None,
                "last_seen_at": "2026-01-01T00:00:00Z",
                "latest_quality": "good",
                "properties": None,
            }
        ]

        override_ts = "2026-02-01T10:00:00Z"
        result = _live_tag_rows_to_dict(rows, captured_at_override=override_ts)

        self.assertEqual(result["captured_at"], override_ts)


if __name__ == "__main__":
    unittest.main()
