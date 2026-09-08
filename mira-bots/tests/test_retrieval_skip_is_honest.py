"""Regression: a SKIPPED retrieval must admit the gap, not report "no gap".

`RAGWorker.process()` wraps its entire retrieval block in `if effective_tenant:`
(rag_worker.py). When the tenant resolves falsy, recall is never called — no
error, no log, no zero-results path. The code simply does not run.

That alone is survivable. What made it dangerous is what the no-chunks branch
then concluded:

    no_kb = retrieval_attempted and not photo_b64   # retrieval_attempted = bool(tenant)

With a falsy tenant that evaluates to False, so `_last_no_kb` was False — the
same value it carries when retrieval ran and *found grounding*. The honesty
directive and the clarification shortcut were both skipped and the turn answered
from parametric memory, uncited. **Never looking was recorded as evidence of no
gap.**

This is the mechanism behind the #3602 symptom: six Answer Radar seed questions
answered with zero retrieved chunks, no citation and no KB-gap admission, one of
them confidently wrong about a protocol.

These tests pin the corrected behaviour in both directions, so a future edit
cannot quietly restore the silent path. Note the tests assert on `_last_no_kb`
rather than on a log line: a log is not a control (see #3648), and the flag is
what downstream citation logic actually reads.
"""

from __future__ import annotations

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

from shared.workers.rag_worker import RAGWorker  # noqa: E402

QUESTION = "The SLC 5/03 keeps dropping its comms link. Where do I start?"


def _make_worker(tenant_id: str | None) -> RAGWorker:
    router = MagicMock()
    router.enabled = False
    return RAGWorker(
        openwebui_url="http://test-openwebui",
        api_key="test-key",
        collection_id="test-collection",
        nemotron=None,
        router=router,
        tenant_id=tenant_id,
    )


def _state() -> dict:
    return {
        "state": "DIAGNOSIS",
        "asset_identified": "SLC 5/03",
        "fault_category": "",
        "exchange_count": 1,
        "context": {"triage_result": {"confidence": "medium"}},
    }


@pytest.mark.asyncio
@pytest.mark.parametrize("tenant", ["", None])
async def test_skipped_retrieval_admits_the_gap(tenant):
    """Falsy tenant → recall never called → the turn must still report no_kb.

    This is the assertion that fails on the pre-fix code, where `no_kb` was
    `retrieval_attempted and not photo_b64` and therefore False.
    """
    worker = _make_worker(tenant)

    async def fake_call_llm(messages, model=None):
        return "Check the DH-485 termination and the channel configuration."

    with (
        patch.object(worker, "_call_llm", new=fake_call_llm),
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=None)) as embed_mock,
        patch(
            "shared.workers.rag_worker._neon_recall.recall_knowledge",
            return_value=[],
        ) as recall_mock,
    ):
        await worker.process(message=QUESTION, state=_state())

    # The gate really did skip retrieval — this is the precondition, not the point.
    recall_mock.assert_not_called()
    embed_mock.assert_not_awaited()

    # The point: a skipped retrieval is an admitted gap, not a silent success.
    assert worker._last_no_kb is True, (
        "retrieval was skipped (falsy tenant) and produced zero chunks, but the "
        "worker reported no_kb=False — the same value it carries when retrieval "
        "found grounding. Not looking is not evidence of no gap (#3602)."
    )


@pytest.mark.asyncio
async def test_retrieval_that_ran_and_found_nothing_still_admits_the_gap():
    """Control: the pre-existing honest path must be unchanged by the fix."""
    worker = _make_worker("test-tenant-3602")

    async def fake_call_llm(messages, model=None):
        return "I don't have documentation for that asset."

    with (
        patch.object(worker, "_call_llm", new=fake_call_llm),
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=[0.1] * 4)),
        patch(
            "shared.workers.rag_worker._neon_recall.recall_knowledge",
            return_value=[],
        ) as recall_mock,
    ):
        await worker.process(message=QUESTION, state=_state())

    recall_mock.assert_called()
    assert worker._last_no_kb is True


@pytest.mark.asyncio
async def test_retrieval_that_found_grounding_does_not_claim_a_gap():
    """Control: the fix must not make every turn claim a KB gap.

    Without this, `no_kb = not photo_b64` could be satisfied by a change that
    simply hardcodes True, and both tests above would still pass.
    """
    worker = _make_worker("test-tenant-3602")

    async def fake_call_llm(messages, model=None):
        return "Per the manual, check channel 0 configuration."

    chunk = {
        "content": "SLC 5/03 channel 0 is the DH-485 port; channel 1 is RS-232.",
        "manufacturer": "Allen-Bradley",
        "model_number": "SLC 5/03",
        "equipment_type": "PLC",
        "source_type": "manual",
        "source_url": None,
        "source_page": 12,
        "metadata": {"section": "Channel configuration"},
        "similarity": 7.1,
        "retrieval_streams": ["bm25"],
    }

    with (
        patch.object(worker, "_call_llm", new=fake_call_llm),
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=[0.1] * 4)),
        patch(
            "shared.workers.rag_worker._neon_recall.recall_knowledge",
            return_value=[chunk],
        ),
    ):
        await worker.process(message=QUESTION, state=_state())

    assert worker._last_no_kb is False
