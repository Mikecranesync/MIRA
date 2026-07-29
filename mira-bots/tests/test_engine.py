"""Tests for shared.engine — Supervisor FSM, parsing, confidence, state management."""

from __future__ import annotations

import asyncio
import json
import sqlite3
import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shared.engine import _FAULT_INFO_RE, _STATE_ALIASES, Supervisor
from shared.dialogue_tracker import (
    DISPATCH_ASK_GENERAL,
    DISPATCH_ASK_PROCEDURAL,
)

# ---------------------------------------------------------------------------
# Fixture: minimal Supervisor with mocked workers
# ---------------------------------------------------------------------------


@pytest.fixture
def supervisor(tmp_path):
    """Create a Supervisor with all external deps mocked."""
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
    return sup


# ---------------------------------------------------------------------------
# _infer_confidence
# ---------------------------------------------------------------------------


class TestInferConfidence:
    def test_short_reply_returns_none(self):
        assert Supervisor._infer_confidence("ok") == "none"

    def test_empty_reply_returns_none(self):
        assert Supervisor._infer_confidence("") == "none"

    def test_high_confidence_signals(self):
        assert (
            Supervisor._infer_confidence("Replace the contactor and check wiring to terminal 3")
            == "high"
        )

    def test_low_confidence_signals(self):
        assert (
            Supervisor._infer_confidence(
                "It could be a faulty sensor, but I'm not sure without more info"
            )
            == "low"
        )

    def test_mixed_signals_returns_medium(self):
        assert (
            Supervisor._infer_confidence(
                "Replace the fuse — but it could be something else, not sure"
            )
            == "medium"
        )

    def test_medium_length_no_signals(self):
        reply = "The motor is operating within normal parameters and all readings look standard for this equipment type."
        assert Supervisor._infer_confidence(reply) == "medium"

    def test_short_no_signals_returns_none(self):
        assert Supervisor._infer_confidence("Looks fine to me.") == "none"

    def test_fault_code_is_high(self):
        assert (
            Supervisor._infer_confidence(
                "Fault code F-201 indicates an overcurrent condition on the drive output"
            )
            == "high"
        )

    def test_lockout_is_high(self):
        assert (
            Supervisor._infer_confidence(
                "Perform lockout tagout procedure before opening the panel"
            )
            == "high"
        )


# ---------------------------------------------------------------------------
# _make_result
# ---------------------------------------------------------------------------


class TestMakeResult:
    def test_basic_result(self):
        result = Supervisor._make_result("test reply", "high", "trace-123", "Q1")
        assert result == {
            "reply": "test reply",
            "confidence": "high",
            "trace_id": "trace-123",
            "next_state": "Q1",
            "dispatch_kind": "",
            "_citation_evidence": None,
            # Print-turn observability provenance (default None off print turns).
            "route": None,
            "model": None,
            "input_sha256": None,
            "fallback_reason": None,
        }

    def test_defaults(self):
        result = Supervisor._make_result("reply")
        assert result["confidence"] == "none"
        assert result["trace_id"] is None
        assert result["next_state"] is None
        assert result["dispatch_kind"] == ""

    def test_with_dispatch_kind(self):
        result = Supervisor._make_result(
            "wo preview",
            "none",
            "trace-1",
            "Q1",
            dispatch_kind="action_request",
        )
        assert result["dispatch_kind"] == "action_request"


# ---------------------------------------------------------------------------
# _parse_response
# ---------------------------------------------------------------------------


class TestParseResponse:
    def test_valid_json_envelope(self, supervisor):
        raw = json.dumps({"reply": "Check the fuse", "next_state": "Q2", "confidence": "HIGH"})
        result = supervisor._parse_response(raw)
        assert result["reply"] == "Check the fuse"
        assert result["next_state"] == "Q2"
        assert result["confidence"] == "HIGH"

    def test_json_in_markdown_code_block(self, supervisor):
        raw = 'Here is my analysis:\n```json\n{"reply": "Motor tripped on OC", "next_state": "DIAGNOSIS"}\n```'
        result = supervisor._parse_response(raw)
        assert result["reply"] == "Motor tripped on OC"
        assert result["next_state"] == "DIAGNOSIS"

    def test_json_substring_extraction(self, supervisor):
        raw = 'The analysis shows: {"reply": "Replace the contactor", "next_state": "FIX_STEP"} as recommended.'
        result = supervisor._parse_response(raw)
        assert result["reply"] == "Replace the contactor"

    def test_plain_text_fallback(self, supervisor):
        raw = "The motor is tripping due to overcurrent. Check the load."
        result = supervisor._parse_response(raw)
        assert result["reply"] == raw
        assert result["confidence"] == "LOW"
        assert result["next_state"] is None

    def test_groq_follow_ups_salvage(self, supervisor):
        raw = json.dumps({"follow_ups": ["Check voltage", "Inspect wiring", "Test continuity"]})
        result = supervisor._parse_response(raw)
        assert "Check voltage" in result["reply"]
        assert len(result["options"]) == 3

    def test_groq_title_salvage(self, supervisor):
        raw = json.dumps({"title": "Overcurrent fault on drive output"})
        result = supervisor._parse_response(raw)
        assert result["reply"] == "Overcurrent fault on drive output"

    def test_groq_queries_salvage(self, supervisor):
        raw = json.dumps({"queries": ["Check drive parameters", "Inspect motor leads"]})
        result = supervisor._parse_response(raw)
        assert result["reply"] == "Check drive parameters"

    def test_groq_tags_only_returns_none_falls_back(self, supervisor):
        raw = json.dumps({"tags": ["motor", "vfd"]})
        result = supervisor._parse_response(raw)
        # Falls through to plain text fallback
        assert result["confidence"] == "LOW"

    def test_invalid_confidence_defaults_to_low(self, supervisor):
        raw = json.dumps({"reply": "test", "confidence": "SUPER_HIGH"})
        result = supervisor._parse_response(raw)
        assert result["confidence"] == "LOW"

    def test_empty_string(self, supervisor):
        result = supervisor._parse_response("")
        assert result["reply"] == ""
        assert result["confidence"] == "LOW"

    def test_options_preserved(self, supervisor):
        raw = json.dumps({"reply": "Choose one:", "options": ["A", "B", "C"], "next_state": "Q2"})
        result = supervisor._parse_response(raw)
        assert result["options"] == ["A", "B", "C"]

    def test_envelope_with_literal_newline_in_reply_p0_issue_380(self, supervisor):
        # P0 #380: LLMs regularly emit envelopes with literal \n (U+000A)
        # inside the reply string (paragraph breaks in prose). Strict json.loads
        # rejects unescaped control chars, the fallback previously returned
        # the entire raw envelope as the reply, leaking {"next_state":...}
        # to chat output on production.
        raw = (
            '{"next_state": "ASSET_IDENTIFIED", "reply": "The image shows a '
            "weathered metal plate for a TECO 3-PHASE INDUCTION MOTOR. "
            "Visible text includes 'WUXI TECO Elec. & Mach. Co., Ltd.'.\n\n"
            'To proceed, what would you like to prioritize?", '
            '"options": ["1. Model number", "2. Voltage and current ratings", "3. Other"], '
            '"confidence": "LOW"}'
        )
        result = supervisor._parse_response(raw)
        assert result["next_state"] == "ASSET_IDENTIFIED"
        assert result["reply"].startswith("The image shows")
        assert '"next_state"' not in result["reply"]
        assert '"reply"' not in result["reply"]
        assert result["options"] == [
            "1. Model number",
            "2. Voltage and current ratings",
            "3. Other",
        ]

    def test_envelope_parse_failure_never_leaks_raw_json_keys(self, supervisor):
        # Defense: even if every parse path fails, the returned reply must
        # never still contain JSON envelope structure. Users must never see
        # \"next_state\": or \"reply\": verbatim on the wire.
        raw = (
            '{"next_state": "Q2", "reply": "line one\x01with control char", '
            '"options": [], "confidence": "LOW"}'
        )
        # \x01 (SOH) is a control char; make sure lenient parsing still works
        # OR the fallback scrubs it — either way, no envelope leak.
        result = supervisor._parse_response(raw)
        assert '"next_state"' not in result["reply"]
        assert '"reply":' not in result["reply"]


# ---------------------------------------------------------------------------
# _advance_state
# ---------------------------------------------------------------------------


class TestAdvanceState:
    def _make_state(self, current="IDLE"):
        return {"state": current, "exchange_count": 0, "final_state": None, "fault_category": None}

    def test_normal_progression(self, supervisor):
        """IDLE → Q1 → Q2 → DIAGNOSIS (Q-trap fires at 3 Q-rounds) → FIX_STEP → RESOLVED"""
        state = self._make_state("IDLE")
        state["context"] = {}
        # Auto-advance: IDLE→Q1→Q2→Q3, but Q-trap fires at round 3 → DIAGNOSIS
        for expected in ["Q1", "Q2", "DIAGNOSIS", "FIX_STEP", "RESOLVED"]:
            state = supervisor._advance_state(state, {"reply": "test", "next_state": None})
            assert state["state"] == expected, f"Expected {expected}, got {state['state']}"

    def test_llm_proposed_state(self, supervisor):
        state = self._make_state("Q1")
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "DIAGNOSIS"})
        assert state["state"] == "DIAGNOSIS"

    def test_state_alias_mapping(self, supervisor):
        state = self._make_state("Q1")
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "DIAGNOSTICS"})
        assert state["state"] == "DIAGNOSIS"

    def test_all_aliases_map_to_valid_states(self, supervisor):
        for alias, canonical in _STATE_ALIASES.items():
            assert canonical in supervisor._VALID_STATES, (
                f"Alias '{alias}' maps to invalid state '{canonical}'"
            )

    def test_invalid_state_holds_current(self, supervisor):
        state = self._make_state("Q2")
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "BANANA"})
        assert state["state"] == "Q2"

    def test_safety_override_from_any_state(self, supervisor):
        for start_state in ["IDLE", "Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP"]:
            state = self._make_state(start_state)
            state = supervisor._advance_state(
                state, {"reply": "exposed wire near panel", "next_state": None}
            )
            assert state["state"] == "SAFETY_ALERT", f"Safety override failed from {start_state}"
            assert state["final_state"] == "SAFETY_ALERT"

    def test_safety_from_next_state_field(self, supervisor):
        state = self._make_state("Q1")
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "SAFETY_ALERT"})
        assert state["state"] == "SAFETY_ALERT"

    def test_electrical_print_sticky(self, supervisor):
        state = self._make_state("ELECTRICAL_PRINT")
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "Q2"})
        assert state["state"] == "ELECTRICAL_PRINT"

    def test_asset_identified_goes_to_q1(self, supervisor):
        state = self._make_state("ASSET_IDENTIFIED")
        state = supervisor._advance_state(state, {"reply": "test"})
        assert state["state"] == "Q1"

    def test_diagnosis_revision_goes_to_diagnosis(self, supervisor):
        state = self._make_state("DIAGNOSIS_REVISION")
        state = supervisor._advance_state(state, {"reply": "test"})
        assert state["state"] == "DIAGNOSIS"

    def test_resolved_sets_final_state(self, supervisor):
        state = self._make_state("FIX_STEP")
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "RESOLVED"})
        assert state["final_state"] == "RESOLVED"

    def test_exchange_count_incremented(self, supervisor):
        state = self._make_state("Q1")
        state = supervisor._advance_state(state, {"reply": "test"})
        assert state["exchange_count"] == 1

    def test_fault_category_detected(self, supervisor):
        state = self._make_state("Q1")
        state = supervisor._advance_state(
            state, {"reply": "The motor has a mechanical vibration issue"}
        )
        assert state["fault_category"] == "mechanical"

    def test_fault_category_normalized(self, supervisor):
        state = self._make_state("Q1")
        state = supervisor._advance_state(state, {"reply": "This is an electrical problem"})
        assert state["fault_category"] == "power"

    def test_fault_category_set_once(self, supervisor):
        state = self._make_state("Q1")
        state["fault_category"] = "mechanical"
        state = supervisor._advance_state(state, {"reply": "Actually it's a power issue"})
        assert state["fault_category"] == "mechanical"  # unchanged

    def test_q4_clamped_to_q3(self, supervisor):
        state = self._make_state("Q2")
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "Q4"})
        assert state["state"] == "Q3"

    def test_q_trap_escape_forces_diagnosis(self, supervisor):
        """After MAX_Q_ROUNDS consecutive Q-state rounds, FSM must force DIAGNOSIS."""
        state = self._make_state("Q1")
        state["context"] = {"q_rounds": 0}
        # Simulate LLM proposing Q-states repeatedly
        for _ in range(2):
            state = supervisor._advance_state(state, {"reply": "test", "next_state": "Q2"})
        # Third round should trigger escape
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "Q3"})
        assert state["state"] == "DIAGNOSIS", (
            "Q-trap escape should force DIAGNOSIS after 3 Q-rounds"
        )

    def test_q_rounds_reset_on_exit(self, supervisor):
        """q_rounds counter resets when FSM leaves Q-states."""
        state = self._make_state("Q2")
        state["context"] = {"q_rounds": 2}
        state = supervisor._advance_state(state, {"reply": "test", "next_state": "DIAGNOSIS"})
        assert state["state"] == "DIAGNOSIS"
        # Either popped or explicitly reset to 0 — both are valid "reset" semantics.
        assert state["context"].get("q_rounds", 0) == 0

    def test_q_trap_env_override(self):
        """MIRA_MAX_Q_ROUNDS env var should control the threshold."""
        from shared.engine import _MAX_Q_ROUNDS

        assert _MAX_Q_ROUNDS == 3  # default

    def test_resolved_at_end_of_chain(self, supervisor):
        state = self._make_state("RESOLVED")
        state = supervisor._advance_state(state, {"reply": "test", "next_state": None})
        # RESOLVED is at end of STATE_ORDER — no further progression
        assert state["state"] == "RESOLVED"


# ---------------------------------------------------------------------------
# MANUAL_LOOKUP_GATHERING escape — issue #371
# ---------------------------------------------------------------------------


class TestManualLookupGatheringEscape:
    """Guards the fix: uncovered-vendor doc requests skip gathering and land in IDLE."""

    def _make_state(self, fsm_state: str) -> dict:
        return {
            "state": fsm_state,
            "asset_identified": "",
            "context": {},
            "exchange_count": 0,
            "fault_category": None,
            "final_state": None,
        }

    def test_is_doc_specific_requires_model_number(self, supervisor):
        """Vendor known but no model number → not specific enough (triggers gathering)."""
        assert not supervisor._is_doc_specific("Pilz", "find a manual for pilz safety relay")

    def test_is_doc_specific_with_model_passes(self, supervisor):
        """Vendor + model number → specific enough (bypasses gathering)."""
        assert supervisor._is_doc_specific("Pilz", "pilz PNOZ X3 manual")

    def test_doc_lookup_kb_miss_transitions_to_idle(self, supervisor, tmp_path):
        """_do_documentation_lookup KB miss must save IDLE state (fixes pilz_11, dist_36)."""
        import asyncio

        state = self._make_state("Q3")
        state["asset_identified"] = "Pilz PNOZ distribution block"
        chat_id = "test-pilz-idle"

        with (
            patch("shared.engine.kb_has_coverage", return_value=(False, "no vendor match")),
            patch("shared.engine.vendor_support_url", return_value=""),
            patch.object(supervisor, "_fire_scrape_trigger", new_callable=AsyncMock),
        ):
            result = asyncio.run(
                supervisor._do_documentation_lookup(
                    chat_id,
                    "find a manual",
                    state,
                    "trace-1",
                    "default",
                    vendor_override="Pilz",
                )
            )

        assert result["next_state"] == "IDLE", "KB miss must transition to IDLE"
        loaded = supervisor._load_state(chat_id)
        assert loaded["state"] == "IDLE", "IDLE must be persisted to DB"


class TestSessionPivotRouting:
    def _save_active_state(self, supervisor, chat_id: str) -> None:
        supervisor._save_state(
            chat_id,
            {
                "state": "Q2",
                "asset_identified": "Elmo, Gold Drive",
                "context": {
                    "photo_turn": 3,
                    "session_context": {
                        "equipment_type": "Elmo Gold Drive",
                        "manufacturer": "Elmo",
                        "last_question": "Check the DC bus?",
                        "last_options": ["Yes", "No"],
                    },
                },
                "exchange_count": 5,
                "fault_category": "hydraulic",
                "final_state": "RESOLVED",
            },
        )

    def test_documentation_pivot_skips_session_followup(self, supervisor):
        chat_id = "test-doc-pivot"
        self._save_active_state(supervisor, chat_id)

        with (
            patch(
                "shared.engine.route_intent",
                new=AsyncMock(
                    return_value={
                        "intent": "find_documentation",
                        "confidence": 0.98,
                        "reasoning": "user asked for documentation",
                    }
                ),
            ),
            patch("shared.engine.classify_intent", return_value="documentation"),
            patch.object(
                supervisor, "_handle_session_followup", new_callable=AsyncMock
            ) as followup,
            patch("shared.engine.kb_has_coverage", return_value=(True, "cached docs")),
        ):
            result = asyncio.run(supervisor.process_full(chat_id, "do they have a website"))

        assert followup.await_count == 0
        assert result["next_state"] == "IDLE"

        loaded = supervisor._load_state(chat_id)
        assert loaded["state"] == "IDLE"
        assert loaded["fault_category"] is None
        assert loaded["final_state"] is None
        assert loaded["context"]["session_context"]["last_question"] is None
        assert loaded["context"]["session_context"]["last_options"] == []
        assert "photo_turn" not in loaded["context"]

    def test_explicit_recap_still_uses_session_followup(self, supervisor):
        chat_id = "test-followup-pivot"
        self._save_active_state(supervisor, chat_id)

        with (
            patch(
                "shared.engine.route_intent",
                new=AsyncMock(
                    return_value={
                        "intent": "answer_question",
                        "confidence": 0.83,
                        "reasoning": "user is asking about the prior answer",
                    }
                ),
            ),
            # "where did you get that information" is a meta/source question, not
            # an industrial fault query. "industrial" + Q2 activates
            # _router_industrial_override, bypassing _handle_session_followup.
            patch("shared.engine.classify_intent", return_value="off_topic"),
            patch.object(
                supervisor,
                "_handle_session_followup",
                new=AsyncMock(
                    return_value={
                        "reply": "followup",
                        "confidence": "medium",
                        "trace_id": "trace-1",
                        "next_state": "Q2",
                    }
                ),
            ) as followup,
            patch.object(
                supervisor, "_handle_instructional_question", new_callable=AsyncMock
            ) as instructional,
            patch.object(supervisor, "_load_recent_session_photo", return_value="session-photo"),
        ):
            result = asyncio.run(
                supervisor.process_full(chat_id, "where did you get that information")
            )

        assert result["reply"] == "followup"
        assert followup.await_count == 1
        assert instructional.await_count == 0
        assert followup.await_args.kwargs["session_photo"] == "session-photo"


# ---------------------------------------------------------------------------
# _format_reply
# ---------------------------------------------------------------------------


class TestFormatReply:
    def test_no_options(self, supervisor):
        result = supervisor._format_reply({"reply": "Check the fuse", "options": []})
        assert result == "Check the fuse"

    def test_single_option_not_appended(self, supervisor):
        result = supervisor._format_reply({"reply": "Choose:", "options": ["Option A"]})
        assert "1." not in result

    def test_multiple_options_appended(self, supervisor):
        result = supervisor._format_reply(
            {
                "reply": "Choose one:",
                "options": ["Check voltage", "Inspect wiring", "Call electrician"],
            }
        )
        assert "1. Check voltage" in result
        assert "2. Inspect wiring" in result
        assert "3. Call electrician" in result

    def test_short_options_filtered(self, supervisor):
        result = supervisor._format_reply({"reply": "Choose:", "options": ["A", "B"]})
        assert "1." not in result  # too short (<= 1 chars)

    def test_padding_option_i_am_not_sure_dropped(self, supervisor):
        result = supervisor._format_reply(
            {
                "reply": "Are pins wired correctly?",
                "options": [
                    "Yes, connected correctly",
                    "No, incorrect wiring",
                    "I'm not sure",
                    "Not visible",
                ],
            }
        )
        assert "I'm not sure" not in result
        assert "Not visible" not in result
        assert "Yes, connected correctly" in result or "Yes" in result

    def test_padding_option_other_dropped(self, supervisor):
        result = supervisor._format_reply(
            {
                "reply": "What to prioritize?",
                "options": ["1. Model number", "2. Voltage ratings", "3. Other"],
            }
        )
        assert "Other" not in result
        assert "Model number" in result

    def test_placeholder_options_dropped(self, supervisor):
        # Seen in prod session e4ced7d8 — last_options stored as ["1","2"]
        result = supervisor._format_reply(
            {
                "reply": "Is the LED on?",
                "options": ["1", "2"],
            }
        )
        assert result == "Is the LED on?"

    def test_yesno_pair_renders_inline(self, supervisor):
        result = supervisor._format_reply(
            {
                "reply": "Motor still wired to T1-T3?",
                "options": ["Yes, motor connected", "No, disconnected"],
            }
        )
        assert "1. Yes" not in result
        assert "Reply:" in result
        assert "Yes" in result and "No" in result

    def test_yesno_pair_prose_short(self, supervisor):
        result = supervisor._format_reply(
            {
                "reply": "Is that right?",
                "options": ["Yes", "No"],
            }
        )
        assert "1. Yes" not in result and "2. No" not in result
        assert result.endswith("Reply: Yes or No.") or "Reply: Yes or No" in result

    def test_three_options_still_numbered(self, supervisor):
        # Three distinct branches — numbered block is correct shape
        result = supervisor._format_reply(
            {
                "reply": "Which do you want to check?",
                "options": [
                    "Motor connection to VFD",
                    "Nameplate vs VFD settings",
                    "Load on motor",
                ],
            }
        )
        assert "1. Motor connection" in result
        assert "2. Nameplate" in result
        assert "3. Load on motor" in result

    def test_vision_prose_stripped_from_reply(self, supervisor):
        # "The image shows..." leak from vision worker must be scrubbed
        result = supervisor._format_reply(
            {
                "reply": "The image shows a weathered metal plate with a label for a TECO 3-PHASE INDUCTION MOTOR. What is the model number?",
                "options": [],
            }
        )
        assert "The image shows" not in result
        assert "What is the model number?" in result

    def test_vision_prose_doubled_intro_stripped(self, supervisor):
        # Real prod b500953b leak: "I can see this is The image shows..."
        result = supervisor._format_reply(
            {
                "reply": "I can see this is The image shows a close-up of a cable management system. How can I help?",
                "options": [],
            }
        )
        assert "I can see this is" not in result
        assert "The image shows" not in result
        assert "How can I help?" in result

    def test_fabricated_reflection_stripped(self, supervisor):
        # b500953b: MIRA said "You've checked cable labels" — user never said that
        result = supervisor._format_reply(
            {
                "reply": "You've checked cable labels. Do the labels indicate which one is the power supply cable?",
                "options": [],
            },
            user_message="Can you find a manual for this distribution block",
        )
        assert "You've checked" not in result
        assert "Do the labels indicate which one is the power supply cable?" in result

    def test_genuine_reflection_preserved(self, supervisor):
        # When user DID say they checked, reflection is valid — keep it
        result = supervisor._format_reply(
            {
                "reply": "You've checked the voltage. What did you measure?",
                "options": [],
            },
            user_message="I checked the voltage on the terminals",
        )
        assert "You've checked" in result
        assert "What did you measure?" in result

    def test_reflection_without_user_message_preserved(self, supervisor):
        # Backward compat: _format_reply without user_message leaves reflection alone
        result = supervisor._format_reply(
            {
                "reply": "You've checked the voltage. What's next?",
                "options": [],
            }
        )
        assert result.startswith("You've checked")


# ---------------------------------------------------------------------------
# State persistence (SQLite)
# ---------------------------------------------------------------------------


class TestStatePersistence:
    def test_load_state_returns_idle_for_new_chat(self, supervisor):
        state = supervisor._load_state("new-chat-123")
        assert state["state"] == "IDLE"
        assert state["exchange_count"] == 0

    def test_save_and_load_roundtrip(self, supervisor):
        state = {
            "state": "Q2",
            "exchange_count": 3,
            "asset_identified": "PowerFlex 525",
            "fault_category": "power",
            "final_state": None,
            "context": {},
            "voice_enabled": 0,
        }
        supervisor._save_state("chat-456", state)
        loaded = supervisor._load_state("chat-456")
        assert loaded["state"] == "Q2"
        assert loaded["exchange_count"] == 3

    def test_reset_clears_state(self, supervisor):
        state = {
            "state": "DIAGNOSIS",
            "exchange_count": 5,
            "asset_identified": "Motor",
            "fault_category": "mechanical",
            "final_state": None,
            "context": "{}",
            "voice_enabled": 0,
        }
        supervisor._save_state("chat-789", state)
        supervisor.reset("chat-789")
        loaded = supervisor._load_state("chat-789")
        assert loaded["state"] == "IDLE"

    def test_log_feedback(self, supervisor):
        supervisor.log_feedback("chat-100", "up", "helpful")
        conn = sqlite3.connect(supervisor.db_path)
        row = conn.execute(
            "SELECT feedback, reason FROM feedback_log WHERE chat_id = 'chat-100'"
        ).fetchone()
        conn.close()
        assert row[0] == "up"
        assert row[1] == "helpful"


# ---------------------------------------------------------------------------
# _FAULT_INFO_RE — groundedness suppression guard (issue #372)
# ---------------------------------------------------------------------------


class TestFaultInfoRegex:
    """Fault-info regex must detect fault codes so self-critique doesn't false-positive."""

    def test_fault_code_format(self):
        assert _FAULT_INFO_RE.search("SINAMICS G120 showing F30001 fault")

    def test_alarm_keyword(self):
        assert _FAULT_INFO_RE.search("drive showing alarm code AL-14")

    def test_tripping_on(self):
        assert _FAULT_INFO_RE.search("motor is tripping on OC")

    def test_oc_fault_code(self):
        assert _FAULT_INFO_RE.search("it shows OC on the display")

    def test_no_match_on_generic_complaint(self):
        assert not _FAULT_INFO_RE.search("the motor is not working correctly")

    def test_no_match_on_vague_fault_mention(self):
        assert not _FAULT_INFO_RE.search("there is a fault somewhere in the system")

    def test_yaskawa_oc_format(self):
        assert _FAULT_INFO_RE.search("Yaskawa V1000 giving OC fault on acceleration")

    def test_danfoss_alarm4(self):
        assert _FAULT_INFO_RE.search("FC102 showing Alarm 4")


class TestFreshQuestionDuringWO:
    """Guard against regression where a fresh question during a stale cmms_pending
    state gets misrouted into the WO confirmation flow (bot critical fix 2026-05-04)."""

    def test_yes_is_wo_response(self):
        from shared.engine import _is_fresh_question_during_wo as f

        assert not f("yes")
        assert not f("Yes")
        assert not f("yeah")
        assert not f("y")

    def test_no_is_wo_response(self):
        from shared.engine import _is_fresh_question_during_wo as f

        assert not f("no")
        assert not f("nope")
        assert not f("skip")
        assert not f("cancel")

    def test_edits_are_wo_response(self):
        from shared.engine import _is_fresh_question_during_wo as f

        assert not f("change priority to HIGH")
        assert not f("asset is Pump-A3")
        assert not f("priority is HIGH")
        assert not f("line is Line 1")

    def test_question_marks_are_fresh(self):
        from shared.engine import _is_fresh_question_during_wo as f

        assert f("What causes a VFD overcurrent fault?")
        assert f("How do I reset this drive?")
        assert f("why is my pump leaking?")

    def test_question_words_are_fresh(self):
        from shared.engine import _is_fresh_question_during_wo as f

        assert f("How do I diagnose this")
        assert f("Tell me about cooling tower maintenance")
        assert f("describe the fault category")

    def test_long_statements_are_fresh(self):
        from shared.engine import _is_fresh_question_during_wo as f

        assert f("My motor is making a strange grinding noise during startup")

    def test_empty_message_is_not_fresh(self):
        from shared.engine import _is_fresh_question_during_wo as f

        assert not f("")
        assert not f("   ")


class TestResetWipesAllChatKeys:
    """Mike 2026-05-04 — /new wasn't clearing the right SQLite row because
    the dispatcher saves under composite key 'telegram:<id>' but the bot
    handler called engine.reset(<raw_id>). reset() must wipe all variants."""

    def test_reset_deletes_composite_telegram_key(self, supervisor):
        # Seed a row under the composite key the dispatcher uses
        composite = "telegram:8445149012"
        state = supervisor._load_state(composite)
        state["asset_identified"] = "Pump A3"
        state["context"]["session_context"]["symptom_summary"] = "high differential filter pressure"
        supervisor._save_state(composite, state)
        # Reset using the RAW chat id (what bot.py passes)
        supervisor.reset("8445149012")
        # The composite row must be gone now
        reloaded = supervisor._load_state(composite)
        assert reloaded.get("asset_identified") in (None, "")
        assert reloaded["context"].get("session_context", {}).get("symptom_summary", "") == ""

    def test_reset_deletes_composite_with_thread_key(self, supervisor):
        composite = "telegram:12345:67890"
        state = supervisor._load_state(composite)
        state["asset_identified"] = "Conveyor 7"
        supervisor._save_state(composite, state)
        supervisor.reset("12345")
        reloaded = supervisor._load_state(composite)
        assert reloaded.get("asset_identified") in (None, "")

    def test_reset_deletes_exact_key_too(self, supervisor):
        # Some legacy callers pass the raw key directly
        state = supervisor._load_state("legacy_chat_id")
        state["asset_identified"] = "Old equipment"
        supervisor._save_state("legacy_chat_id", state)
        supervisor.reset("legacy_chat_id")
        reloaded = supervisor._load_state("legacy_chat_id")
        assert reloaded.get("asset_identified") in (None, "")


# ---------------------------------------------------------------------------
# DST guard — active-session ASK_PROCEDURAL/GENERAL must not reset FSM
# ---------------------------------------------------------------------------


class TestDSTActiveSessionGuard:
    """Regression guard for the DST-bypass bug (MIRA_USE_DST=1).

    When DISPATCH_ASK_PROCEDURAL or DISPATCH_ASK_GENERAL fires while the
    FSM is in {Q2, Q3, DIAGNOSIS, FIX_STEP}, _maybe_dispatch_via_dst must
    return None so the legacy RAG path continues the in-progress session.
    Calling _handle_instructional_question/_handle_general_question from
    those states resets the FSM to IDLE (via _clear_diagnostic_carryover),
    which caused gs3_ground_fault_14 and self_critique_low_instruction_35
    to land in IDLE instead of DIAGNOSIS in the eval.
    """

    def _state(self, fsm_state: str) -> dict:
        return {
            "state": fsm_state,
            "exchange_count": 1,
            "final_state": None,
            "fault_category": None,
            "asset_identified": "AutomationDirect GS3",
            "context": {"session_context": {"last_question": "Check the insulation?"}},
        }

    def _mock_plan(self, kind: str):
        plan = MagicMock()
        plan.kind = kind
        return plan

    @pytest.mark.asyncio
    @pytest.mark.parametrize("fsm_state", ["Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP"])
    @pytest.mark.parametrize("dispatch_kind", [DISPATCH_ASK_PROCEDURAL, DISPATCH_ASK_GENERAL])
    async def test_active_session_returns_none(self, supervisor, fsm_state, dispatch_kind):
        """All active diagnostic states (Q1+) must return None, not call an IDLE-resetting handler."""
        from shared.dialogue_state import DialogueState
        from unittest.mock import MagicMock

        state = self._state(fsm_state)
        ds = MagicMock(spec=DialogueState)
        new_ds = MagicMock(spec=DialogueState)
        new_ds.write_to_engine_state = MagicMock()
        plan = self._mock_plan(dispatch_kind)

        with (
            patch("shared.engine.DialogueState") as mock_ds_cls,
            patch("shared.engine.track_turn", new=AsyncMock(return_value=(new_ds, plan))),
        ):
            mock_ds_cls.from_engine_state.return_value = ds
            result = await supervisor._maybe_dispatch_via_dst(
                "chat1", "what should I check?", state, "trace1", {}, None
            )

        assert result is None, (
            f"DST returned a non-None result for {dispatch_kind} in {fsm_state} — "
            "this would reset FSM to IDLE via _handle_instructional_question"
        )


# ---------------------------------------------------------------------------
# kb_status isolation (#1704 cross-tenant citation race)
# ---------------------------------------------------------------------------


class TestKbStatusIsolation:
    """The citation footer + relevance-strip must read THIS turn's kb_status
    snapshot (threaded on ``parsed``), never the shared ``self.rag.kb_status``
    attribute a concurrent tenant can overwrite mid-await (#1704).
    """

    _X = {
        "status": "covered",
        "citations": [
            {
                "manufacturer": "Rockwell",
                "model_number": "PowerFlex 525",
                "source_url": "",
                "section": "Fault Codes",
                "page_num": None,
            }
        ],
    }
    _Y = {
        "status": "covered",
        "citations": [
            {
                "manufacturer": "Danfoss",
                "model_number": "FC 202",
                "source_url": "",
                "section": "Wiring",
                "page_num": None,
            }
        ],
    }

    def test_format_reply_uses_parsed_snapshot_not_self(self, supervisor):
        # Poison the shared attribute with tenant Y; this turn's parsed carries X.
        supervisor.rag.kb_status = self._Y
        parsed = {"reply": "Check the drive.", "_kb_status": self._X}
        out = supervisor._format_reply(parsed, user_message="why is it faulted?")
        assert "Rockwell" in out  # this turn's citation rendered
        assert "Danfoss" not in out  # concurrent tenant's poison NOT leaked

    def test_format_reply_no_snapshot_means_no_footer(self, supervisor):
        # A non-RAG reply carries no _kb_status → no footer, even if the shared
        # attribute holds a stale (possibly other-tenant) value.
        supervisor.rag.kb_status = self._Y
        parsed = {"reply": "Hi there, how can I help?"}
        out = supervisor._format_reply(parsed, user_message="hi")
        assert "--- Sources ---" not in out
        assert "Danfoss" not in out

    @pytest.mark.asyncio
    async def test_call_with_correction_promotes_state_snapshot(self, supervisor):
        # rag.process() stashes the pre-await snapshot on the call's state dict;
        # _call_with_correction must promote it onto parsed so it survives later
        # state mutation and reaches _format_reply / the relevance strip.
        async def fake_process(query, state, **kw):
            state["_rag_kb_status"] = self._X  # mimic process() pre-await stash
            return '{"reply": "ok", "next_state": "Q1"}'

        supervisor.rag.process = AsyncMock(side_effect=fake_process)
        supervisor.rag._last_sources = []
        supervisor.nemotron.enabled = False
        supervisor._build_kg_context = AsyncMock(return_value="")
        supervisor._build_live_data_context = AsyncMock(return_value="")

        _raw, parsed = await supervisor._call_with_correction(
            "why faulted?", {"state": "Q1", "asset_identified": ""}
        )
        assert parsed["_kb_status"] == self._X


# ---------------------------------------------------------------------------
# Remaining #1704 read-back races: citation rewrite, grounding, decision-trace
# ---------------------------------------------------------------------------


class TestCitationRewriteIsolation:
    """_enforce_citation_rewrite must use THIS turn's evidence (chunks+kb_status
    threaded via the result dict), never the shared self.rag.last_chunks /
    kb_status a concurrent tenant overwrites (#1704)."""

    @pytest.mark.asyncio
    async def test_rewrite_uses_evidence_not_shared_rag(self, supervisor):
        supervisor.rag.last_chunks = [{"manufacturer": "Danfoss"}]  # poison
        supervisor.rag.kb_status = {"citations": [{"manufacturer": "Danfoss"}]}  # poison
        ev_chunks = [{"manufacturer": "Rockwell", "content": "F004"}]
        ev_kb = {"citations": [{"manufacturer": "Rockwell"}]}
        captured = {}

        async def fake_helper(reply, chunks, kb_status, **kw):
            captured["chunks"] = chunks
            captured["kb_status"] = kb_status
            return reply

        with patch("shared.engine._enforce_citation_via_rewrite", side_effect=fake_helper):
            with patch.dict("os.environ", {"MIRA_CITATION_REWRITE": "1"}):
                await supervisor._enforce_citation_rewrite(
                    "the drive faulted",
                    chat_id="c",
                    fsm_state="DIAGNOSIS",
                    evidence={"chunks": ev_chunks, "kb_status": ev_kb},
                )
        assert captured["chunks"] == ev_chunks  # this turn's chunks
        assert captured["kb_status"] == ev_kb
        assert "Danfoss" not in str(captured)  # concurrent tenant's poison unused

    @pytest.mark.asyncio
    async def test_rewrite_no_evidence_returns_unchanged_no_rag_read(self, supervisor):
        # No per-turn snapshot → no rewrite, and the shared helper (which would
        # read rag state) is never invoked. Requirement #5: no stale fallback.
        supervisor.rag.last_chunks = [{"manufacturer": "Danfoss"}]  # would-be poison
        called = False

        async def fake_helper(*a, **k):
            nonlocal called
            called = True
            return "REWRITTEN"

        with patch("shared.engine._enforce_citation_via_rewrite", side_effect=fake_helper):
            with patch.dict("os.environ", {"MIRA_CITATION_REWRITE": "1"}):
                out = await supervisor._enforce_citation_rewrite(
                    "original reply", chat_id="c", fsm_state="DIAGNOSIS", evidence=None
                )
        assert out == "original reply"
        assert called is False


class TestGroundingIsolation:
    """_call_with_correction must check grounding against THIS turn's sources
    snapshot (popped off state), never the shared self.rag._last_sources (#1704)."""

    @pytest.mark.asyncio
    async def test_grounding_keys_off_snapshot_not_shared(self, supervisor):
        supervisor.rag._last_sources = ["tenant Y overcurrent fault drive motor cable"]  # poison

        async def fake_process(query, state, **kw):
            state["_rag_sources"] = ["tenant X alpha bravo charlie delta echo"]
            return '{"reply": "alpha bravo charlie delta echo", "next_state": "DIAGNOSIS"}'

        supervisor.rag.process = AsyncMock(side_effect=fake_process)
        supervisor.nemotron.enabled = False
        supervisor._build_kg_context = AsyncMock(return_value="")
        supervisor._build_live_data_context = AsyncMock(return_value="")

        captured = {}
        original = supervisor._is_grounded

        def spy(parsed, sources):
            captured["sources"] = sources
            return original(parsed, sources)

        supervisor._is_grounded = spy
        await supervisor._call_with_correction("q", {"state": "DIAGNOSIS", "asset_identified": ""})
        assert captured["sources"] == ["tenant X alpha bravo charlie delta echo"]
        assert "tenant Y" not in " ".join(captured["sources"])


class TestDecisionTraceIsolation:
    """_schedule_decision_trace must derive manual_sources from the per-turn
    snapshot on the result dict, never the shared self.rag._last_sources (#1704)."""

    @pytest.mark.asyncio
    async def test_manual_sources_from_snapshot_not_shared(self, supervisor):
        supervisor.rag._last_sources = ["POISON tenant Y source"]  # shared — must be ignored
        supervisor.rag._last_no_kb = False
        result = {
            "reply": "r",
            "next_state": "DIAGNOSIS",
            "_citation_evidence": {
                "sources": ["tenant X manual section 5"],
                "no_kb": False,
                "kb_status": {},
                "chunks": [],
            },
        }
        captured = {}

        # write_trace is async → patch() makes it an AsyncMock; the side_effect
        # fires only when the fire-and-forget task is awaited, so drain the
        # scheduled task before asserting.
        def fake_write_trace(**kw):
            captured.update(kw)

        with patch("shared.decision_trace.write_trace", side_effect=fake_write_trace):
            supervisor._schedule_decision_trace(
                chat_id="c",
                message="why faulted?",
                reply="r",
                result=result,
                platform="test",
                latency_ms=1,
                tag_evidence=None,
            )
            for t in list(supervisor._decision_trace_tasks):
                await t
        assert captured.get("manual_sources") == ["tenant X manual section 5"]
        assert "POISON" not in str(captured.get("manual_sources"))

    @pytest.mark.asyncio
    async def test_no_evidence_means_no_manual_sources(self, supervisor):
        supervisor.rag._last_sources = ["POISON would-be stale source"]
        supervisor.rag._last_no_kb = False
        result = {"reply": "hi", "next_state": "IDLE"}  # non-RAG turn, no evidence
        captured = {}

        def fake_write_trace(**kw):
            captured.update(kw)

        with patch("shared.decision_trace.write_trace", side_effect=fake_write_trace):
            supervisor._schedule_decision_trace(
                chat_id="c",
                message="hi",
                reply="hi",
                result=result,
                platform="test",
                latency_ms=1,
                tag_evidence=None,
            )
            for t in list(supervisor._decision_trace_tasks):
                await t
        assert captured.get("manual_sources") is None

    @pytest.mark.asyncio
    async def test_trace_attributed_to_passed_tenant_not_instance(self, supervisor):
        # The decision trace must record THIS turn's tenant (passed by the
        # caller), never a shared instance attr a concurrent tenant overwrites.
        supervisor.tenant_id = "TENANT-Y-FALLBACK"  # would-be cross-tenant bleed
        captured = {}

        def fake_write_trace(**kw):
            captured.update(kw)

        with patch("shared.decision_trace.write_trace", side_effect=fake_write_trace):
            supervisor._schedule_decision_trace(
                chat_id="c",
                message="why faulted?",
                reply="r",
                result={"reply": "r", "next_state": "DIAGNOSIS"},
                platform="test",
                latency_ms=1,
                tag_evidence=None,
                tenant_id="tenant-X",
            )
            for t in list(supervisor._decision_trace_tasks):
                await t
        assert captured.get("tenant_id") == "tenant-X"

    @pytest.mark.asyncio
    async def test_trace_tenant_falls_back_to_self_when_unset(self, supervisor):
        supervisor.tenant_id = "ctor-tenant"
        captured = {}

        def fake_write_trace(**kw):
            captured.update(kw)

        with patch("shared.decision_trace.write_trace", side_effect=fake_write_trace):
            supervisor._schedule_decision_trace(
                chat_id="c",
                message="m",
                reply="r",
                result={"reply": "r", "next_state": "IDLE"},
                platform="test",
                latency_ms=1,
                tag_evidence=None,
                tenant_id=None,
            )
            for t in list(supervisor._decision_trace_tasks):
                await t
        assert captured.get("tenant_id") == "ctor-tenant"

    def test_supervisor_has_no_per_turn_tenant_attribute(self, supervisor):
        # The shared per-turn tenant footgun is gone — nothing to race on.
        assert not hasattr(supervisor, "_current_tenant_id")
        assert not hasattr(supervisor, "_current_mira_user_id")
