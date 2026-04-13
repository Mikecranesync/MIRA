"""Tests for tasks/sitemaps.py — XML sitemap diff monitor.

All tests run offline — no network calls, no Redis, no Celery broker required.
"""

from __future__ import annotations

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------

_SAMPLE_SITEMAP_XML = """\
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/manuals/vfd-gs20-manual.pdf</loc>
    <lastmod>2024-03-15</lastmod>
  </url>
  <url>
    <loc>https://example.com/support/fault-codes</loc>
    <lastmod>2024-01-10</lastmod>
  </url>
  <url>
    <loc>https://example.com/products/plc-overview</loc>
    <lastmod>2023-11-20</lastmod>
  </url>
</urlset>
"""

_SITEMAP_NO_LASTMOD = """\
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <url>
    <loc>https://example.com/page-a</loc>
  </url>
  <url>
    <loc>https://example.com/page-b</loc>
    <lastmod></lastmod>
  </url>
</urlset>
"""

_SITEMAP_INDEX_XML = """\
<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://example.com/sitemap-products.xml</loc>
    <lastmod>2024-04-01</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://example.com/sitemap-support.xml</loc>
    <lastmod>2024-03-28</lastmod>
  </sitemap>
</sitemapindex>
"""

_MALFORMED_XML = "this is not xml <<< >>>"

_EMPTY_URLSET = """\
<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
</urlset>
"""


# ---------------------------------------------------------------------------
# 1. Parse sitemap with lastmod dates
# ---------------------------------------------------------------------------


class TestParseSitemap:

    def test_parse_sitemap_returns_all_urls(self):
        """Parses a standard sitemap and returns all <url> entries."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_SAMPLE_SITEMAP_XML)

        assert len(records) == 3

    def test_parse_sitemap_loc_values(self):
        """Each record has a non-empty 'loc' field with the correct URL."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_SAMPLE_SITEMAP_XML)
        locs = [r["loc"] for r in records]

        assert "https://example.com/manuals/vfd-gs20-manual.pdf" in locs
        assert "https://example.com/support/fault-codes" in locs
        assert "https://example.com/products/plc-overview" in locs

    def test_parse_sitemap_lastmod_values(self):
        """lastmod dates are correctly extracted as strings."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_SAMPLE_SITEMAP_XML)
        by_loc = {r["loc"]: r["lastmod"] for r in records}

        assert by_loc["https://example.com/manuals/vfd-gs20-manual.pdf"] == "2024-03-15"
        assert by_loc["https://example.com/support/fault-codes"] == "2024-01-10"

    def test_parse_sitemap_has_required_keys(self):
        """Every record must have 'loc' and 'lastmod' keys."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_SAMPLE_SITEMAP_XML)

        for record in records:
            assert "loc" in record
            assert "lastmod" in record


# ---------------------------------------------------------------------------
# 2. Parse sitemap with missing lastmod
# ---------------------------------------------------------------------------


class TestParseSitemapNoLastmod:

    def test_parse_sitemap_no_lastmod_returns_urls(self):
        """Sitemap without lastmod elements still returns all URLs."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_SITEMAP_NO_LASTMOD)

        assert len(records) == 2

    def test_parse_sitemap_missing_lastmod_is_empty_string(self):
        """Missing lastmod element yields empty string, not None or missing key."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_SITEMAP_NO_LASTMOD)
        by_loc = {r["loc"]: r["lastmod"] for r in records}

        assert by_loc["https://example.com/page-a"] == ""

    def test_parse_sitemap_empty_lastmod_is_empty_string(self):
        """Empty lastmod element text yields empty string."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_SITEMAP_NO_LASTMOD)
        by_loc = {r["loc"]: r["lastmod"] for r in records}

        assert by_loc["https://example.com/page-b"] == ""


# ---------------------------------------------------------------------------
# 3. Edge cases
# ---------------------------------------------------------------------------


class TestParseSitemapEdgeCases:

    def test_parse_sitemap_index(self):
        """Sitemap index files (sitemapindex) are parsed as loc entries."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_SITEMAP_INDEX_XML)

        assert len(records) == 2
        locs = [r["loc"] for r in records]
        assert "https://example.com/sitemap-products.xml" in locs

    def test_parse_malformed_xml_returns_empty(self):
        """Malformed XML returns empty list without raising."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_MALFORMED_XML)
        assert records == []

    def test_parse_empty_string_returns_empty(self):
        """Empty input string returns empty list."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap("")
        assert records == []

    def test_parse_empty_urlset_returns_empty(self):
        """Urlset with no <url> elements returns empty list."""
        from tasks.sitemaps import _parse_sitemap

        records = _parse_sitemap(_EMPTY_URLSET)
        assert records == []


# ---------------------------------------------------------------------------
# 4. Sitemap URL list validation
# ---------------------------------------------------------------------------


class TestSitemapUrls:

    def test_at_least_five_sitemap_urls(self):
        """At least 5 manufacturer sitemap URLs must be configured."""
        from tasks.sitemaps import SITEMAP_URLS

        assert len(SITEMAP_URLS) >= 5

    def test_all_urls_are_http(self):
        """All sitemap URLs must start with https."""
        from tasks.sitemaps import SITEMAP_URLS

        for url in SITEMAP_URLS:
            assert url.startswith("http"), f"Bad sitemap URL: {url}"

    def test_no_duplicate_sitemap_urls(self):
        """Sitemap URLs must be unique."""
        from tasks.sitemaps import SITEMAP_URLS

        assert len(SITEMAP_URLS) == len(set(SITEMAP_URLS))

    def test_sitemap_urls_end_with_xml(self):
        """All registered sitemap URLs should end with .xml."""
        from tasks.sitemaps import SITEMAP_URLS

        for url in SITEMAP_URLS:
            assert url.endswith(".xml"), f"Sitemap URL does not end with .xml: {url}"
