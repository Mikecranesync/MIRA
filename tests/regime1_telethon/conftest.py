"""Telethon Replay regime fixtures."""

from __future__ import annotations

import os

import pytest


@pytest.fixture
def bot_username() -> str:
    """Telegram bot username to send test messages to."""
    return os.getenv("TELEGRAM_BOT_USERNAME", "@MIRABot")


@pytest.fixture
def telethon_timeout() -> int:
    """Timeout in seconds for waiting for bot replies."""
    return int(os.getenv("TELEGRAM_TEST_TIMEOUT", "60"))


@pytest.fixture
def replay_mode() -> str:
    """Replay mode: 'telethon' (live), 'http' (ingest fallback), 'dry-run'."""
    return os.getenv("MIRA_REPLAY_MODE", "dry-run")
