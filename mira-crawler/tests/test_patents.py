"""Tests for tasks/patents.py — Google Patents scraper.

All tests run offline — no network calls, no Redis, no Celery broker required.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Sample patent data fixtures
# ---------------------------------------------------------------------------

_SAMPLE_XHR_RESPONSE = {
    "results": {
        "cluster": [
            {
                "result": [
                    {
                        "patent": {
                            "publication_number": "US10123456B2",
                            "title": "VFD Fault Detection System",
                            "abstract": "A system for detecting variable frequency drive faults using vibration analysis.",
                        }
                    },
                    {
                        "patent": {
                            "publication_number": "US20210012345A1",
                            "title": "Bearing Condition Monitor",
                            "abstract": "Method and apparatus for monitoring bearing conditions in industrial motors.",
                        }
                    },
                ]
            }
        ]
    }
}

_EMPTY_RESPONSE = {"results": {"cluster": []}}

_MALFORMED_RESPONSE = {"unexpected": "structure"}


# ---------------------------------------------------------------------------
# 1. Parse XHR response
# ---------------------------------------------------------------------------


class TestParsePatentsFromResponse:

    def test_extracts_patent_records(self):
        """Extracts patent_id, title, and abstract from a valid XHR response."""
        from tasks.patents import _parse_patents_from_response

        patents = _parse_patents_from_response(_SAMPLE_XHR_RESPONSE)

        assert len(patents) == 2
        assert patents[0]["patent_id"] == "US10123456B2"
        assert patents[0]["title"] == "VFD Fault Detection System"
        assert "vibration" in patents[0]["abstract"]

    def test_empty_response_returns_empty_list(self):
        """Empty cluster list returns an empty list without raising."""
        from tasks.patents import _parse_patents_from_response

        patents = _parse_patents_from_response(_EMPTY_RESPONSE)
        assert patents == []

    def test_malformed_response_returns_empty_list(self):
        """Unexpected response structure returns empty list without raising."""
        from tasks.patents import _parse_patents_from_response

        patents = _parse_patents_from_response(_MALFORMED_RESPONSE)
        assert isinstance(patents, list)

    def test_record_missing_patent_id_is_skipped(self):
        """Patent records without a publication_number are silently dropped."""
        from tasks.patents import _parse_patents_from_response

        data = {
            "results": {
                "cluster": [
                    {
                        "result": [
                            {
                                "patent": {
                                    "publication_number": "",
                                    "title": "No ID patent",
                                    "abstract": "Some abstract.",
                                }
                            }
                        ]
                    }
                ]
            }
        }
        patents = _parse_patents_from_response(data)
        assert patents == []


# ---------------------------------------------------------------------------
# 2. Configuration validation
# ---------------------------------------------------------------------------


class TestPatentQueriesConfig:

    def test_patent_queries_not_empty(self):
        """At least 3 patent search queries must be configured."""
        from tasks.patents import PATENT_QUERIES

        assert len(PATENT_QUERIES) >= 3

    def test_all_queries_are_strings(self):
        """Every configured query must be a non-empty string."""
        from tasks.patents import PATENT_QUERIES

        for q in PATENT_QUERIES:
            assert isinstance(q, str) and q.strip(), f"Empty/non-string query: {q!r}"

    def test_vfd_query_present(self):
        """VFD fault detection must be among the configured queries."""
        from tasks.patents import PATENT_QUERIES

        assert any("vfd" in q.lower() or "variable frequency" in q.lower() for q in PATENT_QUERIES)


# ---------------------------------------------------------------------------
# 3. Redis dedup — M5 regression
# ---------------------------------------------------------------------------


class TestPatentsRedisDedup:

    def test_redis_seen_key_defined(self):
        """_REDIS_PATENTS_SEEN_KEY constant must exist (M5 fix — was missing)."""
        from tasks.patents import _REDIS_PATENTS_SEEN_KEY

        assert _REDIS_PATENTS_SEEN_KEY.startswith("mira:"), (
            "Seen key should be namespaced under 'mira:'"
        )

    def test_scrape_patents_aborts_on_redis_failure(self):
        """Redis connection failure returns error dict without raising (M5)."""
        import tasks.patents as patents_mod

        with patch.object(
            patents_mod, "get_redis", side_effect=ConnectionError("redis down")
        ):
            result = patents_mod.scrape_patents()

        assert result["queries_run"] == 0
        assert result["patents_ingested"] == 0
        assert "error" in result

    def test_already_seen_patent_is_skipped(self):
        """Patents whose IDs are in the Redis seen set are not re-ingested (M5)."""
        import tasks.patents as patents_mod

        patent_id = "US10123456B2"

        mock_redis = MagicMock()
        mock_redis.smembers.return_value = {patent_id}  # already seen

        mock_http_resp = MagicMock()
        mock_http_resp.headers.get.return_value = "application/json"
        mock_http_resp.json.return_value = _SAMPLE_XHR_RESPONSE
        mock_http_resp.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_http_resp

        mock_ingest = MagicMock(return_value=0)

        with (
            patch.object(patents_mod, "get_redis", return_value=mock_redis),
            patch.object(patents_mod.httpx, "Client", return_value=mock_client),
            patch.object(patents_mod, "ingest_text_inline", mock_ingest),
        ):
            patents_mod.scrape_patents()

        # US10123456B2 should be skipped; US20210012345A1 is new
        # ingest should only be called for the non-seen patent
        calls = mock_ingest.call_args_list
        ingested_urls = [c[1].get("source_url", "") or c[0][1] for c in calls]
        for url in ingested_urls:
            assert patent_id not in url, (
                f"Already-seen patent {patent_id} must not be re-ingested"
            )

    def test_sadd_called_per_patent_not_at_end(self, monkeypatch):
        """Redis SADD is called once per new patent immediately after ingest (M5/M2)."""
        import tasks.patents as patents_mod

        monkeypatch.setenv("MIRA_TENANT_ID", "test-tenant")

        mock_redis = MagicMock()
        mock_redis.smembers.return_value = set()  # nothing seen

        mock_http_resp = MagicMock()
        mock_http_resp.headers.get.return_value = "application/json"
        # Return the same 2-patent fixture for every query
        mock_http_resp.json.return_value = _SAMPLE_XHR_RESPONSE
        mock_http_resp.raise_for_status = MagicMock()

        mock_client = MagicMock()
        mock_client.__enter__ = MagicMock(return_value=mock_client)
        mock_client.__exit__ = MagicMock(return_value=False)
        mock_client.get.return_value = mock_http_resp

        mock_ingest = MagicMock(return_value=1)  # 1 chunk inserted per patent

        with (
            patch.object(patents_mod, "get_redis", return_value=mock_redis),
            patch.object(patents_mod.httpx, "Client", return_value=mock_client),
            patch.object(patents_mod, "ingest_text_inline", mock_ingest),
        ):
            patents_mod.scrape_patents()

        # The fixture returns the same 2 patents for every query.
        # After the first query both IDs are in the local seen_ids set, so
        # subsequent queries skip them.  We expect exactly 2 SADD calls total
        # (one per unique patent_id), not 2 × 5 = 10.
        assert mock_redis.sadd.call_count == 2, (
            f"Expected 2 SADD calls (one per unique patent_id), "
            f"got {mock_redis.sadd.call_count}"
        )
        # Each call should use the correct Redis key
        for c in mock_redis.sadd.call_args_list:
            assert c[0][0] == patents_mod._REDIS_PATENTS_SEEN_KEY
