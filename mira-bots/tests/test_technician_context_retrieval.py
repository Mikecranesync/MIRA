"""WS1 / G6 — the RETRIEVAL (manual-chunk) family reaches the audit trail.

The prior slice (#3032) recorded only the PRIOR_DECISION manifest. This proves
the manual-chunk family is folded into the SAME validated turn context and rides
`parsed["_context_manifest"]` out to `write_trace` — the carrier the trace writer
actually consumes — WITHOUT changing the bytes handed to the model.

Regression guard for the P1 where a worker-side `state["_retrieval_context_manifest"]`
was stashed but never lifted onto `parsed`, so the retrieval manifest silently
never reached the trace.
"""

from __future__ import annotations

import copy
import os
import sys
import unittest.mock
from unittest.mock import patch

import pytest

os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_tc_retrieval_test.db")
os.environ.setdefault("MIRA_TENANT_ID", "staging")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

for _mod in ("PIL", "PIL.Image", "slack_sdk", "slack_sdk.web.async_client", "slack_sdk.errors"):
    try:
        __import__(_mod)
    except ImportError:
        sys.modules[_mod] = unittest.mock.MagicMock()

from shared.engine import Supervisor  # noqa: E402
from shared.technician_context import augment_with_retrieval, build_turn_context  # noqa: E402

TENANT = "staging"  # slug — decision_traces.tenant_id is TEXT (mig 070)

ROWS = [
    {
        "id": "11111111-1111-1111-1111-111111111111",
        "recommendation": "Reseated the motor leads on CV-101.",
        "outcome": "resolved",
        "ts": "2026-07-29T10:00:00+00:00",
    }
]

STATE = {
    "state": "Q1",
    "context": {"uns_context": {"uns_path": "enterprise.garage.demo_cell.cv_101"}},
}

CHUNK_TEXT = "F004 trips when the DC bus exceeds 815 VDC."
CHUNKS = [
    {
        "manufacturer": "Allen-Bradley",
        "model_number": "PowerFlex 755",
        "source_url": "",
        "metadata": {"section": "DC Bus Faults"},
        "similarity": 0.87,
        "content": CHUNK_TEXT,
    }
]


def _state():
    return copy.deepcopy(STATE)


async def _ok_fetch(tenant_id, *, uns_path=None, limit=3, timeout_s=1.5):
    return ROWS, None


@pytest.fixture
def sup(tmp_path):
    return Supervisor(
        db_path=str(tmp_path / "mira_test.db"),
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id=TENANT,
    )


# ---------------------------------------------------------------------------
# augment_with_retrieval — the assembler (unit)
# ---------------------------------------------------------------------------


def test_augment_merges_both_families_into_one_validated_context(monkeypatch):
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    ctx, violations = build_turn_context(
        tenant_id=TENANT, question="why F004?", uns_context={}, prior_decisions=ROWS
    )
    assert ctx is not None and violations == []
    combined, viol = augment_with_retrieval(ctx, CHUNKS)
    assert viol == []
    assert combined is not None
    kinds = {e.kind.value for e in combined.evidence}
    assert kinds == {"prior_decision", "manual_chunk"}


def test_augment_is_noop_when_no_chunks():
    ctx, _ = build_turn_context(
        tenant_id=TENANT, question="q", uns_context={}, prior_decisions=ROWS
    )
    combined, viol = augment_with_retrieval(ctx, [])
    assert combined is None  # nothing new → keep the prior-only manifest
    assert viol == []


def test_augment_fails_closed_without_base_context():
    combined, viol = augment_with_retrieval(None, CHUNKS)
    assert combined is None
    assert "no_base_context" in viol


# ---------------------------------------------------------------------------
# engine → parsed → (trace) regression — the P1 fix
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_retrieval_family_reaches_parsed_manifest_without_touching_the_prompt(
    sup, monkeypatch
):
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    seen = {}

    async def _fake_rag_process(message, state, **kwargs):
        # capture what the model is handed, then stash this turn's chunks the way
        # RAGWorker.process does (before its LLM await)
        seen["kg_context"] = kwargs.get("kg_context", "")
        state["_rag_last_chunks"] = [dict(c) for c in CHUNKS]
        return '{"reply": "ok"}'

    state = _state()
    with (
        patch("shared.prior_decisions.fetch_prior_decisions", new=_ok_fetch),
        patch.object(sup.rag, "process", new=_fake_rag_process),
    ):
        _raw, parsed = await sup._call_with_correction("why F004?", state, tenant_id=TENANT)

    evidence = parsed["_context_manifest"]["manifest"]["evidence"]
    kinds = {e["kind"] for e in evidence}
    # BOTH families are in the single audited manifest…
    assert "prior_decision" in kinds
    assert "manual_chunk" in kinds, (
        "the retrieval family never reached the audited manifest — the P1 regression"
    )
    # …the carrier does not persist into session state…
    assert "_context_manifest" not in state
    # …and the chunk evidence never entered the PROMPT via the contract (audit-only:
    # chunks reach the model only through the RAG worker's own reference block).
    assert CHUNK_TEXT not in seen["kg_context"]


@pytest.mark.asyncio
async def test_no_chunks_keeps_the_prior_only_manifest(sup, monkeypatch):
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")

    async def _fake_rag_process(message, state, **kwargs):
        return '{"reply": "ok"}'  # stashes no chunks

    state = _state()
    with (
        patch("shared.prior_decisions.fetch_prior_decisions", new=_ok_fetch),
        patch.object(sup.rag, "process", new=_fake_rag_process),
    ):
        _raw, parsed = await sup._call_with_correction("q", state, tenant_id=TENANT)

    kinds = {e["kind"] for e in parsed["_context_manifest"]["manifest"]["evidence"]}
    assert kinds == {"prior_decision"}


@pytest.mark.asyncio
async def test_flag_off_records_no_manifest(sup, monkeypatch):
    monkeypatch.delenv("MIRA_CONTEXT_CONTRACT", raising=False)

    async def _fake_rag_process(message, state, **kwargs):
        state["_rag_last_chunks"] = [dict(c) for c in CHUNKS]
        return '{"reply": "ok"}'

    state = _state()
    with patch.object(sup.rag, "process", new=_fake_rag_process):
        _raw, parsed = await sup._call_with_correction("q", state, tenant_id=TENANT)

    assert parsed["_context_manifest"] is None


def test_contract_symbols_importable_from_package():
    from materialized_evidence import (  # noqa: PLC0415
        TechnicianContext,
        evidence_from_recall_chunks,
    )

    assert TechnicianContext is not None
    assert callable(evidence_from_recall_chunks)
