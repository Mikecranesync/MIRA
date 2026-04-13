"""Tests for the playwright crawler task — URL allowlist (M7) and deque fix (m8)."""
from __future__ import annotations


class TestIsAllowedDomain:
    """Unit tests for the _is_allowed_domain helper (M7)."""

    def test_allowed_exact_domain(self):
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("https://siemens.com/products") is True

    def test_allowed_www_prefix(self):
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("https://www.skf.com/bearings") is True

    def test_allowed_subdomain(self):
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("https://support.industry.siemens.com/docs") is True

    def test_allowed_deep_subdomain(self):
        from tasks.playwright_crawler import _is_allowed_domain

        # A subdomain of rockwellautomation.com should be allowed
        assert _is_allowed_domain("https://literature.rockwellautomation.com/idc/p.pdf") is True

    def test_disallowed_domain(self):
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("https://evil.com/attack") is False

    def test_disallowed_partial_match(self):
        """notsiemens.com must not match via suffix check."""
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("https://notsiemens.com/products") is False

    def test_empty_url_rejected(self):
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("") is False

    def test_malformed_url_rejected(self):
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("not-a-url") is False

    def test_ip_address_rejected(self):
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("http://192.168.1.1/data") is False

    def test_localhost_rejected(self):
        from tasks.playwright_crawler import _is_allowed_domain

        assert _is_allowed_domain("http://localhost:8080/") is False


class TestCrawlJsSiteAllowlist:
    """Verify crawl_js_site early-returns on disallowed domains (M7)."""

    def test_disallowed_domain_returns_error(self, monkeypatch):
        monkeypatch.setenv("MIRA_TENANT_ID", "test")
        from tasks.playwright_crawler import crawl_js_site

        result = crawl_js_site.run(start_url="https://evil.com/attack", max_pages=5)
        assert result["error"] == "domain_not_allowed"
        assert result["pages_crawled"] == 0
        assert result["urls_queued"] == 0

    def test_disallowed_domain_contains_start_url(self, monkeypatch):
        """The returned dict includes the rejected start_url for observability."""
        monkeypatch.setenv("MIRA_TENANT_ID", "test")
        from tasks.playwright_crawler import crawl_js_site

        result = crawl_js_site.run(start_url="https://evil.com/attack", max_pages=5)
        assert result.get("start_url") == "https://evil.com/attack"

    def test_playwright_not_available_for_allowed_domain(self, monkeypatch):
        """When Playwright is not installed, allowed domains get playwright_not_installed."""
        monkeypatch.setenv("MIRA_TENANT_ID", "test")
        import tasks.playwright_crawler as mod

        original = mod._PLAYWRIGHT_AVAILABLE
        mod._PLAYWRIGHT_AVAILABLE = False
        try:
            result = mod.crawl_js_site.run(
                start_url="https://siemens.com/products", max_pages=5
            )
            # Should NOT be domain_not_allowed — domain is fine
            assert result["error"] == "playwright_not_installed"
            assert result["pages_crawled"] == 0
        finally:
            mod._PLAYWRIGHT_AVAILABLE = original


class TestDequeUsed:
    """Verify the queue is a deque (m8 — O(1) popleft)."""

    def test_queue_is_deque_type(self):
        """Inspect the source to confirm deque import and usage."""
        import inspect

        import tasks.playwright_crawler as mod

        source = inspect.getsource(mod)
        # Both the import and the usage must appear in the source
        assert "from collections import deque" in source
        assert "deque([start_url])" in source
        assert "popleft()" in source
