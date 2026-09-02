from __future__ import annotations

from pathlib import Path

import pytest
from fleet_gateway.cao import FakeCAO
from fleet_gateway.errors import ContractViolation, NodeRoutingError
from fleet_gateway.node_config import make_bravo_config, make_charlie_config
from fleet_gateway.service import build_service
from fleet_gateway.worktree import WorktreeProvisioner
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


def test_launch_bravo_and_charlie_ok(service, auth, cao, charlie_cao, charlie_worktree_parent):
    bravo = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    assert bravo["isolated_worktree"] is True
    assert bravo["role"] == "bravo"
    assert Path(bravo["worktree"]).parent != charlie_worktree_parent
    charlie = service.invoke(
        "launch_worker",
        {**LAUNCH_OK, "role": "charlie", "task_id": "issue-3532-review"},
        authorization=auth,
    )
    assert charlie["role"] == "charlie"
    assert Path(charlie["worktree"]).parent == charlie_worktree_parent
    assert all(
        call[1]["isolated_worktree"] is True for call in cao.calls if call[0] == "launch_worker"
    )
    assert any(call[0] == "launch_worker" for call in charlie_cao.calls)


def test_launch_creates_real_worktree_directory(service, auth, worktree_parent, cao):
    result = service.invoke("launch_worker", dict(LAUNCH_OK), authorization=auth)
    worktree = Path(result["worktree"])
    assert worktree.is_dir()
    assert worktree.parent == worktree_parent
    assert (worktree / "README.md").is_file()
    session = cao.get_session(result["session_id"])
    assert session["worktree"] == str(worktree)
    artifact = service.artifacts.read_task(LAUNCH_OK["task_id"])
    assert artifact["worktree"] == str(worktree)
    assert artifact["session_id"] == result["session_id"]
    assert artifact["task_id"] == LAUNCH_OK["task_id"]
    assert artifact["tests"] == "not_run"
    assert artifact["type_check"] == "not_run"


def test_launch_proof_task_writes_marker(service, auth):
    params = dict(LAUNCH_OK)
    params["task_id"] = "foreman-gateway-proof"
    params["acceptance_criteria"] = "FOREMAN-GATEWAY-PROOF isolated worktree"
    result = service.invoke("launch_worker", params, authorization=auth)
    marker = Path(result["worktree"]) / "FOREMAN-GATEWAY-PROOF.txt"
    assert marker.is_file()
    assert marker.read_text(encoding="utf-8") == "FOREMAN-GATEWAY-PROOF"
    artifact = service.artifacts.read_task("foreman-gateway-proof")
    assert artifact["tests"] == "not_run"
    assert artifact["type_check"] == "not_run"


def test_charlie_missing_config_refuses_without_bravo_fallback(
    data_dir, auth, cao, origin_repo, worktree_parent
):
    repo, _sha = origin_repo
    service = build_service(
        bearer_token="test-fleet-gateway-bearer",
        cao=cao,
        data_dir=data_dir,
        requester="foreman-test",
        worktrees=WorktreeProvisioner(repo=repo, parent=worktree_parent),
        node_configs={
            "bravo": make_bravo_config(cao=cao, repo=repo, worktree_parent=worktree_parent)
        },
    )

    with pytest.raises(NodeRoutingError) as exc:
        service.invoke(
            "launch_worker",
            {**LAUNCH_OK, "role": "charlie", "task_id": "issue-3532-review"},
            authorization=auth,
        )

    assert "FLEET_GATEWAY_CHARLIE_CAO_URL" in str(exc.value)
    assert "Bravo fallback" in str(exc.value)
    assert cao.calls == []


def test_charlie_wrong_hostname_refuses_before_cao_launch(
    data_dir,
    auth,
    cao,
    charlie_cao,
    origin_repo,
    charlie_repo,
    worktree_parent,
    charlie_worktree_parent,
    tmp_path,
):
    repo, _sha = origin_repo
    service = build_service(
        bearer_token="test-fleet-gateway-bearer",
        data_dir=data_dir,
        node_configs={
            "bravo": make_bravo_config(cao=cao, repo=repo, worktree_parent=worktree_parent),
            "charlie": make_charlie_config(
                cao=charlie_cao,
                repo=charlie_repo,
                worktree_parent=charlie_worktree_parent,
                expected_path_prefix=tmp_path,
                require_cao_health=True,
            ),
        },
        hostname_provider=lambda: "FactoryLM-Bravo.local",
    )

    with pytest.raises(NodeRoutingError) as exc:
        service.invoke(
            "launch_worker",
            {**LAUNCH_OK, "role": "charlie", "task_id": "issue-3532-review"},
            authorization=auth,
        )

    assert "host identity mismatch" in str(exc.value)
    assert charlie_cao.calls == []


def test_charlie_bravo_path_refuses_before_cao_launch(
    data_dir, auth, cao, origin_repo, worktree_parent, tmp_path
):
    repo, _sha = origin_repo
    charlie_cao = FakeCAO()
    charlie_cao.cao_health = "ok"
    service = build_service(
        bearer_token="test-fleet-gateway-bearer",
        data_dir=data_dir,
        node_configs={
            "bravo": make_bravo_config(cao=cao, repo=repo, worktree_parent=worktree_parent),
            "charlie": make_charlie_config(
                cao=charlie_cao,
                repo=repo,
                worktree_parent=worktree_parent,
                expected_path_prefix=tmp_path / "charlie-home",
                require_cao_health=True,
            ),
        },
        hostname_provider=lambda: "CharlieNodes-Mac-mini.local",
    )

    with pytest.raises(NodeRoutingError) as exc:
        service.invoke(
            "launch_worker",
            {**LAUNCH_OK, "role": "charlie", "task_id": "issue-3532-review"},
            authorization=auth,
        )

    assert "outside" in str(exc.value)
    assert charlie_cao.calls == []


def test_charlie_unhealthy_cao_refuses_without_bravo_fallback(
    data_dir,
    auth,
    cao,
    charlie_repo,
    origin_repo,
    worktree_parent,
    charlie_worktree_parent,
    tmp_path,
):
    repo, _sha = origin_repo
    charlie_cao = FakeCAO()
    charlie_cao.cao_health = "unavailable"
    service = build_service(
        bearer_token="test-fleet-gateway-bearer",
        data_dir=data_dir,
        node_configs={
            "bravo": make_bravo_config(cao=cao, repo=repo, worktree_parent=worktree_parent),
            "charlie": make_charlie_config(
                cao=charlie_cao,
                repo=charlie_repo,
                worktree_parent=charlie_worktree_parent,
                expected_path_prefix=tmp_path,
                require_cao_health=True,
            ),
        },
        hostname_provider=lambda: "CharlieNodes-Mac-mini.local",
    )

    with pytest.raises(NodeRoutingError) as exc:
        service.invoke(
            "launch_worker",
            {**LAUNCH_OK, "role": "charlie", "task_id": "issue-3532-review"},
            authorization=auth,
        )

    assert "Charlie CAO is unavailable" in str(exc.value)
    assert cao.calls == []
    assert charlie_cao.calls == []
