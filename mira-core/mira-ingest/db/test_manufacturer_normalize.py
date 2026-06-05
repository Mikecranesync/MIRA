"""Tests for ingest-side manufacturer OCR/variant normalization (issue #1596).

mira-core/mira-ingest mirrors the crawler's normalizer at its own DB write
boundary so the Hub KB manufacturer catalog (GROUP BY
knowledge_entries.manufacturer) doesn't fragment one real vendor into several
rows when chunks arrive through this service.
"""

from __future__ import annotations

import sys
import types

from db.manufacturer_normalize import NormalizedManufacturer, normalize_manufacturer


class TestNormalizeManufacturerAliases:
    """The curated OCR-variant seed map collapses the issue's named cases."""

    def test_allen_bradley_ocr_variant(self):
        r = normalize_manufacturer("Alien-Bradley")
        assert r.canonical == "Rockwell Automation"
        assert r.method == "alias"
        assert r.confidence == 1.0

    def test_coffing_ocr_variant(self):
        assert normalize_manufacturer("Cofemo").canonical == "Coffing"

    def test_orlando_rigging_ocr_variant(self):
        assert normalize_manufacturer("Orldndo Rigging").canonical == "Orlando Rigging"

    def test_deshazo_ocr_variant(self):
        assert normalize_manufacturer("Deshaco").canonical == "Deshazo"

    def test_alias_lookup_is_case_insensitive(self):
        assert normalize_manufacturer("ALIEN-BRADLEY").canonical == "Rockwell Automation"


class TestNormalizeManufacturerIdentity:
    """Unknown vendors pass through unchanged; blank yields empty canonical."""

    def test_unknown_clean_vendor_passes_through(self):
        r = normalize_manufacturer("Acme Hoist")
        assert isinstance(r, NormalizedManufacturer)
        assert r.canonical == "Acme Hoist"
        assert r.method == "identity"
        assert r.confidence == 1.0
        assert r.raw == "Acme Hoist"

    def test_empty_input_yields_empty_canonical(self):
        for blank in ("", "   ", None):
            r = normalize_manufacturer(blank)
            assert r.canonical == ""
            assert r.method == "identity"


def _stub_sqlalchemy(monkeypatch):
    """Inject a fake sqlalchemy into sys.modules before neon.py imports it.

    neon.py does ``from sqlalchemy import create_engine, text`` and
    ``from sqlalchemy.pool import NullPool`` at module top, so both the
    package and its ``pool`` submodule must be present.
    """
    fake_sa = types.ModuleType("sqlalchemy")
    fake_sa.create_engine = lambda *a, **k: None
    fake_sa.text = lambda s: s
    fake_pool = types.ModuleType("sqlalchemy.pool")
    fake_pool.NullPool = object
    fake_sa.pool = fake_pool
    monkeypatch.setitem(sys.modules, "sqlalchemy", fake_sa)
    monkeypatch.setitem(sys.modules, "sqlalchemy.pool", fake_pool)


class _FakeConn:
    def __init__(self, captured):
        self._captured = captured

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, _stmt, params):
        self._captured.append(dict(params))

    def commit(self):
        pass


class _FakeEngine:
    def __init__(self, captured):
        self._captured = captured

    def connect(self):
        return _FakeConn(self._captured)


class TestInsertKnowledgeEntryWiring:
    """insert_knowledge_entry normalizes manufacturer before binding the SQL
    params — hermetic via a stubbed sqlalchemy boundary."""

    def test_insert_knowledge_entry_normalizes_manufacturer(self, monkeypatch):
        _stub_sqlalchemy(monkeypatch)
        from db import neon

        captured: list[dict] = []
        monkeypatch.setattr(neon, "_engine", lambda: _FakeEngine(captured))

        entry_id = neon.insert_knowledge_entry(
            tenant_id="t1",
            content="x",
            embedding=[0.1],
            manufacturer="Alien-Bradley",
            model_number="MR-2000",
            source_url="u",
            chunk_index=0,
            page_num=None,
            section=None,
        )

        assert entry_id
        assert captured[0]["manufacturer"] == "Rockwell Automation"


class TestInsertKnowledgeEntriesBatchWiring:
    """insert_knowledge_entries_batch normalizes each entry's manufacturer."""

    def test_batch_insert_normalizes_manufacturer(self, monkeypatch):
        _stub_sqlalchemy(monkeypatch)
        from db import neon

        captured: list[dict] = []
        monkeypatch.setattr(neon, "_engine", lambda: _FakeEngine(captured))

        count = neon.insert_knowledge_entries_batch(
            [
                {
                    "id": "x",
                    "tenant_id": "t1",
                    "source_type": "manual",
                    "manufacturer": "Cofemo",
                    "model_number": "MR-2000",
                    "content": "c",
                    "embedding": "[0.1]",
                    "source_url": "s",
                    "source_page": 0,
                    "metadata": "{}",
                    "chunk_type": "text",
                }
            ]
        )

        assert count == 1
        assert captured[0]["manufacturer"] == "Coffing"
