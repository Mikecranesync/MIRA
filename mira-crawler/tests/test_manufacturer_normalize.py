"""Tests for ingest-side manufacturer OCR/typo normalization (issue #1596).

Scope reminder (see module docstring): this collapses OCR/extraction
*misspellings* toward the cleanest observed spelling. It deliberately does
NOT do brand→parent canonicalization (e.g. "Allen-Bradley"→"Rockwell
Automation") — that is a separate, pre-existing catalog/resolver split
carved out in #1596 and must not be silently resolved here.
"""

from __future__ import annotations

import logging

from ingest.manufacturer_normalize import (
    FuzzyProposal,
    NormalizedManufacturer,
    normalize_manufacturer,
    propose_fuzzy_canonical,
)


class TestNormalizeManufacturerAliases:
    """The curated OCR-variant seed map collapses the issue's named cases."""

    def test_allen_bradley_ocr_variant(self):
        r = normalize_manufacturer("Alien-Bradley")
        assert r.canonical == "Allen-Bradley"
        assert r.method == "alias"
        assert r.confidence == 1.0

    def test_coffing_ocr_variants(self):
        for variant in ("Cofemo", "Cofing", "Cottins"):
            assert normalize_manufacturer(variant).canonical == "Coffing", variant

    def test_orlando_rigging_ocr_variant(self):
        assert normalize_manufacturer("Orldndo Rigging").canonical == "Orlando Rigging"

    def test_deshazo_ocr_variants(self):
        for variant in ("Deshaco", "Desha", "Deshao", "Deshazzo"):
            assert normalize_manufacturer(variant).canonical == "Deshazo", variant

    def test_alias_lookup_is_case_insensitive(self):
        assert normalize_manufacturer("alien-bradley").canonical == "Allen-Bradley"
        assert normalize_manufacturer("DESHACO").canonical == "Deshazo"


class TestNormalizeManufacturerIdentity:
    """Unknown vendors pass through unchanged — the resolver has no opinion
    on them, so identity is provably divergence-free."""

    def test_unknown_clean_vendor_passes_through(self):
        r = normalize_manufacturer("Acme Hoist")
        assert isinstance(r, NormalizedManufacturer)
        assert r.canonical == "Acme Hoist"
        assert r.method == "identity"
        assert r.confidence == 1.0
        assert r.raw == "Acme Hoist"

    def test_collapses_internal_whitespace(self):
        assert normalize_manufacturer("  Orlando   Rigging  ").canonical == "Orlando Rigging"

    def test_empty_input_yields_empty_canonical(self):
        for blank in ("", "   ", "\t\n"):
            r = normalize_manufacturer(blank)
            assert r.canonical == ""
            assert r.method == "identity"


class TestBrandParentCarveOut:
    """#1596 carve-out: do NOT collapse the AB brand to its corporate parent.
    The resolver maps query-side 'allen-bradley'→'Rockwell Automation'; that
    split is pre-existing and out of scope for this OCR-cleanup pass."""

    def test_clean_allen_bradley_is_not_rebranded(self):
        assert normalize_manufacturer("Allen-Bradley").canonical == "Allen-Bradley"

    def test_rockwell_is_not_rewritten(self):
        assert normalize_manufacturer("Rockwell Automation").canonical == "Rockwell Automation"


class TestFuzzyProposer:
    """The fuzzy layer PROPOSES (and logs) — it never merges. Intended for the
    gated catalog-backfill review, not for silent ingest-time merging."""

    def test_high_similarity_typo_is_proposed(self):
        p = propose_fuzzy_canonical("Deshazoo", known={"Deshazo", "Coffing"})
        assert isinstance(p, FuzzyProposal)
        assert p.canonical == "Deshazo"
        assert p.score >= 0.88

    def test_distinct_vendors_are_not_proposed(self):
        # Genuinely different vendors must stay below threshold — merging two
        # real vendors is the only irreversible failure mode here.
        assert propose_fuzzy_canonical("Banner", known={"Bauer"}) is None
        assert propose_fuzzy_canonical("ABB", known={"ABM"}) is None

    def test_exact_match_is_not_proposed(self):
        # Already canonical → nothing to propose.
        assert propose_fuzzy_canonical("Coffing", known={"Coffing", "Deshazo"}) is None

    def test_empty_or_no_known_returns_none(self):
        assert propose_fuzzy_canonical("Coffing", known=set()) is None
        assert propose_fuzzy_canonical("", known={"Coffing"}) is None

    def test_proposal_is_logged_not_applied(self, caplog):
        with caplog.at_level(logging.INFO, logger="mira-crawler.manufacturer_normalize"):
            propose_fuzzy_canonical("Deshazoo", known={"Deshazo"})
        assert any("Deshazoo" in rec.message and "Deshazo" in rec.message for rec in caplog.records)


class TestKgWriterWiring:
    """kg_writer is the boundary where the manufacturer string becomes a UNS
    path. Normalizing there (not just in store_chunks) covers every caller.
    We monkeypatch the DB-touching upserts to capture what was minted."""

    def _capture(self, monkeypatch):
        from ingest import kg_writer

        calls: list[dict] = []

        def fake_upsert_entity(**kwargs):
            calls.append(kwargs)
            return f"id-{len(calls)}"

        monkeypatch.setattr(kg_writer, "upsert_entity", fake_upsert_entity)
        monkeypatch.setattr(kg_writer, "upsert_relationship", lambda **kw: "rel-1")
        return kg_writer, calls

    def test_register_equipment_normalizes_manufacturer(self, monkeypatch):
        kg_writer, calls = self._capture(monkeypatch)
        kg_writer.register_equipment_and_manual(
            tenant_id="t1", manufacturer="Alien-Bradley", model="MR-2000"
        )
        equipment = calls[0]
        assert equipment["entity_type"] == "equipment"
        assert equipment["properties"]["manufacturer"] == "Allen-Bradley"
        assert "allen_bradley" in equipment["uns_path"]
        assert "alien" not in equipment["uns_path"]

    def test_register_fault_code_normalizes_manufacturer(self, monkeypatch):
        kg_writer, calls = self._capture(monkeypatch)
        kg_writer.register_fault_code(
            tenant_id="t1", equipment_id="eq1", manufacturer="Cofemo", fault_code="E01"
        )
        fault = calls[0]
        assert fault["entity_type"] == "fault_code"
        assert fault["properties"]["manufacturer"] == "Coffing"
        assert fault["name"].startswith("Coffing /")
        assert "coffing" in fault["uns_path"]


class TestInsertChunkWiring:
    """The Hub KB manufacturer catalog GROUPs BY knowledge_entries.manufacturer.
    That column is written by insert_chunk, which has callers beyond
    store_chunks (tasks/ingest.py), so normalization lives at this write
    boundary — not the orchestrator — or those callers still pollute (#1596)."""

    def test_insert_chunk_normalizes_manufacturer_in_sql_params(self, monkeypatch):
        import sys
        import types

        from ingest import store

        # Stub the sqlalchemy I/O boundary so the test is hermetic — we only
        # care that the normalized manufacturer reaches the INSERT params.
        fake_sa = types.ModuleType("sqlalchemy")
        fake_sa.text = lambda s: s
        monkeypatch.setitem(sys.modules, "sqlalchemy", fake_sa)

        captured: dict = {}

        class _FakeConn:
            def __enter__(self):
                return self

            def __exit__(self, *exc):
                return False

            def execute(self, _stmt, params):
                captured.update(params)

            def commit(self):
                pass

        class _FakeEngine:
            def connect(self):
                return _FakeConn()

        monkeypatch.setattr(store, "_engine", lambda: _FakeEngine())

        entry_id = store.insert_chunk(
            tenant_id="t1",
            content="x",
            embedding=[0.1],
            source_url="u",
            manufacturer="Alien-Bradley",
            model_number="MR-2000",
            chunk_index=0,
        )

        assert entry_id  # write path completed
        assert captured["manufacturer"] == "Allen-Bradley"
