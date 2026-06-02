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

    result = await sv._handle_uns_confirmation_request("u1", "why is it stopped", state, uns_ctx, "trace-1")

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


# ── Gate firing conditions (_should_fire_uns_gate) ─────────────────────────


def test_gate_fires_on_diagnose_idle_no_asset(tmp_path):
    """Primary case: diagnostic question in IDLE with no confirmed equipment."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u")
    assert sv._should_fire_uns_gate("diagnose_equipment", state, "why is conveyor stopped", {}) is True


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
            sv._should_fire_uns_gate("diagnose_equipment", state, "clarifying question", {}) is False
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


# ── Direct-connection UNS certification (W3-E / Phase 6) ──────────────────
# Rule ref: .claude/rules/direct-connection-uns-certified.md
# Golden cases: tests/golden_uns_direct_connection.csv


def test_gate_does_not_fire_when_uns_source_direct_connection(tmp_path):
    """Golden case (a): Ignition turn with uns_source=direct_connection pre-seeded.

    _should_fire_uns_gate must return False — the connection already certified
    the UNS path; no confirmation card should be emitted.
    """
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("ignition:tenant1:cv_101")
    # Simulate what ignition_chat.py / seed_direct_connection() writes.
    state["context"]["uns_source"] = "direct_connection"
    state["context"]["uns_certified_surface"] = "ignition_chat"
    state["context"]["uns_certified_path"] = "enterprise.customer.site.garage.area.demo_cell.equipment.cv_101"

    result = sv._should_fire_uns_gate(
        "diagnose_equipment",
        state,
        "why is conveyor CV-101 stopped?",
        {},
    )
    assert result is False, (
        "Gate must NOT fire when uns_source==direct_connection — "
        "the Ignition connection already certified the UNS path."
    )


def test_gate_does_not_fire_direct_connection_even_with_no_asset_identified(tmp_path):
    """Regression guard: direct_connection skips the gate even when asset_identified
    is still None (seed hasn't set it) — the source flag is the authority, not
    asset_identified.
    """
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("ignition:tenant1:cv_101")
    assert state.get("asset_identified") is None  # precondition: asset not yet set
    state["context"]["uns_source"] = "direct_connection"

    assert sv._should_fire_uns_gate("diagnose_equipment", state, "VFD fault?", {}) is False


def test_seed_direct_connection_persists_source_key(tmp_path):
    """seed_direct_connection() must write uns_source=direct_connection to SQLite
    so it survives _load_state() and is visible to _should_fire_uns_gate.
    """
    sv = _make_sv(str(tmp_path / "test.db"))
    chat_id = "ignition:t:asset1"

    sv.seed_direct_connection(
        chat_id,
        uns_path="enterprise.customer.site.garage.area.demo_cell.equipment.asset1",
        surface="ignition_chat",
    )

    saved = sv._load_state(chat_id)
    ctx = saved.get("context") or {}
    assert ctx.get("uns_source") == "direct_connection"
    assert ctx.get("uns_certified_surface") == "ignition_chat"
    assert "enterprise" in (ctx.get("uns_certified_path") or "")


def test_seed_direct_connection_source_survives_uns_context_overwrite(tmp_path):
    """Regression guard against the L1182 clobber path.

    The populate site at process_full L1182 does:
        _ctx_for_uns["uns_context"] = uns_ctx.as_dict()
    This overwrites the 'uns_context' sub-key only — NOT 'uns_source'.
    Simulate that to confirm sibling-key survival.
    """
    sv = _make_sv(str(tmp_path / "test.db"))
    chat_id = "ignition:t:asset2"
    sv.seed_direct_connection(chat_id, uns_path="enterprise.demo.site.s.area.a.equipment.e")

    # Simulate L1175–1183 overwriting uns_context (but not uns_source).
    state = sv._load_state(chat_id)
    ctx = state.get("context") or {}
    ctx["uns_context"] = {"manufacturer": "Allen-Bradley", "confidence": 0.7}
    state["context"] = ctx
    sv._save_state(chat_id, state)

    # uns_source must still be intact.
    reloaded = sv._load_state(chat_id)
    assert (reloaded.get("context") or {}).get("uns_source") == "direct_connection"


def test_gate_still_fires_on_slack_chat_without_direct_connection(tmp_path):
    """Golden case (c): regression guard — chat-surface turns without direct_connection
    seeding must STILL trigger the confirmation gate.
    """
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("slack:user:u1")
    # Slack: no uns_source key, no asset_identified — gate must fire.
    assert state.get("context", {}).get("uns_source") is None  # precondition

    result = sv._should_fire_uns_gate(
        "diagnose_equipment",
        state,
        "PowerFlex 525 is throwing F0004 — why?",
        {},
    )
    assert result is True, "Gate must still fire for chat-surface turns without direct_connection."


def test_seed_direct_connection_stores_confidence_band(tmp_path):
    """Rule requires confidence='certified' alongside source='direct_connection'."""
    sv = _make_sv(str(tmp_path / "test.db"))
    chat_id = "ignition:t:asset3"
    sv.seed_direct_connection(chat_id, uns_path=None, surface="ignition_chat")

    saved = sv._load_state(chat_id)
    ctx = saved.get("context") or {}
    assert ctx.get("uns_confidence_band") == "certified"


# ── Gap A: uns_path_from_asset_context (shared.uns_resolver, shared.uns_paths) ──
# The canonical path builder lives in uns_resolver so it's importable from
# inside the pipeline container without fastapi or mira_crawler dependencies.


def test_uns_path_from_asset_context_full_payload():
    """Full asset_context → correct ISA-95 plant-namespace UNS path."""
    from shared.uns_resolver import uns_path_from_asset_context  # noqa: PLC0415

    result = uns_path_from_asset_context({
        "company": "Acme Corp",
        "site": "Garage Plant",
        "area": "Demo Cell",
        "line": "Line 1",
        "equipment": "CV-101",
    })
    assert result is not None
    assert result.startswith("enterprise.")
    assert "garage_plant" in result
    assert "demo_cell" in result
    assert "cv_101" in result
    assert "line_1" in result
    # Structural markers must use UNS path grammar (slug, not free text)
    assert " " not in result
    assert "Acme" not in result  # must be slugged


def test_uns_path_from_asset_context_minimal_payload():
    """Minimal asset_context with just equipment → returns a path without crashing."""
    from shared.uns_resolver import uns_path_from_asset_context  # noqa: PLC0415

    result = uns_path_from_asset_context({"equipment": "pump_01"})
    assert result is not None
    assert "pump_01" in result


def test_uns_path_from_asset_context_empty_returns_none():
    """Empty asset_context → None (not a valid UNS identifier)."""
    from shared.uns_resolver import uns_path_from_asset_context  # noqa: PLC0415

    assert uns_path_from_asset_context({}) is None
    assert uns_path_from_asset_context(None) is None


def test_uns_path_from_asset_context_no_mira_crawler_import():
    """uns_path_from_asset_context must not import mira_crawler — it's not on
    the pipeline container path. The shared.uns_paths module (dep-free copy) is
    the only acceptable implementation.
    """
    import sys as _sys

    # Ensure mira_crawler is not accidentally loaded
    assert "mira_crawler" not in _sys.modules, (
        "mira_crawler must not be imported — it's not available in the pipeline container. "
        "Use shared.uns_paths instead."
    )


# ── FSM-state validity ─────────────────────────────────────────────────────


def test_awaiting_uns_confirmation_is_valid_fsm_state():
    """The side state added for the gate must be in VALID_STATES so transition
    validators in `_advance_state` accept it. Guards against the LLM emitting it
    as a `next_state` value in a future prompt update."""
    from shared.fsm import VALID_STATES

    assert "AWAITING_UNS_CONFIRMATION" in VALID_STATES
