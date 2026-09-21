"""Security contract for the staging deployment workflow.

Staging runs on a separate host resolved from repository variables (#3909), and
a manual dispatch must authorize an immutable ``main`` commit before the
protected environment or its SSH credential can be reached.  These tests exercise the authorization shell
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
    approved_rc_sha: str = _MAIN_SHA,
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
        f'VALID_SHA="{_MAIN_SHA}"\n'
        'test "$#" -eq 4 || exit 90\n'
        'test "$1" = api || exit 91\n'
        'test "$3" = --jq || exit 93\n'
        'test "$4" = .sha || exit 94\n'
        'if [ "$2" = "repos/Mikecranesync/MIRA/commits/$VALID_SHA" ]; then\n'
        '  printf "%s\\n" "$VALID_SHA"\n'
        "else\n"
        "  exit 22\n"
        "fi\n",
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
            "APPROVED_RC_SHA": approved_rc_sha,
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
    """A push trigger or a caller-selected SHA would bypass approval review."""
    workflow = _workflow()
    triggers = _triggers(workflow)

    assert set(triggers) == {"workflow_dispatch"}
    inputs = triggers["workflow_dispatch"]["inputs"]
    assert inputs["approved_rc_sha"]["required"] is True
    assert inputs["approved_rc_sha"]["type"] == "string"
    assert "target_ref" not in inputs
    assert "target_sha" not in inputs
    assert workflow["permissions"] == {"contents": "read"}


def test_authorizer_accepts_approved_rc_sha_and_emits_only_validated_values(tmp_path):
    """The happy path must bind every downstream value to validated metadata."""
    result = _run_authorizer(tmp_path, reset_volumes="true")

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "github-output").read_text(encoding="utf-8") == (
        f"approved_rc_sha={_MAIN_SHA}\nservices=mira-hub mira-pipeline\nreset_volumes=true\n"
    )


@pytest.mark.parametrize(
    ("overrides", "description"),
    [
        ({"event_name": "push"}, "non-manual invocation"),
        ({"controller_ref": "refs/heads/release/test"}, "non-main controller"),
        ({"approved_rc_sha": "A" * 40}, "non-lowercase target SHA"),
        ({"approved_rc_sha": "b" * 40}, "SHA not present in the repository"),
        ({"approved_rc_sha": "a" * 39}, "39-char SHA"),
        ({"approved_rc_sha": ""}, "empty approved_rc_sha"),
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
        "approved_rc_sha": "${{ steps.validate.outputs.approved_rc_sha }}",
        "services": "${{ steps.validate.outputs.services }}",
        "reset_volumes": "${{ steps.validate.outputs.reset_volumes }}",
    }


def test_deploy_job_reauthorizes_source_immediately_before_ssh_key_access():
    """A stale rerun must fail before the protected SSH key is materialized."""
    workflow = _workflow()
    deploy = workflow["jobs"]["deploy"]

    assert deploy["needs"] == "authorize-target"
    assert deploy["environment"] == "staging-deploy"
    steps = deploy["steps"]
    head_check_index = next(
        index
        for index, step in enumerate(steps)
        if step.get("name") == "Require HEAD == approved_rc_sha"
    )
    revalidate_index = next(
        index for index, step in enumerate(steps) if step.get("name") == "Revalidate deploy user"
    )
    credential_index = next(
        index for index, step in enumerate(steps) if step.get("name") == "Set up SSH"
    )
    assert head_check_index < credential_index
    assert revalidate_index < credential_index

    head_check = steps[head_check_index]
    assert "$(git rev-parse HEAD)" in head_check["run"]
    assert "$APPROVED_RC_SHA" in head_check["run"]

    revalidate = steps[revalidate_index]
    revalidate_text = json.dumps(revalidate)
    assert revalidate["env"]["DEPLOY_USER"] == "${{ vars.STAGING_DEPLOY_USER }}"
    assert revalidate["id"] == "revalidate"
    assert "deploy_user=%s\\n" in revalidate["run"]
    assert "root" in revalidate["run"]
    assert "secrets." not in revalidate_text

    credential = steps[credential_index]
    assert credential["env"] == {
        "STAGING_DEPLOY_SSH_KEY": "${{ secrets.STAGING_DEPLOY_SSH_KEY }}",
        "STAGING_HOST": "${{ steps.staging_host.outputs.staging_host }}",
        "STAGING_HOST_KEY": "${{ vars.STAGING_HOST_KEY }}",
    }
    assert "VPS_SSH_KEY" not in json.dumps(deploy)


def test_staging_host_resolves_from_repository_variables_with_pinned_key():
    """No literal host anywhere; the target and its host key come from validated
    repository variables, and any pinned production host is refused (#3909)."""
    text = _WORKFLOW_PATH.read_text(encoding="utf-8")
    assert "165.245.138.91" not in text
    assert "40.160.141.61" not in text
    for pinned in (_ROOT / "deployment" / "known_hosts.factorylm-prod").read_text().splitlines():
        if pinned and not pinned.startswith("#"):
            assert pinned.split()[0] not in text

    deploy = _workflow()["jobs"]["deploy"]
    steps = deploy["steps"]
    resolve_index = next(
        i for i, st in enumerate(steps) if st.get("name") == "Resolve staging host"
    )
    credential_index = next(i for i, st in enumerate(steps) if st.get("name") == "Set up SSH")
    assert resolve_index < credential_index
    resolve = steps[resolve_index]
    assert resolve["id"] == "staging_host"
    assert resolve["env"] == {
        "STAGING_HOST": "${{ vars.STAGING_HOST }}",
        "STAGING_HOST_KEY": "${{ vars.STAGING_HOST_KEY }}",
    }
    assert "deployment/known_hosts.factorylm-prod" in resolve["run"]
    assert "pinned production host" in resolve["run"]
    assert "ssh-ed25519" in resolve["run"]
    assert "staging_host=%s\\n" in resolve["run"]

    ssh_setup = steps[credential_index]["run"]
    assert "known_hosts.factorylm-prod" not in ssh_setup
    assert '"$STAGING_HOST" "$STAGING_HOST_KEY"' in ssh_setup
    assert "ssh-keyscan" not in ssh_setup

    deploy_step = _step(deploy, "Deploy exact authorized staging source")
    assert deploy_step["env"]["STAGING_HOST"] == "${{ steps.staging_host.outputs.staging_host }}"
    script = deploy_step["run"]
    assert "printf 'STAGING_HOST=%q\\n'" in script
    assert '"$STAGING_HOST" \\\n' in script  # the ssh target
    assert "StrictHostKeyChecking=yes" in script


def test_deploy_uses_only_authorized_outputs_and_resets_to_the_exact_fetch():
    """A moving branch or raw input must never select what executes remotely."""
    workflow = _workflow()
    deploy = workflow["jobs"]["deploy"]
    checkout = next(step for step in deploy["steps"] if "uses" in step)
    assert checkout["uses"] == ("actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803")
    assert checkout["with"] == {
        "ref": "${{ needs.authorize-target.outputs.approved_rc_sha }}",
        "persist-credentials": False,
    }

    deploy_step = _step(deploy, "Deploy exact authorized staging source")
    assert deploy_step["env"] == {
        "APPROVED_RC_SHA": "${{ needs.authorize-target.outputs.approved_rc_sha }}",
        "SERVICES": "${{ needs.authorize-target.outputs.services }}",
        "RESET_VOLUMES": "${{ needs.authorize-target.outputs.reset_volumes }}",
        "DEPLOY_USER": "${{ steps.revalidate.outputs.deploy_user }}",
        "STAGING_HOST": "${{ steps.staging_host.outputs.staging_host }}",
    }
    script = deploy_step["run"]
    assert 'git fetch --no-tags origin "$APPROVED_RC_SHA"' in script
    assert '"$FETCHED_SHA" = "$APPROVED_RC_SHA"' in script
    assert 'git reset --hard "$APPROVED_RC_SHA"' in script
    assert "git diff --quiet" in script
    assert "git diff --cached --quiet" in script
    assert "git ls-files --others --exclude-standard" in script
    assert "origin/main" not in script
    assert "root@" not in script
    assert "StrictHostKeyChecking=no" not in script
    assert "ssh-keyscan" not in script
    assert "${{ inputs." not in script
    assert "${{ github.event.inputs." not in script
    assert "printf 'APPROVED_RC_SHA=%q\\n'" in script

    for job in workflow["jobs"].values():
        for step in job.get("steps", []):
            assert "${{ inputs." not in step.get("run", "")


def test_staging_health_and_separate_host_guards_fail_the_job():
    """A red staging service, or anything production-shaped on the staging host,
    cannot be log-only success (#3909: separate host, no path to prod secrets)."""
    workflow = _workflow()
    script = _step(workflow["jobs"]["deploy"], "Deploy exact authorized staging source")["run"]

    assert '|| echo "FAIL"' not in script
    for port_path in (
        "127.0.0.1:4101/api/health",
        "127.0.0.1:4200/api/health",
        "127.0.0.1:4099/health",
    ):
        assert port_path in script
    # The co-tenant "prod containers must still be running" guard is retired.
    assert "Production container count looks too low" not in script
    for marker in (
        "production-named containers present on the staging host",
        "/opt/mira (production checkout) exists on the staging host",
        "Doppler token can read factorylm/prd",
    ):
        guard = script.index(marker)
        assert "exit 1" in script[guard : guard + 260], marker
    assert "doppler secrets --project factorylm --config prd --only-names" in script
