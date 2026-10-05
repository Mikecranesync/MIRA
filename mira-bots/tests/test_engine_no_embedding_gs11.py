"""End-to-end regression test: engine path with Ollama embed sidecar down.

Joins the two existing layers — `test_recall_no_embedding_fallthrough.py`
(DB layer) and `tests/test_quality_gate_stream_aware.py` (gate layer) — at
the engine layer: `RAGWorker.process()`.

Simulates the 2026-05-18 GS11 demo failure mode:
  1. Ollama embed sidecar returns None (Bravo Tailscale dead + VPS localhost
     only has qwen2.5vl, no embedder).
  2. `recall_knowledge` MUST still surface BM25 chunks (PR #1385 fix).
  3. RAGWorker quality gate MUST keep BM25-tagged chunks (PR #1379 fix).
  4. The chunks MUST land in the LLM prompt, so `_last_no_kb` stays False.

If any of those layers regress, this test fails — covering more ground than
the unit-level recall/gate tests in isolation.
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

REPO_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
MIRA_BOTS = os.path.join(REPO_ROOT, "mira-bots")
if MIRA_BOTS not in sys.path:
    sys.path.insert(0, MIRA_BOTS)

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("MIRA_TENANT_ID", "test-tenant-gs11")

from shared.workers.rag_worker import RAGWorker  # noqa: E402

GS11_BM25_CHUNKS = [
    {
        "content": (
            "GS11 Modbus register 8192 (0x2000) is the run/stop/direction "
            "command word. Values: 1 = stop, 18 = run forward, 20 = run reverse."
        ),
        "manufacturer": "AutomationDirect",
        "model_number": "GS11",
        "equipment_type": "VFD",
        "source_type": "manual",
        "source_url": None,
        "source_page": 47,
        "metadata": {"section": "Modbus register map"},
        "similarity": 7.5,  # ts_rank_cd magnitude, NOT cosine-comparable
        "retrieval_streams": ["bm25"],
    },
    {
        "content": "GS11 register 8193 is the frequency reference (Hz × 100).",
        "manufacturer": "AutomationDirect",
        "model_number": "GS11",
        "equipment_type": "VFD",
        "source_type": "manual",
        "source_url": None,
        "source_page": 48,
        "metadata": {"section": "Modbus register map"},
        "similarity": 6.2,
        "retrieval_streams": ["bm25"],
    },
]


def _make_worker() -> RAGWorker:
    router = MagicMock()
    router.enabled = False  # force the worker to go through _call_llm rather than router
    worker = RAGWorker(
        openwebui_url="http://test-openwebui",
        api_key="test-key",
        collection_id="test-collection",
        nemotron=None,
        router=router,
        tenant_id="test-tenant-gs11",
    )
    return worker


@pytest.mark.asyncio
async def test_gs11_modbus_query_grounded_when_embedding_fails():
    """The exact 2026-05-18 demo regression in a single assertion path.

    Ollama embed returns None → recall_knowledge still finds BM25 chunks →
    chunks survive the quality gate → prompt contains register 8192 → the
    bot's reply is grounded, not "general industrial knowledge".
    """
    worker = _make_worker()

    captured_messages: list = []

    async def fake_call_llm(messages, model=None):
        captured_messages.append(messages)
        return (
            "Write decimal 18 to GS11 register 8192 (0x2000) via Modbus FC06. "
            "Set frequency at register 8193 (Hz × 100) first."
        )

    with (
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=None)) as embed_mock,
        patch.object(worker, "_call_llm", new=fake_call_llm),
        patch(
            "shared.workers.rag_worker._neon_recall.recall_knowledge",
            return_value=list(GS11_BM25_CHUNKS),
        ) as recall_mock,
    ):
        state = {
            "state": "DIAGNOSIS",
            "asset_identified": "GS11 drive",
            "fault_category": "",
            "exchange_count": 1,
            "context": {
                "uns_context": {"manufacturer": "AutomationDirect", "model": "GS11"},
                "triage_result": {"confidence": "medium"},
            },
        }
        reply = await worker.process(
            message="What parameters do I need to write the word to the GS11 drive?",
            state=state,
        )

    # 1. Embedder was called (engine attempted retrieval) and returned None
    embed_mock.assert_awaited()

    # 2. recall_knowledge was invoked with embedding=None — proves the engine
    #    no longer gates on a successful embed (PR #1385 fix).
    recall_mock.assert_called()
    call_args, call_kwargs = recall_mock.call_args
    embedding_arg = call_args[0] if call_args else call_kwargs.get("embedding")
    assert embedding_arg is None, (
        f"recall_knowledge must be called with embedding=None when Ollama is down, "
        f"got {embedding_arg!r}"
    )

    # 3. Quality gate kept the BM25 chunks (similarity=7.5 is ts_rank_cd not
    #    cosine, but retrieval_streams=['bm25'] exempts it from the 0.70 gate).
    assert worker._last_no_kb is False, (
        "Quality gate suppressed BM25-only chunks — regression of PR #1379. "
        f"_last_neon_chunks={len(worker._last_neon_chunks)} chunks"
    )

    # 4. Chunks landed in the prompt sent to the LLM, so the reply is grounded.
    assert captured_messages, "LLM was never called"
    prompt_text = str(captured_messages[-1])
    assert "8192" in prompt_text, (
        "Register 8192 missing from LLM prompt — BM25 chunks were dropped "
        "between recall and prompt-build."
    )
    assert "GS11" in prompt_text, "GS11 model context missing from LLM prompt"

    # 5. Sanity: reply itself looks grounded (sourced from our fake LLM).
    assert "8192" in reply


@pytest.mark.asyncio
async def test_no_kb_coverage_when_recall_also_returns_nothing():
    """Negative control: when both embed AND recall return nothing, NO_KB_COVERAGE
    must fire. Guards against test_gs11_… passing because the mock leaked chunks
    into a path that should have produced the empty-state branch.
    """
    worker = _make_worker()

    async def fake_call_llm(messages, model=None):
        return "no kb response"

    with (
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", new=fake_call_llm),
        patch(
            "shared.workers.rag_worker._neon_recall.recall_knowledge",
            return_value=[],
        ),
    ):
        state = {
            "state": "DIAGNOSIS",
            "asset_identified": "GS11 drive",
            "fault_category": "",
            "exchange_count": 1,
            "context": {"triage_result": {}},
        }
        await worker.process(
            message="What parameters do I need to write the word to the GS11 drive?",
            state=state,
        )

    assert worker._last_no_kb is True, (
        "Empty recall result must trip NO_KB_COVERAGE; if False, the test above "
        "is meaningless because chunks aren't actually flowing through process()."
    )


@pytest.mark.asyncio
async def test_no_kb_coverage_when_tenant_is_missing():
    """No KB ACCESS AT ALL must be at least as honest as KB-returned-nothing.

    The NeonDB recall block is gated on a truthy tenant, and `no_kb` used to read
    `retrieval_attempted and not photo_b64` — where `retrieval_attempted` is just
    `bool(effective_tenant)`. So a turn with NO tenant skipped recall AND skipped
    the honesty directive, and MIRA answered a technical question from parametric
    knowledge with zero chunks, zero citations and no admission that it had no
    documentation. A turn where recall ran and found nothing DID disclaim. That is
    backwards: losing KB access entirely made the reply MORE confident, not less.

    Observed in Answer Radar (PR #3584): 6/6 questions answered with
    retrieved_chunk_count=0 and 0% citation coverage, including a confidently
    stated wrong protocol (an SLC 5/03's DH-485 port described as DH+).
    """
    worker = _make_worker()
    worker.tenant_id = ""  # no tenant → the recall block above is skipped entirely

    async def fake_call_llm(messages, model=None):
        return "answer with no kb access"

    recall = MagicMock(return_value=[])
    with (
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", new=fake_call_llm),
        patch("shared.workers.rag_worker._neon_recall.recall_knowledge", new=recall),
    ):
        state = {
            "state": "DIAGNOSIS",
            "asset_identified": "GS11 drive",
            "fault_category": "",
            "exchange_count": 1,
            "context": {"triage_result": {}},
        }
        await worker.process(
            message="What parameters do I need to write the word to the GS11 drive?",
            state=state,
        )

    # Precondition: with no tenant, recall genuinely never ran — otherwise this
    # test would be proving something else.
    assert recall.call_count == 0, "no-tenant turn must not reach recall_knowledge"

    assert worker._last_no_kb is True, (
        "A text turn that reaches the LLM with zero chunks must carry the no-KB "
        "honesty directive even when retrieval could not be attempted at all. "
        "Gating it on retrieval_attempted let a missing tenant silently produce "
        "confident, uncited answers."
    )


if __name__ == "__main__":
    asyncio.run(test_gs11_modbus_query_grounded_when_embedding_fails())
    asyncio.run(test_no_kb_coverage_when_recall_also_returns_nothing())
    print("PASS")
    asyncio.run(test_no_kb_coverage_when_tenant_is_missing())
