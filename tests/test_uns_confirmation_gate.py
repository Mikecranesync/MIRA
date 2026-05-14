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

    # State must persist the pending block for the next turn.
    saved = sv._load_state("u1")
    pending = (saved.get("context") or {}).get("pending_uns_confirm")
    assert pending == {"candidate": "Allen-Bradley, PowerFlex 525"}


@pytest.mark.asyncio
async def test_request_with_no_candidate_asks_for_make_and_model(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u2")
    uns_ctx = SimpleNamespace(manufacturer=None, model=None, confidence=0.0)

    result = await sv._handle_uns_confirmation_request("u2", "fault", state, uns_ctx, "trace-2")

    assert "manufacturer and model" in result["reply"]
    saved = sv._load_state("u2")
    pending = (saved.get("context") or {}).get("pending_uns_confirm")
    assert pending == {"candidate": None}


# ── Confirmation consumed ──────────────────────────────────────────────────


@pytest.mark.asyncio
async def test_response_yes_sets_asset_and_clears_pending(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u3")
    state["context"]["pending_uns_confirm"] = {"candidate": "Siemens, SINAMICS G120"}
    sv._save_state("u3", state)

    result = await sv._handle_uns_confirmation_response("u3", "yes", state, "trace-3")

    assert result is not None
    assert "Siemens" in result["reply"]
    assert result["dispatch_kind"] == "uns_confirm_yes"

    saved = sv._load_state("u3")
    assert saved["asset_identified"] == "Siemens, SINAMICS G120"
    assert "pending_uns_confirm" not in (saved.get("context") or {})


@pytest.mark.asyncio
async def test_response_no_clears_pending_and_reprompts(tmp_path):
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u4")
    state["context"]["pending_uns_confirm"] = {"candidate": "Mitsubishi, FR-D700"}
    sv._save_state("u4", state)

    result = await sv._handle_uns_confirmation_response("u4", "no", state, "trace-4")

    assert result is not None
    assert "tell me the correct" in result["reply"].lower()
    assert result["dispatch_kind"] == "uns_confirm_no"

    saved = sv._load_state("u4")
    assert saved["asset_identified"] is None  # NOT set on "no"
    assert "pending_uns_confirm" not in (saved.get("context") or {})


@pytest.mark.asyncio
async def test_response_freeform_text_falls_through(tmp_path):
    """Anything that isn't yes/no signals 'I'll tell you what it is' — fall through
    so the normal flow can re-run the UNS resolver on the new message."""
    sv = _make_sv(str(tmp_path / "test.db"))
    state = _fresh_state("u5")
    state["context"]["pending_uns_confirm"] = {"candidate": "Bad Guess Inc"}
    sv._save_state("u5", state)

    result = await sv._handle_uns_confirmation_response(
        "u5", "Allen-Bradley PowerFlex 525", state, "trace-5"
    )

    assert result is None  # caller should continue normal routing

    saved = sv._load_state("u5")
    assert "pending_uns_confirm" not in (saved.get("context") or {})


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
