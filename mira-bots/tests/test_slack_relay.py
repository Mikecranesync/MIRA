"""Tests for MIRA Slack bot relay helpers.

These tests run offline — no Slack API, no Open WebUI, no real DB.
All Slack SDK and GSD engine dependencies are stubbed before import.
"""

import asyncio
import importlib
import os
import sys
import types
from unittest.mock import AsyncMock, patch

import pytest

# ---------------------------------------------------------------------------
# Stub slack_bolt (MIT) before the module is imported
# ---------------------------------------------------------------------------

def _stub(name: str) -> types.ModuleType:
    m = types.ModuleType(name)
    sys.modules[name] = m
    return m


_bolt = _stub("slack_bolt")
_async_app = _stub("slack_bolt.async_app")


class _FakeAsyncApp:
    def __init__(self, **kwargs):
        pass

    def event(self, *args, **kwargs):
        def decorator(fn):
            return fn
        return decorator


_async_app.AsyncApp = _FakeAsyncApp
_bolt.async_app = _async_app

_adapter = _stub("slack_bolt.adapter")
_socket = _stub("slack_bolt.adapter.socket_mode")
_aiohttp = _stub("slack_bolt.adapter.socket_mode.aiohttp")


class _FakeSocketHandler:
    def __init__(self, app, token):
        pass

    async def start_async(self):
        pass


_aiohttp.AsyncSocketModeHandler = _FakeSocketHandler

# ---------------------------------------------------------------------------
# Stub gsd_engine so the module doesn't touch the filesystem on import
# ---------------------------------------------------------------------------

_gsd = _stub("gsd_engine")


class _FakeGSDEngine:
    def __init__(self, **kwargs):
        pass

    async def process(self, chat_id: str, text: str, photo_b64=None) -> str:
        return f"reply:{text}"

    def reset(self, chat_id: str) -> None:
        pass


_gsd.GSDEngine = _FakeGSDEngine

# ---------------------------------------------------------------------------
# Set required env vars then import the bot module
# ---------------------------------------------------------------------------

os.environ["SLACK_BOT_TOKEN"] = "xoxb-placeholder"
os.environ["SLACK_APP_TOKEN"] = "xapp-placeholder"
os.environ.setdefault("OPENWEBUI_BASE_URL", "http://localhost:8080")
os.environ.setdefault("MIRA_DB_PATH", "/tmp/mira-test.db")
os.environ.setdefault("SLACK_ALLOWED_CHANNELS", "")

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "slack"))
bot = importlib.import_module("bot")

from bot import _channel_allowed, _strip_mention, _relay  # noqa: E402

# ---------------------------------------------------------------------------
# _channel_allowed
# ---------------------------------------------------------------------------


class TestChannelAllowed:
    def test_empty_allowed_set_permits_any_channel(self):
        with patch.object(bot, "ALLOWED_CHANNELS", set()):
            assert _channel_allowed("C123") is True
            assert _channel_allowed("C_ANYTHING") is True

    def test_listed_channel_is_allowed(self):
        with patch.object(bot, "ALLOWED_CHANNELS", {"C123", "C456"}):
            assert _channel_allowed("C123") is True
            assert _channel_allowed("C456") is True

    def test_unlisted_channel_is_blocked(self):
        with patch.object(bot, "ALLOWED_CHANNELS", {"C123"}):
            assert _channel_allowed("C999") is False

    def test_empty_string_channel_blocked_when_restricted(self):
        with patch.object(bot, "ALLOWED_CHANNELS", {"C123"}):
            assert _channel_allowed("") is False


# ---------------------------------------------------------------------------
# _strip_mention
# ---------------------------------------------------------------------------


class TestStripMention:
    def test_strips_leading_mention(self):
        assert _strip_mention("<@U123ABC> hello world") == "hello world"

    def test_mention_only_returns_empty_string(self):
        assert _strip_mention("<@U123ABC>") == ""

    def test_plain_text_returned_stripped(self):
        assert _strip_mention("  plain text  ") == "plain text"

    def test_mention_not_at_start_is_preserved(self):
        # Only the leading <@...> is stripped; mid-string mentions are untouched
        result = _strip_mention("check <@U123> now")
        assert result == "check <@U123> now"

    def test_mention_with_extra_whitespace(self):
        assert _strip_mention("<@U123ABC>   pump fault  ") == "pump fault"


# ---------------------------------------------------------------------------
# _relay
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
class TestRelay:
    async def test_sends_ack_before_reply(self):
        mock_engine = AsyncMock()
        mock_engine.process = AsyncMock(return_value="the answer")
        mock_say = AsyncMock()

        await _relay("user1", "fault on pump", mock_say, None, _engine=mock_engine)

        assert mock_say.call_count == 2
        ack_text = mock_say.call_args_list[0].kwargs.get("text", "")
        assert "Processing" in ack_text

    async def test_relay_delivers_engine_reply(self):
        mock_engine = AsyncMock()
        mock_engine.process = AsyncMock(return_value="MIRA diagnosis")
        mock_say = AsyncMock()

        await _relay("user1", "what failed", mock_say, None, _engine=mock_engine)

        reply_text = mock_say.call_args_list[1].kwargs.get("text", "")
        assert "MIRA diagnosis" in reply_text

    async def test_engine_error_returns_operator_friendly_message(self):
        mock_engine = AsyncMock()
        mock_engine.process = AsyncMock(side_effect=Exception("connection timeout"))
        mock_say = AsyncMock()

        await _relay("user1", "VFD tripped", mock_say, None, _engine=mock_engine)

        last_text = mock_say.call_args_list[-1].kwargs.get("text", "")
        assert "unavailable" in last_text.lower()
        # Must not leak the raw exception
        assert "connection timeout" not in last_text

    async def test_thread_ts_propagated_to_all_say_calls(self):
        mock_engine = AsyncMock()
        mock_engine.process = AsyncMock(return_value="ok")
        mock_say = AsyncMock()

        await _relay("user1", "test", mock_say, "1704067200.000100", _engine=mock_engine)

        for call in mock_say.call_args_list:
            assert call.kwargs.get("thread_ts") == "1704067200.000100"

    async def test_no_thread_ts_omits_kwarg(self):
        mock_engine = AsyncMock()
        mock_engine.process = AsyncMock(return_value="ok")
        mock_say = AsyncMock()

        await _relay("user1", "test", mock_say, None, _engine=mock_engine)

        for call in mock_say.call_args_list:
            assert "thread_ts" not in call.kwargs
