"""Evidence-relevance gate for RAGWorker._compute_kb_status (blocker #2384).

Retrieval success != evidence coverage. The recall layer fuses multiple streams
whose `similarity` fields are NOT on a common scale:
  - vector  -> cosine in [0,1]               (comparable)
  - bm25    -> raw ts_rank_cd, unbounded     (NOT comparable to cosine)
  - like    -> hardcoded 0.5                 (NOT comparable)
  - fault   -> deterministic exact match     (authoritative, bypasses RRF)

The pre-fix gate compared every chunk's `similarity` against a single 0.65
threshold, so a high BM25 `ts_rank_cd` (observed 0.9-3.6) on an OFF-DOMAIN query
falsely marked the answer "covered" and cited irrelevant manuals (incl. YouTube
URLs). See #2384 live proof.

These tests assert the corrected contract:
  * Only cosine-comparable evidence (vector chunks >= floor, or authoritative
    fault-code hits) can establish coverage. BM25/ILIKE-only chunks cannot.
  * Junk/non-authoritative sources (YouTube watch URLs) never mark coverage.
  * Unknown-provenance chunks fail closed.
All tests are offline — no LLM, no SQLite, no network.
"""

from __future__ import annotations

import os
import sys
import unittest.mock

os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_kb_status_relevance_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "test-tenant")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

for _mod in ("PIL", "PIL.Image", "slack_sdk", "slack_sdk.web.async_client", "slack_sdk.errors"):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = unittest.mock.MagicMock()

from shared.workers.rag_worker import RAGWorker  # noqa: E402


def _make_worker() -> RAGWorker:
    w = RAGWorker.__new__(RAGWorker)
    w._last_neon_chunks = []
    w._kb_status = {"status": "unknown", "citations": []}
    return w


def _vchunk(mfr: str, sim: float, *, model: str = "M1", section: str = "", url: str = "") -> dict:
    """A vector-originated chunk (cosine similarity, comparable)."""
    return {
        "manufacturer": mfr,
        "model_number": model,
        "similarity": sim,
        "metadata": {"section": section},
        "source_url": url,
        "retrieval_streams": ["vector"],
    }


def _bm25chunk(mfr: str, ts_rank: float, *, url: str = "") -> dict:
    """A BM25-only chunk: `similarity` holds raw ts_rank_cd (NOT cosine)."""
    return {
        "manufacturer": mfr,
        "model_number": "M1",
        "similarity": ts_rank,  # e.g. 3.6 — unbounded ts_rank, not cosine
        "metadata": {"section": ""},
        "source_url": url,
        "retrieval_streams": ["bm25"],
    }


def _faultchunk(mfr: str = "Allen-Bradley") -> dict:
    """Authoritative deterministic fault-code hit (bypasses RRF, no streams tag)."""
    return {
        "manufacturer": mfr,
        "model_number": "PowerFlex 525",
        "similarity": 0.95,
        "metadata": {"section": "Fault Code Table"},
        "source_url": "",
    }


class TestEvidenceRelevanceGate:
    # --- the proven bug: BM25 lexical scores must not establish coverage -----
    def test_bm25_only_high_rank_not_covered(self):
        """3 off-domain BM25 chunks at ts_rank 3.6 must NOT be 'covered' (#2384)."""
        w = _make_worker()
        chunks = [_bm25chunk("Rockwell", 3.6), _bm25chunk("Rockwell", 2.6), _bm25chunk("Rockwell", 2.4)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "uncovered", result
        assert result["citations"] == []

    def test_bm25_alone_cannot_mark_coverage(self):
        """Even many high-rank BM25 hits cannot mark coverage without cosine support."""
        w = _make_worker()
        chunks = [_bm25chunk("Rockwell", 5.0) for _ in range(6)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "uncovered", result

    def test_mixed_only_vector_counts(self):
        """1 vector@0.8 + 3 BM25@3.6 -> only the vector chunk supports -> partial, not covered."""
        w = _make_worker()
        chunks = [_vchunk("Allen-Bradley", 0.80)] + [_bm25chunk("Rockwell", 3.6) for _ in range(3)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "partial", result
        assert len(result["citations"]) == 1
        assert result["citations"][0]["manufacturer"] == "Allen-Bradley"

    # --- preserve the covered path ------------------------------------------
    def test_vector_chunks_still_covered(self):
        w = _make_worker()
        chunks = [_vchunk("Allen-Bradley", 0.85), _vchunk("Allen-Bradley", 0.81), _vchunk("Allen-Bradley", 0.78)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "covered", result
        assert len(result["citations"]) == 3

    def test_fault_code_hit_is_authoritative(self):
        """A deterministic fault-code hit (no streams tag) counts as evidence."""
        w = _make_worker()
        chunks = [_faultchunk(), _vchunk("Allen-Bradley", 0.79), _vchunk("Allen-Bradley", 0.78)]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "covered", result

    def test_fault_hit_alone_is_partial(self):
        w = _make_worker()
        result = w._compute_kb_status(neon_chunks=[_faultchunk()], has_chunks=True)
        assert result["status"] == "partial", result
        assert result["citations"][0]["section"] == "Fault Code Table"

    # --- source hygiene ------------------------------------------------------
    def test_junk_youtube_source_never_covers(self):
        """Even cosine-scored chunks whose source is a YouTube watch URL can't cover."""
        w = _make_worker()
        chunks = [
            _vchunk("Rockwell", 0.82, url="https://www.youtube.com/watch?v=Ifbvgxt1Egq&t=304"),
            _vchunk("Rockwell", 0.81, url="https://youtu.be/Ionbyarltg8"),
            _vchunk("Rockwell", 0.80, url="watch?v=abc123"),
        ]
        result = w._compute_kb_status(neon_chunks=chunks, has_chunks=True)
        assert result["status"] == "uncovered", result
        assert result["citations"] == []

    # --- fail-closed on unknown provenance ----------------------------------
    def test_unknown_provenance_fails_closed(self):
        """No retrieval_streams + not a fault hit -> score type unknown -> not counted."""
        w = _make_worker()
        chunk = {"manufacturer": "X", "model_number": "Y", "similarity": 0.9, "metadata": {"section": ""}, "source_url": ""}
        result = w._compute_kb_status(neon_chunks=[chunk], has_chunks=True)
        assert result["status"] == "uncovered", result
