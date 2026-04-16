"""Unit tests for the Q-trap guard in _advance_state().

Verifies that after _MAX_Q_ROUNDS consecutive Q-state turns the FSM forces
a commit to DIAGNOSIS regardless of what the LLM proposes.

Calls _advance_state() directly via a minimal stub — no SQLite, no LLM calls.
"""

import os
import sys
import types
import unittest.mock

# Minimal env vars to satisfy module-level imports in engine.py
os.environ.setdefault("MIRA_MAX_Q_ROUNDS", "3")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_q_trap_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Stub out heavy optional dependencies so engine.py can be imported without
# the full venv (PIL, telegram, slack_sdk, etc.).
for _mod in (
    "PIL", "PIL.Image",
    "telegram", "telegram.ext",
    "slack_sdk", "slack_sdk.web.async_client", "slack_sdk.errors",
    "python_telegram_bot",
):
    sys.modules.setdefault(_mod, unittest.mock.MagicMock())


def _make_state(fsm_state: str, q_rounds: int = 0) -> dict:
    ctx: dict = {"session_context": {}}
    if q_rounds:
        ctx["q_rounds"] = q_rounds
    return {
        "chat_id": "test-chat",
        "state": fsm_state,
        "context": ctx,
        "asset_identified": None,
        "fault_category": None,
        "exchange_count": 0,
        "final_state": None,
    }


def _parsed(next_state: str, reply: str = "Have you checked the motor?") -> dict:
    return {"next_state": next_state, "reply": reply, "options": []}


def _get_advance_state():
    """Return a bound _advance_state method via a minimal Supervisor stub."""
    import functools
    from shared import engine as eng

    stub = types.SimpleNamespace(
        _VALID_STATES=eng.Supervisor._VALID_STATES,
    )
    return functools.partial(eng.Supervisor._advance_state, stub)


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_q_rounds_increments_when_stuck_in_q_states():
    advance = _get_advance_state()
    state = _make_state("Q2")
    state = advance(state, _parsed("Q3"))
    assert state["context"]["q_rounds"] == 1
    assert state["state"] == "Q3"


def test_q_trap_forces_diagnosis_at_max_rounds():
    """After _MAX_Q_ROUNDS consecutive Q-state turns, FSM must commit to DIAGNOSIS."""
    advance = _get_advance_state()
    state = _make_state("Q3", q_rounds=2)  # already at MAX_Q_ROUNDS - 1
    state = advance(state, _parsed("Q3"))
    assert state["state"] == "DIAGNOSIS", (
        f"Expected DIAGNOSIS after Q-trap ceiling, got {state['state']!r}"
    )
    assert state["context"].get("q_rounds", 0) == 0, "q_rounds must reset after commit"


def test_q_rounds_resets_on_leaving_q_states():
    advance = _get_advance_state()
    state = _make_state("Q2", q_rounds=1)
    state = advance(state, _parsed("DIAGNOSIS"))
    assert state["state"] == "DIAGNOSIS"
    assert "q_rounds" not in state["context"]


def test_q_rounds_not_touched_in_non_q_states():
    advance = _get_advance_state()
    state = _make_state("DIAGNOSIS")
    state = advance(state, _parsed("FIX_STEP"))
    assert state["state"] == "FIX_STEP"
    assert "q_rounds" not in state["context"]


def test_q_trap_does_not_fire_before_ceiling():
    advance = _get_advance_state()
    # Two Q-turns in a row — should NOT commit yet (ceiling is 3)
    state = _make_state("Q1")
    state = advance(state, _parsed("Q2"))
    assert state["state"] == "Q2"
    assert state["context"].get("q_rounds") == 1

    state = advance(state, _parsed("Q3"))
    assert state["state"] == "Q3"
    assert state["context"].get("q_rounds") == 2


def test_safety_still_overrides_q_trap():
    """Safety short-circuit must still fire even when q_rounds is at ceiling."""
    advance = _get_advance_state()
    state = _make_state("Q3", q_rounds=2)
    state = advance(state, _parsed("Q3", reply="visible smoke from the motor"))
    assert state["state"] == "SAFETY_ALERT"
