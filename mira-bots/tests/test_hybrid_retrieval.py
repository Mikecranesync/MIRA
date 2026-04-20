"""Unit 6 — offline tests for RRF merge + feature flag + BM25 stream.

These tests do NOT touch NeonDB. They exercise the pure-Python merge logic
(_merge_results) and the feature-flag constants. The live +15% fault-code
recall gate lives in tests/regime2_rag/test_hybrid_retrieval_baseline.py
and skips without NEON_DATABASE_URL.
"""

from __future__ import annotations

import importlib

import pytest

from shared import neon_recall


def _row(content: str, sim: float = 0.5) -> dict:
    """Minimal chunk dict matching recall_knowledge()'s return shape."""
    return {
        "content": content,
        "manufacturer": "TestCo",
        "model_number": "X1",
        "equipment_type": "test",
        "source_type": "test",
        "source_url": None,
        "source_page": None,
        "metadata": {},
        "similarity": sim,
    }


class TestRRFMerge:
    """RRF math + stream precedence."""

    def test_no_keyword_streams_passes_vector_through(self):
        """With empty like/product/bm25, vector_results are returned unchanged."""
        vec = [_row("alpha"), _row("beta")]
        merged, path = neon_recall._merge_results(vec, [], [])
        assert path == "vector_only"
        assert [r["content"] for r in merged] == ["alpha", "beta"]

    def test_rrf_favors_cross_stream_agreement(self):
        """A chunk found in TWO streams outranks a chunk found in only ONE.

        Doc A: rank 1 in vector only   → RRF = 1/(60+1) ≈ 0.01639
        Doc B: rank 3 in vector + rank 3 in BM25 → RRF = 2/(60+3) ≈ 0.03175
        B should win despite A's higher in-stream rank.
        """
        vec = [_row("A"), _row("X"), _row("B")]
        bm25 = [_row("Y"), _row("Z"), _row("B")]
        merged, path = neon_recall._merge_results(vec, [], [], bm25_results=bm25)
        assert merged[0]["content"] == "B", (
            f"cross-stream agreement should win; got order {[r['content'] for r in merged]}"
        )
        # Sanity: rrf_score is attached for observability
        assert "rrf_score" in merged[0]
        assert merged[0]["rrf_score"] > merged[1]["rrf_score"]
        assert "bm25" in path

    def test_rrf_path_label_reports_active_streams(self):
        vec = [_row("a")]
        bm25 = [_row("b")]
        _, path = neon_recall._merge_results(vec, [], [], bm25_results=bm25)
        assert path == "rrf_hybrid_bm25"

        like = [_row("c")]
        _, path = neon_recall._merge_results(vec, like, [], bm25_results=bm25)
        assert path == "rrf_hybrid_bm25+kw"

        _, path = neon_recall._merge_results(vec, like, [_row("d")])
        assert path == "rrf_kw"

    def test_rrf_deduplicates_by_content_prefix(self):
        """Same doc across streams is scored once per stream but output once."""
        same = _row("duplicate content")
        vec = [same]
        bm25 = [same]
        merged, _ = neon_recall._merge_results(vec, [], [], bm25_results=bm25)
        assert len(merged) == 1
        # Score should reflect rank-1 in both streams.
        expected = 2.0 / (neon_recall.RRF_K + 1)
        assert merged[0]["rrf_score"] == pytest.approx(expected, rel=1e-3)

    def test_rrf_limit_truncates_after_fusion(self):
        """`limit` caps OUTPUT — fusion still sees all candidates first."""
        vec = [_row(f"v{i}") for i in range(5)]
        bm25 = [_row("v4")]  # boosts v4 via cross-stream agreement
        merged, _ = neon_recall._merge_results(vec, [], [], bm25_results=bm25, limit=3)
        assert len(merged) == 3
        assert merged[0]["content"] == "v4", (
            "cross-stream agreement should survive truncation"
        )

    def test_rrf_handles_missing_bm25(self):
        """bm25_results=None should behave as pre-Unit-6 merge (no crash)."""
        vec = [_row("a")]
        like = [_row("b")]
        product = [_row("c")]
        merged, path = neon_recall._merge_results(vec, like, product, bm25_results=None)
        assert len(merged) == 3
        assert {r["content"] for r in merged} == {"a", "b", "c"}
        assert path.startswith("rrf_")

    def test_similarity_field_preserved_from_vector_priority(self):
        """When the same doc is in vector + bm25, the vector row's `similarity`
        wins (vector has higher stream priority). BM25's raw ts_rank_cd would
        otherwise pollute the MIN_SIMILARITY gate upstream."""
        vec_row = _row("shared", sim=0.87)
        bm25_row = _row("shared", sim=0.02)
        merged, _ = neon_recall._merge_results([vec_row], [], [], bm25_results=[bm25_row])
        assert merged[0]["similarity"] == pytest.approx(0.87)


class TestHybridFeatureFlag:
    """MIRA_RETRIEVAL_HYBRID_ENABLED kill switch."""

    def test_flag_default_is_enabled(self, monkeypatch):
        monkeypatch.delenv("MIRA_RETRIEVAL_HYBRID_ENABLED", raising=False)
        reloaded = importlib.reload(neon_recall)
        assert reloaded.HYBRID_ENABLED is True

    def test_flag_false_disables_hybrid(self, monkeypatch):
        monkeypatch.setenv("MIRA_RETRIEVAL_HYBRID_ENABLED", "false")
        reloaded = importlib.reload(neon_recall)
        assert reloaded.HYBRID_ENABLED is False

    def test_flag_case_insensitive(self, monkeypatch):
        monkeypatch.setenv("MIRA_RETRIEVAL_HYBRID_ENABLED", "FALSE")
        reloaded = importlib.reload(neon_recall)
        assert reloaded.HYBRID_ENABLED is False

    def test_rrf_k_default(self, monkeypatch):
        monkeypatch.delenv("MIRA_RRF_K", raising=False)
        reloaded = importlib.reload(neon_recall)
        assert reloaded.RRF_K == 60


class TestBM25StreamGuard:
    """_recall_bm25 should return [] when query_text is blank, without DB call."""

    def test_blank_query_returns_empty(self):
        # Pass None for conn/text_fn — they must not be touched.
        rows = neon_recall._recall_bm25(
            conn=None, text_fn=None, tenant_id="t", query_text="", limit=5
        )
        assert rows == []

    def test_whitespace_query_returns_empty(self):
        rows = neon_recall._recall_bm25(
            conn=None, text_fn=None, tenant_id="t", query_text="   \n\t  ", limit=5
        )
        assert rows == []
