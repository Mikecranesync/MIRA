"""Tests for Telegram bot log redaction."""

from __future__ import annotations

import logging
import os
import sys

os.environ.setdefault("TELEGRAM_BOT_TOKEN", "dummy-token-for-testing")
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("OPENWEBUI_API_KEY", "")
os.environ.setdefault("KNOWLEDGE_COLLECTION_ID", "dummy-collection")
os.environ.setdefault("VISION_MODEL", "qwen2.5vl:7b")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira_test.db")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))
sys.modules.pop("chat_adapter", None)

import bot  # noqa: E402


def test_httpx_telegram_url_filter_redacts_bot_token_in_message_args():
    record = logging.LogRecord(
        name="httpx",
        level=logging.INFO,
        pathname=__file__,
        lineno=1,
        msg="HTTP Request: GET %s",
        args=("https://api.telegram.org/bot123456:ABC-secret-token/getUpdates",),
        exc_info=None,
    )

    assert bot._TelegramBotTokenRedactionFilter().filter(record) is True

    rendered = record.getMessage()
    assert "ABC-secret-token" not in rendered
    assert "/bot<redacted>/" in rendered
