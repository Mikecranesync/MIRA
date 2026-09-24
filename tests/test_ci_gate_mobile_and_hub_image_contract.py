"""Guard: the CI Gate must be able to FAIL on a red Mobile Unit Tests suite,
and Docker Build Check must build the production Hub image.

Regression context (2026-09-19, observed on PR #3837): ``mobile-unit-tests``
("Mobile Unit Tests") was neither in ``ci-gate``'s ``needs`` nor read by its
"Evaluate gate" step, so the suite was FAIL while CI Gate was green — "a check
that runs but cannot fail the merge is not a guard". Being in ``needs`` only
makes the gate *wait*; only a ``require_success`` line makes it *gate*, so
this contract pins BOTH halves.

Second gap: ``mira-hub/Dockerfile`` moved to a repo-root build context in
#3839 (``docker-compose.*.yml``: ``context: .``, ``dockerfile:
mira-hub/Dockerfile``) and was the production image with no automated build.
This contract pins a ``docker buildx build -f mira-hub/Dockerfile .`` step plus
its trivy scan in the Docker Build Check job.

pytest + pyyaml only (matches the Architecture Check CI job's deps).
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

_ROOT = Path(__file__).resolve().parent.parent
_CI = _ROOT / ".github" / "workflows" / "ci.yml"


def _jobs() -> dict:
    return yaml.safe_load(_CI.read_text(encoding="utf-8")).get("jobs", {})


def _job_named(name: str) -> dict:
    matches = [j for j in _jobs().values() if j.get("name") == name]
    assert matches, f"no job named {name!r} in ci.yml — did the job rename? Update this contract."
    return matches[0]


def _gate_run_script() -> str:
    gate = _job_named("CI Gate")
    steps = [s for s in gate.get("steps", []) if "Evaluate gate" in str(s.get("name", ""))]
    assert steps, "CI Gate has no 'Evaluate gate' step — gate shape changed; update this contract."
    return str(steps[0].get("run", ""))


def test_mobile_unit_tests_job_has_no_job_level_if():
    """Precondition for the plain require_success evaluation below: the mobile
    job must ALWAYS run (step-level paths-filter self-skip, like Hub Unit
    Tests). A job-level ``if:`` would make its result ``skipped`` on untouched
    PRs and require_success would then block every unrelated PR."""
    job = _job_named("Mobile Unit Tests")
    assert "if" not in job, (
        "Mobile Unit Tests grew a job-level `if:` — the ci-gate evaluation "
        "assumes it always runs; mirror the test-unit docs-only carve-out instead."
    )


def test_ci_gate_needs_mobile_unit_tests():
    """The gate must WAIT on the mobile job (needs) — otherwise its result is
    not even visible to the Evaluate step."""
    gate = _job_named("CI Gate")
    assert "mobile-unit-tests" in list(gate.get("needs", [])), (
        "ci-gate.needs no longer lists mobile-unit-tests — a red Mobile Unit "
        "Tests suite cannot fail the merge (the #3837 gap)."
    )


def test_ci_gate_evaluates_mobile_unit_tests_fail_closed():
    """The gate must GATE on the mobile job: read its result into env and pass
    it through require_success (not merely print it)."""
    gate = _job_named("CI Gate")
    step = [s for s in gate["steps"] if "Evaluate gate" in str(s.get("name", ""))][0]
    env = step.get("env", {})
    assert env.get("MOBILE_UNIT_RESULT") == "${{ needs.mobile-unit-tests.result }}", (
        f"Evaluate gate env must read needs.mobile-unit-tests.result into "
        f"MOBILE_UNIT_RESULT; got {env.get('MOBILE_UNIT_RESULT')!r}"
    )
    script = _gate_run_script()
    assert re.search(
        r'^\s*require_success\s+mobile-unit-tests\s+"\$MOBILE_UNIT_RESULT"\s*$', script, re.M
    ), (
        "Evaluate gate never calls require_success on $MOBILE_UNIT_RESULT — "
        "being in `needs` makes the gate wait, only require_success makes it gate."
    )


def test_docker_build_check_builds_and_scans_mira_hub():
    """Docker Build Check must build mira-hub from the REPO-ROOT context
    (matches docker-compose.*.yml after #3839) and trivy-scan the result."""
    job = _job_named("Docker Build Check")
    steps = job.get("steps", [])
    builds = [s for s in steps if s.get("name") == "Build mira-hub"]
    assert builds, (
        "Docker Build Check has no 'Build mira-hub' step — the production Hub image is unbuilt in CI."
    )
    run = str(builds[0].get("run", ""))
    assert re.search(r"docker buildx build\s*\\?\s*-f mira-hub/Dockerfile \.", run), (
        f"Build mira-hub must run `docker buildx build -f mira-hub/Dockerfile .` "
        f"(repo-root context, per docker-compose.*.yml); got:\n{run}"
    )
    assert "scope=mira-hub" in run, "Build mira-hub must use the gha cache scope mira-hub"
    scans = [s for s in steps if s.get("name") == "Scan mira-hub"]
    assert scans, "Docker Build Check has no 'Scan mira-hub' trivy step"
    assert "trivy image" in str(scans[0].get("run", "")) and "mira-hub:scan" in str(
        scans[0].get("run", "")
    ), "Scan mira-hub must trivy-scan the mira-hub:scan image"
