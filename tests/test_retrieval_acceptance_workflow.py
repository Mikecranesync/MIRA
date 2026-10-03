"""Contract pins for .github/workflows/retrieval-acceptance.yml (SDLC v1 Part B step 4).

The acceptance run checks out the DEPLOYED tree and executes its provisioner
and harness with the staging Doppler token. docs/architecture/mira-sdlc-v1.md
§5.2 allows that only for a commit reachable from main, §6.2 requires the
verdict-time identity re-read to fail closed, and §6.2 names the
``acceptance-receipt-<sha>`` artifact this workflow must produce. These tests
read the workflow as data; the receipt writer itself is covered by
tests/test_acceptance_receipt.py.
"""

from __future__ import annotations

import re
from pathlib import Path

import yaml

_WORKFLOW = (
    Path(__file__).resolve().parents[1] / ".github" / "workflows" / "retrieval-acceptance.yml"
)


def _steps() -> list[dict]:
    wf = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
    return wf["jobs"]["acceptance"]["steps"]


def _index(steps: list[dict], predicate) -> int:
    return next(i for i, s in enumerate(steps) if predicate(s))


def test_permissions_are_read_only():
    wf = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
    assert wf["permissions"] == {"contents": "read", "actions": "read"}


def test_ancestor_check_runs_before_the_deployed_tree_is_checked_out():
    """§5.2: nothing from the deployed tree may execute until it is proven on main."""
    steps = _steps()
    ancestor = _index(steps, lambda s: "must be on main" in (s.get("name") or ""))
    checkout = _index(
        steps,
        lambda s: (
            str(s.get("uses", "")).startswith("actions/checkout@")
            and "ref" in (s.get("with") or {})
        ),
    )
    assert ancestor < checkout
    run = steps[ancestor]["run"]
    assert "compare/main...$DEPLOYED_SHA" in run
    assert re.search(r"identical\|behind\)", run), "only identical/behind may pass"
    assert "exit 1" in run and "api error" in run, "an API error must fail closed, not pass"


def test_verdict_time_reread_fails_closed_and_records_identity():
    """§6.2: a failed re-read is INFRA_UNASSESSED, never `exit 0` with a warning."""
    steps = _steps()
    step = steps[_index(steps, lambda s: s.get("id") == "identity_end")]
    run = step["run"]
    assert str(step.get("if")).startswith("always()"), "runs even after failed scenarios"
    assert "exit 0" not in run
    assert "::warning::" not in run
    assert "identity_end=${now:-INFRA_UNASSESSED}" in run, (
        "an unreadable identity is recorded as INFRA_UNASSESSED"
    )
    assert "SUPERSEDED" in run
    # a non-40-char / non-hex health answer is treated as a failed re-read
    assert "????????????????????????????????????????" in run
    assert '*[!0-9a-f]*) now=""' in run, "40 chars alone is not a SHA; hex is required too"


def test_receipt_is_built_from_the_trusted_base_and_uploaded_under_the_sha():
    steps = _steps()
    receipt = steps[_index(steps, lambda s: s.get("id") == "receipt")]
    assert receipt["if"].startswith("always()")
    run = receipt["run"]
    assert "git show origin/main:tools/acceptance_receipt.py" in run, (
        "writer comes from the trusted base"
    )
    assert (
        "--identity-end" in run
        and "--capture-status" in run
        and "--rows /tmp/retrieval-acceptance.json" in run
    )
    upload = steps[
        _index(
            steps,
            lambda s: (
                "acceptance receipt" in (s.get("name") or "").lower() and "Upload" in s["name"]
            ),
        )
    ]
    assert upload["with"]["name"] == "acceptance-receipt-${{ steps.deployed.outputs.sha }}"
    assert upload["with"]["retention-days"] == 90
    assert upload["with"]["if-no-files-found"] == "error"
    assert re.fullmatch(r"actions/upload-artifact@[0-9a-f]{40}", upload["uses"]), (
        "new secret-adjacent step is SHA-pinned"
    )
    # the receipt step runs after the identity re-read so identity_end is known
    assert _index(steps, lambda s: s.get("id") == "identity_end") < _index(
        steps, lambda s: s.get("id") == "receipt"
    )


def test_generation_identity_is_built_at_observed_at_both_probes():
    """Codex F1 on PR #4217: gitSha alone cannot see a same-SHA rebuild; builtAt can."""
    steps = _steps()
    start = steps[_index(steps, lambda s: s.get("id") == "deployed")]["run"]
    assert "built_at=$built_at" in start and 'get("builtAt")' in start
    assert "cannot pin the deployment generation" in start, "a missing builtAt fails the run"
    end = steps[_index(steps, lambda s: s.get("id") == "identity_end")]
    run = end["run"]
    assert "built_at_end=${built_now:-INFRA_UNASSESSED}" in run
    assert '[ "$built_now" != "$BUILT_AT_START" ]' in run, "a changed builtAt is SUPERSEDED"
    assert "--workflow deploy-staging.yml" in run and "SUPERSEDED" in run, (
        "newer started deploy runs supersede"
    )
    # Codex F5 on PR #4217: a dispatch replaced in the concurrency queue ends
    # completed/cancelled without running a job — only a newer run whose DEPLOY job
    # actually started may supersede; unreadable job metadata → INFRA_UNASSESSED.
    assert 'select(.name == "Deploy MIRA staging to VPS" and .startedAt != null' in run
    assert "could not read the jobs of deploy-staging run" in run
    assert end["env"]["GH_TOKEN"] == "${{ github.token }}"
    receipt = steps[_index(steps, lambda s: s.get("id") == "receipt")]["run"]
    assert '--built-at-start "$BUILT_AT_START" --built-at-end "$BUILT_AT_END"' in receipt


def test_assessment_is_emitted_once_after_every_check_and_fed_to_the_receipt():
    """Codex F3 on PR #4217: a superseded run must not leave matching probe values
    for the receipt step to build a PASS from."""
    steps = _steps()
    run = steps[_index(steps, lambda s: s.get("id") == "identity_end")]["run"]
    assert run.count('echo "identity_end=') == 1, "one emission point"
    assert run.count('echo "built_at_end=') == 1
    assert 'echo "assessment=$assessment"' in run
    emit = run.index('echo "assessment=$assessment"')
    assert run.index("gh run list --workflow deploy-staging.yml") < emit, (
        "newer-run check precedes emission"
    )
    assert run.index('[ "$built_now" != "$BUILT_AT_START" ]') < emit
    assert run.index("exit 1") > emit, "the job fails AFTER the assessment is recorded"
    receipt = steps[_index(steps, lambda s: s.get("id") == "receipt")]
    assert (
        receipt["env"]["ASSESSMENT"]
        == "${{ steps.identity_end.outputs.assessment || 'INFRA_UNASSESSED' }}"
    )
    assert '--assessment "$ASSESSMENT"' in receipt["run"]


def test_staging_receipt_carries_the_build_identity_the_probes_must_match():
    """Codex F1 on PR #4217: the triggering deploy stamps built_at; both live probes
    must equal it (checked by tools/acceptance_receipt.py), so an older re-run deploy
    cannot be certified by a receipt for a newer run."""
    dep = (_WORKFLOW.parent / "deploy-staging.yml").read_text(encoding="utf-8")
    assert '"built_at": os.environ["MIRA_BUILD_TIME"]' in dep
    assert dep.index("export MIRA_BUILD_TIME") < dep.index(
        '"built_at": os.environ["MIRA_BUILD_TIME"]'
    )


def test_deploy_and_acceptance_share_one_concurrency_group():
    """A staging deploy may not run while the audit runs (nor the reverse)."""
    acc = yaml.safe_load(_WORKFLOW.read_text(encoding="utf-8"))
    dep = yaml.safe_load((_WORKFLOW.parent / "deploy-staging.yml").read_text(encoding="utf-8"))
    assert acc["concurrency"]["group"] == dep["concurrency"]["group"] == "staging-environment"
    assert acc["concurrency"]["cancel-in-progress"] is False
    assert dep["concurrency"]["cancel-in-progress"] is False


def test_generation_binding_reads_the_triggering_staging_receipt():
    steps = _steps()
    step = steps[_index(steps, lambda s: s.get("id") == "staging_receipt")]
    assert "github.event_name == 'workflow_run'" in step["if"]
    assert 'gh run download "$STAGING_RUN_ID" -n "staging-receipt-$DEPLOYED_SHA"' in step["run"]
    assert step["env"]["STAGING_RUN_ID"] == "${{ github.event.workflow_run.id }}"
