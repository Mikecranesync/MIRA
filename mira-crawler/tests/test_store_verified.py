"""The `verified` flag on the crawler write path (SP1 Unit 2b).

Zero real DB calls — the SQLAlchemy engine is faked so we can assert on the
exact bound parameters.
"""

from __future__ import annotations

import pytest
from ingest import store


class _FakeConn:
    def __init__(self, captured: dict) -> None:
        self.captured = captured

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, _stmt, params):
        self.captured.update(params)

    def commit(self):
        pass


class _FakeEngine:
    def __init__(self, captured: dict) -> None:
        self.captured = captured

    def connect(self):
        return _FakeConn(self.captured)


@pytest.fixture
def captured(monkeypatch) -> dict:
    box: dict = {}
    monkeypatch.setattr(store, "_engine", lambda: _FakeEngine(box))
    return box


def test_insert_chunk_defaults_to_unverified(captured: dict) -> None:
    """Every existing caller keeps writing verified=false."""
    entry_id = store.insert_chunk(
        tenant_id="t1",
        content="x",
        embedding=[0.1],
        source_url="u",
        chunk_index=0,
        is_private=False,
    )
    assert entry_id
    assert captured["verified"] is False


def test_insert_chunk_binds_verified_true_when_asked(captured: dict) -> None:
    entry_id = store.insert_chunk(
        tenant_id="t1",
        content="x",
        embedding=[0.1],
        source_url="u",
        chunk_index=0,
        verified=True,
        is_private=False,
    )
    assert entry_id
    assert captured["verified"] is True


def test_store_chunks_passes_verified_through(monkeypatch) -> None:
    seen: dict = {}

    monkeypatch.setattr(store, "chunk_exists", lambda *a, **k: False)

    def _fake_insert(**kwargs):
        seen.update(kwargs)
        return "entry-1"

    monkeypatch.setattr(store, "insert_chunk", _fake_insert)

    inserted = store.store_chunks(
        [({"text": "hello", "source_url": "u", "chunk_index": 0}, [0.1])],
        tenant_id="t1",
        manufacturer="AutomationDirect",
        verified=True,
        is_private=False,
    )
    assert inserted == 1
    assert seen["verified"] is True


def test_store_chunks_defaults_to_unverified(monkeypatch) -> None:
    seen: dict = {}

    monkeypatch.setattr(store, "chunk_exists", lambda *a, **k: False)

    def _fake_insert(**kwargs):
        seen.update(kwargs)
        return "entry-1"

    monkeypatch.setattr(store, "insert_chunk", _fake_insert)

    store.store_chunks(
        [({"text": "hello", "source_url": "u", "chunk_index": 0}, [0.1])],
        tenant_id="t1",
        is_private=False,
    )
    assert seen["verified"] is False


def _stub_writes(monkeypatch, rows: list) -> list:
    """Real store_chunks orchestration; only the DB and graph writes are stubbed."""
    from ingest import kg_writer

    calls: list = []
    monkeypatch.setattr(store, "chunk_exists", lambda *a, **k: False)
    monkeypatch.setattr(store, "insert_chunk", lambda **kw: rows.append(kw) or "e1")
    monkeypatch.setattr(
        kg_writer,
        "register_equipment_and_manual",
        lambda **kw: calls.append(kw) or ("eq1", "m1"),
    )
    monkeypatch.setattr(kg_writer, "link_chunk_to_equipment", lambda *a, **k: None)
    monkeypatch.setattr(kg_writer, "register_fault_code", lambda **kw: calls.append(kw))
    return calls


def test_multi_model_manual_keeps_the_list_but_mints_no_combined_equipment(monkeypatch) -> None:
    """#4141 Codex F1: retrieval metadata keeps every model; the graph gets none."""
    rows: list = []
    calls = _stub_writes(monkeypatch, rows)
    stored = store.store_chunks(
        [({"text": "Fault F0001 on the panel", "source_url": "u", "chunk_index": 0}, [0.1])],
        tenant_id="t1",
        manufacturer="Siemens",
        model_number="TP700 Comfort, TP900 Comfort",
        verified=True,
        is_private=False,
    )
    assert stored == 1
    assert rows[0]["model_number"] == "TP700 Comfort, TP900 Comfort"
    assert calls == []


def test_single_model_manual_still_registers_its_equipment(monkeypatch) -> None:
    rows: list = []
    calls = _stub_writes(monkeypatch, rows)
    store.store_chunks(
        [({"text": "text", "source_url": "u", "chunk_index": 0}, [0.1])],
        tenant_id="t1",
        manufacturer="AutomationDirect",
        model_number="GS10",
        is_private=False,
    )
    assert calls and calls[0]["model"] == "GS10"
