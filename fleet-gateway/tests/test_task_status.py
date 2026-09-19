from __future__ import annotations

from helpers import LAUNCH_OK


def test_task_status_commit_match_field(service, auth):
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    result = service.invoke(
        "task_status",
        {"task_id": LAUNCH_OK["task_id"]},
        authorization=auth,
    )
    assert result["task_id"] == LAUNCH_OK["task_id"]
    assert result["node"] == "bravo"
    assert result["provider"] == "claude"
    assert result["branch"]
    assert result["worktree"]
    assert result["commit"]
    assert "handoff" in result
    assert "tests" in result
    assert "type_check" in result
    assert "build" in result
    assert "review_verdict" in result
    assert "blockers" in result
    assert "claimed_commit_matches_artifact" in result
    assert result["claimed_commit_matches_artifact"] is True
    assert result["done"] is False
    assert launched["session_id"]


def test_task_status_chat_is_not_done(service, cao, auth):
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    service.invoke(
        "message_worker",
        {"session_id": launched["session_id"], "text": "done — all finished"},
        authorization=auth,
    )
    result = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert result["done"] is False
    assert "chat_is_not_done" in result["blockers"]


def test_task_status_mismatch_when_claimed_differs(service, cao, auth):
    service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    session = next(iter(cao.sessions.values()))
    session["claimed_commit"] = "deadbeef" * 5
    cao.tasks[LAUNCH_OK["task_id"]]["claimed_commit"] = "deadbeef" * 5
    result = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    # Artifact still has the launch base_commit; CAO claimed a different SHA.
    assert result["claimed_commit_matches_artifact"] is False
