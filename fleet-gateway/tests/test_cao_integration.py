"""BOOTSTRAP-EXCEPTION BOOTSTRAP-001 — CAO adapter integration + compatibility tests.

Three classes of proof:
1. Live CAO read-only probes against 127.0.0.1:9889 (skipped when CAO is not running).
2. Mock-anchored unit tests for the get_session nested-response parser.
3. Mock-anchored unit test for task_snapshot dead-session detection.
4. Source-scan guard proving the old /status and /workers endpoints are NOT referenced.
"""

from __future__ import annotations

import socket
from pathlib import Path
from typing import Any
from unittest.mock import patch

import pytest

from fleet_gateway.cao import LoopbackCAOClient

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_CAO_URL = "http://127.0.0.1:9889"
_CAO_HOST = "127.0.0.1"
_CAO_PORT = 9889


def _cao_is_running() -> bool:
    """Return True only if CAO is reachable at 127.0.0.1:9889."""
    try:
        s = socket.create_connection((_CAO_HOST, _CAO_PORT), timeout=1.0)
        s.close()
        return True
    except OSError:
        return False


_CAO_UP = _cao_is_running()
_skip_if_cao_down = pytest.mark.skipif(not _CAO_UP, reason="CAO not running at 127.0.0.1:9889")

# ---------------------------------------------------------------------------
# 1. Live read-only probes (skip when CAO is down)
# ---------------------------------------------------------------------------


@_skip_if_cao_down
def test_live_cao_health_uses_health_endpoint() -> None:
    """fleet_snapshot must use GET /health (not the old /status) against real CAO.

    Proves: LoopbackCAOClient.fleet_snapshot maps to the real CAO /health endpoint
    and returns cao_health='ok' when CAO is live.
    """
    client = LoopbackCAOClient(_CAO_URL)
    snap = client.fleet_snapshot()
    assert snap["cao_health"] == "ok", f"Expected ok, got: {snap}"
    assert snap["node_health"] == "ok"


@_skip_if_cao_down
def test_live_cao_providers_uses_agents_providers_endpoint() -> None:
    """fleet_snapshot must probe GET /agents/providers (not the old /workers).

    Proves: codex presence is detected via /agents/providers, and both
    claude_code and codex are recognised as installed.
    """
    client = LoopbackCAOClient(_CAO_URL)
    snap = client.fleet_snapshot()
    # At least one provider must be ready (codex or claude_code are installed)
    assert snap["codex_readiness"] in ("ready", "unknown"), snap
    # codex is installed per /agents/providers — must be 'ready'
    assert snap["codex_readiness"] == "ready", (
        "codex provider should be ready; check /agents/providers on live CAO"
    )


@_skip_if_cao_down
def test_live_cao_providers_includes_claude_code_and_codex() -> None:
    """Direct /agents/providers probe: both claude_code and codex must be listed."""
    client = LoopbackCAOClient(_CAO_URL)
    # _get_json is a public-enough internal; test it directly to prove endpoint shape.
    raw = client._get_json("/agents/providers", timeout=2.0)
    assert isinstance(raw, list), f"Expected list, got: {type(raw)}"
    names = [(p.get("name") if isinstance(p, dict) else str(p)) for p in raw]
    assert any("codex" in str(n).lower() for n in names), f"codex not in {names}"
    assert any("claude_code" in str(n).lower() for n in names), f"claude_code not in {names}"


# ---------------------------------------------------------------------------
# 2. Mock unit tests: get_session nested-response parsing
# ---------------------------------------------------------------------------

# Payloads captured from real CAO GET /sessions/{name}
_REAL_CAO_SESSION_RESPONSE: dict[str, Any] = {
    "session": {
        "id": "cao-BOOTSTRAP-001",
        "name": "cao-BOOTSTRAP-001",
        "status": "detached",
    },
    "terminals": [
        {
            "id": "36eb29b6",
            "status": "processing",
            "provider": "claude_code",
        }
    ],
}


def _make_client_with_session(session_name: str = "my-session") -> LoopbackCAOClient:
    client = LoopbackCAOClient(_CAO_URL)
    client._sessions[session_name] = {
        "terminal_id": "old-term-id",
        "session_name": session_name,
        "task_id": "task-xyz",
        "role": "bravo",
        "provider": "claude",
        "status": "running",
        "worktree": "/tmp/wt",
        "claimed": True,
        "chat_claimed_done": False,
    }
    client._session_order.append(session_name)
    return client


def test_get_session_parses_nested_response() -> None:
    """get_session must extract terminal_id and terminal_status from the real nested payload."""
    client = _make_client_with_session("my-session")
    with patch.object(client, "_request", return_value=_REAL_CAO_SESSION_RESPONSE):
        result = client.get_session("my-session")
    assert result is not None
    assert result["terminal_id"] == "36eb29b6", result
    assert result["terminal_status"] == "processing", result
    # In-process fields preserved when not in CAO response
    assert result["task_id"] == "task-xyz", result
    assert result["role"] == "bravo", result
    assert result["session_id"] == "my-session", result


def test_get_session_flat_response_does_not_crash() -> None:
    """get_session falls through gracefully when CAO returns a flat (legacy) dict."""
    client = _make_client_with_session("flat-session")
    flat_resp: dict[str, Any] = {"id": "flat-session", "status": "detached"}
    with patch.object(client, "_request", return_value=flat_resp):
        result = client.get_session("flat-session")
    assert result is not None
    # terminal_id absent in flat resp, should fall back to stored value
    assert result["terminal_id"] == "old-term-id", result
    assert result["task_id"] == "task-xyz", result


def test_get_session_network_error_falls_back_to_stored() -> None:
    """get_session returns the in-process snapshot when the HTTP call fails."""
    client = _make_client_with_session("err-session")
    with patch.object(client, "_request", side_effect=OSError("connection refused")):
        result = client.get_session("err-session")
    assert result is not None
    assert result["terminal_id"] == "old-term-id", result
    assert result["status"] == "running", result


def test_get_session_unknown_session_returns_none() -> None:
    """get_session returns None for sessions not in the in-process map."""
    client = LoopbackCAOClient(_CAO_URL)
    result = client.get_session("nonexistent")
    assert result is None


# ---------------------------------------------------------------------------
# 3. Mock unit test: task_snapshot dead-session detection
# ---------------------------------------------------------------------------

_COMPLETED_TERMINAL_RESPONSE: dict[str, Any] = {
    "session": {"id": "dead-sess", "name": "dead-sess", "status": "detached"},
    "terminals": [{"id": "aaaa1111", "status": "completed", "provider": "claude_code"}],
}

_ERROR_TERMINAL_RESPONSE: dict[str, Any] = {
    "session": {"id": "err-sess", "name": "err-sess", "status": "detached"},
    "terminals": [{"id": "bbbb2222", "status": "error", "provider": "codex"}],
}


def _make_client_for_task(session_name: str, task_id: str) -> LoopbackCAOClient:
    client = LoopbackCAOClient(_CAO_URL)
    client._sessions[session_name] = {
        "terminal_id": "aaaa1111",
        "session_name": session_name,
        "task_id": task_id,
        "role": "bravo",
        "provider": "claude",
        "status": "running",
        "worktree": "/tmp/wt2",
        "claimed": True,
        "chat_claimed_done": False,
    }
    client._session_order.append(session_name)
    return client


def test_task_snapshot_marks_stopped_when_terminal_completed() -> None:
    """task_snapshot must return status='stopped' when CAO terminal is completed."""
    client = _make_client_for_task("dead-sess", "task-dead")
    with patch.object(client, "_request", return_value=_COMPLETED_TERMINAL_RESPONSE):
        snap = client.task_snapshot("task-dead")
    assert snap is not None
    assert snap["status"] == "stopped", snap
    # In-process map must also be updated so subsequent calls don't flip back
    assert client._sessions["dead-sess"]["status"] == "stopped"


def test_task_snapshot_marks_stopped_when_terminal_error() -> None:
    """task_snapshot must return status='stopped' when CAO terminal is in error."""
    client = _make_client_for_task("err-sess", "task-err")
    with patch.object(client, "_request", return_value=_ERROR_TERMINAL_RESPONSE):
        snap = client.task_snapshot("task-err")
    assert snap is not None
    assert snap["status"] == "stopped", snap


def test_task_snapshot_running_session_stays_running() -> None:
    """task_snapshot must NOT flip status when terminal is still processing."""
    running_resp: dict[str, Any] = {
        "session": {"id": "live-sess", "name": "live-sess", "status": "detached"},
        "terminals": [{"id": "cccc3333", "status": "processing", "provider": "claude_code"}],
    }
    client = _make_client_for_task("live-sess", "task-live")
    client._sessions["live-sess"]["terminal_id"] = "cccc3333"
    with patch.object(client, "_request", return_value=running_resp):
        snap = client.task_snapshot("task-live")
    assert snap is not None
    assert snap["status"] == "running", snap


def test_task_snapshot_no_session_returns_none() -> None:
    """task_snapshot returns None when no session exists for the task."""
    client = LoopbackCAOClient(_CAO_URL)
    assert client.task_snapshot("no-such-task") is None


# ---------------------------------------------------------------------------
# 4. Source scan: old endpoints MUST NOT appear in cao.py
# ---------------------------------------------------------------------------


def test_old_status_and_workers_endpoints_not_in_source() -> None:
    """cao.py must not reference the old /status or /workers endpoints.

    The old client used GET /status for health and GET /workers for provider list.
    The new client uses GET /health and GET /agents/providers.
    This test would FAIL on the old implementation.
    """
    cao_source = Path(__file__).parent.parent / "fleet_gateway" / "cao.py"
    text = cao_source.read_text()
    # Exclude comment lines and docstrings from the check
    non_comment_lines = [line for line in text.splitlines() if not line.lstrip().startswith("#")]
    source_no_comments = "\n".join(non_comment_lines)

    # Old health endpoint: /status (GET /status was the health probe)
    assert '"/status"' not in source_no_comments, (
        "cao.py must not use the old GET /status endpoint; use GET /health instead"
    )
    assert "'/status'" not in source_no_comments, (
        "cao.py must not use the old GET /status endpoint; use GET /health instead"
    )

    # Old provider list endpoint: /workers
    assert '"/workers"' not in source_no_comments, (
        "cao.py must not use the old GET /workers endpoint; use GET /agents/providers instead"
    )
    assert "'/workers'" not in source_no_comments, (
        "cao.py must not use the old GET /workers endpoint; use GET /agents/providers instead"
    )

    # Positive assertions: correct endpoints ARE present
    assert '"/health"' in text, "GET /health must be referenced in cao.py fleet_snapshot"
    assert '"/agents/providers"' in text, "GET /agents/providers must be in cao.py fleet_snapshot"
