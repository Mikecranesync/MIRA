"""Tests for tasks/freshness.py — stale content audit.

All tests run offline — no NeonDB, no Redis, no Celery broker required.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# 1. TTL days — equipment_manual
# ---------------------------------------------------------------------------


class TestTtlDaysEquipmentManual:

    def test_ttl_days_equipment_manual_returns_365(self):
        """equipment_manual TTL must be 365 days."""
        from tasks.freshness import _get_ttl_days

        assert _get_ttl_days("equipment_manual") == 365

    def test_ttl_days_equipment_manual_is_int(self):
        """Return value must be an integer, not None."""
        from tasks.freshness import _get_ttl_days

        result = _get_ttl_days("equipment_manual")
        assert isinstance(result, int)


# ---------------------------------------------------------------------------
# 2. TTL days — never-expiring types
# ---------------------------------------------------------------------------


class TestTtlDaysCurriculum:

    def test_ttl_days_curriculum_returns_none(self):
        """curriculum source_type never expires — TTL must be None."""
        from tasks.freshness import _get_ttl_days

        assert _get_ttl_days("curriculum") is None

    def test_ttl_days_youtube_transcript_returns_none(self):
        """youtube_transcript never expires — TTL must be None."""
        from tasks.freshness import _get_ttl_days

        assert _get_ttl_days("youtube_transcript") is None

    def test_ttl_days_patent_returns_none(self):
        """patent never expires — TTL must be None."""
        from tasks.freshness import _get_ttl_days

        assert _get_ttl_days("patent") is None


# ---------------------------------------------------------------------------
# 3. TTL days — unknown / unrecognised source_type
# ---------------------------------------------------------------------------


class TestTtlDaysUnknown:

    def test_ttl_days_unknown_returns_sensible_default(self):
        """Unknown source_type returns a sensible default (90 days)."""
        from tasks.freshness import _get_ttl_days

        result = _get_ttl_days("totally_unknown_type")
        assert result == 90

    def test_ttl_days_unknown_returns_int(self):
        """Default return for unknown types must be an integer."""
        from tasks.freshness import _get_ttl_days

        result = _get_ttl_days("some_new_type")
        assert isinstance(result, int)
        assert result > 0

    def test_ttl_days_empty_string_returns_default(self):
        """Empty string source_type returns the default TTL."""
        from tasks.freshness import _get_ttl_days

        result = _get_ttl_days("")
        assert result == 90


# ---------------------------------------------------------------------------
# 4. All defined source_types
# ---------------------------------------------------------------------------


class TestAllDefinedTtls:

    def test_forum_post_ttl(self):
        """forum_post TTL is 30 days."""
        from tasks.freshness import _get_ttl_days

        assert _get_ttl_days("forum_post") == 30

    def test_knowledge_article_ttl(self):
        """knowledge_article TTL is 90 days."""
        from tasks.freshness import _get_ttl_days

        assert _get_ttl_days("knowledge_article") == 90

    def test_standard_ttl(self):
        """standard TTL is 180 days."""
        from tasks.freshness import _get_ttl_days

        assert _get_ttl_days("standard") == 180

    def test_rss_article_ttl(self):
        """rss_article TTL is 90 days."""
        from tasks.freshness import _get_ttl_days

        assert _get_ttl_days("rss_article") == 90

    def test_all_finite_ttls_are_positive(self):
        """All finite TTL values must be positive integers."""
        from tasks.freshness import _TTL_DAYS

        for source_type, days in _TTL_DAYS.items():
            if days is not None:
                assert days > 0, f"Non-positive TTL for {source_type}: {days}"

    def test_never_expire_types_are_none(self):
        """curriculum, youtube_transcript, and patent must have None TTLs."""
        from tasks.freshness import _TTL_DAYS

        never_expire = {"curriculum", "youtube_transcript", "patent"}
        for source_type in never_expire:
            assert _TTL_DAYS.get(source_type) is None, (
                f"{source_type} should have TTL=None but got {_TTL_DAYS.get(source_type)}"
            )


# ---------------------------------------------------------------------------
# 5. SQL parameterization — C3 security fix
# ---------------------------------------------------------------------------


class TestFindStaleEntriesParamsBoundNotInterpolated:
    """Verify _find_stale_entries uses bound params, not f-string SQL injection."""

    def test_find_stale_entries_uses_bound_params(self, monkeypatch):
        """Query passed to conn.execute must use :st_finite_ / :st_never_ placeholders."""
        import unittest.mock as mock

        captured: list[tuple] = []

        def fake_execute(query, params=None):
            captured.append((str(query), params))
            result = mock.MagicMock()
            result.fetchall.return_value = []
            return result

        fake_conn = mock.MagicMock()
        fake_conn.__enter__ = lambda s: s
        fake_conn.__exit__ = mock.MagicMock(return_value=False)
        fake_conn.execute = fake_execute

        fake_engine = mock.MagicMock()
        fake_engine.connect.return_value = fake_conn

        import tasks.freshness as freshness_mod

        monkeypatch.setattr(freshness_mod, "_engine", lambda: fake_engine)

        freshness_mod._find_stale_entries("test-tenant-id")

        assert len(captured) == 1, "Expected exactly one query execution"
        sql_text, params = captured[0]

        # Bound param names must appear in the SQL string
        assert ":st_finite_" in sql_text, "CASE clause must use :st_finite_N bound params"
        assert ":st_never_" in sql_text, "NOT IN clause must use :st_never_N bound params"

        # Values must be in the params dict, not embedded in SQL
        assert params is not None
        finite_keys = [k for k in params if k.startswith("st_finite_")]
        never_keys = [k for k in params if k.startswith("st_never_")]
        assert len(finite_keys) > 0, "Expected st_finite_N params in params dict"
        assert len(never_keys) > 0, "Expected st_never_N params in params dict"

    def test_sql_no_fstring_interpolation(self):
        """Source-level check: CASE clause must not interpolate source_type directly."""
        import inspect

        from tasks.freshness import _find_stale_entries

        src = inspect.getsource(_find_stale_entries)
        assert "WHEN source_type = '{" not in src, (
            "CASE clause must not interpolate source_type via f-string"
        )
        assert "source_type NOT IN ('{" not in src, (
            "NOT IN clause must not interpolate source_type via f-string"
        )


class TestNeverExpireTypesExcluded:
    """Verify never-expire types (curriculum, youtube_transcript, patent) are excluded."""

    def test_never_expire_types_excluded(self, monkeypatch):
        """Query must exclude curriculum, youtube_transcript, and patent."""
        import unittest.mock as mock

        captured: list[tuple] = []

        def fake_execute(query, params=None):
            captured.append((str(query), params))
            result = mock.MagicMock()
            result.fetchall.return_value = []
            return result

        fake_conn = mock.MagicMock()
        fake_conn.__enter__ = lambda s: s
        fake_conn.__exit__ = mock.MagicMock(return_value=False)
        fake_conn.execute = fake_execute

        fake_engine = mock.MagicMock()
        fake_engine.connect.return_value = fake_conn

        import tasks.freshness as freshness_mod

        monkeypatch.setattr(freshness_mod, "_engine", lambda: fake_engine)

        freshness_mod._find_stale_entries("test-tenant-id")

        assert len(captured) == 1
        sql_text, params = captured[0]

        # NOT IN clause must be present
        assert "NOT IN" in sql_text.upper(), "Query must contain NOT IN clause"

        # The never-expire source_type values must be in the params dict
        assert params is not None
        never_values = {v for k, v in params.items() if k.startswith("st_never_")}
        assert "curriculum" in never_values, "curriculum must be in NOT IN params"
        assert "youtube_transcript" in never_values, "youtube_transcript must be in NOT IN params"
        assert "patent" in never_values, "patent must be in NOT IN params"


class TestFiniteTypesIncluded:
    """Verify finite TTL types appear in the CASE expression params."""

    def test_finite_types_included(self, monkeypatch):
        """CASE params must include equipment_manual, knowledge_article, standard, etc."""
        import unittest.mock as mock

        captured: list[tuple] = []

        def fake_execute(query, params=None):
            captured.append((str(query), params))
            result = mock.MagicMock()
            result.fetchall.return_value = []
            return result

        fake_conn = mock.MagicMock()
        fake_conn.__enter__ = lambda s: s
        fake_conn.__exit__ = mock.MagicMock(return_value=False)
        fake_conn.execute = fake_execute

        fake_engine = mock.MagicMock()
        fake_engine.connect.return_value = fake_conn

        import tasks.freshness as freshness_mod

        monkeypatch.setattr(freshness_mod, "_engine", lambda: fake_engine)

        freshness_mod._find_stale_entries("test-tenant-id")

        assert len(captured) == 1
        _sql_text, params = captured[0]

        # Finite source_type values must appear in the params dict
        assert params is not None
        finite_values = {v for k, v in params.items() if k.startswith("st_finite_")}
        expected_finite = {"equipment_manual", "knowledge_article", "standard", "forum_post", "rss_article"}
        for expected in expected_finite:
            assert expected in finite_values, f"{expected} must be in CASE bound params"
