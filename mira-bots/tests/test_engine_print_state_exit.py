"""Regression: a stale ELECTRICAL_PRINT session must not trap a new diagnostic query.

Incident 2026-07-26: after PrintSense photo testing left a chat in
``ELECTRICAL_PRINT`` state, every subsequent *text* message was force-routed
into ``_handle_electrical_print_followup`` regardless of the turn's intent.
Downstream this failed two ways:

* **prod** — the print/vision path used the slow Together ``MiniMaxAI/MiniMax-M3``
  vision model (~77s), which blew past the bot's 30s ``PROCESS_TIMEOUT`` →
  silent bot.
* **staging** — the print worker endpoint was ``disabled://`` → httpx
  ``unsupported protocol`` → ``PRINT_WORKER_ERROR`` → generic-error + KB-gap.

Root cause: the dispatch guard fired on ``state == "ELECTRICAL_PRINT"`` alone,
with no check on the new turn's router intent. A user who has clearly moved on
to a new diagnostic topic (``diagnose_equipment``) — or is starting over
(``greeting_or_chitchat``) — must break out of the print state and fall
through to normal routing, not be trapped in the print handler.
"""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, "mira-bots")

from shared.engine import Supervisor  # noqa: E402


@pytest.fixture
def supervisor(tmp_path):
    """Supervisor with all workers mocked, DST OFF (exercise the legacy router guard)."""
    db_path = str(tmp_path / "print_exit.db")
    env = {"INFERENCE_BACKEND": "local"}  # MIRA_USE_DST unset — legacy route_intent path
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


def _seed_print_state(sup: Supervisor, chat_id: str) -> None:
    """Simulate a chat left in ELECTRICAL_PRINT after a prior schematic photo."""
    state = sup._load_state(chat_id)
    state["state"] = "ELECTRICAL_PRINT"
    state["asset_identified"] = "PowerFlex 525"
    state["exchange_count"] = 2
    state["context"] = {
        "history": [],
        "last_print_vision": {"classification": "ELECTRICAL_PRINT"},
    }
    sup._save_state(chat_id, state)


def _router(intent: str) -> AsyncMock:
    return AsyncMock(return_value={"intent": intent, "confidence": 0.9, "reasoning": intent})


@pytest.mark.asyncio
async def test_new_diagnose_query_exits_print_state(supervisor):
    """A fresh diagnose_equipment turn must NOT be trapped in the print handler."""
    chat_id = "print-trap-diagnose"
    _seed_print_state(supervisor, chat_id)

    print_spy = AsyncMock(
        return_value=Supervisor._make_result("PRINT", "none", "t", "ELECTRICAL_PRINT")
    )
    # Whatever non-print path handles the turn, keep it cheap + deterministic.
    supervisor.rag.process = AsyncMock(
        return_value={
            "reply": "F004 is a DC bus undervoltage fault.",
            "next_state": "Q1",
            "options": [],
        }
    )

    with patch("shared.engine.route_intent", new=_router("diagnose_equipment")):
        with patch.object(supervisor, "_handle_electrical_print_followup", print_spy):
            result = await supervisor.process_full(
                chat_id=chat_id, message="PowerFlex 525 showing F004"
            )

    # The print follow-up handler must NOT run for a new diagnostic query.
    print_spy.assert_not_awaited()
    # State must have exited ELECTRICAL_PRINT (no longer trapped).
    assert supervisor._load_state(chat_id)["state"] != "ELECTRICAL_PRINT"
    assert result["reply"]


@pytest.mark.asyncio
async def test_greeting_exits_print_state(supervisor):
    """A 'start over' greeting must also break out of a stale print state."""
    chat_id = "print-trap-greet"
    _seed_print_state(supervisor, chat_id)

    print_spy = AsyncMock(
        return_value=Supervisor._make_result("PRINT", "none", "t", "ELECTRICAL_PRINT")
    )
    supervisor.rag.process = AsyncMock(
        return_value={
            "reply": "Hi — what can I help diagnose?",
            "next_state": "IDLE",
            "options": [],
        }
    )

    with patch("shared.engine.route_intent", new=_router("greeting_or_chitchat")):
        with patch.object(supervisor, "_handle_electrical_print_followup", print_spy):
            await supervisor.process_full(chat_id=chat_id, message="hey, start over")

    print_spy.assert_not_awaited()
    assert supervisor._load_state(chat_id)["state"] != "ELECTRICAL_PRINT"


@pytest.mark.asyncio
async def test_genuine_print_followup_stays_in_print_state(supervisor):
    """A genuine question ABOUT the print must still use the print handler."""
    chat_id = "print-followup"
    _seed_print_state(supervisor, chat_id)

    print_spy = AsyncMock(
        return_value=Supervisor._make_result("PRINT ANSWER", "medium", "t", "ELECTRICAL_PRINT")
    )

    with patch("shared.engine.route_intent", new=_router("answer_question")):
        with patch.object(supervisor, "_handle_electrical_print_followup", print_spy):
            result = await supervisor.process_full(
                chat_id=chat_id, message="what does terminal 3 connect to?"
            )

    # A print follow-up (not a new topic) must stay in the print handler.
    print_spy.assert_awaited_once()
    assert result["reply"]
