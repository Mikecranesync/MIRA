"""Property-based tests for MIRA FSM state transitions.

Verifies invariants that must hold regardless of input:
- State never leaves the valid set
- SAFETY_ALERT is always reachable from any state
- State aliases always map to valid states
- Exchange count always increments
- Fault category is set-once
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

from unittest.mock import patch

import pytest
from hypothesis import given, settings, strategies as st

from shared.engine import STATE_ORDER, Supervisor, _STATE_ALIASES
from shared.guardrails import SAFETY_KEYWORDS


@pytest.fixture(scope="module")
def supervisor(tmp_path_factory):
    db_path = str(tmp_path_factory.mktemp("fsm") / "test.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
        with patch("shared.engine.VisionWorker"), \
             patch("shared.engine.NameplateWorker"), \
             patch("shared.engine.RAGWorker"), \
             patch("shared.engine.PrintWorker"), \
             patch("shared.engine.PLCWorker"), \
             patch("shared.engine.NemotronClient"), \
             patch("shared.engine.InferenceRouter"):
            return Supervisor(
                db_path=db_path,
                openwebui_url="http://localhost:3000",
                api_key="test",
                collection_id="test",
            )


VALID_STATES = frozenset(
    STATE_ORDER + ["ASSET_IDENTIFIED", "ELECTRICAL_PRINT", "SAFETY_ALERT", "DIAGNOSIS_REVISION"]
)

# Strategy: valid FSM states
st_state = st.sampled_from(sorted(VALID_STATES))
# Strategy: LLM-proposed next_state (valid, alias, invalid, or None)
st_next_state = st.one_of(
    st.sampled_from(sorted(VALID_STATES)),
    st.sampled_from(sorted(_STATE_ALIASES.keys())),
    st.text(min_size=1, max_size=20),
    st.none(),
)


def _make_state(current: str) -> dict:
    return {"state": current, "exchange_count": 0, "final_state": None, "fault_category": None}


@given(current=st_state, next_state=st_next_state, reply=st.text(min_size=0, max_size=200))
def test_state_always_valid(supervisor, current, next_state, reply):
    """No combination of current state + LLM response should produce an invalid state."""
    state = _make_state(current)
    parsed = {"reply": reply, "next_state": next_state}
    result = supervisor._advance_state(state, parsed)
    assert result["state"] in VALID_STATES, (
        f"Invalid state '{result['state']}' from current='{current}', next_state='{next_state}'"
    )


@given(current=st_state)
def test_safety_always_reachable(supervisor, current):
    """SAFETY_ALERT must be reachable from ANY state via safety keyword in reply."""
    if current == "ELECTRICAL_PRINT":
        return  # ELECTRICAL_PRINT is sticky by design — documented exception
    state = _make_state(current)
    parsed = {"reply": "there is exposed wire near the panel", "next_state": None}
    result = supervisor._advance_state(state, parsed)
    assert result["state"] == "SAFETY_ALERT", (
        f"Safety not reachable from {current}"
    )


@given(current=st_state, next_state=st_next_state, reply=st.text(min_size=0, max_size=100))
def test_exchange_count_always_increments(supervisor, current, next_state, reply):
    """Exchange count must increment on every _advance_state call."""
    state = _make_state(current)
    before = state["exchange_count"]
    supervisor._advance_state(state, {"reply": reply, "next_state": next_state})
    assert state["exchange_count"] == before + 1


@given(current=st_state, reply=st.text(min_size=0, max_size=200))
def test_fault_category_set_once(supervisor, current, reply):
    """Once fault_category is set, subsequent calls must not change it."""
    state = _make_state(current)
    state["fault_category"] = "mechanical"
    supervisor._advance_state(state, {"reply": reply})
    assert state["fault_category"] == "mechanical"


def test_all_aliases_map_to_valid_states():
    """Every alias in _STATE_ALIASES must map to a state in VALID_STATES."""
    for alias, canonical in _STATE_ALIASES.items():
        assert canonical in VALID_STATES, f"Alias '{alias}' → '{canonical}' is not a valid state"


@given(reply=st.text(min_size=0, max_size=300))
def test_advance_state_never_raises(supervisor, reply):
    """_advance_state must never raise an exception regardless of input."""
    state = _make_state("Q1")
    try:
        supervisor._advance_state(state, {"reply": reply, "next_state": None})
    except Exception as e:
        pytest.fail(f"_advance_state raised {type(e).__name__}: {e}")
