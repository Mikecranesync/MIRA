"""Tests for the deterministic drive-pack fast-path in Supervisor.process_full().

The fast-path answers a text question that names a drive MIRA has a pack for
(e.g. "what does CE10 mean on my gs10") from shared.drive_packs.answer_question
BEFORE the generic router/RAG path — grounded ONLY in the pack, never a guess.

Three non-negotiable guardrails under test here:
  1. Placement AFTER the safety short-circuit — safety always wins, even when
     the message also names a drive MIRA has a pack for.
  2. Inline ``[Source: doc p.X]`` citations + the "drive_pack" trusted dispatch
     kind — so neither the runtime quality gate nor the H4 citation/KB-gap
     enforcer second-guesses or overwrites a pack-grounded reply.
  3. Static-vs-live label — never conflate a static pack answer with a live
     telemetry read.

All four tests drive the OUTER ``Supervisor.process()`` (not just
``process_full()``) so the full post-processing chain (quality gate, citation
rewrite, H4 enforcer) runs for real. The LLM router (``route_intent``) and the
worker fleet are mocked at construction the same way
``tests/test_engine_dst_integration.py`` and ``tests/test_engine_general_question.py``
do it — no network, no real LLM call.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

sys.path.insert(0, "mira-bots")

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")

from shared.drive_packs import answer_question as _real_answer_question  # noqa: E402
from shared.engine import Supervisor  # noqa: E402


@pytest.fixture
def supervisor(tmp_path):
    """Supervisor with the worker fleet + router mocked — no network."""
    db_path = str(tmp_path / "drive_pack_fastpath.db")
    with patch.dict("os.environ", {"INFERENCE_BACKEND": "local"}):
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
    sup.router = MagicMock()
    sup.router.complete = AsyncMock(return_value=("answer body", {}))
    sup.rag = MagicMock()
    sup.rag.process = AsyncMock(
        return_value={"reply": "RAG ANSWER — should not be reached by these tests"}
    )
    return sup


def _mock_route_intent(intent: str):
    return AsyncMock(return_value={"intent": intent, "confidence": 0.9, "reasoning": "test"})


# ---------------------------------------------------------------------------
# 1) Deterministic pack answer, pack-grounded, cited, trusted dispatch
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_gs10_ce10_answered_from_pack(supervisor):
    """ "what does CE10 mean on my gs10" is answered deterministically from the
    durapulse_gs10 pack — with inline [Source:] citations, and the H4 enforcer
    must NOT bolt on a false "not enough information" admission."""
    with patch("shared.engine.route_intent", new=_mock_route_intent("continue_current")):
        reply = await supervisor.process("chat-ce10", "what does CE10 mean on my gs10")

    assert "CE10" in reply
    assert "modbus timeout" in reply.lower()
    assert "P09.03" in reply
    assert "[Source:" in reply
    reply_low = reply.lower()
    assert "not enough information" not in reply_low
    assert "don't have enough" not in reply_low
    assert "i don't have specific documentation" not in reply_low


@pytest.mark.asyncio
async def test_gs10_ce10_dispatch_kind_is_drive_pack(supervisor):
    """process_full() must tag the turn dispatch_kind="drive_pack" so the
    runtime quality gate bypasses it (see _TRUSTED_DISPATCH_KINDS)."""
    with patch("shared.engine.route_intent", new=_mock_route_intent("continue_current")):
        result = await supervisor.process_full("chat-ce10-2", "what does CE10 mean on my gs10")

    assert result["dispatch_kind"] == "drive_pack"
    assert "CE10" in result["reply"]


@pytest.mark.asyncio
async def test_static_label_when_live_tags_preamble_present(supervisor):
    """Guardrail 3: when a drive-pack answer fires on a turn that ALSO carries a
    live-tag preamble (the Ignition "[LIVE TAGS …]" block, which reaches the
    engine via mira-pipeline/ignition_chat.py), the reply is prefixed with a
    "Static pack reference — not from live telemetry" label so a static,
    manual-cited answer is never conflated with a live telemetry read."""
    msg = (
        "[LIVE TAGS — current allowlisted snapshot from Ignition]\n"
        "output_frequency: 45.0 Hz\n"
        "[END LIVE TAGS]\n"
        "what does CE10 mean on my gs10"
    )
    with patch("shared.engine.route_intent", new=_mock_route_intent("continue_current")):
        reply = await supervisor.process("chat-live-tags", msg)

    assert "Static pack reference" in reply
    assert "not from live telemetry" in reply.lower()
    # still the deterministic pack answer, cited
    assert "CE10" in reply
    assert "[Source:" in reply


# ---------------------------------------------------------------------------
# 2) Safety short-circuit still wins over a matching pack
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_safety_still_wins_over_pack(supervisor):
    """A message that BOTH names a drive with a pack AND trips the safety
    short-circuit must return the safety STOP — never a pack answer. This
    proves the fast-path is placed AFTER the safety return, never before it."""
    with (
        patch("shared.engine.route_intent", new=_mock_route_intent("safety_concern")),
        patch("shared.engine.push_safety_alert", new=AsyncMock(return_value=True)),
    ):
        reply = await supervisor.process("chat-safety", "the gs10 is arc flashing what do I do")

    assert "STOP" in reply
    assert "de-energize" in reply.lower()
    # Must NOT be the pack answer — no fault-card content leaked through.
    assert "CE10" not in reply
    assert "[Source:" not in reply


# ---------------------------------------------------------------------------
# 3) A message that names no drive never touches the pack path
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_non_drive_message_falls_through(supervisor):
    """A normal question naming no known drive must not invoke
    shared.drive_packs.answer_question at all — zero behavior change."""
    with patch("shared.engine.route_intent", new=_mock_route_intent("greeting_or_chitchat")):
        with patch("shared.engine.answer_question") as mock_answer_question:
            reply = await supervisor.process("chat-no-drive", "hello")

    mock_answer_question.assert_not_called()
    assert reply  # normal reply still returned


# ---------------------------------------------------------------------------
# 4) A drive is named, but the question doesn't map to pack content
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_unmatched_drive_question_falls_through(supervisor):
    """ "gs10 what is the weather" — resolve_pack() matches "gs10", but the
    question maps to no fault/parameter, so answer_question().matched is
    False and the turn must fall through to the normal routing path."""
    with patch("shared.engine.route_intent", new=_mock_route_intent("greeting_or_chitchat")):
        with patch(
            "shared.engine.answer_question", wraps=_real_answer_question
        ) as spy_answer_question:
            reply = await supervisor.process("chat-unmatched", "gs10 what is the weather")

    # The pack WAS consulted (resolve_pack matched "gs10")...
    spy_answer_question.assert_called_once()
    assert spy_answer_question.call_args.args[0] == "durapulse_gs10"
    # ...but it did not match fault/parameter content, so no pack answer leaked.
    assert "CE10" not in reply
    assert "[Source:" not in reply
    assert reply  # normal (greeting-handler) reply still returned
