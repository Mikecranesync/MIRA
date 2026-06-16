"""Tests for Playwright fan-out refactor (#111).

Structural + behavioral tests ensuring the new tasks exist, delegate
properly, and preserve the existing domain allowlist.
"""
from __future__ import annotations

import sys
from pathlib import Path

CRAWLER_ROOT = Path(__file__).parent.parent
if str(CRAWLER_ROOT) not in sys.path:
    sys.path.insert(0, str(CRAWLER_ROOT))


# ── Structural tests ────────────────────────────────────────────────────────


class TestFanoutStructure:

    def test_discover_js_urls_task_exists(self):
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        assert "def discover_js_urls" in src
        assert '"tasks.playwright_crawler.discover_js_urls"' in src

    def test_render_and_ingest_page_task_exists(self):
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        assert "def render_and_ingest_page" in src
        assert '"tasks.playwright_crawler.render_and_ingest_page"' in src

    def test_discover_dispatches_pdfs_via_ingest_url(self):
        """Discovery task queues PDF URLs via ingest_url.delay()."""
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        # The fan-out dispatch must use ingest_url.delay for PDFs
        idx = src.find("def discover_js_urls")
        assert idx > 0
        body = src[idx : idx + 4000]
        assert "ingest_url.delay" in body
        assert "_is_pdf_url(link)" in body

    def test_discover_dispatches_articles_via_render_and_ingest(self):
        """Discovery task queues article URLs via render_and_ingest_page.delay()."""
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        idx = src.find("def discover_js_urls")
        body = src[idx : idx + 4000]
        assert "render_and_ingest_page.delay" in body

    def test_discover_honors_allowlist(self):
        """Both new tasks check _is_allowed_domain early."""
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        # discover_js_urls refuses disallowed domains
        idx_d = src.find("def discover_js_urls")
        assert 'domain_not_allowed' in src[idx_d : idx_d + 2000]
        # render_and_ingest_page also checks
        idx_r = src.find("def render_and_ingest_page")
        assert 'domain_not_allowed' in src[idx_r : idx_r + 2000]

    def test_discover_checks_robots(self):
        """Both tasks call _check_robots before fetching."""
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        idx_d = src.find("def discover_js_urls")
        assert "_check_robots" in src[idx_d : idx_d + 2000]
        idx_r = src.find("def render_and_ingest_page")
        assert "_check_robots" in src[idx_r : idx_r + 2000]

    def test_render_task_is_single_page(self):
        """render_and_ingest_page does NOT have BFS / deque / queue."""
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        idx = src.find("def render_and_ingest_page")
        body = src[idx : idx + 3000]
        # No BFS infrastructure in the per-URL task
        assert "deque" not in body
        assert "while queue" not in body

    def test_legacy_crawl_js_site_still_exists(self):
        """The old crawl_js_site is preserved for backward-compat."""
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        assert "def crawl_js_site" in src
        assert '"tasks.playwright_crawler.crawl_js_site"' in src

    def test_allowlist_unchanged(self):
        """ALLOWED_CRAWL_DOMAINS still contains the M7 entries."""
        src = (CRAWLER_ROOT / "tasks" / "playwright_crawler.py").read_text()
        assert "ALLOWED_CRAWL_DOMAINS" in src
        # Spot-check a few key entries from the existing M7 allowlist
        for domain in ("siemens.com", "skf.com", "rockwellautomation.com"):
            assert domain in src
