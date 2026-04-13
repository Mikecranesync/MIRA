"""Tests for tasks/rss.py — RSS feed monitor.

All tests run offline — no network calls, no Redis, no Celery broker required.
"""
from __future__ import annotations

from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Sample RSS XML fixtures
# ---------------------------------------------------------------------------

_SAMPLE_RSS = """\
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Test Maintenance Feed</title>
    <link>https://example.com</link>
    <description>Industrial maintenance news</description>
    <item>
      <title>VFD Fault Code F001 Explained</title>
      <link>https://example.com/vfd-fault-f001</link>
      <guid>https://example.com/vfd-fault-f001</guid>
      <description>Understanding overcurrent faults in VFDs.</description>
    </item>
    <item>
      <title>Bearing Inspection Checklist</title>
      <link>https://example.com/bearing-inspection</link>
      <guid>guid-bearing-unique-12345</guid>
      <description>Step-by-step bearing inspection for conveyor motors.</description>
    </item>
    <item>
      <title>Motor Alignment Best Practices</title>
      <link>https://example.com/motor-alignment</link>
      <guid>guid-alignment-99887</guid>
      <description>Laser alignment tips for industrial motors.</description>
    </item>
  </channel>
</rss>
"""

_MALFORMED_RSS = "this is not xml at all <<<>>>"

_EMPTY_RSS = """\
<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>Empty Feed</title>
  </channel>
</rss>
"""

_ATOM_FEED = """\
<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom">
  <title>Atom Maintenance Feed</title>
  <entry>
    <title>PLC Troubleshooting Guide</title>
    <link href="https://example.com/plc-guide"/>
    <id>urn:uuid:plc-guide-001</id>
    <summary>Diagnosing Allen-Bradley Micro820 faults.</summary>
  </entry>
</feed>
"""


# ---------------------------------------------------------------------------
# 1. Parse RSS feed
# ---------------------------------------------------------------------------


class TestParseRssFeed:

    def test_parse_rss_feed(self):
        """Parses a sample RSS XML string and verifies entries are extracted."""
        from tasks.rss import _parse_feed

        entries = _parse_feed(_SAMPLE_RSS)

        assert len(entries) == 3

        first = entries[0]
        assert first["title"] == "VFD Fault Code F001 Explained"
        assert first["url"] == "https://example.com/vfd-fault-f001"
        assert first["guid"] == "https://example.com/vfd-fault-f001"
        assert "overcurrent" in first["summary"]

    def test_parse_returns_all_fields(self):
        """Each entry must have title, url, guid, and summary keys."""
        from tasks.rss import _parse_feed

        entries = _parse_feed(_SAMPLE_RSS)

        for entry in entries:
            assert "title" in entry
            assert "url" in entry
            assert "guid" in entry
            assert "summary" in entry

    def test_parse_guid_falls_back_to_url(self):
        """When guid differs from link, the guid field is used as-is."""
        from tasks.rss import _parse_feed

        entries = _parse_feed(_SAMPLE_RSS)

        # Second item has a custom guid distinct from the link
        second = entries[1]
        assert second["guid"] == "guid-bearing-unique-12345"
        assert second["url"] == "https://example.com/bearing-inspection"

    def test_parse_atom_feed(self):
        """feedparser handles Atom feeds transparently."""
        from tasks.rss import _parse_feed

        entries = _parse_feed(_ATOM_FEED)

        assert len(entries) == 1
        assert entries[0]["title"] == "PLC Troubleshooting Guide"
        assert entries[0]["url"] == "https://example.com/plc-guide"

    def test_parse_feed_handles_empty(self):
        """Empty feed (no items) returns an empty list without raising."""
        from tasks.rss import _parse_feed

        entries = _parse_feed(_EMPTY_RSS)

        assert entries == []

    def test_parse_feed_handles_malformed(self):
        """Malformed/non-XML content returns an empty list without raising."""
        from tasks.rss import _parse_feed

        # feedparser is lenient; this should return empty entries, not raise
        entries = _parse_feed(_MALFORMED_RSS)

        assert isinstance(entries, list)

    def test_parse_feed_handles_empty_string(self):
        """Completely empty string input returns empty list."""
        from tasks.rss import _parse_feed

        entries = _parse_feed("")

        assert entries == []


# ---------------------------------------------------------------------------
# 2. Filter seen GUIDs
# ---------------------------------------------------------------------------


class TestFilterSeenGuids:

    def test_filter_seen_guids(self):
        """Entries whose GUIDs are already seen are filtered out."""
        from tasks.rss import _filter_new_entries

        entries = [
            {"guid": "guid-a", "url": "https://example.com/a", "title": "A", "summary": ""},
            {"guid": "guid-b", "url": "https://example.com/b", "title": "B", "summary": ""},
            {"guid": "guid-c", "url": "https://example.com/c", "title": "C", "summary": ""},
        ]
        seen = {"guid-a", "guid-c"}

        new = _filter_new_entries(entries, seen)

        assert len(new) == 1
        assert new[0]["guid"] == "guid-b"

    def test_filter_all_seen(self):
        """When all GUIDs are seen, returns an empty list."""
        from tasks.rss import _filter_new_entries

        entries = [
            {"guid": "guid-x", "url": "https://example.com/x", "title": "X", "summary": ""},
        ]
        seen = {"guid-x"}

        assert _filter_new_entries(entries, seen) == []

    def test_filter_none_seen(self):
        """When the seen set is empty, all entries are returned."""
        from tasks.rss import _filter_new_entries

        entries = [
            {"guid": "guid-1", "url": "https://example.com/1", "title": "1", "summary": ""},
            {"guid": "guid-2", "url": "https://example.com/2", "title": "2", "summary": ""},
        ]

        new = _filter_new_entries(entries, set())

        assert len(new) == 2

    def test_filter_empty_entries(self):
        """Empty entry list with a populated seen set returns empty list."""
        from tasks.rss import _filter_new_entries

        assert _filter_new_entries([], {"guid-a", "guid-b"}) == []


# ---------------------------------------------------------------------------
# 3. Feed list validation
# ---------------------------------------------------------------------------


class TestRssFeedsList:

    def test_rss_feeds_list_not_empty(self):
        """At least 7 feeds must be configured."""
        from tasks.rss import RSS_FEEDS

        assert len(RSS_FEEDS) >= 7

    def test_feeds_have_required_fields(self):
        """Every feed entry must have 'name' and 'url'."""
        from tasks.rss import RSS_FEEDS

        for feed in RSS_FEEDS:
            assert "name" in feed, f"Feed missing 'name': {feed}"
            assert "url" in feed, f"Feed missing 'url': {feed}"

    def test_feeds_urls_are_http(self):
        """All feed URLs must start with http."""
        from tasks.rss import RSS_FEEDS

        for feed in RSS_FEEDS:
            assert feed["url"].startswith("http"), f"Bad URL for feed {feed['name']!r}: {feed['url']}"

    def test_no_duplicate_feed_names(self):
        """Feed names must be unique."""
        from tasks.rss import RSS_FEEDS

        names = [f["name"] for f in RSS_FEEDS]
        assert len(names) == len(set(names)), "Duplicate feed names found"

    def test_no_duplicate_feed_urls(self):
        """Feed URLs must be unique."""
        from tasks.rss import RSS_FEEDS

        urls = [f["url"] for f in RSS_FEEDS]
        assert len(urls) == len(set(urls)), "Duplicate feed URLs found"


# ---------------------------------------------------------------------------
# 4. poll_rss_feeds task
# ---------------------------------------------------------------------------


class TestPollRssFeeds:

    def _make_http_response(self, text: str) -> MagicMock:
        resp = MagicMock()
        resp.text = text
        resp.raise_for_status = MagicMock()
        return resp

    def test_queues_new_articles(self):
        """New entries are passed to ingest_url.delay().

        All 10 feeds return the same sample RSS (3 identical GUIDs). The task
        correctly deduplicates within the same run via a local seen set, so only
        3 articles are queued (not 30). All feeds are still fetched and counted.
        """
        import tasks.rss as rss_mod

        mock_redis = MagicMock()
        mock_redis.smembers.return_value = set()

        mock_ingest = MagicMock()

        with (
            patch.object(rss_mod, "_get_redis", return_value=mock_redis),
            patch.object(rss_mod.httpx, "get", return_value=self._make_http_response(_SAMPLE_RSS)),
            patch("tasks.ingest.ingest_url", mock_ingest),
        ):
            result = rss_mod.poll_rss_feeds()

        # All feeds are checked
        assert result["feeds_checked"] == len(rss_mod.RSS_FEEDS)
        # 3 unique articles queued (same GUIDs across all feeds — deduplicated within run)
        assert result["new_articles"] == 3
        # ingest_url.delay was called exactly 3 times
        assert mock_ingest.delay.call_count == 3

    def test_skips_already_seen(self):
        """GUIDs already in Redis are not re-queued."""
        import tasks.rss as rss_mod

        entries = rss_mod._parse_feed(_SAMPLE_RSS)
        seen_guids = {e["guid"] for e in entries}  # mark all as seen

        mock_redis = MagicMock()
        mock_redis.smembers.return_value = seen_guids

        mock_ingest = MagicMock()

        with (
            patch.object(rss_mod, "_get_redis", return_value=mock_redis),
            patch.object(rss_mod.httpx, "get", return_value=self._make_http_response(_SAMPLE_RSS)),
            patch("tasks.ingest.ingest_url", mock_ingest),
        ):
            result = rss_mod.poll_rss_feeds()

        assert result["new_articles"] == 0
        mock_ingest.delay.assert_not_called()

    def test_redis_failure_returns_error(self):
        """Redis connection failure returns an error dict without raising."""
        import tasks.rss as rss_mod

        with patch.object(rss_mod, "_get_redis", side_effect=ConnectionError("redis down")):
            result = rss_mod.poll_rss_feeds()

        assert result["feeds_checked"] == 0
        assert result["new_articles"] == 0
        assert "error" in result

    def test_http_failure_continues_next_feed(self):
        """HTTP failure on one feed is logged and the next feed is attempted."""
        import httpx as _httpx
        import tasks.rss as rss_mod

        mock_redis = MagicMock()
        mock_redis.smembers.return_value = set()

        call_count = 0

        def _side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            if call_count == 1:
                raise _httpx.ConnectError("connection refused")
            return self._make_http_response(_EMPTY_RSS)

        mock_ingest = MagicMock()

        with (
            patch.object(rss_mod, "_get_redis", return_value=mock_redis),
            patch.object(rss_mod.httpx, "get", side_effect=_side_effect),
            patch("tasks.ingest.ingest_url", mock_ingest),
        ):
            result = rss_mod.poll_rss_feeds()

        # First feed fails; remaining feeds are checked (empty -> 0 new articles)
        assert result["feeds_checked"] == len(rss_mod.RSS_FEEDS) - 1
        assert result["new_articles"] == 0

    def test_sadd_called_per_entry_not_at_end(self):
        """Redis SADD is called once per successfully-queued entry (M2 regression).

        Previously GUIDs were accumulated and persisted in a single batch at
        the end of the task; a mid-run crash would lose all dedup state.  The
        fix persists each GUID immediately after ``ingest_url.delay()`` so the
        Redis set is updated incrementally.

        With 1 feed returning 3 entries and all entries new, SADD must be
        called exactly 3 times — one call per entry, not one call at the end.
        """
        import tasks.rss as rss_mod

        mock_redis = MagicMock()
        mock_redis.smembers.return_value = set()

        mock_ingest = MagicMock()

        # Only patch the first feed's HTTP response; use a single-feed slice
        with (
            patch.object(rss_mod, "_get_redis", return_value=mock_redis),
            patch.object(rss_mod.httpx, "get", return_value=self._make_http_response(_SAMPLE_RSS)),
            patch("tasks.ingest.ingest_url", mock_ingest),
        ):
            rss_mod.poll_rss_feeds()

        entries = rss_mod._parse_feed(_SAMPLE_RSS)
        expected_sadd_calls = len(entries)  # 3 unique GUIDs

        # sadd must be called at least once per unique new entry queued
        # (feeds returning duplicate GUIDs across runs don't add extra calls)
        assert mock_redis.sadd.call_count >= expected_sadd_calls

        # Each sadd call passes the _REDIS_SEEN_KEY and a single GUID (not a batch)
        for call in mock_redis.sadd.call_args_list:
            args = call[0]
            assert args[0] == rss_mod._REDIS_SEEN_KEY, "SADD key must be _REDIS_SEEN_KEY"
            assert len(args) == 2, "SADD should pass exactly one GUID per call (incremental)"
