from __future__ import annotations

import pytest
from fleet_gateway.errors import ContractViolation
from helpers import LAUNCH_OK


def test_message_worker(service, auth, cao):
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    result = service.invoke(
        "message_worker",
        {"session_id": launched["session_id"], "text": "please run tests"},
        authorization=auth,
    )
    assert result["accepted"] is True
    assert result["chat_is_not_done"] is True
    assert cao.messages[launched["session_id"]] == ["please run tests"]


def test_request_handoff_writes_artifact_and_stops_claim(service, auth, data_dir):
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    result = service.invoke(
        "request_handoff",
        {"session_id": launched["session_id"], "task_id": LAUNCH_OK["task_id"]},
        authorization=auth,
    )
    assert result["claimed"] is False
    assert result["status"] == "handed_off"
    handoff = data_dir / "handoffs" / result["handoff"]
    assert handoff.is_file()
    text = handoff.read_text(encoding="utf-8")
    assert LAUNCH_OK["task_id"] in text
    assert "claimed: false" in text
    status = service.invoke("task_status", {"task_id": LAUNCH_OK["task_id"]}, authorization=auth)
    assert status["handoff"]
    assert status["done"] is False


def test_stop_worker_session_only(service, auth):
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    result = service.invoke(
        "stop_worker",
        {"session_id": launched["session_id"], "task_id": LAUNCH_OK["task_id"]},
        authorization=auth,
    )
    assert result["status"] == "stopped"
    with pytest.raises(ContractViolation):
        service.invoke(
            "stop_worker",
            {"session_id": launched["session_id"], "node": "bravo"},
            authorization=auth,
        )
    with pytest.raises(ContractViolation):
        service.invoke(
            "stop_worker",
            {"session_id": launched["session_id"], "stop_cao": True},
            authorization=auth,
        )
    with pytest.raises(ContractViolation):
        service.invoke(
            "stop_worker",
            {"session_id": launched["session_id"], "delete_worktree": True},
            authorization=auth,
        )
