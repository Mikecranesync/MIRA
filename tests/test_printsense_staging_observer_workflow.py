"""Security contract for the read-only PrintSense staging observer.

The original workflow existed to auto-merge PR #2665 after a Telegram E2E run.
That PR is closed and the only remaining responsibility is observing the OCR
lane.  The staging host is co-tenanted with production, so protected SSH
credentials must stay behind an exact-current-main authorization boundary.
"""

from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path

import pytest
import yaml


_ROOT = Path(__file__).resolve().parent.parent
_WORKFLOW_PATH = _ROOT / ".github" / "workflows" / "printsense-staging-e2e.yml"
_MAIN_SHA = "a" * 40


def _workflow() -> dict:
    return yaml.safe_load(_WORKFLOW_PATH.read_text(encoding="utf-8"))


def _triggers(workflow: dict) -> dict:
    # PyYAML 1.1 treats the unquoted key ``on`` as boolean true.
    return workflow.get("on", workflow.get(True))


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def _run_guard(
    tmp_path: Path,
    step: dict,
    *,
    event_name: str = "schedule",
    source_ref: str = "refs/heads/main",
    source_sha: str = _MAIN_SHA,
    remote_main_sha: str = _MAIN_SHA,
    probe_user: str = "factorylm_ocr_probe",
) -> subprocess.CompletedProcess[str]:
    """Run a real workflow guard with a deterministic GitHub API response."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    gh = bin_dir / "gh"
    gh.write_text(
        '#!/bin/sh\ntest "$1" = api || exit 91\nprintf \'%s\\n\' "$REMOTE_MAIN_SHA"\n',
        encoding="utf-8",
    )
    gh.chmod(0o755)
    output_path = tmp_path / "github-output"

    env = os.environ.copy()
    env.update(
        {
            "PATH": f"{bin_dir}{os.pathsep}{env['PATH']}",
            "GITHUB_EVENT_NAME": event_name,
            "GITHUB_REF": source_ref,
            "GITHUB_SHA": source_sha,
            "GITHUB_REPOSITORY": "Mikecranesync/MIRA",
            "GITHUB_OUTPUT": str(output_path),
            "REMOTE_MAIN_SHA": remote_main_sha,
            "AUTHORIZED_SOURCE_SHA": source_sha,
            "PROBE_USER": probe_user,
        }
    )
    return subprocess.run(
        ["bash", "-euo", "pipefail", "-c", step["run"]],
        cwd=_ROOT,
        env=env,
        capture_output=True,
        text=True,
        check=False,
    )


def test_only_manual_and_scheduled_read_only_observation_remain():
    """The retired PR autopilot must not regain release or write authority."""
    workflow = _workflow()

    assert set(_triggers(workflow)) == {"workflow_dispatch", "schedule"}
    assert workflow["permissions"] == {"contents": "read"}
    assert set(workflow["jobs"]) == {"authorize-source", "ocr-lane-health"}

    serialized = json.dumps(workflow)
    for retired_capability in (
        "DOPPLER_TOKEN",
        "TELEGRAM_TEST_SESSION",
        "PR_NUMBER",
        "PR_BRANCH",
        "gh pr merge",
        "pull-requests",
        "release",
    ):
        assert retired_capability not in serialized


@pytest.mark.parametrize("event_name", ["schedule", "workflow_dispatch"])
def test_source_authorizer_accepts_only_exact_current_main(tmp_path: Path, event_name: str):
    """Both supported triggers must bind the observer to the current main SHA."""
    workflow = _workflow()
    authorize = workflow["jobs"]["authorize-source"]
    step = _step(authorize, "Authorize exact current main source")

    result = _run_guard(tmp_path, step, event_name=event_name)

    assert result.returncode == 0, result.stderr
    assert (tmp_path / "github-output").read_text(encoding="utf-8") == (f"source_sha={_MAIN_SHA}\n")


@pytest.mark.parametrize(
    ("overrides", "description"),
    [
        ({"event_name": "release"}, "retired release event"),
        ({"source_ref": "refs/heads/feature/test"}, "non-main source ref"),
        ({"source_sha": "b" * 40}, "stale workflow source"),
    ],
)
def test_source_authorizer_rejects_untrusted_or_stale_sources(
    tmp_path: Path, overrides: dict[str, str], description: str
):
    """No protected environment should be reachable from an untrusted source."""
    authorize = _workflow()["jobs"]["authorize-source"]

    result = _run_guard(
        tmp_path,
        _step(authorize, "Authorize exact current main source"),
        **overrides,
    )

    assert result.returncode != 0, f"authorizer accepted {description}"


def test_authorizer_is_secret_free_and_gates_the_observer_environment():
    """The exact-main verdict must happen before protected environment access."""
    workflow = _workflow()
    authorize = workflow["jobs"]["authorize-source"]
    observer = workflow["jobs"]["ocr-lane-health"]

    assert "environment" not in authorize
    assert "secrets." not in json.dumps(authorize)
    assert "vars." not in json.dumps(authorize)
    assert authorize["outputs"] == {"source_sha": "${{ steps.authorize.outputs.source_sha }}"}
    assert observer["needs"] == "authorize-source"
    assert observer["environment"] == "staging-observe"


def test_observer_revalidates_source_and_non_root_identity_before_key_access(
    tmp_path: Path,
):
    """A stale rerun or privileged/unsafe account must fail before key materialization."""
    observer = _workflow()["jobs"]["ocr-lane-health"]
    steps = observer["steps"]
    revalidate_index = next(
        index
        for index, step in enumerate(steps)
        if step.get("name") == "Revalidate source and probe identity"
    )
    credential_index = next(
        index
        for index, step in enumerate(steps)
        if step.get("name") == "Configure scoped probe credential"
    )
    assert credential_index == revalidate_index + 1

    revalidate = steps[revalidate_index]
    assert revalidate["env"] == {
        "AUTHORIZED_SOURCE_SHA": "${{ needs.authorize-source.outputs.source_sha }}",
        "PROBE_USER": "${{ vars.STAGING_OCR_PROBE_USER }}",
        "GH_TOKEN": "${{ github.token }}",
    }
    assert "secrets." not in json.dumps(revalidate)

    accepted = _run_guard(tmp_path, revalidate)
    assert accepted.returncode == 0, accepted.stderr
    assert (tmp_path / "github-output").read_text(encoding="utf-8") == (
        "probe_user=factorylm_ocr_probe\n"
    )

    for overrides in (
        {"source_sha": "b" * 40},
        {"remote_main_sha": "b" * 40},
        {"probe_user": "root"},
        {"probe_user": "unsafe user"},
    ):
        isolated = tmp_path / str(len(list(tmp_path.iterdir())))
        isolated.mkdir()
        result = _run_guard(isolated, revalidate, **overrides)
        assert result.returncode != 0, f"revalidator accepted {overrides}"


def test_observer_uses_only_scoped_identity_and_committed_host_trust():
    """The observer may run only the forced read-only OCR probe over strict SSH."""
    workflow = _workflow()
    observer = workflow["jobs"]["ocr-lane-health"]
    steps = observer["steps"]

    checkout = next(step for step in steps if "uses" in step)
    assert checkout == {
        "name": "Checkout committed SSH host identity",
        "uses": "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
        "with": {
            "ref": "${{ needs.authorize-source.outputs.source_sha }}",
            "sparse-checkout": "deployment/known_hosts.factorylm-prod",
            "sparse-checkout-cone-mode": False,
            "persist-credentials": False,
        },
    }

    credential = _step(observer, "Configure scoped probe credential")
    assert credential["env"] == {
        "STAGING_OCR_PROBE_SSH_KEY": "${{ secrets.STAGING_OCR_PROBE_SSH_KEY }}"
    }
    assert "deployment/known_hosts.factorylm-prod" in credential["run"]

    probe = _step(observer, "Observe OCR-lane health")
    assert probe["env"] == {"PROBE_USER": "${{ steps.revalidate.outputs.probe_user }}"}
    assert '"$PROBE_USER@165.245.138.91"' in probe["run"]
    assert '"factorylm-ocr-lane-health --format=json"' in probe["run"]
    assert 'report.get("verdict") != "ok"' in probe["run"]

    serialized = json.dumps(observer)
    for forbidden in (
        "VPS_SSH_KEY",
        "DOPPLER_TOKEN",
        "root@",
        "StrictHostKeyChecking=no",
        "ssh-keyscan",
        "docker exec",
    ):
        assert forbidden not in serialized
    assert "StrictHostKeyChecking=yes" in serialized
    assert "UserKnownHostsFile=" in serialized
