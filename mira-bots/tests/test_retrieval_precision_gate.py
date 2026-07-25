"""Regression tests for #2211: retrieval extraction precision.

Two sub-fixes land here (the third — model-suffix exclude SQL — is deferred as a
staging-gated follow-up because it needs Neon dialect verification):

  1. Cross-vendor suppression is gated by resolver confidence. Previously the
     filter fired unconditionally, so a low-confidence false-positive vendor alias
     ("delta pressure" → "Delta Electronics" @0.5) suppressed ALL evidence.
     `_confident_query_vendor` only returns the vendor at confidence >= 0.7.

  2. Product-rerank fallback for stranger uploads. `recall_knowledge` gained a
     `product_hint` param so a resolved model (not in the curated product regex)
     still triggers the product stream.

Both assertions fail on origin/main (helper absent, param absent) and pass here.
The end-to-end suppression/rerank behaviour is validated by the staging eval.
"""

from __future__ import annotations

import inspect
import os
import sys

sys.path.insert(0, "mira-bots")

os.environ.setdefault("NEON_DATABASE_URL", "postgresql://test:test@localhost/test")

from shared.neon_recall import recall_knowledge  # noqa: E402
from shared.workers.rag_worker import _confident_query_vendor  # noqa: E402


def _state(manufacturer=None, confidence=None, model=None):
    uns = {}
    if manufacturer is not None:
        uns["manufacturer"] = manufacturer
    if confidence is not None:
        uns["confidence"] = confidence
    if model is not None:
        uns["model"] = model
    return {"context": {"uns_context": uns}}


class TestConfidentQueryVendor:
    """Cross-vendor suppression only trusts the vendor at confidence >= 0.7 (#2211)."""

    def test_high_confidence_returns_vendor(self):
        # manufacturer+model resolved (0.7) → suppression is allowed.
        assert _confident_query_vendor(_state("Rockwell Automation", 0.7)) == "Rockwell Automation"

    def test_very_high_confidence_returns_vendor(self):
        assert _confident_query_vendor(_state("Yaskawa", 0.95)) == "Yaskawa"

    def test_low_confidence_returns_none(self):
        # manufacturer-only (0.5) false positive → do NOT suppress.
        assert _confident_query_vendor(_state("Delta Electronics", 0.5)) is None

    def test_missing_confidence_returns_none(self):
        assert _confident_query_vendor(_state("Delta Electronics")) is None

    def test_no_vendor_returns_none(self):
        assert _confident_query_vendor(_state(confidence=0.95)) is None

    def test_empty_state_returns_none(self):
        assert _confident_query_vendor({}) is None
        assert _confident_query_vendor({"context": {}}) is None


class TestProductHintFallback:
    """recall_knowledge accepts a product_hint for stranger-upload rerank (#2211)."""

    def test_recall_knowledge_has_product_hint_param(self):
        params = inspect.signature(recall_knowledge).parameters
        assert "product_hint" in params, (
            "recall_knowledge must accept product_hint so a resolved stranger-upload "
            "model still triggers the product-rerank stream (fails on origin/main)."
        )

    def test_product_hint_defaults_to_none(self):
        assert inspect.signature(recall_knowledge).parameters["product_hint"].default is None
