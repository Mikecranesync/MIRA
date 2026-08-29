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
        return _Returned(params.get("id"))

    def commit(self):
        pass


class _Returned:
    """What `INSERT … ON CONFLICT DO NOTHING RETURNING id` yields: the written
    row's id (nothing here ever conflicts, so it is the id the statement bound)."""

    def __init__(self, written_id):
        self.written_id = written_id

    def scalar_one_or_none(self):
        return self.written_id


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
