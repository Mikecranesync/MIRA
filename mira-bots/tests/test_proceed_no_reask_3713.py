"""Regression tests for #3713: after PROCEED on an out-of-KB asset, the diagnosis
turn must not re-ask for the manufacturer.

Fixture gs3_ground_fault_14 (tests/eval/fixtures/14_gs3_ground_fault.yaml):
  turns 1-4 name GS3 (AutomationDirect, manufacturer-only, uns confidence 0.5
  decaying below 0.5 by turn 6; asset_identified is never pinned because the
  pin threshold is 0.7). Turn 5 is PROCEED. Turn 6 has no KB chunks and the
  no-KB branch of RAGWorker.process() returned the clarifier "1. Manufacturer".

The PROCEED intercept answers the user's consent with a canned line and never
sets a durable marker, so the diagnosis turn cannot know the technician already
accepted a best estimate. The fix persists that consent on state["context"] and
the no-KB branch honours it by answering with the no-KB directive instead of
the clarifier.
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
os.environ.setdefault("MIRA_TENANT_ID", "test-tenant-3713")

from shared.workers.rag_worker import RAGWorker  # noqa: E402

GS3_TURN6 = "What do you think is causing the ground fault and what should I check first?"
CLARIFIER_MARKER = "**Manufacturer**"


def _make_worker() -> RAGWorker:
    router = MagicMock()
    router.enabled = False
    return RAGWorker(
        openwebui_url="http://test-openwebui",
        api_key="test-key",
        collection_id="test-collection",
        nemotron=None,
        router=router,
        tenant_id="test-tenant-3713",
    )


def _gs3_state(consent: bool) -> dict:
    """Session state at turn 6 of gs3_ground_fault_14: GS3 known to the UNS
    resolver as manufacturer-only, asset never pinned, FSM in DIAGNOSIS."""
    context: dict = {
        "uns_context": {
            "manufacturer": "AutomationDirect",
            "model": None,
            "confidence": 0.328,
        },
        "triage_result": {"confidence": "medium"},
    }
    if consent:
        context["proceed_consent"] = True
    return {
        "state": "DIAGNOSIS",
        "asset_identified": "",
        "fault_category": "",
        "exchange_count": 5,
        "context": context,
    }


@pytest.mark.asyncio
async def test_proceed_consent_skips_manufacturer_reask_on_no_kb_turn():
    """After PROCEED, the no-KB diagnosis turn answers under the no-KB directive
    instead of returning the 'Manufacturer / Model / Exact code' clarifier."""
    worker = _make_worker()
    captured: list = []

    async def fake_call_llm(messages, model=None):
        captured.append(messages)
        return "Based on general industrial knowledge: check the motor insulation and cable."

    with (
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", new=fake_call_llm),
        patch(
            "shared.workers.rag_worker._neon_recall.recall_knowledge",
            return_value=[],
        ),
    ):
        reply = await worker.process(message=GS3_TURN6, state=_gs3_state(consent=True))

    assert worker._last_no_kb is True, "fixture must reach the no-KB branch"
    assert CLARIFIER_MARKER not in reply, f"re-asked for manufacturer: {reply!r}"
    assert captured, "LLM must answer after PROCEED consent, not return the clarifier"
    prompt_text = str(captured[-1])
    assert "NO KB COVERAGE" in prompt_text


@pytest.mark.asyncio
async def test_without_consent_clarifier_still_fires():
    """Negative control: without PROCEED consent the no-asset clarifier is unchanged."""
    worker = _make_worker()

    llm_calls: list = []

    async def fake_call_llm(messages, model=None):
        llm_calls.append(messages)
        return "should not be called"

    with (
        patch.object(worker, "_embed_ollama", new=AsyncMock(return_value=None)),
        patch.object(worker, "_call_llm", new=fake_call_llm),
        patch(
            "shared.workers.rag_worker._neon_recall.recall_knowledge",
            return_value=[],
        ),
    ):
        reply = await worker.process(message=GS3_TURN6, state=_gs3_state(consent=False))

    assert CLARIFIER_MARKER in reply
    assert llm_calls == [], "without consent the clarifier returns before any LLM call"


# ---------------------------------------------------------------------------
# Engine seam: the PROCEED intercept must persist consent (red before fix).
# ---------------------------------------------------------------------------


@pytest.fixture
def _sup(tmp_path):
    from unittest.mock import patch

    from shared.engine import Supervisor

    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with (
            patch("shared.engine.VisionWorker"),
            patch("shared.engine.NameplateWorker"),
            patch("shared.engine.RAGWorker"),
            patch("shared.engine.PrintWorker"),
            patch("shared.engine.PLCWorker"),
            patch("shared.engine.NemotronClient"),
            patch("shared.engine.InferenceRouter"),
        ):
            return Supervisor(
                db_path=str(tmp_path / "proceed.db"),
                openwebui_url="http://localhost:3000",
                api_key="test-key",
                collection_id="test-collection",
            )


@pytest.mark.asyncio
async def test_proceed_intercept_persists_consent(_sup):
    chat_id = "chat-3713"
    state = _sup._load_state(chat_id)
    state["state"] = "DIAGNOSIS"
    state["context"] = {"uns_context": {"manufacturer": "AutomationDirect", "confidence": 0.5}}
    _sup._save_state(chat_id, state)

    await _sup.process_full(chat_id, "PROCEED")

    saved = _sup._load_state(chat_id)
    assert (saved.get("context") or {}).get("proceed_consent") is True, (
        "PROCEED must persist consent so the next diagnosis turn does not re-ask"
    )
