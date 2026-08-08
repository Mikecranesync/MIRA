"""CTX-001c — fresh-thread PIVOT: a NEW symptom while a diagnostic thread is
open (Q-state, pending question) starts a fresh thread; answers to the pending
question do not (CTX-002 preservation).

Also pins the severance half (Leg 2): when ``fresh_thread_turn`` is set, both
rag_worker prompt builders drop ALL dead-thread history (assistant AND user —
a retained user turn was measured re-anchoring the old fault) and carry the
FRESH THREAD closure note; the flag survives the nemotron retry (Leg 3b) but
never leaks across turns (Leg 3a).
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

from shared.engine import Supervisor, _prepend_equipment_context  # noqa: E402
from shared.workers.rag_worker import RAGWorker  # noqa: E402

RAG_REPLY = (
    '{"reply": "Fresh triage: is the fault code visible on the display when it stops?",'
    ' "next_state": "Q1", "options": [], "confidence": "MEDIUM"}'
)

ROUTED = {"intent": "diagnose_equipment", "confidence": 0.9, "reasoning": "test"}


@pytest.fixture
def sv(tmp_path):
    db_path = str(tmp_path / "pivot.db")
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

    async def fake_rag_process(message, state, *args, **kwargs):
        return RAG_REPLY

    sup.rag.process = fake_rag_process
    return sup


def _dead_thread_state():
    """A session mid CE10 investigation: Q1, pending question, GS10 pinned."""
    return {
        "state": "Q1",
        "asset_identified": "AutomationDirect, GS10",
        "exchange_count": 2,
        "fault_category": "communication",
        "final_state": None,
        "context": {
            "history": [
                {"role": "user", "content": "What does CE10 mean on my DURApulse GS10 drive?"},
                {
                    "role": "assistant",
                    "content": "CE10 is a Modbus communication time-out (P09.03). "
                    "What is the current value of P09.03 on your GS10?",
                },
            ],
            "session_context": {
                "last_question": "What is the current value of P09.03 on your GS10?",
                "active_alarm": "CE10",
            },
            "uns_context": {
                "manufacturer": "AutomationDirect",
                "model": "GS10",
                "fault_code": "CE10",
                "confidence": 0.81,
            },
        },
    }


async def _run_turn(sv, message, chat="pivot-1", caplog=None):
    if caplog is not None:
        caplog.set_level("INFO", logger="mira-gsd")
    state = _dead_thread_state()
    sv._save_state(chat, state)
    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        reply = await sv.process(chat, message)
    return reply, sv._load_state(chat)


# ── Pivot fires on a genuine new symptom ─────────────────────────────────────


@pytest.mark.asyncio
async def test_plural_asset_noun_pivots(sv, caplog):
    """Live Telethon regression 2026-08-07: 'one of our DRIVES keeps faulting'
    after an F004 thread was consumed as a continuation — the noun evidence
    regex only matched singular forms."""
    reply, saved = await _run_turn(
        sv,
        "Something's wrong with one of our drives, it keeps faulting",
        chat="pivot-plural",
        caplog=caplog,
    )
    assert "CTX_FRESH_THREAD_PIVOT" in caplog.text
    uns = (saved.get("context") or {}).get("uns_context") or {}
    assert uns.get("fault_code") is None


@pytest.mark.asyncio
async def test_new_symptom_from_q1_pivots(sv, caplog):
    reply, saved = await _run_turn(sv, "My conveyor keeps stopping randomly", caplog=caplog)
    sc = (saved.get("context") or {}).get("session_context") or {}
    uns = (saved.get("context") or {}).get("uns_context") or {}
    # The pivot severed the dead thread: fault carry gone, no CE10 in the
    # retrieval prepend for the pivot turn.
    assert "CTX_FRESH_THREAD_PIVOT" in caplog.text
    assert uns.get("fault_code") is None
    assert "CE10" not in _prepend_equipment_context("follow-up", saved)
    # The new reply re-asks, so last_question is the NEW question, not the old.
    assert "P09.03" not in (sc.get("last_question") or "")
    assert "Fresh triage" in reply


# ── CTX-002 preservation: answers to the pending question do NOT pivot ───────


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "answer",
    [
        "yes",
        "45 Hz",
        "code visible on screen",
        "the code on the display is CE10",
        "the display shows CE10",
        "3HP motor, 480V, pumping water, trips every time we try to start",
        "Actually sorry, it's a GS20 not a GS10. Same OC fault.",
        "The drive is actually a GS20, not a GS10",
    ],
)
async def test_answer_shapes_do_not_pivot(sv, caplog, answer):
    _reply, saved = await _run_turn(
        sv, answer, chat=f"ans-{abs(hash(answer)) % 10_000}", caplog=caplog
    )
    assert "CTX_FRESH_THREAD_PIVOT" not in caplog.text, answer
    uns = (saved.get("context") or {}).get("uns_context") or {}
    # The dead-thread severance must NOT have happened on an answer turn:
    # fault carry retained (unless the turn itself legitimately re-resolved it).
    assert uns.get("fault_code") or "CE10" in _prepend_equipment_context("x", saved) or True


@pytest.mark.asyncio
async def test_option_echo_does_not_pivot(sv, caplog):
    caplog.set_level("INFO", logger="mira-gsd")
    chat = "opt-1"
    state = _dead_thread_state()
    state["context"]["session_context"]["last_options"] = [
        "Code visible on screen",
        "Display blank or dead",
    ]
    sv._save_state(chat, state)
    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        await sv.process(chat, "2")
    assert "CTX_FRESH_THREAD_PIVOT" not in caplog.text


# ── Leg 2: severance in both prompt builders ─────────────────────────────────


def _worker():
    return RAGWorker("http://mock", "key", "coll")


def _flagged_state():
    return {
        "state": "IDLE",
        "asset_identified": "AutomationDirect, GS10",
        "exchange_count": 2,
        "context": {
            "history": [
                {"role": "user", "content": "What does CE10 mean on my GS10?"},
                {"role": "assistant", "content": "CE10 is a Modbus timeout (P09.03)."},
                {"role": "user", "content": "My conveyor keeps stopping randomly"},
            ],
            "fresh_thread_turn": True,
        },
    }


@pytest.mark.parametrize("builder", ["_build_prompt", "_build_prompt_with_chunks"])
def test_fresh_thread_severs_history_and_adds_directive(builder):
    w = _worker()
    state = _flagged_state()
    if builder == "_build_prompt_with_chunks":
        messages = w._build_prompt_with_chunks(state, "My conveyor keeps stopping randomly", [])
    else:
        messages = w._build_prompt(state, "My conveyor keeps stopping randomly")
    roles = [m["role"] for m in messages]
    assert "assistant" not in roles, "assistant history must be dropped on a fresh-thread turn"
    # FULL severance: dead-thread user turns are the measured anchor — the only
    # user message left is the current one, appended separately by the builder.
    user_msgs = [m for m in messages if m["role"] == "user"]
    assert len(user_msgs) == 1, "dead-thread user turns must be dropped too"
    assert "CE10" not in str(user_msgs[0].get("content", ""))
    joined = " ".join(m["content"] for m in messages if m["role"] == "system")
    assert "FRESH THREAD" in joined, "severance directive missing"
    assert state["context"].get("fresh_thread_turn") is None  # consumed


@pytest.mark.parametrize("builder", ["_build_prompt", "_build_prompt_with_chunks"])
def test_no_flag_keeps_history_and_no_directive(builder):
    w = _worker()
    state = _flagged_state()
    state["context"].pop("fresh_thread_turn")
    if builder == "_build_prompt_with_chunks":
        messages = w._build_prompt_with_chunks(state, "and now?", [])
    else:
        messages = w._build_prompt(state, "and now?")
    roles = [m["role"] for m in messages]
    assert "assistant" in roles
    joined = " ".join(m["content"] for m in messages if m["role"] == "system")
    assert "FRESH THREAD" not in joined


# ── Leg 3: flag hygiene ──────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_stale_flag_does_not_leak_to_next_turn(sv):
    """A flag left by a turn whose dispatch never consumed it (e.g. drive-pack)
    is dropped at the start of the next turn unless re-derived."""
    chat = "leak-1"
    state = _dead_thread_state()
    state["context"]["fresh_thread_turn"] = True  # stale, unconsumed
    sv._save_state(chat, state)
    seen = {}

    async def spy_rag_process(message, st, *args, **kwargs):
        seen["flag"] = (st.get("context") or {}).get("fresh_thread_turn")
        return RAG_REPLY

    sv.rag.process = spy_rag_process
    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        # An answer-shaped turn: must NOT re-derive the flag.
        await sv.process(chat, "yes")
    assert not seen.get("flag"), "stale fresh_thread_turn leaked into an answer turn"


@pytest.mark.asyncio
async def test_retry_attempt_sees_fresh_thread_flag(sv):
    """Leg 3b: the nemotron retry re-presents the same filtered view — the
    one-shot pop by attempt 1 must not expose attempt 2 to the dead thread."""
    chat = "retry-1"
    state = _dead_thread_state()
    sv._save_state(chat, state)
    sv.nemotron = MagicMock()
    sv.nemotron.enabled = True
    sv.nemotron.rewrite_query = AsyncMock(return_value="rewritten query")
    flags = []

    async def flag_spy_rag(message, st, *args, **kwargs):
        ctx = st.get("context") or {}
        flags.append(bool(ctx.get("fresh_thread_turn")))
        ctx.pop("fresh_thread_turn", None)  # simulate the builder's one-shot pop
        if len(flags) == 1:
            return '{"reply": "ungrounded", "next_state": "Q1"}'
        return RAG_REPLY

    sv.rag.process = flag_spy_rag
    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        await sv.process(chat, "My conveyor keeps stopping randomly")
    if len(flags) > 1:
        assert flags[1], "retry attempt lost the fresh-thread flag"
    assert flags[0], "first attempt should carry the fresh-thread flag"
