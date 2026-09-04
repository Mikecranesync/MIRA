"""Three fail-open blockers in legacy session adoption (PR #3568).

These tests reproduce and verify fixes for:
1. PID-based adoption grabs the wrong session
2. Cross-node ambiguity guard is inert in production
3. attempts[] makes historical sessions read as owned
"""

from __future__ import annotations

from pathlib import Path

import pytest

from fleet_gateway.errors import ContractViolation
from fleet_gateway.legacy import (
    FakeLegacySessionProbe,
    LegacySession,
)
from fleet_gateway.service import build_service
from fleet_gateway.worktree import WorktreeProvisioner
from helpers import AUTH_HEADER, TEST_BEARER

RC_ID = "session_01Cu9kgi8xjCVQuJGYrmZxFR"


def _sess(
    *,
    node: str = "bravo",
    local_id: str = "cao-legacy-claude-1",
    provider: str = "claude",
    classification: str = "legacy",
    adoptable: bool = True,
    cwd: str = "/Users/bravonode/MIRA",
    pid: int = 4242,
    tmux_name: str | None = None,
    bridge: str | None = RC_ID,
) -> LegacySession:
    return LegacySession(
        node=node,
        provider=provider,
        local_session_id=local_id,
        cwd=cwd,
        pid=pid,
        tmux_name=tmux_name or local_id,
        bridge_session_id=bridge,
        classification=classification,
        adoptable=adoptable,
    )


def _service(data_dir: Path, cao, origin_repo, worktree_parent, probe):
    repo, _sha = origin_repo
    return build_service(
        bearer_token=TEST_BEARER,
        cao=cao,
        data_dir=data_dir,
        requester="foreman-test",
        worktrees=WorktreeProvisioner(repo=repo, parent=worktree_parent),
        probe=probe,
    )


def test_blocker1_pid_is_not_an_identity(data_dir, cao, origin_repo, worktree_parent):
    """Blocker 1: PID-based adoption grabs the wrong session.

    REPRODUCTION: Two sessions on bravo:
    - S1: local_id="unrelated-session", pid=4242, bridge="bridge-1"
    - S2: local_id="intended-session", pid=9999, bridge="bridge-2" (not present)

    When adopting external_id="4242" (a pid, not an identity), should:
    - FAIL CLOSED (NotFoundError or ContractViolation) because no session has
      bridge_session_id="4242" or tmux_name="4242" or local_session_id="4242"
    - NOT match S1 even though S1.pid == 4242
    """
    unrelated = _sess(
        local_id="unrelated-session",
        pid=4242,
        tmux_name="unrelated-session",
        bridge="bridge-unrelated",
    )
    # The "intended session" doesn't exist; we're just verifying that adopting
    # by pid="4242" doesn't silently match the unrelated session.
    probe = FakeLegacySessionProbe({"bravo": [unrelated]})
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)

    # Adopting by pid should NOT match the unrelated session.
    # It should raise NotFoundError (no match) or ContractViolation.
    with pytest.raises((ContractViolation, Exception)):
        service.invoke(
            "adopt_legacy_session",
            {"role": "bravo", "external_id": "4242"},
            authorization=AUTH_HEADER,
            requester="test",
        )
    # Verify the unrelated session was NOT adopted.
    assert not service.artifacts.is_fleet_owned("unrelated-session")


def test_blocker2_cross_node_ambiguity_guard_requires_full_probe_coverage(
    data_dir, cao, origin_repo, worktree_parent
):
    """Blocker 2: Cross-node ambiguity guard is inert in production.

    REPRODUCTION: Production factory has MULTI-NODE router but only bravo probe.
    When adopting, the guard should fail closed for unknown nodes.

    Setup:
    - Multi-node router (bravo, charlie, alpha each with separate CAO instances)
    - Probe only knows about bravo (simulates bravo_legacy_probe_from_env)
    - Trying to adopt a session on bravo

    The cross-node check calls probe.list_sessions("charlie") and
    probe.list_sessions("alpha") which return [] (probe knows only bravo).
    This silently treats "charlie/alpha are empty" as "no conflict", allowing
    silent adoption even though we can't verify cross-node uniqueness.

    Fix: Fail closed when a multi-node setup has a limited probe. Raise
    ContractViolation("cross_node_probe_unavailable") instead of silently
    ignoring nodes the probe can't check.
    """
    # Build a multi-node router with separate CAOs (different object ids)
    from fleet_gateway.cao import FakeCAO
    from fleet_gateway.router import NodeRouter, NodeTarget
    from fleet_gateway.worktree import WorktreeProvisioner

    repo, _sha = origin_repo
    wt = WorktreeProvisioner(repo=repo, parent=worktree_parent)

    # Three separate CAOs (is_single() will return False)
    cao_bravo = FakeCAO()
    cao_charlie = FakeCAO()
    cao_alpha = FakeCAO()

    router = NodeRouter(
        {
            "bravo": NodeTarget("bravo", cao_bravo, wt),
            "charlie": NodeTarget("charlie", cao_charlie, wt),
            "alpha": NodeTarget("alpha", cao_alpha, wt),
        }
    )

    # Probe only knows bravo (simulates production)
    bravo_session = _sess(local_id="bravo-session", bridge="bridge-test")
    probe = FakeLegacySessionProbe({"bravo": [bravo_session]})

    service = build_service(
        bearer_token=TEST_BEARER,
        router=router,
        data_dir=data_dir,
        requester="foreman-test",
        probe=probe,
    )

    # Trying to adopt on bravo when probe can't check charlie/alpha.
    # Should fail closed to prevent cross-node ambiguity leaks.
    with pytest.raises(ContractViolation, match="cross_node_probe_unavailable"):
        service.invoke(
            "adopt_legacy_session",
            {"role": "bravo", "external_id": "bridge-test"},
            authorization=AUTH_HEADER,
            requester="test",
        )


def test_blocker3_attempts_makes_historical_sessions_read_as_owned(
    data_dir, cao, origin_repo, worktree_parent
):
    """Blocker 3: attempts[] makes historical sessions read as owned.

    REPRODUCTION:
    1. Adopt session S1, task_id="T". S1 is now fleet-owned.
    2. Write task T with a new session S2 (S1 moves to attempts[]).
    3. Call request_handoff(task_id="T", session_id="S1").

    EXPECTED: Raises OwnershipError or ContractViolation because S1 is
    historical (in attempts[]), not the LIVE session.

    BUG: is_fleet_owned(S1) returns true because the check scans attempts[],
    so the ownership gate passes silently. Then request_handoff rewrites T
    away from its LIVE session S2.

    FIX: Ownership mutations (request_handoff, message_worker, stop_worker)
    must require the LIVE top-level session_id, not allow attempts[].
    """
    # Adopt S1 with task T1. Use multi-node probe to satisfy cross-node check.
    s1 = _sess(local_id="session-s1", bridge="bridge-s1")
    probe = FakeLegacySessionProbe(
        {
            "bravo": [s1],
            "charlie": [],  # Empty but known, so cross-node check passes
            "alpha": [],  # Empty but known, so cross-node check passes
        }
    )
    service = _service(data_dir, cao, origin_repo, worktree_parent, probe)

    result = service.invoke(
        "adopt_legacy_session",
        {"role": "bravo", "external_id": "bridge-s1"},
        authorization=AUTH_HEADER,
        requester="test",
    )
    task_id = result["task_id"]

    # Verify S1 is owned
    assert service.artifacts.is_fleet_owned("session-s1")

    # Now write a new task record with session S2, pushing S1 to attempts[]
    record = {
        "task_id": task_id,
        "session_id": "session-s2",  # NEW session
        "role": "bravo",
        "node": "bravo",
        "provider": "claude",
        "cwd": "/Users/bravonode/MIRA",
        "status": "running",
        "fleet_owned": True,
    }
    service.artifacts.write_task(record)

    # S1 should now be in attempts[] (historical), S2 should be live
    task_record = service.artifacts.read_task(task_id)
    assert task_record["session_id"] == "session-s2"
    assert len(task_record.get("attempts", [])) == 1
    assert task_record["attempts"][0]["session_id"] == "session-s1"

    # Now try to call request_handoff with the HISTORICAL session S1
    # This should FAIL CLOSED because S1 is not the live session.
    from fleet_gateway.errors import OwnershipError

    with pytest.raises((OwnershipError, ContractViolation)):
        service.invoke(
            "request_handoff",
            {
                "session_id": "session-s1",  # HISTORICAL session
                "task_id": task_id,
                "role": "bravo",
                "provider": "claude",
                "github_ref": "main",
                "base_commit": "abc123",
                "claimed_commit": "def456",
                "branch": "feat/test",
                "worktree": "/Users/bravonode/MIRA/.claude/worktrees/test",
            },
            authorization=AUTH_HEADER,
            requester="test",
        )


def test_blocker1_pid_not_identity_with_empty_metadata(tmp_path):
    """Blocker 1: Empty metadata should NOT synthesize identity from PID.

    REPRODUCTION: A session file with empty/missing metadata.
    - File: 4242.json with content '{}'
    - Expected: local_session_id and tmux_name should NOT be set to '4242'
    - Expected: matches('4242') should return False (PID is not an identity token)
    """
    from fleet_gateway.legacy import FilesystemClaudeProbe

    sessions_dir = tmp_path / "sessions"
    sessions_dir.mkdir()

    # Create a session file with empty metadata
    session_file = sessions_dir / "4242.json"
    session_file.write_text("{}")

    # Create a mock probe and list sessions
    probe = FilesystemClaudeProbe(node="bravo", sessions_dir=sessions_dir)
    # Mock pid_alive to return True
    probe.pid_alive = lambda p: True

    sessions = probe.list_sessions("bravo")
    assert len(sessions) == 1

    session = sessions[0]
    assert session.pid == 4242

    # The critical assertions: PID should NOT be an identity token
    assert session.local_session_id is None or session.local_session_id == "", (
        f"local_session_id should be None or empty, got {session.local_session_id!r}"
    )
    assert session.tmux_name is None or session.tmux_name == "", (
        f"tmux_name should be None or empty, got {session.tmux_name!r}"
    )

    # Most importantly: matches() must return False for the PID
    assert not session.matches("4242"), "PID should NOT be in identity_tokens()"


def test_m1_probe_without_known_nodes_on_multinode_fails_open(
    data_dir, cao, origin_repo, worktree_parent
):
    """M1: Probe without known_nodes() method bypasses guard on multi-node.

    When a multi-node router is configured but the probe lacks known_nodes(),
    the guard should fail closed, not silently skip verification.
    """
    from fleet_gateway.cao import FakeCAO
    from fleet_gateway.router import NodeRouter, NodeTarget

    repo, _sha = origin_repo
    wt_prov = WorktreeProvisioner(repo=repo, parent=worktree_parent)

    # Three-node router
    cao_bravo = FakeCAO()
    cao_charlie = FakeCAO()
    cao_alpha = FakeCAO()

    router = NodeRouter(
        {
            "bravo": NodeTarget("bravo", cao_bravo, wt_prov),
            "charlie": NodeTarget("charlie", cao_charlie, wt_prov),
            "alpha": NodeTarget("alpha", cao_alpha, wt_prov),
        }
    )

    # Probe WITHOUT known_nodes method (like a broken production probe)
    class ProbeWithoutKnownNodes:
        def list_sessions(self, node: str):
            if node == "bravo":
                return [_sess(local_id="bravo-session", bridge="bridge-test")]
            return []

    probe = ProbeWithoutKnownNodes()

    service = build_service(
        bearer_token=TEST_BEARER,
        router=router,
        data_dir=data_dir,
        requester="foreman-test",
        probe=probe,
    )

    # Should fail closed because probe can't verify cross-node coverage
    with pytest.raises(ContractViolation, match="cross_node_probe_unavailable"):
        service.invoke(
            "adopt_legacy_session",
            {"role": "bravo", "external_id": "bridge-test"},
            authorization=AUTH_HEADER,
            requester="test",
        )


def test_m2_stop_worker_allowed_on_superseded_fleet_sessions(
    data_dir, cao, origin_repo, worktree_parent
):
    """M2: stop_worker must still operate on superseded (attempts[]) sessions.

    When a task has multiple sessions (S1 superseded, S2 live), stop_worker on
    S1 should succeed (S1 is fleet-owned and can be cleaned up), but
    request_handoff on S1 should fail (not the live session).
    """
    from fleet_gateway.cao import FakeCAO
    from fleet_gateway.errors import OwnershipError

    repo, _sha = origin_repo
    wt = WorktreeProvisioner(repo=repo, parent=worktree_parent)

    cao_obj = FakeCAO()
    cao_obj.sessions = {
        "session-s1": {"session_id": "session-s1", "status": "running"},
        "session-s2": {"session_id": "session-s2", "status": "running"},
    }

    service = build_service(
        bearer_token=TEST_BEARER,
        cao=cao_obj,
        data_dir=data_dir,
        requester="foreman-test",
        worktrees=wt,
    )

    # Adopt S1
    probe = FakeLegacySessionProbe(
        {
            "bravo": [
                _sess(local_id="session-s1", bridge="bridge-s1"),
                _sess(local_id="session-s2", bridge="bridge-s2"),
            ]
        }
    )
    service.probe = probe

    result = service.invoke(
        "adopt_legacy_session",
        {"role": "bravo", "external_id": "bridge-s1"},
        authorization=AUTH_HEADER,
        requester="test",
    )
    task_id = result["task_id"]

    # Update task to have S2 as the live session, moving S1 to attempts[]
    record = {
        "task_id": task_id,
        "session_id": "session-s2",  # NEW session
        "role": "bravo",
        "node": "bravo",
        "provider": "claude",
        "cwd": "/Users/bravonode/MIRA",
        "status": "running",
        "claimed": True,
        "fleet_owned": True,
    }
    service.artifacts.write_task(record)

    # Verify S1 is now in attempts[]
    task_record = service.artifacts.read_task(task_id)
    assert task_record["session_id"] == "session-s2"
    assert len(task_record.get("attempts", [])) == 1
    assert task_record["attempts"][0]["session_id"] == "session-s1"

    # stop_worker on S1 should SUCCEED (it's still fleet-owned)
    result = service.invoke(
        "stop_worker",
        {"session_id": "session-s1"},
        authorization=AUTH_HEADER,
        requester="test",
    )
    assert result["session_id"] == "session-s1"
    assert result["status"] == "stopped"
    # Verify CAO.stop_worker was actually called
    assert any(call[0] == "stop_worker" for call in cao_obj.calls)

    # request_handoff on S1 should FAIL (not the live session)
    with pytest.raises(OwnershipError, match="does not own live session"):
        service.invoke(
            "request_handoff",
            {
                "session_id": "session-s1",  # HISTORICAL session
                "task_id": task_id,
                "role": "bravo",
                "provider": "claude",
                "github_ref": "main",
                "base_commit": "abc123",
                "claimed_commit": "def456",
                "branch": "feat/test",
                "worktree": "/Users/bravonode/MIRA/.claude/worktrees/test",
            },
            authorization=AUTH_HEADER,
            requester="test",
        )
