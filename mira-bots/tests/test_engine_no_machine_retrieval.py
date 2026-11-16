"""Questions that name no machine still reach the KB (pairs with the router fenced-JSON fix).

Measured 2026-11-16 (staging read-only, 40 release-gate cases): once route_intent
honoured the classifier, general_question / answer_question turns hit handlers that
did no retrieval. "What is the primary function of an AC drive?" got "which
manufacturer and model?" (branch 4) and how-to answers carried no citations.
Routing those turns to retrieval restored the score (37.3 vs 35.7 baseline).

Pinned here:
  - an educational industrial question with no vendor and no fault code goes to RAG;
  - control: a bare fault code with no vendor still gets the make/model clarifier;
  - an empty retrieval still falls back to the clarifier (no ungrounded answer);
  - the instructional handler retrieves first and falls back to the direct answer.

Run: cd mira-bots && python3 -m pytest tests/test_engine_no_machine_retrieval.py -q
"""

from __future__ import annotations

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")

from shared.engine import Supervisor  # noqa: E402

EDUCATIONAL = "What is the primary function of an AC drive in a motor control system?"
FAULT_NO_VENDOR = "the VFD is throwing an OC fault"
HOW_TO = "how do I wire a proximity sensor to a PLC input?"


@pytest.fixture
def supervisor(tmp_path):
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with patch("shared.engine.VisionWorker"), patch("shared.engine.NameplateWorker"):
            with patch("shared.engine.RAGWorker"), patch("shared.engine.PrintWorker"):
                with patch("shared.engine.PLCWorker"), patch("shared.engine.NemotronClient"):
                    with patch("shared.engine.InferenceRouter"):
                        sup = Supervisor(
                            db_path=str(tmp_path / "t.db"),
                            openwebui_url="http://localhost:3000",
                            api_key="test-key",
                            collection_id="test-collection",
                        )
    sup.router = MagicMock()
    sup.router.complete = AsyncMock(return_value=("DIRECT LLM ANSWER", {}))
    sup.rag = MagicMock()
    sup.rag.process = AsyncMock(return_value={"reply": "RAG ANSWER [Source: manual p.4]"})
    return sup


def _state():
    return {
        "state": "IDLE",
        "exchange_count": 0,
        "asset_identified": "",
        "fault_category": None,
        "final_state": None,
        "context": {"history": []},
    }


def _run(sup, coro_fn, message):
    with (
        patch.object(sup, "_record_exchange"),
        patch.object(sup, "_save_state"),
        patch.object(
            sup,
            "_parse_response",
            side_effect=lambda r: r if isinstance(r, dict) else {"reply": ""},
        ),
    ):
        return asyncio.run(coro_fn("telegram:1", message, _state(), "trace-1", tenant_id="t1"))


def test_educational_question_without_vendor_is_answered_from_the_kb(supervisor):
    r = _run(supervisor, supervisor._handle_general_question, EDUCATIONAL)
    supervisor.rag.process.assert_awaited_once()
    assert "RAG ANSWER" in r["reply"]
    assert "manufacturer" not in r["reply"].lower()


def test_control_bare_fault_code_still_asks_for_the_machine(supervisor):
    r = _run(supervisor, supervisor._handle_general_question, FAULT_NO_VENDOR)
    supervisor.rag.process.assert_not_awaited()
    system_msg = supervisor.router.complete.call_args.args[0][0]["content"].lower()
    assert "manufacturer" in system_msg and "model" in system_msg
    assert r["reply"]


def test_empty_retrieval_falls_back_to_the_clarifier(supervisor):
    supervisor.rag.process = AsyncMock(return_value={"reply": ""})
    _run(supervisor, supervisor._handle_general_question, EDUCATIONAL)
    supervisor.rag.process.assert_awaited_once()
    system_msg = supervisor.router.complete.call_args.args[0][0]["content"].lower()
    assert "manufacturer" in system_msg


def test_instructional_question_retrieves_first(supervisor):
    r = _run(supervisor, supervisor._handle_instructional_question, HOW_TO)
    supervisor.rag.process.assert_awaited_once()
    assert supervisor.rag.process.call_args.kwargs["tenant_id"] == "t1"
    supervisor.router.complete.assert_not_awaited()
    assert "RAG ANSWER" in r["reply"]


def test_instructional_falls_back_to_direct_answer_when_kb_is_empty(supervisor):
    supervisor.rag.process = AsyncMock(return_value={"reply": ""})
    r = _run(supervisor, supervisor._handle_instructional_question, HOW_TO)
    supervisor.router.complete.assert_awaited_once()
    assert r["reply"] == "DIRECT LLM ANSWER"


def test_retrieval_error_falls_through_not_raises(supervisor):
    supervisor.rag.process = AsyncMock(side_effect=RuntimeError("kb down"))
    r = _run(supervisor, supervisor._handle_instructional_question, HOW_TO)
    assert r["reply"] == "DIRECT LLM ANSWER"
