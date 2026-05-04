"""State persistence tests.

Verifies that FSM state survives Supervisor restart (SQLite reload),
that exchange_count is durable, and that history is persisted correctly.
All tests are offline (no network).
"""

from __future__ import annotations

import sys

sys.path.insert(0, "mira-bots")

import json
import pytest
from unittest.mock import patch

from shared.engine import Supervisor


def _make_sv(db_path: str) -> Supervisor:
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


def _seed(sv, chat_id, state_name, asset, turns, history=None):
    ctx = {"session_context": {}, "history": history or []}
    sv._save_state(chat_id, {
        "chat_id": chat_id,
        "state": state_name,
        "context": ctx,
        "asset_identified": asset,
        "fault_category": "electrical",
        "exchange_count": turns,
        "final_state": None,
    })


# ── Basic persistence ─────────────────────────────────────────────────────────

def test_state_survives_restart(tmp_path):
    """FSM state written by one Supervisor instance must be readable by the next."""
    db_path = str(tmp_path / "persist.db")

    sv1 = _make_sv(db_path)
    _seed(sv1, "persist_user", "DIAGNOSIS", "GS10 VFD", 5)

    # Simulate restart by creating a new instance pointing at same DB
    sv2 = _make_sv(db_path)
    state = sv2._load_state("persist_user")

    assert state["state"] == "DIAGNOSIS"
    assert state["asset_identified"] == "GS10 VFD"
    assert state["exchange_count"] == 5


def test_exchange_count_durable(tmp_path):
    """Exchange count must persist exactly across restarts."""
    db_path = str(tmp_path / "count.db")

    sv1 = _make_sv(db_path)
    _seed(sv1, "count_user", "Q3", "Motor", 42)

    sv2 = _make_sv(db_path)
    assert sv2._load_state("count_user")["exchange_count"] == 42


def test_history_persists(tmp_path):
    """Conversation history must survive Supervisor restart."""
    db_path = str(tmp_path / "history.db")
    history = [
        {"role": "user", "content": "VFD showing E.OC.3"},
        {"role": "assistant", "content": "Check motor current draw."},
    ]

    sv1 = _make_sv(db_path)
    _seed(sv1, "hist_user", "Q1", "GS10", 1, history=history)

    sv2 = _make_sv(db_path)
    state = sv2._load_state("hist_user")
    loaded_history = state["context"].get("history", [])

    assert len(loaded_history) == 2
    assert loaded_history[0]["content"] == "VFD showing E.OC.3"
    assert loaded_history[1]["content"] == "Check motor current draw."


def test_asset_identified_durable(tmp_path):
    """asset_identified field must persist correctly."""
    db_path = str(tmp_path / "asset.db")

    sv1 = _make_sv(db_path)
    _seed(sv1, "asset_user", "ASSET_IDENTIFIED", "SICK WL27-3P3402S13", 1)

    sv2 = _make_sv(db_path)
    state = sv2._load_state("asset_user")
    assert state["asset_identified"] == "SICK WL27-3P3402S13"


# ── Reset durability ──────────────────────────────────────────────────────────

def test_reset_is_durable(tmp_path):
    """After reset(), a new Supervisor must see the session as IDLE."""
    db_path = str(tmp_path / "reset.db")

    sv1 = _make_sv(db_path)
    _seed(sv1, "reset_user", "FIX_STEP", "GS10", 8)
    sv1.reset("reset_user")

    sv2 = _make_sv(db_path)
    state = sv2._load_state("reset_user")
    assert state["state"] == "IDLE"
    assert state["exchange_count"] == 0


# ── Multiple sessions persisted and reloaded ─────────────────────────────────

def test_multiple_sessions_all_persist(tmp_path):
    """10 sessions written by sv1 must all be readable by sv2 correctly."""
    db_path = str(tmp_path / "multi.db")

    sv1 = _make_sv(db_path)
    sessions = {
        f"session_{i}": ("Q1" if i < 5 else "DIAGNOSIS", f"asset_{i}", i * 2)
        for i in range(10)
    }
    for chat_id, (state_name, asset, turns) in sessions.items():
        _seed(sv1, chat_id, state_name, asset, turns)

    sv2 = _make_sv(db_path)
    for chat_id, (expected_state, expected_asset, expected_turns) in sessions.items():
        loaded = sv2._load_state(chat_id)
        assert loaded["state"] == expected_state, f"{chat_id}: state mismatch"
        assert loaded["asset_identified"] == expected_asset
        assert loaded["exchange_count"] == expected_turns


# ── Context JSON roundtrip ────────────────────────────────────────────────────

def test_context_json_roundtrip(tmp_path):
    """Complex nested context dict must survive JSON serialization roundtrip."""
    db_path = str(tmp_path / "ctx.db")
    complex_ctx = {
        "session_context": {
            "asset": "GS10 VFD",
            "vendor": "AutomationDirect",
            "last_options": ["Check motor wiring", "Inspect VFD cooling"],
            "kb_hit": True,
            "metadata": {"chunks": 3, "score": 0.87},
        },
        "history": [
            {"role": "user", "content": "Motor tripped"},
            {"role": "assistant", "content": "Check current draw."},
        ],
    }

    sv1 = _make_sv(db_path)
    sv1._save_state("ctx_user", {
        "chat_id": "ctx_user",
        "state": "Q2",
        "context": complex_ctx,
        "asset_identified": "GS10 VFD",
        "fault_category": None,
        "exchange_count": 1,
        "final_state": None,
    })

    sv2 = _make_sv(db_path)
    state = sv2._load_state("ctx_user")
    sc = state["context"]["session_context"]

    assert sc["vendor"] == "AutomationDirect"
    assert sc["last_options"] == ["Check motor wiring", "Inspect VFD cooling"]
    assert sc["metadata"]["score"] == 0.87


# ── updated_at is set on save ─────────────────────────────────────────────────

def test_updated_at_set_on_save(tmp_path):
    """Saved state must have a non-null updated_at timestamp."""
    db_path = str(tmp_path / "ts.db")
    sv = _make_sv(db_path)
    _seed(sv, "ts_user", "Q1", None, 1)
    state = sv._load_state("ts_user")
    assert state.get("updated_at") is not None
    assert len(state["updated_at"]) > 0
