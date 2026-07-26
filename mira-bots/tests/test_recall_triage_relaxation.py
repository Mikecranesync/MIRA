"""Regression test for #2207: triage-relaxed cosine floor must reach recall_knowledge.

The bug: `recall_knowledge` filtered vector rows at a hardcoded 0.70 cosine floor
BEFORE the worker's triage-aware quality gate saw them. The worker computes a
relaxed threshold (0.55 medium, 0.45 low) but never passed it to retrieval, so
0.45–0.70 chunks were dropped at the source → the relaxed gate was dead code →
0 chunks on medium/low-triage queries that had real evidence at 0.45–0.70.

Fix: a `min_similarity` param on `recall_knowledge` (default = env 0.70) fed by the
`_triage_relaxed_min_sim` helper at every call site. These tests exercise the REAL
helper and the REAL signature (not an inline copy) — both fail on origin/main
(helper absent, param absent) and pass after the fix. The end-to-end DB-filtering
behaviour is gated by the staging eval (see the plan doc), not asserted here.
"""

from __future__ import annotations

import inspect
import os
import sys

sys.path.insert(0, "mira-bots")

os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared.neon_recall import recall_knowledge  # noqa: E402
from shared.workers.rag_worker import _triage_relaxed_min_sim  # noqa: E402


class TestTriageRelaxedMinSim:
    """The real threshold-selection helper — the single source of truth (#2207)."""

    def test_medium_confidence_relaxes_to_055(self):
        state = {"context": {"triage_result": {"confidence": "medium"}}}
        assert _triage_relaxed_min_sim(state) == 0.55

    def test_low_confidence_relaxes_to_045(self):
        state = {"context": {"triage_result": {"confidence": "low"}}}
        assert _triage_relaxed_min_sim(state) == 0.45

    def test_enriched_flag_relaxes_to_055(self):
        # triage_enriched acts like medium even without an explicit confidence.
        state = {"context": {"triage_enriched": True}}
        assert _triage_relaxed_min_sim(state) == 0.55

    def test_high_confidence_uses_default(self):
        # None → recall_knowledge falls back to its env default (0.70).
        state = {"context": {"triage_result": {"confidence": "high"}}}
        assert _triage_relaxed_min_sim(state) is None

    def test_missing_triage_uses_default(self):
        assert _triage_relaxed_min_sim({}) is None
        assert _triage_relaxed_min_sim({"context": {}}) is None


class TestRecallKnowledgeAcceptsThreshold:
    """The plumbing exists: recall_knowledge takes the relaxed floor (#2207)."""

    def test_recall_knowledge_has_min_similarity_param(self):
        params = inspect.signature(recall_knowledge).parameters
        assert "min_similarity" in params, (
            "recall_knowledge must accept min_similarity so the worker's triage-relaxed "
            "threshold reaches the vector filter (this fails on origin/main)."
        )

    def test_min_similarity_defaults_to_none(self):
        # Default None → env-var 0.70 inside recall_knowledge (backwards compatible).
        assert inspect.signature(recall_knowledge).parameters["min_similarity"].default is None
