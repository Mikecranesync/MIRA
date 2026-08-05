"""UNS Confirmation Gate tests.

The gate enforces: no diagnosis without a confirmed asset. Verifies the two
handler methods (_handle_uns_confirmation_request and
_handle_uns_confirmation_response) directly. Offline — no network, no LLM.
"""

from __future__ import annotations

import sys
from types import SimpleNamespace

sys.path.insert(0, "mira-bots")

from unittest.mock import patch

import pytest
from shared.engine import Supervisor


def _make_sv(db_path: str) -> Supervisor:
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
            return Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test",
                collection_id="test",
            )


def _fresh_state(chat_id: str) -> dict:
    return {
        "chat_id": chat_id,
        "state": "IDLE",
        "context": {"session_context": {}, "history": []},
        "asset_identified": None,
        "fault_category": None,
        "exchange_count": 0,
        "final_state": None,
    }


# ── Gate firing ─────────────────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_request_with_candidate_includes_candidate_in_prompt(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u1")
    uns_ctx = SimpleNamespace(manufacturer="Allen-Bradley", model="PowerFlex 525", confidence=0.55)

    result = await sv._handle_uns_confirmation_request(
        "u1", "why is it stopped", state, uns_ctx, "trace-1"
    )

    assert "Allen-Bradley" in result["reply"]
    assert "PowerFlex 525" in result["reply"]
    assert "55%" in result["reply"]
    assert result["dispatch_kind"] == "uns_confirm_request"
    # FSM side state — downstream code paths (citation enforcement, telemetry,
    # DST) key off this. See namespace-builder spec §"UNS Location-Confirmation Gate".
    assert result["next_state"] == "AWAITING_UNS_CONFIRMATION"

    # State must persist the pending block for the next turn.
    saved = sv._load_state("u1")
    pending = (saved.get("context") or {}).get("pending_uns_confirm")
    assert pending == {"candidate": "Allen-Bradley, PowerFlex 525"}
    assert saved["state"] == "AWAITING_UNS_CONFIRMATION"


@pytest.mark.asyncio
async def test_request_with_no_candidate_asks_for_make_and_model(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u2")
    uns_ctx = SimpleNamespace(manufacturer=None, model=None, confidence=0.0)

    result = await sv._handle_uns_confirmation_request("u2", "fault", state, uns_ctx, "trace-2")

    assert "manufacturer and model" in result["reply"]
    assert result["next_state"] == "AWAITING_UNS_CONFIRMATION"
    saved = sv._load_state("u2")
    pending = (saved.get("context") or {}).get("pending_uns_confirm")
    assert pending == {"candidate": None}
    assert saved["state"] == "AWAITING_UNS_CONFIRMATION"


# ── Confirmation consumed ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_response_yes_sets_asset_and_clears_pending(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u3")
    state["state"] = "AWAITING_UNS_CONFIRMATION"
    state["context"]["pending_uns_confirm"] = {"candidate": "Siemens, SINAMICS G120"}
    sv._save_state("u3", state)

    result = await sv._handle_uns_confirmation_response("u3", "yes", state, "trace-3")

    assert result is not None
    assert "Siemens" in result["reply"]
    assert result["dispatch_kind"] == "uns_confirm_yes"

    saved = sv._load_state("u3")
    assert saved["asset_identified"] == "Siemens, SINAMICS G120"
    assert "pending_uns_confirm" not in (saved.get("context") or {})
    # Side state cleared — normal IDLE→Q1 flow resumes on the next turn.
    assert saved["state"] == "IDLE"


@pytest.mark.asyncio
async def test_response_no_clears_pending_and_reprompts(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u4")
    state["state"] = "AWAITING_UNS_CONFIRMATION"
    state["context"]["pending_uns_confirm"] = {"candidate": "Mitsubishi, FR-D700"}
    sv._save_state("u4", state)

    result = await sv._handle_uns_confirmation_response("u4", "no", state, "trace-4")

    assert result is not None
    assert "tell me the correct" in result["reply"].lower()
    assert result["dispatch_kind"] == "uns_confirm_no"

    saved = sv._load_state("u4")
    assert saved["asset_identified"] is None  # NOT set on "no"
    assert "pending_uns_confirm" not in (saved.get("context") or {})
    # Side state cleared — gate can re-fire on the next turn if the user's
    # reply doesn't itself resolve to a candidate.
    assert saved["state"] == "IDLE"


@pytest.mark.asyncio
async def test_response_freeform_text_falls_through(tmp_path):
    """Anything that isn't yes/no signals 'I'll tell you what it is' — fall through
    so the normal flow can re-run the UNS resolver on the new message."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u5")
    state["state"] = "AWAITING_UNS_CONFIRMATION"
    state["context"]["pending_uns_confirm"] = {"candidate": "Bad Guess Inc"}
    sv._save_state("u5", state)

    result = await sv._handle_uns_confirmation_response(
        "u5", "Allen-Bradley PowerFlex 525", state, "trace-5"
    )

    assert result is None  # caller should continue normal routing

    saved = sv._load_state("u5")
    assert "pending_uns_confirm" not in (saved.get("context") or {})
    # Side state cleared so the normal flow re-running on this message can
    # re-fire the gate with a fresh candidate from the new specs.
    assert saved["state"] == "IDLE"


@pytest.mark.asyncio
async def test_response_yes_without_candidate_falls_through(tmp_path):
    """yes is ambiguous when no candidate was offered — fall through, don't claim assets."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u6")
    state["context"]["pending_uns_confirm"] = {"candidate": None}
    sv._save_state("u6", state)

    result = await sv._handle_uns_confirmation_response("u6", "yes", state, "trace-6")

    assert result is None

    saved = sv._load_state("u6")
    assert saved["asset_identified"] is None


@pytest.mark.asyncio
async def test_response_yes_with_demo_namespace_feeds_the_overlay(tmp_path):
    """A tenant-namespace confirmation must hand the overlay a usable identity.

    2026-08-02 round-3 probe: after "yes" the state carried only the joined
    display label, so the live overlay's cmms_equipment fallback (exact
    equipment_number) could never resolve — the confirmed asset_tag and the
    match's uns_path must both land on context.
    """
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u7")
    state["state"] = "AWAITING_UNS_CONFIRMATION"
    demo_ns = {
        "asset_id": "42",
        "asset_name": "Conv_Simple Bench Conveyor",
        "asset_tag": "CV-101",
        "uns_path": "enterprise.home_garage.conveyor_lab.conveyor_1",
        "confidence": 0.9,
    }
    state["context"]["pending_uns_confirm"] = {
        "candidate": "Conv_Simple Bench Conveyor / CV-101",
        "demo_namespace": demo_ns,
    }
    sv._save_state("u7", state)

    result = await sv._handle_uns_confirmation_response("u7", "yes", state, "trace-7")

    assert result is not None
    assert result["dispatch_kind"] == "uns_confirm_yes"

    saved = sv._load_state("u7")
    ctx = saved.get("context") or {}
    assert saved["asset_identified"] == "Conv_Simple Bench Conveyor / CV-101"
    assert ctx.get("asset_tag") == "CV-101"
    assert (ctx.get("confirmed_namespace") or {}).get("uns_path") == (
        "enterprise.home_garage.conveyor_lab.conveyor_1"
    )


# ── Gate firing conditions (_should_fire_uns_gate) ─────────────────────────


def test_gate_fires_on_diagnose_idle_no_asset(tmp_path):
    """Primary case: diagnostic question in IDLE with no confirmed equipment."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u")
    assert (
        sv._should_fire_uns_gate("diagnose_equipment", state, "why is conveyor stopped", {}) is True
    )


def test_gate_fires_on_schedule_maintenance(tmp_path):
    """PM scheduling is asset-specific — require a confirmed asset, same as diagnose.
    schedule_maintenance has no dedicated pre-gate handler, so it reaches the gate."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u")
    assert sv._should_fire_uns_gate("schedule_maintenance", state, "schedule a PM", {}) is True


def test_gate_does_not_fire_on_general_question(tmp_path):
    """'What is MQTT?' routes to general_question — gate never sees it. But even
    if it did, the gate must refuse to fire on non-diagnose intents."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u")
    assert sv._should_fire_uns_gate("general_question", state, "what is mqtt", {}) is False


def test_gate_does_not_fire_when_asset_identified(tmp_path):
    """Asset already confirmed — diagnose freely, no gate."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u")
    state["asset_identified"] = "Allen-Bradley, PowerFlex 525"
    assert sv._should_fire_uns_gate("diagnose_equipment", state, "fault again", {}) is False


def test_gate_does_not_fire_mid_fsm(tmp_path):
    """Mid-Q1/Q2/Q3 session — even with no asset, don't hijack the in-flight
    diagnostic flow with a confirmation prompt. Regression case from advisor."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u")
    for fsm_state in ("Q1", "Q2", "Q3", "DIAGNOSIS", "FIX_STEP"):
        state["state"] = fsm_state
        assert (
            sv._should_fire_uns_gate("diagnose_equipment", state, "clarifying question", {})
            is False
        ), f"gate must not fire in {fsm_state}"


def test_gate_does_not_fire_on_safety_intent(tmp_path):
    """Safety wins everywhere — safety_concern intent doesn't trigger UNS confirmation."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u")
    assert sv._should_fire_uns_gate("safety_concern", state, "arc flash hazard", {}) is False


# ── Kill-switch — MIRA_UNS_GATE_ENABLED=0 returns to pre-gate behavior ──────


def test_gate_disabled_via_env_flag_does_not_fire(monkeypatch):
    """MIRA_UNS_GATE_ENABLED=0 reverts to the pre-gate behavior. This is the
    flag-off regression path called out in the namespace-builder plan Phase 1
    acceptance ("with MIRA_UNS_GATE_ENABLED=false, the engine falls back to the
    pre-extension gate path")."""
    import importlib

    import shared.engine as engine_mod

    monkeypatch.setenv("MIRA_UNS_GATE_ENABLED", "0")
    # Module-level flag — reimport to pick up the new env value.
    importlib.reload(engine_mod)

    sv = engine_mod.Supervisor.__new__(engine_mod.Supervisor)  # bypass __init__ heavy deps
    state = _fresh_state("u")
    # Gate would normally fire on this exact input; flag must suppress it.
    assert (
        engine_mod.Supervisor._should_fire_uns_gate(
            sv, "diagnose_equipment", state, "why is conveyor stopped", {}
        )
        is False
    )

    # Restore default for the rest of the suite.
    monkeypatch.setenv("MIRA_UNS_GATE_ENABLED", "1")
    importlib.reload(engine_mod)


# ── Asset switch routes through the confirmation gate ──────────────────────
# A deliberate asset switch ("now help me with the pump") must NOT silently
# adopt a freshly-resolved-but-unconfirmed asset and let troubleshooting
# proceed against it. With the gate on, the switch is re-confirmed; the stale
# asset is dropped and the new one is only adopted on a "yes".


@pytest.mark.asyncio
async def test_switch_asset_with_candidate_fires_confirmation(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("sw1")
    state["asset_identified"] = "Allen-Bradley, PowerFlex 525"  # the OLD asset
    state["state"] = "DIAGNOSIS"  # mid-flow on the old asset
    sv._save_state("sw1", state)

    new_ctx = SimpleNamespace(manufacturer="Siemens", model="SINAMICS S120", confidence=0.6)
    with patch("shared.engine.resolve_uns_path", return_value=new_ctx):
        result = await sv._handle_asset_switch("sw1", "now the Siemens S120 drive", state, "tr-sw1")

    # The turn is interrupted with a confirm prompt for the NEW asset.
    assert result["dispatch_kind"] == "uns_confirm_request"
    assert result["next_state"] == "AWAITING_UNS_CONFIRMATION"
    assert "Siemens" in result["reply"]

    saved = sv._load_state("sw1")
    # Stale asset dropped; new asset NOT adopted until confirmed.
    assert not saved.get("asset_identified")
    assert saved["state"] == "AWAITING_UNS_CONFIRMATION"
    pending = (saved.get("context") or {}).get("pending_uns_confirm")
    assert pending and "Siemens" in (pending.get("candidate") or "")


@pytest.mark.asyncio
async def test_switch_asset_no_candidate_clears_and_asks(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("sw2")
    state["asset_identified"] = "Allen-Bradley, PowerFlex 525"
    sv._save_state("sw2", state)

    new_ctx = SimpleNamespace(manufacturer="", model=None, confidence=0.0)
    with patch("shared.engine.resolve_uns_path", return_value=new_ctx):
        result = await sv._handle_asset_switch("sw2", "let's switch machines", state, "tr-sw2")

    # Nothing to confirm yet — clarify, don't park in AWAITING.
    assert result["dispatch_kind"] != "uns_confirm_request"
    saved = sv._load_state("sw2")
    assert not saved.get("asset_identified")  # stale dropped
    assert saved["state"] == "IDLE"
    assert "pending_uns_confirm" not in (saved.get("context") or {})


@pytest.mark.asyncio
async def test_switch_asset_legacy_when_gate_disabled(tmp_path, monkeypatch):
    """MIRA_UNS_GATE_ENABLED=0 keeps the pre-gate behavior: adopt the new asset
    directly and prompt, no confirmation interrupt."""
    monkeypatch.setattr("shared.engine._UNS_GATE_ENABLED", False)
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("sw3")
    sv._save_state("sw3", state)

    new_ctx = SimpleNamespace(manufacturer="Mitsubishi", model="FR-D700", confidence=0.6)
    with patch("shared.engine.resolve_uns_path", return_value=new_ctx):
        result = await sv._handle_asset_switch("sw3", "now the Mitsubishi", state, "tr-sw3")

    assert result["dispatch_kind"] != "uns_confirm_request"
    saved = sv._load_state("sw3")
    assert saved["asset_identified"] == "Mitsubishi"  # legacy direct-adopt
    assert saved["state"] == "IDLE"


# ── FSM-state validity ─────────────────────────────────────────────────────


def test_awaiting_uns_confirmation_is_valid_fsm_state():
    """The side state added for the gate must be in VALID_STATES so transition
    validators in `_advance_state` accept it. Guards against the LLM emitting it
    as a `next_state` value in a future prompt update."""
    from shared.fsm import VALID_STATES

    assert "AWAITING_UNS_CONFIRMATION" in VALID_STATES


# ── D2: symptom-first fallback (gate deadlock) ──────────────────────────────
# A technician who cannot name the manufacturer/model must not receive the
# identical gate demand forever (defect D2, docs/evals/2026-08-03-dialogue-
# mode-w2a/results.md). After the technician signals unknown identity — or
# after _UNS_GATE_MAX_ATTEMPTS unresolved gate firings — the gate stops
# repeating and the turn proceeds into a clearly-labeled, lower-confidence
# symptom-first diagnostic path. A real candidate re-opens the grounded route.


@pytest.mark.asyncio
async def test_request_increments_gate_attempts(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d1")
    uns_ctx = SimpleNamespace(manufacturer=None, model=None, confidence=0.0)

    await sv._handle_uns_confirmation_request("d1", "fault", state, uns_ctx, "t")
    saved = sv._load_state("d1")
    assert (saved["context"] or {}).get("uns_gate_attempts") == 1

    await sv._handle_uns_confirmation_request("d1", "fault again", saved, uns_ctx, "t")
    saved = sv._load_state("d1")
    assert (saved["context"] or {}).get("uns_gate_attempts") == 2


@pytest.mark.asyncio
async def test_unknown_identity_fallthrough_sets_flag(tmp_path):
    """'I don't have the manual handy' must register as unknown identity."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d2")
    state["state"] = "AWAITING_UNS_CONFIRMATION"
    state["context"]["pending_uns_confirm"] = {"candidate": None}
    sv._save_state("d2", state)

    result = await sv._handle_uns_confirmation_response(
        "d2",
        "It's a sensor on the packaging machine, but I don't have the manual handy",
        state,
        "t",
    )

    assert result is None  # still falls through to the normal flow
    saved = sv._load_state("d2")
    assert (saved["context"] or {}).get("uns_identity_unknown") is True


@pytest.mark.asyncio
async def test_specs_fallthrough_does_not_set_unknown_flag(tmp_path):
    """The other direction: typing real specs must NOT flag unknown identity."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d3")
    state["state"] = "AWAITING_UNS_CONFIRMATION"
    state["context"]["pending_uns_confirm"] = {"candidate": None}
    sv._save_state("d3", state)

    result = await sv._handle_uns_confirmation_response(
        "d3", "It's an Allen-Bradley PowerFlex 525", state, "t"
    )

    assert result is None
    saved = sv._load_state("d3")
    assert not (saved["context"] or {}).get("uns_identity_unknown")


def test_gate_not_exhausted_fresh_state(tmp_path):
    """Known-or-obtainable identity keeps the normal grounded route untouched."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d4")
    uns_ctx = SimpleNamespace(manufacturer=None, model=None, confidence=0.0)
    assert sv._uns_gate_exhausted(state, uns_ctx) is False


def test_gate_exhausted_after_max_attempts(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d5")
    state["context"]["uns_gate_attempts"] = 2
    uns_ctx = SimpleNamespace(manufacturer=None, model=None, confidence=0.0)
    assert sv._uns_gate_exhausted(state, uns_ctx) is True


def test_gate_exhausted_on_unknown_identity_flag(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d6")
    state["context"]["uns_gate_attempts"] = 1
    state["context"]["uns_identity_unknown"] = True
    uns_ctx = SimpleNamespace(manufacturer=None, model=None, confidence=0.0)
    assert sv._uns_gate_exhausted(state, uns_ctx) is True


def test_gate_not_exhausted_when_candidate_present(tmp_path):
    """Later discovery of a nameplate/model re-opens the grounded route —
    a real candidate must always be allowed to fire the confirmation."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d7")
    state["context"]["uns_gate_attempts"] = 5
    state["context"]["uns_identity_unknown"] = True
    uns_ctx = SimpleNamespace(manufacturer="Allen-Bradley", model="PowerFlex 525", confidence=0.6)
    assert sv._uns_gate_exhausted(state, uns_ctx) is False


def test_fallback_notice_emitted_once_and_invents_nothing(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d8")

    notice = sv._uns_gate_fallback_notice(state)
    assert "lower confidence" in notice
    assert "nameplate" in notice
    # Never invent identity: the notice must not name any manufacturer.
    assert "Allen-Bradley" not in notice and "PowerFlex" not in notice

    # Second call: already announced — silent.
    assert sv._uns_gate_fallback_notice(state) == ""


@pytest.mark.asyncio
async def test_yes_clears_fallback_state(tmp_path):
    """Confirming an asset resets the fallback bookkeeping for the session."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d9")
    state["state"] = "AWAITING_UNS_CONFIRMATION"
    state["context"]["pending_uns_confirm"] = {"candidate": "Siemens, SINAMICS G120"}
    state["context"]["uns_gate_attempts"] = 2
    state["context"]["uns_identity_unknown"] = True
    state["context"]["symptom_first_notice_sent"] = True
    sv._save_state("d9", state)

    result = await sv._handle_uns_confirmation_response("d9", "yes", state, "t")

    assert result is not None
    saved = sv._load_state("d9")
    ctx = saved["context"] or {}
    assert "uns_gate_attempts" not in ctx
    assert "uns_identity_unknown" not in ctx
    assert "symptom_first_notice_sent" not in ctx
    assert "uns_gate_last_candidate" not in ctx


@pytest.mark.asyncio
async def test_unknown_identity_progresses_not_loops(tmp_path):
    """The D2 narrative: gate fires once, technician says they can't identify
    the machine, and the NEXT turn is symptom-first — not the same demand."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d10")
    uns_ctx = SimpleNamespace(manufacturer=None, model=None, confidence=0.1)

    # Turn 1: gate fires (normal — identity is reasonably obtainable).
    await sv._handle_uns_confirmation_request("d10", "sensor acting up", state, uns_ctx, "t")
    saved = sv._load_state("d10")

    # Turn 2: technician cannot identify the equipment.
    result = await sv._handle_uns_confirmation_response(
        "d10", "no idea, there's no nameplate on it", saved, "t"
    )
    assert result is None
    saved = sv._load_state("d10")

    # Turn 3: the gate must NOT re-fire — symptom-first takes over, labeled.
    assert sv._uns_gate_exhausted(saved, uns_ctx) is True
    assert sv._uns_gate_fallback_notice(saved) != ""


def test_gate_exhausted_when_carried_candidate_was_already_offered(tmp_path):
    """Regression (owner review 2026-08-04): the resolver carries an earlier
    manufacturer forward with decaying confidence. If that candidate was
    already offered and never confirmed, re-offering it forever is the same
    deadlock — only NEW identity information re-opens the grounded route."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d11")
    state["context"]["uns_identity_unknown"] = True
    state["context"]["uns_gate_last_candidate"] = "Allen-Bradley, PowerFlex 525"
    uns_ctx = SimpleNamespace(manufacturer="Allen-Bradley", model="PowerFlex 525", confidence=0.35)
    assert sv._uns_gate_exhausted(state, uns_ctx) is True


def test_gate_reopens_for_genuinely_new_candidate(tmp_path):
    """The other direction: a DIFFERENT manufacturer than the one already
    offered is new information and must re-fire the confirmation."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d12")
    state["context"]["uns_identity_unknown"] = True
    state["context"]["uns_gate_last_candidate"] = "Allen-Bradley, PowerFlex 525"
    uns_ctx = SimpleNamespace(manufacturer="Siemens", model="SINAMICS G120", confidence=0.6)
    assert sv._uns_gate_exhausted(state, uns_ctx) is False


@pytest.mark.asyncio
async def test_request_records_last_offered_candidate(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d13")
    uns_ctx = SimpleNamespace(manufacturer="Allen-Bradley", model="PowerFlex 525", confidence=0.55)

    await sv._handle_uns_confirmation_request("d13", "it's stopped", state, uns_ctx, "t")
    saved = sv._load_state("d13")
    assert (saved["context"] or {}).get("uns_gate_last_candidate") == "Allen-Bradley, PowerFlex 525"


def test_asset_switch_carryover_clear_resets_fallback_state(tmp_path):
    """UNS-025: an asset switch must not carry the previous machine's
    exhaustion flags — a stale uns_identity_unknown would suppress the gate
    for the NEW asset without ever asking."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("d14")
    state["context"]["uns_gate_attempts"] = 2
    state["context"]["uns_identity_unknown"] = True
    state["context"]["symptom_first_notice_sent"] = True
    state["context"]["uns_gate_last_candidate"] = "Rockwell Automation"

    out = sv._clear_diagnostic_carryover("d14", state)

    ctx = out.get("context") or {}
    for key in (
        "uns_gate_attempts",
        "uns_identity_unknown",
        "symptom_first_notice_sent",
        "uns_gate_last_candidate",
    ):
        assert key not in ctx, key
