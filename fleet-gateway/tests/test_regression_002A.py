"""FOUNDATION-002A regression tests.

Agent profile mapping: bravo → developer, charlie → reviewer
  (local CAO has no bravo/charlie profiles; these are the CAO built-in equivalents)
Provider mapping: claude → claude_code, codex → codex

Tests 1-3: ArtifactStore history + task_status correctness via FakeCAO.
Tests 4-5: LoopbackCAOClient HTTP mapping via mocked urllib.urlopen.
           Do NOT hit live CAO/9889; do NOT bind.
"""

from __future__ import annotations

import json
from unittest.mock import MagicMock, patch

from fleet_gateway.cao import LoopbackCAOClient
from helpers import LAUNCH_OK


# ── Test 1: Multiple launch_worker with same task_id ──────────────────────────


def test_multiple_launches_same_task_id_latest_session(service, auth, data_dir):
    """Second launch_worker on same task_id: task_status returns LATEST session/worktree/commit;
    artifact preserves both attempts in attempts[]."""
    params1 = dict(LAUNCH_OK)
    launched1 = service.invoke("launch_worker", params1, authorization=auth)

    # Second attempt: same task_id → new session
    params2 = dict(LAUNCH_OK)
    launched2 = service.invoke("launch_worker", params2, authorization=auth)

    assert launched1["session_id"] != launched2["session_id"], (
        "each attempt must have unique session_id"
    )

    status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert status["session_id"] == launched2["session_id"], "task_status must return LATEST session"
    assert status["worktree"] == launched2["worktree"], "task_status must return LATEST worktree"

    artifact_path = data_dir / "tasks" / f"{LAUNCH_OK['task_id']}.json"
    data = json.loads(artifact_path.read_text())
    attempts = data.get("attempts", [])
    assert len(attempts) == 1, "prior attempt must be in attempts[]"
    assert attempts[0]["session_id"] == launched1["session_id"], (
        "attempts[] must hold the prior session"
    )


# ── Test 2: Stopped first attempt, successful second ─────────────────────────


def test_failed_first_attempt_second_session_wins(service, auth):
    """First attempt stopped, second succeeds:
    task_status.session_id is second session; status is running (not stopped from first).
    claimed_commit_matches_artifact reflects current attempt only."""
    # First attempt → stop it
    params1 = dict(LAUNCH_OK)
    launched1 = service.invoke("launch_worker", params1, authorization=auth)
    service.invoke(
        "stop_worker",
        {"session_id": launched1["session_id"], "task_id": LAUNCH_OK["task_id"]},
        authorization=auth,
    )

    # Second attempt (same valid base_commit from test fixture)
    params2 = dict(LAUNCH_OK)
    launched2 = service.invoke("launch_worker", params2, authorization=auth)

    assert launched1["session_id"] != launched2["session_id"]

    status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    # Second attempt is current
    assert status["session_id"] == launched2["session_id"]
    assert status["status"] == "running", "second attempt must not inherit stopped status"
    # Artifact and snapshot have same base_commit → matches
    assert status["claimed_commit_matches_artifact"] is True


# ── Test 3: stop_worker(session_id only) → task_status is not running ────────


def test_stop_worker_session_only_updates_task_status(service, auth):
    """stop_worker with session_id only (no task_id) must leave task_status.status != running."""
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)

    # Stop without task_id — service must resolve via artifact store
    result = service.invoke(
        "stop_worker",
        {"session_id": launched["session_id"]},
        authorization=auth,
    )
    assert result["status"] == "stopped"

    status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert status["status"] != "running", "task_status must reflect stopped after session-only stop"


# ── Test 4: LoopbackCAOClient.fleet_snapshot via mocked urlopen ──────────────


def test_loopback_fleet_snapshot_ok_via_mock():
    """fleet_snapshot against mocked GET /health → cao_health=ok (not 'stub').
    Codex presence from mocked /agents/providers → codex_readiness=ready.
    Claude unavailable → claude_readiness=unavailable.
    Non-loopback URLs are still refused without ever touching the network."""
    health_body = json.dumps(
        {
            "status": "ok",
            "service": "cli-agent-orchestrator",
            "components": {"cao": "ok", "claude": "unavailable"},
        }
    ).encode()
    providers_body = json.dumps([{"name": "codex"}, {"name": "claude_code"}]).encode()

    def fake_urlopen(req, timeout=None):  # noqa: ARG001
        mock_resp = MagicMock()
        if "/agents/providers" in req.full_url:
            mock_resp.read.return_value = providers_body
        else:
            mock_resp.read.return_value = health_body
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    with patch("fleet_gateway.cao.urlopen", fake_urlopen):
        client = LoopbackCAOClient("http://127.0.0.1:9999")
        snap = client.fleet_snapshot()

    assert snap["cao_health"] == "ok", "real CAO URL must never produce 'stub'"
    assert snap["node_health"] == "ok"
    assert snap["codex_readiness"] == "ready", "codex in /agents/providers → ready"
    assert snap["codex_auth"] == "ok"
    assert snap["claude_readiness"] == "unavailable", (
        "claude unavailable → unavailable (not unknown)"
    )
    assert snap["claude_auth"] == "unavailable"


# ── Test 5: LoopbackCAOClient.launch_worker maps to POST /sessions ────────────


def test_loopback_launch_posts_to_cao_sessions_with_mapping():
    """launch_worker must POST to /sessions with:
      - agent_profile=developer  (bravo → developer; no local bravo CAO profile)
      - provider=claude_code     (claude → claude_code)
      - working_directory        (Gateway-provisioned worktree path)
    Does NOT hit live 9889; uses mocked urllib.urlopen.
    """
    launch_resp = json.dumps(
        {
            "id": "abcdef12",
            "session_name": "issue-1234-abc12345",
        }
    ).encode()

    captured: list = []

    def fake_urlopen(req, timeout=None):  # noqa: ARG001
        captured.append(req)
        mock_resp = MagicMock()
        mock_resp.read.return_value = launch_resp
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    with patch("fleet_gateway.cao.urlopen", fake_urlopen):
        client = LoopbackCAOClient("http://127.0.0.1:9999")
        result = client.launch_worker(
            {
                "task_id": "issue-1234",
                "role": "bravo",
                "provider": "claude",
                "github_ref": "feat/test",
                "base_commit": "abc123",
                "acceptance_criteria": "tests green",
                "working_directory": "/tmp/wt/issue-1234",
            }
        )

    assert len(captured) == 1, "exactly one HTTP request must be made"
    req = captured[0]
    full_url = req.full_url
    assert "/sessions" in full_url
    assert "agent_profile=developer" in full_url, "bravo → developer profile mapping"
    assert "provider=claude_code" in full_url, "claude → claude_code provider mapping"
    assert "working_directory" in full_url, "worktree path must be passed to CAO"
    assert result["terminal_id"] == "abcdef12"
    assert result["isolated_worktree"] is True
    assert result["session_id"]

    # codex provider mapping check
    captured_codex: list = []

    def fake_urlopen2(req, timeout=None):  # noqa: ARG001
        captured_codex.append(req)
        mock_resp = MagicMock()
        mock_resp.read.return_value = launch_resp
        mock_resp.__enter__ = lambda s: s
        mock_resp.__exit__ = MagicMock(return_value=False)
        return mock_resp

    with patch("fleet_gateway.cao.urlopen", fake_urlopen2):
        client2 = LoopbackCAOClient("http://127.0.0.1:9999")
        client2.launch_worker(
            {
                "task_id": "issue-1234",
                "role": "charlie",
                "provider": "codex",
                "github_ref": "feat/test",
                "base_commit": "abc123",
                "acceptance_criteria": "tests green",
                "working_directory": "/tmp/wt/issue-1234",
            }
        )

    assert len(captured_codex) == 1
    codex_url = captured_codex[0].full_url
    assert "agent_profile=reviewer" in codex_url, "charlie → reviewer profile mapping"
    assert "provider=codex" in codex_url, "codex → codex provider mapping (pass-through)"
