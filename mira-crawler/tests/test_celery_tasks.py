"""Tests for Celery task modules — discover, ingest, foundational, report.

All tests run offline with mocked external dependencies (Apify, Ollama, NeonDB).
No Redis broker needed — tasks are called directly, not via .delay().

Imports use local paths (celery_app, tasks.*) which work from mira-crawler/.
The Docker image uses mira_crawler.* paths via PYTHONPATH.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _fake_embedding(dim: int = 768) -> list[float]:
    return [0.01] * dim


def _fake_blocks(n: int = 3) -> list[dict]:
    return [
        {"text": f"Block {i} about VFD fault codes.", "page_num": i + 1, "section": f"Sec {i}"}
        for i in range(n)
    ]


def _fake_chunks(n: int = 3) -> list[dict]:
    return [
        {
            "text": f"Chunk {i} about motor bearing inspection.",
            "page_num": i + 1,
            "section": f"Sec {i}",
            "chunk_index": i,
            "chunk_type": "text",
        }
        for i in range(n)
    ]


# ---------------------------------------------------------------------------
# 1. Discover tasks
# ---------------------------------------------------------------------------


class TestDiscoverManufacturer:

    @patch.dict("os.environ", {"APIFY_API_TOKEN": ""})
    def test_skips_without_api_token(self):
        import importlib

        import tasks.discover as mod
        importlib.reload(mod)

        # Call the underlying function directly (not as Celery task)
        result = mod.discover_manufacturer(
            "Rockwell", "https://literature.rockwellautomation.com"
        )
        assert result["error"] == "no_token"
        assert result["urls_found"] == 0

    @patch("tasks.discover.APIFY_API_TOKEN", "test-token")
    def test_apify_crawl_and_queue(self):
        mock_client = MagicMock()
        mock_run = {"defaultDatasetId": "ds-123"}
        mock_client.actor.return_value.call.return_value = mock_run
        mock_client.dataset.return_value.list_items.return_value.items = [
            {"url": "https://example.com/manual1.pdf", "text": ""},
            {"url": "https://example.com/page", "text": "See https://example.com/manual2.pdf"},
        ]

        with (
            patch.dict("sys.modules", {"apify_client": MagicMock(ApifyClient=MagicMock(return_value=mock_client))}),
            patch("tasks.ingest.ingest_url") as mock_ingest,
        ):
            from tasks.discover import discover_manufacturer

            result = discover_manufacturer(
                "ABB", "https://library.e.abb.com", "cheerio", 200
            )

        assert result["manufacturer"] == "ABB"
        assert result["urls_found"] == 2
        assert mock_ingest.delay.call_count == 2

    def test_discover_all_fans_out(self):
        with patch("tasks.discover.discover_manufacturer") as mock_disc:
            from tasks.discover import MANUFACTURER_TARGETS, discover_all_manufacturers

            result = discover_all_manufacturers()

        assert result["targets_queued"] == len(MANUFACTURER_TARGETS)
        assert mock_disc.delay.call_count == len(MANUFACTURER_TARGETS)


# ---------------------------------------------------------------------------
# 2. Ingest tasks
# ---------------------------------------------------------------------------


class TestIngestUrl:

    @patch.dict("os.environ", {"MIRA_TENANT_ID": ""})
    def test_fails_without_tenant_id(self):
        import importlib

        import tasks.ingest as mod
        importlib.reload(mod)

        result = mod.ingest_url("https://example.com/test.pdf")
        assert result["error"] == "no_tenant_id"

    @patch.dict("os.environ", {"MIRA_TENANT_ID": "test-tenant"})
    def test_full_pipeline(self):
        fake_resp = MagicMock()
        fake_resp.content = b"%PDF-1.4 fake"
        fake_resp.headers = {"content-type": "application/pdf"}
        fake_resp.raise_for_status = MagicMock()

        chunks = _fake_chunks(5)

        with (
            patch("httpx.get", return_value=fake_resp),
            patch("ingest.converter.extract_from_pdf", return_value=_fake_blocks(5)),
            patch("ingest.chunker.chunk_blocks", return_value=chunks),
            patch("ingest.store.chunk_exists", return_value=False),
            patch("ingest.embedder.embed_text", return_value=_fake_embedding()),
            patch("ingest.store.insert_chunk", return_value="entry-123"),
            patch("ingest.quality.quality_gate", return_value=(True, "")),
        ):
            from tasks.ingest import ingest_url
            result = ingest_url("https://example.com/manual.pdf", "ABB", "ACS580")

        assert result["inserted"] == 5
        assert result["skipped"] == 0
        assert result["total"] == 5

    @patch.dict("os.environ", {"MIRA_TENANT_ID": "test-tenant"})
    def test_dedup_skips(self):
        fake_resp = MagicMock()
        fake_resp.content = b"<html>test</html>"
        fake_resp.headers = {"content-type": "text/html"}
        fake_resp.raise_for_status = MagicMock()

        with (
            patch("httpx.get", return_value=fake_resp),
            patch("ingest.converter.extract_from_html", return_value=_fake_blocks(3)),
            patch("ingest.chunker.chunk_blocks", return_value=_fake_chunks(3)),
            patch("ingest.store.chunk_exists", return_value=True),
            patch("ingest.embedder.embed_text") as mock_embed,
            patch("ingest.store.insert_chunk") as mock_insert,
        ):
            from tasks.ingest import ingest_url
            result = ingest_url("https://example.com/page.html")

        assert result["inserted"] == 0
        assert result["skipped"] == 3
        mock_embed.assert_not_called()
        mock_insert.assert_not_called()

    @patch.dict("os.environ", {"MIRA_TENANT_ID": "test-tenant"})
    def test_empty_extraction(self):
        fake_resp = MagicMock()
        fake_resp.content = b"empty"
        fake_resp.headers = {"content-type": "text/html"}
        fake_resp.raise_for_status = MagicMock()

        with (
            patch("httpx.get", return_value=fake_resp),
            patch("ingest.converter.extract_from_html", return_value=[]),
        ):
            from tasks.ingest import ingest_url
            result = ingest_url("https://example.com/empty.html")

        assert result["error"] == "no_content"

    @patch.dict("os.environ", {"MIRA_TENANT_ID": "test-tenant"})
    def test_embed_failure_graceful(self):
        fake_resp = MagicMock()
        fake_resp.content = b"%PDF-1.4"
        fake_resp.headers = {"content-type": "application/pdf"}
        fake_resp.raise_for_status = MagicMock()

        with (
            patch("httpx.get", return_value=fake_resp),
            patch("ingest.converter.extract_from_pdf", return_value=_fake_blocks(3)),
            patch("ingest.chunker.chunk_blocks", return_value=_fake_chunks(3)),
            patch("ingest.store.chunk_exists", return_value=False),
            patch("ingest.embedder.embed_text", return_value=None),
            patch("ingest.store.insert_chunk") as mock_insert,
        ):
            from tasks.ingest import ingest_url
            result = ingest_url("https://example.com/manual.pdf")

        assert result["inserted"] == 0
        mock_insert.assert_not_called()


# ---------------------------------------------------------------------------
# 3. Foundational KB
# ---------------------------------------------------------------------------


class TestFoundationalKB:

    def test_target_counts(self):
        from tasks.foundational import APIFY_TARGETS, DIRECT_TARGETS

        assert len(DIRECT_TARGETS) >= 10
        assert len(APIFY_TARGETS) >= 5

    def test_direct_targets_valid(self):
        from tasks.foundational import DIRECT_TARGETS

        for t in DIRECT_TARGETS:
            assert "name" in t, f"Missing name: {t}"
            assert "url" in t, f"Missing url: {t}"
            assert t["url"].startswith("http"), f"Bad URL: {t['name']}"

    def test_apify_targets_valid(self):
        from tasks.foundational import APIFY_TARGETS

        for t in APIFY_TARGETS:
            assert "name" in t
            assert "start_url" in t
            assert t["crawler_type"] in ("cheerio", "playwright")

    def test_fans_out_correctly(self):
        with (
            patch("tasks.ingest.ingest_url") as mock_ingest,
            patch("tasks.discover.discover_manufacturer") as mock_disc,
        ):
            from tasks.foundational import APIFY_TARGETS, DIRECT_TARGETS, ingest_foundational_kb

            result = ingest_foundational_kb()

        assert result["direct_queued"] == len(DIRECT_TARGETS)
        assert result["apify_queued"] == len(APIFY_TARGETS)
        assert mock_ingest.delay.call_count == len(DIRECT_TARGETS)
        assert mock_disc.delay.call_count == len(APIFY_TARGETS)

    def test_no_duplicate_names(self):
        from tasks.foundational import APIFY_TARGETS, DIRECT_TARGETS

        names = [t["name"] for t in DIRECT_TARGETS] + [t["name"] for t in APIFY_TARGETS]
        assert len(names) == len(set(names))


# ---------------------------------------------------------------------------
# 4. Celery config
# ---------------------------------------------------------------------------


class TestCeleryConfig:

    def test_app_imports(self):
        from celery_app import app

        assert app.main == "mira_crawler"

    def test_beat_schedule_removed(self):
        """Beat schedule was removed — Trigger.dev Cloud owns all scheduling."""
        import celeryconfig as cfg

        assert not hasattr(cfg, "beat_schedule"), (
            "beat_schedule must not exist in celeryconfig — scheduling is owned by Trigger.dev Cloud"
        )

    def test_task_routes(self):
        import celeryconfig as cfg

        assert "mira_crawler.tasks.discover.*" in cfg.task_routes
        assert "mira_crawler.tasks.ingest.*" in cfg.task_routes

    def test_sane_defaults(self):
        import celeryconfig as cfg

        assert cfg.worker_concurrency == 3
        assert cfg.task_serializer == "json"
        assert cfg.task_acks_late is True
