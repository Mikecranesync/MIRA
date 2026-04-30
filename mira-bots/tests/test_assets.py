"""Unit 5 — offline tests for UNS asset query helpers.

These tests do NOT touch NeonDB. They exercise:
  * ltree path validation (label rules, separator rules)
  * Format helpers (asset card + hierarchy listing)
  * Public-api guards (no NEON_DATABASE_URL -> empty list, no raise)

Live integration (real ltree queries against a seeded fixture tenant) is
the DoD verification step for Unit 5 — see plan §Verification.
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest
from shared import assets


class TestLtreePathValidation:
    """The regex is the first line of defense before SQL."""

    @pytest.mark.parametrize(
        "path",
        [
            "enterprise",
            "acme.site_a",
            "acme.site_a.line_2",
            "acme.site_a.line_2.cell_3",
            "abc123",
            "x_y_z.a_b_c",
            "Site1.Line2.Cell3",
        ],
    )
    def test_valid_paths(self, path):
        assert assets._validate_ltree_path(path) is True

    @pytest.mark.parametrize(
        "path",
        [
            "",
            ".",
            ".acme",
            "acme.",
            "acme..site_a",
            "acme.site a",  # space rejected
            "acme.site-a",  # hyphen rejected
            "acme.site/a",  # slash rejected
            "acme.site;DROP TABLE assets;--",
            "acme..",
        ],
    )
    def test_invalid_paths(self, path):
        assert assets._validate_ltree_path(path) is False


class TestFormatAssetCard:
    def test_full_asset(self):
        out = assets.format_asset_card(
            {
                "name": "VFD #1",
                "path": "acme.site_a.line_2.cell_3",
                "asset_tag": "AT-0001",
                "atlas_asset_id": "1234",
            }
        )
        assert "*VFD #1*" in out
        assert "`acme.site_a.line_2.cell_3`" in out
        assert "QR tag: `AT-0001`" in out
        assert "Atlas ID: 1234" in out

    def test_minimal_asset_no_optional_fields(self):
        out = assets.format_asset_card(
            {
                "name": None,
                "path": "acme.site_a",
                "asset_tag": None,
                "atlas_asset_id": None,
            }
        )
        # Falls back to path when name is missing
        assert "*acme.site_a*" in out
        assert "QR tag" not in out
        assert "Atlas ID" not in out


class TestFormatHierarchyList:
    def test_empty_top_level(self):
        out = assets.format_hierarchy_list([])
        assert "No assets registered yet." in out

    def test_empty_with_parent(self):
        out = assets.format_hierarchy_list([], parent_label="acme.site_a")
        assert "No assets under `acme.site_a`." in out

    def test_top_level_listing(self):
        rows = [
            {"path": "acme", "name": "Acme Corp"},
            {"path": "globex", "name": "Globex"},
        ]
        out = assets.format_hierarchy_list(rows)
        assert "Top-level assets:" in out
        assert "`acme` — Acme Corp" in out
        assert "`globex` — Globex" in out
        assert "/asset <path>" in out

    def test_children_listing_falls_back_to_last_label(self):
        rows = [{"path": "acme.site_a.line_2", "name": None}]
        out = assets.format_hierarchy_list(rows, parent_label="acme.site_a")
        # No name: falls back to the last label in the path.
        assert "`acme.site_a.line_2` — line_2" in out


class TestPublicApiSafety:
    """Helpers must never raise — return [] / None on any infra failure."""

    def test_list_top_levels_without_db_returns_empty(self):
        with patch.dict(os.environ, {}, clear=True):
            assert assets.list_top_levels("00000000-0000-0000-0000-000000000001") == []

    def test_list_children_without_db_returns_empty(self):
        with patch.dict(os.environ, {}, clear=True):
            assert assets.list_children("tid", "acme.site_a") == []

    def test_get_asset_without_db_returns_none(self):
        with patch.dict(os.environ, {}, clear=True):
            assert assets.get_asset("tid", "acme.site_a") is None

    def test_invalid_path_short_circuits_before_db(self):
        # Even with NEON_DATABASE_URL set, malformed path must not reach SQL.
        with patch.dict(os.environ, {"NEON_DATABASE_URL": "postgres://fake"}):
            assert assets.list_children("tid", "acme..site_a") == []
            assert assets.list_children("tid", "acme.site;DROP--") == []
            assert assets.get_asset("tid", "acme..") is None

    def test_empty_tenant_id_short_circuits(self):
        with patch.dict(os.environ, {"NEON_DATABASE_URL": "postgres://fake"}):
            assert assets.list_top_levels("") == []
            assert assets.list_children("", "acme") == []
            assert assets.get_asset("", "acme") is None

    def test_zero_or_negative_depth_returns_empty(self):
        with patch.dict(os.environ, {"NEON_DATABASE_URL": "postgres://fake"}):
            assert assets.list_top_levels("tid", depth=0) == []
            assert assets.list_top_levels("tid", depth=-1) == []
