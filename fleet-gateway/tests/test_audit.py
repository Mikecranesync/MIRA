from __future__ import annotations

from helpers import LAUNCH_OK


def test_audit_written_on_mutate(service, auth):
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    records = service.audit.read_all()
    assert records, "mutate must write an audit record"
    rec = records[-1]
    assert rec["tool"] == "launch_worker"
    assert rec["requester"] == "foreman-test"
    assert rec["task_id"] == LAUNCH_OK["task_id"]
    assert rec["target_session"] == launched["session_id"]
    assert rec["target_node"] == "bravo"
    assert rec["outcome"] == "ok"
    assert "timestamp" in rec
    assert rec["parameters"]["provider"] == "claude"


def test_audit_written_on_rejected_mutate(service, auth):
    try:
        service.invoke(
            "launch_worker",
            {**LAUNCH_OK, "role": "specialized"},
            authorization=auth,
        )
    except Exception:
        pass
    records = service.audit.read_all()
    assert records
    rec = records[-1]
    assert rec["tool"] == "launch_worker"
    assert rec["outcome"] == "rejected"


def test_reads_do_not_audit(service, auth):
    service.invoke("fleet_status", {}, authorization=auth)
    assert service.audit.read_all() == []
