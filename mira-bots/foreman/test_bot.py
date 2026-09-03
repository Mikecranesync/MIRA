#!/usr/bin/env python3
"""Unit tests for Foreman bot - Infrastructure-level self-echo prevention"""

import pytest
from bot import ForemanRuntime, ForemanSettings


@pytest.fixture
def settings():
    return ForemanSettings(
        bot_token="xoxb-test",
        app_token="xapp-test",
        bot_user_id="U_FOREMAN_BOT",
        foreman_channel="factorylm-foreman",
        excluded_channels=("cursor-enterprise",),
        dry_run=True,
    )


@pytest.fixture
def runtime(settings):
    return ForemanRuntime(settings=settings)


@pytest.mark.asyncio
async def test_ignore_bot_messages(runtime):
    """Bot messages (including Foreman's own) are ignored by bot_id check."""
    event = {
        "type": "message",
        "channel": "C_FOREMAN_CHANNEL",
        "user": "U_SOME_USER",
        "bot_id": "B_FOREMAN_BOT",  # This is the key field
        "text": "Foreman's message",
        "ts": "1234567890.123456",
    }

    # Mock say and client
    say_called = False

    async def mock_say(**kwargs):
        nonlocal say_called
        say_called = True

    mock_client = None

    await runtime.handle_message(event, mock_say, mock_client)

    # Should NOT call say (message was ignored)
    assert not say_called, "Bot messages should be ignored"


@pytest.mark.asyncio
async def test_accept_human_messages(runtime):
    """Human messages (no bot_id) are accepted and processed."""
    runtime.foreman_channel_id = "C_FOREMAN_CHANNEL"  # Simulate resolved channel

    event = {
        "type": "message",
        "channel": "C_FOREMAN_CHANNEL",
        "user": "U_HUMAN",
        # NO bot_id field - this is a human message
        "text": "Hello Foreman",
        "ts": "1234567890.123456",
    }

    say_called = False

    async def mock_say(**kwargs):
        nonlocal say_called
        say_called = True

    mock_client = None

    await runtime.handle_message(event, mock_say, mock_client)

    # Should call say (message was accepted, dry_run replies)
    assert say_called, "Human messages should be accepted"


@pytest.mark.asyncio
async def test_ignore_excluded_channels(runtime):
    """Messages in excluded channels (e.g., cursor-enterprise) are ignored."""
    event = {
        "type": "message",
        "channel": "C_ENTERPRISE_CHANNEL",
        "user": "U_HUMAN",
        "text": "Hello",
        "ts": "1234567890.123456",
    }

    say_called = False

    async def mock_say(**kwargs):
        nonlocal say_called
        say_called = True

    # Mock client to return excluded channel name
    class MockClient:
        async def conversations_info(self, channel):
            return {"channel": {"name": "cursor-enterprise"}}

    await runtime.handle_message(event, mock_say, MockClient())

    # Should NOT call say (excluded channel)
    assert not say_called, "Excluded channel messages should be ignored"


@pytest.mark.asyncio
async def test_ignore_bot_subtypes(runtime):
    """Messages with bot subtypes (bot_message, message_changed, etc.) are ignored."""
    event = {
        "type": "message",
        "subtype": "bot_message",
        "channel": "C_FOREMAN_CHANNEL",
        "user": "U_SOME_USER",
        "text": "Some bot message",
        "ts": "1234567890.123456",
    }

    say_called = False

    async def mock_say(**kwargs):
        nonlocal say_called
        say_called = True

    mock_client = None

    await runtime.handle_message(event, mock_say, mock_client)

    # Should NOT call say (bot subtype)
    assert not say_called, "Bot subtype messages should be ignored"


@pytest.mark.asyncio
async def test_thread_replies(runtime):
    """Thread replies use thread_ts from the event."""
    runtime.foreman_channel_id = "C_FOREMAN_CHANNEL"

    event = {
        "type": "message",
        "channel": "C_FOREMAN_CHANNEL",
        "user": "U_HUMAN",
        "text": "Thread reply",
        "ts": "1234567890.123456",
        "thread_ts": "1234567800.000000",  # Parent message
    }

    say_kwargs = {}

    async def mock_say(**kwargs):
        nonlocal say_kwargs
        say_kwargs = kwargs

    mock_client = None

    await runtime.handle_message(event, mock_say, mock_client)

    # Should use thread_ts from the event
    assert "thread_ts" in say_kwargs, "Thread replies should include thread_ts"
    assert say_kwargs["thread_ts"] == "1234567800.000000"


def test_settings_from_env():
    """ForemanSettings loads from environment variables."""
    env = {
        "FOREMAN_SLACK_BOT_TOKEN": "xoxb-test",
        "FOREMAN_SLACK_APP_TOKEN": "xapp-test",
        "FOREMAN_SLACK_BOT_USER_ID": "U_BOT",
        "FOREMAN_SLACK_CHANNEL": "test-channel",
        "FOREMAN_EXCLUDED_CHANNELS": "channel1,channel2",
        "FOREMAN_DRY_RUN": "1",
    }

    settings = ForemanSettings.from_env(env)

    assert settings.bot_token == "xoxb-test"
    assert settings.app_token == "xapp-test"
    assert settings.bot_user_id == "U_BOT"
    assert settings.foreman_channel == "test-channel"
    assert settings.excluded_channels == ("channel1", "channel2")
    assert settings.dry_run is True


def test_settings_defaults():
    """ForemanSettings uses sensible defaults."""
    env = {
        "FOREMAN_SLACK_BOT_TOKEN": "xoxb-test",
        "FOREMAN_SLACK_APP_TOKEN": "xapp-test",
    }

    settings = ForemanSettings.from_env(env)

    assert settings.foreman_channel == "factorylm-foreman"
    assert settings.excluded_channels == ("cursor-enterprise",)
    assert settings.dry_run is False


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
