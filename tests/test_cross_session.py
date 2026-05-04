"""Cross-session state integrity tests.

Verifies that separate chat_ids have fully isolated FSM state — one session's
state, asset, and context cannot bleed into another session.
All tests are offline (no network).
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import pytest
from unittest.mock import patch

from shared.engine import Supervisor


@pytest.fixture()
def sv(tmp_path):
    db_path = str(tmp_path / "cross.db")
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


def _seed_state(sv, chat_id: str, state: str, asset: str | None, turns: int):
    sv._save_state(chat_id, {
        "chat_id": chat_id,
        "state": state,
        "context": {"session_context": {"asset": asset or ""}},
        "asset_identified": asset,
        "fault_category": "electrical",
        "exchange_count": turns,
        "final_state": None,
    })


# ── Session isolation ─────────────────────────────────────────────────────────

def test_two_sessions_independent(sv):
    """State changes in session A must not affect session B."""
    _seed_state(sv, "user_A", "Q2", "GS10 VFD", 2)
    _seed_state(sv, "user_B", "IDLE", None, 0)

    a = sv._load_state("user_A")
    b = sv._load_state("user_B")

    assert a["state"] == "Q2"
    assert b["state"] == "IDLE"
    assert a["asset_identified"] == "GS10 VFD"
    assert b["asset_identified"] is None


def test_reset_one_does_not_affect_other(sv):
    """Resetting session A must leave session B untouched."""
    _seed_state(sv, "user_C", "DIAGNOSIS", "SICK sensor", 4)
    _seed_state(sv, "user_D", "Q1", "Motor", 1)

    sv.reset("user_C")

    c = sv._load_state("user_C")
    d = sv._load_state("user_D")

    assert c["state"] == "IDLE"
    assert d["state"] == "Q1"
    assert d["asset_identified"] == "Motor"


def test_many_sessions_isolated(sv):
    """100 independent sessions must all maintain their own state."""
    for i in range(100):
        _seed_state(sv, f"user_{i}", "Q1" if i % 2 == 0 else "Q2", f"asset_{i}", i)

    for i in range(100):
        state = sv._load_state(f"user_{i}")
        expected_fsm = "Q1" if i % 2 == 0 else "Q2"
        assert state["state"] == expected_fsm, f"user_{i} state mismatch"
        assert state["asset_identified"] == f"asset_{i}"
        assert state["exchange_count"] == i


def test_session_not_found_returns_idle(sv):
    """Loading a non-existent session must return a fresh IDLE state."""
    state = sv._load_state("completely_new_user_xyz")
    assert state["state"] == "IDLE"
    assert state["exchange_count"] == 0
    assert state["asset_identified"] is None


def test_exchange_count_not_shared(sv):
    """Exchange count from session A must never influence session B."""
    _seed_state(sv, "counter_A", "Q3", "VFD", 50)
    _seed_state(sv, "counter_B", "Q1", "Pump", 0)

    a = sv._load_state("counter_A")
    b = sv._load_state("counter_B")

    assert a["exchange_count"] == 50
    assert b["exchange_count"] == 0


# ── Context isolation ─────────────────────────────────────────────────────────

def test_session_context_isolated(sv):
    """session_context dict of two sessions must not share references."""
    _seed_state(sv, "ctx_A", "Q2", "GS10", 2)
    _seed_state(sv, "ctx_B", "Q1", "Motor", 1)

    a = sv._load_state("ctx_A")
    b = sv._load_state("ctx_B")

    # Mutate A's context in memory — should not affect B
    a["context"]["session_context"]["injected"] = "hacked"
    b_fresh = sv._load_state("ctx_B")
    assert "injected" not in b_fresh["context"].get("session_context", {})


# ── Multi-platform tenant isolation ──────────────────────────────────────────

def test_platform_prefixed_chat_ids_isolated(sv):
    """Telegram and OpenWebUI sessions for same logical user must be separate."""
    tg_id = "telegram_12345"
    ow_id = "openwebui_12345"

    _seed_state(sv, tg_id, "DIAGNOSIS", "GS10 VFD", 6)
    _seed_state(sv, ow_id, "IDLE", None, 0)

    tg = sv._load_state(tg_id)
    ow = sv._load_state(ow_id)

    assert tg["state"] == "DIAGNOSIS"
    assert ow["state"] == "IDLE"
