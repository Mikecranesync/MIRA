from __future__ import annotations

import pytest
from fleet_gateway.errors import ContractViolation
from helpers import LAUNCH_OK


def test_launch_requires_provider_task_ref_base_acceptance_isolated(service, auth):
    required = [
        "provider",
        "task_id",
        "github_ref",
        "base_commit",
        "acceptance_criteria",
    ]
    for field in required:
        params = dict(LAUNCH_OK)
        params[field] = ""
        with pytest.raises(ContractViolation) as exc:
            service.invoke("launch_worker", params, authorization=auth)
        assert field in str(exc.value) or "required" in str(exc.value).lower()

    params = dict(LAUNCH_OK)
    params["isolated_worktree"] = False
    with pytest.raises(ContractViolation) as exc:
        service.invoke("launch_worker", params, authorization=auth)
    assert "isolated_worktree" in str(exc.value)


def test_specialized_launch_rejected(service, auth):
    for role in ("specialized", "plc", "ignition", "delta"):
        with pytest.raises(ContractViolation) as exc:
            service.invoke(
                "launch_worker",
                {**LAUNCH_OK, "role": role},
                authorization=auth,
            )
        assert "refused" in str(exc.value) or "bravo" in str(exc.value)


def test_launch_rejects_unknown_provider(service, auth):
    with pytest.raises(ContractViolation):
        service.invoke(
            "launch_worker",
            {**LAUNCH_OK, "provider": "shell"},
            authorization=auth,
        )


def test_launch_bravo_and_charlie_ok(service, auth, cao):
    bravo = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    assert bravo["isolated_worktree"] is True
    assert bravo["role"] == "bravo"
    charlie = service.invoke(
        "launch_worker",
        {**LAUNCH_OK, "role": "charlie", "task_id": "issue-3532-review"},
        authorization=auth,
    )
    assert charlie["role"] == "charlie"
    assert all(
        call[1]["isolated_worktree"] is True for call in cao.calls if call[0] == "launch_worker"
    )
