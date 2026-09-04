"""PRD Test B — Ownership fail-closed (ported from #3551, not weakened)."""

from __future__ import annotations

import pytest

from fleet_gateway.errors import ContractViolation, OwnershipError


def _launch(service, auth, launch_ok: dict, *, task_id: str = "issue-3532") -> str:
    spec = {**launch_ok, "task_id": task_id}
    result = service.invoke("launch_worker", spec, authorization=auth, requester="test")
    return result["session_id"]


def _inject_unowned(cao, *, session_id: str = "synthetic-unowned-deadbeef") -> str:
    cao.sessions[session_id] = {
        "session_id": session_id,
        "status": "running",
        "role": "bravo",
    }
    return session_id


def test_stop_fleet_owned_session_succeeds(service, cao, auth, launch_ok):
    sid = _launch(service, auth, launch_ok)
    result = service.invoke(
        "stop_worker",
        {"session_id": sid},
        authorization=auth,
        requester="test",
    )
    assert result.get("status") == "stopped" or result.get("ok") is True
    assert any(call[0] == "stop_worker" and call[1].get("session_id") == sid for call in cao.calls)


def test_stop_unknown_session_refused(service, cao, auth):
    unowned_id = "synthetic-unowned-never-launched-aabbcc"
    with pytest.raises(OwnershipError):
        service.invoke(
            "stop_worker",
            {"session_id": unowned_id},
            authorization=auth,
            requester="test",
        )
    assert not any(
        call[0] == "stop_worker" and call[1].get("session_id") == unowned_id for call in cao.calls
    )


def test_stop_unowned_live_session_refused(service, cao, auth):
    unowned_id = _inject_unowned(cao)
    with pytest.raises(OwnershipError):
        service.invoke(
            "stop_worker",
            {"session_id": unowned_id},
            authorization=auth,
            requester="test",
        )
    assert unowned_id in cao.sessions
    assert not any(
        call[0] == "stop_worker" and call[1].get("session_id") == unowned_id for call in cao.calls
    )


def test_message_unowned_session_refused(service, cao, auth):
    unowned_id = _inject_unowned(cao, session_id="synthetic-unowned-msg-ccddee")
    with pytest.raises(OwnershipError):
        service.invoke(
            "message_worker",
            {"session_id": unowned_id, "text": "hello"},
            authorization=auth,
            requester="test",
        )
    assert not any(
        call[0] == "message_worker" and call[1].get("session_id") == unowned_id
        for call in cao.calls
    )


def test_handoff_unowned_session_refused(service, cao, auth):
    unowned_id = _inject_unowned(cao, session_id="synthetic-unowned-handoff-ffeedd")
    with pytest.raises(OwnershipError):
        service.invoke(
            "request_handoff",
            {"session_id": unowned_id, "task_id": "some-task"},
            authorization=auth,
            requester="test",
        )
    assert not any(
        call[0] == "request_handoff" and call[1].get("session_id") == unowned_id
        for call in cao.calls
    )


def test_delete_worktree_refused_by_construction(service, auth):
    with pytest.raises(ContractViolation):
        service.invoke(
            "stop_worker",
            {"session_id": "any-session", "delete_worktree": True},
            authorization=auth,
            requester="test",
        )


def test_stop_fleet_owned_does_not_affect_other_sessions(service, cao, auth, launch_ok):
    sid_target = _launch(service, auth, launch_ok, task_id="issue-3532")
    protected_id = _inject_unowned(cao, session_id="protected-pre-existing-session")
    service.invoke("stop_worker", {"session_id": sid_target}, authorization=auth, requester="test")
    assert protected_id in cao.sessions
    assert not any(
        call[0] == "stop_worker" and call[1].get("session_id") == protected_id
        for call in cao.calls
    )
