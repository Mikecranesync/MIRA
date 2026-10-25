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
        base_crawler, "extract_from_pdf", lambda data, min_chars=0, **kw: [{"text": "block"}]
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
        is_private=False,
    ):
        box.update(
            {
                "tenant_id": tenant_id,
                "verified": verified,
                "is_private": is_private,
                "model_number": model_number,
            }
        )
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
    assert captured["is_private"] is False  # OEM crawl -> shared corpus, never per-tenant


def test_curriculum_crawl_is_unchanged(tmp_path, captured) -> None:
    """The inherited process() must NOT auto-trust non-OEM crawlers."""
    crawler = CurriculumCrawler(_make_config(tmp_path))
    stored = crawler.process("https://example.com/book.pdf", b"%PDF-1.4", _entry())

    assert stored == 1
    assert captured["tenant_id"] == GARAGE
    assert captured["verified"] is False
    assert captured["is_private"] is False  # public crawl content stays shared-visible


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


def test_manufacturer_crawl_stores_the_sources_yaml_model(tmp_path, captured) -> None:
    """#4141: model-bound retrieval filters on model_number; an empty one hides the manual."""
    crawler = ManufacturerCrawler(_make_config(tmp_path))
    entry = {**_entry(), "model_number": "TP700 Comfort, TP900 Comfort"}
    crawler.process("https://example.com/comfort.pdf", b"%PDF-1.4", entry)

    assert captured["model_number"] == "TP700 Comfort, TP900 Comfort"


def test_entry_without_a_model_still_stores_empty(tmp_path, captured) -> None:
    crawler = ManufacturerCrawler(_make_config(tmp_path))
    crawler.process("https://example.com/gs20m.pdf", b"%PDF-1.4", _entry())

    assert captured["model_number"] == ""


def test_sources_yaml_model_reaches_the_crawl_entry(tmp_path) -> None:
    """#4141: a direct sources.yaml entry carries its model_number into process()."""
    config = _make_config(tmp_path)
    config.sources_file.write_text(
        yaml.dump(
            {
                "tiers": {
                    "3_manufacturer": {
                        "siemens_comfort": {
                            "url": "https://example.com/comfort.pdf",
                            "manufacturer": "Siemens",
                            "model_number": "TP700 Comfort",
                            "crawl_pattern": "direct",
                        }
                    }
                }
            }
        )
    )
    urls = ManufacturerCrawler(config).discover_urls()
    assert [u["model_number"] for u in urls] == ["TP700 Comfort"]


# ── Long curated manuals (Codex #4254 r1 F1) ────────────────────────────────
# The ATV320 Programming Manual is 460 pages and its OBF troubleshooting is on
# page 412; the extractor's default stops at 300. A curated source declares
# max_pages, and the crawler must pass it to every parser path.


def _pdf_with_pages(n: int, marker_page: int, marker: str) -> bytes:
    """A minimal text PDF of n pages; page `marker_page` (1-based) carries `marker`."""
    objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        None,
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    kids = []
    for i in range(1, n + 1):
        text = (
            marker
            if i == marker_page
            else f"Page {i} parameter table filler text for the test document."
        )
        stream = f"BT /F1 12 Tf 72 720 Td ({text}) Tj ET".encode()
        objs.append(f"<< /Length {len(stream)} >>\nstream\n{stream.decode()}\nendstream")
        content_id = len(objs)
        objs.append(
            f"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents {content_id} 0 R "
            "/Resources << /Font << /F1 3 0 R >> >> >>"
        )
        kids.append(f"{len(objs)} 0 R")
    objs[1] = f"<< /Type /Pages /Kids [{' '.join(kids)}] /Count {n} >>"
    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, body in enumerate(objs, start=1):
        offsets.append(len(out))
        out += f"{i} 0 obj\n{body}\nendobj\n".encode()
    xref = len(out)
    out += f"xref\n0 {len(objs) + 1}\n0000000000 65535 f \n".encode()
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += f"trailer\n<< /Size {len(objs) + 1} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode()
    return bytes(out)


OBF_TEXT = (
    "DC Bus Overvoltage OBF probable cause braking too sudden remedy increase deceleration time"
)


def test_extract_reads_past_page_300_when_the_source_declares_it() -> None:
    from ingest.converter import extract_from_pdf

    pdf = _pdf_with_pages(320, 312, OBF_TEXT)
    default = extract_from_pdf(pdf, min_chars=10)
    declared = extract_from_pdf(pdf, max_pages=480, min_chars=10)
    assert not any("OBF" in b["text"] for b in default)  # the default really stops at 300
    hits = [b for b in declared if "OBF" in b["text"]]
    assert hits and hits[0]["page_num"] == 312


def test_process_passes_the_declared_page_limit_to_the_parser(
    tmp_path, captured, monkeypatch
) -> None:
    seen: dict = {}

    def _pdf(data, min_chars=0, **kw):
        seen["pdf"] = kw.get("max_pages")
        return [{"text": "block"}]

    def _docling(data, min_chars=0, **kw):
        seen["docling"] = kw.get("max_pages")
        return []  # docling found nothing -> pdf fallback must get the same limit

    monkeypatch.setattr(base_crawler, "extract_from_pdf", _pdf)
    monkeypatch.setattr(base_crawler, "extract_from_docling", _docling)
    config = _make_config(tmp_path)
    crawler = ManufacturerCrawler(config)
    crawler.process("https://example.com/long.pdf", b"%PDF-1.4 a", {**_entry(), "max_pages": 480})
    assert seen == {"pdf": 480}

    config.use_docling = True
    crawler = ManufacturerCrawler(config)
    crawler.process("https://example.com/long2.pdf", b"%PDF-1.4 b", {**_entry(), "max_pages": 480})
    assert seen == {"pdf": 480, "docling": 480}


def test_no_declared_limit_keeps_the_parser_default(tmp_path, captured, monkeypatch) -> None:
    seen: dict = {}

    def _pdf(data, min_chars=0, **kw):
        seen["kw"] = kw
        return [{"text": "block"}]

    monkeypatch.setattr(base_crawler, "extract_from_pdf", _pdf)
    ManufacturerCrawler(_make_config(tmp_path)).process(
        "https://example.com/s.pdf", b"%PDF-1.4 c", _entry()
    )
    assert "max_pages" not in seen["kw"]


def test_the_curated_atv320_entry_declares_enough_pages() -> None:
    sources = yaml.safe_load((Path(__file__).resolve().parents[1] / "sources.yaml").read_text())
    entry = sources["tiers"]["3_manufacturer"]["schneider_altivar_atv320_programming"]
    assert entry["max_pages"] >= 460  # NVE41295.06 is 460 pages; OBF troubleshooting is on p412


def test_discovery_carries_max_pages(tmp_path) -> None:
    config = _make_config(tmp_path)
    config.sources_file.write_text(
        yaml.dump(
            {
                "tiers": {
                    "3_manufacturer": {
                        "long": {
                            "url": "https://oem.example.com/l.pdf",
                            "manufacturer": "Ex",
                            "max_pages": 480,
                        },
                        "short": {"url": "https://oem.example.com/s.pdf", "manufacturer": "Ex"},
                    }
                }
            }
        )
    )
    urls = {u["url"]: u for u in ManufacturerCrawler(config).discover_urls()}
    assert urls["https://oem.example.com/l.pdf"]["max_pages"] == 480
    assert "max_pages" not in urls["https://oem.example.com/s.pdf"]
