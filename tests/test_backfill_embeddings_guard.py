"""Unit tests for the embedding-backfill dimension guard.

The one thing that MUST not happen: writing a vector whose dimension doesn't match
`knowledge_entries.embedding` (vector(768)) — that silently corrupts cosine
similarity. `embed()` asserts the dimension before returning, so a wrong model
fails loud instead of poisoning retrieval.
"""

from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

import pytest

_PATH = Path(__file__).resolve().parents[1] / "tools" / "backfill_knowledge_embeddings.py"
_spec = importlib.util.spec_from_file_location("backfill_knowledge_embeddings", _PATH)
mod = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = mod  # dataclasses resolve their module through sys.modules
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


# ── Recovery safety (2026-10-05 embedding outage) ────────────────────────────
# The backfill runs while the Hub's own embed pass may be writing the same rows,
# so it must never overwrite a vector, must count only rows it actually wrote,
# must stop on a wrong-model / permission / unreachable-embedder condition, and
# must exit non-zero on ANY failure (it used to exit 0 unless nothing succeeded).


class _Res:
    def __init__(self, rowcount):
        self.rowcount = rowcount


class _FakeConn:
    """Records UPDATE statements; `already` ids behave as if another writer won."""

    def __init__(self, already=(), deny=False):
        self.already = set(already)
        self.deny = deny
        self.sql: list[str] = []
        self.commits = 0

    def execute(self, stmt, params=None):
        sql = str(stmt)
        self.sql.append(sql)
        if self.deny:
            raise mod.PermissionDenied("permission denied for table knowledge_entries")
        return _Res(0 if params["id"] in self.already else 1)

    def commit(self):
        self.commits += 1


def _vec():
    return [0.01] * mod.EXPECTED_DIM


def test_update_never_overwrites_a_vector():
    conn = _FakeConn()
    mod.backfill_rows(conn, [("a", "text")], lambda c: _vec(), batch=20)
    assert all(
        "embedding IS NULL" in s for s in conn.sql if s.lstrip().upper().startswith("UPDATE")
    )


def test_a_row_another_writer_embedded_is_skipped_not_counted():
    conn = _FakeConn(already={"b"})
    r = mod.backfill_rows(conn, [("a", "x"), ("b", "y"), ("c", "z")], lambda c: _vec(), batch=20)
    assert (r.embedded, r.skipped_already_embedded, r.failed) == (2, 1, 0)
    assert r.exit_code == 0


def test_partial_failure_exits_non_zero_with_honest_counts():
    def flaky(content):
        if content == "bad":
            raise RuntimeError("timeout")
        return _vec()

    r = mod.backfill_rows(_FakeConn(), [("a", "ok"), ("b", "bad"), ("c", "ok")], flaky, batch=20)
    assert (r.embedded, r.failed) == (2, 1)
    assert r.exit_code == 1  # used to be 0 whenever anything succeeded


def test_dimension_mismatch_stops_the_run():
    calls = []

    def wrong_model(content):
        calls.append(content)
        raise mod.DimensionMismatch("embedder returned dim=1024")

    r = mod.backfill_rows(_FakeConn(), [("a", "x"), ("b", "y")], wrong_model, batch=20)
    assert r.stop_reason == "dimension_mismatch" and len(calls) == 1 and r.exit_code == 1


def test_permission_error_stops_the_run():
    r = mod.backfill_rows(
        _FakeConn(deny=True), [("a", "x"), ("b", "y")], lambda c: _vec(), batch=20
    )
    assert r.stop_reason == "permission_denied" and r.embedded == 0 and r.exit_code == 1


def test_an_unreachable_embedder_stops_after_one_batch_of_failures():
    calls = []

    def down(content):
        calls.append(content)
        raise ConnectionError("connect timeout")

    rows = [(str(i), "x") for i in range(50)]
    r = mod.backfill_rows(_FakeConn(), rows, down, batch=5)
    assert r.stop_reason == "embedder_unreachable" and len(calls) == 5 and r.exit_code == 1


def test_commits_every_batch_so_a_rerun_resumes():
    conn = _FakeConn()
    mod.backfill_rows(conn, [(str(i), "x") for i in range(45)], lambda c: _vec(), batch=20)
    assert conn.commits >= 3  # 20, 40, and the tail


def test_empty_content_is_skipped_not_failed():
    r = mod.backfill_rows(_FakeConn(), [("a", "  "), ("b", "x")], lambda c: _vec(), batch=20)
    assert (r.embedded, r.skipped_empty, r.failed, r.exit_code) == (1, 1, 0, 0)


def test_refuses_to_run_without_an_embedder_url(monkeypatch):
    monkeypatch.setenv("NEON_DATABASE_URL", "postgresql://u:p@localhost:1/db")
    monkeypatch.delenv("OLLAMA_BASE_URL", raising=False)
    monkeypatch.setattr(mod.sys, "argv", ["backfill"])
    assert mod.main() == 2
