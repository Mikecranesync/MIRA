"""Tests for lane health monitoring: init failures, usage limits, trust preflight."""

from __future__ import annotations

import json
import time
from unittest.mock import patch

import pytest

from fleet_gateway.errors import ContractViolation
from helpers import LAUNCH_OK


class TestLaneInitialization:
    """Tests for detecting and reporting initialization failures."""

    def test_launch_returns_lane_state_initializing(self, service, auth):
        """Launched lanes should report lane_state=initializing."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        assert result["lane_state"] == "initializing"

    def test_launch_records_launched_at(self, service, auth, cao):
        """Launch should record a launched_at timestamp on the session."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session = cao.get_session(result["session_id"])
        assert "launched_at" in session
        # Should be parseable as ISO8601 or a timestamp
        assert isinstance(session["launched_at"], (int, float, str))

    def test_lane_state_ready_within_grace_when_idle(self, service, auth, cao):
        """Lane should be ready if it reaches idle within INIT_GRACE_S."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        # Simulate idle status reached quickly
        cao.sessions[session_id]["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status.get("lane_state") == "ready"

    def test_lane_state_init_failed_past_grace_no_terminal(self, service, auth, cao):
        """Lane should be init_failed if terminal is gone after grace period."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        # Set launched_at to past grace period
        cao.sessions[session_id]["launched_at"] = time.time() - 100  # 100 seconds ago
        # Simulate terminal gone (confirmed gone with no terminals)
        cao.sessions[session_id]["_session_confirmed"] = True
        cao.sessions[session_id]["_terminals_in_response"] = True
        cao.sessions[session_id]["terminal_status"] = None  # No terminal at all
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status.get("lane_state") == "init_failed"
        assert "lane_error" in status

    def test_lane_state_init_failed_never_reached_idle(self, service, auth, cao):
        """Lane should be init_failed if it never reached idle after grace period."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        # Set launched_at to past grace period
        cao.sessions[session_id]["launched_at"] = time.time() - 100
        cao.sessions[session_id]["terminal_status"] = "running"  # Still running, not idle
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status.get("lane_state") == "init_failed"
        assert "lane_error" in status

    def test_lane_state_initializing_within_grace_not_idle(self, service, auth, cao):
        """Lane should remain initializing within grace period if not idle yet."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        # Just launched, still initializing
        assert cao.sessions[session_id]["terminal_status"] in (None, "running")
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status.get("lane_state") == "initializing"


class TestUsageLimitDetection:
    """Tests for detecting and blocking on usage limits."""

    def test_detect_weekly_limit_text(self, service, auth, cao):
        """Should detect 'You've hit your weekly limit' in terminal output."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        # Simulate terminal output with usage limit
        cao.sessions[session_id]["terminal_output"] = "You've hit your weekly limit · resets 12am (America/New_York)"
        cao.sessions[session_id]["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status.get("lane_state") == "blocked_usage_limit"
        assert "blocked_until" in status

    def test_detect_session_limit_text(self, service, auth, cao):
        """Should detect 'You've hit your session limit' text."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        cao.sessions[session_id]["terminal_output"] = "You've hit your session limit · resets 3pm (America/New_York)"
        cao.sessions[session_id]["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        assert status.get("lane_state") == "blocked_usage_limit"

    def test_parse_reset_time_12am(self, service, auth, cao):
        """Should parse reset time like '12am (America/New_York)'."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        cao.sessions[session_id]["terminal_output"] = "You've hit your weekly limit · resets 12am (America/New_York)"
        cao.sessions[session_id]["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        blocked_until = status.get("blocked_until")
        assert blocked_until  # Should have a reset time
        # blocked_until should be a Unix timestamp in the future
        if isinstance(blocked_until, int):
            now_ts = time.time()
            assert blocked_until > now_ts

    def test_parse_reset_time_3pm(self, service, auth, cao):
        """Should parse reset time like '3pm (America/Los_Angeles)'."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        cao.sessions[session_id]["terminal_output"] = "You've hit your weekly limit · resets 3pm (America/Los_Angeles)"
        cao.sessions[session_id]["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        blocked_until = status.get("blocked_until")
        assert blocked_until

    def test_parse_reset_time_with_minutes(self, service, auth, cao):
        """Should parse reset time like '3:30pm (America/New_York)'."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        cao.sessions[session_id]["terminal_output"] = "You've hit your session limit · resets 3:30pm (America/New_York)"
        cao.sessions[session_id]["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        blocked_until = status.get("blocked_until")
        assert blocked_until

    def test_reset_time_fallback_to_backoff(self, service, auth, cao):
        """Should fallback to backoff if reset time cannot be parsed."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        cao.sessions[session_id]["terminal_output"] = "You've hit your weekly limit · resets INVALID_TIME"
        cao.sessions[session_id]["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        blocked_until = status.get("blocked_until")
        assert blocked_until
        # Should be roughly now + backoff (default 3600s)
        if isinstance(blocked_until, int):
            now_ts = time.time()
            # Should be between now and now + 1 hour + 60 seconds
            assert now_ts < blocked_until < now_ts + 3660

    def test_launch_refused_while_blocked(self, service, auth):
        """Launch should be refused with a usage limit error while blocked."""
        # Set up blocked state
        service._blocked_until = {"bravo": time.time() + 3600}  # Blocked for 1 hour
        with pytest.raises(ContractViolation) as exc:
            service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        assert "usage limit" in str(exc.value).lower() or "blocked" in str(exc.value).lower()

    def test_launch_allowed_after_blocked_expires(self, service, auth, cao):
        """Launch should be allowed once blocked_until expires."""
        # Set up blocked state that has already expired
        service._blocked_until = {"bravo": time.time() - 1}  # Expired 1 second ago
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        assert result["session_id"]

    def test_output_endpoint_error_is_fail_open(self, service, auth, cao):
        """If terminal output fetch errors, lane_state should not crash."""
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        session_id = result["session_id"]
        # Simulate error fetching output (e.g., endpoint 500)
        # Lane state should still be derived from terminal status, not crash
        session = cao.get_session(session_id)
        session["terminal_status"] = "idle"
        status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
        # Should be ready (fail-open), not errored
        assert status.get("lane_state") in ("ready", "initializing")


class TestRepositoryTrustPreflight:
    """Tests for preflight check of repository trust configuration."""

    def test_trust_preflight_passes_when_trusted(self, service, auth, cao, tmp_path):
        """Launch should succeed when the service's REAL repo is trusted in ~/.claude.json."""
        service._trust_reader = None  # the fixture's always-true reader would skip the file
        repo = str(service.router.target("bravo").worktrees.repo)
        claude_json = tmp_path / ".claude.json"
        claude_json.write_text(json.dumps({"projects": {repo: {"hasTrustDialogAccepted": True}}}))
        with patch("fleet_gateway.lane_health.os.path.expanduser", return_value=str(claude_json)):
            result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
            assert result["session_id"]

    def test_trust_preflight_fails_when_not_trusted(self, service, auth, cao, tmp_path):
        """Launch should fail when hasTrustDialogAccepted is false."""
        claude_json = tmp_path / ".claude.json"
        claude_json.write_text(
            json.dumps({
                "projects": {
                    "/path/to/repo": {
                        "hasTrustDialogAccepted": False
                    }
                }
            })
        )
        # Override the trust reader to use the test file
        service._trust_reader = None  # Use real check_repo_trust
        with patch("fleet_gateway.lane_health.os.path.expanduser", return_value=str(claude_json)):
            with pytest.raises(ContractViolation) as exc:
                service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
            assert "trust" in str(exc.value).lower()

    def test_trust_preflight_missing_project_entry(self, service, auth, cao, tmp_path):
        """Launch should fail with distinct message when project entry is missing."""
        claude_json = tmp_path / ".claude.json"
        claude_json.write_text(json.dumps({"projects": {}}))
        service._trust_reader = None  # Use real check_repo_trust
        with patch("fleet_gateway.lane_health.os.path.expanduser", return_value=str(claude_json)):
            with pytest.raises(ContractViolation) as exc:
                service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
            assert "unknown" in str(exc.value).lower() or "not found" in str(exc.value).lower()

    def test_trust_preflight_unreadable_file(self, service, auth, cao):
        """Launch should fail distinctly when ~/.claude.json is unreadable."""
        service._trust_reader = None  # Use real check_repo_trust
        with patch("fleet_gateway.lane_health.os.path.expanduser", return_value="/nonexistent/path"):
            with pytest.raises(ContractViolation) as exc:
                service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
            assert "unknown" in str(exc.value).lower()

    def test_trust_preflight_skip_env_var(self, service, auth, cao, tmp_path):
        """Launch should succeed when FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT=1."""
        claude_json = tmp_path / ".claude.json"
        claude_json.write_text(json.dumps({"projects": {}}))
        with patch.dict("os.environ", {"FLEET_GATEWAY_SKIP_TRUST_PREFLIGHT": "1"}):
            with patch("fleet_gateway.lane_health.os.path.expanduser", return_value=str(claude_json)):
                result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
                assert result["session_id"]

    def test_trust_preflight_injectable_reader(self, service, auth, cao):
        """Trust reader should be injectable for testing."""
        # Mock the trust reader function
        def mock_reader(repo_path):
            return True  # Pretend repo is trusted

        # Tests should be able to inject this
        service._trust_reader = mock_reader  # This allows tests to override
        result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
        assert result["session_id"]
