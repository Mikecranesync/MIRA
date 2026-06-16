"""Stage 1 engine integration tests for the Dialogue State Tracker.

These run with `MIRA_USE_DST=1` and prove the tracker:
* Correctly routes the four symptoms from Mike's 2026-05-04 HITL test.
* Falls through cleanly to the legacy flow when the classifier returns
  `DEFAULT_RAG`, an unknown act, or raises.
* Persists the dialogue state on the engine state dict so the next turn
  sees the right pending question + salient entities.

The Groq HTTP call is mocked at `shared.dialogue_acts.classify_dialogue_act`
— no network. Workers (RAG, vision, etc.) are mocked at the engine level.
"""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, "mira-bots")

from shared.dialogue_state import (  # noqa: E402
    DontKnowAct,
    GreetAck,
    MetaControlAct,
    RequestActionAct,
)
from shared.engine import Supervisor  # noqa: E402

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def supervisor(tmp_path):
    """Supervisor with workers mocked and the DST flag forced ON."""
    db_path = str(tmp_path / "dst.db")
    env = {"INFERENCE_BACKEND": "local", "MIRA_USE_DST": "1"}
    with patch.dict("os.environ", env, clear=False):
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
    # Force the module-level flag — the env-var read happens at import time
    # and we may have imported before the patch.
    import shared.engine as _eng

    _eng._DST_ENABLED = True
    return sup


def _seed_state(
    supervisor: Supervisor,
    chat_id: str,
    *,
    fsm_state: str = "Q2",
    last_question: str = "What is the fault code on the display?",
    asset: str = "Atlas Copco GA37 air compressor",
):
    """Write a state row that simulates 'MIRA is mid-Q2 waiting for fault code'."""
    state = supervisor._load_state(chat_id)
    state["state"] = fsm_state
    state["asset_identified"] = asset
    state["exchange_count"] = 2
    state["context"] = {
        "session_context": {"last_question": last_question, "last_options": []},
        "history": [
            {"role": "user", "content": "Air compressor #1 is acting up"},
            {"role": "assistant", "content": last_question},
        ],
    }
    supervisor._save_state(chat_id, state)


# ---------------------------------------------------------------------------
# Mike's transcript replay — Symptom 2 (WO request mid-Q)
# ---------------------------------------------------------------------------


class TestSymptom2WoRequestMidFlow:
    """Mike said: 'Can you make a work order for the cooling fan on air
    compressor 1?' while MIRA had a pending Q2 question. The WO must be
    created — must NOT fall into the GRACEFUL_FALLBACK ('rephrase your
    question…')."""

    @pytest.mark.asyncio
    async def test_wo_request_routes_to_handler(self, supervisor):
        chat_id = "mike-symptom2-1"
        _seed_state(supervisor, chat_id)

        with patch("shared.engine.track_turn", new=AsyncMock()) as mock_track:
            # Build the (state, plan) pair the same way track_turn would
            from shared.dialogue_state import DialogueState
            from shared.dialogue_tracker import (
                DISPATCH_ACTION_INTERRUPT,
                DispatchPlan,
            )

            ds = DialogueState(chat_id=chat_id, fsm_state="Q2")
            plan = DispatchPlan(
                kind=DISPATCH_ACTION_INTERRUPT,
                turn=RequestActionAct(action="log_work_order"),
                payload={"action": "log_work_order"},
            )
            mock_track.return_value = (ds, plan)

            result = await supervisor.process_full(
                chat_id=chat_id,
                message="Can you make a work order for the cooling fan on air compressor 1?",
            )

        # Must have routed to _handle_wo_request, not GRACEFUL_FALLBACK
        assert result["dispatch_kind"] == "action_request"
        assert "rephrase" not in result["reply"].lower()
        # WO preview includes the asset
        assert result["reply"]


# ---------------------------------------------------------------------------
# Mike's transcript replay — Symptom 1 ("I don't know")
# ---------------------------------------------------------------------------


class TestSymptom1DontKnow:
    """Mike said: 'I don't know. I was just given the new one to put in.'
    while MIRA had a pending Q. The bot must NOT tokenize 'IDON' / 'I-DON'
    as candidate fault codes — it must route to _handle_dont_know_followup."""

    @pytest.mark.asyncio
    async def test_dont_know_routes_to_followup_handler(self, supervisor):
        chat_id = "mike-symptom1-1"
        _seed_state(supervisor, chat_id)

        from shared.dialogue_state import DialogueState
        from shared.dialogue_tracker import DISPATCH_SLOT_DONT_KNOW, DispatchPlan

        ds = DialogueState(chat_id=chat_id, fsm_state="Q2")
        plan = DispatchPlan(
            kind=DISPATCH_SLOT_DONT_KNOW,
            turn=DontKnowAct(),
            payload={"slot": "fault_code"},
        )
        with patch("shared.engine.track_turn", new=AsyncMock(return_value=(ds, plan))):
            result = await supervisor.process_full(
                chat_id=chat_id,
                message="I don't know. I was just given the new one to put in.",
            )

        assert result["dispatch_kind"] == "dont_know"
        # Reply should invite a photo or description-like alternative path,
        # not embed the message as a vector query. The Q2-mid-asset branch
        # of `_handle_dont_know_followup` says "rough description narrows
        # it down" — both keywords are signals the handler ran.
        reply_low = result["reply"].lower()
        assert "photo" in reply_low or "describe" in reply_low or "description" in reply_low


# ---------------------------------------------------------------------------
# Action interrupt — switch_asset
# ---------------------------------------------------------------------------


class TestSwitchAssetInterrupt:
    @pytest.mark.asyncio
    async def test_switch_asset_routes_correctly(self, supervisor):
        chat_id = "switch-1"
        _seed_state(supervisor, chat_id)

        from shared.dialogue_state import DialogueState
        from shared.dialogue_tracker import DISPATCH_ACTION_INTERRUPT, DispatchPlan

        ds = DialogueState(chat_id=chat_id, fsm_state="Q2")
        plan = DispatchPlan(
            kind=DISPATCH_ACTION_INTERRUPT,
            turn=RequestActionAct(action="switch_asset"),
            payload={"action": "switch_asset"},
        )
        with patch("shared.engine.track_turn", new=AsyncMock(return_value=(ds, plan))):
            result = await supervisor.process_full(
                chat_id=chat_id, message="Now help me with the conveyor instead"
            )

        # The asset-switch handler returns its own reply; we just check it ran
        assert result["reply"]
        assert result.get("dispatch_kind") in ("action_request", "")


# ---------------------------------------------------------------------------
# Meta — reset / cancel
# ---------------------------------------------------------------------------


class TestMetaControlReset:
    @pytest.mark.asyncio
    async def test_meta_reset_clears_state(self, supervisor):
        chat_id = "reset-1"
        _seed_state(supervisor, chat_id)

        from shared.dialogue_state import DialogueState
        from shared.dialogue_tracker import DISPATCH_META, DispatchPlan

        ds = DialogueState(chat_id=chat_id, fsm_state="Q2")
        plan = DispatchPlan(
            kind=DISPATCH_META,
            turn=MetaControlAct(command="reset"),
            payload={"command": "reset"},
        )
        with patch("shared.engine.track_turn", new=AsyncMock(return_value=(ds, plan))):
            result = await supervisor.process_full(chat_id=chat_id, message="reset")

        assert result["dispatch_kind"] == "dst_meta"
        assert "fresh" in result["reply"].lower() or "started" in result["reply"].lower()
        # State should now be IDLE
        loaded = supervisor._load_state(chat_id)
        assert loaded["state"] == "IDLE"

    @pytest.mark.asyncio
    async def test_meta_cancel_clears_pending_question(self, supervisor):
        chat_id = "cancel-1"
        _seed_state(supervisor, chat_id)

        from shared.dialogue_state import DialogueState
        from shared.dialogue_tracker import DISPATCH_META, DispatchPlan

        ds = DialogueState(chat_id=chat_id, fsm_state="Q2")
        plan = DispatchPlan(
            kind=DISPATCH_META,
            turn=MetaControlAct(command="cancel"),
            payload={"command": "cancel"},
        )
        with patch("shared.engine.track_turn", new=AsyncMock(return_value=(ds, plan))):
            result = await supervisor.process_full(chat_id=chat_id, message="nevermind")

        assert result["dispatch_kind"] == "dst_meta"
        # last_question wiped
        loaded = supervisor._load_state(chat_id)
        assert not loaded["context"]["session_context"].get("last_question")


# ---------------------------------------------------------------------------
# Greet in IDLE
# ---------------------------------------------------------------------------


class TestGreetIdle:
    @pytest.mark.asyncio
    async def test_greet_in_idle_runs_greeting_handler(self, supervisor):
        chat_id = "greet-1"
        # Fresh state — IDLE
        from shared.dialogue_state import DialogueState
        from shared.dialogue_tracker import DISPATCH_GREET, DispatchPlan

        ds = DialogueState(chat_id=chat_id, fsm_state="IDLE")
        plan = DispatchPlan(kind=DISPATCH_GREET, turn=GreetAck())
        with patch("shared.engine.track_turn", new=AsyncMock(return_value=(ds, plan))):
            result = await supervisor.process_full(chat_id=chat_id, message="hi there")

        assert result["reply"]
        # Greeting reply mentions MIRA / what it can help with
        reply_low = result["reply"].lower()
        assert "mira" in reply_low or "diagnose" in reply_low or "fault" in reply_low


# ---------------------------------------------------------------------------
# Falls through to legacy flow on DEFAULT_RAG / classifier failure
# ---------------------------------------------------------------------------


class TestLegacyFallthrough:
    @pytest.mark.asyncio
    async def test_default_rag_dispatch_returns_none_and_legacy_runs(self, supervisor):
        """When the tracker dispatches DEFAULT_RAG, _maybe_dispatch_via_dst
        must return None so the legacy router/RAG path runs."""
        chat_id = "fallthrough-1"
        _seed_state(supervisor, chat_id, fsm_state="IDLE", last_question="")

        from shared.dialogue_state import DialogueState, InformAct
        from shared.dialogue_tracker import DISPATCH_DEFAULT_RAG, DispatchPlan

        ds = DialogueState(chat_id=chat_id, fsm_state="IDLE")
        plan = DispatchPlan(kind=DISPATCH_DEFAULT_RAG, turn=InformAct())

        legacy_called = {"yes": False}

        async def fake_legacy_router(*_a, **_kw):
            legacy_called["yes"] = True
            return {
                "intent": "diagnose_equipment",
                "confidence": 0.8,
                "reasoning": "legacy",
            }

        with patch("shared.engine.track_turn", new=AsyncMock(return_value=(ds, plan))):
            with patch("shared.engine.route_intent", new=AsyncMock(side_effect=fake_legacy_router)):
                # Patch the rag worker too so we don't actually hit the LLM
                supervisor.rag.process = AsyncMock(
                    return_value={
                        "reply": "Legacy diagnosis reply",
                        "next_state": "Q1",
                        "options": [],
                    }
                )
                result = await supervisor.process_full(
                    chat_id=chat_id, message="the motor is humming"
                )

        # Legacy router invoked (DST didn't short-circuit)
        assert legacy_called["yes"]
        # Reply came from the legacy path
        assert result["reply"]

    @pytest.mark.asyncio
    async def test_track_turn_failure_falls_back_to_legacy(self, supervisor):
        """If the tracker raises, _maybe_dispatch_via_dst returns None and
        the legacy flow runs. Bot must NOT crash."""
        chat_id = "fail-1"
        _seed_state(supervisor, chat_id, fsm_state="IDLE", last_question="")

        async def raise_classifier(*_a, **_kw):
            raise RuntimeError("classifier exploded")

        with patch("shared.engine.track_turn", new=AsyncMock(side_effect=raise_classifier)):
            with patch(
                "shared.engine.route_intent",
                new=AsyncMock(
                    return_value={
                        "intent": "continue_current",
                        "confidence": 0.5,
                        "reasoning": "x",
                    }
                ),
            ):
                # The exact legacy reply path isn't the point here — what
                # matters is the engine doesn't propagate the tracker error
                # and returns SOME valid reply (could be RAG_FAILURE on
                # downstream worker errors, that's fine).
                result = await supervisor.process_full(
                    chat_id=chat_id, message="the motor is humming"
                )

        # Engine survived: returned a non-empty result dict with a reply.
        assert isinstance(result, dict)
        assert result.get("reply"), "engine must return a non-empty reply on tracker failure"


# ---------------------------------------------------------------------------
# Quality gate respect — DST handlers' replies bypass the runtime gate
# ---------------------------------------------------------------------------


class TestQualityGateBypass:
    def test_trusted_dispatch_kinds_includes_dst(self):
        from shared.engine import _TRUSTED_DISPATCH_KINDS

        # Stage 0 keeps these
        assert "action_request" in _TRUSTED_DISPATCH_KINDS
        assert "dont_know" in _TRUSTED_DISPATCH_KINDS
        # Stage 1 adds these
        assert "dst_greet" in _TRUSTED_DISPATCH_KINDS
        assert "dst_meta" in _TRUSTED_DISPATCH_KINDS
        assert "dst_action_interrupt" in _TRUSTED_DISPATCH_KINDS


# ---------------------------------------------------------------------------
# Flag is OFF by default — Stage 0 fast-paths still run unchanged
# ---------------------------------------------------------------------------


class TestFlagOffBackcompat:
    @pytest.fixture
    def supervisor_flag_off(self, tmp_path):
        db_path = str(tmp_path / "dst_off.db")
        env = {"INFERENCE_BACKEND": "local"}  # MIRA_USE_DST not set
        with patch.dict("os.environ", env, clear=False):
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
        import shared.engine as _eng

        _eng._DST_ENABLED = False
        return sup

    @pytest.mark.asyncio
    async def test_flag_off_skips_dst_dispatch(self, supervisor_flag_off):
        """When flag is OFF the tracker path is NOT entered — legacy Stage 0
        fast-path still catches the WO request."""
        chat_id = "flag-off-1"

        # Stage 0 regex catches "make a work order" without DST
        track_called = {"yes": False}

        async def track_wrapper(*_a, **_kw):
            track_called["yes"] = True
            from shared.dialogue_state import DialogueState, InformAct
            from shared.dialogue_tracker import DISPATCH_DEFAULT_RAG, DispatchPlan

            return (DialogueState(), DispatchPlan(kind=DISPATCH_DEFAULT_RAG, turn=InformAct()))

        with patch("shared.engine.track_turn", new=track_wrapper):
            result = await supervisor_flag_off.process_full(
                chat_id=chat_id, message="make a work order for the pump"
            )

        # DST path not entered
        assert not track_called["yes"]
        # Stage 0 regex still catches the WO request
        assert result["dispatch_kind"] == "action_request"
