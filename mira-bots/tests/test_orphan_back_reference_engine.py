"""#4015 item 4 — engine lane: a back-reference on a chat where MIRA has not
spoken is answered with a clarifying question, before (and without) the LLM
router. The same words after a real assistant turn keep the normal routing.
"""

from __future__ import annotations

import sys
from unittest.mock import AsyncMock, patch

import pytest

sys.path.insert(0, "mira-bots")

from shared.engine import Supervisor  # noqa: E402
from shared.guardrails import ORPHAN_BACK_REFERENCE_REPLY  # noqa: E402

MSG = "you said to check the wiring — which wire"


@pytest.fixture
def supervisor(tmp_path):
    db_path = str(tmp_path / "orphan.db")
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
                api_key="test-key",
                collection_id="test-collection",
            )


@pytest.mark.asyncio
async def test_fresh_chat_back_reference_asks_and_never_routes(supervisor):
    router = AsyncMock(side_effect=AssertionError("router must not run"))
    with patch("shared.engine.route_intent", router):
        result = await supervisor.process_full("fresh-1", MSG)
    assert result["reply"].startswith(ORPHAN_BACK_REFERENCE_REPLY)
    assert "I don't have specific documentation" not in result["reply"]  # no H4 footer
    router.assert_not_called()
    # Recorded, so the next turn has the question in history.
    history = supervisor._load_state("fresh-1")["context"]["history"]
    assert history[-1] == {"role": "assistant", "content": ORPHAN_BACK_REFERENCE_REPLY}


@pytest.mark.asyncio
async def test_after_a_real_assistant_turn_the_lane_stands_down(supervisor):
    state = supervisor._load_state("warm-1")
    ctx = state.get("context") or {}
    ctx["history"] = [
        {"role": "user", "content": "conveyor stopped"},
        {"role": "assistant", "content": "Check the wiring at the motor terminal box."},
    ]
    state["context"] = ctx
    supervisor._save_state("warm-1", state)
    router = AsyncMock(
        return_value={"intent": "general_question", "confidence": 0.9, "reasoning": "t"}
    )
    with (
        patch("shared.engine.route_intent", router),
        patch.object(
            supervisor,
            "_handle_general_question",
            AsyncMock(return_value={"reply": "ok", "dispatch_kind": ""}),
        ),
    ):
        await supervisor.process_full("warm-1", MSG)
    router.assert_called_once()
