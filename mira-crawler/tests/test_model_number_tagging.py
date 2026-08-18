"""#3177 behavior locks: the crawler tags the model it was given.

`crawler/base_crawler.py::process()` read the source entry's model into
`equipment_id` (and passed it to chunking and dedup) but omitted it from the
`store_chunks(...)` call, so `store_chunks`' `model_number=""` default won.

That single omission broke three systems, and each gets a test here:

  1. the chunk row got a blank `model_number`, and `neon_recall._product_search`
     filters `model_number ILIKE :pat` — so the product-scoped retrieval stream
     could not see the chunk at all (measured on GS10: 11 rows of 4,295);
  2. `store.py`'s KG guard `if kg_writer is not None and manufacturer and
     model_number:` evaluated False, so no equipment/manual entity was ever
     registered;
  3. steps 2-3 nest under that entity, so `link_chunk_to_equipment` never ran
     (no `equipment_entity_id` FK) and the fault-code extractor never ran.

Zero real DB / network / Ollama calls — the whole pipeline is stubbed, same
pattern as test_oem_trust.py and test_write_path_visibility.py.
"""

from __future__ import annotations

from pathlib import Path

import pytest
import yaml
from config import CrawlerConfig
from crawler import base_crawler
from crawler.manufacturer import ManufacturerCrawler
from ingest import store

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
    """Stub convert -> chunk -> embed -> store; capture the store_chunks call."""
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
            {
                "text": "chunk",
                "source_url": kwargs.get("source_url", "u"),
                "chunk_index": 0,
                "equipment_id": kwargs.get("equipment_id", ""),
            }
        ],
    )
    monkeypatch.setattr(
        base_crawler, "embed_batch", lambda chunks, **kwargs: [(chunks[0], [0.1])]
    )

    def _fake_store(valid, tenant_id, manufacturer="", **kwargs):
        box.update(
            {
                "tenant_id": tenant_id,
                "manufacturer": manufacturer,
                "model_number": kwargs.get("model_number"),
                "is_private": kwargs.get("is_private"),
            }
        )
        return len(valid)

    monkeypatch.setattr(base_crawler, "store_chunks", _fake_store)
    return box


def _entry(equipment_id: str) -> dict:
    return {
        "format": "pdf",
        "source_type": "equipment_manual",
        "manufacturer": "AutomationDirect",
        "equipment_id": equipment_id,
    }


class TestBaseCrawlerForwardsModel:
    """The regression test for the actual #3177 defect."""

    def test_declared_equipment_id_reaches_model_number(self, tmp_path, captured):
        crawler = ManufacturerCrawler(_make_config(tmp_path))
        crawler.process("https://cdn.example.com/gs10usermanual.pdf", b"%PDF-", _entry("GS10"))

        assert captured["model_number"] == "GS10", (
            "base_crawler must forward the source entry's declared equipment_id "
            "as model_number — a blank tag makes the chunk invisible to "
            "_product_search AND skips all KG densification (#3177)"
        )

    def test_absent_equipment_id_stays_blank_and_is_not_invented(
        self, tmp_path, captured
    ):
        """No model declared -> "" explicitly. Never a filename guess.

        `chunker._extract_equipment_id("gs10usermanual.pdf")` returns
        "GS10USERMANUAL", which matches `ILIKE '%GS10%'` but is then discarded
        by `_product_search`'s suffix-exclude regex (#2914) — a tag that looks
        right in the database and is silently dropped at query time.
        """
        crawler = ManufacturerCrawler(_make_config(tmp_path))
        crawler.process("https://cdn.example.com/gs10usermanual.pdf", b"%PDF-", _entry(""))

        assert captured["model_number"] == ""
        assert "USERMANUAL" not in (captured["model_number"] or "")


class TestStoreChunksRequiresModel:
    def test_model_number_is_required(self):
        """A defaulted "" is exactly how this defect stayed invisible."""
        with pytest.raises(TypeError):
            store.store_chunks(
                [({"text": "x"}, [0.1])], tenant_id="t1", is_private=False
            )

    def test_threads_model_number_to_insert_chunk(self, monkeypatch):
        seen: dict = {}
        monkeypatch.setattr(store, "chunk_exists", lambda *a, **k: False)

        def _fake_insert(**kwargs):
            seen.update(kwargs)
            return "entry-1"

        monkeypatch.setattr(store, "insert_chunk", _fake_insert)
        store.store_chunks(
            [({"text": "x", "source_url": "u", "chunk_index": 0}, [0.1])],
            tenant_id="t1",
            manufacturer="AutomationDirect",
            model_number="GS10",
            is_private=False,
        )
        assert seen["model_number"] == "GS10"


class TestKgDensificationFollowsTheModelTag:
    """Blast-radius items 2 and 3: the KG branch is gated on model_number."""

    @pytest.fixture
    def kg(self, monkeypatch):
        from ingest import kg_writer

        calls: dict = {"equipment": [], "link": [], "fault": []}

        def _register(**kwargs):
            calls["equipment"].append(kwargs)
            return ("equip-1", "manual-1")

        monkeypatch.setattr(kg_writer, "register_equipment_and_manual", _register)
        monkeypatch.setattr(
            kg_writer,
            "link_chunk_to_equipment",
            lambda entry_id, equipment_id: calls["link"].append((entry_id, equipment_id)),
        )
        monkeypatch.setattr(
            kg_writer,
            "register_fault_code",
            lambda **kwargs: calls["fault"].append(kwargs),
        )
        monkeypatch.setattr(store, "chunk_exists", lambda *a, **k: False)
        monkeypatch.setattr(store, "insert_chunk", lambda **kwargs: "entry-1")
        return calls

    def test_model_tag_present_registers_equipment_and_links_chunk(self, kg):
        store.store_chunks(
            [({"text": "F004 fault", "source_url": "u", "chunk_index": 0}, [0.1])],
            tenant_id="t1",
            manufacturer="AutomationDirect",
            model_number="GS10",
            is_private=False,
        )
        assert len(kg["equipment"]) == 1, (
            "manufacturer + model_number must register the equipment/manual "
            "entity — this is the branch the blank tag silently skipped"
        )
        assert kg["equipment"][0]["model"] == "GS10"
        assert kg["link"] == [("entry-1", "equip-1")], (
            "the chunk must be linked to its equipment entity "
            "(equipment_entity_id FK)"
        )

    def test_blank_model_tag_skips_the_whole_kg_branch(self, kg):
        """Documents the guard as intentional for genuinely model-less callers.

        This is the OLD behavior for EVERY base_crawler document — which is why
        the fix above matters. A caller with no model still gets no KG entity,
        and that is correct; what was wrong was reaching it by accident.
        """
        store.store_chunks(
            [({"text": "F004 fault", "source_url": "u", "chunk_index": 0}, [0.1])],
            tenant_id="t1",
            manufacturer="AutomationDirect",
            model_number="",
            is_private=False,
        )
        assert kg["equipment"] == []
        assert kg["link"] == []
        assert kg["fault"] == []
