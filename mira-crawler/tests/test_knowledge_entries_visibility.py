"""CU-03 Gate 3 behavior lock — `knowledge_entries` write-path visibility.

Zero real DB calls: the SQLAlchemy engine is faked so every assertion is on the
exact SQL text and bound parameters a writer produces.

Two kinds of test live here, and the difference matters for the gate record:

* **Invariants** — properties that must hold before AND after CU-03. A change
  here is a regression.
* **Characterization** — what the write path does *today*. CU-03 deliberately
  changes some of these; the diff on this file is the unit's evidence that the
  change landed where it was aimed and nowhere else.

Why characterization first (doctrine §Gate 3): the backlog described today's
shapes as "OEM public, uploads private". That is **false on this path** — every
writer under `mira-crawler/` hardcodes `is_private=false`, including the ones
carrying non-public documents (`tasks/gdrive.py` feeds `ingest_url` with
`file://` paths). Locking the *desired* shape would have gone red immediately
and proved nothing. These tests lock the shape that actually ships.
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

    def execute(self, stmt, params):
        # Keep the statement too — today `is_private` is a SQL *literal*, not a
        # bound parameter, so params alone cannot see it.
        self.captured["_sql"] = str(stmt)
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


def _insert(**overrides) -> dict:
    """Call insert_chunk with the minimum viable arg set."""
    kwargs = {
        "tenant_id": "t1",
        "content": "x",
        "embedding": [0.1],
        "source_url": "https://example.invalid/m.pdf",
        "chunk_index": 0,
    }
    kwargs.update(overrides)
    return kwargs


# ---------------------------------------------------------------------------
# INVARIANTS — must hold before and after CU-03
# ---------------------------------------------------------------------------


def test_insert_chunk_always_states_is_private_in_the_statement(captured: dict) -> None:
    """The column is never omitted, so the DB default can never decide visibility.

    This is the invariant Contract 13 (`tests/test_architecture.py`) fences at
    the text level. It holds whether the value is a literal or a bind param.
    """
    store.insert_chunk(**_insert(is_private=False))
    assert "is_private" in captured["_sql"]


def test_insert_chunk_still_threads_verified(captured: dict) -> None:
    """CU-03 must not disturb the `verified` trust flag (oem-crawler-trusted.md)."""
    store.insert_chunk(**_insert(is_private=False, verified=True))
    assert captured["verified"] is True

    store.insert_chunk(**_insert(is_private=False))
    assert captured["verified"] is False


def test_insert_chunk_still_normalizes_manufacturer(captured: dict) -> None:
    """#1596 write-boundary normalization survives the signature change."""
    store.insert_chunk(**_insert(is_private=False, manufacturer="allen bradley"))
    assert captured["manufacturer"] == "Rockwell Automation"


def test_insert_chunk_returns_empty_string_on_db_error(monkeypatch) -> None:
    """Failure stays non-raising — callers count on the empty-string contract."""

    def _boom():
        raise RuntimeError("neon down")

    monkeypatch.setattr(store, "_engine", _boom)
    assert store.insert_chunk(**_insert(is_private=False)) == ""


# ---------------------------------------------------------------------------
# CHARACTERIZATION — what ships today; CU-03 changes these on purpose
# ---------------------------------------------------------------------------


def test_insert_chunk_binds_the_caller_supplied_visibility(captured: dict) -> None:
    """CU-03 (I-1): visibility is the caller's decision, bound as a parameter.

    Before CU-03 this was the SQL literal `false` and no caller could influence
    it — every crawler write landed in the shared corpus.
    """
    store.insert_chunk(**_insert(is_private=True))
    assert captured["is_private"] is True

    store.insert_chunk(**_insert(is_private=False))
    assert captured["is_private"] is False


def test_insert_chunk_requires_an_explicit_visibility_decision() -> None:
    """CU-03 (I-1): there is no silent default. Omitting it is a TypeError.

    A default — either value — would reintroduce exactly the failure mode this
    unit exists to close: a new writer inheriting a visibility nobody chose.
    """
    with pytest.raises(TypeError):
        store.insert_chunk(  # type: ignore[call-arg]
            tenant_id="t1",
            content="x",
            embedding=[0.1],
            source_url="u",
            chunk_index=0,
        )


def test_store_chunks_threads_visibility_through(monkeypatch) -> None:
    seen: dict = {}
    monkeypatch.setattr(store, "chunk_exists", lambda *a, **k: False)

    def _fake_insert(**kwargs):
        seen.update(kwargs)
        return "entry-1"

    monkeypatch.setattr(store, "insert_chunk", _fake_insert)

    store.store_chunks(
        [({"text": "hello", "source_url": "u", "chunk_index": 0}, [0.1])],
        tenant_id="t1",
        is_private=True,
    )
    assert seen["is_private"] is True


def test_store_chunks_requires_an_explicit_visibility_decision() -> None:
    with pytest.raises(TypeError):
        store.store_chunks(  # type: ignore[call-arg]
            [({"text": "hello", "source_url": "u", "chunk_index": 0}, [0.1])],
            tenant_id="t1",
        )
