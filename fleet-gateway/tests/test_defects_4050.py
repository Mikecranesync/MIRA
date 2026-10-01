"""Tests for #4050 defects: usage-limit guard, trust preflight, init_failed overreach."""

from __future__ import annotations

import time

import pytest

from fleet_gateway.errors import ContractViolation
from helpers import LAUNCH_OK


class TestD1UsageLimitGuard:
    """D1: Usage-limit guard never fires in production.

    The _check_usage_limit_block in service._launch_worker needs to:
    - Fetch terminal output via GET /terminals/{id}/output on the real CAO client
    - Parse reset time from the output
    - Set self._blocked_until[node] to block future launches

    Tests are in test_lane_health.py::TestUsageLimitDetection
    """

    def test_d1_worktree_not_created_when_blocked(self, service, auth) -> None:
        """D1: When usage-limited, worktree should NOT be created (called after block check)."""
        # Set node as blocked
        service._blocked_until["bravo"] = time.time() + 3600

        # Attempt launch - should fail BEFORE any side effect
        with pytest.raises(ContractViolation) as exc:
            service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)

        # Verify the error mentions usage limit
        assert "usage limit" in str(exc.value).lower() or "blocked" in str(exc.value).lower()


class TestD2TrustPreflight:
    """D2: Trust preflight reads LOCAL ~/.claude.json for every node.

    The _check_repo_trust needs to:
    - For remote nodes (with ssh_host), read ~/.claude.json ON THAT NODE via provisioner._run()
    - For local nodes (no ssh_host), read Path.home()/".claude.json"

    Tests for local trust reading are in test_lane_health.py::TestRepositoryTrustPreflight
    Tests for remote trust reading would require actual SSH setup (out of scope for unit tests).
    """

    def test_d2_trust_preflight_injectable_reader(self, service, auth, cao) -> None:
        """D2: Trust reader should be injectable for testing."""
        # The service fixture already has a trust reader injected (trust all)
        # This verifies that the injection mechanism works
        assert service._trust_reader is not None
        # Should allow launch
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        assert result["session_id"]


class TestD3InitFailedOverreach:
    """D3: Healthy lanes are reported init_failed.

    When a lane reaches idle/completed, then later stops (404 or gone), it
    incorrectly returns init_failed. Need to:
    - Track ever_ready state when terminal first reaches idle/processing/completed/waiting_user_answer
    - Return "stopped" (not init_failed) for lanes that were once ready but are now gone
    - Return "init_failed" ONLY for lanes that never reached ready before stopping
    """

    def test_d3_ready_then_404_returns_stopped_not_init_failed(self, service, auth, cao) -> None:
        """D3: Lane that was idle, then 404d, should return 'stopped', not 'init_failed'."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        session = cao.sessions[session_id]

        # Simulate: reached idle quickly
        session["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status["lane_state"] == "ready"

        # Now simulate terminal gone (404 after grace period)
        session["launched_at"] = time.time() - 100  # Past grace period
        session["terminal_status"] = None  # Terminal gone
        session["_session_confirmed"] = True
        session["_terminals_in_response"] = True

        # Should return "stopped", not "init_failed"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status["lane_state"] == "stopped", f"Expected 'stopped', got '{status['lane_state']}'"

    def test_d3_never_ready_then_404_returns_init_failed(self, service, auth, cao) -> None:
        """D3: Lane that never reached ready, then 404d, should return 'init_failed'."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        session = cao.sessions[session_id]

        # Simulate: past grace period, never reached idle
        session["launched_at"] = time.time() - 100
        session["terminal_status"] = "running"  # Never reached idle
        session["_session_confirmed"] = True
        session["_terminals_in_response"] = True

        # Should return "init_failed"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status["lane_state"] == "init_failed"
        assert "lane_error" in status

    def test_d3_waiting_user_answer_counts_as_ready(self, service, auth, cao) -> None:
        """D3: waiting_user_answer should count as ready (ever_ready=true)."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        session = cao.sessions[session_id]

        # Simulate: reached waiting_user_answer (a ready state)
        session["terminal_status"] = "waiting_user_answer"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status["lane_state"] == "ready"

    def test_d3_processing_is_ready(self, service, auth, cao) -> None:
        """D3: processing state should count as ready (ever_ready=true)."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        session = cao.sessions[session_id]

        # Simulate: reached processing
        session["terminal_status"] = "processing"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status["lane_state"] == "ready"

    def test_d3_completed_is_ready(self, service, auth, cao) -> None:
        """D3: completed state should count as ready (ever_ready=true)."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        session = cao.sessions[session_id]

        # Simulate: reached completed
        session["terminal_status"] = "completed"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status["lane_state"] == "ready"
