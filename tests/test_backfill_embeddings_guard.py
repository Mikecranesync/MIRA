"""Unit tests for the embedding-backfill dimension guard.

The one thing that MUST not happen: writing a vector whose dimension doesn't match
`knowledge_entries.embedding` (vector(768)) — that silently corrupts cosine
similarity. `embed()` asserts the dimension before returning, so a wrong model
fails loud instead of poisoning retrieval.
"""

from __future__ import annotations

import importlib.util
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "tools" / "backfill_knowledge_embeddings.py"
_spec = importlib.util.spec_from_file_location("backfill_knowledge_embeddings", _PATH)
mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(mod)


class _FakeResp:
    def __init__(self, vec):
        self._vec = vec

    def raise_for_status(self):
        return None

    def json(self):
        return {"embedding": self._vec}


class _FakeClient:
    def __init__(self, vec):
        self._vec = vec

    def post(self, *_a, **_k):
        return _FakeResp(self._vec)


def test_embed_accepts_768_dim():
    vec = [0.01] * mod.EXPECTED_DIM
    assert mod.embed(_FakeClient(vec), "some content") == vec


def test_embed_rejects_wrong_dim():
    # A different model (e.g. 1024-dim) must fail loud, not write a bad vector.
    with pytest.raises(ValueError, match="dim="):
        mod.embed(_FakeClient([0.01] * 1024), "some content")


def test_embed_rejects_empty():
    with pytest.raises(ValueError):
        mod.embed(_FakeClient([]), "some content")
