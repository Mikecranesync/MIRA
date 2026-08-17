"""A nameplate photo must never be answered as a schematic (prod, 2026-08-17).

The live defect: a technician photographed an equipment nameplate and captioned
it "Here's the model number can you please find the PDF user manual for me?".
The vision classifier returned ELECTRICAL_PRINT at confidence 0.66 (57 Tesseract
line items — a dense plate has a schematic's visual signature), the print
interpreter took the turn, burned ~40 s and a model call, and produced a
schematic analysis whose OWN FIRST LINE read "This photograph is the equipment's
factory nameplate, not a wiring schematic." That reply was delivered.

Two guards are pinned here:

1. **Caption gate** — a caption asking for the equipment's paperwork or a
   printed identifier routes to the nameplate/identity path whatever the
   classifier would say, and never reaches the print interpreter. Genuine print
   captions are untouched (any print vocabulary vetoes the gate).
2. **Self-misroute guard** — an interpretation that disowns the photo ("not a
   wiring schematic ... this is a nameplate") is NOT delivered; the plate read
   the nameplate rung already extracted is delivered instead.

Hermetic: predicate tests are pure; the rung tests mock the vision worker, the
nameplate extractor, the OCR floor and the grounded-reply method. No network,
no inference, no images.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)  # isolate from other bot adapters

import pytest  # noqa: E402

import bot  # noqa: E402
from shared.photo_routing import (  # noqa: E402
    asks_for_documentation,
    asks_for_identity,
    declares_not_a_print,
)

# The caption from the live defect.
_LIVE_CAPTION = "Here's the model number can you please find the PDF user manual for me?"

# The interpretation that disowned its own photo, verbatim in shape.
_MISROUTED_INTERPRETATION = (
    "This photograph is the equipment's factory nameplate, not a wiring schematic. "
    "Nevertheless, here is an interpretation of the control circuit: rung 1 energizes "
    "contactor K1 through the start push button, sealed in by its own auxiliary contact."
)

_PLATE_FIELDS = {
    "manufacturer": "Danfoss",
    "model": "FC-202",
    "serial": "02334H073",
    "voltage": "3X200-240V",
}


# --------------------------------------------------------------------------- #
# 1. Caption-intent table — pure, no bot, no I/O
# --------------------------------------------------------------------------- #


@pytest.mark.parametrize(
    "caption",
    [
        _LIVE_CAPTION,
        "can you find the manual for this?",
        "do you have the user manual",
        "send me the datasheet",
        "where is the documentation for this unit",
        "need the operating guide",
        "is there a pdf for this",
        "what's the part number?",
        "what is the model number on this",
        "cat no?",
        "read the serial number please",
        "what does the nameplate say",
    ],
    ids=[
        "live-defect",
        "find-manual",
        "user-manual",
        "datasheet",
        "documentation",
        "operating-guide",
        "pdf",
        "part-number",
        "model-number",
        "cat-no",
        "serial-number",
        "nameplate",
    ],
)
def test_documentation_captions_are_documentation_requests(caption):
    assert asks_for_documentation(caption) is True
    # every documentation request is also an identity request (superset)
    assert asks_for_identity(caption) is True


@pytest.mark.parametrize(
    "caption",
    [
        "explain this print",
        "what is this?",
        "what is this schematic showing",
        "what's the part number on this print?",
        "find the manual for the drive in this wiring diagram",
        "trace the start circuit",
        "theory of operation please",
        "what does rung 3 do",
        "",
        None,
        "Analyze this equipment photo",  # the bot's own default caption
    ],
    ids=[
        "explain-print",
        "bare-what-is-this",
        "what-is-this-schematic",
        "part-number-on-print",
        "manual-in-wiring-diagram",
        "trace-circuit",
        "theory",
        "rung",
        "empty",
        "none",
        "default-caption",
    ],
)
def test_print_and_neutral_captions_are_not_documentation_requests(caption):
    assert asks_for_documentation(caption) is False


@pytest.mark.parametrize(
    "caption",
    [
        "what is this?",
        "what's this",
        "what am I looking at",
        "identify this for me",
        "what kind of drive is this",
        "who makes this",
    ],
    ids=["what-is-this", "whats-this", "looking-at", "identify", "what-kind", "who-makes"],
)
def test_bare_identity_questions_are_identity_but_not_documentation(caption):
    """The bare "what is this?" family routes to the plate when a plate was read,
    but must NOT pre-reject the print interpreter — a captionless-ish print
    question still belongs to it."""
    assert asks_for_identity(caption) is True
    assert asks_for_documentation(caption) is False


@pytest.mark.parametrize(
    "caption",
    [
        "what is this print?",
        "what is this schematic",
        "explain this drawing",
        "what is this ladder logic doing",
    ],
    ids=["print", "schematic", "drawing", "ladder"],
)
def test_print_vocabulary_vetoes_the_identity_gate(caption):
    assert asks_for_identity(caption) is False
    assert asks_for_documentation(caption) is False


# --------------------------------------------------------------------------- #
# 2. Self-misroute predicate — pure
# --------------------------------------------------------------------------- #


def test_nameplate_declaring_interpretation_is_a_misroute():
    assert declares_not_a_print(_MISROUTED_INTERPRETATION) is True


@pytest.mark.parametrize(
    "text",
    [
        "This is a three-wire control schematic. Rung 1 energizes K1 via the start button.",
        # denial WITHOUT a plate: legitimate narrowing of the drawing type
        "This is not a ladder diagram — it is a power schematic showing the main feeders.",
        # plate WITHOUT a denial: a sheet that prints the motor nameplate data block
        "Sheet 3 lists the motor nameplate data (15 kW, 460 V) beside the starter circuit.",
        "",
        None,
    ],
    ids=["plain-print", "denial-only", "plate-only", "empty", "none"],
)
def test_legitimate_print_answers_are_not_misroutes(text):
    assert declares_not_a_print(text) is False


def test_late_mention_of_a_nameplate_is_not_a_misroute():
    """Only the OPENING declares a misroute — a passing mention 2 000 chars into
    a real interpretation must never suppress it."""
    text = "Rung analysis follows. " + ("x" * 1200) + " not a schematic but the nameplate says 460V"
    assert declares_not_a_print(text) is False


# --------------------------------------------------------------------------- #
# 3. Nameplate rung claims the identity/documentation caption
# --------------------------------------------------------------------------- #


def _mock_photo_update_context():
    update = MagicMock()
    update.effective_chat.id = 12345
    update.effective_user.id = 67890
    update.message.reply_text = AsyncMock()
    context = MagicMock()
    context.bot.send_chat_action = AsyncMock()
    return update, context


def _mock_nameplate_extract(fields: dict):
    return patch.object(bot.engine.nameplate, "extract", AsyncMock(return_value=fields))


@pytest.mark.asyncio
async def test_manual_request_on_a_plate_is_answered_from_the_plate():
    """The live defect, from the top: the nameplate rung claims the turn, so the
    print interpreter never sees it."""
    update, context = _mock_photo_update_context()
    with _mock_nameplate_extract(dict(_PLATE_FIELDS)), patch("bot.plate_ocr_text", return_value=""):
        handled = await bot._try_nameplate_drive_pack_reply(
            b"fake-jpeg", _LIVE_CAPTION, update, context
        )

    assert handled is True
    text = update.message.reply_text.call_args[0][0]
    assert "Danfoss" in text and "FC-202" in text
    # the paperwork question is answered honestly, not silently ignored
    assert "can't pull the manual" in text.lower()


@pytest.mark.asyncio
async def test_identity_question_on_a_plate_claims_the_turn():
    update, context = _mock_photo_update_context()
    with _mock_nameplate_extract(dict(_PLATE_FIELDS)), patch("bot.plate_ocr_text", return_value=""):
        handled = await bot._try_nameplate_drive_pack_reply(
            b"fake-jpeg", "what is this?", update, context
        )

    assert handled is True
    text = update.message.reply_text.call_args[0][0]
    assert "Danfoss" in text
    # no paperwork was asked for, so no paperwork sentence
    assert "can't pull the manual" not in text.lower()


@pytest.mark.asyncio
async def test_identity_caption_with_no_plate_read_falls_through():
    """The gate needs evidence: an empty extraction must not let a caption claim
    a turn the plate cannot answer."""
    update, context = _mock_photo_update_context()
    empty = {"manufacturer": None, "model": None, "serial": None}
    with _mock_nameplate_extract(empty), patch("bot.plate_ocr_text", return_value=""):
        handled = await bot._try_nameplate_drive_pack_reply(
            b"fake-jpeg", _LIVE_CAPTION, update, context
        )

    assert handled is False
    update.message.reply_text.assert_not_called()


@pytest.mark.asyncio
async def test_print_caption_on_a_plate_still_falls_through_to_the_print_path():
    """Print vocabulary vetoes the gate — the image keeps deciding."""
    update, context = _mock_photo_update_context()
    with _mock_nameplate_extract(dict(_PLATE_FIELDS)), patch("bot.plate_ocr_text", return_value=""):
        handled = await bot._try_nameplate_drive_pack_reply(
            b"fake-jpeg", "explain this print", update, context
        )

    assert handled is False


# --------------------------------------------------------------------------- #
# 4. Print rung — caption pre-reject + self-misroute guard
# --------------------------------------------------------------------------- #


def _mock_vision(classification: str = "ELECTRICAL_PRINT"):
    async def _process(photo_b64, message):
        return {
            "classification": classification,
            "classification_confidence": 0.66,
            "vision_result": "a dense sheet of small text",
            "ocr_items": [],
            "tesseract_text": "",
            "drawing_type": "schematic",
        }

    return _process


@pytest.mark.asyncio
async def test_documentation_caption_never_reaches_the_interpreter(monkeypatch):
    """No vision call, no interpreter call — the print rung declines outright."""
    update, context = _mock_photo_update_context()
    vision = AsyncMock(side_effect=_mock_vision())
    grounded = AsyncMock(return_value="a schematic analysis")
    monkeypatch.setattr(bot.engine.vision, "process", vision)
    monkeypatch.setattr(bot.engine, "_grounded_print_reply", grounded)

    handled = await bot._try_print_translator_reply(
        b"raw", b"vision", _LIVE_CAPTION, update, context, memo={}
    )

    assert handled is False
    vision.assert_not_awaited()
    grounded.assert_not_awaited()
    update.message.reply_text.assert_not_called()


@pytest.mark.asyncio
async def test_self_declared_misroute_is_suppressed_and_recovered(monkeypatch):
    """The interpreter says it is looking at a nameplate -> that reply is NOT
    delivered; the plate read from the memo is."""
    update, context = _mock_photo_update_context()
    monkeypatch.setattr(bot.engine.vision, "process", AsyncMock(side_effect=_mock_vision()))
    monkeypatch.setattr(
        bot.engine,
        "_grounded_print_reply",
        AsyncMock(return_value=_MISROUTED_INTERPRETATION),
    )
    persisted = AsyncMock()
    monkeypatch.setattr(bot, "_persist_equipment_workspace_turn", persisted)
    monkeypatch.setattr(bot, "_persist_print_workspace_turn", AsyncMock())
    monkeypatch.setattr(bot, "_schedule_print_autoeval", MagicMock())

    memo = {"nameplate_fields": dict(_PLATE_FIELDS)}
    handled = await bot._try_print_translator_reply(
        b"raw", b"vision", "what does this show?", update, context, memo=memo
    )

    assert handled is True
    sent = [c[0][0] for c in update.message.reply_text.call_args_list]
    assert not any("rung 1 energizes" in s.lower() for s in sent), sent
    assert any("Danfoss" in s for s in sent), sent
    # the recovered answer is remembered as an equipment turn, not a print turn
    persisted.assert_awaited_once()
    assert persisted.await_args.kwargs["vision_data"]["classification"] == "NAMEPLATE"
    assert memo["answer"].startswith("\U0001f4c7")


@pytest.mark.asyncio
async def test_misroute_with_nothing_to_recover_falls_through(monkeypatch):
    """No plate read in the memo -> the guard must not eat the turn; the engine
    dispatch below gets it (unchanged behaviour)."""
    update, context = _mock_photo_update_context()
    monkeypatch.setattr(bot.engine.vision, "process", AsyncMock(side_effect=_mock_vision()))
    monkeypatch.setattr(
        bot.engine,
        "_grounded_print_reply",
        AsyncMock(return_value=_MISROUTED_INTERPRETATION),
    )
    monkeypatch.setattr(bot, "_persist_print_workspace_turn", AsyncMock())
    monkeypatch.setattr(bot, "_schedule_print_autoeval", MagicMock())

    handled = await bot._try_print_translator_reply(
        b"raw", b"vision", "what does this show?", update, context, memo={}
    )

    assert handled is False
    sent = [c[0][0] for c in update.message.reply_text.call_args_list]
    assert not any("rung 1 energizes" in s.lower() for s in sent), sent


@pytest.mark.asyncio
async def test_genuine_print_reply_is_delivered_unchanged(monkeypatch):
    """The guard is inert on a real print answer."""
    update, context = _mock_photo_update_context()
    real = "Three-wire control. Rung 1 energizes K1 through the start push button."
    monkeypatch.setattr(bot.engine.vision, "process", AsyncMock(side_effect=_mock_vision()))
    monkeypatch.setattr(bot.engine, "_grounded_print_reply", AsyncMock(return_value=real))
    monkeypatch.setattr(bot, "_persist_print_workspace_turn", AsyncMock())
    monkeypatch.setattr(bot, "_schedule_print_autoeval", MagicMock())

    handled = await bot._try_print_translator_reply(
        b"raw", b"vision", "explain this print", update, context, memo={}
    )

    assert handled is True
    sent = [c[0][0] for c in update.message.reply_text.call_args_list]
    assert real in sent
