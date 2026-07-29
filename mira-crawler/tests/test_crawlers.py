"""Tests for base, curriculum, and manufacturer crawlers.

Zero real HTTP calls — all network interactions mocked.
"""

from __future__ import annotations

from pathlib import Path
from unittest.mock import MagicMock, patch

import yaml
from crawler.base_crawler import BaseCrawler
from crawler.curriculum import CurriculumCrawler
from crawler.manufacturer import ManufacturerCrawler

from config import CrawlerConfig


def _make_config(tmp_path: Path, sources: dict | None = None) -> CrawlerConfig:
    """Create config with temp paths and optional sources.yaml content."""
    sources_file = tmp_path / "sources.yaml"
    if sources is not None:
        sources_file.write_text(yaml.dump(sources))
    else:
        sources_file.write_text(yaml.dump({"tiers": {}}))

    config = CrawlerConfig()
    config.cache_dir = tmp_path / "cache"
    config.dedup_db_path = tmp_path / "dedup.db"
    config.sources_file = sources_file
    config.rate_limit_sec = 0.0  # no waiting in tests
    return config


SAMPLE_SOURCES = {
    "tiers": {
        "1_foundational": {
            "kuphaldt_liii": {
                "url": "https://ibiblio.org/kuphaldt/socratic/sinst/book/liii_2v32.pdf",
                "type": "curriculum",
                "format": "pdf",
                "license": "CC-BY-4.0",
            },
        },
        "2_government": {
            "osha_loto": {
                "url": "https://www.osha.gov/laws-regs/regulations/1910.147",
                "type": "standard",
                "format": "html",
            },
        },
        "3_manufacturer": {
            "automationdirect": {
                "url": "https://cdn.automationdirect.com/static/manuals/gs20m/gs20m.pdf",
                "type": "equipment_manual",
                "format": "pdf",
                "manufacturer": "AutomationDirect",
                "crawl_pattern": "direct",
            },
        },
    },
}


class TestBaseCrawler:
    def test_discover_urls_not_implemented(self, tmp_path):
        """Base crawler's discover_urls raises NotImplementedError."""
        config = _make_config(tmp_path)
        crawler = BaseCrawler(config)
        try:
            crawler.discover_urls()
            assert False, "Should have raised NotImplementedError"
        except NotImplementedError:
            pass

    @patch("crawler.base_crawler.httpx.Client")
    def test_fetch_respects_robots(self, mock_client_cls, tmp_path):
        """fetch() returns None when robots.txt blocks the URL."""
        config = _make_config(tmp_path)
        crawler = BaseCrawler(config)
        # Mock robots checker to block
        crawler.robots.is_allowed = MagicMock(return_value=False)
        result = crawler.fetch("https://example.com/blocked.pdf")
        assert result is None

    @patch("crawler.base_crawler.httpx.Client")
    def test_fetch_respects_dedup(self, mock_client_cls, tmp_path):
        """fetch() returns None when URL already indexed."""
        config = _make_config(tmp_path)
        crawler = BaseCrawler(config)
        crawler.robots.is_allowed = MagicMock(return_value=True)
        crawler.dedup.mark_indexed(b"data", source_url="https://example.com/doc.pdf")
        result = crawler.fetch("https://example.com/doc.pdf")
        assert result is None

    def test_dry_run_no_fetch(self, tmp_path):
        """crawl(dry_run=True) doesn't fetch anything."""
        config = _make_config(tmp_path, SAMPLE_SOURCES)
        crawler = CurriculumCrawler(config)
        stats = crawler.crawl(dry_run=True)
        assert stats["total_urls"] > 0
        assert stats["fetched"] == 0


class TestCurriculumCrawler:
    def test_discovers_all_tiers(self, tmp_path):
        """Discovers URLs from all non-manufacturer tiers."""
        config = _make_config(tmp_path, SAMPLE_SOURCES)
        crawler = CurriculumCrawler(config)
        urls = crawler.discover_urls()
        # Should find kuphaldt + osha, not automationdirect
        assert len(urls) == 2
        sources = {u["url"] for u in urls}
        assert "https://ibiblio.org/kuphaldt/socratic/sinst/book/liii_2v32.pdf" in sources
        assert "https://www.osha.gov/laws-regs/regulations/1910.147" in sources

    def test_filter_by_tier(self, tmp_path):
        """Filtering by tier name restricts results."""
        config = _make_config(tmp_path, SAMPLE_SOURCES)
        crawler = CurriculumCrawler(config, tiers=["1_foundational"])
        urls = crawler.discover_urls()
        assert len(urls) == 1
        assert urls[0]["source_type"] == "curriculum"

    def test_empty_sources(self, tmp_path):
        """Empty sources.yaml returns no URLs."""
        config = _make_config(tmp_path)
        crawler = CurriculumCrawler(config)
        assert crawler.discover_urls() == []


class TestManufacturerCrawler:
    def test_discovers_direct_urls(self, tmp_path):
        """Discovers direct PDF URLs from manufacturer tier."""
        config = _make_config(tmp_path, SAMPLE_SOURCES)
        crawler = ManufacturerCrawler(config)
        urls = crawler.discover_urls()
        assert len(urls) == 1
        assert urls[0]["manufacturer"] == "AutomationDirect"

    def test_filter_by_manufacturer(self, tmp_path):
        """Filtering by manufacturer name restricts results."""
        config = _make_config(tmp_path, SAMPLE_SOURCES)
        crawler = ManufacturerCrawler(config, manufacturers=["nonexistent"])
        urls = crawler.discover_urls()
        assert len(urls) == 0

    def test_filter_matches_automationdirect(self, tmp_path):
        """AutomationDirect filter matches."""
        config = _make_config(tmp_path, SAMPLE_SOURCES)
        crawler = ManufacturerCrawler(config, manufacturers=["automationdirect"])
        urls = crawler.discover_urls()
        assert len(urls) == 1


class TestSourcesYamlWellFormed:
    """Guard against a malformed sources.yaml entry silently dropping manuals.

    ManufacturerCrawler.discover_urls() has no validation — it just skips
    (`continue`) anything that isn't shaped the way it expects (see
    crawler/manufacturer.py): a non-dict source_def is skipped, and a
    "direct"-pattern entry with no `url` is skipped. Both failures are silent
    — no exception, the crawl just quietly discovers fewer URLs than the file
    promises. This tests the REAL repo sources.yaml, not a fixture.
    """

    SOURCES_PATH = Path(__file__).resolve().parent.parent / "sources.yaml"

    def test_parses_and_manufacturer_tier_entries_carry_required_keys(self):
        """sources.yaml parses as YAML, and every entry in a manufacturer-tier
        (tier key containing "manufacturer") is a mapping with the key(s)
        discover_urls() actually reads for its crawl_pattern:
        - crawl_pattern == "index": base_url or url (else skipped, line ~105).
        - anything else (default "direct"): a non-empty url (else skipped, line ~112).
        """
        data = yaml.safe_load(self.SOURCES_PATH.read_text(encoding="utf-8"))
        assert isinstance(data, dict)
        tiers = data.get("tiers", {})
        assert isinstance(tiers, dict) and tiers

        manufacturer_tiers = {k: v for k, v in tiers.items() if "manufacturer" in k}
        assert manufacturer_tiers, "expected at least one manufacturer tier"

        for tier_key, sources in manufacturer_tiers.items():
            assert isinstance(sources, dict), f"tier {tier_key} must be a mapping"
            for source_id, source_def in sources.items():
                assert isinstance(source_def, dict), (
                    f"{tier_key}.{source_id} must be a mapping, "
                    f"got {type(source_def).__name__}"
                )
                crawl_pattern = source_def.get("crawl_pattern", "direct")
                if crawl_pattern == "index":
                    assert source_def.get("base_url") or source_def.get("url"), (
                        f"{tier_key}.{source_id}: crawl_pattern=index needs "
                        "base_url or url, or discover_urls() silently drops it"
                    )
                else:
                    assert source_def.get("url"), (
                        f"{tier_key}.{source_id}: missing 'url' — "
                        "discover_urls() silently drops this entry"
                    )

    def test_manufacturer_crawler_discovers_every_direct_entry(self):
        """End-to-end: every direct-pattern manufacturer-tier URL in the real
        sources.yaml is actually surfaced by discover_urls() on a full
        (unfiltered) crawl — the same path a scheduled OEM crawl runs."""
        config = CrawlerConfig()
        config.sources_file = self.SOURCES_PATH
        crawler = ManufacturerCrawler(config)
        discovered = {u["url"] for u in crawler.discover_urls()}

        data = yaml.safe_load(self.SOURCES_PATH.read_text(encoding="utf-8"))
        expected = {
            source_def["url"]
            for tier_key, sources in data["tiers"].items()
            if "manufacturer" in tier_key
            for source_def in sources.values()
            if isinstance(source_def, dict)
            and source_def.get("crawl_pattern", "direct") == "direct"
            and source_def.get("url")
        }

        assert expected, "no direct-pattern manufacturer entries found to check"
        assert expected <= discovered
