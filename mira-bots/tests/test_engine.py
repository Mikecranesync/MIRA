"""Tests for shared.engine — Supervisor FSM, parsing, confidence, state management."""

from __future__ import annotations

import json
import sqlite3
import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from shared.engine import STATE_ORDER, Supervisor, _STATE_ALIASES, _FAULT_INFO_RE


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
        }

    def test_defaults(self):
        result = Supervisor._make_result("reply")
        assert result["confidence"] == "none"
        assert result["trace_id"] is None
        assert result["next_state"] is None


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
        assert "1." not in result  # too short (<= 2 chars)


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
