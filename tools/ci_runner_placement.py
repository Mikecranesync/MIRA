"""Which workflow jobs may run on the self-hosted Bravo runners (tools/ci-runners/).

The Bravo pool runs untrusted pull-request code next to other jobs, so only *clean* jobs may
select it (``runs-on`` referencing ``vars.MIRA_RUNS_ON``). A job is clean when it:

- needs no Docker (no ``services:``/``container:``, no docker CLI, no container actions):
  Bravo runner containers have no Docker socket, so jobs cannot reach each other or the VM;
- holds no write-scoped token (job or workflow ``permissions``);
- has no ``environment:`` and no production markers (``production``, ``prd``, Doppler or
  deploy credentials);
- is not in a control-plane workflow (lifecycle guard, R2 signal floor) or a workflow that can
  reach production (deploy/migrate/seed/sign/release/cleanup).

``violations()`` is enforced by tests/test_ci_runner_placement.py. Rationale and the measured
findings behind each rule: tools/ci-runners/README.md.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

SWITCH_VAR = "MIRA_RUNS_ON"

HOSTED_WORKFLOWS = re.compile(
    r"^(deploy-|apply-|seed-|db-inspect|vps-|rollback|release|ota-release|mobile-release|"
    r"printsense-staging-e2e|ui-lifecycle-guard|r2-signal-floor|qa-cleanup)"
)
DOCKER = re.compile(
    r"(^|\s)(services|container):|docker[ -](compose|build|run|buildx|pull|push|load|exec|login)"
    r"|docker://|setup-buildx|setup-qemu|uses:\s*(rhysd/actionlint|aquasecurity/trivy-action|"
    r"returntocorp/semgrep|semgrep/semgrep|hadolint/hadolint-action|docker/)",
    re.M | re.I,
)
PROD = re.compile(
    r"production|\bprd\b|DOPPLER_TOKEN|VPS_SSH_KEY|OVH_|KEYSTORE|SSH_PRIVATE_KEY|OTA_SIGNING",
    re.I,
)


def _writes(perms: object) -> bool:
    if isinstance(perms, str):
        return perms == "write-all"
    return isinstance(perms, dict) and any(v == "write" for v in perms.values())


def reasons_not_clean(workflow_file: str, workflow: dict, job_name: str) -> list[str]:
    """Why this job must stay GitHub-hosted ([] means it may run on Bravo)."""
    job = workflow["jobs"][job_name]
    text = yaml.safe_dump(job, sort_keys=False)
    found = []
    if HOSTED_WORKFLOWS.match(workflow_file):
        found.append("hosted-only workflow")
    if DOCKER.search(text):
        found.append("needs docker")
    if _writes(job.get("permissions", workflow.get("permissions"))):
        found.append("write-scoped token")
    if "environment" in job:
        found.append("uses an environment")
    if PROD.search(text):
        found.append("production marker")
    return found


def selects_bravo(job: dict) -> bool:
    return SWITCH_VAR in str(job.get("runs-on", ""))


def violations(workflows_dir: Path) -> list[str]:
    """Every job that selects the Bravo pool but is not clean."""
    out = []
    for path in sorted(workflows_dir.glob("*.y*ml")):
        wf = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        for name, job in (wf.get("jobs") or {}).items():
            if isinstance(job, dict) and selects_bravo(job):
                why = reasons_not_clean(path.name, wf, name)
                if why:
                    out.append(
                        "%s:%s selects %s but %s" % (path.name, name, SWITCH_VAR, ", ".join(why))
                    )
    return out
