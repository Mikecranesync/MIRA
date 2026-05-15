"""Tests for _handle_general_question — KB-first decision tree + history threading."""

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

from shared.engine import Supervisor


@pytest.fixture
def supervisor(tmp_path):
    db_path = str(tmp_path / "test.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with patch("shared.engine.VisionWorker"):
            with patch("shared.engine.NameplateWorker"):
                with patch("shared.engine.RAGWorker"):
                    with patch("shared.engine.PrintWorker"):
                        with patch("shared.engine.PLCWorker"):
                            with patch("shared.engine.NemotronClient"):
                                with patch("shared.engine.InferenceRouter"):
                                    sup = Supervisor(
                                        db_path=db_path,
                                        openwebui_url="http://localhost:3000",
                                        api_key="test-key",
                                        collection_id="test-collection",
                                    )
    sup.router = MagicMock()
    sup.router.complete = AsyncMock(return_value=("answer body", {}))
    sup.rag = MagicMock()
    sup.rag.process = AsyncMock(return_value={"reply": "RAG ANSWER WITH CITATIONS"})
    return sup


def _state(history=None, asset=""):
    return {
        "state": "IDLE",
        "exchange_count": 0,
        "asset_identified": asset,
        "fault_category": None,
        "final_state": None,
        "context": {"history": list(history or [])},
    }


def test_call_llm_direct_threads_history(supervisor):
    history = [
        {"role": "user", "content": "first question"},
        {"role": "assistant", "content": "first answer"},
    ]

    asyncio.run(
        supervisor._call_llm_direct("second question", system="sys", history=history)
    )

    sent = supervisor.router.complete.call_args.args[0]
    roles = [m["role"] for m in sent]
    contents = [m["content"] for m in sent]
    assert roles == ["system", "user", "assistant", "user"]
    assert contents[0] == "sys"
    assert "first question" in contents
    assert "first answer" in contents
    assert contents[-1] == "second question"


def test_call_llm_direct_without_history_is_two_messages(supervisor):
    asyncio.run(supervisor._call_llm_direct("hi", system="sys"))
    sent = supervisor.router.complete.call_args.args[0]
    assert [m["role"] for m in sent] == ["system", "user"]


def test_general_question_routes_to_rag_when_kb_covered(supervisor):
    state = _state()

    with patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="Allen-Bradley", model="Micro 820"),
    ), patch(
        "shared.engine.kb_has_coverage", return_value=(True, "kb_42_chunks")
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ), patch.object(
        supervisor, "_parse_response", side_effect=lambda r: r if isinstance(r, dict) else {"reply": ""}
    ):
        result = asyncio.run(
            supervisor._handle_general_question(
                "telegram:1",
                "how do I configure the Micro 820 for Modbus?",
                state,
                "trace-1",
                tenant_id="t1",
            )
        )

    supervisor.rag.process.assert_awaited_once()
    assert "RAG ANSWER WITH CITATIONS" in result["reply"]


def test_general_question_hands_off_to_doc_lookup_when_no_coverage(supervisor):
    state = _state()

    doc_mock = AsyncMock(return_value={"reply": "DOC_LOOKUP_REPLY"})
    with patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="AutomationDirect", model="GS11"),
    ), patch(
        "shared.engine.kb_has_coverage", return_value=(False, "kb_only_0_chunks")
    ), patch.object(supervisor, "_do_documentation_lookup", new=doc_mock):
        result = asyncio.run(
            supervisor._handle_general_question(
                "telegram:1",
                "wire a GS11 over rs485",
                state,
                "trace-1",
                tenant_id="t1",
            )
        )

    doc_mock.assert_awaited_once()
    # Confirm vendor + model were threaded into the doc lookup
    call_kwargs = doc_mock.call_args.kwargs
    assert call_kwargs["vendor_override"] == "AutomationDirect"
    assert call_kwargs["model_override"] == "GS11"
    assert result["reply"] == "DOC_LOOKUP_REPLY"


def test_general_question_asks_clarifier_when_industrial_no_vendor(supervisor):
    state = _state()

    with patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="", model=""),
    ), patch(
        "shared.engine.kb_has_coverage", return_value=(False, "no_vendor")
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ):
        result = asyncio.run(
            supervisor._handle_general_question(
                "telegram:1",
                "the VFD is throwing an OC fault",
                state,
                "trace-1",
                tenant_id="t1",
            )
        )

    sent = supervisor.router.complete.call_args.args[0]
    system_msg = sent[0]["content"]
    # The clarifier system prompt must direct the LLM to ask for vendor/model,
    # not answer the question.
    assert "manufacturer" in system_msg.lower()
    assert "model" in system_msg.lower()
    assert result["reply"]


def test_general_question_answers_freely_when_truly_general(supervisor):
    history = [
        {"role": "user", "content": "earlier question"},
        {"role": "assistant", "content": "earlier answer"},
    ]
    state = _state(history=history)

    with patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="", model=""),
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ):
        asyncio.run(
            supervisor._handle_general_question(
                "telegram:1",
                "what does PID stand for?",
                state,
                "trace-1",
                tenant_id="t1",
            )
        )

    sent = supervisor.router.complete.call_args.args[0]
    contents = [m["content"] for m in sent]
    # History must be threaded through — the regression that started this whole
    # fix is the LLM not seeing prior turns.
    assert "earlier question" in contents
    assert "earlier answer" in contents


def test_general_question_does_not_clear_session_photo(supervisor):
    """Asking a clarifier mid-photo-diagnostic must not wipe the photo."""
    state = _state()
    state["context"]["photo_turn"] = 3  # simulate active session photo

    with patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="", model=""),
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ), patch.object(
        supervisor, "_clear_session_photo"
    ) as clear_photo:
        asyncio.run(
            supervisor._handle_general_question(
                "telegram:1",
                "what does PID stand for?",
                state,
                "trace-1",
                tenant_id="t1",
            )
        )
    clear_photo.assert_not_called()
    assert state["context"].get("photo_turn") == 3
