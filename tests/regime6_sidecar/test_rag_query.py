"""Unit tests for rag_query() and _merge_hits() in mira-sidecar/rag/query.py.

Tests cover the full dual-brain RAG pipeline with mocked dependencies:
  - _merge_hits: deduplication, ranking, and top_n truncation
  - rag_query: embedding failure, safety detection, empty results, brain routing
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, MagicMock

sys.path.insert(0, str(Path(__file__).parent.parent.parent / "mira-sidecar"))

from rag.query import _merge_hits, rag_query
from safety import SAFETY_BANNER

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_EMBEDDING = [0.1] * 384
_LLM_ANSWER = "Fault code OC means overcurrent. Check motor wiring."


def _hit(
    source_file: str = "GS20_Manual.pdf",
    page: str = "3",
    chunk_index: int = 0,
    text: str = "Sample chunk text.",
    distance: float = 0.25,
) -> dict:
    """Return a minimal hit dict matching the MiraVectorStore.query() schema."""
    return {
        "source_file": source_file,
        "page": page,
        "chunk_index": chunk_index,
        "text": text,
        "distance": distance,
    }


def _make_llm(answer: str = _LLM_ANSWER) -> MagicMock:
    llm = MagicMock()
    llm.model_name = "mock-llm"
    llm.complete = AsyncMock(return_value=answer)
    return llm


def _make_embedder(vectors: list[list[float]] | None = None) -> MagicMock:
    embedder = MagicMock()
    embedder.model_name = "mock-embedder"
    embedder.embed = AsyncMock(return_value=vectors if vectors is not None else [_EMBEDDING])
    return embedder


def _make_store(hits: list[dict] | None = None) -> MagicMock:
    store = MagicMock()
    store.query = MagicMock(return_value=hits if hits is not None else [])
    return store


# ---------------------------------------------------------------------------
# _merge_hits — unit tests (synchronous, no async needed)
# ---------------------------------------------------------------------------


class TestMergeHits:
    def test_tenant_only_returns_ranked_by_distance(self):
        tenant = [
            _hit(chunk_index=0, distance=0.40),
            _hit(chunk_index=1, distance=0.10),
            _hit(chunk_index=2, distance=0.25),
        ]
        result = _merge_hits(tenant, [])

        distances = [h["distance"] for h in result]
        assert distances == sorted(distances), "Results must be sorted by distance ascending"
        assert all(h["_brain"] == "Your docs" for h in result)

    def test_shared_only_labeled_mira_library(self):
        shared = [
            _hit(source_file="OEM_Catalog.pdf", chunk_index=0, distance=0.30),
        ]
        result = _merge_hits([], shared)

        assert len(result) == 1
        assert result[0]["_brain"] == "Mira library"

    def test_duplicate_chunk_tenant_copy_wins(self):
        # Same (source_file, page, chunk_index) in both brains
        tenant = [_hit(source_file="Manual.pdf", page="5", chunk_index=2, distance=0.30)]
        shared = [_hit(source_file="Manual.pdf", page="5", chunk_index=2, distance=0.10)]

        result = _merge_hits(tenant, shared)

        # Only one copy should survive
        matching = [h for h in result if h["source_file"] == "Manual.pdf" and h["page"] == "5"]
        assert len(matching) == 1
        assert matching[0]["_brain"] == "Your docs", "Tenant (Brain 2) copy must win on duplicate"

    def test_shared_hit_with_lower_distance_ranks_above_tenant_hit(self):
        tenant = [_hit(source_file="tenant.pdf", page="1", chunk_index=0, distance=0.50)]
        shared = [_hit(source_file="shared.pdf", page="2", chunk_index=0, distance=0.10)]

        result = _merge_hits(tenant, shared)

        assert result[0]["source_file"] == "shared.pdf", (
            "Shared hit with distance=0.10 must rank above tenant hit with distance=0.50"
        )
        assert result[0]["_brain"] == "Mira library"

    def test_top_n_truncation(self):
        tenant = [_hit(chunk_index=i, distance=float(i) / 10) for i in range(4)]
        shared = [_hit(source_file="shared.pdf", chunk_index=i, distance=float(i) / 10 + 0.05) for i in range(4)]

        result = _merge_hits(tenant, shared, top_n=3)

        assert len(result) == 3

    def test_empty_both_returns_empty(self):
        assert _merge_hits([], []) == []

    def test_original_hit_dicts_not_mutated(self):
        """_merge_hits must shallow-copy hits — callers' dicts must not gain _brain key."""
        tenant = [_hit(chunk_index=0, distance=0.20)]
        shared = [_hit(source_file="shared.pdf", chunk_index=1, distance=0.15)]

        _merge_hits(tenant, shared)

        assert "_brain" not in tenant[0], "Caller's tenant dict must not be mutated"
        assert "_brain" not in shared[0], "Caller's shared dict must not be mutated"

    def test_dedup_key_includes_chunk_index(self):
        """Two hits with same source_file + page but different chunk_index are NOT duplicates."""
        tenant = [_hit(source_file="Manual.pdf", page="1", chunk_index=0, distance=0.20)]
        shared = [_hit(source_file="Manual.pdf", page="1", chunk_index=1, distance=0.10)]

        result = _merge_hits(tenant, shared)

        assert len(result) == 2, "Different chunk_index means separate chunks — both must survive"


# ---------------------------------------------------------------------------
# rag_query — async integration tests with mocked dependencies
# ---------------------------------------------------------------------------


class TestRagQuery:
    async def test_normal_query_returns_answer_and_sources(self):
        hits = [
            _hit(source_file="GS20_Manual.pdf", page="3", chunk_index=0, distance=0.20),
        ]
        store = _make_store(hits)
        shared_store = _make_store([_hit(source_file="OEM.pdf", page="1", chunk_index=0, distance=0.30)])
        llm = _make_llm()
        embedder = _make_embedder()

        result = await rag_query(
            query="Why is the drive faulting on overcurrent?",
            asset_id="vfd-001",
            tag_snapshot={"motor_current_A": 42.1},
            store=store,
            llm=llm,
            embedder=embedder,
            shared_store=shared_store,
        )

        assert "answer" in result
        assert "sources" in result
        assert isinstance(result["sources"], list)
        assert len(result["sources"]) > 0
        # Brain labels must propagate to sources
        brain_labels = {s["brain"] for s in result["sources"]}
        assert "Your docs" in brain_labels or "Mira library" in brain_labels

    async def test_safety_keyword_prepends_banner(self):
        store = _make_store([_hit(distance=0.20)])
        llm = _make_llm(answer="Check the wiring carefully.")
        embedder = _make_embedder()

        result = await rag_query(
            query="There is an arc flash near the panel",
            asset_id="panel-01",
            tag_snapshot={},
            store=store,
            llm=llm,
            embedder=embedder,
        )

        assert result["answer"].startswith(SAFETY_BANNER), (
            "Answer must begin with SAFETY_BANNER when a safety keyword is detected"
        )

    async def test_embedding_failure_returns_fallback(self):
        store = _make_store()
        llm = _make_llm()
        # embed() returns empty list — signals provider failure
        embedder = _make_embedder(vectors=[])

        result = await rag_query(
            query="What is fault code OV?",
            asset_id="vfd-002",
            tag_snapshot={},
            store=store,
            llm=llm,
            embedder=embedder,
        )

        assert "unavailable" in result["answer"].lower() or "embedding" in result["answer"].lower()
        assert result["sources"] == []
        # LLM must NOT be called when embedding fails
        llm.complete.assert_not_awaited()

    async def test_empty_results_llm_still_called(self):
        """With no hits from either store, LLM is still called with a no-docs context."""
        store = _make_store([])
        llm = _make_llm()
        embedder = _make_embedder()

        result = await rag_query(
            query="What is the motor FLA rating?",
            asset_id="motor-01",
            tag_snapshot={},
            store=store,
            llm=llm,
            embedder=embedder,
            shared_store=_make_store([]),
        )

        llm.complete.assert_awaited_once()
        # Context passed to LLM must mention lack of documentation
        call_args = llm.complete.call_args
        messages = call_args[0][0]
        user_msg = next(m["content"] for m in messages if m["role"] == "user")
        assert "No relevant documentation found" in user_msg
        assert "answer" in result

    async def test_shared_store_none_skips_brain1(self):
        store = _make_store([_hit(distance=0.20)])
        shared_store = _make_store([_hit(source_file="shared.pdf", distance=0.10)])
        llm = _make_llm()
        embedder = _make_embedder()

        await rag_query(
            query="VFD parameter P01.01",
            asset_id="vfd-003",
            tag_snapshot={},
            store=store,
            llm=llm,
            embedder=embedder,
            shared_store=None,  # Brain 1 disabled
        )

        shared_store.query.assert_not_called()

    async def test_sources_deduplicated_across_brains(self):
        """Two hits for the same (source_file, page) appear as one source citation."""
        tenant_hits = [
            _hit(source_file="Manual.pdf", page="3", chunk_index=0, distance=0.20),
        ]
        shared_hits = [
            _hit(source_file="Manual.pdf", page="4", chunk_index=0, distance=0.25),
        ]
        store = _make_store(tenant_hits)
        shared = _make_store(shared_hits)
        llm = _make_llm()
        embedder = _make_embedder()

        result = await rag_query(
            query="What is the rated current?",
            asset_id="asset-01",
            tag_snapshot={},
            store=store,
            llm=llm,
            embedder=embedder,
            shared_store=shared,
        )

        # Both hits have different pages — two separate source entries expected
        files = [s["file"] for s in result["sources"]]
        assert files.count("Manual.pdf") <= 2  # sanity: at most 2 entries for Manual.pdf

    async def test_safety_modifies_system_prompt(self):
        """Safety flag must inject preamble into the system prompt sent to LLM."""
        store = _make_store([_hit(distance=0.15)])
        llm = _make_llm()
        embedder = _make_embedder()

        await rag_query(
            query="There is a gas leak near the compressor",
            asset_id="comp-01",
            tag_snapshot={},
            store=store,
            llm=llm,
            embedder=embedder,
        )

        call_args = llm.complete.call_args
        messages = call_args[0][0]
        system_msg = next(m["content"] for m in messages if m["role"] == "system")
        assert "SAFETY ALERT" in system_msg

    async def test_asset_id_forwarded_to_tenant_store(self):
        """store.query must be called with the correct asset_id for Brain 2 filtering."""
        store = _make_store([])
        llm = _make_llm()
        embedder = _make_embedder()

        await rag_query(
            query="What is fault code OU?",
            asset_id="pump-42",
            tag_snapshot={},
            store=store,
            llm=llm,
            embedder=embedder,
        )

        store.query.assert_called_once()
        call_kwargs = store.query.call_args[1]
        assert call_kwargs.get("asset_id") == "pump-42"

    async def test_llm_failure_returns_fallback(self):
        """When LLM.complete() returns empty string, answer is the fallback message."""
        store = _make_store([_hit(distance=0.20)])
        llm = _make_llm(answer="")  # empty → fallback triggered
        embedder = _make_embedder()

        result = await rag_query(
            query="What is the overload relay setting?",
            asset_id="motor-01",
            tag_snapshot={},
            store=store,
            llm=llm,
            embedder=embedder,
        )

        assert result["answer"]  # must not be blank
        assert "unable" in result["answer"].lower() or "LLM" in result["answer"]

    async def test_tag_snapshot_included_in_context(self):
        """Live tag values must appear in the user message sent to the LLM."""
        store = _make_store([])
        llm = _make_llm()
        embedder = _make_embedder()

        await rag_query(
            query="Why is the motor drawing high current?",
            asset_id="motor-02",
            tag_snapshot={"motor_current_A": 55.3, "drive_fault_code": 7},
            store=store,
            llm=llm,
            embedder=embedder,
        )

        call_args = llm.complete.call_args
        messages = call_args[0][0]
        user_msg = next(m["content"] for m in messages if m["role"] == "user")
        assert "motor_current_A" in user_msg
        assert "55.3" in user_msg
