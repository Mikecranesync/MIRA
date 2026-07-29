"""OEM crawls land in the shared pool as trusted; nothing else changes.

SP1 Unit 2. The whole ingest pipeline is stubbed — no network, no DB, no Ollama.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from config import CrawlerConfig
from crawler import base_crawler
from crawler.csv_crawler import CSVCrawler
from crawler.curriculum import CurriculumCrawler
from crawler.manufacturer import ManufacturerCrawler

SHARED = "78917b56-f85f-43bb-9a08-1bb98a6cd6c3"
GARAGE = "e88bd0e8-8a84-4e30-9803-c0dc6efb07fe"


def _make_config(tmp_path: Path) -> CrawlerConfig:
    sources_file = tmp_path / "sources.yaml"
    sources_file.write_text(yaml.dump({"tiers": {}}))
    config = CrawlerConfig()
    config.cache_dir = tmp_path / "cache"
    config.dedup_db_path = tmp_path / "dedup.db"
    config.sources_file = sources_file
    config.rate_limit_sec = 0.0
    config.mira_tenant_id = GARAGE
    config.oem_tenant_id = SHARED
    return config


@pytest.fixture
def captured(monkeypatch) -> dict:
    """Stub the convert → chunk → embed → store pipeline, capture the store call."""
    box: dict = {}

    monkeypatch.setattr(
        base_crawler, "extract_from_html", lambda data, min_chars=0: [{"text": "block"}]
    )
    monkeypatch.setattr(
        base_crawler, "extract_from_pdf", lambda data, min_chars=0: [{"text": "block"}]
    )
    monkeypatch.setattr(
        base_crawler,
        "chunk_blocks",
        lambda blocks, **kwargs: [
            {"text": "chunk", "source_url": kwargs.get("source_url", "u"), "chunk_index": 0}
        ],
    )
    monkeypatch.setattr(
        base_crawler, "embed_batch", lambda chunks, **kwargs: [(chunks[0], [0.1])]
    )

    def _fake_store(
        valid,
        tenant_id,
        manufacturer="",
        model_number="",
        image_embedding=None,
        verified=False,
    ):
        box.update({"tenant_id": tenant_id, "verified": verified})
        return len(valid)

    monkeypatch.setattr(base_crawler, "store_chunks", _fake_store)
    return box


def _entry() -> dict:
    return {
        "format": "pdf",
        "source_type": "equipment_manual",
        "manufacturer": "AutomationDirect",
        "equipment_id": "",
    }


def test_manufacturer_crawl_writes_shared_pool_verified(tmp_path, captured) -> None:
    crawler = ManufacturerCrawler(_make_config(tmp_path))
    stored = crawler.process("https://example.com/gs20m.pdf", b"%PDF-1.4", _entry())

    assert stored == 1
    assert captured["tenant_id"] == SHARED
    assert captured["verified"] is True


def test_curriculum_crawl_is_unchanged(tmp_path, captured) -> None:
    """The inherited process() must NOT auto-trust non-OEM crawlers."""
    crawler = CurriculumCrawler(_make_config(tmp_path))
    stored = crawler.process("https://example.com/book.pdf", b"%PDF-1.4", _entry())

    assert stored == 1
    assert captured["tenant_id"] == GARAGE
    assert captured["verified"] is False


def test_base_crawler_defaults_to_untrusted() -> None:
    assert base_crawler.BaseCrawler.oem_trusted is False


def test_index_crawl_resolves_direct_pdf_urls_not_portal_root(tmp_path, monkeypatch) -> None:
    """The rule's auditability requirement: 'a row written by a trusted path
    should carry a directly de-referenceable source_url (never a portal
    root)' (.claude/rules/oem-crawler-trusted.md, "Why the backfill was
    pulled"). This asserts EXISTING behavior of
    ManufacturerCrawler._discover_index_urls (no production code touched):
    each entry's "url" is the resolved PDF link (urljoin of the href), never
    the index/portal page itself — that resolved url is exactly what
    process() later stores as source_url. Guards against a future change to
    _discover_index_urls silently starting to yield the base_url."""
    crawler = ManufacturerCrawler(_make_config(tmp_path))

    html = (
        b'<html><body>'
        b'<a href="/docs/gs10-manual.pdf">GS10 manual</a>'
        b'<a href="https://cdn.example.com/gs20-manual.pdf">GS20 manual</a>'
        b'</body></html>'
    )
    monkeypatch.setattr(crawler, "fetch", lambda url: html)

    base_url = "https://www.automationdirect.com/vfd-drives/"
    entries = crawler._discover_index_urls(base_url, {"manufacturer": "AutomationDirect"})
    urls = [e["url"] for e in entries]

    assert urls == [
        "https://www.automationdirect.com/docs/gs10-manual.pdf",
        "https://cdn.example.com/gs20-manual.pdf",
    ]
    assert base_url not in urls, "index() must never hand the portal root to process() as source_url"
    assert all(u.endswith(".pdf") for u in urls)


def test_oem_trusted_is_class_scoped() -> None:
    """Trust is a property of the crawler CLASS, not a tier string or an
    instance flag someone could flip at runtime — .claude/rules/oem-crawler-trusted.md
    "What is trusted" / "What is NOT trusted". Asserted directly on each class
    attribute so a future subclass flipping `oem_trusted = True` without a
    curated sources.yaml entry fails here, not three hops away in a store call.

    CSVCrawler explicitly included: a prior review flagged its absence from
    this class-level coverage."""
    assert base_crawler.BaseCrawler.oem_trusted is False
    assert CurriculumCrawler.oem_trusted is False
    assert CSVCrawler.oem_trusted is False
    assert ManufacturerCrawler.oem_trusted is True
