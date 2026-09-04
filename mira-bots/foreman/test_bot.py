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

from bot import (  # noqa: E402
    AgentOptions,
    CloudAgentOptions,
    DEFAULT_GROK_MODEL,
    ForemanBot,
    ForemanConfig,
    HttpMcpServerConfig,
)


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
    config.grok_model = "grok-4.6"
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
    """bot_id / own user / bot subtypes → handle_message drops, no Agent.create, no say."""
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
        mock_say = AsyncMock()
        
        # Test 1: bot_id present
        event_bot_id = {
            "ts": "1234.5678",
            "bot_id": "B_OTHER_BOT",
            "channel": "C_ALLOWED",
            "text": "message from other bot",
        }
        await bot.handle_message(event_bot_id, mock_say)
        
        # Test 2: user is Foreman's own bot_user_id
        event_own_user = {
            "ts": "1234.5679",
            "user": "U_FOREMAN_BOT",
            "channel": "C_ALLOWED",
            "text": "foreman's own message",
        }
        await bot.handle_message(event_own_user, mock_say)
        
        # Test 3: bot_message subtype
        event_bot_subtype = {
            "ts": "1234.5680",
            "subtype": "bot_message",
            "channel": "C_ALLOWED",
            "text": "message with bot subtype",
        }
        await bot.handle_message(event_bot_subtype, mock_say)
        
        # Test 4: message_changed subtype
        event_changed_subtype = {
            "ts": "1234.5681",
            "subtype": "message_changed",
            "channel": "C_ALLOWED",
            "text": "changed message",
        }
        await bot.handle_message(event_changed_subtype, mock_say)
        
        # Test 5: message_deleted subtype
        event_deleted_subtype = {
            "ts": "1234.5682",
            "subtype": "message_deleted",
            "channel": "C_ALLOWED",
        }
        await bot.handle_message(event_deleted_subtype, mock_say)
        
        # Verify: No Agent.create calls (all bot events dropped before agent access)
        assert MockAgent.create.call_count == 0
        
        # Verify: say never called (no responses posted)
        assert mock_say.call_count == 0


@pytest.mark.asyncio
async def test_channel_filter():
    """Wrong channel → handle_message drops, no Agent.create, no say."""
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
        mock_say = AsyncMock()
        
        # Human message in WRONG channel
        event_wrong_channel = {
            "ts": "1234.5690",
            "user": "U_HUMAN",
            "channel": "C_WRONG_CHANNEL",  # Not the allowed channel
            "text": "message in wrong channel",
        }
        
        await bot.handle_message(event_wrong_channel, mock_say)
        
        # Verify: No Agent.create (channel filter drops before agent access)
        assert MockAgent.create.call_count == 0
        
        # Verify: say never called (no response posted)
        assert mock_say.call_count == 0


@pytest.mark.asyncio
async def test_empty_text_ignored():
    """Empty text → handle_message drops, no Agent.create, no say."""
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
        mock_say = AsyncMock()
        
        # Human message with empty text
        event_empty = {
            "ts": "1234.5691",
            "user": "U_HUMAN",
            "channel": "C_ALLOWED",
            "text": "",  # Empty
        }
        
        await bot.handle_message(event_empty, mock_say)
        
        # Verify: No Agent.create (empty text filter drops before agent access)
        assert MockAgent.create.call_count == 0
        
        # Verify: say never called (no response posted)
        assert mock_say.call_count == 0


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


def test_default_grok_model_is_grok_46(monkeypatch):
    """FOREMAN_GROK_MODEL defaults to the live-proven Cursor id grok-4.6."""
    monkeypatch.delenv("FOREMAN_GROK_MODEL", raising=False)
    config = ForemanConfig()
    assert DEFAULT_GROK_MODEL == "grok-4.6"
    assert config.grok_model == "grok-4.6"


def test_foreman_grok_model_env_override(monkeypatch):
    """FOREMAN_GROK_MODEL env wins over the default."""
    monkeypatch.setenv("FOREMAN_GROK_MODEL", "grok-4.6")
    config = ForemanConfig()
    assert config.grok_model == "grok-4.6"
    monkeypatch.setenv("FOREMAN_GROK_MODEL", "composer-2.5")
    config = ForemanConfig()
    assert config.grok_model == "composer-2.5"


@pytest.mark.asyncio
async def test_create_puts_mcp_servers_on_agent_options(mock_config, mock_agent):
    """Agent.create(AgentOptions(mcp_servers=...)) — not CloudAgentOptions / bare kwargs.

    Live proof 2026-09-04: fleet-gateway only bound when mcp_servers sat on
    AgentOptions. CloudAgentOptions.mcpServers and Agent.create(..., mcp_servers=)
    left the tools unbound.
    """
    AgentOptions.reset_mock()
    CloudAgentOptions.reset_mock()
    HttpMcpServerConfig.reset_mock()

    with patch("bot.Agent") as MockAgent:
        MockAgent.create.return_value = mock_agent

        bot = ForemanBot(mock_config)
        await bot._ensure_agent()

        AgentOptions.assert_called_once()
        opts = AgentOptions.call_args.kwargs
        assert opts["api_key"] == mock_config.cursor_api_key
        assert opts["model"] == mock_config.grok_model
        assert opts["mcp_servers"] is not None
        assert "fleet-gateway" in opts["mcp_servers"]

        HttpMcpServerConfig.assert_called_once()
        http_kwargs = HttpMcpServerConfig.call_args.kwargs
        assert http_kwargs["url"] == mock_config.fleet_gateway_url
        assert http_kwargs["headers"]["Authorization"] == (
            f"Bearer {mock_config.fleet_gateway_token}"
        )

        CloudAgentOptions.assert_called_once()
        cloud_kwargs = CloudAgentOptions.call_args.kwargs
        assert "mcp_servers" not in cloud_kwargs
        assert "mcpServers" not in cloud_kwargs
        assert "repos" in cloud_kwargs

        # First positional arg is the AgentOptions instance, not bare kwargs.
        MockAgent.create.assert_called_once_with(AgentOptions.return_value)
        assert MockAgent.create.call_args.kwargs == {}


@pytest.mark.asyncio
async def test_missing_gateway_omits_mcp_servers(mock_config, mock_agent):
    """No gateway URL/token → AgentOptions.mcp_servers is None."""
    AgentOptions.reset_mock()
    mock_config.fleet_gateway_token = ""

    with patch("bot.Agent") as MockAgent:
        MockAgent.create.return_value = mock_agent
        bot = ForemanBot(mock_config)
        await bot._ensure_agent()

        opts = AgentOptions.call_args.kwargs
        assert opts["mcp_servers"] is None


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
