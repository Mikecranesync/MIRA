"""Authorization boundary for the PrintSense production activation workflow."""

from __future__ import annotations

import json
from pathlib import Path

import yaml


ROOT = Path(__file__).resolve().parents[2]
WORKFLOW_PATH = ROOT / ".github" / "workflows" / "printsense-production-activation.yml"


def _workflow() -> dict:
    return yaml.safe_load(WORKFLOW_PATH.read_text(encoding="utf-8"))


def _step(job: dict, name: str) -> dict:
    return next(step for step in job["steps"] if step.get("name") == name)


def test_activation_authorizes_current_main_without_production_credentials() -> None:
    workflow = _workflow()
    authorize = workflow["jobs"]["authorize-source"]

    assert "environment" not in authorize
    assert "secrets." not in json.dumps(authorize)
    assert authorize["outputs"] == {"source_sha": "${{ steps.authorize.outputs.source_sha }}"}
    step = _step(authorize, "Authorize exact current main source")
    script = step["run"]
    assert "git/ref/heads/main" in script
    assert '"$GITHUB_REF" = "refs/heads/main"' in script
    assert '"$GITHUB_SHA" = "$CURRENT_MAIN_SHA"' in script
    assert '"$SOURCE_SHA" = "$CURRENT_MAIN_SHA"' in script
    # #3709: the controller runs only on an explicit dispatch — the authorize
    # step must accept workflow_dispatch and refuse every other event, and no
    # post-deploy (workflow_run) conclusion check may remain to re-enable it.
    assert "workflow_dispatch)" in script
    assert "unsupported production activation event" in script
    assert "WORKFLOW_RUN_CONCLUSION" not in script
    assert "workflow_run" not in script


def test_activation_revalidates_main_immediately_before_ssh_key_access() -> None:
    activate = _workflow()["jobs"]["activate"]

    assert activate["needs"] == "authorize-source"
    assert activate["environment"] == "production"
    checkout = activate["steps"][0]
    assert checkout["with"]["ref"] == "${{ needs.authorize-source.outputs.source_sha }}"
    assert checkout["with"]["persist-credentials"] is False

    revalidate_index = next(
        index
        for index, step in enumerate(activate["steps"])
        if step.get("name") == "Revalidate exact current main source"
    )
    credential_index = next(
        index for index, step in enumerate(activate["steps"]) if step.get("name") == "Set up SSH"
    )
    assert credential_index == revalidate_index + 1
    revalidate = activate["steps"][revalidate_index]
    assert "secrets." not in json.dumps(revalidate)
    assert "git/ref/heads/main" in revalidate["run"]
    assert '"$AUTHORIZED_SHA" = "$CURRENT_MAIN_SHA"' in revalidate["run"]


def test_activation_remote_checkout_is_bound_to_authorized_sha() -> None:
    activate = _workflow()["jobs"]["activate"]
    step = _step(activate, "Apply production profile and verify live")

    assert step["env"] == {"ACTIVATION_SHA": "${{ needs.authorize-source.outputs.source_sha }}"}
    script = step["run"]
    assert 'bash -s -- "$ACTIVATION_SHA"' in script
    assert "git fetch origin main --tags --force" in script
    assert '"$FETCHED_SHA" = "$TARGET_SHA"' in script
    assert 'git reset --hard "$TARGET_SHA"' in script
    assert '"$(git rev-parse HEAD)" = "$TARGET_SHA"' in script
    assert "git reset --hard origin/main" not in script
