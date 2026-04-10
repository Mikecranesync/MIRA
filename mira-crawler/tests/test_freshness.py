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
