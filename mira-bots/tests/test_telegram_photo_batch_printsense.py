"""Tests for PrintSense routing on Telegram multi-photo batches."""

from __future__ import annotations

import os
import sys
from unittest.mock import AsyncMock

import pytest

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)

import bot  # noqa: E402
from shared.photo_batch_queue import PhotoBatchRecord  # noqa: E402


def _record() -> PhotoBatchRecord:
    return PhotoBatchRecord(
        id=7,
        chat_id="12345",
        platform="telegram",
        caption="What do these mean together?",
        photos_b64=["resized-page-1", "resized-page-2"],
        raw_photos_b64=["raw-page-1", "raw-page-2"],
        ack_message_id=99,
        created_at=123.0,
    )


@pytest.mark.asyncio
async def test_multi_photo_print_batch_uses_printsense_package_interpreter(monkeypatch):
    async def _vision(photo_b64, caption):
        return {
            "classification": "ELECTRICAL_PRINT",
            "drawing_type": "wiring diagram",
            "ocr_items": ["-W5469", "-X1"],
        }

    monkeypatch.setattr(bot.engine.vision, "process", _vision)
    interpret = AsyncMock(return_value="combined PrintSense reply")
    monkeypatch.setattr(bot.engine, "_interpret_print_anthropic_pages", interpret)

    reply = await bot._try_multi_photo_printsense_reply(_record())

    assert reply == "combined PrintSense reply"
    interpret.assert_awaited_once()
    assert interpret.call_args.kwargs["photo_b64s"] == ["raw-page-1", "raw-page-2"]
    assert interpret.call_args.kwargs["question"] == "What do these mean together?"


@pytest.mark.asyncio
async def test_multi_photo_mixed_batch_falls_back_to_generic_worker(monkeypatch):
    seen = []

    async def _vision(photo_b64, caption):
        seen.append(photo_b64)
        return {
            "classification": "ELECTRICAL_PRINT" if len(seen) == 1 else "EQUIPMENT_PHOTO",
            "drawing_type": "wiring diagram",
            "ocr_items": [],
        }

    monkeypatch.setattr(bot.engine.vision, "process", _vision)
    interpret = AsyncMock(return_value="should not be used")
    monkeypatch.setattr(bot.engine, "_interpret_print_anthropic_pages", interpret)

    assert await bot._try_multi_photo_printsense_reply(_record()) is None
    interpret.assert_not_awaited()
