"""Production authorization contract — deploy-vps.yml after SDLC v1 Part B step 5.

docs/architecture/mira-sdlc-v1.md §5.2 (validators from the trusted base; candidate
reachable from main), §6.2 (acceptance receipt generation-bound to the staging run,
staging receipt checked against the ACTUAL service set incl. mira-ask), §7.2 (exact
merged-PR match, no first-associated fallback). The workflow is read as data; the two
decision points that are pure shell/jq are EXECUTED over fixtures, not merely pinned.
"""

from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
from pathlib import Path

import pytest
import yaml

REPO = Path(__file__).resolve().parents[1]
WORKFLOW = REPO / ".github" / "workflows" / "deploy-vps.yml"
SHA = "42ad7ecea0436d18ad776536c1b463e45367a166"


def _wf() -> dict:
    return yaml.safe_load(WORKFLOW.read_text(encoding="utf-8"))


def _step(job: str, name: str) -> dict:
    for step in _wf()["jobs"][job]["steps"]:
        if step.get("name") == name:
            return step
    raise AssertionError(f"{job}: step {name!r} missing")


def _run(job: str, name: str) -> str:
    return _step(job, name)["run"]


# ── one deploy target set, resolved once ───────────────────────────────────


def test_production_default_services_equals_the_deploy_script_default():
    env_default = _wf()["jobs"]["authorize-source"]["env"]["PRODUCTION_DEFAULT_SERVICES"]
    m = re.search(r'TARGETS="\$\{SERVICES:-([^}]*)\}"', _run("deploy", "Deploy"))
    assert m, "deploy script default TARGETS line not found"
    assert env_default.split() == m.group(1).split()
    assert "mira-ask" in env_default.split(), "mira-ask is in the production target set (§6.2)"


def _resolve_effective(tmp_path: Path, services: str | None) -> tuple[int, dict[str, str], str]:
    """Execute the authorize-source validation step with a given `services` input."""
    env = dict(os.environ)
    out = tmp_path / "out"
    summary = tmp_path / "summary"
    out.write_text("")
    summary.write_text("")
    env.update(
        {
            "GITHUB_OUTPUT": str(out),
            "GITHUB_STEP_SUMMARY": str(summary),
            "APPROVED_RC_SHA": SHA,
            "APPROVED_RELEASE_TAG": "",
            "PRODUCTION_DEFAULT_SERVICES": _wf()["jobs"]["authorize-source"]["env"][
                "PRODUCTION_DEFAULT_SERVICES"
            ],
        }
    )
    env.pop("SERVICES", None)
    if services is not None:
        env["SERVICES"] = services
    res = subprocess.run(
        ["bash", "-c", _run("authorize-source", "Validate approved source identity")],
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
    )
    outputs = dict(line.split("=", 1) for line in out.read_text().splitlines() if "=" in line)
    return res.returncode, outputs, res.stderr + res.stdout


def test_blank_services_resolves_to_the_production_default(tmp_path):
    rc, outputs, _ = _resolve_effective(tmp_path, "")
    assert rc == 0
    assert outputs["effective_services"] == "mira-hub mira-web mira-ask"
    assert outputs["services"] == ""


def test_explicit_services_are_the_effective_set(tmp_path):
    rc, outputs, _ = _resolve_effective(tmp_path, "mira-ask")
    assert rc == 0 and outputs["effective_services"] == "mira-ask"


@pytest.mark.parametrize(
    "bad", ["mira-ask mira-ask", "Mira-Hub", "mira-hub,mira-web", " mira-hub", "mira-hub  mira-web"]
)
def test_malformed_or_duplicate_service_lists_fail_closed(tmp_path, bad):
    rc, outputs, log = _resolve_effective(tmp_path, bad)
    assert rc == 1, log
    assert "effective_services" not in outputs


def test_every_consumer_reads_the_single_effective_set():
    deploy = _step("deploy", "Deploy")["env"]["SERVICES"]
    assert deploy == "${{ needs.authorize-source.outputs.effective_services }}"
    staging = _step("authorize-source", "Require a deployed-staging receipt for approved_rc_sha")
    assert (
        staging["env"]["EFFECTIVE_SERVICES"] == "${{ steps.validate.outputs.effective_services }}"
    )
    assert '--effective-services "${EFFECTIVE_SERVICES// /,}"' in staging["run"]
    prod = _step("deploy", "Extract and verify the production receipt")
    assert (
        prod["env"]["EFFECTIVE_SERVICES"]
        == "${{ needs.authorize-source.outputs.effective_services }}"
    )
    assert '--effective-services "${EFFECTIVE_SERVICES// /,}"' in prod["run"]
    assert '--require-services ""' not in prod["run"], "the fixed-default escape hatch is gone"


# ── exact merged-PR match (no first-associated fallback) ───────────────────


def _pr_match_filter() -> str:
    run = _run("authorize-source", "Verify Staging Gate passed")
    assert ".[0].head.sha" not in run, "the first-associated-PR fallback must be gone (§7.2)"
    m = re.search(r"'(\[\.\[\] \| select\(.*?\)\] \| map\(\.head\.sha\))'", run, re.S)
    assert m, "exact-match jq filter not found"
    return m.group(1)


def _pulls(*rows: dict) -> str:
    base = {"merge_commit_sha": SHA, "merged_at": "2026-10-03T20:57:12Z", "base": {"ref": "main"}}
    return json.dumps([{**base, **r} for r in rows])


def _matches(pulls_json: str) -> list[str]:
    jq = shutil.which("jq")
    assert jq, "jq is required (ubuntu-latest ships it)"
    out = subprocess.run(
        [jq, "-c", "--arg", "sha", SHA, _pr_match_filter()],
        input=pulls_json,
        capture_output=True,
        text=True,
        check=True,
    ).stdout
    return json.loads(out)


def test_exactly_one_merged_pr_into_main_matches():
    assert _matches(_pulls({"head": {"sha": "a" * 40}})) == ["a" * 40]


@pytest.mark.parametrize(
    "rows",
    [
        pytest.param(
            [{"merge_commit_sha": "b" * 40, "head": {"sha": "a" * 40}}], id="other-merge-sha"
        ),
        pytest.param([{"merged_at": None, "head": {"sha": "a" * 40}}], id="unmerged-pr"),
        pytest.param([{"base": {"ref": "develop"}, "head": {"sha": "a" * 40}}], id="not-into-main"),
        pytest.param([], id="no-associated-pr"),
    ],
)
def test_non_matching_associations_yield_no_candidate(rows):
    assert _matches(_pulls(*rows)) == []


def test_two_merged_matches_are_ambiguous_not_first_wins():
    assert len(_matches(_pulls({"head": {"sha": "a" * 40}}, {"head": {"sha": "c" * 40}}))) == 2
    run = _run("authorize-source", "Verify Staging Gate passed")
    assert 'if [ "$MATCH_COUNT" != "1" ]; then' in run


# ── trusted base + ancestry ────────────────────────────────────────────────


def test_candidate_must_be_an_ancestor_of_the_trusted_base():
    run = _run("authorize-source", "Pin the trusted base and its validators")
    assert 'git merge-base --is-ancestor "$APPROVED_RC_SHA" "$TRUSTED_BASE_SHA"' in run
    assert (
        _step("authorize-source", "Pin the trusted base and its validators")["env"][
            "TRUSTED_BASE_SHA"
        ]
        == "${{ github.sha }}"
    )
    assert _wf()["jobs"]["authorize-source"]["if"].endswith("github.ref == 'refs/heads/main'")


def test_no_validator_runs_from_the_candidate_checkout():
    text = WORKFLOW.read_text(encoding="utf-8")
    for candidate_invocation in (
        "python3 tools/staging_receipt.py",
        "python3 tools/acceptance_receipt.py",
        "python3 -I tools/migration_drift.py",
        "-r tools/migration-drift-requirements.txt",
    ):
        assert candidate_invocation not in text, candidate_invocation
    assert 'git show "$TRUSTED_BASE_SHA:$f"' in _run(
        "authorize-source", "Pin the trusted base and its validators"
    )
    drift = _run("migration-drift", "Verify prod migration drift = 0")
    assert '"$RUNNER_TEMP/trusted/migration_drift.py" --root "$GITHUB_WORKSPACE"' in drift
    pin = _run("migration-drift", "Pin the trusted-base validator")
    assert "tools/migration_drift.py tools/migration-drift-requirements.txt" in pin


# ── acceptance receipt: required, provenance-checked, generation-bound ─────


def test_acceptance_receipt_is_required_and_generation_bound():
    steps = [s.get("name") for s in _wf()["jobs"]["authorize-source"]["steps"]]
    staging_i = steps.index("Require a deployed-staging receipt for approved_rc_sha")
    acc_i = steps.index("Require a generation-matched acceptance receipt for approved_rc_sha")
    assert acc_i == staging_i + 1, "the acceptance check follows the staging receipt it binds to"
    step = _step(
        "authorize-source", "Require a generation-matched acceptance receipt for approved_rc_sha"
    )
    assert step["env"]["STAGING_RUN_ID"] == "${{ steps.staging-receipt.outputs.staging_run_id }}"
    run = step["run"]
    assert "acceptance-receipt-${APPROVED_RC_SHA}" in run
    assert '[ "$RUN_EVENT" != "workflow_run" ]' in run
    assert 'ACCEPTANCE_WORKFLOW_PATH=".github/workflows/retrieval-acceptance.yml"' in run
    assert '--expect-staging-run-id "$STAGING_RUN_ID"' in run
    assert "--require-capabilities retrieval,capture --require-services mira-hub" in run
    assert '"$RUNNER_TEMP/trusted/acceptance_receipt.py" verify' in run
    assert 'if [ "$RECEIPT_RUN_ID" != "$ACCEPTANCE_RUN_ID" ]; then' in run
    assert "sort_by(.created_at) | reverse | .[0] // empty" in run, "newest artifact only"
    assert 'echo "staging_run_id=$STAGING_RUN_ID" >> "$GITHUB_OUTPUT"' in _run(
        "authorize-source", "Require a deployed-staging receipt for approved_rc_sha"
    )


def test_acceptance_generation_is_bound_to_the_presented_staging_receipt():
    """Codex F1 on PR #4218: a run id survives a re-run; the generation identity does not."""
    staging = _run("authorize-source", "Require a deployed-staging receipt for approved_rc_sha")
    assert 'install -m 600 staging-receipt.json "$RUNNER_TEMP/staging-receipt.json"' in staging
    acc = _run(
        "authorize-source", "Require a generation-matched acceptance receipt for approved_rc_sha"
    )
    assert '--staging-receipt "$RUNNER_TEMP/staging-receipt.json"' in acc
    assert '[ -s "$RUNNER_TEMP/staging-receipt.json" ] ||' in acc
