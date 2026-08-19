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


# ---------------------------------------------------------------------------
# The declared model must survive the write path VERBATIM — no normalizer.
# ---------------------------------------------------------------------------


class TestDeclaredModelIsNeverMangled:
    """`sources.yaml`'s `equipment_id` is provenance, not a hint.

    A mechanical "de-hyphenate the model" rule at this boundary would have to
    turn "PowerFlex-525" into "PowerFlex 525" while leaving "750-8202" alone —
    and nothing in the source entry distinguishes them, so the rule would be a
    guess about vendor naming. `ingest/manufacturer_normalize.py` sets the
    precedent for this boundary ("we do NOT impose a canonical of our own"):
    a curated alias map with identity passthrough, never a transform.
    """

    @pytest.mark.parametrize(
        "declared",
        ["750-8202", "PowerFlex 525", "SINAMICS G120 CU240", "GS10"],
    )
    def test_equipment_id_reaches_model_number_unchanged(
        self, tmp_path, captured, declared
    ):
        crawler = ManufacturerCrawler(_make_config(tmp_path))
        crawler.process(
            "https://cdn.example.com/manual.pdf", b"%PDF-", _entry(declared)
        )
        assert captured["model_number"] == declared

    def test_the_wago_part_number_keeps_its_hyphen_in_sources_yaml(self):
        """The negative case, pinned at the source of truth.

        750-8202 is a WAGO catalog number — the hyphen is part of the part
        number, not a separator anyone may normalize away.
        """
        sources = yaml.safe_load(
            (Path(__file__).resolve().parents[1] / "sources.yaml").read_text(
                encoding="utf-8"
            )
        )
        ids = [
            entry["equipment_id"]
            for tier in sources["tiers"].values()
            for entry in (tier or {}).values()
            if isinstance(entry, dict) and "equipment_id" in entry
        ]
        assert "750-8202" in ids, (
            "the WAGO part number must stay hyphenated — de-hyphenating it "
            "would invent a model that does not exist"
        )


# ---------------------------------------------------------------------------
# KG: the natural key and the uns_path must agree.
# ---------------------------------------------------------------------------


class _Result:
    def __init__(self, rows):
        self._rows = rows

    def first(self):
        return self._rows[0] if self._rows else None


class _FakeKgDb:
    """In-memory stand-in for kg_entities: UNIQUE (tenant_id, entity_type, name)."""

    def __init__(self):
        self.rows: list[dict] = []

    def execute(self, stmt, params=None):
        sql = " ".join(str(stmt).split())
        if "pg_constraint" in sql:
            return _Result([(1,)])
        if sql.startswith("SELECT name FROM kg_entities"):
            hits = [
                r
                for r in self.rows
                if r["tenant_id"] == params["tenant_id"]
                and r["entity_type"] == params["entity_type"]
                and r["uns_path"] == params["uns_path"]
            ]
            return _Result([(hits[0]["name"],)] if hits else [])
        if "INSERT INTO kg_entities" in sql:
            key = (params["tenant_id"], params["entity_type"], params["name"])
            for r in self.rows:
                if (r["tenant_id"], r["entity_type"], r["name"]) == key:
                    return _Result([(r["id"],)])  # ON CONFLICT DO UPDATE RETURNING id
            row = dict(params, id=f"ent-{len(self.rows) + 1}")
            self.rows.append(row)
            return _Result([(row["id"],)])
        raise AssertionError(f"unexpected SQL: {sql}")


def _upsert_equipment(db, manufacturer: str, model: str) -> str | None:
    from ingest import kg_writer
    from ingest.uns import equipment_unassigned_path

    return kg_writer.upsert_entity(
        tenant_id="t1",
        entity_type="equipment",
        name=model,
        uns_path=equipment_unassigned_path(manufacturer, model),
        conn=db,
    )


class TestKgEntityAddressIdempotence:
    """#3177 consequence: base_crawler now reaches the KG branch, so a second
    spelling of one model would mint a SECOND node at an occupied uns_path.

    `uns.slug()` collapses every non-alphanumeric run, so "PowerFlex 525" and
    "PowerFlex-525" address the same node while the natural key
    (tenant_id, entity_type, name) sees two. `upsert_entity` reconciles them.
    """

    @pytest.fixture
    def db(self, monkeypatch):
        from ingest import kg_writer

        monkeypatch.setattr(kg_writer, "_HAS_NAMED_CONSTRAINT", None)
        return _FakeKgDb()

    def test_the_two_spellings_really_do_share_one_address(self):
        from ingest.uns import equipment_unassigned_path

        assert equipment_unassigned_path(
            "Rockwell Automation", "PowerFlex-525"
        ) == equipment_unassigned_path("Rockwell Automation", "PowerFlex 525")

    def test_second_spelling_reuses_the_node_already_at_that_address(self, db):
        first = _upsert_equipment(db, "Rockwell Automation", "PowerFlex 525")
        second = _upsert_equipment(db, "Rockwell Automation", "PowerFlex-525")

        assert second == first, "a second spelling must not mint a second node"
        assert len(db.rows) == 1
        assert db.rows[0]["name"] == "PowerFlex 525", (
            "the incumbent spelling is kept — the writer does not impose a "
            "canonical of its own"
        )

    def test_first_writer_wins_regardless_of_which_spelling_arrives_first(self, db):
        first = _upsert_equipment(db, "Rockwell Automation", "PowerFlex-525")
        second = _upsert_equipment(db, "Rockwell Automation", "PowerFlex 525")

        assert second == first
        assert len(db.rows) == 1
        assert db.rows[0]["name"] == "PowerFlex-525"

    def test_a_hyphenated_part_number_is_stored_verbatim(self, db):
        """Negative case: 750-8202 must be unharmed."""
        from ingest.uns import equipment_unassigned_path

        assert _upsert_equipment(db, "WAGO", "750-8202") is not None
        assert db.rows[0]["name"] == "750-8202"
        assert db.rows[0]["uns_path"] == equipment_unassigned_path("WAGO", "750-8202")

    def test_distinct_part_numbers_stay_distinct(self, db):
        """Reconciliation keys on the ADDRESS, so it cannot merge two models."""
        a = _upsert_equipment(db, "WAGO", "750-8202")
        b = _upsert_equipment(db, "WAGO", "750-8203")

        assert a != b
        assert len(db.rows) == 2
        assert {r["name"] for r in db.rows} == {"750-8202", "750-8203"}

    def test_the_bare_kb_root_is_never_reconciled(self, db):
        """Migration 007 made the root the column DEFAULT — a triage bucket,
        not an address. Collapsing onto it would merge unrelated orphans."""
        from ingest import kg_writer
        from ingest.uns import kb_root

        a = kg_writer.upsert_entity(
            tenant_id="t1",
            entity_type="equipment",
            name="orphan a",
            uns_path=kb_root(),
            conn=db,
        )
        b = kg_writer.upsert_entity(
            tenant_id="t1",
            entity_type="equipment",
            name="orphan b",
            uns_path=kb_root(),
            conn=db,
        )
        assert a != b
        assert len(db.rows) == 2

    def test_reconciliation_is_scoped_to_the_tenant(self, db):
        from ingest import kg_writer
        from ingest.uns import equipment_unassigned_path

        path = equipment_unassigned_path("Rockwell Automation", "PowerFlex 525")
        a = kg_writer.upsert_entity(
            tenant_id="t1",
            entity_type="equipment",
            name="PowerFlex 525",
            uns_path=path,
            conn=db,
        )
        b = kg_writer.upsert_entity(
            tenant_id="t2",
            entity_type="equipment",
            name="PowerFlex-525",
            uns_path=path,
            conn=db,
        )
        assert a != b
        assert len(db.rows) == 2

    def test_a_different_entity_type_at_the_same_path_is_not_reconciled(self, db):
        from ingest import kg_writer
        from ingest.uns import equipment_unassigned_path

        path = equipment_unassigned_path("Rockwell Automation", "PowerFlex 525")
        a = kg_writer.upsert_entity(
            tenant_id="t1",
            entity_type="equipment",
            name="PowerFlex 525",
            uns_path=path,
            conn=db,
        )
        b = kg_writer.upsert_entity(
            tenant_id="t1",
            entity_type="component",
            name="PowerFlex-525",
            uns_path=path,
            conn=db,
        )
        assert a != b
        assert len(db.rows) == 2
