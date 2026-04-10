"""Tests for the 3-stage KB chunk quality gate.

Stages:
  1. Content filter  — heuristics (length, alpha ratio, sentence count)
  2. Relevance score — cosine sim vs anchor embeddings (mocked)
  3. Semantic dedup  — pgvector nearest-neighbor (mocked)

Tests mock _relevance_score and _semantic_dedup_score so no Ollama or NeonDB
connection is required.
"""

from __future__ import annotations

from unittest.mock import patch

import pytest
from ingest.quality import _cosine_sim, quality_gate

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _make_chunk(text: str) -> dict:
    return {"text": text, "chunk_index": 0, "source_url": "https://example.com/manual.pdf"}


def _good_embedding() -> list[float]:
    """Non-zero unit vector — content doesn't matter for mocked tests."""
    return [0.1] * 768


GOOD_MAINTENANCE_TEXT = (
    "Before servicing the motor, isolate all power sources and apply LOTO procedures. "
    "Verify the input voltage at terminals L1, L2, L3 is within rated tolerance. "
    "Check the bearing temperature using a calibrated IR thermometer; replace if above 90°C. "
    "Refer to the fault code table in Section 7 of the drive manual for corrective actions."
)


# ---------------------------------------------------------------------------
# Stage 1: Content filter
# ---------------------------------------------------------------------------

class TestContentFilter:
    def test_short_content_rejected(self):
        chunk = _make_chunk("Too short.")
        passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert not passed
        assert reason == "too_short"

    def test_exactly_80_chars_not_rejected_as_short(self):
        """Exactly 80 chars of valid content should pass the length check."""
        # "A"*38 + ". " (2 chars) + "B"*39 + "." = 38+2+39+1 = 80
        text = "A" * 38 + ". " + "B" * 39 + "."
        assert len(text) == 80, f"Expected 80, got {len(text)}"
        chunk = _make_chunk(text)
        # Mock downstream stages to pass
        with (
            patch("ingest.quality._relevance_score", return_value=0.9),
            patch("ingest.quality._semantic_dedup_score", return_value=0.0),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert passed, f"Expected pass, got reason: {reason}"

    def test_low_alpha_ratio_rejected(self):
        """Text with mostly non-alpha chars (numbers, symbols) is rejected."""
        # 100 digits + a few alpha to keep > 80 chars but ratio low
        text = "1234567890 " * 10 + "ok. done."
        chunk = _make_chunk(text)
        passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert not passed
        assert reason.startswith("low_alpha:")

    def test_too_few_sentences_rejected(self):
        """Text with fewer than 2 sentence-ending punctuation marks is rejected."""
        # 80+ chars, good alpha, but only one sentence terminator
        text = "This is a long piece of text that has plenty of words but only one period at the end"
        assert len(text) >= 80
        chunk = _make_chunk(text)
        passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert not passed
        assert reason == "too_few_sentences"

    def test_good_maintenance_content_passes_content_filter(self):
        """Well-formed maintenance text passes all content filter checks."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", return_value=0.9),
            patch("ingest.quality._semantic_dedup_score", return_value=0.0),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert passed, f"Expected pass, got reason: {reason}"


# ---------------------------------------------------------------------------
# Stage 2: Relevance filter
# ---------------------------------------------------------------------------

class TestRelevanceFilter:
    def test_low_relevance_rejected(self):
        """Chunk with relevance score below threshold is rejected."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", return_value=0.15),
            patch("ingest.quality._semantic_dedup_score", return_value=0.0),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert not passed
        assert reason == "low_relevance:0.150"

    def test_relevance_at_threshold_passes(self):
        """Chunk with score exactly at threshold (0.35) should pass."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", return_value=0.35),
            patch("ingest.quality._semantic_dedup_score", return_value=0.0),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert passed, f"Expected pass at threshold, got: {reason}"

    def test_high_relevance_passes(self):
        """Chunk with high relevance score clears stage 2."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", return_value=0.82),
            patch("ingest.quality._semantic_dedup_score", return_value=0.0),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert passed, f"Expected pass, got: {reason}"


# ---------------------------------------------------------------------------
# Stage 3: Semantic dedup filter
# ---------------------------------------------------------------------------

class TestSemanticDedup:
    def test_near_duplicate_rejected(self):
        """Chunk scoring above dedup threshold is rejected."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", return_value=0.9),
            patch("ingest.quality._semantic_dedup_score", return_value=0.97),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert not passed
        assert reason == "near_duplicate:0.970"

    def test_score_below_dedup_threshold_passes(self):
        """Chunk with dedup score well below threshold is allowed through."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", return_value=0.9),
            patch("ingest.quality._semantic_dedup_score", return_value=0.60),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert passed, f"Expected pass, got: {reason}"

    def test_dedup_at_threshold_still_passes(self):
        """Score exactly at threshold (0.95) should not be rejected (> not >=)."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", return_value=0.9),
            patch("ingest.quality._semantic_dedup_score", return_value=0.95),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert passed, f"Boundary score 0.95 should not be rejected, got: {reason}"


# ---------------------------------------------------------------------------
# Fail-open on exceptions
# ---------------------------------------------------------------------------

class TestFailOpen:
    def test_relevance_exception_fails_open(self):
        """If _relevance_score raises, gate should still pass (fail open)."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", side_effect=RuntimeError("Ollama down")),
            patch("ingest.quality._semantic_dedup_score", return_value=0.0),
        ):
            # quality_gate wraps stages in try/except at the call site — but
            # _relevance_score is called directly inside quality_gate.
            # The outer try/except in tasks/ingest.py handles the gate itself;
            # here we verify the gate propagates the error so the caller can
            # catch it and fail open.  This test documents that behaviour.
            with pytest.raises(RuntimeError):
                quality_gate(chunk, _good_embedding(), "tenant-1")

    def test_dedup_returns_zero_on_db_error(self):
        """_semantic_dedup_score returns 0.0 on DB error — gate doesn't block."""
        from ingest.quality import _semantic_dedup_score

        # _engine is imported from ingest.store inside the function; patch it there
        with patch("ingest.store._engine", side_effect=RuntimeError("no DB")):
            score = _semantic_dedup_score(_good_embedding(), "tenant-1")
        assert score == 0.0


# ---------------------------------------------------------------------------
# Pure helpers
# ---------------------------------------------------------------------------

class TestCosineSim:
    def test_identical_vectors(self):
        a = [1.0, 0.0, 0.0]
        assert _cosine_sim(a, a) == pytest.approx(1.0)

    def test_orthogonal_vectors(self):
        a = [1.0, 0.0]
        b = [0.0, 1.0]
        assert _cosine_sim(a, b) == pytest.approx(0.0)

    def test_opposite_vectors(self):
        a = [1.0, 0.0]
        b = [-1.0, 0.0]
        assert _cosine_sim(a, b) == pytest.approx(-1.0)

    def test_zero_vector_returns_zero(self):
        a = [0.0, 0.0]
        b = [1.0, 0.0]
        assert _cosine_sim(a, b) == 0.0

    def test_mismatched_lengths_returns_zero(self):
        assert _cosine_sim([1.0, 2.0], [1.0]) == 0.0

    def test_empty_vectors_returns_zero(self):
        assert _cosine_sim([], []) == 0.0
