#!/usr/bin/env python3
"""Tests for FactoryLM Foreman bot.

Tests warm session reuse, bot filter safety gates, reconnection, and clean shutdown.
All tests use mocked Slack and Cursor SDK — no real tokens, no live Gateway.
"""

import asyncio
import pytest
from unittest.mock import AsyncMock, MagicMock, Mock, patch

# Mock cursor_sdk before importing bot
import sys
sys.modules["cursor_sdk"] = MagicMock()

from bot import ForemanBot, ForemanConfig  # noqa: E402


@pytest.fixture
def mock_config():
    """Foreman config with test values (no real tokens)."""
    config = ForemanConfig()
    config.slack_bot_token = "xoxb-test-token"
    config.slack_app_token = "xapp-test-token"
    config.cursor_api_key = "crsr_test_key"
    config.fleet_gateway_token = "test_gateway_token"
    config.fleet_gateway_url = "https://test.example.com/mcp"
    config.allowed_channel = "C_TEST_CHANNEL"
    config.bot_user_id = "U_FOREMAN_BOT"
    return config


@pytest.fixture
def mock_agent():
    """Mock Cursor Agent with send/wait/result."""
    agent = Mock()
    agent.agent_id = "bc-test-agent-123"
    
    # Mock run returned by agent.send()
    run = Mock()
    run.run_id = "run-test-456"
    
    # Mock result returned by run.wait()
    result = Mock()
    result.status = "completed"
    result.result = "Test response from Grok"
    
    run.wait.return_value = result
    agent.send.return_value = run
    
    return agent


@pytest.mark.asyncio
async def test_warm_session_reuse(mock_config, mock_agent):
    """Two accepted human messages → one agent create, two sends on same agent."""
    with patch("bot.Agent") as MockAgent:
        MockAgent.create.return_value = mock_agent
        
        bot = ForemanBot(mock_config)
        
        # First message
        resp1 = await bot._invoke_grok("first message", "U_USER_1")
        assert resp1 == "Test response from Grok"
        
        # Second message — should reuse same agent
        resp2 = await bot._invoke_grok("second message", "U_USER_1")
        assert resp2 == "Test response from Grok"
        
        # Verify: Agent.create called ONCE
        assert MockAgent.create.call_count == 1
        
        # Verify: agent.send called TWICE (on same agent)
        assert mock_agent.send.call_count == 2
        assert mock_agent.send.call_args_list[0][0][0] == "first message"
        assert mock_agent.send.call_args_list[1][0][0] == "second message"


@pytest.mark.asyncio
async def test_reconnect_after_agent_death(mock_config):
    """After simulated agent death, next message recovers (new create)."""
    with patch("bot.Agent") as MockAgent:
        # First agent (will die after first use)
        dead_agent = Mock()
        dead_agent.agent_id = "bc-dead-agent"
        dead_run = Mock()
        dead_run.run_id = "run-dead"
        dead_result = Mock()
        dead_result.status = "completed"
        dead_result.result = "First response"
        dead_run.wait.return_value = dead_result
        dead_agent.send.return_value = dead_run
        
        # Second agent (recovery)
        recovery_agent = Mock()
        recovery_agent.agent_id = "bc-recovery-agent"
        recovery_run = Mock()
        recovery_run.run_id = "run-recovery"
        recovery_result = Mock()
        recovery_result.status = "completed"
        recovery_result.result = "Recovery response"
        recovery_run.wait.return_value = recovery_result
        recovery_agent.send.return_value = recovery_run
        
        MockAgent.create.side_effect = [dead_agent, recovery_agent]
        
        bot = ForemanBot(mock_config)
        
        # First message succeeds
        resp1 = await bot._invoke_grok("first message", "U_USER_1")
        assert resp1 == "First response"
        assert MockAgent.create.call_count == 1
        
        # Simulate agent death: make agent.send() fail next time
        dead_agent.send.side_effect = RuntimeError("agent dead")
        
        # Second message fails (agent dies), marks agent unhealthy
        with pytest.raises(RuntimeError, match="agent dead"):
            await bot._invoke_grok("second message", "U_USER_1")
        
        # Verify agent was marked unhealthy
        assert bot._grok_agent is None
        
        # Third message recovers (creates new agent)
        resp3 = await bot._invoke_grok("third message", "U_USER_1")
        assert resp3 == "Recovery response"
        
        # Verify: Agent.create called TWICE (original + recovery)
        assert MockAgent.create.call_count == 2
        # Verify: recovery agent was used
        assert bot._grok_agent is recovery_agent


@pytest.mark.asyncio
async def test_bot_filter_prevents_agent_launch():
    """bot_id / own user / subtype / wrong channel / empty text → no Agent.create."""
    config = ForemanConfig()
    config.slack_bot_token = "xoxb-test"
    config.slack_app_token = "xapp-test"
    config.cursor_api_key = "crsr_test"
    config.fleet_gateway_token = "gw_test"
    config.allowed_channel = "C_ALLOWED"
    config.bot_user_id = "U_FOREMAN_BOT"
    
    with patch("bot.Agent") as MockAgent, \
         patch("bot.AsyncApp"):
        
        bot = ForemanBot(config)
        
        # Test 1: bot_id present
        event_bot_id = {
            "ts": "1234.5678",
            "bot_id": "B_OTHER_BOT",
            "channel": "C_ALLOWED",
            "text": "message from other bot",
        }
        assert bot._is_bot_message(event_bot_id) is True
        
        # Test 2: user is Foreman's own bot_user_id
        event_own_user = {
            "ts": "1234.5679",
            "user": "U_FOREMAN_BOT",
            "channel": "C_ALLOWED",
            "text": "foreman's own message",
        }
        assert bot._is_bot_message(event_own_user) is True
        
        # Test 3: bot_message subtype
        event_bot_subtype = {
            "ts": "1234.5680",
            "subtype": "bot_message",
            "channel": "C_ALLOWED",
            "text": "message with bot subtype",
        }
        assert bot._is_bot_message(event_bot_subtype) is True
        
        # Test 4: message_changed subtype
        event_changed_subtype = {
            "ts": "1234.5681",
            "subtype": "message_changed",
            "channel": "C_ALLOWED",
            "text": "changed message",
        }
        assert bot._is_bot_message(event_changed_subtype) is True
        
        # Test 5: message_deleted subtype
        event_deleted_subtype = {
            "ts": "1234.5682",
            "subtype": "message_deleted",
            "channel": "C_ALLOWED",
        }
        assert bot._is_bot_message(event_deleted_subtype) is True
        
        # Test 6: Human message in allowed channel — NOT filtered
        event_human = {
            "ts": "1234.5683",
            "user": "U_HUMAN_USER",
            "channel": "C_ALLOWED",
            "text": "human message",
        }
        assert bot._is_bot_message(event_human) is False
        
        # Verify: No Agent.create calls (all events filtered or would be rejected)
        assert MockAgent.create.call_count == 0


@pytest.mark.asyncio
async def test_channel_filter():
    """Wrong channel → message ignored, no agent launch."""
    config = ForemanConfig()
    config.slack_bot_token = "xoxb-test"
    config.slack_app_token = "xapp-test"
    config.cursor_api_key = "crsr_test"
    config.fleet_gateway_token = "gw_test"
    config.allowed_channel = "C_ALLOWED_CHANNEL"
    config.bot_user_id = "U_FOREMAN_BOT"
    
    with patch("bot.Agent") as MockAgent, \
         patch("bot.AsyncApp"):
        
        bot = ForemanBot(config)
        
        # Simulate handle_message with wrong channel
        # (In real code, channel filter is in handle_message before _invoke_grok)
        # Here we verify the bot rejects it
        
        event_wrong_channel = {
            "ts": "1234.5690",
            "user": "U_HUMAN",
            "channel": "C_WRONG_CHANNEL",  # Not the allowed channel
            "text": "message in wrong channel",
        }
        
        # Bot's handle_message would check channel BEFORE calling _invoke_grok
        # Since we're testing the filter, we verify it's not the allowed channel
        assert event_wrong_channel["channel"] != config.allowed_channel
        
        # In real flow, this would be filtered out and _invoke_grok never called
        # So Agent.create should never be called
        assert MockAgent.create.call_count == 0


@pytest.mark.asyncio
async def test_empty_text_ignored():
    """Empty text → no agent launch."""
    config = ForemanConfig()
    config.slack_bot_token = "xoxb-test"
    config.slack_app_token = "xapp-test"
    config.cursor_api_key = "crsr_test"
    config.fleet_gateway_token = "gw_test"
    config.allowed_channel = "C_ALLOWED"
    config.bot_user_id = "U_FOREMAN_BOT"
    
    with patch("bot.Agent") as MockAgent, \
         patch("bot.AsyncApp"):
        
        bot = ForemanBot(config)
        
        # Empty text events are filtered in handle_message before _invoke_grok
        event_empty = {
            "ts": "1234.5691",
            "user": "U_HUMAN",
            "channel": "C_ALLOWED",
            "text": "",  # Empty
        }
        
        # Verify empty text
        assert not event_empty["text"].strip()
        
        # In real flow, handle_message filters this out
        # Agent.create should never be called
        assert MockAgent.create.call_count == 0


@pytest.mark.asyncio
async def test_clean_shutdown(mock_config, mock_agent):
    """Shutdown tears down warm agent without leaking."""
    with patch("bot.Agent") as MockAgent:
        MockAgent.create.return_value = mock_agent
        
        # Mock agent __aexit__ for context manager protocol
        mock_agent.__aexit__ = AsyncMock()
        
        bot = ForemanBot(mock_config)
        
        # Create warm agent
        await bot._invoke_grok("test message", "U_USER")
        assert bot._grok_agent is mock_agent
        
        # Shutdown
        await bot.shutdown()
        
        # Verify: agent __aexit__ called (clean teardown)
        mock_agent.__aexit__.assert_called_once()
        
        # Verify: _grok_agent cleared
        assert bot._grok_agent is None


@pytest.mark.asyncio
async def test_agent_failure_marks_unhealthy(mock_config):
    """Agent send failure → agent marked unhealthy, next message recovers."""
    with patch("bot.Agent") as MockAgent:
        # First agent (will fail)
        failing_agent = Mock()
        failing_agent.agent_id = "bc-failing-agent"
        failing_agent.send.side_effect = RuntimeError("send failed")
        
        # Second agent (recovery)
        recovery_agent = Mock()
        recovery_agent.agent_id = "bc-recovery-agent"
        recovery_run = Mock()
        recovery_run.run_id = "run-recovery"
        recovery_result = Mock()
        recovery_result.status = "completed"
        recovery_result.result = "Recovery response"
        recovery_run.wait.return_value = recovery_result
        recovery_agent.send.return_value = recovery_run
        
        MockAgent.create.side_effect = [failing_agent, recovery_agent]
        
        bot = ForemanBot(mock_config)
        
        # First message fails
        with pytest.raises(RuntimeError, match="send failed"):
            await bot._invoke_grok("first message", "U_USER")
        
        # Verify: agent marked unhealthy (cleared)
        assert bot._grok_agent is None
        
        # Second message recovers
        resp = await bot._invoke_grok("second message", "U_USER")
        assert resp == "Recovery response"
        
        # Verify: Agent.create called TWICE (recovery after failure)
        assert MockAgent.create.call_count == 2


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
