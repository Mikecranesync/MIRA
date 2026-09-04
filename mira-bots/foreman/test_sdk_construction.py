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


def _restore_installed_cursor_sdk():
    """Undo test_bot.py's MagicMock stub; fail closed if the package is missing."""
    stub = sys.modules.get("cursor_sdk")
    if stub is not None and getattr(stub, "__file__", None) is None:
        del sys.modules["cursor_sdk"]
    import cursor_sdk as installed  # noqa: F401

    assert getattr(installed, "__file__", None), "cursor_sdk must be the installed package"
    return installed


_restore_installed_cursor_sdk()

from importlib.metadata import version as _pkg_version  # noqa: E402

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
    _restore_installed_cursor_sdk()
    sys.modules.pop("foreman_bot_real_sdk", None)

    path = Path(__file__).resolve().parent / "bot.py"
    spec = importlib.util.spec_from_file_location("foreman_bot_real_sdk", path)
    assert spec is not None and spec.loader is not None
    mod = importlib.util.module_from_spec(spec)
    sys.modules["foreman_bot_real_sdk"] = mod
    spec.loader.exec_module(mod)
    return mod


def test_installed_sdk_is_real_package():
    """Bravo-checked install: AgentOptions has mcp_servers; CloudAgentOptions is repos/env only."""
    ver = _pkg_version("cursor-sdk")
    major, minor, *_rest = (int(p) for p in ver.split(".")[:3])
    assert (major, minor) >= (1, 0), ver
    assert CloudAgentOptions.__module__.startswith("cursor_sdk")
    cloud_params = set(inspect.signature(CloudAgentOptions).parameters)
    assert "mcpServers" not in cloud_params
    assert "mcp_servers" not in cloud_params
    assert "repos" in cloud_params
    assert "env" in cloud_params
    assert "mcp_servers" in inspect.signature(AgentOptions).parameters


def test_installed_sdk_cloud_agent_options_rejects_mcp_servers():
    """The live bug: CloudAgentOptions(... mcpServers=...) is invalid."""
    with pytest.raises(TypeError, match="unexpected keyword argument 'mcpServers'"):
        CloudAgentOptions(mcpServers=[{"name": "fleet-gateway"}])

    with pytest.raises(TypeError, match="unexpected keyword argument 'mcp_servers'"):
        CloudAgentOptions(mcp_servers={"fleet-gateway": {}})


def test_pre_fix_3fa02be_cloud_options_construction_raises():
    """Exact 3fa02be Foreman construction — still on Bravo's detached warm tree.

    CloudAgentOptions(repos=[{startingRef}], mcpServers=<list of dicts>).
    """
    mcp_servers = [
        {
            "name": "fleet-gateway",
            "type": "http",
            "url": "https://gw.example/mcp",
            "headers": [
                {"name": "Authorization", "value": "Bearer gw-token"},
            ],
        }
    ]
    with pytest.raises(TypeError, match="unexpected keyword argument 'mcpServers'"):
        CloudAgentOptions(
            repos=[
                {
                    "url": "https://github.com/Mikecranesync/MIRA",
                    "startingRef": "main",
                }
            ],
            mcpServers=mcp_servers,
        )


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


def test_bot_source_never_passes_mcpservers_kwarg():
    src = Path(__file__).resolve().parent.joinpath("bot.py").read_text()
    assert "mcpServers=" not in src
    assert "build_agent_options(" in src
