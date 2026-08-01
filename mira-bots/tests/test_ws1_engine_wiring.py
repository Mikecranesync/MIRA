"""WS1 engine wiring — the contract actually reaches the prompt and the trace.

The hermetic contract tests (`test_technician_context.py`) prove the assembly is
correct in isolation. These prove the Supervisor is a real CONSUMER of it: that
the prompt block reaches the RAG worker's system context, that the manifest
reaches `write_trace`, that the per-turn carrier never persists into session
state, and that every failure mode degrades to "no block" rather than "no
answer".

Adoption is the whole point of this slice — before it,
`evidence_from_prior_decisions()` had zero production call sites, which is what
blocked eval slice 13.
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from shared.engine import Supervisor  # noqa: E402

TENANT = "staging"  # slug tenant — decision_traces.tenant_id is TEXT (mig 070)

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


@pytest.fixture
def tmp_db(tmp_path):
    return str(tmp_path / "mira_test.db")


@pytest.fixture
def sup(tmp_db):
    return Supervisor(
        db_path=tmp_db,
        openwebui_url="http://stub",
        api_key="",
        collection_id="",
        tenant_id=TENANT,
    )


def _state():
    import copy

    return copy.deepcopy(STATE)


async def _ok_fetch(tenant_id, *, uns_path=None, limit=3, timeout_s=1.5):
    return ROWS, None


async def _failed_fetch(tenant_id, *, uns_path=None, limit=3, timeout_s=1.5):
    return [], "prior_decisions_unavailable"


async def _empty_fetch(tenant_id, *, uns_path=None, limit=3, timeout_s=1.5):
    return [], None


# ---------------------------------------------------------------------------
# The flag gates adoption — default off changes nothing
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flag_off_produces_no_block_and_no_manifest(sup, monkeypatch):
    monkeypatch.delenv("MIRA_CONTEXT_CONTRACT", raising=False)
    state = _state()
    block = await sup._build_prior_decisions_context(state, TENANT, "why stopped?")
    assert block == ""
    assert "_context_manifest" not in state


@pytest.mark.asyncio
async def test_flag_off_does_not_even_query(sup, monkeypatch):
    """No DB round-trip on the critical path when the feature is off."""
    monkeypatch.delenv("MIRA_CONTEXT_CONTRACT", raising=False)
    called = False

    async def _tripwire(*a, **k):
        nonlocal called
        called = True
        return [], None

    with patch("shared.prior_decisions.fetch_prior_decisions", new=_tripwire):
        await sup._build_prior_decisions_context(_state(), TENANT, "q")
    assert called is False


# ---------------------------------------------------------------------------
# Flag on — the block is built and the manifest is stashed
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_flag_on_builds_block_and_stashes_manifest(sup, monkeypatch):
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    state = _state()
    with patch("shared.prior_decisions.fetch_prior_decisions", new=_ok_fetch):
        block = await sup._build_prior_decisions_context(state, TENANT, "why stopped?")

    assert "PRIOR MIRA DECISIONS" in block
    assert "Reseated the motor leads" in block

    carrier = state["_context_manifest"]
    assert len(carrier["sha256"]) == 64
    assert carrier["manifest"]["tenant_id"] == TENANT
    assert carrier["manifest"]["evidence"][0]["trust"] == "candidate"


@pytest.mark.asyncio
async def test_empty_prior_history_does_not_stash_an_orphan_manifest(sup, monkeypatch):
    """A manifest is an audit of prompt context, not a flag-on heartbeat (P2)."""
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    state = _state()
    with patch("shared.prior_decisions.fetch_prior_decisions", new=_empty_fetch):
        block = await sup._build_prior_decisions_context(state, TENANT, "why stopped?")

    assert block == ""
    assert "_context_manifest" not in state


@pytest.mark.asyncio
async def test_confirmed_asset_narrows_the_recall_to_its_subtree(sup, monkeypatch):
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    seen = {}

    async def _capture(tenant_id, *, uns_path=None, limit=3, timeout_s=1.5):
        seen["tenant_id"] = tenant_id
        seen["uns_path"] = uns_path
        return ROWS, None

    with patch("shared.prior_decisions.fetch_prior_decisions", new=_capture):
        await sup._build_prior_decisions_context(_state(), TENANT, "q")

    assert seen["tenant_id"] == TENANT
    assert seen["uns_path"] == "enterprise.garage.demo_cell.cv_101"


@pytest.mark.asyncio
async def test_no_tenant_means_no_block(sup, monkeypatch):
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    state = _state()
    assert await sup._build_prior_decisions_context(state, None, "q") == ""
    assert "_context_manifest" not in state


# ---------------------------------------------------------------------------
# Every failure degrades to "no block", never to "no answer"
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_recall_failure_surfaces_as_an_observable_unknown(sup, monkeypatch):
    """Requirement 6: silence and "no prior context" must not be identical."""
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    state = _state()
    with patch("shared.prior_decisions.fetch_prior_decisions", new=_failed_fetch):
        block = await sup._build_prior_decisions_context(state, TENANT, "q")

    assert "prior_decisions_unavailable" in block
    assert "prior_decisions_unavailable" in state["_context_manifest"]["manifest"]["unknowns"]


@pytest.mark.asyncio
async def test_an_exception_anywhere_yields_an_empty_block_not_a_raise(sup, monkeypatch):
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")

    async def _boom(*a, **k):
        raise RuntimeError("neon down hard")

    state = _state()
    with patch("shared.prior_decisions.fetch_prior_decisions", new=_boom):
        block = await sup._build_prior_decisions_context(state, TENANT, "q")
    assert block == ""
    assert "_context_manifest" not in state


@pytest.mark.asyncio
async def test_a_stale_carrier_is_cleared_before_each_turn(sup, monkeypatch):
    """A previous turn's manifest must never be attributed to this one."""
    monkeypatch.delenv("MIRA_CONTEXT_CONTRACT", raising=False)
    state = _state()
    state["_context_manifest"] = {"manifest": {"stale": True}, "sha256": "x" * 64}
    await sup._build_prior_decisions_context(state, TENANT, "q")
    assert "_context_manifest" not in state


# ---------------------------------------------------------------------------
# The block reaches the prompt, and the manifest reaches the audit row
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_block_is_injected_into_the_rag_prompt_context(sup, monkeypatch):
    """The contract must reach the model, not just the log.

    `_call_with_correction` concatenates the enrichment blocks and hands them to
    `RAGWorker.process(kg_context=...)`, which the prompt builders splice into
    the system prompt. Assert on that argument — it is the actual seam.
    """
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")
    seen = {}

    async def _fake_rag_process(message, state, **kwargs):
        seen.update(kwargs)
        return '{"reply": "ok"}'

    state = _state()
    with (
        patch("shared.prior_decisions.fetch_prior_decisions", new=_ok_fetch),
        patch.object(sup.rag, "process", new=_fake_rag_process),
    ):
        await sup._call_with_correction("why stopped?", state, tenant_id=TENANT)

    assert "Reseated the motor leads" in seen["kg_context"], (
        "the prior-decision block never reached the prompt — the contract would "
        "be assembled and then thrown away"
    )


@pytest.mark.asyncio
async def test_carrier_moves_to_parsed_and_is_dropped_from_state(sup, monkeypatch):
    """It rides on the per-turn result, never into `_save_state`.

    Same discipline as the `_rag_*` keys: session state is persisted, so a
    manifest left there would both bloat the row and leak into the next turn.
    """
    monkeypatch.setenv("MIRA_CONTEXT_CONTRACT", "1")

    async def _fake_rag_process(message, state, **kwargs):
        return '{"reply": "ok"}'

    state = _state()
    with (
        patch("shared.prior_decisions.fetch_prior_decisions", new=_ok_fetch),
        patch.object(sup.rag, "process", new=_fake_rag_process),
    ):
        _raw, parsed = await sup._call_with_correction("q", state, tenant_id=TENANT)

    assert parsed["_context_manifest"]["manifest"]["evidence"][0]["kind"] == "prior_decision"
    assert "_context_manifest" not in state


@pytest.mark.asyncio
async def test_manifest_is_forwarded_to_the_decision_trace(sup):
    """G6: the audit row receives the object the prompt was built from."""
    recorded = {}

    async def _fake_write_trace(**kwargs):
        recorded.update(kwargs)

    carrier = {"manifest": {"contract_version": "1.0"}, "sha256": "c" * 64}
    with (
        patch.object(
            sup,
            "process_full",
            new=AsyncMock(return_value={"reply": "Check the VFD.", "_context_manifest": carrier}),
        ),
        patch("shared.decision_trace.write_trace", new=_fake_write_trace),
    ):
        await sup.process(chat_id="c1", message="why stopped?", tenant_id=TENANT)
        await asyncio.gather(*list(sup._decision_trace_tasks), return_exceptions=True)

    assert recorded.get("context_manifest") == carrier


@pytest.mark.asyncio
async def test_non_contract_turns_forward_no_manifest(sup):
    recorded = {}

    async def _fake_write_trace(**kwargs):
        recorded.update(kwargs)

    with (
        patch.object(sup, "process_full", new=AsyncMock(return_value={"reply": "ok"})),
        patch("shared.decision_trace.write_trace", new=_fake_write_trace),
    ):
        await sup.process(chat_id="c1", message="q", tenant_id=TENANT)
        await asyncio.gather(*list(sup._decision_trace_tasks), return_exceptions=True)

    assert recorded.get("context_manifest") is None
