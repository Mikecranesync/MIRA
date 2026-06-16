"""Tests for `dialogue_acts.classify_dialogue_act` — the Groq classifier.

All Groq HTTP calls are mocked; this file is offline-safe and CI-safe.

Network behaviour is verified at three layers:
1. Shortcircuit regexes — no LLM call at all.
2. LLM call success — mocked Groq response → typed `DialogueTurn`.
3. LLM call failure (timeout / 5xx / parse error) → `_fallback_act`.
"""

from __future__ import annotations

import json
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

from shared.dialogue_acts import (  # noqa: E402
    _fallback_act,
    _parse_classifier_response,
    _shortcircuit_act,
    classify_dialogue_act,
)
from shared.dialogue_state import (  # noqa: E402
    AnswerAct,
    AskQuestionAct,
    ConfirmAct,
    DenyAct,
    DontKnowAct,
    GreetAck,
    InformAct,
    MetaControlAct,
    PendingQuestion,
    RequestActionAct,
    SafetyAct,
    SalientEntities,
)

# ---------------------------------------------------------------------------
# Shortcircuits — runs before any HTTP call, no key needed
# ---------------------------------------------------------------------------


class TestShortcircuits:
    @pytest.mark.parametrize(
        "msg,expected_act",
        [
            ("I don't know", DontKnowAct),
            ("dont know", DontKnowAct),
            ("not sure", DontKnowAct),
            ("no idea", DontKnowAct),
        ],
    )
    def test_dont_know_with_pending(self, msg, expected_act):
        pending = PendingQuestion(slot="fault_code", raw_text="?")
        act = _shortcircuit_act(msg, pending)
        assert isinstance(act, expected_act)

    def test_dont_know_without_pending_falls_through(self):
        # No pending question → "I don't know" is ambiguous, let the LLM see it
        act = _shortcircuit_act("I don't know", PendingQuestion())
        assert act is None

    @pytest.mark.parametrize("msg", ["reset", "/reset", "start over"])
    def test_reset_keyword(self, msg):
        act = _shortcircuit_act(msg, PendingQuestion())
        assert isinstance(act, MetaControlAct)
        assert act.command == "reset"

    @pytest.mark.parametrize(
        "msg",
        ["nevermind", "never mind", "cancel", "skip", "back", "stop", "abort"],
    )
    def test_meta_keywords(self, msg):
        act = _shortcircuit_act(msg, PendingQuestion())
        assert isinstance(act, MetaControlAct)

    @pytest.mark.parametrize(
        "msg",
        ["hi", "hello", "hey", "thanks", "thank you", "thx", "ok", "good morning"],
    )
    def test_greeting_no_pending(self, msg):
        act = _shortcircuit_act(msg, PendingQuestion())
        assert isinstance(act, GreetAck)

    def test_greeting_with_pending_falls_through(self):
        # User says "hi" mid-Q — that's actually meaningful; let the LLM decide
        act = _shortcircuit_act("hi", PendingQuestion(slot="fault_code", raw_text="?"))
        # Greeting shortcircuit only fires WITHOUT a pending question
        # (we don't suppress the LLM mid-flow on a 2-char greeting).
        assert act is None or isinstance(act, GreetAck) is False

    def test_yes_no_only_for_yes_no_slots(self):
        # "yes" with an open-ended slot (fault_code) shouldn't shortcircuit;
        # the LLM should see it as a (probably useless) answer
        act = _shortcircuit_act("yes", PendingQuestion(slot="fault_code", raw_text="?"))
        assert act is None
        # "yes" with wo_confirmation → ConfirmAct
        act = _shortcircuit_act(
            "yes",
            PendingQuestion(slot="wo_confirmation", raw_text="Submit?"),
        )
        assert isinstance(act, ConfirmAct)

    def test_no_with_yes_no_slot(self):
        act = _shortcircuit_act(
            "no",
            PendingQuestion(slot="wo_confirmation", raw_text="Submit?"),
        )
        assert isinstance(act, DenyAct)

    @pytest.mark.parametrize(
        "msg",
        [
            "make a work order",
            "Can you make a work order for the cooling fan?",
            "create a WO",
            "submit a maintenance ticket",
            "I need a work order for the bearing",
        ],
    )
    def test_wo_request(self, msg):
        act = _shortcircuit_act(msg, PendingQuestion())
        assert isinstance(act, RequestActionAct)
        assert act.action == "log_work_order"

    @pytest.mark.parametrize(
        "msg",
        ["send me the manual", "find the datasheet", "show me the wiring diagram"],
    )
    def test_doc_request(self, msg):
        act = _shortcircuit_act(msg, PendingQuestion())
        assert isinstance(act, RequestActionAct)
        assert act.action == "find_documentation"

    def test_switch_asset(self):
        act = _shortcircuit_act("switch to the pump", PendingQuestion())
        assert isinstance(act, RequestActionAct)
        assert act.action == "switch_asset"

    def test_diagnostic_content_passes_through_for_llm(self):
        # Real diagnostic content must NOT shortcircuit — the LLM does the work
        for msg in [
            "F-201 fault on the GS20",
            "the motor trips on overcurrent",
            "the bearing is making noise at 120 Hz",
        ]:
            act = _shortcircuit_act(msg, PendingQuestion(slot="fault_code", raw_text="?"))
            assert act is None, f"should not shortcircuit: {msg!r}"


# ---------------------------------------------------------------------------
# JSON parser — three-strategy extraction
# ---------------------------------------------------------------------------


class TestParseClassifierResponse:
    def test_direct_json(self):
        t = _parse_classifier_response('{"act": "answer", "slot_fill_value": "F012"}')
        assert isinstance(t, AnswerAct)
        assert t.slot_fill_value == "F012"

    def test_strips_code_fence(self):
        t = _parse_classifier_response('```json\n{"act": "meta", "command": "cancel"}\n```')
        assert isinstance(t, MetaControlAct)
        assert t.command == "cancel"

    def test_extracts_substring_json(self):
        t = _parse_classifier_response(
            'Sure, here\'s the analysis: {"act": "greet"} that\'s the act.'
        )
        assert isinstance(t, GreetAck)

    def test_returns_none_on_unparseable(self):
        assert _parse_classifier_response("totally unparseable garbage with no json") is None
        assert _parse_classifier_response("") is None

    def test_returns_none_on_unknown_act(self):
        assert _parse_classifier_response('{"act": "made_up_act"}') is None

    def test_handles_safety_act(self):
        t = _parse_classifier_response(
            '{"act": "safety", "hazard_summary": "live wire", "reasoning": "x"}'
        )
        assert isinstance(t, SafetyAct)
        assert t.hazard_summary == "live wire"

    def test_handles_request_action(self):
        t = _parse_classifier_response(
            '{"act": "request_action", "action": "log_work_order", '
            '"entities": {"asset_label": "Pump 7"}}'
        )
        assert isinstance(t, RequestActionAct)
        assert t.action == "log_work_order"
        assert t.entities.asset_label == "Pump 7"


# ---------------------------------------------------------------------------
# classify_dialogue_act — full flow with mocked httpx
# ---------------------------------------------------------------------------


def _mock_groq_response(content_obj: dict | str) -> MagicMock:
    """Build a fake httpx response that returns the given content."""
    content_str = content_obj if isinstance(content_obj, str) else json.dumps(content_obj)
    resp = MagicMock()
    resp.raise_for_status = MagicMock()
    resp.json = MagicMock(return_value={"choices": [{"message": {"content": content_str}}]})
    return resp


class TestClassifyDialogueAct:
    @pytest.mark.asyncio
    async def test_shortcircuit_skips_http_call(self):
        # No httpx call should happen when shortcircuit fires
        with patch("shared.dialogue_acts.httpx.AsyncClient") as mock_client:
            turn = await classify_dialogue_act(
                "I don't know",
                PendingQuestion(slot="fault_code", raw_text="?"),
                history=[],
                salient_entities=SalientEntities(),
                fsm_state="Q2",
                api_key="test-key",
            )
            assert isinstance(turn, DontKnowAct)
            mock_client.assert_not_called()

    @pytest.mark.asyncio
    async def test_no_api_key_uses_fallback(self):
        # Without GROQ_API_KEY and not a shortcircuit case, falls back to keyword
        with patch.dict("os.environ", {"GROQ_API_KEY": ""}, clear=False):
            turn = await classify_dialogue_act(
                "the motor is hot",  # not a shortcircuit
                PendingQuestion(),
                history=[],
                salient_entities=SalientEntities(),
                fsm_state="IDLE",
                api_key="",
            )
            # _fallback_act produces InformAct for "the motor is hot"
            assert isinstance(turn, InformAct)

    @pytest.mark.asyncio
    async def test_groq_returns_answer(self):
        mock_resp = _mock_groq_response(
            {
                "act": "answer",
                "slot_fill_value": "F-201",
                "entities": {"fault_code": "F201"},
                "reasoning": "user gave fault code",
            }
        )
        with patch("shared.dialogue_acts.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_instance.post = AsyncMock(return_value=mock_resp)
            mock_client.return_value = mock_instance

            turn = await classify_dialogue_act(
                "F-201",
                PendingQuestion(slot="fault_code", raw_text="?"),
                history=[],
                salient_entities=SalientEntities(),
                fsm_state="Q2",
                api_key="test-key",
            )
            assert isinstance(turn, AnswerAct)
            assert turn.slot_fill_value == "F-201"

    @pytest.mark.asyncio
    async def test_groq_failure_falls_back(self):
        # Simulate httpx error → _fallback_act
        with patch("shared.dialogue_acts.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_instance.post = AsyncMock(side_effect=RuntimeError("network down"))
            mock_client.return_value = mock_instance

            # Pending question + content that's not a shortcircuit → fallback treats
            # as Answer (best effort)
            turn = await classify_dialogue_act(
                "the motor is humming weird",
                PendingQuestion(slot="symptom_detail", raw_text="describe?"),
                history=[],
                salient_entities=SalientEntities(),
                fsm_state="Q3",
                api_key="test-key",
            )
            assert isinstance(turn, AnswerAct)
            # Fallback uses the raw message as the candidate slot value
            assert "humming" in turn.slot_fill_value

    @pytest.mark.asyncio
    async def test_groq_garbage_response_retries_then_falls_back(self):
        # First response unparseable; second also unparseable → fallback
        mock_resp = _mock_groq_response("totally not json")
        with patch("shared.dialogue_acts.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_instance.post = AsyncMock(return_value=mock_resp)
            mock_client.return_value = mock_instance

            turn = await classify_dialogue_act(
                "the motor is humming",
                PendingQuestion(),
                history=[],
                salient_entities=SalientEntities(),
                fsm_state="IDLE",
                api_key="test-key",
            )
            # Fallback for no-pending + non-question → InformAct
            assert isinstance(turn, InformAct)
            # Should have retried once (2 calls total)
            assert mock_instance.post.call_count == 2

    @pytest.mark.asyncio
    async def test_groq_request_action_routes_correctly(self):
        # Mike's symptom 2: WO request mid-Q must classify as request_action
        mock_resp = _mock_groq_response(
            {
                "act": "request_action",
                "action": "log_work_order",
                "entities": {"asset_label": "air compressor #1"},
                "reasoning": "WO request",
            }
        )
        with patch("shared.dialogue_acts.httpx.AsyncClient") as mock_client:
            mock_instance = AsyncMock()
            mock_instance.__aenter__ = AsyncMock(return_value=mock_instance)
            mock_instance.__aexit__ = AsyncMock(return_value=None)
            mock_instance.post = AsyncMock(return_value=mock_resp)
            mock_client.return_value = mock_instance

            # The shortcircuit catches WO requests directly without an LLM call,
            # but if the user phrased it more obliquely the LLM call would hit
            # this path. Test with a phrasing the regex won't match.
            turn = await classify_dialogue_act(
                "could you go ahead and put one of those work orders together for me",
                PendingQuestion(slot="fault_code", raw_text="?"),
                history=[],
                salient_entities=SalientEntities(vendor="Atlas Copco"),
                fsm_state="Q2",
                api_key="test-key",
            )
            assert isinstance(turn, RequestActionAct)
            assert turn.action == "log_work_order"


# ---------------------------------------------------------------------------
# _fallback_act — last-resort classifier
# ---------------------------------------------------------------------------


class TestFallback:
    def test_safety_keyword_routes_safety(self):
        turn = _fallback_act("there is exposed wire on the panel", PendingQuestion())
        assert isinstance(turn, SafetyAct)

    def test_no_pending_inform_default(self):
        turn = _fallback_act("the motor is hot", PendingQuestion())
        assert isinstance(turn, InformAct)

    def test_pending_treats_as_answer(self):
        turn = _fallback_act(
            "F-201",
            PendingQuestion(slot="fault_code", raw_text="?"),
        )
        assert isinstance(turn, AnswerAct)
        assert turn.slot_fill_value == "F-201"

    def test_question_routes_to_ask(self):
        turn = _fallback_act("how do I reset this?", PendingQuestion())
        assert isinstance(turn, AskQuestionAct)
        assert turn.question_kind == "procedural"

    def test_what_is_routes_to_general(self):
        turn = _fallback_act("what is a VFD?", PendingQuestion())
        assert isinstance(turn, AskQuestionAct)
        assert turn.question_kind == "general"
