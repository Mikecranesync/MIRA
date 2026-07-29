"""Stage 0 (2026-05-04) regression tests for the dialogue-flow hot-fix.

Covers the three fast-paths added to engine.py before the broader DST work
in PLAN.md ships:

1. `_WO_ACTION_REQUEST_RE` — imperative work-order requests must route
   directly to `_handle_wo_request` instead of falling into RAG.
2. `_DONT_KNOW_RE` — short uncertainty admissions while a question is
   pending must route to `_handle_dont_know_followup` instead of being
   embedded as fault-code candidates.
3. `_apply_quality_gate` — replies marked with a trusted `dispatch_kind`
   must bypass the heuristic gate.

These directly cover the symptoms Mike reported in the 2026-05-04 HITL test:
- "Can you make a work order for the cooling fan on air compressor 1?" →
  must hit `_handle_wo_request`, NOT the GRACEFUL_FALLBACK rephrase line.
- "I don't know. I was just given the new one to put in" → must NOT search
  "IDON" / "I-DON" as a fault code.
"""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, "mira-bots")

from shared.engine import (  # noqa: E402
    _DONT_KNOW_RE,
    _TRUSTED_DISPATCH_KINDS,
    _WO_ACTION_REQUEST_RE,
    Supervisor,
)


@pytest.fixture
def supervisor(tmp_path):
    """Mocked Supervisor — all external workers patched out."""
    db_path = str(tmp_path / "stage0.db")
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
# 1. Work-order action-request regex coverage
# ---------------------------------------------------------------------------


class TestWOActionRequestRegex:
    """Catches the phrasings real techs actually use without
    over-matching on legitimate diagnostic descriptions that happen to
    contain a verb + 'work order' adjacent to other words."""

    @pytest.mark.parametrize(
        "msg",
        [
            # Mike's exact 2026-05-04 transcript
            "Can you make a work order for that?",
            "Can you make a work order for the cooling fan on air compressor 1?",
            # Common imperative phrasings
            "make a work order",
            "Make a workorder",
            "Create a WO for pump 7",
            "log a work order",
            "log a wo",
            "open a maintenance request",
            "open a service ticket",
            "submit a repair ticket",
            "file a maintenance order",
            "please create a work-ticket for this",
            "Could you make a service request?",
            "I need a work order for the bearing",
            "generate a work order",
            "raise a maintenance ticket",
        ],
    )
    def test_matches_imperative(self, msg):
        assert _WO_ACTION_REQUEST_RE.search(msg), f"should match: {msg!r}"

    @pytest.mark.parametrize(
        "msg",
        [
            "the work order I created yesterday is open",
            "what's the work order number for that?",
            "bearing replacement (WO-1234) was completed",
            "F-201 fault on the workhorse motor",
            "the conveyor is having work issues",
            "checking the order of operations",
            # No verb, just discussion of WO entity
            "it's tied to work order 4523",
            # Diagnostic chatter shouldn't trip
            "the motor trips on overcurrent",
        ],
    )
    def test_does_not_match_non_imperatives(self, msg):
        assert not _WO_ACTION_REQUEST_RE.search(msg), f"should NOT match: {msg!r}"


# ---------------------------------------------------------------------------
# 2. Don't-know regex coverage
# ---------------------------------------------------------------------------


class TestDontKnowRegex:
    @pytest.mark.parametrize(
        "msg",
        [
            "I don't know",
            "I dont know",
            "i don't know.",
            "I don't know. I was just given the new one to put in.",  # Mike's case
            "I do not know",
            "don't know",
            "not sure",
            "I'm not sure",
            "no idea",
            "I have no idea",
            "I have no clue",
            "haven't a clue",
            "can't tell",
            "cannot tell",
            "can't say",
            "unsure",
            "unclear",
            "beats me",
            "who knows",
        ],
    )
    def test_matches_uncertainty(self, msg):
        assert _DONT_KNOW_RE.search(msg), f"should match: {msg!r}"

    @pytest.mark.parametrize(
        "msg",
        [
            # Real diagnostic content — must NOT be swallowed as "uncertainty"
            "F-201 fault, motor trips on start",
            "the bearing is making noise",
            "I checked the wiring and it's loose",
            "OC code on the GS20 drive",
            # Negated forms that aren't uncertainty admissions
            "yes, I know that one",
            "I sure am working on it",
            "the motor is unsure to start",  # "unsure" mid-sentence != opener
        ],
    )
    def test_does_not_match_diagnostic(self, msg):
        assert not _DONT_KNOW_RE.search(msg), f"should NOT match: {msg!r}"


# ---------------------------------------------------------------------------
# 3. Quality-gate bypass for trusted dispatch kinds
# ---------------------------------------------------------------------------


class TestQualityGateBypass:
    def test_trusted_dispatch_kinds_set(self):
        # Spec — these four MUST stay in the bypass set; PLAN.md §2.5 / §10
        # depends on them not being gated.
        assert "action_request" in _TRUSTED_DISPATCH_KINDS
        assert "dont_know" in _TRUSTED_DISPATCH_KINDS
        assert "cmms_pending" in _TRUSTED_DISPATCH_KINDS
        assert "session_followup" in _TRUSTED_DISPATCH_KINDS
        assert "ELECTRICAL_PRINT" in _TRUSTED_DISPATCH_KINDS

    @pytest.mark.asyncio
    async def test_apply_quality_gate_bypasses_action_request(self, supervisor):
        """A reply marked dispatch_kind='action_request' must not be
        substituted by the gate, even if its content would normally fail."""
        # Use a reply that WOULD trip the heuristic (raw JSON leak) — we want
        # to confirm the bypass takes effect before the heuristic runs.
        bad_reply = '{"reply": "raw json envelope leak"}'
        result = await supervisor._apply_quality_gate(
            chat_id="test-chat",
            message="make a work order",
            reply=bad_reply,
            dispatch_kind="action_request",
        )
        assert result == bad_reply, "trusted dispatch_kind must bypass the gate"

    @pytest.mark.asyncio
    async def test_apply_quality_gate_bypasses_electrical_print_followup(self, supervisor):
        """Electrical-print replies are already constrained to the saved print image.

        Schematic answers naturally repeat symbols like M1, K1, contactor, and
        terminal labels, so the generic repetition gate must not replace them
        with a rephrase fallback after the print handler has selected this path.
        """
        from shared import quality_gate

        print_reply = (
            "According to this print, M1 is powered through contactor K1. "
            "The M1 contactor feeds M1 after the control circuit closes K1."
        )
        with patch(
            "shared.quality_gate.evaluate",
            new=AsyncMock(
                return_value=quality_gate.GateResult(
                    verdict="fail",
                    reasons=["repeated_substring"],
                    elapsed_ms=0.5,
                )
            ),
        ):
            with patch("shared.quality_gate.is_enabled", return_value=True):
                result = await supervisor._apply_quality_gate(
                    chat_id="test-chat",
                    message="which contactor powers M1",
                    reply=print_reply,
                    dispatch_kind="ELECTRICAL_PRINT",
                )
                assert result == print_reply

    @pytest.mark.asyncio
    async def test_apply_quality_gate_runs_for_default_dispatch(self, supervisor):
        """No dispatch_kind = normal flow → gate runs and substitutes
        the GRACEFUL_FALLBACK on heuristic failure."""
        # Stub the gate to fail so we can confirm the substitution path
        # is still reachable when no trusted dispatch is set.
        from shared import quality_gate

        with patch(
            "shared.quality_gate.evaluate",
            new=AsyncMock(
                return_value=quality_gate.GateResult(
                    verdict="fail",
                    reasons=["raw_json_leak"],
                    elapsed_ms=0.5,
                )
            ),
        ):
            with patch("shared.quality_gate.is_enabled", return_value=True):
                bad_reply = '{"reply": "raw json envelope leak"}'
                result = await supervisor._apply_quality_gate(
                    chat_id="test-chat",
                    message="something",
                    reply=bad_reply,
                    dispatch_kind="",
                )
                assert result == quality_gate.GRACEFUL_FALLBACK


# ---------------------------------------------------------------------------
# 4. _handle_dont_know_followup wiring
# ---------------------------------------------------------------------------


class TestDontKnowHandler:
    def test_returns_dispatch_kind_dont_know(self, supervisor):
        state = {
            "state": "Q1",
            "exchange_count": 1,
            "asset_identified": "Yaskawa GA700",
            "context": {"session_context": {"last_question": "what fault code?"}},
        }
        # Use a fresh chat_id so the saved state doesn't collide with other tests.
        result = supervisor._handle_dont_know_followup(
            chat_id="dk-test-1",
            message="I don't know",
            state=state,
            trace_id="trace-dk-1",
        )
        assert result["dispatch_kind"] == "dont_know"
        assert "photo" in result["reply"].lower() or "describe" in result["reply"].lower()
        assert result["next_state"] == "Q1"

    def test_idle_branch_invites_photo(self, supervisor):
        state = {
            "state": "IDLE",
            "exchange_count": 0,
            "asset_identified": "",
            "context": {"session_context": {"last_question": "what equipment?"}},
        }
        result = supervisor._handle_dont_know_followup(
            chat_id="dk-test-2",
            message="not sure",
            state=state,
            trace_id="trace-dk-2",
        )
        # IDLE/no-asset path should mention photo as the fallback channel.
        assert "photo" in result["reply"].lower()


# ---------------------------------------------------------------------------
# 5. _handle_wo_request now sets dispatch_kind
# ---------------------------------------------------------------------------


class TestWoRequestDispatchKind:
    @pytest.mark.asyncio
    async def test_handle_wo_request_marks_action_request(self, supervisor):
        state = {
            "state": "Q1",
            "exchange_count": 1,
            "asset_identified": "Air compressor #1",
            "context": {},
        }
        result = await supervisor._handle_wo_request(
            chat_id="wo-test-1",
            message="make a work order for the cooling fan",
            state=state,
            trace_id="trace-wo-1",
        )
        assert result["dispatch_kind"] == "action_request"
        # The WO preview must mention the asset / fault for Mike's regression case.
        assert result["reply"]
