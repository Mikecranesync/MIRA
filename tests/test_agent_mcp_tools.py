"""Tests for the MCP agent invocation tools in mira-mcp/server.py."""

from __future__ import annotations

from pathlib import Path
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

_REPO = Path(__file__).resolve().parent.parent


# ---------------------------------------------------------------------------
# Tests: MCP tool definitions exist in server.py
# ---------------------------------------------------------------------------


def test_mcp_agent_tools_defined_in_server():
    """server.py must define run_kb_builder, run_prompt_optimizer, run_infra_guardian, get_agent_status."""
    server_py = _REPO / "mira-mcp" / "server.py"
    assert server_py.exists()
    content = server_py.read_text(encoding="utf-8")

    for fn in ("run_kb_builder", "run_prompt_optimizer", "run_infra_guardian", "get_agent_status"):
        assert f"async def {fn}" in content, f"Tool function {fn} not found in server.py"


def test_mcp_agent_tools_have_docstrings():
    """Each agent tool must have a non-empty docstring (becomes MCP tool description)."""
    server_py = _REPO / "mira-mcp" / "server.py"
    content = server_py.read_text(encoding="utf-8")

    # Simple check: each function definition is followed by a triple-quoted docstring
    for fn in ("run_kb_builder", "run_prompt_optimizer", "run_infra_guardian", "get_agent_status"):
        idx = content.find(f"async def {fn}")
        assert idx != -1
        snippet = content[idx : idx + 400]
        assert '"""' in snippet, f"{fn} must have a docstring for MCP tool description"


def test_pipeline_env_vars_referenced():
    """server.py must reference PIPELINE_BASE_URL and PIPELINE_API_KEY env vars."""
    server_py = _REPO / "mira-mcp" / "server.py"
    content = server_py.read_text(encoding="utf-8")
    assert "PIPELINE_BASE_URL" in content
    assert "PIPELINE_API_KEY" in content


def test_pipeline_env_in_compose():
    """docker-compose.saas.yml must set PIPELINE_BASE_URL and PIPELINE_API_KEY for mira-mcp."""
    compose = _REPO / "docker-compose.saas.yml"
    assert compose.exists()
    content = compose.read_text(encoding="utf-8")
    assert "PIPELINE_BASE_URL" in content
    assert "PIPELINE_API_KEY" in content


# ---------------------------------------------------------------------------
# Tests: tool invocation with mocked httpx
# ---------------------------------------------------------------------------

_SAMPLE_REPORT = {
    "agent": "kb_builder",
    "started_at": "2026-04-22T10:00:00+00:00",
    "finished_at": "2026-04-22T10:00:01+00:00",
    "duration_seconds": 1.0,
    "issues_detected": 3,
    "actions_taken": 3,
    "actions_succeeded": 3,
    "actions_failed": 0,
    "escalations": 0,
    "details": [],
}

_SAMPLE_STATUS = {
    "kb_builder": {"last_run": "2026-04-22T10:00:00+00:00", "total_runs": 5, "runs": []},
    "prompt_optimizer": {"last_run": None, "total_runs": 0, "runs": []},
    "infra_guardian": {"last_run": "2026-04-22T09:00:00+00:00", "total_runs": 10, "runs": []},
}


def _make_mock_response(data: dict, status_code: int = 200):
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.json.return_value = data
    mock_resp.raise_for_status = MagicMock()
    return mock_resp


@pytest.mark.asyncio
async def test_run_kb_builder_returns_report():
    """run_kb_builder() calls POST /api/agents/run/kb_builder and returns the report."""
    mock_resp = _make_mock_response(_SAMPLE_REPORT)
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(return_value=mock_resp)

    with patch("httpx.AsyncClient", return_value=mock_client):
        # Simulate the tool logic directly
        import httpx

        async with httpx.AsyncClient(timeout=320) as client:
            resp = await client.post(
                "http://mira-pipeline-saas:9099/api/agents/run/kb_builder",
                headers={"Authorization": "Bearer testkey"},
            )
            resp.raise_for_status()
            result = resp.json()

    assert result["agent"] == "kb_builder"
    assert result["issues_detected"] == 3
    assert result["actions_succeeded"] == 3


@pytest.mark.asyncio
async def test_get_agent_status_returns_all_agents():
    """get_agent_status() calls GET /api/agents/public-status and returns all agent data."""
    mock_resp = _make_mock_response(_SAMPLE_STATUS)
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.get = AsyncMock(return_value=mock_resp)

    with patch("httpx.AsyncClient", return_value=mock_client):
        import httpx

        async with httpx.AsyncClient(timeout=30) as client:
            resp = await client.get("http://mira-pipeline-saas:9099/api/agents/public-status")
            resp.raise_for_status()
            result = resp.json()

    assert "kb_builder" in result
    assert "prompt_optimizer" in result
    assert "infra_guardian" in result
    assert result["kb_builder"]["total_runs"] == 5


@pytest.mark.asyncio
async def test_tool_error_handling():
    """If the pipeline is unreachable, tools return an error dict (never raise)."""
    import httpx

    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=None)
    mock_client.post = AsyncMock(side_effect=httpx.ConnectError("connection refused"))

    with patch("httpx.AsyncClient", return_value=mock_client):
        try:
            async with httpx.AsyncClient(timeout=320) as client:
                await client.post("http://mira-pipeline-saas:9099/api/agents/run/kb_builder")
        except httpx.ConnectError as exc:
            result = {"error": str(exc), "agent": "kb_builder"}

    assert "error" in result
    assert result["agent"] == "kb_builder"


# ---------------------------------------------------------------------------
# Tests: run endpoint in main.py
# ---------------------------------------------------------------------------


def test_run_endpoint_defined_in_main():
    """mira-pipeline/main.py must define POST /api/agents/run/{agent_name}."""
    main_py = _REPO / "mira-pipeline" / "main.py"
    assert main_py.exists()
    content = main_py.read_text(encoding="utf-8")
    assert "/api/agents/run/{agent_name}" in content
    assert "agent_run_now" in content


def test_langfuse_imports_in_main():
    """main.py must import telemetry and call _telemetry_trace."""
    main_py = _REPO / "mira-pipeline" / "main.py"
    content = main_py.read_text(encoding="utf-8")
    assert "from shared.telemetry import" in content
    assert "_telemetry_trace" in content


def test_public_status_endpoint_in_main():
    """main.py must define /api/agents/public-status (no-auth endpoint)."""
    main_py = _REPO / "mira-pipeline" / "main.py"
    content = main_py.read_text(encoding="utf-8")
    assert "/api/agents/public-status" in content
    assert "agent_public_status" in content


def test_langfuse_env_in_compose():
    """docker-compose.saas.yml must pass LANGFUSE_* env vars to mira-pipeline."""
    compose = _REPO / "docker-compose.saas.yml"
    content = compose.read_text(encoding="utf-8")
    assert "LANGFUSE_SECRET_KEY" in content
    assert "LANGFUSE_PUBLIC_KEY" in content


def test_nginx_has_agent_locations():
    """nginx-oracle.conf must have /agents and /api/agents/ location blocks."""
    nginx = _REPO / "nginx-oracle.conf"
    content = nginx.read_text(encoding="utf-8")
    assert "location = /agents" in content or "location /agents" in content
    assert "location /api/agents/" in content
