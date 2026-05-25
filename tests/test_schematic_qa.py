"""Tests for the schematic-question path in Supervisor (engine.py).

Bug fixed: when the technician sent a real question with a schematic photo,
MIRA replied with a generic OCR-label preview instead of analyzing the
circuit. Fix: the ELECTRICAL_PRINT branch now sends image + question to the
vision LLM cascade and only falls back to the OCR preview when the cascade
returns nothing OR the user attached no real question.
"""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

SCHEMATIC_VISION_DATA = {
    "classification": "ELECTRICAL_PRINT",
    "classification_confidence": 0.92,
    "vision_result": (
        "Electrical drawing — wiring diagram with three stators "
        "(S1, S2, S3) wired through relay K10 and resistors R11, R12, R13."
    ),
    "ocr_items": ["K10", "R11", "R12", "R13", "S1", "S2", "S3", "PE", "L1"],
    "tesseract_text": "K10 R11 R12 R13",
    "drawing_type": "wiring diagram",
    "drawing_type_confidence": 0.85,
}


def _make_engine():
    """Construct a Supervisor instance with all heavy deps mocked out."""
    with patch("shared.engine.Supervisor.__init__", return_value=None):
        from shared.engine import Supervisor

        eng = Supervisor.__new__(Supervisor)

    eng.db_path = ":memory:"
    eng.router = MagicMock()
    return eng


@pytest.mark.asyncio
async def test_schematic_with_question_invokes_vision_cascade():
    """A real question + schematic photo → router.complete is called with
    a multipart image+text message and the cascade reply is returned."""
    eng = _make_engine()
    expected_reply = (
        "Circuit type: continuity test through three stators.\n"
        "K10 closes momentarily for each phase, R11/R12/R13 limit the "
        "test current. Trip threshold is the coil pickup on K10."
    )
    eng.router.complete = AsyncMock(return_value=(expected_reply, {"provider": "groq"}))

    photo_b64 = "ZmFrZWltYWdlYnl0ZXM="
    question = "Explain how this circuit manages to measure continuity through these three stators"

    reply = await eng._analyze_schematic_with_question(
        photo_b64=photo_b64,
        question=question,
        vision_data=SCHEMATIC_VISION_DATA,
        chat_id="chat-1",
    )

    assert reply == expected_reply
    eng.router.complete.assert_awaited_once()
    call_messages = eng.router.complete.call_args.args[0]
    # System prompt is the first message and tells the model it's MIRA reading schematics
    assert call_messages[0]["role"] == "system"
    assert "schematic" in call_messages[0]["content"].lower()
    # User message is multipart with an image_url block carrying the photo
    user_content = call_messages[1]["content"]
    assert isinstance(user_content, list)
    types = [b["type"] for b in user_content]
    assert "image_url" in types and "text" in types
    image_block = next(b for b in user_content if b["type"] == "image_url")
    assert image_block["image_url"]["url"] == f"data:image/jpeg;base64,{photo_b64}"
    text_block = next(b for b in user_content if b["type"] == "text")
    # The technician's question is forwarded verbatim
    assert question in text_block["text"]
    # OCR labels we already extracted are passed in as ground truth
    assert "K10" in text_block["text"]


@pytest.mark.asyncio
async def test_schematic_cascade_failure_returns_empty_string():
    """If every vision provider in the cascade returns empty, the helper
    returns "" so the caller can fall back to the OCR-only reply."""
    eng = _make_engine()
    eng.router.complete = AsyncMock(return_value=("", {}))

    reply = await eng._analyze_schematic_with_question(
        photo_b64="ZmFrZQ==",
        question="What does this circuit do?",
        vision_data=SCHEMATIC_VISION_DATA,
        chat_id="chat-2",
    )

    assert reply == ""


@pytest.mark.asyncio
async def test_schematic_cascade_exception_returns_empty_string():
    """A router exception must NOT bubble — we degrade gracefully to the
    OCR-only reply path."""
    eng = _make_engine()
    eng.router.complete = AsyncMock(side_effect=RuntimeError("network down"))

    reply = await eng._analyze_schematic_with_question(
        photo_b64="ZmFrZQ==",
        question="Trace the safety circuit",
        vision_data=SCHEMATIC_VISION_DATA,
        chat_id="chat-3",
    )

    assert reply == ""
