"""Only clean jobs may run on the self-hosted Bravo runners (tools/ci_runner_placement.py).

The repository check proves today's workflows obey the rule. The fixture checks prove the rule
can fail: each one breaks exactly one property of an otherwise clean job and must be flagged,
and the clean control must not be.
"""

from __future__ import annotations

import sys
from pathlib import Path

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "tools"))

from ci_runner_placement import reasons_not_clean, violations  # noqa: E402

SWITCH = "${{ fromJSON(vars.MIRA_RUNS_ON || '\"ubuntu-latest\"') }}"
CLEAN_JOB = {
    "runs-on": SWITCH,
    "steps": [{"uses": "actions/checkout@v4"}, {"run": "pytest -q"}],
}


def _workflow(job: dict, permissions: object = None) -> dict:
    wf = {"name": "t", "on": "pull_request", "jobs": {"j": job}}
    if permissions is not None:
        wf["permissions"] = permissions
    return wf


def test_repository_workflows_only_route_clean_jobs_to_bravo():
    assert violations(ROOT / ".github" / "workflows") == []


def test_some_jobs_actually_select_bravo():
    """Guards against the check passing vacuously because nothing selects the pool."""
    selecting = [
        p.name
        for p in (ROOT / ".github" / "workflows").glob("*.y*ml")
        if "vars.MIRA_RUNS_ON" in p.read_text(encoding="utf-8")
    ]
    assert len(selecting) >= 5


def test_clean_control_job_is_allowed():
    assert reasons_not_clean("ci.yml", _workflow(dict(CLEAN_JOB)), "j") == []


@pytest.mark.parametrize(
    ("change", "reason"),
    [
        ({"services": {"pg": {"image": "postgres:16"}}}, "needs docker"),
        ({"container": "node:20"}, "needs docker"),
        ({"steps": [{"run": "docker build -t x ."}]}, "needs docker"),
        ({"steps": [{"run": "docker compose up -d"}]}, "needs docker"),
        ({"steps": [{"uses": "docker://rhysd/actionlint:latest"}]}, "needs docker"),
        ({"permissions": {"contents": "read", "statuses": "write"}}, "write-scoped token"),
        ({"environment": "staging"}, "uses an environment"),
        ({"steps": [{"run": "doppler run --config prd -- ./x"}]}, "production marker"),
        ({"env": {"DOPPLER_TOKEN": "${{ secrets.DOPPLER_TOKEN }}"}}, "production marker"),
    ],
)
def test_each_unclean_property_is_flagged(change, reason):
    job = {**CLEAN_JOB, **change}
    assert reason in reasons_not_clean("ci.yml", _workflow(job), "j")


def test_workflow_level_write_permission_is_flagged():
    wf = _workflow(dict(CLEAN_JOB), permissions={"contents": "write"})
    assert "write-scoped token" in reasons_not_clean("ci.yml", wf, "j")


@pytest.mark.parametrize(
    "workflow_file",
    ["ui-lifecycle-guard.yml", "r2-signal-floor.yml", "qa-cleanup.yml", "deploy-vps.yml"],
)
def test_control_plane_and_production_workflows_never_use_bravo(workflow_file):
    assert "hosted-only workflow" in reasons_not_clean(
        workflow_file, _workflow(dict(CLEAN_JOB)), "j"
    )


def test_violations_reports_a_bad_job_in_a_workflow_dir(tmp_path):
    bad = {**CLEAN_JOB, "services": {"pg": {"image": "postgres:16"}}}
    (tmp_path / "x.yml").write_text(yaml.safe_dump(_workflow(bad)), encoding="utf-8")
    (tmp_path / "ok.yml").write_text(yaml.safe_dump(_workflow(dict(CLEAN_JOB))), encoding="utf-8")
    found = violations(tmp_path)
    assert len(found) == 1 and found[0].startswith("x.yml:j")
