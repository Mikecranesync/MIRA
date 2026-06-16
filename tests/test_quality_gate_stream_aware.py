"""Quality gate must trust non-vector retrieval streams.

Regression guard for the 2026-05-18 GS11 demo failure: a meta-textual question
("What are the modbus parameters for the word I write to the GS11 drive")
retrieved valid BM25 + product-search chunks, but the rag_worker quality gate
applied a cosine threshold (0.70) to merged rows whose `similarity` field
held ts_rank_cd / hardcoded ILIKE / non-cosine scores. All chunks were
suppressed → `no_kb_coverage=True` → "general industrial knowledge" disclaimer.

Fix: `_merge_results` now stamps each row with `retrieval_streams`, and the
rag_worker quality gate only suppresses when the only chunks present are
vector-stream chunks below the cosine threshold AND no non-vector stream
contributed evidence.
"""
from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

from shared.neon_recall import _merge_results  # noqa: E402


class TestRetrievalStreamsTagging:
    def test_vector_only_tagged(self):
        merged, _ = _merge_results(
            [{"content": "vec chunk", "similarity": 0.85}],
            [],
            [],
            bm25_results=[],
        )
        assert merged[0]["retrieval_streams"] == ["vector"]

    def test_bm25_only_tagged(self):
        merged, path = _merge_results(
            [],
            [],
            [],
            bm25_results=[{"content": "bm25 chunk on registers 8192 8193", "similarity": 0.12}],
        )
        assert merged[0]["retrieval_streams"] == ["bm25"]
        assert "bm25" in path

    def test_product_and_bm25_cross_stream_agreement(self):
        chunk = "GS11 register 8192 is the run/stop word — write 18 to start forward"
        merged, _ = _merge_results(
            [],
            [],
            product_results=[{"content": chunk, "similarity": 0.55}],
            bm25_results=[{"content": chunk, "similarity": 0.18}],
        )
        assert len(merged) == 1
        streams = set(merged[0]["retrieval_streams"])
        assert streams == {"product", "bm25"}


class TestQualityGateStreamAware:
    """Mirrors the quality-gate logic in rag_worker.RAGWorker.process so the
    regression is caught in unit tests even when NeonDB is unavailable.

    Keep this function in sync with rag_worker.py ~line 422 — they implement
    the same rule, only here we test it in isolation.
    """

    @staticmethod
    def _apply_gate(neon_chunks: list[dict], min_sim: float = 0.70) -> bool:
        """Returns True if the gate suppresses (matches rag_worker behavior)."""

        def streams_of(c: dict) -> set[str]:
            return set(c.get("retrieval_streams") or [])

        has_non_vector = any(streams_of(c) - {"vector"} for c in neon_chunks)
        vector_only = [c for c in neon_chunks if streams_of(c) <= {"vector"}]
        vector_top = max((c.get("similarity", 0) for c in vector_only), default=0)
        return bool(neon_chunks) and (not has_non_vector) and vector_top < min_sim

    def test_vector_only_below_threshold_suppresses(self):
        """Legacy behavior — vector-only chunks below 0.70 still get suppressed."""
        chunks = [
            {"content": "x", "similarity": 0.4, "retrieval_streams": ["vector"]},
            {"content": "y", "similarity": 0.5, "retrieval_streams": ["vector"]},
        ]
        assert self._apply_gate(chunks) is True

    def test_vector_only_above_threshold_kept(self):
        chunks = [{"content": "x", "similarity": 0.85, "retrieval_streams": ["vector"]}]
        assert self._apply_gate(chunks) is False

    def test_bm25_only_low_similarity_kept(self):
        """REGRESSION: BM25 chunks with ts_rank_cd=0.12 must not be suppressed.

        BM25 has its own hard gate (tsquery match) — the score is not cosine-
        comparable. This is the GS11 demo failure mode.
        """
        chunks = [
            {
                "content": "GS11 register 8192 — run/stop word",
                "similarity": 0.12,
                "retrieval_streams": ["bm25"],
            }
        ]
        assert self._apply_gate(chunks) is False

    def test_product_search_low_cosine_kept(self):
        """Product-search chunks already filtered by model_number ILIKE.

        Their cosine similarity is real cosine, but they were pre-filtered to
        the right manual, so a low cosine score doesn't mean low relevance —
        it means the user's phrasing was meta-textual.
        """
        chunks = [
            {
                "content": "GS11 register 8192 …",
                "similarity": 0.42,
                "retrieval_streams": ["product"],
            }
        ]
        assert self._apply_gate(chunks) is False

    def test_ilike_only_hardcoded_05_kept(self):
        """ILIKE fallback hardcodes similarity=0.5 — must not gate."""
        chunks = [
            {"content": "x", "similarity": 0.5, "retrieval_streams": ["like"]},
        ]
        assert self._apply_gate(chunks) is False

    def test_mixed_streams_low_vector_kept(self):
        """When BM25 confirms a chunk, even if vector cosine is low, keep it."""
        chunks = [
            {
                "content": "x",
                "similarity": 0.35,
                "retrieval_streams": ["bm25", "vector"],
            }
        ]
        assert self._apply_gate(chunks) is False

    def test_structured_fault_kept(self):
        """Structured fault chunks (similarity=0.95) always pass."""
        chunks = [
            {
                "content": "F004 — overcurrent",
                "similarity": 0.95,
                "retrieval_streams": ["structured_fault"],
            }
        ]
        assert self._apply_gate(chunks) is False

    def test_legacy_chunks_without_streams_field_use_top_score(self):
        """Backward compat: chunks without retrieval_streams default to gate-by-top."""
        chunks = [{"content": "x", "similarity": 0.42}]
        # No retrieval_streams → treated as vector-only → suppressed if below threshold
        assert self._apply_gate(chunks) is True


class TestGS11DemoQuery:
    """End-to-end shape test for the failing demo query.

    Simulates what `recall_knowledge` would return for the GS11 question and
    confirms the quality gate keeps the chunks instead of suppressing them.
    """

    QUERY = "What are the modbus parameters for the word I need to write on the GS11 drive"

    def test_bm25_and_product_chunks_survive_gate(self):
        # Simulate: vector returned nothing (cosine < 0.70), but BM25 + product
        # both found the register-map chunk.
        merged, path = _merge_results(
            vector_results=[],
            like_results=[],
            product_results=[
                {
                    "content": "GS11 Modbus register 8192 (0x2000) is the run/stop/direction "
                    "command word. Values: 1=stop, 18=run forward, 20=run reverse.",
                    "similarity": 0.48,
                    "manufacturer": "Automation Direct",
                    "model_number": "GS11",
                }
            ],
            bm25_results=[
                {
                    "content": "GS11 Modbus register 8192 (0x2000) is the run/stop/direction "
                    "command word. Values: 1=stop, 18=run forward, 20=run reverse.",
                    "similarity": 0.21,
                    "manufacturer": "Automation Direct",
                    "model_number": "GS11",
                },
                {
                    "content": "GS11 register 8193 is the frequency reference, Hz × 100.",
                    "similarity": 0.18,
                    "manufacturer": "Automation Direct",
                    "model_number": "GS11",
                },
            ],
        )

        assert merged, "expected at least one chunk after merge"
        assert "bm25" in path

        # Every merged chunk must carry retrieval_streams metadata
        for c in merged:
            assert c.get("retrieval_streams"), f"chunk missing streams: {c}"

        # Apply the same gate the rag_worker now uses
        gate = TestQualityGateStreamAware._apply_gate(merged)
        assert gate is False, (
            "Quality gate should NOT suppress BM25+product chunks for the GS11 "
            "register-map query — this is the regression that broke the demo."
        )
