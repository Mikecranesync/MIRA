"""D2 symptom-first fallback — full Supervisor.process() path (offline).

The unit tests in test_uns_confirmation_gate.py pin the helper seams; owner
review (2026-08-04) required proof through the REAL turn path: the notice
reaches the technician's reply, state persists across turns, the RAG path
continues, citation compliance (enforce ON by default) accepts the final
response, and a genuinely new identity restores the grounded route.

Engine LLM surfaces are stubbed (router intent + RAG worker reply); everything
between them — gate call site, fallthrough consumption, honest-prefix
formatting, citation compliance, state persistence — is the production code.
"""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import AsyncMock, patch

import pytest

REPO_ROOT = Path(__file__).parent.parent
MIRA_BOTS = REPO_ROOT / "mira-bots"
if str(MIRA_BOTS) not in sys.path:
    sys.path.insert(0, str(MIRA_BOTS))

RAG_REPLY = (
    '{"reply": "Check the sensor cable continuity at the junction box.",'
    ' "next_state": "Q1", "options": [], "confidence": "MEDIUM"}'
)


def _make_sv(db_path: str):
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
            from shared.engine import Supervisor

            sv = Supervisor(
                db_path=db_path,
                openwebui_url="http://mock",
                api_key="key",
                collection_id="coll",
            )

    async def fake_rag_process(message, state, *args, **kwargs):
        return RAG_REPLY

    sv.rag.process = fake_rag_process  # type: ignore[method-assign]
    return sv


ROUTED = {"intent": "diagnose_equipment", "confidence": 0.9, "reasoning": "test"}


@pytest.mark.asyncio
async def test_symptom_first_full_turn_path(tmp_path):
    sv = _make_sv(str(tmp_path / "e2e.db"))
    chat = "e2e-1"

    with patch("shared.engine.route_intent", new=AsyncMock(return_value=ROUTED)):
        # Turn 1 — vendor mentioned without model: the gate fires (identity is
        # reasonably obtainable; first ask unchanged).
        r1 = await sv.process(chat, "it's some Allen-Bradley drive, fault F004")
        assert "Before I diagnose" in r1 or "confirm the equipment" in r1

        # Turn 2 — technician cannot identify the machine. The SAME turn must
        # fall through into the diagnostic flow: labeled notice + RAG reply.
        r2 = await sv.process(chat, "no idea, there's no nameplate on it")
        assert "No exact model identified" in r2, r2  # notice reached the reply
        assert "lower confidence" in r2
        assert "Check the sensor cable continuity" in r2  # RAG path continued
        assert "Before I diagnose" not in r2  # the demand did NOT repeat

        saved = sv._load_state(chat)
        ctx = saved.get("context") or {}
        assert ctx.get("uns_identity_unknown") is True  # persisted through the turn
        assert ctx.get("symptom_first_notice_sent") is True

        # Turn 3 — still no identity: no repeated notice, no repeated demand.
        r3 = await sv.process(chat, "it just hums when the belt moves")
        assert "No exact model identified" not in r3  # notice is one-time
        assert "Before I diagnose" not in r3
        assert "Check the sensor cable continuity" in r3

        # The gate only ever fires from IDLE (pre-existing rule: never
        # interrupt mid-FSM Q1/Q2/Q3 — mid-flow identity adoption has its own
        # paths, and resolver confidence >= 0.7 auto-adopts the asset before
        # the gate entirely). Return the session to IDLE, KEEPING the
        # exhaustion flags, to test the property that matters: an exhausted
        # session with genuinely NEW identity information re-opens the
        # grounded confirmation.
        saved = sv._load_state(chat)
        saved["state"] = "IDLE"
        # A session genuinely back in IDLE has fresh question-round counters;
        # without this, the Q-trap breaker (q_rounds>=3 → force DIAGNOSIS)
        # fires before the gate region and masks what we're testing.
        (saved.get("context") or {})["q_rounds"] = 0
        sv._save_state(chat, saved)

        # Turn 4 — a NEW candidate (different vendor, sub-0.7 confidence so
        # the auto-adopt path stays out of the way) re-fires the confirmation
        # despite exhaustion.
        r4 = await sv.process(chat, "wait, it might be a Siemens drive")
        assert "confirm the equipment" in r4, r4
        assert "Siemens" in r4

        # Turn 5 — confirmation upgrades the session and resets bookkeeping.
        r5 = await sv.process(chat, "yes")
        assert "Got it" in r5

    saved = sv._load_state(chat)
    ctx = saved.get("context") or {}
    assert saved.get("asset_identified")
    assert "uns_identity_unknown" not in ctx
    assert "uns_gate_attempts" not in ctx
    assert "symptom_first_notice_sent" not in ctx
