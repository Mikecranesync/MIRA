"""Tests for the typing_action async context manager."""

import asyncio
import os
import sys
from unittest.mock import AsyncMock, MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "telegram"))

from bot import typing_action


@pytest.mark.asyncio
async def test_typing_action_calls_send_chat_action():
    """typing_action must call send_chat_action at least once while active."""
    mock_context = MagicMock()
    mock_context.bot.send_chat_action = AsyncMock()
    async with typing_action(mock_context, 12345, "typing"):
        await asyncio.sleep(0.05)
    assert mock_context.bot.send_chat_action.called


@pytest.mark.asyncio
async def test_typing_action_swallows_api_errors():
    """typing_action must not raise even when send_chat_action raises."""
    mock_context = MagicMock()
    mock_context.bot.send_chat_action = AsyncMock(side_effect=Exception("API error"))
    # Should not raise
    async with typing_action(mock_context, 12345):
        await asyncio.sleep(0.05)


@pytest.mark.asyncio
async def test_typing_action_cancels_cleanly():
    """After context exit, no further send_chat_action calls should occur."""
    mock_context = MagicMock()
    mock_context.bot.send_chat_action = AsyncMock()
    async with typing_action(mock_context, 12345):
        await asyncio.sleep(0.05)
    count_at_exit = mock_context.bot.send_chat_action.call_count
    await asyncio.sleep(0.1)
    assert mock_context.bot.send_chat_action.call_count == count_at_exit
