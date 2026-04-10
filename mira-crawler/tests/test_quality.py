"""Tests for the 3-stage KB chunk quality gate.

Stages:
  1. Content filter  — heuristics (length, alpha ratio, sentence count)
  2. Relevance score — cosine sim vs anchor embeddings (mocked)
  3. Semantic dedup  — pgvector nearest-neighbor (mocked)

Tests mock _relevance_score and _semantic_dedup_score so no Ollama or NeonDB
connection is required.
"""

from __future__ import annotations

import json
from pathlib import Path
from unittest.mock import patch

import pytest
from ingest.quality import _cosine_sim, _load_anchors, quality_gate

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
        """If _relevance_score raises, quality_gate catches it and fails open."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)
        with (
            patch("ingest.quality._relevance_score", side_effect=RuntimeError("Ollama down")),
            patch("ingest.quality._semantic_dedup_score", return_value=0.0),
        ):
            # quality_gate now has a top-level try/except (M11 fix) — it must
            # return (True, "error_fail_open:...") rather than propagating the error.
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")
        assert passed, "Gate should fail open when an unexpected exception occurs"
        assert reason.startswith("error_fail_open:"), f"Unexpected reason: {reason}"

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


# ---------------------------------------------------------------------------
# Anchor cache validation (C2/C5 fixes)
# ---------------------------------------------------------------------------

_ANCHOR_TEXTS = [
    "Check the fault code on the VFD display.",
    "Before performing any maintenance on electrical equipment, follow LOTO.",
]

_VALID_VEC = [0.1] * 768


def _write_anchors_json(path: Path, embeddings: list) -> None:
    data = {"anchors": _ANCHOR_TEXTS, "anchor_embeddings": embeddings}
    path.write_text(json.dumps(data))


class TestAnchorCacheValidation:
    def _reset_module_cache(self):
        """Reset the module-level _anchor_embeddings cache between tests."""
        import ingest.quality as q
        q._anchor_embeddings = None

    def test_empty_vectors_in_cache_triggers_regeneration(self, tmp_path, monkeypatch):
        """anchors.json with an empty vector must cause regeneration, not silent use."""
        anchors_file = tmp_path / "anchors.json"
        # One of the two cached vectors is empty — poisoned cache.
        _write_anchors_json(anchors_file, [_VALID_VEC, []])

        self._reset_module_cache()
        monkeypatch.setattr("ingest.quality._ANCHORS_PATH", anchors_file)

        call_count = {"n": 0}

        def counting_embed(text):  # noqa: ANN001
            call_count["n"] += 1
            return _VALID_VEC

        import sys
        fake_embedder = type(sys)("ingest.embedder")
        fake_embedder.embed_text = counting_embed
        monkeypatch.setitem(sys.modules, "ingest.embedder", fake_embedder)

        result = _load_anchors()

        # embed_text must have been called — the poisoned cache must not be trusted.
        assert call_count["n"] > 0, "embed_text was not called — cache was trusted despite empty vector"
        # Result should have only valid (non-empty) vectors after regeneration.
        assert all(v for v in result), "Regenerated anchors should all be non-empty"

    def test_partial_embedding_failure_not_persisted(self, tmp_path, monkeypatch):
        """When embed_text fails for at least one anchor, anchors.json must NOT be updated."""
        anchors_file = tmp_path / "anchors.json"
        # Start with no cached embeddings so regeneration is attempted.
        _write_anchors_json(anchors_file, [])
        original_mtime = anchors_file.stat().st_mtime

        self._reset_module_cache()
        monkeypatch.setattr("ingest.quality._ANCHORS_PATH", anchors_file)

        call_count = {"n": 0}

        def failing_then_succeeding(text):  # noqa: ANN001
            call_count["n"] += 1
            # First anchor fails, rest succeed.
            if call_count["n"] == 1:
                return None
            return _VALID_VEC

        import sys
        fake_embedder = type(sys)("ingest.embedder")
        fake_embedder.embed_text = failing_then_succeeding
        monkeypatch.setitem(sys.modules, "ingest.embedder", fake_embedder)

        _load_anchors()

        # File must NOT have been updated.
        new_mtime = anchors_file.stat().st_mtime
        assert new_mtime == original_mtime, (
            "anchors.json was written even though an embedding failed — cache poisoning risk"
        )

        # Disk content must still be the original empty embeddings.
        on_disk = json.loads(anchors_file.read_text())
        assert on_disk["anchor_embeddings"] == [], (
            "anchors.json on disk should still have empty embeddings after partial failure"
        )

    def test_all_embeddings_succeed_persisted(self, tmp_path, monkeypatch):
        """When all embed_text calls succeed, anchors.json must be updated with the new vectors."""
        anchors_file = tmp_path / "anchors.json"
        _write_anchors_json(anchors_file, [])  # No cached embeddings.

        self._reset_module_cache()
        monkeypatch.setattr("ingest.quality._ANCHORS_PATH", anchors_file)

        import sys
        fake_embedder = type(sys)("ingest.embedder")
        fake_embedder.embed_text = lambda text: _VALID_VEC  # noqa: E731
        monkeypatch.setitem(sys.modules, "ingest.embedder", fake_embedder)

        _load_anchors()

        on_disk = json.loads(anchors_file.read_text())
        assert len(on_disk["anchor_embeddings"]) == len(_ANCHOR_TEXTS), (
            "All anchor embeddings should have been persisted to disk"
        )
        assert all(v for v in on_disk["anchor_embeddings"]), (
            "No empty vectors should be present in the persisted cache"
        )

    def test_quality_gate_top_level_fail_open(self):
        """Unexpected exception inside quality_gate must return (True, error_fail_open:...)."""
        chunk = _make_chunk(GOOD_MAINTENANCE_TEXT)

        with patch(
            "ingest.quality._relevance_score",
            side_effect=ValueError("unexpected internal error"),
        ):
            passed, reason = quality_gate(chunk, _good_embedding(), "tenant-1")

        assert passed, "quality_gate must fail open on unexpected exceptions"
        assert reason == "error_fail_open:ValueError", (
            f"Expected 'error_fail_open:ValueError', got '{reason}'"
        )
