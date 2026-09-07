"""Security contract for the staging deployment workflow.

The staging host is co-tenanted with production, so a manual dispatch must
authorize an immutable ``main`` commit before the protected environment or its
SSH credential can be reached.  These tests exercise the authorization shell
against controlled GitHub metadata and separately verify the workflow job
boundary that keeps credentials behind that authorization.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml


_ROOT = Path(__file__).resolve().parent.parent
_WORKFLOW_PATH = _ROOT / ".github" / "workflows" / "deploy-staging.yml"
_MAIN_SHA = "a" * 40


def _workflow() -> dict:
    return yaml.safe_load(_WORKFLOW_PATH.read_text(encoding="utf-8"))


def _triggers(workflow: dict) -> dict:
    # PyYAML 1.1 treats the unquoted key ``on`` as boolean true.
    return workflow.get("on", workflow.get(True))


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def _run_authorizer(
    tmp_path: Path,
    *,
    event_name: str = "workflow_dispatch",
    controller_ref: str = "refs/heads/main",
    controller_sha: str = _MAIN_SHA,
    target_ref: str = "refs/heads/main",
    target_sha: str = _MAIN_SHA,
    services: str = "mira-hub mira-pipeline",
    reset_volumes: str = "false",
) -> subprocess.CompletedProcess[str]:
    """Run the real workflow authorization shell with a deterministic gh API."""
    workflow = _workflow()
    authorize = workflow["jobs"]["authorize-target"]
    script = _step(authorize, "Authorize exact staging source and inputs")["run"]

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    gh = bin_dir / "gh"
    gh.write_text(
        "#!/bin/sh\n"
        'test "$#" -eq 4 || exit 90\n'
        'test "$1" = api || exit 91\n'
        'test "$2" = repos/Mikecranesync/MIRA/git/ref/heads/main || exit 92\n'
        'test "$3" = --jq || exit 93\n'
        'test "$4" = .object.sha || exit 94\n'
        "printf '%s\\n' \"$REMOTE_MAIN_SHA\"\n",
        encoding="utf-8",
    )
    gh.chmod(0o755)
    output_path = tmp_path / "github-output"

    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{bin_dir}{os.pathsep}{env['PATH']}",
            "GITHUB_EVENT_NAME": event_name,
            "GITHUB_REF": controller_ref,
            "GITHUB_SHA": controller_sha,
            "GITHUB_REPOSITORY": "Mikecranesync/MIRA",
            "GITHUB_OUTPUT": str(output_path),
            "REMOTE_MAIN_SHA": _MAIN_SHA,
            "TARGET_REF_INPUT": target_ref,
            "TARGET_SHA_INPUT": target_sha,
            "SERVICES_INPUT": services,
            "RESET_VOLUMES_INPUT": reset_volumes,
        }
    )
    return subprocess.run(
        ["bash", "-euo", "pipefail", "-c", script],
        cwd=_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_staging_deploy_exposes_only_manual_exact_main_inputs():
    """A push trigger or a caller-selected ref would bypass exact-main review."""
    workflow = _workflow()
    triggers = _triggers(workflow)

    assert set(triggers) == {"workflow_dispatch"}
    inputs = triggers["workflow_dispatch"]["inputs"]
    assert inputs["target_ref"] == {
        "description": "Exact Git ref to deploy (main only)",
        "required": True,
        "type": "choice",
        "options": ["refs/heads/main"],
    }
    assert inputs["target_sha"]["required"] is True
    assert inputs["target_sha"]["type"] == "string"
    assert workflow["permissions"] == {"contents": "read"}


def test_authorizer_accepts_current_main_and_emits_only_validated_values(tmp_path):
    """The happy path must bind every downstream value to validated metadata."""
    result = _run_authorizer(tmp_path, reset_volumes="true")

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "github-output").read_text(encoding="utf-8") == (
        "target_ref=refs/heads/main\n"
        f"target_sha={_MAIN_SHA}\n"
        "services=mira-hub mira-pipeline\n"
        "reset_volumes=true\n"
    )


@pytest.mark.parametrize(
    ("overrides", "description"),
    [
        ({"event_name": "push"}, "non-manual invocation"),
        ({"controller_ref": "refs/heads/release/test"}, "non-main controller"),
        ({"controller_sha": "b" * 40}, "stale controller checkout"),
        ({"target_ref": "refs/heads/release/test"}, "non-main target ref"),
        ({"target_sha": "A" * 40}, "non-lowercase target SHA"),
        ({"target_sha": "b" * 40}, "target other than current main"),
        ({"services": "mira-hub; id"}, "shell metacharacter in services"),
        ({"services": "unknown-service"}, "service outside the allowlist"),
        ({"services": "mira-hub mira-hub"}, "duplicate service"),
        ({"services": " mira-hub"}, "non-canonical service spacing"),
        ({"reset_volumes": "yes"}, "non-boolean reset value"),
    ],
)
def test_authorizer_rejects_untrusted_or_ambiguous_inputs(
    tmp_path: Path,
    overrides: dict[str, str],
    description: str,
):
    """Invalid source or deploy parameters must stop before environment access."""
    result = _run_authorizer(tmp_path, **overrides)
    assert result.returncode != 0, f"authorizer accepted {description}"


def test_authorization_job_is_secret_free_and_owns_downstream_values():
    """Environment credentials must not be available while inputs are authorized."""
    workflow = _workflow()
    authorize = workflow["jobs"]["authorize-target"]
    serialized = json.dumps(authorize)

    assert "environment" not in authorize
    assert "secrets." not in serialized
    assert "vars." not in serialized
    assert authorize["outputs"] == {
        "target_ref": "${{ steps.authorize.outputs.target_ref }}",
        "target_sha": "${{ steps.authorize.outputs.target_sha }}",
        "services": "${{ steps.authorize.outputs.services }}",
        "reset_volumes": "${{ steps.authorize.outputs.reset_volumes }}",
    }


def test_deploy_job_reauthorizes_main_immediately_before_ssh_key_access():
    """A stale rerun must fail before the protected SSH key is materialized."""
    workflow = _workflow()
    deploy = workflow["jobs"]["deploy"]

    assert deploy["needs"] == "authorize-target"
    assert deploy["environment"] == "staging-deploy"
    steps = deploy["steps"]
    revalidate_index = next(
        index
        for index, step in enumerate(steps)
        if step.get("name") == "Revalidate current main and deploy user"
    )
    credential_index = next(
        index for index, step in enumerate(steps) if step.get("name") == "Set up SSH"
    )
    assert credential_index == revalidate_index + 1

    revalidate = steps[revalidate_index]
    revalidate_text = json.dumps(revalidate)
    assert "git/ref/heads/main" in revalidate_text
    assert '"$GITHUB_SHA" = "$CURRENT_MAIN_SHA"' in revalidate["run"]
    assert '"$AUTHORIZED_TARGET_SHA" = "$CURRENT_MAIN_SHA"' in revalidate["run"]
    assert revalidate["env"]["DEPLOY_USER"] == "${{ vars.STAGING_DEPLOY_USER }}"
    assert revalidate["id"] == "revalidate"
    assert "deploy_user=%s\\n" in revalidate["run"]
    assert "root" in revalidate["run"]
    assert "secrets." not in revalidate_text

    credential = steps[credential_index]
    assert credential["env"] == {"STAGING_DEPLOY_SSH_KEY": "${{ secrets.STAGING_DEPLOY_SSH_KEY }}"}
    assert "VPS_SSH_KEY" not in json.dumps(deploy)


def test_deploy_uses_only_authorized_outputs_and_resets_to_the_exact_fetch():
    """A moving branch or raw input must never select what executes remotely."""
    workflow = _workflow()
    deploy = workflow["jobs"]["deploy"]
    checkout = next(step for step in deploy["steps"] if "uses" in step)
    assert checkout["uses"] == ("actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803")
    assert checkout["with"] == {
        "ref": "${{ needs.authorize-target.outputs.target_sha }}",
        "persist-credentials": False,
    }

    deploy_step = _step(deploy, "Deploy exact authorized staging source")
    assert deploy_step["env"] == {
        "TARGET_REF": "${{ needs.authorize-target.outputs.target_ref }}",
        "TARGET_SHA": "${{ needs.authorize-target.outputs.target_sha }}",
        "SERVICES": "${{ needs.authorize-target.outputs.services }}",
        "RESET_VOLUMES": "${{ needs.authorize-target.outputs.reset_volumes }}",
        "DEPLOY_USER": "${{ steps.revalidate.outputs.deploy_user }}",
    }
    script = deploy_step["run"]
    assert 'git fetch --no-tags origin "$TARGET_REF"' in script
    assert '"$FETCHED_SHA" = "$TARGET_SHA"' in script
    assert 'git reset --hard "$TARGET_SHA"' in script
    assert "git diff --quiet" in script
    assert "git diff --cached --quiet" in script
    assert "git ls-files --others --exclude-standard" in script
    assert "origin/main" not in script
    assert "root@" not in script
    assert "StrictHostKeyChecking=no" not in script
    assert "ssh-keyscan" not in script
    assert "${{ inputs." not in script
    assert "${{ github.event.inputs." not in script
    assert "printf 'TARGET_SHA=%q\\n'" in script

    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            assert "${{ inputs." not in step.get("run", "")


def test_staging_health_and_production_co_tenant_guards_fail_the_job():
    """A red staging service or missing prod container cannot be log-only success."""
    workflow = _workflow()
    script = _step(workflow["jobs"]["deploy"], "Deploy exact authorized staging source")["run"]

    assert '|| echo "FAIL"' not in script
    for port_path in (
        "127.0.0.1:4101/api/health",
        "127.0.0.1:4099/health",
        "127.0.0.1:4088/",
    ):
        assert port_path in script
    low_count_guard = script.index("Production container count looks too low")
    assert "exit 1" in script[low_count_guard : low_count_guard + 220]
