"""Regression: recall_knowledge must run BM25/fault streams when embedding is None.

Pre-fix the function early-returned `[]` whenever the embedding was missing,
which short-circuited BM25 even though BM25 doesn't need an embedding. That
produced the 2026-05-18 GS11 demo regression: Ollama embed sidecar (Bravo)
was unreachable from the VPS, so every bot reply hit NO_KB_COVERAGE and
fell back to generic-knowledge disclaimers despite GS10/GS11 manuals being
fully seeded in NeonDB and lexically retrievable.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, "mira-bots")

os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared import neon_recall  # noqa: E402
from shared.neon_recall import recall_knowledge  # noqa: E402


def _mock_engine_with_conn(conn: MagicMock) -> MagicMock:
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    return engine


def _patch_create_engine(engine):
    """recall_knowledge does `from sqlalchemy import create_engine` *inside*
    the function body (PLC0415), so we must patch the sqlalchemy module attr
    rather than a shared.neon_recall attr."""
    import sqlalchemy

    return patch.object(sqlalchemy, "create_engine", return_value=engine)


def test_recall_knowledge_blank_tenant_returns_empty():
    out = recall_knowledge([0.1] * 4, "", query_text="modbus gs11")
    assert out == []


def test_recall_knowledge_none_embedding_still_calls_bm25():
    """When embedding is None, vector stage is skipped but BM25 still runs."""
    conn = MagicMock()
    # BM25 returns one synthetic hit
    bm25_rows = [
        {
            "content": "GS11 holding register 8192 = motor speed",
            "manufacturer": "AutomationDirect",
            "model_number": "GS11",
            "equipment_type": "VFD",
            "source_type": "manual",
            "source_url": None,
            "source_page": 42,
            "metadata": {},
            "similarity": 7.5,
        }
    ]
    conn.execute.return_value.mappings.return_value.fetchall.return_value = bm25_rows
    engine = _mock_engine_with_conn(conn)

    with (
        _patch_create_engine(engine),
        patch.object(neon_recall, "_recall_bm25", return_value=bm25_rows) as bm25_spy,
        patch.object(neon_recall, "recall_fault_code", return_value=[]),
    ):
        results = recall_knowledge(None, "tenant-1", query_text="modbus parameters gs11 drive")

    # BM25 invoked exactly once
    bm25_spy.assert_called_once()
    # Result surfaces the BM25 hit
    assert any(r.get("model_number") == "GS11" for r in results)


def test_recall_knowledge_empty_list_embedding_treated_as_none():
    conn = MagicMock()
    conn.execute.return_value.mappings.return_value.fetchall.return_value = []
    engine = _mock_engine_with_conn(conn)

    with (
        _patch_create_engine(engine),
        patch.object(neon_recall, "_recall_bm25", return_value=[]) as bm25_spy,
    ):
        recall_knowledge([], "tenant-1", query_text="anything")

    # Empty list embedding == no embedding → BM25 still runs
    bm25_spy.assert_called_once()


def test_recall_knowledge_with_embedding_calls_vector_and_bm25():
    """Sanity: when embedding IS provided, both vector and BM25 paths fire."""
    conn = MagicMock()
    conn.execute.return_value.mappings.return_value.fetchall.return_value = []
    engine = _mock_engine_with_conn(conn)

    with (
        _patch_create_engine(engine),
        patch.object(neon_recall, "_recall_bm25", return_value=[]) as bm25_spy,
    ):
        recall_knowledge([0.1] * 4, "tenant-1", query_text="modbus gs11")

    # BM25 still called when embedding present (hybrid retrieval)
    bm25_spy.assert_called_once()
    # And the vector SELECT was issued at least once
    assert conn.execute.called
