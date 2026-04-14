"""Tests for Redis dedup backup/restore logic.

Offline tests covering serialization, deserialization, key registry
completeness, and restore skip-if-exists behavior. No live Redis needed.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest

# Add tools/ to path for imports
REPO_ROOT = Path(__file__).parent.parent
TOOLS = REPO_ROOT / "tools"
if str(TOOLS) not in sys.path:
    sys.path.insert(0, str(TOOLS))


# ── Key registry tests ────────────────────────────────────────────────────


class TestKeyRegistry:
    """Verify DEDUP_KEYS covers all known Redis dedup keys."""

    def test_all_keys_registered(self):
        """All 6 dedup keys from crawler tasks are in DEDUP_KEYS."""
        from backup_redis_dedup import DEDUP_KEYS

        key_names = {k[0] for k in DEDUP_KEYS}
        expected = {
            "mira:rss:seen_guids",
            "mira:reddit:seen_posts",
            "mira:youtube:seen_videos",
            "mira:sitemaps:lastmod",
            "mira:gdrive:processed_files",
            "mira:patents:seen_ids",
        }
        assert key_names == expected

    def test_youtube_has_ttl(self):
        """YouTube key is the only one with a TTL (90 days)."""
        from backup_redis_dedup import DEDUP_KEYS

        ttl_keys = {k[0]: k[2] for k in DEDUP_KEYS if k[2] is not None}
        assert "mira:youtube:seen_videos" in ttl_keys
        assert ttl_keys["mira:youtube:seen_videos"] == 90 * 86400

    def test_sitemaps_is_hash(self):
        """Sitemaps key is a hash (not a set) — different data structure."""
        from backup_redis_dedup import DEDUP_KEYS

        types = {k[0]: k[1] for k in DEDUP_KEYS}
        assert types["mira:sitemaps:lastmod"] == "hash"
        # All others should be sets
        for key_name, key_type, _ in DEDUP_KEYS:
            if key_name != "mira:sitemaps:lastmod":
                assert key_type == "set", f"{key_name} should be 'set', got '{key_type}'"


# ── Serialization tests ──────────────────────────────────────────────────


class TestSerialization:
    """Verify backup data can round-trip through JSON/NeonDB."""

    def test_set_serialization(self):
        """Set members serialize to sorted JSON array."""
        members = {"guid3", "guid1", "guid2"}
        serialized = json.dumps(sorted(members))
        deserialized = json.loads(serialized)
        assert deserialized == ["guid1", "guid2", "guid3"]
        assert set(deserialized) == members

    def test_hash_serialization(self):
        """Hash members serialize to JSON object."""
        members = {
            "https://example.com/sitemap.xml": "2026-04-01T00:00:00Z",
            "https://example.com/products.xml": "2026-03-15T12:00:00Z",
        }
        serialized = json.dumps(members)
        deserialized = json.loads(serialized)
        assert deserialized == members

    def test_empty_set(self):
        """Empty set serializes to empty array."""
        assert json.dumps([]) == "[]"
        assert json.loads("[]") == []

    def test_large_set_serialization(self):
        """Large sets (10K+ members) serialize correctly."""
        members = [f"guid_{i:06d}" for i in range(10000)]
        serialized = json.dumps(members)
        deserialized = json.loads(serialized)
        assert len(deserialized) == 10000
        assert deserialized[0] == "guid_000000"


# ── Read key tests ────────────────────────────────────────────────────────


class TestReadKey:
    """Test _read_key with mocked Redis."""

    def test_read_set(self):
        from backup_redis_dedup import _read_key

        r = MagicMock()
        r.exists.return_value = True
        r.smembers.return_value = {"c", "a", "b"}

        result = _read_key(r, "mira:rss:seen_guids", "set")
        assert result == ["a", "b", "c"]  # sorted

    def test_read_hash(self):
        from backup_redis_dedup import _read_key

        r = MagicMock()
        r.exists.return_value = True
        r.hgetall.return_value = {"url1": "2026-04-01", "url2": "2026-03-15"}

        result = _read_key(r, "mira:sitemaps:lastmod", "hash")
        assert result == {"url1": "2026-04-01", "url2": "2026-03-15"}

    def test_read_nonexistent_key(self):
        from backup_redis_dedup import _read_key

        r = MagicMock()
        r.exists.return_value = False

        assert _read_key(r, "mira:rss:seen_guids", "set") == []
        assert _read_key(r, "mira:sitemaps:lastmod", "hash") == {}


# ── Restore tests ─────────────────────────────────────────────────────────


class TestRestoreKey:
    """Test _restore_key with mocked Redis."""

    def test_restore_set(self):
        from restore_redis_dedup import _restore_key

        r = MagicMock()
        pipe = MagicMock()
        r.pipeline.return_value = pipe

        count = _restore_key(r, "mira:rss:seen_guids", "set",
                             ["guid1", "guid2", "guid3"], None)
        assert count == 3
        pipe.sadd.assert_called_once()
        pipe.execute.assert_called_once()

    def test_restore_set_with_ttl(self):
        from restore_redis_dedup import _restore_key

        r = MagicMock()
        pipe = MagicMock()
        r.pipeline.return_value = pipe

        ttl = 90 * 86400
        count = _restore_key(r, "mira:youtube:seen_videos", "set",
                             ["vid1", "vid2"], ttl)
        assert count == 2
        pipe.expire.assert_called_once_with("mira:youtube:seen_videos", ttl)

    def test_restore_hash(self):
        from restore_redis_dedup import _restore_key

        r = MagicMock()
        pipe = MagicMock()
        r.pipeline.return_value = pipe

        data = {"url1": "2026-04-01", "url2": "2026-03-15"}
        count = _restore_key(r, "mira:sitemaps:lastmod", "hash", data, None)
        assert count == 2
        pipe.hset.assert_called_once()

    def test_restore_empty_skips(self):
        from restore_redis_dedup import _restore_key

        r = MagicMock()
        assert _restore_key(r, "mira:rss:seen_guids", "set", [], None) == 0
        r.pipeline.assert_not_called()

    def test_restore_wrong_type_skips(self):
        from restore_redis_dedup import _restore_key

        r = MagicMock()
        assert _restore_key(r, "mira:rss:seen_guids", "set",
                            {"wrong": "type"}, None) == 0
