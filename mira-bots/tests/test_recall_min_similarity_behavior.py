"""Behavioral regression: min_similarity actually FILTERS the vector stream (#2207).

Pre-fix the param did not exist and the vector stream was filtered at a hardcoded
0.70 floor *inside* recall_knowledge, before the worker's triage-relaxed gate could
see the rows. These tests stub the DB connection to return vector rows with known
similarity and call the REAL recall_knowledge with different thresholds, proving the
row-level filter behaviour — not merely that a parameter exists. They also drive the
REAL RAGWorker.process() and spy on recall_knowledge to prove the worker passes the
triage-relaxed threshold. All of these fail against origin/main (the 0.60 row is
always dropped at 0.70; the worker never passed a threshold).
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared import neon_recall  # noqa: E402
from shared.neon_recall import recall_knowledge  # noqa: E402
from shared.workers.rag_worker import RAGWorker  # noqa: E402
from unittest.mock import MagicMock  # noqa: E402


def _mock_engine_with_conn(conn: MagicMock) -> MagicMock:
    engine = MagicMock()
    engine.connect.return_value.__enter__ = MagicMock(return_value=conn)
    engine.connect.return_value.__exit__ = MagicMock(return_value=False)
    return engine


def _patch_create_engine(engine):
    import sqlalchemy

    return patch.object(sqlalchemy, "create_engine", return_value=engine)


def _make_vector_row(content: str, similarity: float) -> dict:
    return {
        "content": content,
        "manufacturer": "Test",
        "model_number": "Model",
        "equipment_type": "VFD",
        "source_type": "manual",
        "source_url": None,
        "source_page": 1,
        "metadata": {},
        "verified": True,
        "similarity": similarity,
    }


def _vector_only_conn(rows: list[dict]) -> MagicMock:
    """A connection whose FIRST execute (the vector query) returns ``rows`` and every
    later stage (fault ILIKE / product / BM25) returns empty — so we isolate the
    vector-stream similarity filter without other streams polluting the result."""
    conn = MagicMock()
    calls = [0]

    def _execute(*args, **kwargs):
        calls[0] += 1
        result = MagicMock()
        result.mappings.return_value.fetchall.return_value = rows if calls[0] == 1 else []
        return result

    conn.execute = _execute
    return conn


def _recall(rows, *, min_similarity, query_text="modbus timeout"):
    conn = _vector_only_conn(rows)
    with (
        _patch_create_engine(_mock_engine_with_conn(conn)),
        patch.object(neon_recall, "_recall_bm25", return_value=[]),
        patch.object(neon_recall, "recall_fault_code", return_value=[]),
    ):
        return recall_knowledge(
            [0.5] * 4, "tenant-1", query_text=query_text, min_similarity=min_similarity
        )


class TestMinSimilarityVectorFiltering:
    """The row-level similarity filter honours the effective threshold."""

    def test_default_threshold_filters_060(self):
        rows = [_make_vector_row("strong 0.85", 0.85), _make_vector_row("weak 0.60", 0.60)]
        results = _recall(rows, min_similarity=None)  # None -> env default 0.70
        assert [r["similarity"] for r in results] == [0.85], "0.60 must be filtered at 0.70"

    def test_medium_threshold_keeps_060(self):
        rows = [
            _make_vector_row("strong 0.85", 0.85),
            _make_vector_row("borderline 0.60", 0.60),
            _make_vector_row("weak 0.44", 0.44),
        ]
        results = _recall(rows, min_similarity=0.55)
        assert sorted(r["similarity"] for r in results) == [0.60, 0.85], "0.60 kept, 0.44 filtered"

    def test_low_threshold_045(self):
        rows = [
            _make_vector_row("strong 0.85", 0.85),
            _make_vector_row("above 0.46", 0.46),
            _make_vector_row("below 0.44", 0.44),
        ]
        results = _recall(rows, min_similarity=0.45)
        assert sorted(r["similarity"] for r in results) == [0.46, 0.85], "0.46 kept, 0.44 filtered"

    def test_boundary_is_inclusive(self):
        rows = [_make_vector_row("at 0.55", 0.55), _make_vector_row("below 0.54", 0.54)]
        results = _recall(rows, min_similarity=0.55)
        assert [r["similarity"] for r in results] == [0.55], ">= is inclusive; 0.54 filtered"

    def test_none_embedding_skips_vector_stage(self):
        conn = _vector_only_conn([_make_vector_row("x", 0.9)])
        with (
            _patch_create_engine(_mock_engine_with_conn(conn)),
            patch.object(neon_recall, "_recall_bm25", return_value=[]),
            patch.object(neon_recall, "recall_fault_code", return_value=[]),
        ):
            # No embedding -> vector stage skipped; min_similarity is irrelevant, no error.
            assert recall_knowledge(None, "tenant-1", query_text="gs10", min_similarity=0.99) == []


class TestWorkerPassesTriageThreshold:
    """RAGWorker.process() feeds recall_knowledge the triage-relaxed threshold."""

    def _worker(self):
        return RAGWorker(
            openwebui_url="http://mock-owui",
            api_key="test-key",
            collection_id="test-collection",
            nemotron=None,
            router=None,
            tenant_id="t",
        )

    def _state(self, confidence):
        ctx = {"history": []}
        if confidence is not None:
            ctx["triage_result"] = {"confidence": confidence}
        return {"state": "IDLE", "exchange_count": 0, "asset_identified": None, "context": ctx}

    async def _captured_min_sim(self, confidence):
        from shared.workers import rag_worker as rag_mod

        captured: list = []

        def fake_recall(embedding, tenant_id, *, query_text="", limit=5, **kwargs):
            captured.append(kwargs.get("min_similarity", "MISSING"))
            return []

        worker = self._worker()
        with (
            patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=[0.1] * 768)),
            patch.object(rag_mod._neon_recall, "recall_knowledge", side_effect=fake_recall),
            patch.object(
                worker,
                "_call_llm",
                new=AsyncMock(
                    return_value='{"reply":"ok","next_state":"IDLE","options":[],"confidence":"LOW"}'
                ),
            ),
        ):
            await worker.process("motor tripped", self._state(confidence), tenant_id="t")
        assert captured, "recall_knowledge was not called"
        return captured[0]

    @pytest.mark.asyncio
    async def test_medium_triage_passes_055(self):
        assert await self._captured_min_sim("medium") == 0.55

    @pytest.mark.asyncio
    async def test_low_triage_passes_045(self):
        assert await self._captured_min_sim("low") == 0.45

    @pytest.mark.asyncio
    async def test_high_triage_passes_none(self):
        assert await self._captured_min_sim("high") is None

    @pytest.mark.asyncio
    async def test_missing_triage_passes_none(self):
        assert await self._captured_min_sim(None) is None
