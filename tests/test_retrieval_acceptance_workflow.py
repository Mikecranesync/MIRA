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
    assert step.get("if") == "always()"
    assert "exit 0" not in run
    assert "::warning::" not in run
    assert "identity_end=INFRA_UNASSESSED" in run
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


def test_generation_binding_reads_the_triggering_staging_receipt():
    steps = _steps()
    step = steps[_index(steps, lambda s: s.get("id") == "staging_receipt")]
    assert "github.event_name == 'workflow_run'" in step["if"]
    assert 'gh run download "$STAGING_RUN_ID" -n "staging-receipt-$DEPLOYED_SHA"' in step["run"]
    assert step["env"]["STAGING_RUN_ID"] == "${{ github.event.workflow_run.id }}"
