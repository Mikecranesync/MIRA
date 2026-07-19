"""Tests for the Telegram Print Translator fast path (`_try_print_translator_reply`).

Mirrors `test_telegram_wiring_hooks.py`: mocks Update/context, monkeypatches
`bot.engine.vision.process` and `bot.engine.router.complete` (both async) so
no real vision/LLM/DB/Telegram network is touched. Print Translator is a
read-only, LLM-generation feature — these tests also assert it NEVER calls a
wiring-DB write helper and NEVER touches control.
"""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)

import pytest  # noqa: E402

import bot  # noqa: E402
from shared import print_translator  # noqa: E402


def _mock_update(chat_id: int = 12345, user_id: int = 67890, caption: str = ""):
    """Build a mock Telegram Update with photo/caption support."""
    update = MagicMock()
    update.effective_chat.id = chat_id
    update.effective_user.id = user_id
    update.message.text = ""
    update.message.caption = caption
    update.message.reply_text = AsyncMock()
    return update


def _mock_vision_process(classification: str, ocr_items=None, drawing_type="ladder logic"):
    """Build an async mock of `engine.vision.process` returning a vision_data dict."""

    async def _process(photo_b64, message):
        return {
            "classification": classification,
            "classification_confidence": 0.9,
            "vision_result": "a schematic drawing",
            "ocr_items": ocr_items if ocr_items is not None else [],
            "tesseract_text": "",
            "drawing_type": drawing_type,
            "drawing_type_confidence": 0.8,
        }

    return _process


def _mock_router_complete(reply_text: str = "A canned explanation.", usage=None):
    return AsyncMock(return_value=(reply_text, usage or {"provider": "groq"}))


# ── Trigger ───────────────────────────────────────────────────────────────


class TestPrintTranslatorTrigger:
    @pytest.mark.asyncio
    async def test_electrical_print_theory_caption_triggers(self, monkeypatch):
        """'explain this print' + ELECTRICAL_PRINT classification -> True, replies."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=["K10 contactor", "CR1"]),
        )
        mock_complete = _mock_router_complete("Here is the explanation.")
        monkeypatch.setattr(bot.engine.router, "complete", mock_complete)

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        assert result is True
        mock_complete.assert_awaited_once()
        update.message.reply_text.assert_called_once()
        reply = update.message.reply_text.call_args[0][0]
        assert reply == "Here is the explanation."

    @pytest.mark.asyncio
    async def test_router_receives_ocr_ground_truth_and_theory_prompt(self, monkeypatch):
        """The messages passed to router.complete carry the OCR ground-truth
        (mocked ocr_items appear verbatim) and the THEORY system prompt — i.e.
        grounded, our code injects no invented labels."""
        update = _mock_update(caption="explain this circuit")
        context = MagicMock()
        ocr_items = ["K10 contactor", "CR1", "W200"]

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=ocr_items),
        )
        mock_complete = _mock_router_complete()
        monkeypatch.setattr(bot.engine.router, "complete", mock_complete)

        await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this circuit", update, context
        )

        mock_complete.assert_awaited_once()
        messages = mock_complete.call_args[0][0]
        assert messages[0]["content"] == print_translator.THEORY_SYSTEM_PROMPT
        user_text = messages[1]["content"][1]["text"]
        for item in ocr_items:
            assert item in user_text


# ── Fall-through ─────────────────────────────────────────────────────────


class TestPrintTranslatorFallsThrough:
    @pytest.mark.asyncio
    async def test_non_print_photo_falls_through(self, monkeypatch):
        """Theory caption but vision classifies as EQUIPMENT_PHOTO -> False,
        no reply, router NOT called."""
        update = _mock_update(caption="explain this")
        context = MagicMock()

        monkeypatch.setattr(bot.engine.vision, "process", _mock_vision_process("EQUIPMENT_PHOTO"))
        mock_complete = _mock_router_complete()
        monkeypatch.setattr(bot.engine.router, "complete", mock_complete)

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this", update, context
        )

        assert result is False
        update.message.reply_text.assert_not_called()
        mock_complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_nameplate_classification_falls_through(self, monkeypatch):
        """Theory caption but vision classifies as NAMEPLATE -> False."""
        update = _mock_update(caption="explain this diagram")
        context = MagicMock()

        monkeypatch.setattr(bot.engine.vision, "process", _mock_vision_process("NAMEPLATE"))
        mock_complete = _mock_router_complete()
        monkeypatch.setattr(bot.engine.router, "complete", mock_complete)

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this diagram", update, context
        )

        assert result is False
        update.message.reply_text.assert_not_called()
        mock_complete.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_non_theory_caption_falls_through_without_vision_call(self, monkeypatch):
        """UPDATED 2026-07-15 (operator directive: visual-first routing): a
        non-print caption no longer cheap-rejects — the photo is CLASSIFIED
        (one local vision call), and a non-print classification falls through
        to the nameplate/drive flow unchanged. The old assertion that vision
        was never called encoded the caption gate that hid real prints."""
        update = _mock_update(caption="what drive is this?")
        context = MagicMock()

        vision_process = AsyncMock(
            side_effect=_mock_vision_process("NAMEPLATE")
        )
        monkeypatch.setattr(bot.engine.vision, "process", vision_process)
        mock_complete = _mock_router_complete()
        monkeypatch.setattr(bot.engine.router, "complete", mock_complete)

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "what drive is this?", update, context
        )

        assert result is False
        update.message.reply_text.assert_not_called()
        vision_process.assert_awaited()  # visual-first: the image was consulted
        mock_complete.assert_not_awaited()  # but no LLM spend on a fall-through

    @pytest.mark.asyncio
    async def test_wiring_intake_caption_not_claimed(self, monkeypatch):
        """A caption the wiring-intake flow owns ('CV-101 add this wiring') is
        not a theory request -> _try_print_translator_reply returns False."""
        update = _mock_update(caption="CV-101 add this wiring")
        context = MagicMock()

        vision_process = AsyncMock()
        monkeypatch.setattr(bot.engine.vision, "process", vision_process)

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "CV-101 add this wiring", update, context
        )

        assert result is False
        update.message.reply_text.assert_not_called()
        vision_process.assert_not_awaited()

    @pytest.mark.asyncio
    async def test_vision_error_falls_through(self, monkeypatch):
        """A vision-worker exception is not fatal — fall through so a hiccup
        doesn't eat the turn."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()

        async def _raise(photo_b64, message):
            raise RuntimeError("vision service down")

        monkeypatch.setattr(bot.engine.vision, "process", _raise)
        mock_complete = _mock_router_complete()
        monkeypatch.setattr(bot.engine.router, "complete", mock_complete)

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        assert result is False
        update.message.reply_text.assert_not_called()
        mock_complete.assert_not_awaited()


# ── Uncertainty / grounding contract ────────────────────────────────────────


class TestGroundingContract:
    @pytest.mark.asyncio
    async def test_empty_ocr_items_flags_unreadable_contract(self, monkeypatch):
        """With no ocr_items, the messages tell the model to rely on the image
        and flag unreadable items — we test the contract, not the model's
        judgment."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=[]),
        )
        mock_complete = _mock_router_complete()
        monkeypatch.setattr(bot.engine.router, "complete", mock_complete)

        await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        messages = mock_complete.call_args[0][0]
        user_text = messages[1]["content"][1]["text"]
        assert "No OCR labels were extracted" in user_text
        assert "Unclear or unreadable items" in messages[0]["content"]

    @pytest.mark.asyncio
    async def test_no_extra_labels_injected(self, monkeypatch):
        """The user text passed to router contains ONLY the provided
        ocr_items — no extra device tags injected by our code — and the
        system prompt forbids invention."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()
        ocr_items = ["K10 contactor", "CR1"]

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=ocr_items),
        )
        mock_complete = _mock_router_complete()
        monkeypatch.setattr(bot.engine.router, "complete", mock_complete)

        await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        messages = mock_complete.call_args[0][0]
        user_text = messages[1]["content"][1]["text"]
        ocr_lines = [line for line in user_text.splitlines() if line.startswith("- ")]
        assert ocr_lines == [f"- {item}" for item in ocr_items]
        assert "NEVER invent" in messages[0]["content"]

    @pytest.mark.asyncio
    async def test_uncertainty_reaches_user(self, monkeypatch):
        """A canned reply containing an 'Unclear or unreadable items' section
        reaches the user unchanged."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()
        canned_reply = (
            "1. **What this appears to be**\nA motor control circuit.\n\n"
            "6. **Unclear or unreadable items**\nThe label near the top left "
            "relay is not legible."
        )

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=["K10 contactor"]),
        )
        monkeypatch.setattr(bot.engine.router, "complete", _mock_router_complete(canned_reply))

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        assert result is True
        reply = update.message.reply_text.call_args[0][0]
        assert reply == canned_reply
        assert "Unclear or unreadable items" in reply


# ── No writes / no control ───────────────────────────────────────────────


class TestNoWrites:
    @pytest.mark.asyncio
    async def test_never_calls_wiring_write_helper(self, monkeypatch):
        """Print Translator must never write proposed rows — assert the
        wiring-DB write helper is never hit."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()

        def _raise(*args, **kwargs):
            raise AssertionError("_write_rows_blocking should not be called")

        monkeypatch.setattr(bot, "_write_rows_blocking", _raise)

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=["K10 contactor"]),
        )
        monkeypatch.setattr(bot.engine.router, "complete", _mock_router_complete())

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        assert result is True  # ran fine, write helper never touched

    @pytest.mark.asyncio
    async def test_never_calls_wiring_intake_write_proposed_rows(self, monkeypatch):
        """Assert the underlying `wiring_intake.write_proposed_rows` seam is
        never called by the print translator path."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()

        def _raise(*args, **kwargs):
            raise AssertionError("write_proposed_rows should not be called")

        monkeypatch.setattr(bot.wiring_intake, "write_proposed_rows", _raise)

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=["K10 contactor"]),
        )
        monkeypatch.setattr(bot.engine.router, "complete", _mock_router_complete())

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        assert result is True

    @pytest.mark.asyncio
    async def test_never_calls_extract_schematic(self, monkeypatch):
        """Print Translator reuses `engine.vision`/`engine.router`, NOT the
        wiring-lane `engine._extract_schematic` seam."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()

        async def _raise(*args, **kwargs):
            raise AssertionError("_extract_schematic should not be called")

        monkeypatch.setattr(bot.engine, "_extract_schematic", _raise)

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=["K10 contactor"]),
        )
        monkeypatch.setattr(bot.engine.router, "complete", _mock_router_complete())

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        assert result is True


# ── Graceful LLM failure ─────────────────────────────────────────────────


class TestLLMFailure:
    @pytest.mark.asyncio
    async def test_all_providers_fail_returns_fallback(self, monkeypatch):
        """router.complete returns ("", {}) -> reply is FALLBACK_REPLY, still
        returns True (claimed the turn)."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=["K10 contactor"]),
        )
        monkeypatch.setattr(bot.engine.router, "complete", AsyncMock(return_value=("", {})))

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        assert result is True
        update.message.reply_text.assert_called_once()
        reply = update.message.reply_text.call_args[0][0]
        assert reply == print_translator.FALLBACK_REPLY

    async def test_router_raises_degrades_to_fallback(self, monkeypatch):
        """router.complete RAISING (e.g. a malformed provider reply -> JSONDecodeError,
        which escapes complete()'s _ProviderSkip-only guard) must NOT eat the turn:
        the fast-path degrades to FALLBACK_REPLY and still returns True."""
        update = _mock_update(caption="explain this print")
        context = MagicMock()

        monkeypatch.setattr(
            bot.engine.vision,
            "process",
            _mock_vision_process("ELECTRICAL_PRINT", ocr_items=["K10 contactor"]),
        )
        monkeypatch.setattr(
            bot.engine.router,
            "complete",
            AsyncMock(side_effect=ValueError("malformed provider JSON")),
        )

        result = await bot._try_print_translator_reply(
            b"fake-image-data", b"fake-image-data", "explain this print", update, context
        )

        assert result is True
        update.message.reply_text.assert_called_once()
        assert update.message.reply_text.call_args[0][0] == print_translator.FALLBACK_REPLY


# ---------------------------------------------------------------------------
# Visual-first fast path (operator directive 2026-07-15): classification, not
# the caption, decides whether the print translator handles a photo. The live
# phone test proved the caption pre-reject wrong: a Bulletin 509 print
# captioned "Analyze this equipment photo" never reached the interpreter.
# ---------------------------------------------------------------------------


class TestVisualFirstFastPath:
    @pytest.mark.parametrize(
        "caption",
        ["", "Analyze this equipment photo", "what is this?", "tell me what this means"],
        ids=["no-caption", "equipment-caption", "what-is-this", "tell-me"],
    )
    async def test_classified_print_reaches_interpreter_despite_caption(
        self, monkeypatch, caption
    ):
        monkeypatch.setattr(
            bot.engine.vision, "process", _mock_vision_process("ELECTRICAL_PRINT")
        )
        grounded = AsyncMock(return_value="GROUNDED-INTERPRETATION")
        monkeypatch.setattr(bot.engine, "_grounded_print_reply", grounded)
        update = _mock_update(caption=caption)
        context = MagicMock()

        handled = await bot._try_print_translator_reply(
            b"raw-bytes", b"vision-bytes", caption, update, context
        )

        assert handled is True
        assert grounded.await_count == 1
        # empty/default-ish captions become question=None (interpret the sheet);
        # real questions pass through verbatim
        passed_question = grounded.await_args.args[1]
        if caption in ("", "Analyze this equipment photo"):
            assert passed_question is None
        else:
            assert passed_question == caption
        update.message.reply_text.assert_awaited()  # a reply reached the user

    async def test_equipment_photo_with_print_caption_falls_through(self, monkeypatch):
        """Visual evidence wins at the bot layer too: a photo classified
        EQUIPMENT_PHOTO falls through unchanged even if the caption says print."""
        monkeypatch.setattr(
            bot.engine.vision, "process", _mock_vision_process("EQUIPMENT_PHOTO")
        )
        grounded = AsyncMock(return_value="GROUNDED")
        monkeypatch.setattr(bot.engine, "_grounded_print_reply", grounded)
        update = _mock_update(caption="Explain this print")

        handled = await bot._try_print_translator_reply(
            b"raw", b"vis", "Explain this print", update, MagicMock()
        )

        assert handled is False
        assert grounded.await_count == 0
