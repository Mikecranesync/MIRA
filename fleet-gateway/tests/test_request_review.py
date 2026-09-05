from __future__ import annotations

import pytest
from fleet_gateway.errors import ContractViolation
from helpers import LAUNCH_OK


def test_request_review_rejects_non_charlie(service, auth):
    launched = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    with pytest.raises(ContractViolation) as exc:
        service.invoke(
            "request_review",
            {
                "session_id": launched["session_id"],
                "task_id": LAUNCH_OK["task_id"],
                "git_ref": LAUNCH_OK["github_ref"],
                "role": "charlie",  # caller cannot self-promote
            },
            authorization=auth,
        )
    assert "Charlie" in str(exc.value)


def test_request_review_charlie_reviews_git_ref(service, auth):
    launched = service.invoke(
        "launch_worker",
        {**LAUNCH_OK, "role": "charlie", "task_id": "issue-3532-review"},
        authorization=auth,
    )
    result = service.invoke(
        "request_review",
        {
            "session_id": launched["session_id"],
            "task_id": "issue-3532-review",
            "git_ref": LAUNCH_OK["base_commit"],
        },
        authorization=auth,
    )
    assert result["git_ref"] == LAUNCH_OK["base_commit"]
    profile = result["reviewer_profile"]
    assert profile["role"] == "charlie"
    assert profile["independent"] is True
    assert "tests" in profile["capabilities"]
    assert "type-check" in profile["capabilities"]
    assert "inspect-files" in profile["capabilities"]
    assert profile["reviews"] == "exact_git_ref"


def test_request_review_rejects_bravo_summary(service, auth):
    launched = service.invoke(
        "launch_worker",
        {**LAUNCH_OK, "role": "charlie", "task_id": "issue-3532-review"},
        authorization=auth,
    )
    with pytest.raises(ContractViolation) as exc:
        service.invoke(
            "request_review",
            {
                "session_id": launched["session_id"],
                "task_id": "issue-3532-review",
                "git_ref": LAUNCH_OK["base_commit"],
                "bravo_summary": "looks good to me",
            },
            authorization=auth,
        )
    assert "Bravo summary" in str(exc.value)
