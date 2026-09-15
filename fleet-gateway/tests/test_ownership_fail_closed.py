"""PRD Test B — Ownership fail-closed.

Regression tests proving that the Fleet Gateway refuses to stop, message,
or hand off any session it cannot prove the fleet owns (via the artifact store),
and that fleet-owned sessions continue to work as before.
"""

from __future__ import annotations

import pytest

from fleet_gateway.errors import ContractViolation, OwnershipError
# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _launch(service, auth, launch_ok: dict, *, task_id: str = "issue-3532") -> str:
    """Launch a worker using the conftest-provided launch_ok spec (has the real base_commit)."""
    spec = {**launch_ok, "task_id": task_id}
    result = service.invoke("launch_worker", spec, authorization=auth, requester="test")
    return result["session_id"]


def _inject_unowned(cao, *, session_id: str = "synthetic-unowned-deadbeef") -> str:
    """Insert a session directly into the FakeCAO — NOT via fleet launch.

    This simulates a pre-existing or foreign session that the fleet has no
    artifact for.  It must be refused by every control path.
    """
    cao.sessions[session_id] = {
        "session_id": session_id,
        "status": "running",
        "role": "bravo",
    }
    return session_id


# ---------------------------------------------------------------------------
# Test 1: stop of a fleet-owned session still works
# ---------------------------------------------------------------------------


def test_stop_fleet_owned_session_succeeds(service, cao, auth, launch_ok):
    """A session the fleet launched must be stoppable via stop_worker."""
    sid = _launch(service, auth, launch_ok)
    result = service.invoke(
        "stop_worker",
        {"session_id": sid},
        authorization=auth,
        requester="test",
    )
    assert (
        result.get("status") in ("stopped", "ok", "success")
        or result.get("ok") is True
        or "stop" in str(result).lower()
    )
    # CAO stop_worker was actually called (not blocked before reaching CAO)
    assert any(call[0] == "stop_worker" and call[1].get("session_id") == sid for call in cao.calls)


# ---------------------------------------------------------------------------
# Test 2: stop of an unknown/never-launched session is refused
# ---------------------------------------------------------------------------


def test_stop_unknown_session_refused(service, cao, auth):
    """A session_id that was never in the artifact store must be refused."""
    unowned_id = "synthetic-unowned-never-launched-aabbcc"
    with pytest.raises(OwnershipError):
        service.invoke(
            "stop_worker",
            {"session_id": unowned_id},
            authorization=auth,
            requester="test",
        )
    # CAO stop_worker was NEVER called — no destructive action
    assert not any(
        call[0] == "stop_worker" and call[1].get("session_id") == unowned_id for call in cao.calls
    )


# ---------------------------------------------------------------------------
# Test 3a: stop of a session injected into CAO (but not fleet-launched) is refused
# ---------------------------------------------------------------------------


def test_stop_unowned_live_session_refused(service, cao, auth):
    """A session that exists in CAO but was not fleet-launched must be refused."""
    unowned_id = _inject_unowned(cao)
    with pytest.raises(OwnershipError):
        service.invoke(
            "stop_worker",
            {"session_id": unowned_id},
            authorization=auth,
            requester="test",
        )
    # The session is still alive in CAO — it was not stopped
    assert unowned_id in cao.sessions
    assert not any(
        call[0] == "stop_worker" and call[1].get("session_id") == unowned_id for call in cao.calls
    )


# ---------------------------------------------------------------------------
# Test 3b: message_worker on unowned session is refused
# ---------------------------------------------------------------------------


def test_message_unowned_session_refused(service, cao, auth):
    """message_worker must refuse an unowned session_id before sending."""
    unowned_id = _inject_unowned(cao, session_id="synthetic-unowned-msg-ccddee")
    with pytest.raises(OwnershipError):
        service.invoke(
            "message_worker",
            {"session_id": unowned_id, "text": "hello"},
            authorization=auth,
            requester="test",
        )
    assert not any(call[0] == "message_worker" and call[1] == unowned_id for call in cao.calls)


# ---------------------------------------------------------------------------
# Test 3c: request_handoff on unowned session is refused
# ---------------------------------------------------------------------------


def test_handoff_unowned_session_refused(service, cao, auth):
    """request_handoff must refuse an unowned session_id before acting."""
    unowned_id = _inject_unowned(cao, session_id="synthetic-unowned-handoff-ffeedd")
    with pytest.raises(OwnershipError):
        service.invoke(
            "request_handoff",
            {"session_id": unowned_id, "task_id": "some-task"},
            authorization=auth,
            requester="test",
        )
    assert not any(call[0] == "request_handoff" and call[1] == unowned_id for call in cao.calls)


# ---------------------------------------------------------------------------
# Test 4: cleanup/delete_worktree on any session is refused by construction
# ---------------------------------------------------------------------------


def test_delete_worktree_refused_by_construction(service, auth):
    """stop_worker already hard-denies delete_worktree — covered by construction.

    This is a ContractViolation (not OwnershipError) because the tool contract
    rejects the parameter before ownership is even checked.  delete_worktree is
    also in DENIED_TOOLS so it cannot be invoked as a tool.  Both gates hold.
    """
    with pytest.raises(ContractViolation):
        service.invoke(
            "stop_worker",
            {"session_id": "any-session", "delete_worktree": True},
            authorization=auth,
            requester="test",
        )


# ---------------------------------------------------------------------------
# Test 4b: fleet-owned session after stop has no impact on other sessions
# ---------------------------------------------------------------------------


def test_stop_fleet_owned_does_not_affect_other_sessions(service, cao, auth, launch_ok):
    """Stopping one fleet-owned session must not stop or alter any other session."""
    # Launch the target session
    sid_target = _launch(service, auth, launch_ok, task_id="issue-3532")
    # Inject a protected session that should remain untouched
    protected_id = _inject_unowned(cao, session_id="protected-pre-existing-session")

    # Stop the fleet-owned one
    service.invoke(
        "stop_worker",
        {"session_id": sid_target},
        authorization=auth,
        requester="test",
    )

    # Protected session is still alive
    assert protected_id in cao.sessions
    assert not any(call[0] == "stop_worker" and call[1] == protected_id for call in cao.calls)
