"""Regression test for the manufacturer-crawl tier-scoping bug.

Root cause it locks down: ``discover_urls`` skipped every tier whose key did not
contain "manufacturer", so a ``--filter abb`` crawl never saw the ABB reference
PDFs catalogued under the ``5_reference`` tier — it discovered 0 URLs even though
the docs existed in ``sources.yaml``.

Hermetic: direct-pattern entries never call ``fetch`` (only index-pattern does),
so no network. A synthetic sources.yaml is written to tmp and the crawler's
``sources_file`` is pointed at it.

Self-inserts mira-crawler/ on sys.path."""

from __future__ import annotations

import sys
from pathlib import Path

_CRAWLER = Path(__file__).resolve().parent.parent  # mira-crawler/
if str(_CRAWLER) not in sys.path:
    sys.path.insert(0, str(_CRAWLER))

from config import CrawlerConfig  # noqa: E402
from crawler.manufacturer import ManufacturerCrawler  # noqa: E402

_SOURCES = """\
tiers:
  3_manufacturer:
    automationdirect_gs10:
      url: "https://example.test/gs10.pdf"
      manufacturer: AutomationDirect
      crawl_pattern: direct
  5_reference:
    abb_softstarter:
      url: "https://example.test/abb-softstarter.pdf"
      manufacturer: ABB
    skf_vibration:
      url: "https://example.test/skf.pdf"
      manufacturer: SKF
"""


def _crawler(tmp_path, manufacturers):
    src = tmp_path / "sources.yaml"
    src.write_text(_SOURCES, encoding="utf-8")
    config = CrawlerConfig()
    config.sources_file = src
    # BaseCrawler.__init__ mkdirs these; keep them off the read-only /app + /data defaults
    config.cache_dir = tmp_path / "cache"
    config.dedup_db_path = tmp_path / "dedup.db"
    config.incoming_dir = tmp_path / "incoming"
    return ManufacturerCrawler(config, manufacturers=manufacturers)


def test_specific_manufacturer_finds_reference_tier_docs(tmp_path):
    # the bug: abb's doc lives under 5_reference, not 3_manufacturer
    urls = _crawler(tmp_path, ["abb"]).discover_urls()
    found = [u["url"] for u in urls]
    assert "https://example.test/abb-softstarter.pdf" in found
    # filter still restricts to the requested manufacturer only
    assert all("skf" not in u and "gs10" not in u for u in found)


def test_crawl_all_stays_in_manufacturer_tier(tmp_path):
    # no filter → manufacturer tier only, so reference-tier docs are NOT
    # double-ingested by the daily "crawl all" pass
    urls = _crawler(tmp_path, None).discover_urls()
    found = [u["url"] for u in urls]
    assert "https://example.test/gs10.pdf" in found
    assert "https://example.test/abb-softstarter.pdf" not in found


def test_unknown_manufacturer_finds_nothing(tmp_path):
    # honest 0 for an OEM with no configured sources anywhere (the fanuc/siemens
    # content gap) — the fix must not fabricate matches
    urls = _crawler(tmp_path, ["fanuc"]).discover_urls()
    assert urls == []
