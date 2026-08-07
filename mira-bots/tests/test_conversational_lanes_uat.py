"""UAT 2026-08-06 (telegramtest1) — conversational-lane and doc-honesty fixes.

Four defects observed live on deployed main:

N1  "what can you do?" was stolen from the keyword help lane by the router's
    general_question dispatch and got a KB-gap footer (RTE-001 class: the
    deterministic lane outranks the router label).
N2  "thanks" mid-gate got the full canned self-intro AND silently dropped the
    pending equipment confirmation; "thanks" after an answer re-introduced
    MIRA from scratch (CON-003).
N3  The D2 symptom-first turn promised symptom-only guidance, then the RAG
    reply asked "What's the drive's make and model?" anyway (IDN-001
    follow-through).
N4  "do you have the gs10 manual?" was answered "No, I don't have the manual"
    by RAG — AFTER kb_has_coverage returned True. A possession question about
    documentation takes the deterministic possession-claim path, never the
    RAG handoff (DOC honesty).
"""

from __future__ import annotations

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
from shared.workers.rag_worker import RAGWorker  # noqa: E402

RAG_REPLY = '{"reply": "stub", "next_state": "Q1", "options": []}'


@pytest.fixture
def sv(tmp_path):
    db_path = str(tmp_path / "uat.db")
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
            sup = Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test-key",
                collection_id="test-collection",
            )
    sup.rag = MagicMock()

    async def fake_rag(message, state, *args, **kwargs):
        return RAG_REPLY

    sup.rag.process = fake_rag
    return sup


def _router(intent, confidence=0.95):
    return {"intent": intent, "confidence": confidence, "reasoning": "test"}


KB_GAP_MARK = "KB-gap"


# ── N1: keyword help/greeting lanes outrank the router label ────────────────


@pytest.mark.asyncio
async def test_help_not_stolen_by_router_general_question(sv):
    chat = "n1-help"
    gq_spy = AsyncMock()
    sv._handle_general_question = gq_spy
    with patch(
        "shared.engine.route_intent", new=AsyncMock(return_value=_router("general_question"))
    ):
        reply = await sv.process(chat, "what can you do?")
    assert gq_spy.await_count == 0, "router general_question must not steal a keyword-help turn"
    assert KB_GAP_MARK not in reply, reply
    assert "diagnose" in reply.lower()


@pytest.mark.asyncio
async def test_greeting_not_stolen_by_router_general_question(sv):
    chat = "n1-greet"
    gq_spy = AsyncMock()
    sv._handle_general_question = gq_spy
    with patch(
        "shared.engine.route_intent", new=AsyncMock(return_value=_router("general_question"))
    ):
        reply = await sv.process(chat, "hello")
    assert gq_spy.await_count == 0
    assert KB_GAP_MARK not in reply


# ── N2: thanks / help while the gate is pending; thanks after an answer ─────


def _pending_gate_state():
    return {
        "state": "IDLE",
        "asset_identified": "",
        "exchange_count": 1,
        "context": {
            "history": [
                {"role": "user", "content": "my conveyor keeps stopping randomly"},
                {
                    "role": "assistant",
                    "content": "Before I diagnose, I need to know the equipment.",
                },
            ],
            "session_context": {},
            "pending_uns_confirm": {"candidate": None},
        },
    }


@pytest.mark.asyncio
async def test_thanks_mid_gate_keeps_pending_and_reminds(sv):
    chat = "n2-thanks-gate"
    sv._save_state(chat, _pending_gate_state())
    with patch(
        "shared.engine.route_intent",
        new=AsyncMock(return_value=_router("greeting_or_chitchat")),
    ):
        reply = await sv.process(chat, "thanks")
    saved = sv._load_state(chat)
    assert (saved.get("context") or {}).get("pending_uns_confirm"), (
        "a conversational turn must not consume the pending equipment confirmation"
    )
    low = reply.lower()
    assert "manufacturer" in low or "nameplate" in low or "model" in low, reply
    assert "maintenance copilot" not in low, "no canned self re-intro on a thanks turn"
    assert KB_GAP_MARK not in reply


@pytest.mark.asyncio
async def test_help_mid_gate_keeps_pending_and_reminds(sv):
    chat = "n2-help-gate"
    sv._save_state(chat, _pending_gate_state())
    with patch(
        "shared.engine.route_intent", new=AsyncMock(return_value=_router("general_question"))
    ):
        reply = await sv.process(chat, "what can you do?")
    saved = sv._load_state(chat)
    assert (saved.get("context") or {}).get("pending_uns_confirm")
    low = reply.lower()
    assert "manufacturer" in low or "nameplate" in low or "model" in low, reply
    assert KB_GAP_MARK not in reply


@pytest.mark.asyncio
async def test_thanks_after_answer_is_brief_not_reintro(sv):
    chat = "n2-thanks-idle"
    with patch(
        "shared.engine.route_intent",
        new=AsyncMock(return_value=_router("greeting_or_chitchat")),
    ):
        reply = await sv.process(chat, "thanks")
    assert "maintenance copilot" not in reply.lower(), (
        "a thanks is acknowledged, never answered with the full self-intro"
    )
    assert KB_GAP_MARK not in reply


@pytest.mark.asyncio
async def test_hello_still_gets_the_intro(sv):
    chat = "n2-hello"
    with patch(
        "shared.engine.route_intent",
        new=AsyncMock(return_value=_router("greeting_or_chitchat")),
    ):
        reply = await sv.process(chat, "hello")
    assert "MIRA" in reply


# ── N3: identity-unknown sessions never get asked for make/model by RAG ─────


def _identity_unknown_state():
    return {
        "state": "Q1",
        "asset_identified": "",
        "exchange_count": 2,
        "context": {
            "history": [
                {"role": "user", "content": "Something's wrong with one of our drives"},
                {
                    "role": "assistant",
                    "content": "Before I diagnose, I need to know the equipment.",
                },
            ],
            "uns_identity_unknown": True,
        },
    }


@pytest.mark.parametrize("builder", ["_build_prompt", "_build_prompt_with_chunks"])
def test_identity_unknown_directive_in_prompt(builder):
    w = RAGWorker("http://mock", "key", "coll")
    state = _identity_unknown_state()
    if builder == "_build_prompt_with_chunks":
        messages = w._build_prompt_with_chunks(state, "it keeps faulting", [])
    else:
        messages = w._build_prompt(state, "it keeps faulting")
    joined = " ".join(m["content"] for m in messages if m["role"] == "system")
    assert "IDENTITY UNAVAILABLE" in joined, "symptom-first prompt directive missing"


@pytest.mark.parametrize("builder", ["_build_prompt", "_build_prompt_with_chunks"])
def test_identity_known_no_directive(builder):
    w = RAGWorker("http://mock", "key", "coll")
    state = _identity_unknown_state()
    state["asset_identified"] = "AutomationDirect, GS10"
    if builder == "_build_prompt_with_chunks":
        messages = w._build_prompt_with_chunks(state, "it keeps faulting", [])
    else:
        messages = w._build_prompt(state, "it keeps faulting")
    joined = " ".join(m["content"] for m in messages if m["role"] == "system")
    assert "IDENTITY UNAVAILABLE" not in joined, (
        "once the asset is identified the directive must stop"
    )


# ── N4: a doc-possession question takes the possession-claim path ────────────


@pytest.mark.asyncio
async def test_doc_possession_question_gets_deterministic_claim(sv):
    chat = "n4-possession"
    state = {
        "state": "Q1",
        "asset_identified": "AutomationDirect, GS10",
        "exchange_count": 2,
        "context": {
            "history": [],
            "uns_context": {"manufacturer": "AutomationDirect", "model": "GS10"},
        },
    }
    gq_spy = AsyncMock()
    sv._handle_general_question = gq_spy
    with (
        patch("shared.engine.kb_has_coverage", return_value=(True, "vendor_match")),
        patch("shared.engine.kb_has_pair_coverage", return_value=(True, 5)),
    ):
        result = await sv._do_documentation_lookup(
            chat,
            "do you have the gs10 manual?",
            state,
            "trace-n4",
            "tenant",
            vendor_override="AutomationDirect",
            model_override="GS10",
        )
    assert gq_spy.await_count == 0, (
        "a possession question must never be handed to RAG — it fabricates a denial"
    )
    assert "indexed" in result["reply"].lower(), result["reply"]


@pytest.mark.asyncio
async def test_specific_spec_question_still_hands_off_to_rag(sv):
    chat = "n4-spec"
    state = {
        "state": "IDLE",
        "asset_identified": "AutomationDirect, GS10",
        "exchange_count": 2,
        "context": {
            "history": [],
            "uns_context": {"manufacturer": "AutomationDirect", "model": "GS10"},
        },
    }
    gq_spy = AsyncMock(return_value={"reply": "answered", "confidence": "medium"})
    sv._handle_general_question = gq_spy
    with (
        patch("shared.engine.kb_has_coverage", return_value=(True, "vendor_match")),
        patch("shared.engine.kb_has_pair_coverage", return_value=(True, 5)),
    ):
        await sv._do_documentation_lookup(
            chat,
            "what is the default overload trip class on the GS10?",
            state,
            "trace-n4b",
            "tenant",
            vendor_override="AutomationDirect",
            model_override="GS10",
        )
    assert gq_spy.await_count == 1, "the ct-04 answer handoff must be preserved for spec questions"
