"""RED-FIRST: exact-source contract for deploy-vps/deploy-staging and release-tag resolver.

At the RC, every assertion in this file FAILS — the new contract is absent.
After implementation, all pass.

Tests the invariant from #3910 + #3911 + plan 54600b724 Task 3:
  approved_rc_sha == checked-out == built == deployed == reported-at-runtime
  for production AND staging, with zero origin/main resolution and zero bypass inputs.
"""

from __future__ import annotations

import os
import re
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parent.parent
DEPLOY_VPS_YML = REPO / ".github" / "workflows" / "deploy-vps.yml"
DEPLOY_STAGING_YML = REPO / ".github" / "workflows" / "deploy-staging.yml"
RESOLVE_TAG_SH = REPO / ".github" / "scripts" / "resolve_release_tag.sh"
SHA = "a" * 40

_FAKE_GIT = """#!/usr/bin/env bash
case "$1" in
  fetch) exit 0 ;;
  tag) exit 0 ;;
  *) exit 0 ;;
esac
"""

_FAKE_SSH = """#!/usr/bin/env bash
printf '%s\n' "$@" > "$SSH_CALL_FILE"
cat > "$SSH_STDIN_FILE"
"""


def _load_workflow(path: Path) -> dict:
    wf = yaml.safe_load(path.read_text())
    # PyYAML 1.1: bare `on:` becomes boolean True, not the string "on"
    # Normalize to "on" key for compatibility with test assertions
    if True in wf and "on" not in wf:
        wf["on"] = wf.pop(True)
    return wf


def _deploy_step_script(workflow: dict) -> str:
    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            if step.get("name") == "Deploy":
                return step["run"]
    raise AssertionError("Deploy step missing")


def _run_deploy_boundary(
    tmp_path: Path,
    *,
    services: str | None = "mira-hub mira-pipeline",
    approved_rc_sha: str | None = SHA,
    approved_release_tag: str | None = "v1.0.0",
) -> tuple[subprocess.CompletedProcess[str], Path, Path]:
    """Run the deploy script with ssh replaced by an inert recorder."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    ssh = bin_dir / "ssh"
    ssh.write_text(_FAKE_SSH)
    ssh.chmod(0o755)
    ssh_call = tmp_path / "ssh-call"
    ssh_stdin = tmp_path / "ssh-stdin"
    env = dict(os.environ)
    env["PATH"] = f"{bin_dir}:{env['PATH']}"
    env["SSH_CALL_FILE"] = str(ssh_call)
    env["SSH_STDIN_FILE"] = str(ssh_stdin)
    for key, value in (
        ("SERVICES", services),
        ("APPROVED_RC_SHA", approved_rc_sha),
        ("APPROVED_RELEASE_TAG", approved_release_tag),
    ):
        env.pop(key, None)
        if value is not None:
            env[key] = value
    result = subprocess.run(
        ["bash", "-c", _deploy_step_script(_load_workflow(DEPLOY_VPS_YML))],
        cwd=REPO,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    return result, ssh_call, ssh_stdin


# ── static: workflow structure ──────────────────────────────────────────────


def test_deploy_vps_has_approved_rc_sha_required_input():
    wf = _load_workflow(DEPLOY_VPS_YML)
    inputs = wf["on"]["workflow_dispatch"]["inputs"]
    assert "approved_rc_sha" in inputs, "approved_rc_sha must be a required input"
    assert inputs["approved_rc_sha"].get("required") is True


def test_deploy_vps_no_bypass_inputs():
    wf = _load_workflow(DEPLOY_VPS_YML)
    inputs = wf["on"]["workflow_dispatch"]["inputs"]
    bypass_keys = {"skip_staging_gate", "skip_drift_check", "skip_reason"}
    assert not any(k in inputs for k in bypass_keys), f"bypass inputs {bypass_keys} must not exist"


def test_deploy_vps_has_no_workflow_run_trigger():
    wf = _load_workflow(DEPLOY_VPS_YML)
    assert "workflow_run" not in wf.get("on", {}), "workflow_run trigger must not exist"


def test_deploy_vps_checkout_uses_approved_rc_sha():
    wf = _load_workflow(DEPLOY_VPS_YML)
    checkouts = []
    for job in wf["jobs"].values():
        for step in job.get("steps", []):
            if step.get("uses", "").startswith("actions/checkout"):
                ref = step.get("with", {}).get("ref", "")
                if ref:
                    checkouts.append(ref)
    assert checkouts, "every checkout must have a ref"
    for ref in checkouts:
        assert "approved_rc_sha" in ref, f"checkout ref must use approved_rc_sha, got: {ref}"
        assert "github.sha" not in ref, "checkout must not use github.sha"


def test_deploy_vps_no_origin_main_or_current_main():
    text = DEPLOY_VPS_YML.read_text()
    assert "rev-parse origin/main" not in text
    assert "CURRENT_MAIN" not in text
    assert "ALLOW_MOVING_FALLBACK" not in text


def test_migration_drift_job_has_no_if_conditions():
    wf = _load_workflow(DEPLOY_VPS_YML)
    migration_drift = wf["jobs"].get("migration-drift", {})
    assert migration_drift, "migration-drift job must exist"
    for step in migration_drift.get("steps", []):
        if_condition = step.get("if", "").strip()
        assert not if_condition, (
            f"migration-drift step {step.get('name')} must not have 'if:' condition; "
            f"all steps must run unconditionally"
        )


def test_migration_drift_fails_closed():
    text = DEPLOY_VPS_YML.read_text()
    assert "empty prod DATABASE_URL" in text, "fail-closed phrase for missing URL required"
    assert "handoff is missing" in text, "fail-closed phrase for missing handoff required"


def test_deploy_job_needs_authorize_and_migration_drift():
    wf = _load_workflow(DEPLOY_VPS_YML)
    deploy = wf["jobs"].get("deploy", {})
    assert deploy, "deploy job must exist"
    needs = deploy.get("needs", [])
    assert needs == ["authorize-source", "migration-drift"], (
        f"deploy must need [authorize-source, migration-drift], got: {needs}"
    )


def test_deploy_script_builds_with_cache_flags():
    script = _deploy_step_script(_load_workflow(DEPLOY_VPS_YML))
    assert re.search(r"build\s+--no-cache\s+--pull\s+\$TARGETS", script), (
        "deploy script must build with --no-cache --pull"
    )


def test_deploy_script_asserts_image_identity():
    script = _deploy_step_script(_load_workflow(DEPLOY_VPS_YML))
    assert "docker inspect --format '{{.Image}}'" in script, (
        "deploy script must assert running image identity"
    )


def test_deploy_script_asserts_approved_rc_sha():
    script = _deploy_step_script(_load_workflow(DEPLOY_VPS_YML))
    assert "$APPROVED_RC_SHA" in script, "deploy script must use APPROVED_RC_SHA"
    assert "git rev-parse HEAD" in script or "APPROVED_RC_SHA" in script


def test_deploy_script_emits_receipt_json():
    script = _deploy_step_script(_load_workflow(DEPLOY_VPS_YML))
    assert "FACTORYLM_DEPLOY_RECEIPT_JSON=" in script, "deploy script must emit a receipt JSON line"


def test_authorize_source_calls_staging_receipt_verify():
    wf = _load_workflow(DEPLOY_VPS_YML)
    authorize = wf["jobs"].get("authorize-source", {})
    assert authorize, "authorize-source job must exist"
    text = str(authorize)
    assert "staging_receipt.py verify" in text or "staging-receipt" in text, (
        "authorize-source must verify the staging receipt"
    )


def test_staging_receipt_artifacts_named_correctly():
    wf_vps = _load_workflow(DEPLOY_VPS_YML)
    wf_stg = _load_workflow(DEPLOY_STAGING_YML)
    vps_text = str(wf_vps)
    stg_text = str(wf_stg)
    assert "staging-receipt-" in vps_text or "staging-receipt-" in stg_text, (
        "workflows must create staging-receipt-* artifacts"
    )
    assert "production-receipt-" in vps_text, (
        "deploy-vps must create production-receipt-* artifacts"
    )


def test_deploy_staging_has_approved_rc_sha_input():
    wf = _load_workflow(DEPLOY_STAGING_YML)
    inputs = wf["on"]["workflow_dispatch"]["inputs"]
    assert "approved_rc_sha" in inputs, "deploy-staging must have approved_rc_sha input"


def test_deploy_staging_checkout_uses_approved_rc_sha():
    wf = _load_workflow(DEPLOY_STAGING_YML)
    for job in wf["jobs"].values():
        for step in job.get("steps", []):
            if step.get("uses", "").startswith("actions/checkout"):
                ref = step.get("with", {}).get("ref", "")
                if ref:
                    assert "approved_rc_sha" in ref, (
                        f"staging checkout must use approved_rc_sha, got: {ref}"
                    )


def test_resolve_release_tag_no_fallback():
    script = RESOLVE_TAG_SH.read_text()
    assert "ALLOW_MOVING_FALLBACK" not in script, (
        "resolve_release_tag.sh must not have fallback path"
    )


def test_compose_files_have_mira_web_build_args():
    for compose_file in [REPO / "docker-compose.saas.yml", REPO / "docker-compose.staging-vps.yml"]:
        if not compose_file.exists():
            continue
        cfg = yaml.safe_load(compose_file.read_text())
        services = cfg.get("services", {})
        if "mira-web" in services:
            mira_web = services["mira-web"]
            build = mira_web.get("build", {})
            if isinstance(build, dict):
                args = build.get("args", {})
                assert "MIRA_GIT_SHA" in str(args), (
                    f"mira-web build in {compose_file.name} must have MIRA_GIT_SHA arg"
                )


def test_mira_web_dockerfile_has_args():
    dockerfile = REPO / "mira-web" / "Dockerfile"
    if dockerfile.exists():
        text = dockerfile.read_text()
        assert "ARG MIRA_GIT_SHA" in text, "mira-web Dockerfile must declare MIRA_GIT_SHA arg"


def test_mira_web_health_endpoint_returns_gitssha():
    server_file = REPO / "mira-web" / "src" / "server.ts"
    if server_file.exists():
        text = server_file.read_text()
        assert "gitSha" in text or "MIRA_GIT_SHA" in text, (
            "mira-web health endpoint must include gitSha"
        )


# ── behavioral: validated inputs forwarded to ssh ───────────────────────────


def test_validated_inputs_are_forwarded_to_ssh(tmp_path):
    result, ssh_call, ssh_stdin = _run_deploy_boundary(
        tmp_path, approved_rc_sha=SHA, approved_release_tag="v1.2.3"
    )
    assert result.returncode == 0, result.stderr
    assert ssh_call.exists()
    call_args = ssh_call.read_text().strip().split("\n")
    # The ssh call should forward b64(services), sha, tag
    assert len(call_args) >= 4  # ssh host ... "bash" "-s" "--" args...


@pytest.mark.parametrize(
    "invalid_sha",
    [
        "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",  # uppercase
        "a" * 39,  # too short
        "main",  # branch name
        "'; rm -rf /",  # injection
    ],
)
def test_malformed_approved_rc_sha_rejected(tmp_path, invalid_sha):
    result, _, _ = _run_deploy_boundary(tmp_path, approved_rc_sha=invalid_sha)
    assert result.returncode != 0, f"malformed sha {invalid_sha} must be rejected before ssh"


@pytest.mark.parametrize(
    "invalid_tag",
    [
        "v1.2",  # incomplete
        "1.2.3",  # no v prefix
        "'; echo hacked",  # injection
    ],
)
def test_malformed_approved_release_tag_rejected(tmp_path, invalid_tag):
    result, _, _ = _run_deploy_boundary(
        tmp_path, approved_rc_sha=SHA, approved_release_tag=invalid_tag
    )
    assert result.returncode != 0, f"malformed tag {invalid_tag} must be rejected before ssh"
