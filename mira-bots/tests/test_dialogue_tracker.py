"""Unit tests for the Stage 1 dialogue state tracker.

Covers the pure-function nodes (`merge_entities`, `update_pending_question`,
`decide_dispatch`) and the top-level `track_turn` entry point with a stubbed
classifier — no Groq calls in this file.

Network-bound classifier integration is exercised in
`test_dialogue_acts_llm.py` (mocked httpx) and the Mike-transcript replay in
`test_engine_dst_integration.py`.
"""

from __future__ import annotations

import sys

import pytest

sys.path.insert(0, "mira-bots")

from shared.dialogue_state import (  # noqa: E402
    AnswerAct,
    AskQuestionAct,
    ConfirmAct,
    DenyAct,
    DialogueState,
    DontKnowAct,
    GreetAck,
    InformAct,
    MetaControlAct,
    PendingQuestion,
    RequestActionAct,
    SafetyAct,
    SalientEntities,
    turn_from_dict,
    turn_to_dict,
)
from shared.dialogue_tracker import (  # noqa: E402
    DISPATCH_ACTION,
    DISPATCH_ACTION_INTERRUPT,
    DISPATCH_ASK_GENERAL,
    DISPATCH_ASK_PROCEDURAL,
    DISPATCH_DEFAULT_RAG,
    DISPATCH_GREET,
    DISPATCH_META,
    DISPATCH_SAFETY,
    DISPATCH_SLOT_ANSWER,
    DISPATCH_SLOT_CONFIRM,
    DISPATCH_SLOT_DENY,
    DISPATCH_SLOT_DONT_KNOW,
    consume_interrupt,
    decide_dispatch,
    merge_entities,
    set_pending_question,
    snapshot_for_interrupt,
    track_turn,
    update_pending_question,
)

# ---------------------------------------------------------------------------
# Data-class round-trip — ensures the JSON-serialisation path is stable.
# ---------------------------------------------------------------------------


class TestTurnSerialisation:
    @pytest.mark.parametrize(
        "turn",
        [
            AnswerAct(slot_fill_value="F012", reasoning="fault code given"),
            InformAct(reasoning="info"),
            RequestActionAct(action="log_work_order", reasoning="WO"),
            RequestActionAct(action="find_documentation", reasoning="manual"),
            AskQuestionAct(question_kind="procedural", reasoning="how to"),
            DontKnowAct(reasoning="dunno"),
            ConfirmAct(reasoning="yes"),
            DenyAct(reasoning="no"),
            MetaControlAct(command="cancel", reasoning="abort"),
            GreetAck(reasoning="hi"),
            SafetyAct(hazard_summary="live wire exposed", reasoning="safety"),
        ],
    )
    def test_round_trip(self, turn):
        d = turn_to_dict(turn)
        rebuilt = turn_from_dict(d)
        assert rebuilt is not None
        assert type(rebuilt) is type(turn)
        assert rebuilt.act == turn.act

    def test_unknown_act_returns_none(self):
        assert turn_from_dict({"act": "made_up", "reasoning": "x"}) is None

    def test_non_dict_returns_none(self):
        assert turn_from_dict("not a dict") is None
        assert turn_from_dict(None) is None
        assert turn_from_dict([]) is None

    def test_invalid_action_returns_none(self):
        # `request_action` requires a known action name
        assert turn_from_dict({"act": "request_action", "action": "nuke_factory"}) is None


# ---------------------------------------------------------------------------
# Salient entities — merge semantics
# ---------------------------------------------------------------------------


class TestSalientEntitiesMerge:
    def test_merge_layers_non_empty_over_empty(self):
        base = SalientEntities(vendor="Yaskawa")
        new = SalientEntities(model="GA700", fault_code="F012")
        out = base.merge(new)
        assert out.vendor == "Yaskawa"
        assert out.model == "GA700"
        assert out.fault_code == "F012"

    def test_merge_does_not_overwrite_with_empty(self):
        base = SalientEntities(vendor="Siemens", model="G120C")
        new = SalientEntities()  # all None
        out = base.merge(new)
        assert out == base

    def test_merge_overwrites_with_new_value(self):
        # Mike's repro case: vendor swap mid-conversation
        base = SalientEntities(vendor="Yaskawa")
        new = SalientEntities(vendor="Siemens")
        out = base.merge(new)
        assert out.vendor == "Siemens"


# ---------------------------------------------------------------------------
# DialogueState — engine-state migration
# ---------------------------------------------------------------------------


class TestDialogueStateMigration:
    def test_from_engine_state_preserves_dialogue_blob(self):
        es = {
            "state": "Q2",
            "asset_identified": "Yaskawa GA700",
            "exchange_count": 3,
            "context": {
                "session_context": {},
                "dialogue": {
                    "fsm_state": "Q2",
                    "pending_question": {
                        "slot": "fault_code",
                        "raw_text": "what fault code?",
                        "options": [],
                        "asked_at_turn": 3,
                    },
                    "salient_entities": {
                        "vendor": "Yaskawa",
                        "model": "GA700",
                    },
                    "last_dialogue_act": "ask",
                    "interrupted_thread": None,
                },
            },
        }
        ds = DialogueState.from_engine_state("chat-1", es)
        assert ds.fsm_state == "Q2"
        assert ds.pending_question.slot == "fault_code"
        assert ds.salient_entities.vendor == "Yaskawa"
        assert ds.last_dialogue_act == "ask"

    def test_legacy_migration_uses_session_context(self):
        # Existing chat with no `dialogue` blob — first turn after flag flips on
        es = {
            "state": "Q2",
            "asset_identified": "Yaskawa GA700",
            "exchange_count": 3,
            "context": {"session_context": {"last_question": "what fault code?"}},
        }
        ds = DialogueState.from_engine_state("chat-1", es)
        assert ds.pending_question.is_pending
        assert ds.pending_question.raw_text == "what fault code?"
        assert ds.salient_entities.vendor and "yaskawa" in ds.salient_entities.vendor.lower()

    def test_write_to_engine_state_round_trip(self):
        es = {"state": "Q2", "context": {}}
        ds = DialogueState(
            chat_id="chat-1",
            fsm_state="Q2",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
            salient_entities=SalientEntities(vendor="Siemens"),
        )
        ds.write_to_engine_state(es)
        rehydrated = DialogueState.from_engine_state("chat-1", es)
        assert rehydrated.pending_question.slot == "fault_code"
        assert rehydrated.salient_entities.vendor == "Siemens"


# ---------------------------------------------------------------------------
# merge_entities node
# ---------------------------------------------------------------------------


class TestMergeEntitiesNode:
    def test_merges_classifier_entities(self):
        s = DialogueState(
            chat_id="c1",
            salient_entities=SalientEntities(vendor="Yaskawa"),
        )
        turn = AnswerAct(
            slot_fill_value="F012",
            entities=SalientEntities(model="GA700", fault_code="F012"),
        )
        s2 = merge_entities(s, turn)
        assert s2.salient_entities.vendor == "Yaskawa"
        assert s2.salient_entities.model == "GA700"
        assert s2.salient_entities.fault_code == "F012"

    def test_no_op_when_turn_has_no_entities(self):
        s = DialogueState(chat_id="c1", salient_entities=SalientEntities(vendor="Yaskawa"))
        # DontKnowAct has no entities field
        s2 = merge_entities(s, DontKnowAct())
        assert s2 is s  # identity — no change


# ---------------------------------------------------------------------------
# update_pending_question node
# ---------------------------------------------------------------------------


class TestUpdatePendingQuestionNode:
    def _state_with_pending(self):
        return DialogueState(
            chat_id="c1",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
        )

    def test_clears_on_answer(self):
        s2 = update_pending_question(self._state_with_pending(), AnswerAct(slot_fill_value="x"))
        assert not s2.pending_question.is_pending

    def test_clears_on_dont_know(self):
        s2 = update_pending_question(self._state_with_pending(), DontKnowAct())
        assert not s2.pending_question.is_pending

    def test_clears_on_meta_cancel(self):
        s2 = update_pending_question(self._state_with_pending(), MetaControlAct(command="cancel"))
        assert not s2.pending_question.is_pending

    def test_clears_on_topic_pivot_inform(self):
        # Mid-Q user pivots with new info — clear and re-classify
        s2 = update_pending_question(self._state_with_pending(), InformAct())
        assert not s2.pending_question.is_pending

    def test_clears_on_new_question(self):
        s2 = update_pending_question(
            self._state_with_pending(),
            AskQuestionAct(question_kind="procedural"),
        )
        assert not s2.pending_question.is_pending

    def test_keeps_on_interrupt_action(self):
        s2 = update_pending_question(
            self._state_with_pending(),
            RequestActionAct(action="log_work_order"),
        )
        # Interrupt does NOT clear — engine snapshots and resumes later
        assert s2.pending_question.is_pending

    def test_no_op_when_no_pending(self):
        s = DialogueState(chat_id="c1")
        s2 = update_pending_question(s, AnswerAct(slot_fill_value="x"))
        assert s2 is s


# ---------------------------------------------------------------------------
# decide_dispatch — the routing decision
# ---------------------------------------------------------------------------


class TestDispatchPriority:
    def test_safety_always_wins(self):
        s = DialogueState(
            chat_id="c1",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
        )
        plan = decide_dispatch(s, SafetyAct(hazard_summary="live wire"))
        assert plan.kind == DISPATCH_SAFETY

    def test_interrupt_action_preempts_pending_slot(self):
        # Mike's symptom 2: WO request mid-Q must NOT be treated as a slot answer
        s = DialogueState(
            chat_id="c1",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
        )
        plan = decide_dispatch(s, RequestActionAct(action="log_work_order"))
        assert plan.kind == DISPATCH_ACTION_INTERRUPT
        assert plan.payload["action"] == "log_work_order"

    def test_slot_answer_when_pending(self):
        s = DialogueState(
            chat_id="c1",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
        )
        plan = decide_dispatch(s, AnswerAct(slot_fill_value="F012"))
        assert plan.kind == DISPATCH_SLOT_ANSWER
        assert plan.payload["slot"] == "fault_code"
        assert plan.payload["value"] == "F012"

    def test_dont_know_routes_to_slot_dont_know(self):
        # Mike's symptom 1: "I don't know" must NOT become a vector query
        s = DialogueState(
            chat_id="c1",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
        )
        plan = decide_dispatch(s, DontKnowAct())
        assert plan.kind == DISPATCH_SLOT_DONT_KNOW
        assert plan.payload["slot"] == "fault_code"

    def test_confirm_in_yes_no_slot(self):
        s = DialogueState(
            chat_id="c1",
            pending_question=PendingQuestion(slot="wo_confirmation", raw_text="?"),
        )
        plan = decide_dispatch(s, ConfirmAct())
        assert plan.kind == DISPATCH_SLOT_CONFIRM

    def test_deny_in_yes_no_slot(self):
        s = DialogueState(
            chat_id="c1",
            pending_question=PendingQuestion(slot="wo_confirmation", raw_text="?"),
        )
        plan = decide_dispatch(s, DenyAct())
        assert plan.kind == DISPATCH_SLOT_DENY

    def test_meta_routes_to_meta(self):
        s = DialogueState(chat_id="c1")
        plan = decide_dispatch(s, MetaControlAct(command="reset"))
        assert plan.kind == DISPATCH_META
        assert plan.payload["command"] == "reset"

    def test_non_interrupt_action(self):
        s = DialogueState(chat_id="c1")
        plan = decide_dispatch(s, RequestActionAct(action="find_documentation"))
        assert plan.kind == DISPATCH_ACTION
        assert plan.payload["action"] == "find_documentation"

    def test_procedural_question_routes_to_procedural(self):
        s = DialogueState(chat_id="c1")
        plan = decide_dispatch(s, AskQuestionAct(question_kind="procedural"))
        assert plan.kind == DISPATCH_ASK_PROCEDURAL

    def test_general_question_routes_to_general(self):
        s = DialogueState(chat_id="c1")
        plan = decide_dispatch(s, AskQuestionAct(question_kind="general"))
        assert plan.kind == DISPATCH_ASK_GENERAL

    def test_greet_in_idle(self):
        s = DialogueState(chat_id="c1", fsm_state="IDLE")
        plan = decide_dispatch(s, GreetAck())
        assert plan.kind == DISPATCH_GREET

    def test_greet_mid_flow_falls_through(self):
        # Outside IDLE, a "thanks" mid-conversation goes to the default flow
        s = DialogueState(chat_id="c1", fsm_state="Q2")
        plan = decide_dispatch(s, GreetAck())
        assert plan.kind == DISPATCH_DEFAULT_RAG

    def test_inform_falls_through_to_default(self):
        s = DialogueState(chat_id="c1")
        plan = decide_dispatch(s, InformAct())
        assert plan.kind == DISPATCH_DEFAULT_RAG

    def test_topic_pivot_inform_routes_default_not_slot(self):
        # User informs new content while a slot was open → topic pivot
        # decide_dispatch does NOT see the cleared pending question; the
        # tracker calls update_pending_question AFTER decide_dispatch, so
        # the contract here is: a pending slot + InformAct → not a slot
        # answer (no AnswerAct), so we fall through to default.
        s = DialogueState(
            chat_id="c1",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
        )
        plan = decide_dispatch(s, InformAct())
        # Inform isn't one of the slot-fill acts, so dispatch is default RAG
        assert plan.kind == DISPATCH_DEFAULT_RAG


# ---------------------------------------------------------------------------
# Interrupt / resume
# ---------------------------------------------------------------------------


class TestInterruptResume:
    def test_snapshot_captures_active_pending(self):
        s = DialogueState(
            chat_id="c1",
            fsm_state="Q2",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
        )
        s2 = snapshot_for_interrupt(s)
        assert s2.interrupted_thread is not None
        assert s2.interrupted_thread["fsm_state"] == "Q2"
        assert s2.interrupted_thread["pending_question"]["slot"] == "fault_code"

    def test_snapshot_no_op_without_pending(self):
        s = DialogueState(chat_id="c1", fsm_state="IDLE")
        s2 = snapshot_for_interrupt(s)
        assert s2.interrupted_thread is None

    def test_consume_interrupt_clears_thread(self):
        s = DialogueState(
            chat_id="c1",
            interrupted_thread={"fsm_state": "Q2", "pending_question": {}},
        )
        s2, snap = consume_interrupt(s)
        assert s2.interrupted_thread is None
        assert snap == {"fsm_state": "Q2", "pending_question": {}}


# ---------------------------------------------------------------------------
# set_pending_question / clear_pending_question
# ---------------------------------------------------------------------------


class TestSetPendingQuestion:
    def test_records_question_for_next_turn(self):
        s = DialogueState(chat_id="c1")
        s2 = set_pending_question(
            s, slot="fault_code", raw_text="What fault code?", asked_at_turn=3
        )
        assert s2.pending_question.slot == "fault_code"
        assert s2.pending_question.raw_text == "What fault code?"
        assert s2.pending_question.asked_at_turn == 3

    def test_truncates_long_question_text(self):
        s = DialogueState(chat_id="c1")
        long_q = "x" * 500
        s2 = set_pending_question(s, slot="symptom_detail", raw_text=long_q)
        assert len(s2.pending_question.raw_text) == 200


# ---------------------------------------------------------------------------
# track_turn — full pipeline with stub classifier
# ---------------------------------------------------------------------------


class TestTrackTurn:
    @pytest.mark.asyncio
    async def test_full_pipeline_with_answer(self):
        async def stub_classifier(*_args, **_kwargs):
            return AnswerAct(
                slot_fill_value="F012",
                entities=SalientEntities(fault_code="F012"),
            )

        s = DialogueState(
            chat_id="c1",
            fsm_state="Q2",
            pending_question=PendingQuestion(slot="fault_code", raw_text="?"),
            salient_entities=SalientEntities(vendor="Yaskawa"),
        )

        new_state, plan = await track_turn(s, "F012", classifier=stub_classifier)
        assert plan.kind == DISPATCH_SLOT_ANSWER
        # Entities merged from the turn
        assert new_state.salient_entities.fault_code == "F012"
        assert new_state.salient_entities.vendor == "Yaskawa"
        # Pending question consumed
        assert not new_state.pending_question.is_pending
        # Last dialogue act recorded for telemetry
        assert new_state.last_dialogue_act == "answer"

    @pytest.mark.asyncio
    async def test_interrupt_snapshots_pending_thread(self):
        async def stub_classifier(*_args, **_kwargs):
            return RequestActionAct(action="log_work_order")

        s = DialogueState(
            chat_id="c1",
            fsm_state="Q2",
            pending_question=PendingQuestion(slot="fault_code", raw_text="what code?"),
        )
        new_state, plan = await track_turn(s, "make a work order", classifier=stub_classifier)
        assert plan.kind == DISPATCH_ACTION_INTERRUPT
        # Pending question preserved (interrupt does not clear it)
        assert new_state.pending_question.is_pending
        # Snapshot captured for resume
        assert new_state.interrupted_thread is not None
        assert new_state.interrupted_thread["fsm_state"] == "Q2"

    @pytest.mark.asyncio
    async def test_dont_know_with_pending(self):
        # Mike's symptom 1
        async def stub_classifier(*_args, **_kwargs):
            return DontKnowAct()

        s = DialogueState(
            chat_id="c1",
            fsm_state="Q2",
            pending_question=PendingQuestion(slot="fault_code", raw_text="what code?"),
        )
        new_state, plan = await track_turn(
            s, "I don't know. I was just given the new one to put in.", classifier=stub_classifier
        )
        assert plan.kind == DISPATCH_SLOT_DONT_KNOW
        assert plan.payload["slot"] == "fault_code"
        assert not new_state.pending_question.is_pending
