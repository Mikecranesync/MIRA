#!/usr/bin/env python3
"""Regression tests against the *installed* cursor-sdk agent-construction path.

test_bot.py stubs cursor_sdk with MagicMock so it cannot catch:
  CloudAgentOptions.__init__() got an unexpected keyword argument 'mcpServers'

This file loads bot.py under a separate module name against the real SDK.
No Agent.create network call. No tokens. No Gateway.
"""

from __future__ import annotations

import importlib.util
import inspect
import sys
from pathlib import Path

import pytest

# If a sibling test stubbed cursor_sdk, drop the stub so we inspect the install.
_stub = sys.modules.get("cursor_sdk")
if _stub is not None and getattr(_stub, "__file__", None) is None:
    del sys.modules["cursor_sdk"]

cursor_sdk = pytest.importorskip("cursor_sdk")

from cursor_sdk import (  # noqa: E402
    Agent,
    AgentOptions,
    CloudAgentOptions,
    HttpMcpServerConfig,
)


def _load_bot_against_real_sdk():
    """Exec bot.py as a unique module bound to the installed cursor_sdk.

    test_bot.py stubs sys.modules['cursor_sdk'] at collection time, so this
    must restore the real package immediately before exec.
    """
    stub = sys.modules.get("cursor_sdk")
    if stub is not None and getattr(stub, "__file__", None) is None:
        del sys.modules["cursor_sdk"]
    sys.modules.pop("foreman_bot_real_sdk", None)
    import cursor_sdk as _real_sdk  # noqa: F401

    path = Path(__file__).resolve().parent / "bot.py"
    spec = importlib.util.spec_from_file_location("foreman_bot_real_sdk", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["foreman_bot_real_sdk"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_installed_sdk_cloud_agent_options_rejects_mcp_servers():
    """The live bug: CloudAgentOptions(... mcpServers=...) is invalid."""
    params = inspect.signature(CloudAgentOptions).parameters
    assert "mcpServers" not in params
    assert "mcp_servers" not in params

    with pytest.raises(TypeError, match="unexpected keyword argument 'mcpServers'"):
        CloudAgentOptions(mcpServers=[{"name": "fleet-gateway"}])

    with pytest.raises(TypeError, match="unexpected keyword argument 'mcp_servers'"):
        CloudAgentOptions(mcp_servers={"fleet-gateway": {}})


def test_installed_sdk_agent_create_has_no_mcp_servers_kwarg():
    """Bare Agent.create(..., mcp_servers=) is not a supported location."""
    params = inspect.signature(Agent.create).parameters
    assert "mcp_servers" not in params
    assert "mcpServers" not in params
    assert "options" in params


def test_installed_sdk_agent_options_accepts_mcp_servers_with_bearer():
    """Supported location: AgentOptions.mcp_servers + HttpMcpServerConfig headers."""
    params = inspect.signature(AgentOptions).parameters
    assert "mcp_servers" in params

    opts = AgentOptions(
        model="grok-4.6",
        api_key="crsr_test",
        cloud=CloudAgentOptions(repos=[]),
        mcp_servers={
            "fleet-gateway": HttpMcpServerConfig(
                url="https://example.invalid/mcp",
                headers={"Authorization": "Bearer test-token"},
            )
        },
    )
    assert isinstance(opts, AgentOptions)
    gw = opts.mcp_servers["fleet-gateway"]
    assert isinstance(gw, HttpMcpServerConfig)
    assert gw.url == "https://example.invalid/mcp"
    assert gw.headers["Authorization"] == "Bearer test-token"
    assert not hasattr(opts.cloud, "mcp_servers")
    assert not hasattr(opts.cloud, "mcpServers")


def test_bot_build_agent_options_uses_real_sdk_path():
    """Foreman construction helper hits AgentOptions.mcp_servers with bearer auth."""
    bot = _load_bot_against_real_sdk()
    config = bot.ForemanConfig()
    config.cursor_api_key = "crsr_test"
    config.fleet_gateway_token = "gw-token"
    config.fleet_gateway_url = "https://gw.example/mcp"
    config.grok_model = "grok-4.6"
    config.repo_url = "https://github.com/Mikecranesync/MIRA"
    config.repo_branch = "main"

    opts = bot.build_agent_options(config)

    assert isinstance(opts, AgentOptions)
    assert isinstance(opts.cloud, CloudAgentOptions)
    assert opts.model == "grok-4.6"
    assert opts.api_key == "crsr_test"
    assert opts.mcp_servers is not None
    assert set(opts.mcp_servers) == {"fleet-gateway"}
    gw = opts.mcp_servers["fleet-gateway"]
    assert isinstance(gw, HttpMcpServerConfig)
    assert gw.url == "https://gw.example/mcp"
    assert gw.headers["Authorization"] == "Bearer gw-token"
    assert not hasattr(opts.cloud, "mcpServers")
    assert not hasattr(opts.cloud, "mcp_servers")
    assert opts.cloud.repos[0].url == config.repo_url
    assert opts.cloud.repos[0].starting_ref == config.repo_branch


def test_bot_build_agent_options_omits_mcp_without_token():
    bot = _load_bot_against_real_sdk()
    config = bot.ForemanConfig()
    config.cursor_api_key = "crsr_test"
    config.fleet_gateway_token = ""
    config.fleet_gateway_url = "https://gw.example/mcp"
    config.grok_model = "grok-4.6"

    opts = bot.build_agent_options(config)
    assert opts.mcp_servers is None
