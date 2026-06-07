"""Lane 2 — proves the upload→retrieval gap that blocks beta.

Two checks:

1. `test_retrieval_reads_only_knowledge_entries` — RUNNABLE NOW (no live stack).
   Captures the SQL `recall_knowledge()` actually issues and asserts every read
   targets `knowledge_entries`. This pins down WHERE chat retrieval reads from,
   so the gap is precisely stated: uploads that land only in the Open WebUI KB
   (never `knowledge_entries`) cannot be retrieved. If someone repoints retrieval
   at the OW KB instead of closing the gap properly, this test notices.

2. `test_uploaded_manual_is_citable` — the real end-to-end flow (xfail until the
   gap closes). Shares its implementation with the Lane 6 RELEASE GATE via
   `_gate.run_beta_gate`. xfail(strict): the day it passes, the suite goes red.

Gap reference: docs/research/2026-06-07-upload-retrieval-gap-and-beta-path.md
Fix in flight: PR #1592 (feat/hub-folder-brain).
"""

from __future__ import annotations

import os
from unittest.mock import patch

import pytest

from ._gate import run_beta_gate


# ── Check 1: runnable, no live stack — where does retrieval read from? ────────


class _FakeResult:
    def mappings(self):
        return self

    def fetchall(self):
        return []

    def fetchone(self):
        return None


class _RecordingConn:
    def __init__(self, sink: list[str]):
        self._sink = sink

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, statement, params=None):
        self._sink.append(str(statement))
        return _FakeResult()


class _FakeEngine:
    def __init__(self, sink: list[str]):
        self._sink = sink

    def connect(self):
        return _RecordingConn(self._sink)


def test_retrieval_reads_only_knowledge_entries():
    """The retrieval layer reads `knowledge_entries` — the table uploads must reach."""
    import sqlalchemy

    from shared.neon_recall import recall_knowledge

    sql_seen: list[str] = []
    # recall_knowledge does `from sqlalchemy import create_engine` *inside* the
    # body (PLC0415), so patch the sqlalchemy module attribute (repo convention).
    with patch.dict(os.environ, {"NEON_DATABASE_URL": "postgresql://t:t@localhost/t"}):
        with patch.object(sqlalchemy, "create_engine", return_value=_FakeEngine(sql_seen)):
            recall_knowledge([0.1] * 8, tenant_id="demo", query_text="GS10 oC overcurrent")

    joined = "\n".join(sql_seen).lower()
    assert sql_seen, "recall_knowledge issued no SQL — mock wiring is wrong"
    assert "knowledge_entries" in joined, (
        "retrieval no longer reads knowledge_entries — the gap analysis is stale "
        f"(SQL seen: {joined[:200]!r})"
    )
    # Retrieval must NOT be reading an Open WebUI KB table; if it did, 'uploads
    # land in OW KB' would no longer be a gap. Guard against that drift.
    assert "openwebui" not in joined and "ow_kb" not in joined


# ── Check 2: the real flow — xfail until the gap closes ───────────────────────


@pytest.mark.beta_gate
@pytest.mark.xfail(
    strict=True,
    reason=(
        "BETA GATE (upload→retrieval gap, PR #1592): a stranger's uploaded manual "
        "is not yet citable in chat. Expected to fail until the gap closes AND a "
        "dev/staging integration env is provided (BETA_GATE_* env vars). When this "
        "starts passing, strict-xfail flips the suite RED — remove the marker and "
        "confirm beta readiness."
    ),
)
def test_uploaded_manual_is_citable():
    """Upload the GS10 fixture → ask 'what does oC mean?' → expect a cited answer."""
    result = run_beta_gate()
    assert result.cited, result.explain
