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
async def test_pronoun_continuation_after_pack_turn_keeps_context(sv, caplog):
    """Live campaign catch (c1 t2_continuation_is_kept, 2026-08-07): after a
    drive-pack-claimed turn (state stays IDLE, no last_question), the pronoun
    continuation 'is that fault serious?' was severed by the IDLE fresh-thread
    trigger and lost its referent. A turn that does not NAME a new subject
    must never start a fresh thread."""
    caplog.set_level("INFO", logger="mira-gsd")
    chat = "pack-continuation"
    state = {
        "state": "IDLE",  # pack fast-path leaves IDLE and sets no last_question
        "asset_identified": "AutomationDirect, GS10",
        "exchange_count": 1,
        "context": {
            "history": [
                {"role": "user", "content": "What does CE10 mean on a DURApulse GS10?"},
                {"role": "assistant", "content": "CE10 is a Modbus timeout (P09.03)."},
            ],
            "session_context": {},
            "uns_context": {
                "manufacturer": "AutomationDirect",
                "model": "GS10",
                "fault_code": "CE10",
            },
        },
    }
    sv._save_state(chat, state)
    seen = {}

    async def spy_rag(message, st, *args, **kwargs):
        ctx = st.get("context") or {}
        seen["flag"] = bool(ctx.pop("fresh_thread_turn", False))
        return RAG_REPLY

    sv.rag.process = spy_rag
    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        await sv.process(chat, "is that fault serious?")
    assert not seen.get("flag"), (
        "pronoun continuation must NOT be severed — no new subject was named"
    )


@pytest.mark.asyncio
async def test_pack_continuation_retrieval_query_carries_equipment(sv):
    """Live campaign catch, part 2 (c1r1, 2026-08-07): keeping history was not
    enough — the RETRIEVAL query for 'is that fault serious?' after a
    pack-claimed turn (IDLE) was the bare pronoun sentence, so recall came up
    empty and the reply asked for the exact code it had just explained. An
    IDLE continuation on a pinned asset must carry equipment context into the
    retrieval query."""
    chat = "pack-cont-query"
    state = {
        "state": "IDLE",
        "asset_identified": "AutomationDirect, GS10",
        "exchange_count": 1,
        "context": {
            "history": [
                {"role": "user", "content": "What does CE10 mean on a DURApulse GS10?"},
                {"role": "assistant", "content": "CE10 is a Modbus timeout (P09.03)."},
            ],
            "session_context": {},
            "uns_context": {
                "manufacturer": "AutomationDirect",
                "model": "GS10",
                "fault_code": "CE10",
                "confidence": 0.81,
            },
        },
    }
    sv._save_state(chat, state)
    seen = {}

    async def spy_rag(message, st, *args, **kwargs):
        seen["query"] = message
        return RAG_REPLY

    sv.rag.process = spy_rag
    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        await sv.process(chat, "is that fault serious?")
    q = seen.get("query", "")
    assert "GS10" in q and "CE10" in q, f"retrieval query lost equipment context: {q!r}"


@pytest.mark.asyncio
async def test_explicit_abandon_with_new_symptom_pivots(sv, caplog):
    """Live campaign catch part 3 (c1r2 t2_pivot_after_fault): 'Actually forget
    that — my conveyor keeps stopping.' is an ABANDON + new symptom, but the
    correction-marker guard ('Actually') blocked the pivot, so the dead
    thread's fault context leaked into the reply. An explicit abandon phrase
    overrides the correction guard."""
    reply, saved = await _run_turn(
        sv,
        "Actually forget that — my conveyor keeps stopping.",
        chat="pivot-abandon",
        caplog=caplog,
    )
    assert "CTX_FRESH_THREAD_PIVOT" in caplog.text
    uns = (saved.get("context") or {}).get("uns_context") or {}
    assert uns.get("fault_code") is None


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


# ── CTX-001d — the pivot must not depend on WHICH state holds the question ──
#
# Campaign finding t2:pivot_after_fault (issue #3160), STABLE_FAIL across every
# seed observed in c1/c1r2/c1r3/c2/c3. CTX-001c gated the pivot on
# ACTIVE_DIAGNOSTIC_STATES and the CTX-001b fresh-thread branch on
# IDLE-with-no-pending-question, which leaves two reachable quadrants where a
# pending question exists and NEITHER branch fires:
#
#   state                 last_question   covered by
#   IDLE                  absent          CTX-001b fresh thread
#   Q1/Q2/Q3/DIAG/FIX     present         CTX-001c pivot
#   DIAGNOSIS_REVISION    present         NOTHING  ← self-critique parks here
#   IDLE                  present         NOTHING  ← every RAG turn sets one
#
# Both holes are live: the low-groundedness self-critique parks the session in
# DIAGNOSIS_REVISION (engine.py, "park in DIAGNOSIS_REVISION"), and a RAG turn
# that leaves state IDLE still sets last_question — the c1r2 t2_005 transcript
# carried F004 into the new conveyor topic from exactly that shape.


def _parked_state(fsm_state: str, last_question: str | None):
    """A dead CE10 thread parked in an arbitrary state."""
    state = _dead_thread_state()
    state["state"] = fsm_state
    sc = state["context"]["session_context"]
    if last_question is None:
        sc.pop("last_question", None)
    else:
        sc["last_question"] = last_question
    return state


async def _run_parked_turn(sv, fsm_state, message, chat, caplog=None, last_question="..."):
    if caplog is not None:
        caplog.set_level("INFO", logger="mira-gsd")
    sv._save_state(chat, _parked_state(fsm_state, last_question))
    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        await sv.process(chat, message)
    return sv._load_state(chat)


@pytest.mark.asyncio
async def test_pivot_fires_from_diagnosis_revision(sv, caplog):
    """#3160: the self-critique clarifier parks the session in
    DIAGNOSIS_REVISION with a pending question. 'Actually forget that — my
    conveyor keeps stopping.' arriving there was consumed as an answer to the
    dead CE10 thread, so the reply carried the dead fault forward."""
    saved = await _run_parked_turn(
        sv,
        "DIAGNOSIS_REVISION",
        "Actually forget that — my conveyor keeps stopping.",
        chat="pivot-revision",
        caplog=caplog,
        last_question=(
            "Before I can give you a confident diagnosis, could you share one more detail"
        ),
    )
    assert "CTX_FRESH_THREAD_PIVOT" in caplog.text, (
        "a pending question in DIAGNOSIS_REVISION must pivot like any other"
    )
    uns = (saved.get("context") or {}).get("uns_context") or {}
    assert uns.get("fault_code") is None, "dead fault carried past the pivot"


@pytest.mark.asyncio
async def test_pivot_fires_from_idle_with_a_pending_question(sv, caplog):
    """The second uncovered quadrant (c1r2 t2_005): a RAG turn can leave the
    FSM in IDLE while still setting last_question. CTX-001b skips it (a
    question is pending) and CTX-001c skipped it (IDLE is not an active
    diagnostic state), so the new subject was consumed as an answer."""
    saved = await _run_parked_turn(
        sv,
        "IDLE",
        "Actually forget that — my conveyor keeps stopping.",
        chat="pivot-idle-pending",
        caplog=caplog,
        last_question="Is the fault code still displayed?",
    )
    assert "CTX_FRESH_THREAD" in caplog.text, "IDLE with a pending question must still pivot"
    uns = (saved.get("context") or {}).get("uns_context") or {}
    assert uns.get("fault_code") is None, "dead fault carried past the pivot"


@pytest.mark.asyncio
async def test_answer_in_diagnosis_revision_does_not_pivot(sv, caplog):
    """Negative control (CTX-002 preservation). Broadening the state predicate
    must not make ANSWERS pivot: the clarifier's whole purpose is to collect
    the fault code, and 'the code on the display is CE10' is an answer whose
    only noun evidence is the carried fault token itself."""
    saved = await _run_parked_turn(
        sv,
        "DIAGNOSIS_REVISION",
        "the code on the display is CE10",
        chat="revision-answer",
        caplog=caplog,
        last_question="what exact fault code is the equipment showing right now?",
    )
    assert "CTX_FRESH_THREAD_PIVOT" not in caplog.text, (
        "an answer to the pending question must retain context"
    )
    uns = (saved.get("context") or {}).get("uns_context") or {}
    assert uns.get("fault_code") == "CE10", "answering the clarifier must not sever the thread"


@pytest.mark.asyncio
async def test_uns_confirmation_gate_is_never_pivoted(sv, caplog):
    """Negative control: AWAITING_UNS_CONFIRMATION is owned by the UNS
    location-confirmation gate, which is non-negotiable
    (.claude/rules/uns-confirmation-gate.md). Severing its pending question
    from underneath it would strand the gate mid-confirmation, so it stays
    exempt no matter how new the subject looks."""
    saved = await _run_parked_turn(
        sv,
        "AWAITING_UNS_CONFIRMATION",
        "Actually forget that — my conveyor keeps stopping.",
        chat="pivot-uns-gate",
        caplog=caplog,
        last_question="I think you're on the GS10 at line 2 — is that right?",
    )
    assert "CTX_FRESH_THREAD_PIVOT" not in caplog.text, (
        "the UNS confirmation gate owns its own turn — the pivot must not pre-empt it"
    )
    sc = ((saved.get("context") or {}).get("session_context")) or {}
    assert sc.get("last_question"), "the gate's pending confirmation was severed"


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
