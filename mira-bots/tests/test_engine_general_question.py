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
from shared.uns_resolver import UNSContext, UNSResolution


def _single_resolution(manufacturer="", model=""):
    """Build a UNSResolution that looks like a single-vendor result."""
    primary = UNSContext(manufacturer=manufacturer or None, model=model or None)
    candidates = (primary,) if manufacturer else ()
    return UNSResolution(primary=primary, candidates=candidates)


def _multi_resolution(pairs):
    """Build a UNSResolution from a list of (manufacturer, model) pairs."""
    candidates = tuple(
        UNSContext(manufacturer=mfr, model=mdl or None) for mfr, mdl in pairs
    )
    primary = candidates[0] if candidates else UNSContext()
    return UNSResolution(primary=primary, candidates=candidates)


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
        "shared.engine.resolve_uns_path_multi",
        return_value=_single_resolution("Allen-Bradley", "Micro 820"),
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
        "shared.engine.resolve_uns_path_multi",
        return_value=_single_resolution("AutomationDirect", "GS11"),
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


# ---------------------------------------------------------------------------
# Multi-vendor branch (the chimera scenario)
# ---------------------------------------------------------------------------


def test_general_question_routes_to_multi_vendor_handler(supervisor):
    """A message naming two vendors (after pair validation) takes the
    cross-vendor branch instead of guessing a single vendor."""
    state = _state()

    resolution = _multi_resolution(
        [("Rockwell Automation", "Micro 820"), ("AutomationDirect", "GS11")]
    )

    with patch(
        "shared.engine.resolve_uns_path_multi", return_value=resolution
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ):
        result = asyncio.run(
            supervisor._handle_general_question(
                "telegram:1",
                "connect my Micro 820 to an AutomationDirect GS11 over RS485 Modbus",
                state,
                "trace-1",
                tenant_id="t1",
            )
        )

    sent = supervisor.router.complete.call_args.args[0]
    system_msg = sent[0]["content"]
    # Both vendors must appear in the system prompt the LLM saw.
    assert "Rockwell Automation" in system_msg
    assert "AutomationDirect" in system_msg
    # Lead asset_identified must be set to a real vendor (not a chimera).
    assert state["asset_identified"] == "Rockwell Automation, Micro 820"
    assert result["reply"]


def test_multi_vendor_handler_never_invents_product_names(supervisor):
    """The system prompt for the multi-vendor handler must instruct the
    LLM to use only the named vendors/models — no chimeric inventions."""
    state = _state()
    resolution = _multi_resolution(
        [("Rockwell Automation", "Micro 820"), ("AutomationDirect", "GS11")]
    )

    with patch(
        "shared.engine.resolve_uns_path_multi", return_value=resolution
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ):
        asyncio.run(
            supervisor._handle_general_question(
                "telegram:1",
                "wire Micro 820 to GS11 over RS485 — how?",
                state,
                "trace-1",
                tenant_id="t1",
            )
        )

    system_msg = supervisor.router.complete.call_args.args[0][0]["content"]
    assert "never invent product names" in system_msg.lower()


# ---------------------------------------------------------------------------
# _do_documentation_lookup — chimera filter + menu/URL polish
# ---------------------------------------------------------------------------


def test_doc_lookup_chimera_filter_drops_model_when_pair_uncovered(supervisor):
    """The headline production fix: when (vendor, model) has zero pair
    coverage, _do_documentation_lookup must not speak the model."""
    state = _state()

    def fake_pair_coverage(vendor, model, tenant_id):
        # Simulate the live bug: vendor exists but no row pairs it with this model.
        return False, 0

    with patch(
        "shared.engine.kb_has_coverage", return_value=(True, "kb_4284_chunks")
    ), patch(
        "shared.engine.kb_has_pair_coverage", side_effect=fake_pair_coverage
    ), patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="AutomationDirect", model="820"),
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ), patch(
        "shared.engine.vendor_support_url", return_value=None
    ):
        result = asyncio.run(
            supervisor._do_documentation_lookup(
                "telegram:1",
                "connect Micro 820 to AutomationDirect GS11",
                state,
                "trace-1",
                "tenant-1",
                vendor_override="AutomationDirect",
                model_override="820",
            )
        )

    # Crucial: the chimeric "AutomationDirect 820" string must NOT appear.
    assert "AutomationDirect 820" not in result["reply"]
    # Vendor-only fallback IS allowed.
    assert "AutomationDirect" in result["reply"]


def test_doc_lookup_keeps_model_when_pair_covered(supervisor):
    """Real (vendor, model) pairs should still get the full product name."""
    state = _state()

    with patch(
        "shared.engine.kb_has_coverage", return_value=(True, "kb_4284_chunks")
    ), patch(
        "shared.engine.kb_has_pair_coverage", return_value=(True, 42)
    ), patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="AutomationDirect", model="GS11"),
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ), patch(
        "shared.engine.vendor_support_url", return_value=None
    ):
        result = asyncio.run(
            supervisor._do_documentation_lookup(
                "telegram:1",
                "manual for GS11",
                state,
                "trace-1",
                "tenant-1",
                vendor_override="AutomationDirect",
                model_override="GS11",
            )
        )

    assert "AutomationDirect GS11" in result["reply"]


def test_doc_lookup_suppresses_menu_on_specific_question(supervisor):
    """When the user asked a specific question (>3 words, not a greeting),
    the doc-lookup formatter must NOT append the generic 'Ask about manual,
    fault codes, specs, or wiring' menu — that reads as non-responsive."""
    state = _state()

    with patch(
        "shared.engine.kb_has_coverage", return_value=(True, "kb_4284_chunks")
    ), patch(
        "shared.engine.kb_has_pair_coverage", return_value=(True, 42)
    ), patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="AutomationDirect", model="GS11"),
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ), patch(
        "shared.engine.vendor_support_url", return_value=None
    ):
        result = asyncio.run(
            supervisor._do_documentation_lookup(
                "telegram:1",
                "how do I wire RS485 between Micro 820 and GS11",
                state,
                "trace-1",
                "tenant-1",
                vendor_override="AutomationDirect",
                model_override="GS11",
            )
        )

    assert "Ask about the manual" not in result["reply"]


def test_doc_lookup_keeps_menu_on_short_or_greeting_messages(supervisor):
    """Short / greeting-style messages still get the menu so the user has a
    discoverable next step."""
    state = _state()

    with patch(
        "shared.engine.kb_has_coverage", return_value=(True, "kb_4284_chunks")
    ), patch(
        "shared.engine.kb_has_pair_coverage", return_value=(True, 42)
    ), patch(
        "shared.engine.resolve_uns_path",
        return_value=MagicMock(manufacturer="AutomationDirect", model="GS11"),
    ), patch.object(supervisor, "_record_exchange"), patch.object(
        supervisor, "_save_state"
    ), patch(
        "shared.engine.vendor_support_url", return_value=None
    ):
        result = asyncio.run(
            supervisor._do_documentation_lookup(
                "telegram:1",
                "GS11",
                state,
                "trace-1",
                "tenant-1",
                vendor_override="AutomationDirect",
                model_override="GS11",
            )
        )

    assert "Ask about the manual" in result["reply"]


# ---------------------------------------------------------------------------
# _message_is_specific_question helper
# ---------------------------------------------------------------------------


def test_message_is_specific_question_basics():
    yes = Supervisor._message_is_specific_question
    assert yes("how do I wire RS485 between two drives") is True
    assert yes("connect Micro 820 to AutomationDirect GS11") is True
    # Greetings / short replies → not specific.
    assert yes("hi") is False
    assert yes("thanks") is False
    assert yes("ok cool great") is False  # 3 tokens, all in non-question set
    assert yes("") is False
    # Three words with at least one real content token → still too short.
    assert yes("rs485 wiring help") is False
    # Four real words → specific.
    assert yes("rs485 wiring help please") is True
